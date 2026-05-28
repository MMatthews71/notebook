// ─────────────────────────────────────────────
//  CALENDAR TAB
//  A month grid with rich per-day cells showing:
//   • How many habits were done that day vs scheduled
//   • Todos due that day (dots, colored by completion)
//   • A 📓 if there's a journal entry for that day
//   • A 🎯 if the week's ONE Thing was checked-off on that day
//   • A ∞ for maintenance-flagged weekly goals
//  Tap any day → opens a Day Detail panel with everything.
// ─────────────────────────────────────────────

let _calendarMonth = new Date(); // first of the month being viewed
_calendarMonth.setDate(1);
let _selectedDayStr = null;      // YYYY-MM-DD of day in detail view, or null

const _CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const _CAL_WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function _calIsSameDay(d, dStr) {
  return d.toISOString().slice(0,10) === dStr;
}

function _calDateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
}

function _calHabitsForDate(dStr) {
  if (typeof habits === 'undefined') return { scheduled: [], done: [] };
  const scheduled = habits.filter(h => {
    if (typeof isHabitActiveOnDate === 'function') return isHabitActiveOnDate(h, dStr);
    return true;
  });
  const done = scheduled.filter(h => (h.doneCounts?.[dStr] || 0) >= (h.target_count || 1));
  return { scheduled, done };
}

function _calTodosForDate(dStr) {
  if (typeof todos === 'undefined') return [];
  return todos.filter(t => t.due_date === dStr);
}

function _calJournalForDate(dStr) {
  // journal entries cached by date if available
  if (typeof window._journalEntriesCache === 'object' && window._journalEntriesCache) {
    const entries = window._journalEntriesCache.filter(j => (j.entry_date || (j.created_at && j.created_at.slice(0,10))) === dStr);
    return entries;
  }
  return [];
}

function renderCalendar() {
  const container = document.getElementById('calendar-container');
  if (!container) return;

  const y = _calendarMonth.getFullYear();
  const m = _calendarMonth.getMonth();
  const today = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10);

  // Header
  let html = '<div class="cal-wrap">';
  html += `<div class="cal-toolbar">
    <button class="cal-nav-btn" onclick="calendarPrevMonth()" aria-label="Previous month">‹</button>
    <button class="cal-month-title" onclick="calendarToToday()" title="Jump to today">${_CAL_MONTHS[m]} ${y}</button>
    <button class="cal-nav-btn" onclick="calendarNextMonth()" aria-label="Next month">›</button>
  </div>`;

  // Weekday header row
  html += '<div class="cal-weekdays">';
  _CAL_WEEKDAYS.forEach(w => { html += `<div class="cal-wd">${w}</div>`; });
  html += '</div>';

  // Day grid
  html += '<div class="cal-grid">';
  const firstDay = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();

  // Leading empties
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day-empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = _calDateStr(y, m, d);
    const isToday = dStr === today;
    const isFuture = dStr > today;
    const isSelected = dStr === _selectedDayStr;

    const { scheduled, done } = _calHabitsForDate(dStr);
    const dayTodos = _calTodosForDate(dStr);
    const journals = _calJournalForDate(dStr);

    const totalHabits = scheduled.length;
    const doneHabits = done.length;
    const habitsPct = totalHabits > 0 ? Math.round((doneHabits / totalHabits) * 100) : 0;

    const todosOpen = dayTodos.filter(t => !t.completed).length;
    const todosDone = dayTodos.filter(t => t.completed).length;

    // Visual intensity for habit completion
    let dayClass = '';
    if (!isFuture && totalHabits > 0) {
      if (habitsPct >= 100) dayClass = 'full';
      else if (habitsPct >= 67) dayClass = 'high';
      else if (habitsPct >= 34) dayClass = 'mid';
      else if (doneHabits > 0) dayClass = 'low';
    }

    let badges = '';
    if (journals.length > 0) badges += '<span class="cal-badge">📓</span>';
    if (todosOpen > 0) badges += `<span class="cal-badge open">${todosOpen}</span>`;
    if (todosDone > 0 && todosOpen === 0) badges += '<span class="cal-badge done">✓</span>';

    // Habit dots (max 5)
    let dotsHtml = '';
    if (totalHabits > 0 && !isFuture) {
      const dotCount = Math.min(totalHabits, 5);
      for (let i = 0; i < dotCount; i++) {
        const isDoneDot = i < doneHabits;
        dotsHtml += `<span class="cal-hdot ${isDoneDot ? 'done' : ''}"></span>`;
      }
    }

    html += `<div class="cal-day ${dayClass} ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${isFuture ? 'is-future' : ''}" onclick="openCalendarDay('${dStr}')">
      <div class="cal-day-num">${d}</div>
      <div class="cal-day-dots">${dotsHtml}</div>
      <div class="cal-day-badges">${badges}</div>
    </div>`;
  }

  html += '</div>';

  // Day detail panel (shown when a day is selected)
  if (_selectedDayStr) {
    html += renderCalendarDayDetail(_selectedDayStr);
  }

  html += '</div>';
  container.innerHTML = html;
}

function renderCalendarDayDetail(dStr) {
  const dateObj = new Date(dStr + 'T00:00:00');
  const weekday = dateObj.toLocaleDateString('default', { weekday: 'long' });
  const monthName = _CAL_MONTHS[dateObj.getMonth()];
  const day = dateObj.getDate();
  const today = typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0,10);
  const isToday = dStr === today;
  const isPast = dStr < today;

  const { scheduled, done } = _calHabitsForDate(dStr);
  const dayTodos = _calTodosForDate(dStr);
  const journals = _calJournalForDate(dStr);

  let html = '<div class="cal-detail">';
  html += `<div class="cal-detail-header">
    <button class="cal-detail-close" onclick="closeCalendarDay()" aria-label="Close">×</button>
    <div class="cal-detail-title">
      <div class="cal-detail-weekday">${weekday}</div>
      <div class="cal-detail-date">${monthName} ${day}${isToday ? ' · Today' : ''}</div>
    </div>
  </div>`;

  // Habits section
  if (scheduled.length > 0) {
    html += `<div class="cal-detail-section">
      <div class="cal-detail-label">Habits <span class="cal-detail-count">${done.length}/${scheduled.length}</span></div>
      <div class="cal-detail-list">`;
    scheduled.forEach(h => {
      const isDone = (h.doneCounts?.[dStr] || 0) >= (h.target_count || 1);
      html += `<div class="cal-detail-row ${isDone ? 'done' : ''}">
        <span class="cal-detail-icon">${h.icon || '•'}</span>
        <span class="cal-detail-name">${escHtml(h.name)}</span>
        <span class="cal-detail-mark">${isDone ? '✓' : ''}</span>
      </div>`;
    });
    html += '</div></div>';
  }

  // Todos
  if (dayTodos.length > 0) {
    html += `<div class="cal-detail-section">
      <div class="cal-detail-label">To-dos <span class="cal-detail-count">${dayTodos.filter(t => t.completed).length}/${dayTodos.length}</span></div>
      <div class="cal-detail-list">`;
    dayTodos.forEach(t => {
      html += `<div class="cal-detail-row ${t.completed ? 'done' : ''}" onclick="event.stopPropagation(); if (typeof openTodoEditModal==='function') openTodoEditModal('${t.id}')">
        <span class="cal-detail-icon">○</span>
        <span class="cal-detail-name">${escHtml(t.name)}</span>
        <span class="cal-detail-mark">${t.completed ? '✓' : ''}</span>
      </div>`;
    });
    html += '</div></div>';
  }

  // Journal preview
  if (journals.length > 0) {
    html += `<div class="cal-detail-section">
      <div class="cal-detail-label">Journal</div>
      <div class="cal-detail-list">`;
    journals.forEach(j => {
      const preview = (j.title || (j.content || '').slice(0, 80) || 'Untitled').replace(/[<>]/g, '');
      html += `<div class="cal-detail-row journal">
        <span class="cal-detail-icon">📓</span>
        <span class="cal-detail-name">${escHtml(preview)}</span>
      </div>`;
    });
    html += '</div></div>';
  }

  // If nothing's there, show empty hint
  if (scheduled.length === 0 && dayTodos.length === 0 && journals.length === 0) {
    html += `<div class="cal-detail-empty">${isPast ? 'No activity logged.' : isToday ? 'Today is open. Time to fill it.' : 'Nothing scheduled yet.'}</div>`;
  }

  // Navigate to that day in the main app
  if (typeof setActiveDate === 'function') {
    html += `<div class="cal-detail-actions">
      <button class="cal-detail-jump" onclick="calendarJumpToDay('${dStr}')">Open ${isToday ? 'Today' : 'this day'} in To-do →</button>
    </div>`;
  }

  html += '</div>';
  return html;
}

function openCalendarDay(dStr) {
  _selectedDayStr = _selectedDayStr === dStr ? null : dStr;
  haptic && haptic([10]);
  renderCalendar();
}
window.openCalendarDay = openCalendarDay;

function closeCalendarDay() {
  _selectedDayStr = null;
  renderCalendar();
}
window.closeCalendarDay = closeCalendarDay;

function calendarPrevMonth() {
  _calendarMonth.setMonth(_calendarMonth.getMonth() - 1);
  haptic && haptic([8]);
  renderCalendar();
}
window.calendarPrevMonth = calendarPrevMonth;

function calendarNextMonth() {
  _calendarMonth.setMonth(_calendarMonth.getMonth() + 1);
  haptic && haptic([8]);
  renderCalendar();
}
window.calendarNextMonth = calendarNextMonth;

function calendarToToday() {
  _calendarMonth = new Date();
  _calendarMonth.setDate(1);
  haptic && haptic([12]);
  renderCalendar();
}
window.calendarToToday = calendarToToday;

function calendarJumpToDay(dStr) {
  if (typeof setActiveDate === 'function') setActiveDate(dStr);
  if (typeof switchTab === 'function') switchTab('todo');
  haptic && haptic([15, 10]);
}
window.calendarJumpToDay = calendarJumpToDay;
window.renderCalendar = renderCalendar;
