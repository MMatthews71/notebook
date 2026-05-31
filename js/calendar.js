// ─────────────────────────────────────────────
//  CALENDAR TAB
//  Default view: Day timeline for today, with all hours visible and
//  unallocated todos at the bottom waiting for a time slot.
//  Switch to Month view via the toggle button.
// ─────────────────────────────────────────────

// Local-timezone today (UTC-safe — toISOString shifts dates in non-UTC zones)
function _localToday() {
  if (typeof todayStr === 'function') return todayStr();
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

let _calendarView = 'day';                   // 'day' | 'month'
let _calendarDayStr = _localToday();
let _calendarMonth = new Date();
_calendarMonth.setDate(1);

// ── SIDEBAR INDEPENDENT STATE ─────────────────
let _sidebarDayStr = _localToday();         // separate date for the Goals panel sidebar

const _CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const _CAL_WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const _DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const _DAY_START_HOUR = 5;   // Day view starts at 5 AM
const _DAY_END_HOUR   = 24;  // Up to midnight

function _calDateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function _addDays(dStr, n) {
  // Build using LOCAL components — toISOString() converts to UTC and shifts
  // the date in timezones with non-zero offsets (e.g. UTC+10 in Australia).
  const d = new Date(dStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
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

// Get items (habits + todos) at a given hour on a date.
// Today only: undone items whose scheduled time has already passed are
// "rolled forward" to the current hour so they're never left behind — they
// follow the user through the day until done.
function _getHourItems(dateStr, hour) {
  const out = [];
  const today = _localToday();
  const isToday = dateStr === today;
  const now = new Date();
  const nowHour = now.getHours();

  const _effectiveHour = (schedHour, isDone) => {
    if (isToday && !isDone && schedHour != null && schedHour < nowHour) return nowHour;
    return schedHour;
  };

  if (typeof habits !== 'undefined') {
    habits.forEach(h => {
      if (typeof isHabitActiveOnDate === 'function' && !isHabitActiveOnDate(h, dateStr)) return;
      const times = _parseHabitTimes(h);
      const doneCount = h.doneCounts?.[dateStr] || 0;
      const target = h.target_count || 1;
      times.forEach((t, idx) => {
        const schedHour = _itemHour(t);
        const isDone = idx < doneCount;
        const eff = _effectiveHour(schedHour, isDone);
        if (eff !== hour) return;
        const rolled = eff !== schedHour;
        const suffix = target > 1 ? ` (${idx + 1}/${target})` : '';
        out.push({
          kind: 'habit',
          id: h.id,
          icon: h.icon || '•',
          name: h.name + suffix,
          time: rolled ? `${String(eff).padStart(2,'0')}:00` : t,
          done: isDone,
          durationMin: h.duration_minutes || 60,
        });
      });
    });
  }
  if (typeof todos !== 'undefined') {
    todos.forEach(t => {
      const isForDate = t.due_date === dateStr;
      // On today's view, also roll in overdue scheduled todos from previous days
      const isOverdueForToday = isToday && !t.completed && t.due_date && t.due_date < dateStr;
      if (!isForDate && !isOverdueForToday) return;
      if (!t.scheduled_time) return;
      // Overdue items get rolled to the current hour (they've already "passed")
      const schedHour = isOverdueForToday ? nowHour : _itemHour(t.scheduled_time);
      const isDone = !!t.completed;
      const eff = _effectiveHour(schedHour, isDone);
      if (eff !== hour) return;
      const rolled = isOverdueForToday || eff !== schedHour;
      out.push({
        kind: 'todo',
        id: t.id,
        icon: '○',
        name: t.name,
        time: rolled ? `${String(eff).padStart(2,'0')}:00` : t.scheduled_time,
        done: isDone,
        durationMin: 60,
      });
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
let _calendarRefreshTimer = null;

function renderCalendar() {
  const container = document.getElementById('calendar-container');
  if (!container) return;
  container.innerHTML = _calendarView === 'day' ? renderDayView() : renderMonthView();

  // Auto-scroll the day view to current hour on render
  if (_calendarView === 'day' && _calendarDayStr === (_localToday())) {
    setTimeout(() => {
      const nowEl = document.querySelector('.cal-now-line');
      if (nowEl && nowEl.scrollIntoView) nowEl.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, 50);
  }

  // Auto-refresh every minute on today's day view so undone items roll
  // forward as the current hour advances.
  if (_calendarRefreshTimer) { clearTimeout(_calendarRefreshTimer); _calendarRefreshTimer = null; }
  if (_calendarView === 'day' && _calendarDayStr === _localToday()) {
    _calendarRefreshTimer = setTimeout(renderCalendar, 60 * 1000);
  }
}
window.renderCalendar = renderCalendar;

// Re-render whichever calendar surface is currently visible — the main tab
// (if it still exists) and the Goals sidebar variant. Used after any user
// action that changes data so the visual stays in sync.
function _refreshCalendarUI() {
  if (document.getElementById('calendar-container')) renderCalendar();
  const panel = document.getElementById('panel-calendar-content');
  if (panel && panel.style.display !== 'none' && typeof renderCalendarSidebar === 'function') {
    renderCalendarSidebar();
  }
}
window._refreshCalendarUI = _refreshCalendarUI;

// ──────────────────────────────────────────────
//  SIDEBAR variant — renders into #panel-calendar-content for the Goals tab
//  Day timeline at top, eventually/unscheduled todos below.
// ──────────────────────────────────────────────
function renderCalendarSidebar() {
  const container = document.getElementById('panel-calendar-content');
  if (!container) return;

  let html = '<div class="cal-sidebar-wrap">';
  if (_pickMode) {
    html += `<div class="cal-pick-banner">
      <div class="cal-pick-text">Choose an hour for<br><strong>${escHtml(_pickMode.name)}</strong></div>
      <button class="cal-pick-skip" onclick="cancelPickMode()">Skip</button>
    </div>`;
  }
  html += `<div class="cal-sidebar-timeline ${_pickMode ? 'is-picking' : ''}">${renderDayView(_sidebarDayStr, 'sidebar')}</div>`;
  html += `<div class="cal-sidebar-bottom">${renderSidebarUnscheduled()}</div>`;
  html += '</div>';
  container.innerHTML = html;

  // Scroll the inner TIMELINE to the now-line, not the outer container
  // (so the bottom todo section stays visible at the bottom).
  setTimeout(() => {
    const timeline = container.querySelector('.cal-sidebar-timeline');
    const nowEl = timeline && timeline.querySelector('.cal-now-line');
    if (timeline && nowEl) {
      // Scroll the timeline panel so the now-line is near the top
      const top = nowEl.offsetTop - 60; // small lead-in so the prior hour shows
      timeline.scrollTop = Math.max(0, top);
    }
  }, 30);

  // Auto-refresh sidebar every minute so rolled-forward items advance
  if (_calendarRefreshTimer) { clearTimeout(_calendarRefreshTimer); _calendarRefreshTimer = null; }
  _calendarRefreshTimer = setTimeout(() => {
    if (document.getElementById('panel-calendar-content')?.style.display !== 'none') {
      renderCalendarSidebar();
    }
  }, 60 * 1000);
}
window.renderCalendarSidebar = renderCalendarSidebar;

function renderSidebarUnscheduled() {
  const today = _localToday();
  const todayTodos = (typeof todos !== 'undefined' ? todos : [])
    .filter(t => !t.completed && t.due_date === today && !t.scheduled_time);
  const eventually = (typeof todos !== 'undefined' ? todos : [])
    .filter(t => !t.completed && !t.due_date && t.type !== 'streak');

  let html = '<div class="cal-side-todos">';

  if (todayTodos.length > 0) {
    html += '<div class="cal-side-section">';
    html += '<div class="cal-side-label">Drag to schedule</div>';
    todayTodos.forEach(t => {
      html += renderSideTodoRow(t);
    });
    html += '</div>';
  }

  if (eventually.length > 0) {
    html += '<div class="cal-side-section">';
    html += '<div class="cal-side-label">Eventually</div>';
    eventually.forEach(t => {
      html += renderSideTodoRow(t);
    });
    html += '</div>';
  }

  if (todayTodos.length === 0 && eventually.length === 0) {
    html += '<div class="cal-side-empty">No unscheduled todos. Use the + button to add one.</div>';
  }

  html += '</div>';
  return html;
}

function renderSideTodoRow(t) {
  return `<div class="cal-side-todo"
       draggable="true"
       data-kind="todo"
       data-id="${t.id}"
       ondragstart="calDragStart(event)"
       ondragend="calDragEnd(event)"
       onclick="calendarEditItem('todo','${t.id}')">
    <span class="cal-side-drag" aria-hidden="true">⋮⋮</span>
    <span class="cal-side-icon">○</span>
    <span class="cal-side-name">${escHtml(t.name)}</span>
    <button class="cal-side-del" onclick="event.stopPropagation(); withConfirm(event.currentTarget, () => calendarDeleteItem('todo','${t.id}'))" aria-label="Delete">✕</button>
  </div>`;
}

// ──────────────────────────────────────────────
//  DAY VIEW (now parameterised)
// ──────────────────────────────────────────────
function renderDayView(dateStr, context = 'main') {
  const dStr = dateStr ?? (context === 'sidebar' ? _sidebarDayStr : _calendarDayStr);
  const d = new Date(dStr + 'T00:00:00');
  const today = _localToday();
  const isToday = dStr === today;
  const weekday = _DAY_NAMES[d.getDay()];
  const monthName = _CAL_MONTHS[d.getMonth()];

  let html = '<div class="cal-day-wrap">';

  // Header / toolbar
  if (context === 'sidebar') {
    html += `<div class="cal-day-header">
      <button class="cal-nav-btn" onclick="calendarSidebarPrevDay()" aria-label="Previous day">‹</button>
      <button class="cal-day-title" onclick="calendarGoToToday()" title="Jump to today">
        <span class="cal-day-weekday">${weekday}</span>
        <span class="cal-day-date">${monthName} ${d.getDate()}, ${d.getFullYear()}</span>
      </button>
      <button class="cal-nav-btn" onclick="calendarSidebarNextDay()" aria-label="Next day">›</button>
      <button class="cal-view-toggle" style="display:none;"></button>
    </div>`;
  } else {
    html += `<div class="cal-day-header">
      <button class="cal-nav-btn" onclick="calendarPrevDay()" aria-label="Previous day">‹</button>
      <button class="cal-day-title" onclick="calendarGoToToday()" title="Jump to today">
        <span class="cal-day-weekday">${weekday}</span>
        <span class="cal-day-date">${monthName} ${d.getDate()}, ${d.getFullYear()}</span>
      </button>
      <button class="cal-nav-btn" onclick="calendarNextDay()" aria-label="Next day">›</button>
      <button class="cal-view-toggle" onclick="calendarSetView('month')" title="Month view">▦</button>
    </div>`;
  }

  // Timeline
  html += '<div class="cal-timeline">';
  const now = new Date();
  const nowHour = now.getHours();

  for (let h = _DAY_START_HOUR; h < _DAY_END_HOUR; h++) {
    const items = _getHourItems(dStr, h);
    const showNow = isToday && h === nowHour;

    html += `<div class="cal-hour-row">
      <div class="cal-hour-label">${_formatHour(h)}</div>
      <div class="cal-hour-slot"
           data-hour="${h}"
           ondragover="calDragOver(event)"
           ondragenter="calDragEnter(event)"
           ondragleave="calDragLeave(event)"
           ondrop="calDrop(event)"
           onclick="if (_pickMode) calPickHour(${h})">
        ${showNow ? `<div class="cal-now-line"></div>` : ''}
        ${items.map(it => {
          const hours = Math.max(1, Math.round((it.durationMin || 60) / 60));
          const isMulti = hours > 1;
          const heightPx = hours * 56 - 8;
          const style = isMulti ? ` style="height:${heightPx}px;"` : '';
          return `
          <div class="cal-event ${it.kind} ${it.done ? 'done' : ''} ${isMulti ? 'multi-hour' : ''}"
               draggable="true"
               data-kind="${it.kind}"
               data-id="${it.id}"
               data-hours="${hours}"
               ${style}
               ondragstart="calDragStart(event)"
               ondragend="calDragEnd(event)"
               onclick="event.stopPropagation(); calendarToggleDone('${it.kind}', '${it.id}', event.currentTarget)">
            <button class="cal-event-tick ${it.done ? 'on' : ''}" onclick="event.stopPropagation(); calendarToggleDone('${it.kind}', '${it.id}', event.currentTarget)" aria-label="Toggle done">${it.done ? '✓' : ''}</button>
            <span class="cal-event-time">${it.time.slice(0,5)}${isMulti ? ` · ${hours}h` : ''}</span>
            <span class="cal-event-icon">${it.icon}</span>
            <span class="cal-event-name">${escHtml(it.name)}</span>
            <button class="cal-event-edit" onclick="event.stopPropagation(); calendarEditItem('${it.kind}', '${it.id}')" aria-label="Edit"><svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            <button class="cal-event-del" onclick="event.stopPropagation(); withConfirm(event.currentTarget, () => calendarDeleteItem('${it.kind}', '${it.id}'))" aria-label="Delete">✕</button>
          </div>
        `;}).join('')}
      </div>
    </div>`;
  }
  html += '</div>';

  // Hint when the day is empty
  const dayHasItems = (typeof habits !== 'undefined' && habits.some(h => _parseHabitTimes(h).length > 0)) ||
                      (typeof todos !== 'undefined' && todos.some(t => t.due_date === dStr && t.scheduled_time));
  if (!dayHasItems) {
    html += '<div class="cal-empty-hint">Drag a todo from the side panel into an hour to schedule it.</div>';
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
  const today = _localToday();

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
  _refreshCalendarUI();
}
window.calendarSetView = calendarSetView;

function calendarOpenDay(dStr) {
  _calendarDayStr = dStr;
  _calendarView = 'day';
  haptic && haptic([10]);
  _refreshCalendarUI();
}
window.calendarOpenDay = calendarOpenDay;

function calendarPrevDay() {
  _calendarDayStr = _addDays(_calendarDayStr, -1);
  haptic && haptic([8]);
  _refreshCalendarUI();
}
function calendarNextDay() {
  _calendarDayStr = _addDays(_calendarDayStr, 1);
  haptic && haptic([8]);
  _refreshCalendarUI();
}
window.calendarPrevDay = calendarPrevDay;
window.calendarNextDay = calendarNextDay;

function calendarPrevMonth() {
  _calendarMonth.setMonth(_calendarMonth.getMonth() - 1);
  haptic && haptic([8]);
  _refreshCalendarUI();
}
function calendarNextMonth() {
  _calendarMonth.setMonth(_calendarMonth.getMonth() + 1);
  haptic && haptic([8]);
  _refreshCalendarUI();
}
window.calendarPrevMonth = calendarPrevMonth;
window.calendarNextMonth = calendarNextMonth;

function calendarGoToToday() {
  const today = _localToday();
  _calendarDayStr = today;
  _sidebarDayStr = today;
  _calendarMonth = new Date();
  _calendarMonth.setDate(1);
  haptic && haptic([12]);
  _refreshCalendarUI();
  renderCalendarSidebar();
}
window.calendarGoToToday = calendarGoToToday;

// ── SIDEBAR‑SPECIFIC NAVIGATION ─────────────
function calendarSidebarPrevDay() {
  _sidebarDayStr = _addDays(_sidebarDayStr, -1);
  haptic && haptic([8]);
  renderCalendarSidebar();
}
window.calendarSidebarPrevDay = calendarSidebarPrevDay;

function calendarSidebarNextDay() {
  _sidebarDayStr = _addDays(_sidebarDayStr, 1);
  haptic && haptic([8]);
  renderCalendarSidebar();
}
window.calendarSidebarNextDay = calendarSidebarNextDay;

function calendarEditItem(kind, id) {
  haptic && haptic([10]);
  if (kind === 'habit' && typeof openHabitEditModal === 'function') openHabitEditModal(id);
  else if (kind === 'todo' && typeof openTodoEditModal === 'function') openTodoEditModal(id);
}
window.calendarEditItem = calendarEditItem;

async function calendarDeleteItem(kind, id) {
  haptic && haptic([25, 15]);
  if (kind === 'todo' && typeof deleteTodo === 'function') {
    await deleteTodo(id);
  } else if (kind === 'habit' && typeof deleteHabit === 'function') {
    await deleteHabit(id);
  }
  setTimeout(_refreshCalendarUI, 80);
}
window.calendarDeleteItem = calendarDeleteItem;

// Toggle an item's done state for the currently-viewed day. For habits, we
// only let the user toggle on today (since habit completions are date-bound
// and the activeDate matters); for todos, toggleTodo just flips a flag.
async function calendarToggleDone(kind, id, sourceEl) {
  if (_pickMode) return; // don't allow toggling while user is picking a time slot
  const today = _localToday();
  // Find current done state BEFORE the toggle so we know whether to fire particles
  let wasDone = false;
  if (kind === 'todo') {
    const t = (typeof todos !== 'undefined' ? todos.find(x => x.id === id) : null);
    wasDone = !!(t && t.completed);
  } else if (kind === 'habit') {
    const h = (typeof habits !== 'undefined' ? habits.find(x => x.id === id) : null);
    if (h) {
      const dc = h.doneCounts?.[today] || 0;
      wasDone = dc >= (h.target_count || 1);
    }
  }
  haptic && haptic(wasDone ? [10] : [25, 40]);
  if (kind === 'todo') {
    if (typeof toggleTodo === 'function') toggleTodo(id);
    if (!wasDone) _burstFromEvent(sourceEl);
    setTimeout(_refreshCalendarUI, 80);
    return;
  }
  if (kind === 'habit') {
    if (_calendarDayStr !== today) {
      showToast('Habits can only be ticked off on the day they happen');
      return;
    }
    if (typeof toggleHabit === 'function') toggleHabit(id);
    if (!wasDone) _burstFromEvent(sourceEl);
    setTimeout(_refreshCalendarUI, 80);
  }
}

// ──────────────────────────────────────────────
//  HOUR PICKER — sidebar-interactive mode after creating a todo/habit.
//  The rest of the app is locked behind a dim/blur overlay; only the
//  sidebar timeline is clickable. Click an hour slot → schedule there.
// ──────────────────────────────────────────────
let _pickMode = null; // { kind, id, name, callback } or null

function showHourPicker(itemName, callback, opts) {
  // opts: { kind, id } — required so we know what to schedule on click
  if (!opts || !opts.kind || !opts.id) { if (callback) callback(null); return; }
  // On screens without the sidebar, fall back to skipping
  const sidebarPanel = document.getElementById('panel-calendar-content');
  const sidebarVisible = sidebarPanel && sidebarPanel.style.display !== 'none' && sidebarPanel.offsetParent !== null;
  if (!sidebarVisible) { if (callback) callback(null); return; }

  _pickMode = { kind: opts.kind, id: opts.id, name: itemName || '', callback };
  document.body.classList.add('cal-picking');
  haptic && haptic([15]);
  renderCalendarSidebar();
}
window.showHourPicker = showHourPicker;

function _endPickMode(time) {
  if (!_pickMode) return;
  const cb = _pickMode.callback;
  _pickMode = null;
  document.body.classList.remove('cal-picking');
  if (cb) cb(time);
  renderCalendarSidebar();
}

function cancelPickMode() { _endPickMode(null); }
window.cancelPickMode = cancelPickMode;

// Click handler for hour slots in pick mode. Wired via calDrop's neighbour:
// renderDayView gives slots an onclick when _pickMode is active.
function calPickHour(hour) {
  const time = `${String(hour).padStart(2,'0')}:00`;
  _endPickMode(time);
}
window.calPickHour = calPickHour;

// ESC cancels pick mode
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _pickMode) cancelPickMode();
});

function _burstFromEvent(el) {
  if (typeof burstFromEl !== 'function') return;
  // If we got a click target inside a card, walk up to the card itself
  let card = el;
  while (card && !card.classList?.contains('cal-event')) card = card.parentElement;
  if (!card) card = el || document.querySelector('.cal-sidebar-timeline');
  if (card) burstFromEl(card, 40, true);
}
window.calendarToggleDone = calendarToggleDone;

// Click on empty hour slot to add an item at that hour
function calendarAllocatePrompt(dStr, hour) {
  // Reserved — empty slots accept drops, no click action yet
}
window.calendarAllocatePrompt = calendarAllocatePrompt;

// ──────────────────────────────────────────────
//  Drag and drop
// ──────────────────────────────────────────────
let _calDraggedItem = null; // { kind, id }

function calDragStart(e) {
  const el = e.currentTarget;
  const kind = el.dataset.kind;
  const id = el.dataset.id;
  if (!kind || !id) return;
  _calDraggedItem = { kind, id };
  el.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', `${kind}:${id}`);
}
function calDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.cal-hour-slot.drop-over').forEach(el => el.classList.remove('drop-over'));
  _calDraggedItem = null;
}
function calDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
}
function calDragEnter(e) {
  // Accept drag from calendar's own items OR from the existing todo side panel
  const hasExternal = (typeof draggedItemId !== 'undefined' && draggedItemId);
  if (!_calDraggedItem && !hasExternal) return;
  document.querySelectorAll('.cal-hour-slot.drop-over').forEach(el => el.classList.remove('drop-over'));
  e.currentTarget.classList.add('drop-over');
}
function calDragLeave(e) {
  // Only clear if leaving the slot (not entering a child)
  if (!e.currentTarget.contains(e.relatedTarget)) {
    e.currentTarget.classList.remove('drop-over');
  }
}
async function calDrop(e) {
  e.preventDefault();
  e.stopPropagation();
  const slot = e.currentTarget;
  const hourStr = slot.dataset.hour;
  slot.classList.remove('drop-over');

  // Resolve dragged item from EITHER source:
  //  - the calendar's own drag (_calDraggedItem)
  //  - the existing todo-side-panel drag globals (draggedItemId/draggedItemType)
  let kind = null, id = null;
  if (_calDraggedItem) {
    kind = _calDraggedItem.kind;
    id   = _calDraggedItem.id;
  } else if (typeof draggedItemId !== 'undefined' && draggedItemId) {
    kind = (typeof draggedItemType !== 'undefined' && draggedItemType) ? draggedItemType : 'todo';
    id   = draggedItemId;
  }
  _calDraggedItem = null;
  if (!kind || !id || hourStr == null) return;

  const time = `${String(hourStr).padStart(2,'0')}:00`;
  await _allocateItemAtTime(kind, id, _calendarDayStr, time);
}
window.calDragStart = calDragStart;
window.calDragEnd = calDragEnd;
window.calDragOver = calDragOver;
window.calDragEnter = calDragEnter;
window.calDragLeave = calDragLeave;
window.calDrop = calDrop;

async function _allocateItemAtTime(kind, id, dStr, time) {
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
      const target = h.target_count || 1;
      let times = _parseHabitTimes(h);
      if (times.length < target) {
        // Still has room for more instances — append this one
        times.push(time);
      } else {
        // Already at target — replace the first instance with the new time
        times[0] = time;
      }
      times.sort();
      const newSched = times.length === 1 ? times[0] : JSON.stringify(times);
      h.scheduled_time = newSched;
      await supabase.from('habits').eq('id', id).update({ scheduled_time: newSched });
    }
    haptic && haptic([15, 10]);
    _refreshCalendarUI();
    if (typeof renderTodo === 'function') renderTodo();
  } catch (e) {
    console.error('allocate failed', e);
    showToast('Save failed');
  }
}
// Re-route the existing prompt-based allocator through the same DB path
async function calendarAllocateItem(kind, id, dStr) {
  haptic && haptic([12]);
  const inp = window.prompt('What time? (HH:MM, 24-hour)', '09:00');
  if (!inp) return;
  const m = inp.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) { showToast('Use HH:MM format'); return; }
  const time = `${m[1].padStart(2,'0')}:${m[2]}`;
  await _allocateItemAtTime(kind, id, dStr, time);
}
window.calendarAllocateItem = calendarAllocateItem;