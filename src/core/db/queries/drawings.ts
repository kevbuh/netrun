import { prepare } from '../connection.js';

export interface Drawing {
  id: string;
  title: string;
  canvas_json: string;
  thumbnail: string;
  created_at: number;
  updated_at: number;
}

export function createDrawing(id: string, title?: string): Drawing {
  const now = Date.now() / 1000;
  prepare(
    'INSERT INTO drawings (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)'
  ).run(id, title || 'Untitled', now, now);
  return { id, title: title || 'Untitled', canvas_json: '{}', thumbnail: '', created_at: now, updated_at: now };
}

export function getDrawing(id: string): Drawing | undefined {
  return prepare('SELECT * FROM drawings WHERE id = ?').get(id) as Drawing | undefined;
}

export function saveDrawing(id: string, canvasJson: string, thumbnail?: string): void {
  const now = Date.now() / 1000;
  prepare(
    `INSERT INTO drawings (id, canvas_json, thumbnail, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET canvas_json = excluded.canvas_json, thumbnail = COALESCE(excluded.thumbnail, thumbnail), updated_at = excluded.updated_at`
  ).run(id, canvasJson, thumbnail || '', now, now);
}

export function updateDrawingTitle(id: string, title: string): void {
  prepare('UPDATE drawings SET title = ?, updated_at = ? WHERE id = ?').run(title, Date.now() / 1000, id);
}

export function listDrawings(limit = 50): Drawing[] {
  return prepare(
    'SELECT * FROM drawings ORDER BY updated_at DESC LIMIT ?'
  ).all(limit) as Drawing[];
}

export function deleteDrawing(id: string): void {
  prepare('DELETE FROM drawings WHERE id = ?').run(id);
}
