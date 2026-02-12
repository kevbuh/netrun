// ── Calendar data + notifications (UI merged into dashboard heatmap) ──
let calendarEvents = [];
const _calendarNotifiedIds = new Set();

async function fetchCalendarEvents() {
  try {
    calendarEvents = await apiGet('/api/calendar');
  } catch (e) { calendarEvents = []; }
}

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

function checkCalendarNotifications() {
  if (!calendarEvents.length) return;
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  calendarEvents.forEach(ev => {
    if (ev.date !== todayStr) return;
    if (_calendarNotifiedIds.has(ev.id)) return;
    const m = ev.description && ev.description.match(/Time:\s*(\d{1,2}):(\d{2})/i);
    if (!m) return;
    const evMinutes = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    if (Math.abs(nowMinutes - evMinutes) > 1) return;
    const timeStr = m[1] + ':' + m[2];
    _calendarNotifiedIds.add(ev.id);
    islandUpdate('cal-' + ev.id, { type: 'calendar', label: ev.title, detail: timeStr + ' — ' + ev.title, action: () => { location.hash = 'dashboard'; } });
    setTimeout(() => islandRemove('cal-' + ev.id), 10000);
  });
}

function startCalendarNotifications() {
  fetchCalendarEvents().then(() => checkCalendarNotifications());
  setInterval(checkCalendarNotifications, 60000);
  setInterval(fetchCalendarEvents, 300000);
}
