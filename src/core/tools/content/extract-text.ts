import { z } from 'zod';
import type { Tool, ToolResult } from '../types.js';

interface ExtractResult {
  text: string;
  truncated: boolean;
}

const MAX_TEXT_LENGTH = 8000;

const parameters = z.object({
  url: z.string().describe('The URL to fetch and extract text from'),
});

// In-memory cache for extracted text
const extractCache = new Map<string, string>();

/**
 * Strip HTML tags and extract text content.
 * Skips script, style, and noscript elements.
 */
function htmlToText(html: string): string {
  // Remove script, style, noscript blocks entirely
  let cleaned = html.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Remove all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '\n');
  // Clean up whitespace: collapse multiple newlines, trim lines
  const lines = cleaned
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);
  return lines.join('\n');
}

/**
 * Fetch and extract text content from a URL (web page or PDF).
 * For arXiv URLs, delegates PDF extraction to Python.
 * Ported from helpers.py:tool_fetch_page.
 */
export const extractText: Tool<z.infer<typeof parameters>, ExtractResult> = {
  name: 'extract-text',
  description: 'Fetch and extract text content from a URL (web page or PDF).',
  category: 'content',
  access: ['agent', 'mcp', 'ui'],
  parameters,

  async execute(input): Promise<ToolResult<ExtractResult>> {
    if (!input.url) {
      return { success: false, error: 'URL required' };
    }

    // Check cache
    const cached = extractCache.get(input.url);
    if (cached !== undefined) {
      return {
        success: true,
        data: {
          text: cached.slice(0, MAX_TEXT_LENGTH),
          truncated: cached.length > MAX_TEXT_LENGTH,
        },
      };
    }

    const isArxiv = input.url.includes('arxiv.org');
    let text: string;

    if (isArxiv) {
      // For arXiv, download PDF and extract via Python child process
      let pdfUrl = input.url.replace('/abs/', '/pdf/');
      if (!pdfUrl.endsWith('.pdf')) pdfUrl += '.pdf';

      const resp = await fetch(pdfUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      const pdfBuffer = Buffer.from(await resp.arrayBuffer());

      // Use Python PyMuPDF for PDF extraction
      text = await extractPdfText(pdfBuffer);
    } else {
      // Regular URL: fetch HTML and extract text
      const resp = await fetch(input.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        signal: AbortSignal.timeout(30000),
      });
      const html = await resp.text();
      text = htmlToText(html);
    }

    // Cache the result
    extractCache.set(input.url, text);

    return {
      success: true,
      data: {
        text: text.slice(0, MAX_TEXT_LENGTH),
        truncated: text.length > MAX_TEXT_LENGTH,
      },
    };
  },
};

/**
 * Extract text from a PDF buffer using Python PyMuPDF.
 * Spawns a child process to run the extraction script.
 */
async function extractPdfText(pdfBuffer: Buffer): Promise<string> {
  const { spawn } = await import('child_process');
  const { tmpdir } = await import('os');
  const { writeFileSync, unlinkSync } = await import('fs');
  const path = await import('path');

  // Write PDF to temp file
  const tmpPath = path.join(tmpdir(), `netrun-pdf-${Date.now()}.pdf`);
  writeFileSync(tmpPath, pdfBuffer);

  try {
    return await new Promise<string>((resolve, reject) => {
      const proc = spawn('python3', ['-c', `
import fitz, sys, json
doc = fitz.open(sys.argv[1])
pages = [doc[i].get_text() for i in range(len(doc))]
doc.close()
print(json.dumps({"pages": pages}))
`, tmpPath]);

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', (code: number) => {
        if (code !== 0) {
          reject(new Error(`PDF extraction failed: ${stderr}`));
          return;
        }
        try {
          const result = JSON.parse(stdout);
          resolve(result.pages.join('\n\n---\n\n'));
        } catch {
          reject(new Error('Failed to parse PDF extraction output'));
        }
      });
    });
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}
