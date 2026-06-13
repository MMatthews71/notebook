// ─────────────────────────────────────────────
//  DESKTOP SIDE PANEL
//  Desktop layout: goals graph on the left, the
//  to-do list in a resizable side panel.
// ─────────────────────────────────────────────

let panelOpen = true;
let mainView = 'goals';
window.mainView = mainView;

function isDesktop() {
  return window.matchMedia('(min-width: 768px)').matches;
}

// ── MAIN VIEW ────────────────────────────────
// The todo app has a single desktop view (goals + todo panel); these are
// kept as functions so init.js can call them on load.
function setMainView() {
  if (!isDesktop()) return;
  mainView = 'goals';
  window.mainView = mainView;
  currentTab = 'goals';
  applyMainView();
  haptic([15]);
}
window.setMainView = setMainView;

function applyMainView() {
  if (!isDesktop()) return;
  const goalsTab = document.getElementById('tab-goals');
  const mainEl = document.querySelector('#desktop-notes-area .main');
  const fab = document.getElementById('fab');

  if (goalsTab) {
    goalsTab.style.display = 'block';
    const goalsList = document.getElementById('goals-list');
    const goalsContainer = document.getElementById('goals-container');
    if (goalsList) goalsList.style.display = 'flex';
    if (goalsContainer) {
      goalsContainer.style.height = '100%';
      goalsContainer.offsetHeight; // force reflow
    }
    goalsTab.offsetHeight;
    graphUserInteracted = false;
    graphAutoFitPending = true;
    renderGoals();
    requestAnimationFrame(() => {
      const wrap = document.getElementById('goal-graph-wrap');
      if (wrap) autoFitAndCenterGraph(wrap);
    });
  }
  if (mainEl) mainEl.classList.add('goals-active');
  if (fab) fab.style.display = 'none';
  renderPanelForView('todo');
}
window.applyMainView = applyMainView;

// ── PANEL DATE NAVIGATOR ─────────────────────
function renderPanelDateNavigator() {
  const container = document.getElementById('panel-date-navigator');
  if (!container) return;

  const activeDateStr = getActiveDateStr();
  const todayStrVal = todayStr();
  let prefix = '';
  if (activeDateStr === todayStrVal) prefix = 'Today, ';
  else {
    const diff = Math.round((new Date(activeDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000);
    if (diff === 1) prefix = 'Tomorrow, ';
    else if (diff === -1) prefix = 'Yesterday, ';
  }
  const displayDate = activeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  container.innerHTML = `
    <button class="nav-btn" onclick="offsetActiveDate(-1); renderPanelDateNavigator();" aria-label="Previous day">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <span class="header-date" onclick="toggleCalendarView(); renderPanelDateNavigator();" title="Open Calendar">${prefix}${displayDate}</span>
    <button class="nav-btn" onclick="offsetActiveDate(1); renderPanelDateNavigator();" aria-label="Next day">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  `;

  // Highlight if calendar is open
  if (isCalendarView) {
    container.querySelector('.header-date').classList.add('active');
  }
}

// ── PANEL CONTENT RENDERER ───────────────────
function renderPanelForView() {
  const sidePanel = document.getElementById('side-panel');
  if (sidePanel) sidePanel.classList.add('view-todo');

  const panelTitle = document.getElementById('panel-title');
  const todoCont = document.getElementById('panel-todo-content');
  const dateNav = document.getElementById('panel-date-navigator');
  const headerRight = document.getElementById('side-panel-actions');

  if (panelTitle) { panelTitle.style.cssText = ''; panelTitle.textContent = ''; }

  // Date navigator replaces the title
  if (dateNav) {
    dateNav.style.display = 'flex';
    renderPanelDateNavigator();
  }
  if (todoCont) {
    todoCont.style.display = 'block';
    const origTodo = document.getElementById('tab-todo');
    if (origTodo) {
      if (origTodo.parentElement !== todoCont) todoCont.appendChild(origTodo);
      origTodo.style.display = 'block';
      const todoWrap = document.getElementById('todo-content-wrap');
      if (todoWrap) todoWrap.style.display = 'block';
      renderTodo();
    }
  }

  // ── Rest day button in the header actions ──
  let rdBtn = document.getElementById('panel-rest-day-btn');
  if (!rdBtn) {
    rdBtn = document.createElement('button');
    rdBtn.id = 'panel-rest-day-btn';
    rdBtn.className = 'panel-action-btn';
    rdBtn.title = 'Toggle rest day';
    rdBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    rdBtn.addEventListener('click', () => {
      toggleRestDay(getActiveDateStr());
      // Sync active state after toggle
      setTimeout(() => rdBtn.classList.toggle('active', isRestDay(getActiveDateStr())), 50);
    });
    const addBtn = document.getElementById('panel-add-btn');
    if (addBtn) headerRight.insertBefore(rdBtn, addBtn);
    else headerRight.appendChild(rdBtn);
  }
  rdBtn.classList.toggle('active', isRestDay(getActiveDateStr()));
  rdBtn.style.display = '';

  // ── Task fraction in the header actions ──
  let fractionEl = document.getElementById('panel-task-fraction');
  if (!fractionEl) {
    fractionEl = document.createElement('span');
    fractionEl.id = 'panel-task-fraction';
    fractionEl.className = 'panel-task-fraction';
    const addBtn = document.getElementById('panel-add-btn');
    if (headerRight && addBtn) headerRight.insertBefore(fractionEl, addBtn);
    else if (headerRight) headerRight.appendChild(fractionEl);
  }
  fractionEl.style.display = 'inline-block';
  updatePanelTaskFraction();
}

function updatePanelTaskFraction() {
  const doneEl = document.getElementById('task-fraction-done');
  const totalEl = document.getElementById('task-fraction-total');
  const panelFraction = document.getElementById('panel-task-fraction');
  if (panelFraction && doneEl && totalEl) {
    const done = doneEl.textContent;
    const total = totalEl.textContent;
    panelFraction.textContent = `${done}/${total}`;
    panelFraction.title = `${done} of ${total} tasks completed`;
  }
}
window.updatePanelTaskFraction = updatePanelTaskFraction;

// ── PANEL OPEN / CLOSE ──────────────────────
function toggleSidePanel() { panelOpen = !panelOpen; applyPanelState(); }
window.toggleSidePanel = toggleSidePanel;

async function applyPanelState() {
  const panel = document.getElementById('side-panel');
  const toggleBtn = document.getElementById('panel-toggle-btn');
  if (!panel) return;
  if (panelOpen) {
    panel.classList.add('open');
    const currentWidth = parseInt(panel.style.getPropertyValue('--panel-width')) || 360;
    if (currentWidth < 360) {
      panel.style.setProperty('--panel-width', '360px');
      await supabase.setPref('panel_width', '360');
    }
    if (toggleBtn) toggleBtn.querySelector('svg path').setAttribute('d', 'M3 1L7 5L3 9');
    renderPanelForView('todo');
  } else {
    panel.classList.remove('open');
    if (toggleBtn) toggleBtn.querySelector('svg path').setAttribute('d', 'M7 1L3 5L7 9');
  }
  updateToggleBtnPosition();
}

async function updateToggleBtnPosition() {
  const panel = document.getElementById('side-panel');
  const toggleBtn = document.getElementById('panel-toggle-btn');
  if (!panel || !toggleBtn || !isDesktop()) return;
  if (panelOpen) {
    const savedWidth = await supabase.getPref('panel_width');
    const w = parseInt(panel.style.getPropertyValue('--panel-width')) || parseInt(savedWidth) || 360;
    toggleBtn.style.right = w + 'px';
  } else {
    toggleBtn.style.right = '0px';
  }
}

function panelFabClick() { openChoiceModal(); }
window.panelFabClick = panelFabClick;

// ── RESIZE HANDLE ────────────────────────────
(function initPanelResize() {
  let isResizing = false, startX = 0, startWidth = 0;
  function onMouseDown(e) {
    if (!isDesktop()) return;
    isResizing = true; startX = e.clientX;
    const panel = document.getElementById('side-panel');
    startWidth = parseInt(getComputedStyle(panel).width) || 380;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.getElementById('panel-resize-handle').classList.add('dragging');
    panel.style.transition = 'none';
    document.getElementById('panel-toggle-btn').style.transition = 'none';
    e.preventDefault();
  }
  function onMouseMove(e) {
    if (!isResizing) return;
    const panel = document.getElementById('side-panel');
    const dx = startX - e.clientX;
    let newWidth = Math.max(360, Math.min(700, startWidth + dx));
    panel.style.setProperty('--panel-width', newWidth + 'px');
    supabase.setPref('panel_width', String(newWidth));
    updateToggleBtnPosition();
  }
  function onMouseUp() {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.getElementById('panel-resize-handle').classList.remove('dragging');
    document.getElementById('side-panel').style.transition = '';
    document.getElementById('panel-toggle-btn').style.transition = '';
  }
  document.addEventListener('DOMContentLoaded', () => {
    const handle = document.getElementById('panel-resize-handle');
    if (handle) handle.addEventListener('mousedown', onMouseDown);
  });
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
})();

// ── INIT ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!isDesktop()) return;

  const saved = await supabase.getPref('panel_width');
  if (saved) {
    const panel = document.getElementById('side-panel');
    if (panel) panel.style.setProperty('--panel-width', Math.max(360, parseInt(saved) || 360) + 'px');
  }

  const header = document.querySelector('header.header');
  const notesArea = document.getElementById('desktop-notes-area');
  if (header && notesArea && !notesArea.contains(header)) {
    notesArea.insertBefore(header, notesArea.firstChild);
  }

  applyPanelState();
  setMainView();

  // On desktop both mobile tabs collapse into the single goals+panel layout
  const originalSwitchTab = window.switchTab;
  window.switchTab = function(tab) {
    if (isDesktop()) { setMainView(); return; }
    originalSwitchTab(tab);
  };

  let _resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeT);
    _resizeT = setTimeout(() => {
      if (isDesktop()) updateToggleBtnPosition();
    }, 150);
  });

  // Override applyTabState — the desktop layout has only the goals view
  const origApplyTabState = window.applyTabState;
  window.applyTabState = function() {
    if (isDesktop()) {
      const tGoals = document.getElementById('tab-goals');
      const fab = document.getElementById('fab');
      const mainEl = document.querySelector('#desktop-notes-area .main');

      // #calendar-view is a fixed overlay — it manages its own display.
      // Do NOT touch it here; toggleCalendarView owns it.

      if (tGoals) {
        tGoals.style.display = 'block';
        graphUserInteracted = false;
        graphAutoFitPending = true;
        renderGoals();
        setTimeout(() => { const wrap = document.getElementById('goal-graph-wrap'); if (wrap) autoFitAndCenterGraph(wrap); }, 50);
      }
      if (mainEl) { mainEl.classList.add('goals-active'); mainEl.classList.remove('notes-active'); }
      if (fab) {
        fab.style.display = 'none';
        fab.style.opacity = '1'; fab.style.pointerEvents = 'auto'; fab.style.transform = 'scale(1)';
      }

      if (panelOpen) renderPanelForView('todo');
      return;
    }
    origApplyTabState();
  };
});

// Called when init.js finishes loading all data
window.onDataReady = function() {
  if (!isDesktop()) return;
  applyMainView();
};
