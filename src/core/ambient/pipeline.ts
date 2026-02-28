import type { WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { OllamaProvider } from '../providers/ollama.js';
import type { ToolDefinition } from '../tools/types.js';
import * as contentQueries from '../db/queries/content.js';
import { snapQuoteToText } from '../utils/text.js';
import { contextManager } from '../context/manager.js';
import { contextIntake } from '../context/intake.js';
import { DEFAULT_ANNOTATION_PROMPT } from './annotation-prompt.js';
import { getSetting } from '../db/queries/settings.js';

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
    // Check AI master kill switch
    const aiMaster = getSetting('aiMaster');
    if (aiMaster?.value === 'off') return;

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

      const systemPrompt = `You are an ambient intelligence woven into a web browser. The user just visited a page. Analyze it and use the provided tools to emit observations and annotations.

Use emit_insight to share a single 1-2 sentence observation that connects this page to context or surfaces a non-obvious takeaway. If nothing useful, skip it.
Use add_annotation to annotate noteworthy passages — key results, contradictions, exaggerations, ads, claims needing verification, or passages needing evidence.

${annotationPrompt}

Rules:
- If related pages exist, draw a connection or contrast in your insight.
- Never greet the user. Never use filler. Never explain yourself.
- Call emit_insight at most once. Call add_annotation 1-3 times for a typical page, 5-8 for longer content.
- If the page has nothing worth annotating, don't call add_annotation. /no_think`;

      const model = data.model || this._getModel();
      console.log(`[insight] Analyzing "${data.title}" with ${model}…`);
      const customCats = contentQueries.listAnnotationCategories();
      const validTypes = new Set(['INSIGHT', 'CONTRADICTION', 'EXAGGERATION', 'AD', 'FACTCHECK', 'EVIDENCE', ...customCats.map(c => c.key)]);
      const annotations: Annotation[] = [];
      let insight: string | null = null;

      // Build tool definitions for structured output
      const typeEnum = ['INSIGHT', 'CONTRADICTION', 'EXAGGERATION', 'AD', 'FACTCHECK', 'EVIDENCE', ...customCats.map(c => c.key)];
      const tools: ToolDefinition[] = [
        {
          type: 'function',
          function: {
            name: 'emit_insight',
            description: 'Emit a 1-2 sentence ambient observation about the current page',
            parameters: {
              type: 'object',
              properties: {
                insight: { type: 'string', description: '1-2 sentence observation' },
              },
              required: ['insight'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'add_annotation',
            description: 'Annotate a passage in the page text',
            parameters: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: typeEnum, description: 'Annotation type' },
                quote: { type: 'string', description: 'EXACT verbatim substring from the page text (10-40 words)' },
                explanation: { type: 'string', description: '1-2 sentences explaining the annotation' },
                confidence: { type: 'number', minimum: 0, maximum: 100 },
                conflictsWith: { type: 'string', description: 'Only for CONTRADICTION: the conflicting claim' },
              },
              required: ['type', 'quote', 'explanation', 'confidence'],
            },
          },
        },
      ];

      // Stream the LLM response via tool-use
      let rawContent = '';

      const stream = this.ollama.chatStream({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage + '\n\n--- FULL PAGE TEXT FOR ANNOTATIONS ---\n' + fullText + '\n--- END ---' },
        ],
        tools,
        toolChoice: 'auto',
        temperature: 0.1,
        maxTokens: 4000,
        signal: controller.signal,
      });

      for await (const event of stream) {
        if (controller.signal.aborted) return;
        if (event.type === 'tool_call') {
          try {
            const args = JSON.parse(event.arguments);
            if (event.name === 'emit_insight') {
              const rawInsight = (args.insight ?? '').trim();
              if (rawInsight && rawInsight !== 'SKIP' && rawInsight !== 'null') {
                insight = rawInsight;
                if (!sender.isDestroyed()) {
                  sender.send('insight:partial', { tabId: data.tabId, url: data.url, insight });
                }
              }
            } else if (event.name === 'add_annotation') {
              const ann = this._validateAnnotation(args, validTypes, data.text);
              if (ann) {
                annotations.push(ann);
                if (!sender.isDestroyed()) {
                  sender.send('insight:partial', {
                    tabId: data.tabId, url: data.url,
                    annotation: ann,
                    annotationCount: annotations.length,
                  });
                }
              }
            }
          } catch {
            console.debug('[insight] Failed to parse tool_call arguments');
          }
        } else if (event.type === 'token') {
          rawContent += event.content;
        } else if (event.type === 'error') {
          console.debug('[insight] Stream error:', event.error);
          return;
        }
      }

      if (controller.signal.aborted) return;

      // Fallback: if model emitted text instead of tool calls (some Ollama models
      // don't support tool-use), try to parse JSON from rawContent
      if (!insight && annotations.length === 0 && rawContent.trim().length > 10) {
        let cleanContent = rawContent.trim();
        cleanContent = cleanContent.replace(/<think>[\s\S]*?<\/think>/g, '');
        if (cleanContent.includes('```')) {
          cleanContent = cleanContent.replace(/```(?:json)?\s*/g, '').replace(/```/g, '');
        }
        cleanContent = cleanContent.trim();
        cleanContent = cleanContent.replace(/:\s*([A-Z_]{2,})\s*([,}\]])/g, ': "$1"$2');

        let parsed: any = null;
        const firstBrace = cleanContent.indexOf('{');
        if (firstBrace !== -1) {
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
            else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
          }
          if (end !== -1) {
            try { parsed = JSON.parse(cleanContent.slice(firstBrace, end + 1)); } catch {}
          }
          if (!parsed) {
            const objMatch = cleanContent.match(/\{[\s\S]*\}/);
            if (objMatch) { try { parsed = JSON.parse(objMatch[0]); } catch {} }
          }
        }
        if (parsed) {
          const rawInsight = (parsed.insight ?? '').trim();
          if (rawInsight && rawInsight !== 'SKIP' && rawInsight !== 'null') {
            insight = rawInsight;
          }
          if (Array.isArray(parsed.annotations)) {
            for (const item of parsed.annotations.slice(0, 15)) {
              const ann = this._validateAnnotation(item, validTypes, data.text);
              if (ann) annotations.push(ann);
            }
          }
        } else if (firstBrace !== -1) {
          console.debug('[insight] Fallback JSON parse failed, raw length =', cleanContent.length, 'preview:', cleanContent.slice(0, 200));
        }
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
