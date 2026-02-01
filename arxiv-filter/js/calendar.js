// ── Calendar ──
let calendarEvents = [];
let calendarYear, calendarMonth;
let calendarSelectedDay = null;
let calendarShowForm = false;

{
  const now = new Date();
  calendarYear = now.getFullYear();
  calendarMonth = now.getMonth();
}

function openCalendar() {
  hideAllViews();
  const view = document.getElementById('calendar-view');
  view.classList.add('active');
  view.style.display = 'block';
  window.location.hash = 'calendar';
  setSidebarActive('sb-home');
  fetchCalendarEvents();
}

async function fetchCalendarEvents() {
  try {
    const evResp = await fetch('/api/calendar', { headers: _authHeaders() });
    calendarEvents = await evResp.json();
  } catch (e) { calendarEvents = []; }
  renderCalendarView();
}

async function addCalendarEvent(ev) {
  try {
    const resp = await fetch('/api/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ..._authHeaders() },
      body: JSON.stringify(ev)
    });
    const created = await resp.json();
    calendarEvents.push(created);
    calendarShowForm = false;
    renderCalendarView();
  } catch (e) { /* silently fail */ }
}

async function deleteCalendarEvent(id) {
  try {
    await fetch('/api/calendar/' + id, { method: 'DELETE', headers: _authHeaders() });
    calendarEvents = calendarEvents.filter(e => e.id !== id);
    renderCalendarView();
  } catch (e) { /* silently fail */ }
}

function calendarPrev() { calendarMonth--; if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; } calendarSelectedDay = null; calendarShowForm = false; renderCalendarView(); }
function calendarNext() { calendarMonth++; if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; } calendarSelectedDay = null; calendarShowForm = false; renderCalendarView(); }
function calendarToday() { const n = new Date(); calendarYear = n.getFullYear(); calendarMonth = n.getMonth(); calendarSelectedDay = null; calendarShowForm = false; renderCalendarView(); }

function calendarSelectDay(day) {
  calendarSelectedDay = day;
  calendarShowForm = false;
  renderCalendarView();
}

function calendarToggleForm() {
  calendarShowForm = !calendarShowForm;
  renderCalendarView();
}

function calendarSubmitForm() {
  const title = document.getElementById('cal-ev-title').value.trim();
  if (!title) return;
  const desc = document.getElementById('cal-ev-desc').value.trim();
  const colorEl = document.querySelector('input[name="cal-ev-color"]:checked');
  const color = colorEl ? colorEl.value : '#b4451a';
  const dateStr = `${calendarYear}-${String(calendarMonth + 1).padStart(2, '0')}-${String(calendarSelectedDay).padStart(2, '0')}`;
  addCalendarEvent({ title, description: desc, date: dateStr, color });
}

function renderCalendarView() {
  const container = document.getElementById('calendar-view-content');
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === calendarYear && today.getMonth() === calendarMonth;
  const todayDate = today.getDate();

  const firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(calendarYear, calendarMonth, 0).getDate();

  const eventsByDay = {};
  calendarEvents.forEach(ev => {
    const [y, m, d] = ev.date.split('-').map(Number);
    if (y === calendarYear && m === calendarMonth + 1) {
      if (!eventsByDay[d]) eventsByDay[d] = [];
      eventsByDay[d].push(ev);
    }
  });

  const presetColors = [
    { value: '#b4451a', label: 'Accent' },
    { value: '#3b82f6', label: 'Blue' },
    { value: '#22c55e', label: 'Green' },
    { value: '#a855f7', label: 'Purple' },
    { value: '#eab308', label: 'Yellow' },
    { value: '#ef4444', label: 'Red' }
  ];

  let html = `
    <div class="flex items-center justify-between mb-6">
      <h2 class="text-[1.3rem] font-semibold text-white_">Calendar</h2>
    </div>
    <div class="flex items-center gap-3 mb-5">
      <button onclick="calendarPrev()" class="w-8 h-8 rounded-lg bg-card border border-border-card text-primary flex items-center justify-center cursor-pointer hover:bg-hover transition-colors">
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
      </button>
      <button onclick="calendarToday()" class="px-3 py-1 rounded-lg bg-card border border-border-card text-[0.8rem] text-primary cursor-pointer hover:bg-hover transition-colors">Today</button>
      <button onclick="calendarNext()" class="w-8 h-8 rounded-lg bg-card border border-border-card text-primary flex items-center justify-center cursor-pointer hover:bg-hover transition-colors">
        <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
      </button>
      <span class="text-[1.1rem] font-semibold text-white_ ml-1">${monthNames[calendarMonth]} ${calendarYear}</span>
    </div>
    <div class="grid grid-cols-7 gap-px bg-border-card rounded-xl overflow-hidden border border-border-card">
  `;

  dayNames.forEach(d => {
    html += `<div class="bg-card px-2 py-2 text-center text-[0.75rem] font-semibold text-dimmer uppercase tracking-wide">${d}</div>`;
  });

  for (let i = firstDay - 1; i >= 0; i--) {
    const d = daysInPrevMonth - i;
    html += `<div class="bg-card px-2 py-1.5 min-h-[70px] opacity-30"><span class="text-[0.8rem] text-dimmer">${d}</span></div>`;
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = isCurrentMonth && d === todayDate;
    const isSelected = d === calendarSelectedDay;
    const evs = eventsByDay[d] || [];
    const borderClass = isToday ? 'border-2 border-accent' : '';
    const selectedClass = isSelected ? 'bg-hover' : 'bg-card';
    html += `<div class="${selectedClass} ${borderClass} px-2 py-1.5 min-h-[70px] cursor-pointer hover:bg-hover transition-colors" onclick="calendarSelectDay(${d})">
      <span class="text-[0.8rem] ${isToday ? 'text-accent font-bold' : 'text-primary'}">${d}</span>
      <div class="flex flex-wrap gap-1 mt-1">
        ${evs.map(ev => `<span class="w-2 h-2 rounded-full inline-block" style="background:${ev.color}" title="${ev.title.replace(/"/g, '&quot;')}"></span>`).join('')}
      </div>
    </div>`;
  }

  const totalCells = firstDay + daysInMonth;
  const remaining = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= remaining; d++) {
    html += `<div class="bg-card px-2 py-1.5 min-h-[70px] opacity-30"><span class="text-[0.8rem] text-dimmer">${d}</span></div>`;
  }

  html += `</div>`;

  if (calendarSelectedDay !== null) {
    const evs = eventsByDay[calendarSelectedDay] || [];
    const dateStr = `${monthNames[calendarMonth]} ${calendarSelectedDay}, ${calendarYear}`;
    html += `
      <div class="mt-6 p-5 bg-card rounded-xl border border-border-card">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-[1rem] font-semibold text-white_">${dateStr}</h3>
          <button onclick="calendarToggleForm()" class="px-3 py-1.5 rounded-lg bg-accent text-white text-[0.8rem] font-medium cursor-pointer hover:opacity-90 transition-opacity border-none">${calendarShowForm ? 'Cancel' : '+ Add Event'}</button>
        </div>
    `;

    if (calendarShowForm) {
      html += `
        <div class="mb-4 p-4 bg-body rounded-lg border border-border-card">
          <input type="text" id="cal-ev-title" placeholder="Event title..." class="w-full px-3 py-2 rounded-md border border-border-input bg-input text-primary text-[0.85rem] mb-3 focus:outline-none focus:border-accent" />
          <textarea id="cal-ev-desc" placeholder="Description (optional)" rows="2" class="w-full px-3 py-2 rounded-md border border-border-input bg-input text-primary text-[0.85rem] mb-3 resize-none focus:outline-none focus:border-accent"></textarea>
          <div class="flex items-center gap-3 mb-3">
            <span class="text-[0.8rem] text-dimmer">Color:</span>
            ${presetColors.map((c, i) => `
              <label class="cursor-pointer">
                <input type="radio" name="cal-ev-color" value="${c.value}" ${i === 0 ? 'checked' : ''} class="sr-only peer" />
                <span class="w-6 h-6 rounded-full inline-block border-2 border-transparent peer-checked:border-white transition-colors" style="background:${c.value}" title="${c.label}"></span>
              </label>
            `).join('')}
          </div>
          <div class="flex gap-2">
            <button onclick="calendarSubmitForm()" class="px-4 py-1.5 rounded-lg bg-accent text-white text-[0.8rem] font-medium cursor-pointer hover:opacity-90 transition-opacity border-none">Save</button>
            <button onclick="calendarToggleForm()" class="px-4 py-1.5 rounded-lg bg-card border border-border-card text-primary text-[0.8rem] cursor-pointer hover:bg-hover transition-colors">Cancel</button>
          </div>
        </div>
      `;
    }

    if (evs.length === 0 && !calendarShowForm) {
      html += `<p class="text-[0.85rem] text-dimmer">No events on this day.</p>`;
    } else {
      evs.forEach(ev => {
        html += `
          <div class="flex items-start gap-3 py-2.5 border-b border-border-dim last:border-0">
            <span class="w-3 h-3 rounded-full mt-1 flex-shrink-0" style="background:${ev.color}"></span>
            <div class="flex-1 min-w-0">
              <div class="text-[0.9rem] font-medium text-white_">${ev.title}</div>
              ${ev.description ? `<div class="text-[0.8rem] text-dimmer mt-0.5">${ev.description}</div>` : ''}
            </div>
            <button onclick="deleteCalendarEvent('${ev.id}')" class="text-dimmer hover:text-red-400 transition-colors cursor-pointer bg-transparent border-none p-1" title="Delete event">
              <svg class="w-4 h-4 fill-current" viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
            </button>
          </div>
        `;
      });

    }

    html += `</div>`;
  }

  container.innerHTML = html;
}

