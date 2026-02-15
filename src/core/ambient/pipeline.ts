import type { WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { OllamaProvider } from '../providers/ollama.js';
import * as contentQueries from '../db/queries/content.js';
import { snapQuoteToText } from '../utils/text.js';
import { contextManager } from '../context/manager.js';

const SKIP_PATTERNS = ['about:', 'data:', 'file:', 'chrome:', 'devtools:', 'netrun://'];
const MIN_TEXT_LENGTH = 100;
const DEBOUNCE_MS = 2000;
const HEALTH_CHECK_INTERVAL = 60_000;
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';

const DATA_DIR = path.join(process.env.HOME ?? '/tmp', '.aether_data');
const ANNOTATION_PROMPT_FILE = path.join(DATA_DIR, 'annotation_prompt.txt');

const DEFAULT_ANNOTATION_PROMPT =
  "You are a helpful assistant whose job it is twofold. First, you must point out AI slop and also point out redundant information to protect the user from potentially harmful, fearmongering, or biased sentences. At the same time, you are also in charge of highlighting IMPORTANT sentences and key ideas of the current article, book, paper, or general website page that the user is visiting. Read the page and return ONLY extremely high-signal annotations. Zero fluff. Do not point out anything that is obvious.\n\n" +
  "Annotation types:\n" +
  "- ALPHA — Something lowkey, an uncommon or surprising result or fact. The thing worth remembering. Only use for genuinely informative information.\n" +
  "- CONTRADICTION — a sentence idea, or thought that shows a logical flaw. one that conflicts with previous sentences. You MUST explain the specific contradiction and why the two claims can't both be true.\n" +
  "- AD — sponsored content, affiliate links, product placement, or advertorial disguised as editorial. Flag anything that looks like it's trying to sell you something while pretending to be informational. Do not flag pip installs.\n\n" +
  "For each annotation provide a JSON object with:\n" +
  '- "type": one of the types above\n' +
  '- "quote": a passage copied EXACTLY from the page text (10-40 words). Do NOT paraphrase.\n' +
  '- "explanation": 1-2 sentences. For ALPHA: why this matters. For CONTRADICTION: what it contradicts and why. For AD: what\'s being sold.\n' +
  '- "confidence": 0-100 how confident you are\n' +
  '- "conflictsWith": (only for CONTRADICTION) the sentence of the conflicting claim\n\n' +
  "Rules:\n" +
  "- CRITICAL: Every quote must be a VERBATIM substring of the page text. Do not change ANY words. It must be verbatim from the text.\n" +
  "- Only use CONTRADICTION if there is a real logical flaw.\n" +
  "- Always use AD if the sentence seems to be trying to sell a product or service.\n" +
  "- Return 1-3 annotations for a typical page. 5-8 for longer textbooks and articles.\n" +
  "- If the page has no key results and no ads, return an empty array [].\n";

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
      const fullText = data.text.slice(0, 12_000);

      // Mark as recently seen
      this.recentUrls.add(data.url);

      // Write browsing context to living context file
      try {
        const summary = `[${data.title}](${data.url})`;
        contextManager.appendContext('main.md', '## Recent Browsing', summary + '\n');
      } catch { /* context write failed, continue */ }

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

No other text. No markdown. No explanation outside the JSON.`;

      const model = data.model || this._getModel();
      const customCats = contentQueries.listAnnotationCategories();
      const validTypes = new Set(['ALPHA', 'CONTRADICTION', 'AD', ...customCats.map(c => c.key)]);
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
                      const objStr = rawContent.slice(objStart, i + 1);
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
      const objMatch = cleanContent.match(/\{[\s\S]*\}/);
      if (objMatch) {
        try {
          const parsed = JSON.parse(objMatch[0]);
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
        } catch {
          console.debug('[insight] Final JSON parse failed');
        }
      }

      // Send result to renderer
      if (!insight && annotations.length === 0) return;

      const insightResult: InsightResult = {
        tabId: data.tabId,
        url: data.url,
        insight,
        annotations,
        related: related.slice(0, 3),
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
    return 'qwen2.5:7b';
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
