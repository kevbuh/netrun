// ── Calendar data + notifications (UI merged into dashboard heatmap) ──
import { apiPost, apiDelete } from '/js/api.js';
export let calendarEvents = [];
export const _calendarNotifiedIds = new Set();

export async function addCalendarEvent(ev) {
  try {
    const created = await apiPost('/api/calendar', ev);
    calendarEvents.push(created);
  } catch (e) { /* silently fail */ }
}

export async function deleteCalendarEvent(id) {
  try {
    await apiDelete('/api/calendar/' + id);
    calendarEvents = calendarEvents.filter(e => e.id !== id);
  } catch (e) { /* silently fail */ }
}

