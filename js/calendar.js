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

// Get items (habits + todos) scheduled at a given hour on a date
function _getHourItems(dateStr, hour) {
  const out = [];
  if (typeof habits !== 'undefined') {
    habits.forEach(h => {
      if (typeof isHabitActiveOnDate === 'function' && !isHabitActiveOnDate(h, dateStr)) return;
      const times = _parseHabitTimes(h);
      const doneCount = h.doneCounts?.[dateStr] || 0;
      const target = h.target_count || 1;
      times.forEach((t, idx) => {
        if (_itemHour(t) === hour) {
          // For multi-instance habits, instances are marked done in order:
          // doneCount=1 → first instance done; doneCount=2 → first two done; etc.
          const isDone = idx < doneCount;
          const suffix = target > 1 ? ` (${idx + 1}/${target})` : '';
          out.push({
            kind: 'habit',
            id: h.id,
            icon: h.icon || '•',
            name: h.name + suffix,
            time: t,
            done: isDone,
            durationMin: h.duration_minutes || 60,
          });
        }
      });
    });
  }
  if (typeof todos !== 'undefined') {
    todos.forEach(t => {
      if (t.due_date !== dateStr) return;
      if (!t.scheduled_time) return;
      if (_itemHour(t.scheduled_time) === hour) {
        out.push({ kind: 'todo', id: t.id, icon: '○', name: t.name, time: t.scheduled_time, done: !!t.completed, durationMin: 60 });
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
  if (_calendarView === 'day' && _calendarDayStr === (_localToday())) {
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
  const today = _localToday();
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
      <div class="cal-hour-slot"
           data-hour="${h}"
           ondragover="calDragOver(event)"
           ondragenter="calDragEnter(event)"
           ondragleave="calDragLeave(event)"
           ondrop="calDrop(event)">
        ${showNow ? `<div class="cal-now-line" style="top:${minPct}%"></div>` : ''}
        ${items.map(it => {
          const hours = Math.max(1, Math.round((it.durationMin || 60) / 60));
          const isMulti = hours > 1;
          // Each hour row is 56px tall; height = hours*56 minus a touch of breathing room
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
               onclick="event.stopPropagation(); calendarToggleDone('${it.kind}', '${it.id}')">
            <button class="cal-event-tick ${it.done ? 'on' : ''}" onclick="event.stopPropagation(); calendarToggleDone('${it.kind}', '${it.id}')" aria-label="Toggle done">${it.done ? '✓' : ''}</button>
            <span class="cal-event-time">${it.time.slice(0,5)}${isMulti ? ` · ${hours}h` : ''}</span>
            <span class="cal-event-icon">${it.icon}</span>
            <span class="cal-event-name">${escHtml(it.name)}</span>
            <button class="cal-event-edit" onclick="event.stopPropagation(); calendarEditItem('${it.kind}', '${it.id}')" aria-label="Edit"><svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          </div>
        `;}).join('')}
      </div>
    </div>`;
  }
  html += '</div>';

  // Hint when the day is empty
  const hasAnyEvent = items => true; // placeholder for future use
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
  const today = _localToday();
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

// Toggle an item's done state for the currently-viewed day. For habits, we
// only let the user toggle on today (since habit completions are date-bound
// and the activeDate matters); for todos, toggleTodo just flips a flag.
async function calendarToggleDone(kind, id) {
  const today = _localToday();
  haptic && haptic([15]);
  if (kind === 'todo') {
    if (typeof toggleTodo === 'function') toggleTodo(id);
    setTimeout(() => renderCalendar(), 80);
    return;
  }
  if (kind === 'habit') {
    if (_calendarDayStr !== today) {
      showToast('Habits can only be ticked off on the day they happen');
      return;
    }
    if (typeof toggleHabit === 'function') toggleHabit(id);
    setTimeout(() => renderCalendar(), 80);
  }
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
    renderCalendar();
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
