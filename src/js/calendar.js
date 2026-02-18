// ── Calendar data + notifications (UI merged into dashboard heatmap) ──
let calendarEvents = [];
const _calendarNotifiedIds = new Set();

async function addCalendarEvent(ev) {
  try {
    const created = await apiPost('/api/calendar', ev);
    calendarEvents.push(created);
  } catch (e) { /* silently fail */ }
}

async function deleteCalendarEvent(id) {
  try {
    await apiDelete('/api/calendar/' + id);
    calendarEvents = calendarEvents.filter(e => e.id !== id);
  } catch (e) { /* silently fail */ }
}

