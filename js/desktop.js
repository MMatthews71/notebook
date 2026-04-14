// ─────────────────────────────────────────────
//  DESKTOP SIDE PANEL
// ─────────────────────────────────────────────
const PANEL_WIDTH_KEY = 'focus_panel_width';
let panelTab = 'todo';
let panelOpen = true;

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
  document.getElementById('panel-tab-notes').classList.toggle('active', tab === 'notes');
  document.getElementById('panel-tab-todo').classList.toggle('active', tab === 'todo');
  document.getElementById('panel-tab-goals').classList.toggle('active', tab === 'goals');
  document.getElementById('panel-tab-journal').classList.toggle('active', tab === 'journal');
  document.getElementById('panel-notes-content').style.display = tab === 'notes'   ? 'block' : 'none';
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
  const notesCont  = document.getElementById('panel-notes-content');
  const origTodo  = document.getElementById('tab-todo');
  const origGoals = document.getElementById('tab-goals');
  const panelBody = document.getElementById('side-panel-body');

  if (panelTab === 'notes' && notesCont) {
    renderPanelNotes(notesCont);
    if (panelBody) panelBody.classList.remove('panel-goals-active');
  }

  if (panelTab === 'todo' && origTodo && todoCont) {
    if (origTodo.parentElement !== todoCont) todoCont.appendChild(origTodo);
    const todoWrap = document.getElementById('todo-content-wrap');
    if (todoWrap) todoWrap.style.display = 'block';
    currentTab = 'todo';
    renderTodo();
    if (panelBody) panelBody.classList.remove('panel-goals-active');
  }

  if (panelTab === 'goals' && origGoals && goalsCont) {
    if (origGoals.parentElement !== goalsCont) goalsCont.appendChild(origGoals);
    origGoals.style.display = 'block';
    currentTab = 'goals';
    graphUserInteracted = false;
    graphAutoFitPending = true;
    setTimeout(() => renderGoals(), 50);
    setTimeout(() => { const w = document.getElementById('goal-graph-wrap'); if (w) autoFitAndCenterGraph(w); }, 120);
    if (panelBody) panelBody.classList.add('panel-goals-active');
  }

  if (panelTab === 'journal' && journalCont) {
    renderPanelJournal(journalCont);
    if (panelBody) panelBody.classList.remove('panel-goals-active');
  }
}

function renderPanelNotes(container) {
  if (!container.querySelector('.panel-notes-inner')) {
    container.innerHTML = `
      <div class="panel-notes-inner">
        <div id="panel-notes-current"></div>
      </div>
    `;
  }
  refreshPanelNotes();
}

function renderPanelJournal(container) {
  if (!container.querySelector('.panel-journal-inner')) {
    container.innerHTML = `
      <div class="panel-journal-inner">
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
  const entries = allEntries;
  if (entries.length === 0) {
    container.innerHTML = `<div class="journal-empty">No journal entries yet. Click + to add one.</div>`;
    return;
  }
  container.innerHTML = entries.map(entry => {
    const date = new Date(entry.created_at);
    const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const safeContent = escHtml(entry.content || '').substring(0, 100);
    return `
      <button class="btn-ghost" style="width:100%;text-align:left;display:block;padding:12px 14px;margin:8px 0;border:1px solid var(--border);border-radius:12px;" onclick="openJournalModal();document.getElementById('journal-content').value='${escHtml(entry.content || '')}'">
        <div style="font-weight:700;color:var(--text-2);margin-bottom:4px;">${timeStr}</div>
        <div style="font-size:13px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeContent}${(entry.content || '').length > 100 ? '...' : ''}</div>
      </button>
    `;
  }).join('');
}

function refreshPanelNotes() {
  const container = document.getElementById('panel-notes-current');
  if (!container) return;
  const docs = typeof getNotesDocs === 'function' ? getNotesDocs() : [];
  const activeId = typeof getActiveNotesDocId === 'function' ? getActiveNotesDocId() : '';
  if (docs.length === 0) {
    container.innerHTML = `<div class="journal-empty">No notes yet. Click + to create one.</div>`;
    return;
  }
  container.innerHTML = docs.map(doc => {
    const isActive = doc.id === activeId;
    const safeTitle = escHtml(doc.title || 'Untitled');
    const safeContent = escHtml(doc.content || '').substring(0, 100);
    return `
      <button class="btn-ghost" style="width:100%;text-align:left;display:block;padding:12px 14px;margin:8px 0;border:1px solid var(--border);border-radius:12px;${isActive ? 'background:rgba(126,255,168,0.1);border-color:var(--mint);' : ''}" onclick="switchToNotesDoc('${doc.id}')">
        <div style="font-weight:700;color:var(--text-2);margin-bottom:4px;">${safeTitle}</div>
        <div style="font-size:13px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeContent}${(doc.content || '').length > 100 ? '...' : ''}</div>
      </button>
    `;
  }).join('');
}

window.refreshPanelNotes = refreshPanelNotes;

function panelFabClick() {
  if (panelTab === 'notes') openNotesManagerModal();
  else if (panelTab === 'goals') openGoalModal();
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
    const toggleBtn = document.getElementById('panel-toggle-btn');
    startWidth = parseInt(getComputedStyle(panel).width) || 380;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.getElementById('panel-resize-handle').classList.add('dragging');
    panel.style.transition = 'none';
    if (toggleBtn) toggleBtn.style.transition = 'none';
    e.preventDefault();
  }

  function onMouseMove(e) {
    if (!isResizing) return;
    const panel = document.getElementById('side-panel');
    const dx = startX - e.clientX;
    let newWidth = Math.max(320, Math.min(700, startWidth + dx));
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
    const toggleBtn = document.getElementById('panel-toggle-btn');
    if (toggleBtn) toggleBtn.style.transition = '';
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

  // Restore saved panel width (enforce minimum)
  const saved = localStorage.getItem(PANEL_WIDTH_KEY);
  if (saved) {
    const panel = document.getElementById('side-panel');
    if (panel) {
      const width = Math.max(320, parseInt(saved) || 380);
      panel.style.setProperty('--panel-width', width + 'px');
    }
  }

  // Apply initial panel state to open it
  applyPanelState();

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