// ─────────────────────────────────────────────
//  DATE NAVIGATION
// ─────────────────────────────────────────────
function offsetActiveDate(days) {
  activeDate.setDate(activeDate.getDate() + days);
  haptic([15]);
  updateDateDisplay();
  renderJournalEntries();
}

function setActiveDate(dStr) {
  activeDate = new Date(dStr + 'T00:00:00');
  updateDateDisplay();
  if (isCalendarView) toggleCalendarView(); // close picker (only if it's open)
  renderJournalEntries();
  haptic([20, 10, 20]);
}

function updateDateDisplay() {
  const tStr = todayStr(), aStr = getActiveDateStr(); let pre = '';
  if (aStr === tStr) pre = 'Today, ';
  else {
    const diff = Math.round((new Date(activeDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000);
    if (diff === 1) pre = 'Tomorrow, ';
    if (diff === -1) pre = 'Yesterday, ';
  }
  document.getElementById('header-date').textContent = pre + activeDate.toLocaleDateString('en-US', { month:'short', day:'numeric' });
}

function toggleCalendarView() {
  isCalendarView = !isCalendarView;
  const calView = document.getElementById('calendar-view');
  const headerDate = document.getElementById('header-date');
  if (isCalendarView) {
    calDate = new Date(activeDate);
    renderCalendarGrid();
    if (calView) calView.style.display = 'flex';
    if (headerDate) headerDate.classList.add('active');
  } else {
    if (calView) calView.style.display = 'none';
    if (headerDate) headerDate.classList.remove('active');
  }
  haptic([15]);
}

// ─────────────────────────────────────────────
//  CALENDAR
// ─────────────────────────────────────────────
function renderCalendarGrid() {
  const y = calDate.getFullYear(), m = calDate.getMonth();
  document.getElementById('cal-month-year').textContent = `${["January","February","March","April","May","June","July","August","September","October","November","December"][m]} ${y}`;
  const grid = document.getElementById('calendar-grid'); grid.innerHTML = '';
  for (let i = 0; i < new Date(y, m, 1).getDay(); i++) grid.innerHTML += `<div class="cal-day empty"></div>`;
  const today = todayStr(), act = getActiveDateStr(), days = new Date(y, m + 1, 0).getDate();
  // Dot on days that have journal entries
  const entries = (typeof getJournalEntries === 'function') ? getJournalEntries() : [];
  for (let d = 1; d <= days; d++) {
    const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dots = entries.some(e => e.created_at && e.created_at.slice(0, 10) === dStr)
      ? '<div class="cal-dot done"></div>' : '';
    const el = document.createElement('div');
    el.className = `cal-day ${dStr === today ? 'today' : ''} ${dStr === act ? 'selected' : ''}`;
    el.onclick = () => setActiveDate(dStr);
    el.style.animationDelay = `${(d%7)*25 + Math.floor(d/7)*25}ms`;
    el.innerHTML = `<div class="cal-day-num">${d}</div><div class="cal-day-dots">${dots}</div>`;
    grid.appendChild(el);
  }
}

function prevMonth() { calDate.setMonth(calDate.getMonth() - 1); renderCalendarGrid(); haptic([10]); }
function nextMonth() { calDate.setMonth(calDate.getMonth() + 1); renderCalendarGrid(); haptic([10]); }
