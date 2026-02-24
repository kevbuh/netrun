import { prepare } from '../connection.js';

export interface PdfHighlight {
  id: string;
  url: string;
  page_num: number;
  text: string;
  rects_json: string;
  color: string;
  note: string;
  created_at: number;
  updated_at: number;
}

export function listHighlights(url: string): PdfHighlight[] {
  return prepare(
    'SELECT * FROM pdf_highlights WHERE url = ? ORDER BY page_num, created_at'
  ).all(url) as PdfHighlight[];
}

export function saveHighlight(id: string, url: string, pageNum: number, text: string, rectsJson: string, color: string, note: string): void {
  const now = Date.now() / 1000;
  prepare(
    'INSERT OR REPLACE INTO pdf_highlights (id, url, page_num, text, rects_json, color, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(id, url, pageNum, text, rectsJson, color, note, now, now);
}

export function updateHighlightNote(id: string, note: string): void {
  prepare('UPDATE pdf_highlights SET note = ?, updated_at = ? WHERE id = ?').run(note, Date.now() / 1000, id);
}

export function deleteHighlight(id: string): void {
  prepare('DELETE FROM pdf_highlights WHERE id = ?').run(id);
}
