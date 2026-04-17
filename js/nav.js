// ─────────────────────────────────────────────
//  DATE NAVIGATION
// ─────────────────────────────────────────────
function offsetActiveDate(days) {
  activeDate.setDate(activeDate.getDate() + days);
  haptic([15]);
  updateDateDisplay();
  renderTodo();
  if (currentTab === 'goals') renderGoals();
  // Refresh panel date if on desktop
  if (typeof renderPanelDateNavigator === 'function' && isDesktop && isDesktop()) {
    renderPanelDateNavigator();
  }
}

function setActiveDate(dStr) {
  activeDate = new Date(dStr + 'T00:00:00');
  updateDateDisplay();
  renderTodo();
  if (currentTab === 'goals') renderGoals();
  toggleCalendarView();
  haptic([20, 10, 20]);
  if (typeof renderPanelDateNavigator === 'function' && isDesktop && isDesktop()) {
    renderPanelDateNavigator();
  }
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
  if (isCalendarView) {
    calDate = new Date(activeDate);
    renderCalendarGrid();
    document.getElementById('header-date').classList.add('active');
  } else {
    document.getElementById('header-date').classList.remove('active');
  }
  applyTabState();
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
  for (let d = 1; d <= days; d++) {
    const dStr = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dots = todos.filter(t => t.due_date === dStr).map(t => `<div class="cal-dot ${t.completed ? 'done' : ''}"></div>`).join('');
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

// ─────────────────────────────────────────────
//  TAB STATE
// ─────────────────────────────────────────────
function applyTabState() {
  const tNotes   = document.getElementById('tab-notes');
  const tTodo    = document.getElementById('tab-todo');
  const tGoals   = document.getElementById('tab-goals');
  const todoWrap = document.getElementById('todo-content-wrap');
  const calView  = document.getElementById('calendar-view');
  const main     = document.querySelector('.main');
  const tabBar   = document.getElementById('tab-bar');
  const fab      = document.getElementById('fab');

  if (isCalendarView) {
    if (calView)  calView.style.display = 'block';
    if (tNotes)   tNotes.style.display  = 'none';
    if (tTodo)    tTodo.style.display   = 'none';
    if (tGoals)   tGoals.style.display  = 'none';
    if (todoWrap) todoWrap.style.display = 'none';
    if (main) { main.classList.remove('goals-active'); main.classList.remove('notes-active'); }
    if (tabBar) tabBar.style.display = 'none';
    if (fab) { fab.style.opacity = '0'; fab.style.pointerEvents = 'none'; fab.style.transform = 'scale(0.9)'; }
    hideJournalDrawer();
    return;
  }

  if (calView)  calView.style.display = 'none';
  if (tNotes)   tNotes.style.display  = currentTab === 'notes' ? 'flex' : 'none';
  if (tTodo)    tTodo.style.display   = currentTab === 'todo'  ? 'block' : 'none';
  if (tGoals)   tGoals.style.display  = currentTab === 'goals' ? 'block' : 'none';
  if (todoWrap) todoWrap.style.display = currentTab === 'todo' ? 'block' : 'none';
  if (main) {
    main.classList.toggle('goals-active', currentTab === 'goals');
    main.classList.toggle('notes-active', currentTab === 'notes');
  }

  const isMobile = window.matchMedia('(hover: none)').matches || window.innerWidth <= 600;
  if (tabBar) tabBar.style.display = (!isMobile && currentTab === 'goals') ? 'none' : '';

  if (fab) { fab.style.opacity = '1'; fab.style.pointerEvents = 'auto'; fab.style.transform = 'scale(1)'; }

  if (currentTab === 'notes') showJournalDrawer();
  else hideJournalDrawer();
}

// ─────────────────────────────────────────────
//  TAB SWITCHING
// ─────────────────────────────────────────────
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  applyTabState();

  if (tab === 'goals') {
    graphUserInteracted = false;
    graphAutoFitPending = true;
    setTimeout(() => renderGoals(), 100);
    setTimeout(() => { const w = document.getElementById('goal-graph-wrap'); if (w) autoFitAndCenterGraph(w); }, 150);
  }
  if (tab === 'todo') renderTodo();
  haptic([15, 10]);
}

// ─────────────────────────────────────────────
//  FAB CLICK
// ─────────────────────────────────────────────
function fabClick() {
  haptic([20, 15]);
  if (currentTab === 'goals') {
    openGoalModal();
  } else if (currentTab === 'notes') {
    openJournalModal();
  } else {
    openChoiceModal();
  }
}

// ─────────────────────────────────────────────
//  RESIZE HANDLER FOR TAB STATE
// ─────────────────────────────────────────────
let _tabStateResizeT = null;
window.addEventListener('resize', () => {
  clearTimeout(_tabStateResizeT);
  _tabStateResizeT = setTimeout(() => {
    if (typeof applyTabState === 'function') applyTabState();
  }, 150);
});