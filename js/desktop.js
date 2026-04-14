// ─────────────────────────────────────────────
//  DESKTOP SIDE PANEL
// ─────────────────────────────────────────────
const PANEL_WIDTH_KEY = 'focus_panel_width';
let panelTab = 'todo';
let panelOpen = false;

function isDesktop() {
  return window.matchMedia('(hover: hover) and (min-width: 768px)').matches;
}

// ── PANEL OPEN / CLOSE ──────────────────────
function toggleSidePanel() { panelOpen = !panelOpen; applyPanelState(); }

function applyPanelState() {
  const panel = document.getElementById('side-panel');
  const toggleBtn = document.getElementById('panel-toggle-btn');
  if (!panel) return;
  if (panelOpen) {
    panel.classList.add('open');
    if (toggleBtn) toggleBtn.querySelector('svg path').setAttribute('d', 'M3 1L7 5L3 9');
    renderPanelContent();
  } else {
    panel.classList.remove('open');
    if (toggleBtn) toggleBtn.querySelector('svg path').setAttribute('d', 'M7 1L3 5L7 9');
  }
  updateToggleBtnPosition();
}

function updateToggleBtnPosition() {
  const panel = document.getElementById('side-panel');
  const toggleBtn = document.getElementById('panel-toggle-btn');
  if (!panel || !toggleBtn || !isDesktop()) return;
  if (panelOpen) {
    const w = parseInt(panel.style.getPropertyValue('--panel-width'))
           || parseInt(localStorage.getItem(PANEL_WIDTH_KEY))
           || 380;
    toggleBtn.style.right = w + 'px';
  } else {
    toggleBtn.style.right = '0px';
  }
}

// ── PANEL TAB SWITCHING ──────────────────────
function switchPanelTab(tab) {
  panelTab = tab;
  document.getElementById('panel-tab-todo').classList.toggle('active', tab === 'todo');
  document.getElementById('panel-tab-goals').classList.toggle('active', tab === 'goals');
  document.getElementById('panel-tab-journal').classList.toggle('active', tab === 'journal');
  document.getElementById('panel-todo-content').style.display  = tab === 'todo'    ? 'block' : 'none';
  document.getElementById('panel-goals-content').style.display = tab === 'goals'   ? 'block' : 'none';
  document.getElementById('panel-journal-content').style.display = tab === 'journal' ? 'block' : 'none';
  renderPanelContent();
}

// ── RENDER PANEL CONTENT ────────────────────
function renderPanelContent() {
  if (!isDesktop()) return;
  const todoCont  = document.getElementById('panel-todo-content');
  const goalsCont = document.getElementById('panel-goals-content');
  const journalCont = document.getElementById('panel-journal-content');
  const origTodo  = document.getElementById('tab-todo');
  const origGoals = document.getElementById('tab-goals');

  if (panelTab === 'todo' && origTodo && todoCont) {
    if (origTodo.parentElement !== todoCont) todoCont.appendChild(origTodo);
    const todoWrap = document.getElementById('todo-content-wrap');
    if (todoWrap) todoWrap.style.display = 'block';
    currentTab = 'todo';
    renderTodo();
  }

  if (panelTab === 'goals' && origGoals && goalsCont) {
    if (origGoals.parentElement !== goalsCont) goalsCont.appendChild(origGoals);
    origGoals.style.display = 'block';
    currentTab = 'goals';
    graphUserInteracted = false;
    graphAutoFitPending = true;
    setTimeout(() => renderGoals(), 50);
    setTimeout(() => { const w = document.getElementById('goal-graph-wrap'); if (w) autoFitAndCenterGraph(w); }, 120);
  }

  if (panelTab === 'journal' && journalCont) {
    renderPanelJournal(journalCont);
  }
}

function renderPanelJournal(container) {
  // Build the journal UI inside the panel if not already done
  if (!container.querySelector('.panel-journal-inner')) {
    container.innerHTML = `
      <div class="panel-journal-inner">
        <div class="panel-journal-header">
          <span class="section-label" style="margin-bottom:0">Journal</span>
          <div style="display:flex;gap:8px;align-items:center;">
            <button id="panel-journal-view-all-btn" class="panel-journal-toggle-btn" onclick="togglePanelJournalView(event)">Today</button>
            <button class="panel-journal-add-btn" onclick="openJournalModal()" title="New entry">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="none"><path d="M10 3v14M3 10h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
        <div id="panel-journal-entries"></div>
      </div>
    `;
  }
  refreshPanelJournalEntries();
}

let panelJournalViewAll = false;

function togglePanelJournalView(e) {
  e.stopPropagation();
  panelJournalViewAll = !panelJournalViewAll;
  const btn = document.getElementById('panel-journal-view-all-btn');
  if (btn) {
    btn.textContent = panelJournalViewAll ? 'All' : 'Today';
    btn.classList.toggle('active', panelJournalViewAll);
  }
  refreshPanelJournalEntries();
}

function refreshPanelJournalEntries() {
  const container = document.getElementById('panel-journal-entries'); if (!container) return;
  const allEntries = getJournalEntries();
  allEntries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const activeDStr = getActiveDateStr();
  const entries = panelJournalViewAll ? allEntries : allEntries.filter(e => e.created_at && e.created_at.slice(0, 10) === activeDStr);
  if (entries.length === 0) {
    container.innerHTML = `<div class="journal-empty">${panelJournalViewAll ? 'No journal entries yet.' : 'No entries today. Click + to add one.'}</div>`;
    return;
  }
  let html = '';
  entries.forEach(entry => {
    const date = new Date(entry.created_at);
    const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    html += `
      <div class="journal-entry" data-id="${entry.id}">
        <div class="journal-entry-header">
          <span class="journal-timestamp">${timeStr}</span>
          <button class="journal-delete-btn" onclick="deleteJournalEntry('${entry.id}')" title="Delete entry">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>
        </div>
        <div class="journal-entry-content">${escHtml(entry.content)}</div>
      </div>
    `;
  });
  container.innerHTML = html;
}

window.togglePanelJournalView  = togglePanelJournalView;
window.refreshPanelJournalEntries = refreshPanelJournalEntries;

function panelFabClick() {
  if (panelTab === 'goals') openGoalModal();
  else if (panelTab === 'journal') openJournalModal();
  else openChoiceModal();
}

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
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isResizing) return;
    const panel = document.getElementById('side-panel');
    const dx = startX - e.clientX;
    let newWidth = Math.max(220, Math.min(700, startWidth + dx));
    panel.style.setProperty('--panel-width', newWidth + 'px');
    localStorage.setItem(PANEL_WIDTH_KEY, newWidth);
    updateToggleBtnPosition();
  }

  function onMouseUp() {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.getElementById('panel-resize-handle').classList.remove('dragging');
    document.getElementById('side-panel').style.transition = '';
  }

  document.addEventListener('DOMContentLoaded', () => {
    const handle = document.getElementById('panel-resize-handle');
    if (handle) handle.addEventListener('mousedown', onMouseDown);
  });
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
})();

// ── INIT PANEL ON LOAD ───────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!isDesktop()) return;

  // Restore saved panel width
  const saved = localStorage.getItem(PANEL_WIDTH_KEY);
  if (saved) {
    const panel = document.getElementById('side-panel');
    if (panel) panel.style.setProperty('--panel-width', saved + 'px');
  }

  // On desktop, override switchTab to drive panel instead of main area
  const originalSwitchTab = window.switchTab;
  window.switchTab = function(tab) {
    if (isDesktop()) {
      if (tab !== 'notes') {
        if (!panelOpen) panelOpen = true;
        panelTab = tab;
        applyPanelState();
        switchPanelTab(tab);
      }
      return;
    }
    originalSwitchTab(tab);
  };

  // Notes always active on desktop
  const main = document.querySelector('#desktop-notes-area .main');
  if (main) { main.classList.add('notes-active'); main.classList.remove('goals-active'); }

  showJournalDrawer();

  window.addEventListener('resize', () => {
    if (isDesktop()) updateToggleBtnPosition();
  });

  // Override applyTabState to be desktop-aware
  const origApplyTabState = window.applyTabState;
  window.applyTabState = function() {
    if (isDesktop()) {
      const tNotes = document.getElementById('tab-notes');
      const calView = document.getElementById('calendar-view');
      const fab = document.getElementById('fab');
      if (isCalendarView) {
        if (calView) calView.style.display = 'block';
        if (tNotes) tNotes.style.display = 'none';
        if (fab) { fab.style.opacity = '0'; fab.style.pointerEvents = 'none'; }
        return;
      }
      if (calView) calView.style.display = 'none';
      if (tNotes) tNotes.style.display = 'flex';
      if (fab) { fab.style.opacity = '1'; fab.style.pointerEvents = 'auto'; fab.style.transform = 'scale(1)'; }
      showJournalDrawer();
      if (panelOpen) renderPanelContent();
      return;
    }
    origApplyTabState();
  };
});

window.toggleSidePanel = toggleSidePanel;
window.switchPanelTab  = switchPanelTab;
window.panelFabClick   = panelFabClick;