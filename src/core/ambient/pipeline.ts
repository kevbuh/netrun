import type { WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { OllamaProvider } from '../providers/ollama.js';
import * as contentQueries from '../db/queries/content.js';
import { snapQuoteToText } from '../utils/text.js';
import { contextManager } from '../context/manager.js';
import { contextIntake } from '../context/intake.js';
import { DEFAULT_ANNOTATION_PROMPT } from './annotation-prompt.js';

const SKIP_PATTERNS = ['about:', 'data:', 'file:', 'chrome:', 'devtools:', 'netrun://'];
const MIN_TEXT_LENGTH = 100;
const DEBOUNCE_MS = 2000;
const HEALTH_CHECK_INTERVAL = 60_000;
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';

const DATA_DIR = path.join(process.env.HOME ?? '/tmp', '.netrun_data');
const ANNOTATION_PROMPT_FILE = path.join(DATA_DIR, 'annotation_prompt.txt');

const AMBIENT_SYSTEM = `You are an ambient intelligence woven into a web browser. The user just visited a page and you have context about their recent browsing.

Your job: produce a single, insightful 1–2 sentence observation that connects this page to their browsing history or surfaces a non-obvious takeaway. Be specific and useful — not generic summaries.

Rules:
- If related pages exist, draw a connection or contrast.
- If nothing useful to say, respond with exactly: null
- Never greet the user. Never use filler. Never explain yourself.
- Max 2 sentences. Be pithy and sharp.`;

interface PageData {
  url: string;
  title: string;
  text: string;
  tabId: string;
  model?: string;
  screenshot?: string;
  ocrModel?: string;
}

interface Annotation {
  type: string;
  quote: string;
  explanation: string;
  confidence: number;
  conflictsWith?: string;
  linkedTitle?: string;
  linkedUrl?: string;
}

interface RelatedPage {
  title: string;
  link: string;
  score: number;
}

export interface InsightResult {
  tabId: string;
  url: string;
  insight: string | null;
  annotations: Annotation[];
  related: RelatedPage[];
  ocrText?: string;
}

export class PageInsightPipeline {
  private enabled = true;
  private ollama: OllamaProvider;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private abortControllers = new Map<string, AbortController>();
  private recentUrls = new Set<string>();
  private ollamaHealthy: boolean | null = null;
  private lastHealthCheck = 0;

  constructor() {
    this.ollama = new OllamaProvider({ baseURL: OLLAMA_HOST });
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      for (const ctrl of this.abortControllers.values()) ctrl.abort();
      for (const timer of this.debounceTimers.values()) clearTimeout(timer);
      this.abortControllers.clear();
      this.debounceTimers.clear();
    }
  }

  stopTab(tabId: string): void {
    this.abortControllers.get(tabId)?.abort();
    this.abortControllers.delete(tabId);
    const timer = this.debounceTimers.get(tabId);
    if (timer) { clearTimeout(timer); this.debounceTimers.delete(tabId); }
  }

  onPageLoaded(data: PageData, sender: WebContents): void {
    if (!this.enabled) return;
    if (!data?.url || !data?.text) return;
    if (SKIP_PATTERNS.some(p => data.url.startsWith(p))) return;
    if (data.text.length < MIN_TEXT_LENGTH) return;
    if (this.recentUrls.has(data.url)) return;

    const tabId = data.tabId;

    // Cancel any previous in-flight processing for this tab
    this.abortControllers.get(tabId)?.abort();
    this.abortControllers.delete(tabId);

    // Clear previous debounce for this tab
    const prev = this.debounceTimers.get(tabId);
    if (prev) clearTimeout(prev);

    this.debounceTimers.set(tabId, setTimeout(() => {
      this.debounceTimers.delete(tabId);
      this.processPage(data, sender);
    }, DEBOUNCE_MS));
  }

  async processPage(data: PageData, sender: WebContents, opts?: { manual?: boolean }): Promise<void> {
    if (!this.enabled) return;

    const manual = opts?.manual ?? false;

    if (manual) {
      // Bypass cache and dedup on manual trigger
      this.recentUrls.delete(data.url);
      // Cancel any in-flight for this tab
      this.abortControllers.get(data.tabId)?.abort();
    }

    try {
      const healthy = await this.checkHealth();
      if (!healthy) {
        if (manual && !sender.isDestroyed()) {
          sender.send('insight:result', {
            tabId: data.tabId, url: data.url,
            insight: null, annotations: [], related: [],
            error: 'Ollama unavailable',
          });
        }
        return;
      }

      const controller = new AbortController();
      this.abortControllers.set(data.tabId, controller);

      const truncated = data.text.slice(0, 2000);
      let fullText = data.text.slice(0, 12_000);

      // OCR pre-pass: extract visual text from screenshot
      let extractedOcrText: string | undefined;
      if (data.screenshot) {
        console.debug(`[insight] OCR: screenshot received, extracting with ${this._getOcrModel(data.ocrModel)}…`);
        const ocrText = await this._ocrExtract(data.screenshot, data.ocrModel, controller.signal);
        if (ocrText && ocrText.length >= 20) {
          console.debug(`[insight] OCR: extracted ${ocrText.length} chars of visual text`);
          extractedOcrText = ocrText.slice(0, 4000);
          fullText = fullText + '\n\n--- VISUAL TEXT (extracted from screenshot) ---\n' + extractedOcrText;
        } else {
          console.debug('[insight] OCR: no usable text extracted, length =', ocrText?.length ?? 0, ocrText ? `preview: "${ocrText.slice(0, 80)}"` : '');
        }
      }

      // Mark as recently seen
      this.recentUrls.add(data.url);

      // Write browsing context to living context via intake pipeline
      contextIntake.ingest({
        source: 'browse', section: '## Browsing',
        content: `[${data.title}](${data.url})`,
        dedupeKey: `browse-${data.url}`,
      });

      const related: RelatedPage[] = [];

      if (controller.signal.aborted) return;

      // Build unified prompt — single LLM call for insight + annotations
      const annotationPrompt = this._buildAnnotationPrompt(fullText, data.url);

      let userMessage = `Current page: "${data.title}"\nURL: ${data.url}\n\nPage excerpt:\n${truncated.slice(0, 800)}`;
      if (related.length > 0) {
        userMessage += '\n\nRelated pages from browsing history:';
        for (const r of related.slice(0, 3)) {
          userMessage += `\n- "${r.title}" (${r.link}) [similarity: ${r.score.toFixed(2)}]`;
        }
      }

      const systemPrompt = `You are an AI assistant integrated into a web browser. You will analyze the current page and produce a JSON response with two parts.

PART 1 — INSIGHT:
${AMBIENT_SYSTEM}

PART 2 — ANNOTATIONS:
${annotationPrompt}

Respond ONLY with valid JSON in this exact format:
{
  "insight": "your 1-2 sentence observation or null",
  "annotations": [array of annotation objects]
}

No other text. No markdown. No explanation outside the JSON. /no_think`;

      const model = data.model || this._getModel();
      const customCats = contentQueries.listAnnotationCategories();
      const validTypes = new Set(['ALPHA', 'CONTRADICTION', 'EXAGGERATION', 'AD', ...customCats.map(c => c.key)]);
      const annotations: Annotation[] = [];
      let insight: string | null = null;

      // Stream the LLM response and emit partial results
      let rawContent = '';
      let insightEmitted = false;
      let emittedAnnotationCount = 0;

      const stream = this.ollama.chatStream({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage + '\n\n--- FULL PAGE TEXT FOR ANNOTATIONS ---\n' + fullText + '\n--- END ---' },
        ],
        temperature: 0.1,
        maxTokens: 4000,
        signal: controller.signal,
      });

      for await (const event of stream) {
        if (controller.signal.aborted) return;
        if (event.type === 'token') {
          rawContent += event.content;

          // Try to extract insight as soon as the string value completes
          if (!insightEmitted) {
            const insightMatch = rawContent.match(/"insight"\s*:\s*"((?:[^"\\]|\\.)*)"/);
            if (insightMatch) {
              const rawInsight = insightMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
              if (rawInsight && rawInsight !== 'SKIP' && rawInsight !== 'null') {
                insight = rawInsight;
                if (!sender.isDestroyed()) {
                  sender.send('insight:partial', { tabId: data.tabId, url: data.url, insight });
                }
              }
              insightEmitted = true;
            }
          }

          // Try to extract complete annotation objects from the annotations array
          // Find the annotations array start
          const arrStart = rawContent.indexOf('"annotations"');
          if (arrStart !== -1) {
            // Scan for complete annotation objects we haven't emitted yet
            const afterArr = rawContent.indexOf('[', arrStart);
            if (afterArr !== -1) {
              let depth = 0, objStart = -1;
              let objCount = 0;
              for (let i = afterArr + 1; i < rawContent.length; i++) {
                const ch = rawContent[i];
                if (ch === '"') {
                  // Skip string contents
                  let j = i + 1;
                  while (j < rawContent.length && rawContent[j] !== '"') {
                    if (rawContent[j] === '\\') j++;
                    j++;
                  }
                  i = j;
                  continue;
                }
                if (ch === '{') {
                  if (depth === 0) objStart = i;
                  depth++;
                } else if (ch === '}') {
                  depth--;
                  if (depth === 0 && objStart !== -1) {
                    objCount++;
                    if (objCount > emittedAnnotationCount) {
                      // New complete annotation object
                      let objStr = rawContent.slice(objStart, i + 1);
                      // Fix unquoted string values (e.g. "type": ALPHA → "type": "ALPHA")
                      objStr = objStr.replace(/:\s*([A-Z_]{2,})\s*([,}\]])/g, ': "$1"$2');
                      try {
                        const item = JSON.parse(objStr);
                        const ann = this._validateAnnotation(item, validTypes, data.text);
                        if (ann) {
                          annotations.push(ann);
                          emittedAnnotationCount = objCount;
                          if (!sender.isDestroyed()) {
                            sender.send('insight:partial', {
                              tabId: data.tabId, url: data.url,
                              annotation: ann,
                              annotationCount: annotations.length,
                            });
                          }
                        } else {
                          emittedAnnotationCount = objCount;
                        }
                      } catch {
                        emittedAnnotationCount = objCount;
                      }
                    }
                    objStart = -1;
                  }
                }
              }
            }
          }
        } else if (event.type === 'error') {
          console.debug('[insight] Stream error:', event.error);
          return;
        }
      }

      if (controller.signal.aborted) return;

      // Final parse pass — pick up anything the incremental parser missed
      let cleanContent = rawContent.trim();
      cleanContent = cleanContent.replace(/<think>[\s\S]*?<\/think>/g, '');
      if (cleanContent.includes('```')) {
        cleanContent = cleanContent.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
      }
      cleanContent = cleanContent.trim();

      // Fix unquoted string values (e.g. "type": ALPHA → "type": "ALPHA")
      cleanContent = cleanContent.replace(/:\s*([A-Z_]{2,})\s*([,}\]])/g, ': "$1"$2');

      // Try to find the top-level JSON object by matching balanced braces
      let parsed: any = null;
      const firstBrace = cleanContent.indexOf('{');
      if (firstBrace !== -1) {
        // Attempt 1: balanced brace matching for the outermost object
        let depth = 0, end = -1;
        for (let i = firstBrace; i < cleanContent.length; i++) {
          const ch = cleanContent[i];
          if (ch === '"') {
            let j = i + 1;
            while (j < cleanContent.length && cleanContent[j] !== '"') {
              if (cleanContent[j] === '\\') j++;
              j++;
            }
            i = j;
            continue;
          }
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) { end = i; break; }
          }
        }
        if (end !== -1) {
          try { parsed = JSON.parse(cleanContent.slice(firstBrace, end + 1)); } catch {}
        }
        // Attempt 2: greedy regex fallback
        if (!parsed) {
          const objMatch = cleanContent.match(/\{[\s\S]*\}/);
          if (objMatch) {
            try { parsed = JSON.parse(objMatch[0]); } catch {}
          }
        }
      }

      if (parsed) {
        // Pick up insight if we missed it during streaming
        if (!insight) {
          const rawInsight = (parsed.insight ?? '').trim();
          if (rawInsight && rawInsight !== 'SKIP' && rawInsight !== 'null') {
            insight = rawInsight;
          }
        }
        // Pick up any annotations we missed
        if (Array.isArray(parsed.annotations)) {
          for (const item of parsed.annotations.slice(emittedAnnotationCount, 15)) {
            const ann = this._validateAnnotation(item, validTypes, data.text);
            if (ann) annotations.push(ann);
          }
        }
      } else if (firstBrace !== -1) {
        console.debug('[insight] Final JSON parse failed, raw length =', cleanContent.length, 'preview:', cleanContent.slice(0, 200));
      }

      // Capture high-confidence annotations into living context
      for (const ann of annotations.slice(0, 3)) {
        if (ann.explanation) {
          contextIntake.ingest({
            source: 'browse', section: '## Browsing',
            content: `**${data.title}**: ${ann.explanation}`,
            dedupeKey: `ann-${data.url}-${ann.type}`,
          });
        }
      }

      // Send result to renderer
      if (!insight && annotations.length === 0 && !extractedOcrText) return;

      const insightResult: InsightResult = {
        tabId: data.tabId,
        url: data.url,
        insight,
        annotations,
        related: related.slice(0, 3),
        ocrText: extractedOcrText,
      };

      if (!sender.isDestroyed()) {
        sender.send('insight:result', insightResult);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      console.debug('[insight] processPage error:', err?.message ?? err);
    } finally {
      this.abortControllers.delete(data.tabId);
    }
  }

  private _buildAnnotationPrompt(text: string, url?: string): string {
    let prompt = this._getAnnotationPrompt();

    // Append custom categories
    const customCats = contentQueries.listAnnotationCategories();
    if (customCats.length) {
      prompt += 'Additional annotation types:\n';
      for (const cat of customCats) prompt += `- ${cat.key} — ${cat.description}\n`;
      prompt += '\n';
    }

    // Append feedback examples
    const goodExamples = contentQueries.listAnnotationFeedback('good', 10);
    const badExamples = contentQueries.listAnnotationFeedback('bad', 10);
    if (goodExamples.length) {
      prompt += 'EXAMPLES OF GOOD ANNOTATIONS (produce more like these):\n';
      for (const ex of goodExamples) prompt += `- "${(ex.quote ?? '').slice(0, 200)}"${ex.ann_type ? ` [${ex.ann_type}]` : ''}\n`;
      prompt += '\n';
    }
    if (badExamples.length) {
      prompt += 'EXAMPLES OF BAD ANNOTATIONS (avoid these):\n';
      for (const ex of badExamples) prompt += `- "${(ex.quote ?? '').slice(0, 200)}"${ex.ann_type ? ` [${ex.ann_type}]` : ''}\n`;
      prompt += '\n';
    }

    return prompt;
  }

  private _readAnnotationPrompt(): string | null {
    try {
      if (fs.existsSync(ANNOTATION_PROMPT_FILE)) {
        const text = fs.readFileSync(ANNOTATION_PROMPT_FILE, 'utf-8').trim();
        return text || null;
      }
    } catch {}
    return null;
  }

  private _getAnnotationPrompt(): string {
    return this._readAnnotationPrompt() ?? DEFAULT_ANNOTATION_PROMPT;
  }

  private _validateAnnotation(item: any, validTypes: Set<string>, pageText: string): Annotation | null {
    if (!item || typeof item !== 'object') return null;
    const atype = item.type ?? '';
    const quote = (item.quote ?? '').trim();
    const explanation = (item.explanation ?? '').trim();
    if (!validTypes.has(atype) || !quote) return null;
    const snapped = snapQuoteToText(quote, pageText);
    if (!snapped) return null;
    let confidence = 70;
    try { confidence = Math.max(0, Math.min(100, parseInt(item.confidence ?? '70'))); } catch {}
    const ann: Annotation = { type: atype, quote: snapped.slice(0, 500), explanation: explanation.slice(0, 300), confidence };
    if (atype === 'CONTRADICTION' && item.conflictsWith) ann.conflictsWith = item.conflictsWith.slice(0, 200);
    return ann;
  }

  private _getModel(): string {
    // Default model; renderer can pass model preference via settings
    return 'qwen3:8b';
  }

  private _getOcrModel(override?: string): string {
    return override || 'glm-ocr';
  }

  private async _ocrExtract(screenshot: string, ocrModel: string | undefined, signal: AbortSignal): Promise<string | null> {
    try {
      const resp = await fetch(`${OLLAMA_HOST}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this._getOcrModel(ocrModel),
          prompt: 'Text Recognition:',
          images: [screenshot],
          stream: false,
        }),
        signal,
      });
      if (!resp.ok) return null;
      const data = await resp.json() as { response?: string };
      return data.response?.trim() || null;
    } catch {
      return null;
    }
  }

  private async checkHealth(): Promise<boolean> {
    const now = Date.now();
    if (this.ollamaHealthy !== null && now - this.lastHealthCheck < HEALTH_CHECK_INTERVAL) {
      return this.ollamaHealthy;
    }
    try {
      const resp = await fetch(`${OLLAMA_HOST}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      });
      this.ollamaHealthy = resp.ok;
    } catch {
      this.ollamaHealthy = false;
    }
    this.lastHealthCheck = now;
    return this.ollamaHealthy;
  }
}
