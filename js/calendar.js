// ─────────────────────────────────────────────
//  CALENDAR TAB
//  Default view: Day timeline for today, with all hours visible and
//  unallocated todos at the bottom waiting for a time slot.
//  Switch to Month view via the toggle button.
// ─────────────────────────────────────────────

let _calendarView = 'day';                   // 'day' | 'month'
let _calendarDayStr = (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10));
let _calendarMonth = new Date();
_calendarMonth.setDate(1);

const _CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const _CAL_WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const _DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const _DAY_START_HOUR = 5;   // Day view starts at 5 AM
const _DAY_END_HOUR   = 24;  // Up to midnight

function _calDateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function _addDays(dStr, n) {
  const d = new Date(dStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

function _formatHour(h) {
  if (h === 0)  return '12 AM';
  if (h === 12) return '12 PM';
  if (h === 24) return '12 AM';
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

function _parseHabitTimes(h) {
  if (!h.scheduled_time) return [];
  try {
    const parsed = JSON.parse(h.scheduled_time);
    if (Array.isArray(parsed)) return parsed.filter(Boolean);
  } catch {}
  return [h.scheduled_time];
}

function _itemHour(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const m = timeStr.match(/^(\d{1,2}):(\d{2})/);
  return m ? parseInt(m[1], 10) : null;
}

// Get items (habits + todos) scheduled at a given hour on a date
function _getHourItems(dateStr, hour) {
  const out = [];
  if (typeof habits !== 'undefined') {
    habits.forEach(h => {
      if (typeof isHabitActiveOnDate === 'function' && !isHabitActiveOnDate(h, dateStr)) return;
      _parseHabitTimes(h).forEach(t => {
        if (_itemHour(t) === hour) {
          const isDone = (h.doneCounts?.[dateStr] || 0) >= (h.target_count || 1);
          out.push({ kind: 'habit', id: h.id, icon: h.icon || '•', name: h.name, time: t, done: isDone });
        }
      });
    });
  }
  if (typeof todos !== 'undefined') {
    todos.forEach(t => {
      if (t.due_date !== dateStr) return;
      if (!t.scheduled_time) return;
      if (_itemHour(t.scheduled_time) === hour) {
        out.push({ kind: 'todo', id: t.id, icon: '○', name: t.name, time: t.scheduled_time, done: !!t.completed });
      }
    });
  }
  out.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  return out;
}

function _getUnallocatedTodos(dateStr) {
  if (typeof todos === 'undefined') return [];
  return todos.filter(t => t.due_date === dateStr && !t.scheduled_time && !t.completed);
}
function _getUnscheduledHabits(dateStr) {
  if (typeof habits === 'undefined') return [];
  return habits.filter(h => {
    if (typeof isHabitActiveOnDate === 'function' && !isHabitActiveOnDate(h, dateStr)) return false;
    return _parseHabitTimes(h).length === 0;
  });
}

// ──────────────────────────────────────────────
//  Top-level render
// ──────────────────────────────────────────────
function renderCalendar() {
  const container = document.getElementById('calendar-container');
  if (!container) return;
  container.innerHTML = _calendarView === 'day' ? renderDayView() : renderMonthView();

  // Auto-scroll the day view to current hour on render
  if (_calendarView === 'day' && _calendarDayStr === (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10))) {
    setTimeout(() => {
      const nowEl = document.querySelector('.cal-now-line');
      if (nowEl && nowEl.scrollIntoView) nowEl.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, 50);
  }
}
window.renderCalendar = renderCalendar;

// ──────────────────────────────────────────────
//  DAY VIEW
// ──────────────────────────────────────────────
function renderDayView() {
  const dStr = _calendarDayStr;
  const d = new Date(dStr + 'T00:00:00');
  const today = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10);
  const isToday = dStr === today;
  const weekday = _DAY_NAMES[d.getDay()];
  const monthName = _CAL_MONTHS[d.getMonth()];

  let html = '<div class="cal-day-wrap">';

  // Header / toolbar
  html += `<div class="cal-day-header">
    <button class="cal-nav-btn" onclick="calendarPrevDay()" aria-label="Previous day">‹</button>
    <button class="cal-day-title" onclick="calendarGoToToday()" title="Jump to today">
      <span class="cal-day-weekday">${weekday}${isToday ? ' · Today' : ''}</span>
      <span class="cal-day-date">${monthName} ${d.getDate()}, ${d.getFullYear()}</span>
    </button>
    <button class="cal-nav-btn" onclick="calendarNextDay()" aria-label="Next day">›</button>
    <button class="cal-view-toggle" onclick="calendarSetView('month')" title="Month view">▦</button>
  </div>`;

  // Timeline
  html += '<div class="cal-timeline">';
  const now = new Date();
  const nowHour = now.getHours();
  const nowMin = now.getMinutes();

  for (let h = _DAY_START_HOUR; h < _DAY_END_HOUR; h++) {
    const items = _getHourItems(dStr, h);
    const showNow = isToday && h === nowHour;
    const minPct = showNow ? (nowMin / 60) * 100 : 0;

    html += `<div class="cal-hour-row">
      <div class="cal-hour-label">${_formatHour(h)}</div>
      <div class="cal-hour-slot" onclick="calendarAllocatePrompt('${dStr}', ${h})">
        ${showNow ? `<div class="cal-now-line" style="top:${minPct}%"></div>` : ''}
        ${items.map(it => `
          <div class="cal-event ${it.kind} ${it.done ? 'done' : ''}" onclick="event.stopPropagation(); calendarEditItem('${it.kind}', '${it.id}')">
            <span class="cal-event-time">${it.time.slice(0,5)}</span>
            <span class="cal-event-icon">${it.icon}</span>
            <span class="cal-event-name">${escHtml(it.name)}</span>
            ${it.done ? '<span class="cal-event-check">✓</span>' : ''}
          </div>
        `).join('')}
      </div>
    </div>`;
  }
  html += '</div>';

  // Unallocated section
  const unallocTodos = _getUnallocatedTodos(dStr);
  const unschedHabits = _getUnscheduledHabits(dStr);
  const hasUnalloc = unallocTodos.length > 0 || unschedHabits.length > 0;

  if (hasUnalloc) {
    html += '<div class="cal-unalloc">';
    html += '<div class="cal-unalloc-label">To allocate</div>';
    html += '<div class="cal-unalloc-list">';

    unschedHabits.forEach(h => {
      const isDone = (h.doneCounts?.[dStr] || 0) >= (h.target_count || 1);
      html += `<div class="cal-unalloc-item habit ${isDone ? 'done' : ''}" onclick="calendarEditItem('habit','${h.id}')">
        <span class="cal-unalloc-icon">${h.icon || '•'}</span>
        <span class="cal-unalloc-name">${escHtml(h.name)}</span>
        <button class="cal-unalloc-add" onclick="event.stopPropagation(); calendarAllocateItem('habit','${h.id}','${dStr}')">+ time</button>
      </div>`;
    });
    unallocTodos.forEach(t => {
      html += `<div class="cal-unalloc-item todo" onclick="calendarEditItem('todo','${t.id}')">
        <span class="cal-unalloc-icon">○</span>
        <span class="cal-unalloc-name">${escHtml(t.name)}</span>
        <button class="cal-unalloc-add" onclick="event.stopPropagation(); calendarAllocateItem('todo','${t.id}','${dStr}')">+ time</button>
      </div>`;
    });

    html += '</div></div>';
  }

  html += '</div>';
  return html;
}

// ──────────────────────────────────────────────
//  MONTH VIEW
// ──────────────────────────────────────────────
function renderMonthView() {
  const y = _calendarMonth.getFullYear();
  const m = _calendarMonth.getMonth();
  const today = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10);

  let html = '<div class="cal-wrap">';
  html += `<div class="cal-toolbar">
    <button class="cal-nav-btn" onclick="calendarPrevMonth()" aria-label="Previous month">‹</button>
    <button class="cal-month-title" onclick="calendarGoToToday()" title="Jump to today">${_CAL_MONTHS[m]} ${y}</button>
    <button class="cal-nav-btn" onclick="calendarNextMonth()" aria-label="Next month">›</button>
    <button class="cal-view-toggle" onclick="calendarSetView('day')" title="Day view">📅</button>
  </div>`;

  html += '<div class="cal-weekdays">';
  _CAL_WEEKDAYS.forEach(w => { html += `<div class="cal-wd">${w}</div>`; });
  html += '</div>';

  html += '<div class="cal-grid">';
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = _calDateStr(y, m, d);
    const isToday = dStr === today;
    const isFuture = dStr > today;

    let dotsHtml = '';
    let badges = '';
    if (typeof habits !== 'undefined' && typeof isHabitActiveOnDate === 'function') {
      const scheduled = habits.filter(h => isHabitActiveOnDate(h, dStr));
      const doneCount = scheduled.filter(h => (h.doneCounts?.[dStr] || 0) >= (h.target_count || 1)).length;
      if (!isFuture && scheduled.length > 0) {
        const dotCount = Math.min(scheduled.length, 5);
        for (let i = 0; i < dotCount; i++) {
          dotsHtml += `<span class="cal-hdot ${i < doneCount ? 'done' : ''}"></span>`;
        }
      }
    }
    if (typeof todos !== 'undefined') {
      const open = todos.filter(t => t.due_date === dStr && !t.completed).length;
      if (open > 0) badges += `<span class="cal-badge open">${open}</span>`;
    }

    html += `<div class="cal-day ${isToday ? 'is-today' : ''} ${isFuture ? 'is-future' : ''}" onclick="calendarOpenDay('${dStr}')">
      <div class="cal-day-num">${d}</div>
      <div class="cal-day-dots">${dotsHtml}</div>
      <div class="cal-day-badges">${badges}</div>
    </div>`;
  }

  html += '</div></div>';
  return html;
}

// ──────────────────────────────────────────────
//  Navigation + interaction
// ──────────────────────────────────────────────
function calendarSetView(view) {
  _calendarView = view;
  haptic && haptic([10]);
  renderCalendar();
}
window.calendarSetView = calendarSetView;

function calendarOpenDay(dStr) {
  _calendarDayStr = dStr;
  _calendarView = 'day';
  haptic && haptic([10]);
  renderCalendar();
}
window.calendarOpenDay = calendarOpenDay;

function calendarPrevDay() {
  _calendarDayStr = _addDays(_calendarDayStr, -1);
  haptic && haptic([8]);
  renderCalendar();
}
function calendarNextDay() {
  _calendarDayStr = _addDays(_calendarDayStr, 1);
  haptic && haptic([8]);
  renderCalendar();
}
window.calendarPrevDay = calendarPrevDay;
window.calendarNextDay = calendarNextDay;

function calendarPrevMonth() {
  _calendarMonth.setMonth(_calendarMonth.getMonth() - 1);
  haptic && haptic([8]);
  renderCalendar();
}
function calendarNextMonth() {
  _calendarMonth.setMonth(_calendarMonth.getMonth() + 1);
  haptic && haptic([8]);
  renderCalendar();
}
window.calendarPrevMonth = calendarPrevMonth;
window.calendarNextMonth = calendarNextMonth;

function calendarGoToToday() {
  const today = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10);
  _calendarDayStr = today;
  _calendarMonth = new Date();
  _calendarMonth.setDate(1);
  haptic && haptic([12]);
  renderCalendar();
}
window.calendarGoToToday = calendarGoToToday;

function calendarEditItem(kind, id) {
  haptic && haptic([10]);
  if (kind === 'habit' && typeof openHabitEditModal === 'function') openHabitEditModal(id);
  else if (kind === 'todo' && typeof openTodoEditModal === 'function') openTodoEditModal(id);
}
window.calendarEditItem = calendarEditItem;

// Prompt to assign a time to an item. Simple version: prompt() for time.
async function calendarAllocateItem(kind, id, dStr) {
  haptic && haptic([12]);
  const promptText = `What time? (HH:MM, 24-hour)`;
  const inp = window.prompt(promptText, '09:00');
  if (!inp) return;
  const m = inp.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) { showToast('Use HH:MM format'); return; }
  const time = `${m[1].padStart(2,'0')}:${m[2]}`;
  try {
    if (kind === 'todo') {
      const t = todos.find(x => x.id === id);
      if (!t) return;
      t.scheduled_time = time;
      if (!t.due_date) t.due_date = dStr;
      await supabase.from('todos').eq('id', id).update({ scheduled_time: time, due_date: t.due_date });
    } else if (kind === 'habit') {
      const h = habits.find(x => x.id === id);
      if (!h) return;
      h.scheduled_time = time;
      await supabase.from('habits').eq('id', id).update({ scheduled_time: time });
    }
    renderCalendar();
    if (typeof renderTodo === 'function') renderTodo();
  } catch (e) {
    console.error('allocate failed', e);
    showToast('Save failed');
  }
}
window.calendarAllocateItem = calendarAllocateItem;

// Click on empty hour slot to add an item at that hour
function calendarAllocatePrompt(dStr, hour) {
  // For now, do nothing on empty slot click — could open a "+ todo" with time pre-filled
  // Reserved for future expansion (drag-drop, etc.)
}
window.calendarAllocatePrompt = calendarAllocatePrompt;
