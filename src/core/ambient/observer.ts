import type { WebContents } from 'electron';
import { OllamaProvider } from '../providers/ollama.js';
import * as embeddingQueries from '../db/queries/embeddings.js';

const SKIP_PATTERNS = ['about:', 'data:', 'file:', 'chrome:', 'devtools:', 'netrun://'];
const MIN_TEXT_LENGTH = 100;
const DEBOUNCE_MS = 2000;
const HEALTH_CHECK_INTERVAL = 60_000;
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'http://127.0.0.1:11434';

const SYSTEM_PROMPT = `You are an ambient intelligence woven into a web browser. The user just visited a page and you have context about their recent browsing.

Your job: produce a single, insightful 1–2 sentence observation that connects this page to their browsing history or surfaces a non-obvious takeaway. Be specific and useful — not generic summaries.

Rules:
- If related pages exist, draw a connection or contrast.
- If nothing useful to say, respond with exactly: SKIP
- Never greet the user. Never use filler. Never explain yourself.
- Max 2 sentences. Be pithy and sharp.`;

interface PageData {
  url: string;
  title: string;
  text: string;
  tabId: string;
}

interface InsightPayload {
  tabId: string;
  url: string;
  label: string;
  detail: string;
  related: Array<{ title: string; link: string; score: number }>;
}

export class AmbientObserver {
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
      // Cancel all in-flight work
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

  private async processPage(data: PageData, sender: WebContents): Promise<void> {
    try {
      const healthy = await this.checkHealth();
      if (!healthy) return;

      const controller = new AbortController();
      this.abortControllers.set(data.tabId, controller);

      // Truncate text for embedding (first ~2000 chars)
      const truncated = data.text.slice(0, 2000);

      // 1. Embed the page text
      const vec = await this.ollama.embed(truncated);
      if (controller.signal.aborted || vec.length === 0) return;

      // 2. Store the embedding
      this.recentUrls.add(data.url);
      embeddingQueries.storeEmbedding(
        truncated, data.title, data.url, 'ambient', 'browse', vec
      );

      // 3. Search for related pages
      const related = embeddingQueries.searchEmbeddings(vec, 'browse', 5, data.url)
        .filter(r => r.score > 0.6);

      if (controller.signal.aborted) return;

      // 4. Build context and call LLM
      let userMessage = `Current page: "${data.title}"\nURL: ${data.url}\n\nPage excerpt:\n${truncated.slice(0, 800)}`;
      if (related.length > 0) {
        userMessage += '\n\nRelated pages from browsing history:';
        for (const r of related.slice(0, 3)) {
          userMessage += `\n- "${r.title}" (${r.link}) [similarity: ${r.score.toFixed(2)}]`;
        }
      }

      const response = await this.ollama.chat({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        maxTokens: 150,
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      const text = (response.message.content ?? '').trim();
      if (!text || text === 'SKIP') return;

      // 5. Send insight to renderer
      const insight: InsightPayload = {
        tabId: data.tabId,
        url: data.url,
        label: text.length > 80 ? text.slice(0, 77) + '…' : text,
        detail: text,
        related: related.slice(0, 3),
      };

      if (!sender.isDestroyed()) {
        sender.send('ambient:insight', insight);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      // Silent failure — ambient should never disrupt
      console.debug('[ambient] processPage error:', err?.message ?? err);
    } finally {
      this.abortControllers.delete(data.tabId);
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
