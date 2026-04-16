// ─────────────────────────────────────────────
//  DESKTOP SIDE PANEL
// ─────────────────────────────────────────────
const PANEL_WIDTH_KEY = 'focus_panel_width';
let panelOpen = true;
let activeJournalEntryId = null;
let activeNotesDocId = null;
let mainView = 'notes'; // 'notes', 'goals', 'journal'

function isDesktop() {
  return window.matchMedia('(hover: hover) and (min-width: 768px)').matches;
}

// ── MAIN VIEW TOGGLE ─────────────────────────
function setMainView(view) {
  if (!isDesktop()) return;
  mainView = view;
  document.querySelectorAll('.view-toggle-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`desktop-${view}-toggle-btn`).classList.add('active');
  applyMainView();
  haptic([15]);
}
window.setMainView = setMainView;

function applyMainView() {
  if (!isDesktop()) return;
  const notesTab = document.getElementById('tab-notes');
  const goalsTab = document.getElementById('tab-goals');
  const journalTab = document.getElementById('tab-journal');
  const mainEl = document.querySelector('#desktop-notes-area .main');
  const fab = document.getElementById('fab');

  // Hide all main views
  if (notesTab) notesTab.style.display = 'none';
  if (goalsTab) goalsTab.style.display = 'none';
  if (journalTab) journalTab.style.display = 'none';

  if (mainView === 'goals') {
    if (goalsTab) {
      goalsTab.style.display = 'block';
      const goalsList = document.getElementById('goals-list');
      const goalsContainer = document.getElementById('goals-container');
      if (goalsList) goalsList.style.display = 'flex';
      if (goalsContainer) goalsContainer.style.height = '100%';
      graphUserInteracted = false;
      graphAutoFitPending = true;
      renderGoals();
      setTimeout(() => {
        const wrap = document.getElementById('goal-graph-wrap');
        if (wrap) autoFitAndCenterGraph(wrap);
      }, 120);
    }
    if (mainEl) {
      mainEl.classList.add('goals-active');
      mainEl.classList.remove('notes-active');
    }
    if (fab) fab.style.display = 'none';
    renderPanelForView('todo');
  } else if (mainView === 'journal') {
    if (journalTab) {
      journalTab.style.display = 'block';
      // Show the notes textarea for journal editing
      const notesTab = document.getElementById('tab-notes');
      if (notesTab) notesTab.style.display = 'flex'; // use notes container
      // Hide the inline journal drawer
      const journalSection = document.getElementById('journal-section');
      if (journalSection) journalSection.style.display = 'none';
      // Load active journal entry or show empty state
      loadActiveJournalEntryToTextarea();
    }
    if (mainEl) {
      mainEl.classList.remove('goals-active');
      mainEl.classList.add('notes-active');
    }
    if (fab) fab.style.display = 'none';
    renderPanelForView('journal');
  } else { // notes
    if (notesTab) {
      notesTab.style.display = 'flex';
      const notesArea = document.getElementById('notes-textarea');
      if (notesArea) notesArea.placeholder = 'Jot down your thoughts...';
    }
    if (mainEl) {
      mainEl.classList.add('notes-active');
      mainEl.classList.remove('goals-active');
    }
    if (fab) fab.style.display = '';
    showJournalDrawer();
    renderPanelForView('notes');
  }
}

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
function renderPanelForView(view) {
  const panelTitle = document.getElementById('panel-title');
  const todoCont = document.getElementById('panel-todo-content');
  const journalCont = document.getElementById('panel-journal-content');
  const notesCont = document.getElementById('panel-notes-content');
  const dateNav = document.getElementById('panel-date-navigator');
  
  // Hide all panel content
  if (todoCont) todoCont.style.display = 'none';
  if (journalCont) journalCont.style.display = 'none';
  if (notesCont) notesCont.style.display = 'none';
  
  // Hide date navigator by default
  if (dateNav) dateNav.style.display = 'none';

  if (view === 'todo') {
    panelTitle.textContent = 'To‑Do';
    if (dateNav) {
      dateNav.style.display = 'flex';
      renderPanelDateNavigator();
    }
    if (todoCont) {
      todoCont.style.display = 'block';
      const origTodo = document.getElementById('tab-todo');
      if (origTodo) {
        // Move it into the container if not already there
        if (origTodo.parentElement !== todoCont) {
          todoCont.appendChild(origTodo);
        }
        origTodo.style.display = 'block';
        const todoWrap = document.getElementById('todo-content-wrap');
        if (todoWrap) todoWrap.style.display = 'block';
        currentTab = 'todo';
        renderTodo();
      }
    }
  } else if (view === 'journal') {
    panelTitle.textContent = 'Journal';
    if (journalCont) {
      journalCont.style.display = 'block';
      if (!document.getElementById('panel-journal-entries')) {
        journalCont.innerHTML = `<div id="panel-journal-entries"></div>`;
      }
      refreshPanelJournalEntries();
    }
  } else if (view === 'notes') {
    panelTitle.textContent = 'Notes';
    if (notesCont) {
      notesCont.style.display = 'block';
      if (!document.getElementById('panel-notes-current')) {
        notesCont.innerHTML = `<div id="panel-notes-current"></div>`;
      }
      refreshPanelNotes();
    }
  }
}

// ── PANEL OPEN / CLOSE ──────────────────────
function toggleSidePanel() { panelOpen = !panelOpen; applyPanelState(); }

function applyPanelState() {
  const panel = document.getElementById('side-panel');
  const toggleBtn = document.getElementById('panel-toggle-btn');
  if (!panel) return;
  if (panelOpen) {
    panel.classList.add('open');
    const currentWidth = parseInt(panel.style.getPropertyValue('--panel-width')) || 360;
    if (currentWidth < 360) {
      panel.style.setProperty('--panel-width', '360px');
      localStorage.setItem(PANEL_WIDTH_KEY, '360');
    }
    if (toggleBtn) toggleBtn.querySelector('svg path').setAttribute('d', 'M3 1L7 5L3 9');
    renderPanelForView(mainView === 'goals' ? 'todo' : mainView);
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
    const w = parseInt(panel.style.getPropertyValue('--panel-width')) || parseInt(localStorage.getItem(PANEL_WIDTH_KEY)) || 360;
    toggleBtn.style.right = w + 'px';
  } else {
    toggleBtn.style.right = '0px';
  }
}

// ── PANEL JOURNAL ENTRIES ────────────────────
function refreshPanelJournalEntries() {
  const container = document.getElementById('panel-journal-entries'); if (!container) return;
  const allEntries = getJournalEntries();
  allEntries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (allEntries.length === 0) {
    container.innerHTML = `<div class="journal-empty">No journal entries yet. Click + to add one.</div>`;
    return;
  }
  container.innerHTML = allEntries.map(entry => {
    const date = new Date(entry.created_at);
    const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const safeContent = escHtml(entry.content || '').substring(0, 100);
    const safeContentFull = escHtml(entry.content || '').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
    const isActive = entry.id === activeJournalEntryId;
    return `
      <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
        <button class="btn-ghost" style="flex:1;text-align:left;display:block;padding:12px 14px;border:1px solid var(--border);border-radius:12px;${isActive ? 'background:rgba(126,255,168,0.1);border-color:var(--mint);' : ''}" onclick="loadJournalEntryToNotes('${entry.id}', '${safeContentFull}')">
          <div style="font-weight:700;color:var(--text-2);margin-bottom:4px;">${timeStr}</div>
          <div style="font-size:13px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeContent}${(entry.content || '').length > 100 ? '...' : ''}</div>
        </button>
        <button class="btn-ghost" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;color:var(--text-3);flex-shrink:0;" onclick="deletePanelJournalEntry('${entry.id}')">×</button>
      </div>
    `;
  }).join('');
}

// ── PANEL NOTES DOCS ─────────────────────────
function refreshPanelNotes() {
  const container = document.getElementById('panel-notes-current');
  if (!container) return;
  const docs = typeof getNotesDocs === 'function' ? getNotesDocs() : [];
  if (docs.length === 0) {
    container.innerHTML = `<div class="journal-empty">No notes yet. Click + to create one.</div>`;
    return;
  }
  container.innerHTML = docs.map(doc => {
    const isActive = doc.id === activeNotesDocId;
    const safeTitle = escHtml(doc.title || 'Untitled');
    const safeContent = escHtml(doc.content || '').substring(0, 100);
    const safeContentFull = escHtml(doc.content || '').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n');
    return `
      <div style="display:flex;align-items:center;gap:8px;margin:8px 0;">
        <button class="btn-ghost" style="flex:1;text-align:left;display:block;padding:12px 14px;border:1px solid var(--border);border-radius:12px;${isActive ? 'background:rgba(126,255,168,0.1);border-color:var(--mint);' : ''}" onclick="loadNotesDocToTextarea('${doc.id}', '${safeContentFull}')">
          <div style="font-weight:700;color:var(--text-2);margin-bottom:4px;">${safeTitle}</div>
          <div style="font-size:13px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${safeContent}${(doc.content || '').length > 100 ? '...' : ''}</div>
        </button>
        <button class="btn-ghost" style="padding:8px 10px;border:1px solid var(--border);border-radius:8px;color:var(--text-3);flex-shrink:0;" onclick="deletePanelNotesDoc('${doc.id}')">×</button>
      </div>
    `;
  }).join('');
}
window.refreshPanelNotes = refreshPanelNotes;

// ── LOAD CONTENT INTO TEXTAREA ───────────────
function loadNotesDocToTextarea(docId, content) {
  activeNotesDocId = docId;
  activeJournalEntryId = null;
  if (typeof setActiveNotesDocId === 'function') setActiveNotesDocId(docId);
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.value = content;
    localStorage.setItem(LS_NOTES, content);
    refreshPanelNotes();
  }
}
window.loadNotesDocToTextarea = loadNotesDocToTextarea;

function loadJournalEntryToNotes(entryId, content) {
  activeJournalEntryId = entryId;
  activeNotesDocId = null;
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.value = content;
    notesArea.placeholder = 'Write your journal entry...';
    refreshPanelJournalEntries();
  }
  // If in journal view, ensure the textarea is visible
  if (mainView === 'journal') {
    const notesTab = document.getElementById('tab-notes');
    if (notesTab) notesTab.style.display = 'flex';
  }
}
window.loadJournalEntryToNotes = loadJournalEntryToNotes;

function loadActiveJournalEntryToTextarea() {
  const notesArea = document.getElementById('notes-textarea');
  if (!notesArea) return;

  if (activeJournalEntryId) {
    const entries = getJournalEntries();
    const entry = entries.find(e => e.id === activeJournalEntryId);
    if (entry) {
      notesArea.value = entry.content || '';
    } else {
      // Active entry was deleted
      activeJournalEntryId = null;
      notesArea.value = '';
    }
  } else {
    notesArea.value = '';
  }
  // Update placeholder to indicate journal mode
  notesArea.placeholder = 'Write your journal entry...';
}

// ── SAVE / DELETE HELPERS ────────────────────
let notesSaveTimeout = null;
function scheduleNotesDocSave(content) {
  if (!activeNotesDocId) return;
  clearTimeout(notesSaveTimeout);
  notesSaveTimeout = setTimeout(() => saveNotesDoc(content), 1000);
}
async function saveNotesDoc(content) {
  if (!activeNotesDocId) return;
  const docs = typeof getNotesDocs === 'function' ? getNotesDocs() : [];
  const doc = docs.find(d => d.id === activeNotesDocId);
  if (doc) {
    doc.content = content;
    if (typeof setNotesDocs === 'function') setNotesDocs(docs);
    refreshPanelNotes();
    if (typeof saveNotesToDB === 'function') await saveNotesToDB(content);
  }
}

async function _desktopSaveJournalEntry(content) {
  if (!activeJournalEntryId) return;
  const entries = getJournalEntries();
  const entry = entries.find(e => e.id === activeJournalEntryId);
  if (entry) {
    entry.content = content;
    saveJournalEntries(entries);
    refreshPanelJournalEntries();
    try { await supabase.from('journal_entries').update({ content }).eq('id', activeJournalEntryId); } catch (e) {}
  }
}
let journalSaveTimeout = null;
function scheduleJournalSave(content) {
  if (!activeJournalEntryId) return;
  clearTimeout(journalSaveTimeout);
  journalSaveTimeout = setTimeout(() => _desktopSaveJournalEntry(content), 1000);
}

async function createAndLoadBlankJournalEntry() {
  const newEntry = { id: crypto.randomUUID(), content: '', created_at: new Date().toISOString() };
  const entries = getJournalEntries();
  entries.unshift(newEntry);
  saveJournalEntries(entries);
  refreshPanelJournalEntries();
  loadJournalEntryToNotes(newEntry.id, '');
  try { await supabase.from('journal_entries').insert([{ id: newEntry.id, content: newEntry.content, created_at: newEntry.created_at }]); } catch (e) {}
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) notesArea.focus();
}
window.createAndLoadBlankJournalEntry = createAndLoadBlankJournalEntry;

async function deletePanelJournalEntry(id) {
  const entries = getJournalEntries();
  const filtered = entries.filter(e => e.id !== id);
  saveJournalEntries(filtered);
  if (activeJournalEntryId === id) {
    activeJournalEntryId = null;
    const notesArea = document.getElementById('notes-textarea');
    if (notesArea) {
      notesArea.value = '';
      notesArea.placeholder = 'Write your journal entry...';
    }
  }
  refreshPanelJournalEntries();
  try { await supabase.from('journal_entries').eq('id', id).delete(); showToast('Journal entry deleted'); } catch (e) { showToast('Entry deleted locally'); }
}
window.deletePanelJournalEntry = deletePanelJournalEntry;

async function deletePanelNotesDoc(id) {
  const docs = typeof getNotesDocs === 'function' ? getNotesDocs() : [];
  const filtered = docs.filter(d => d.id !== id);
  if (typeof setNotesDocs === 'function') setNotesDocs(filtered);
  if (activeNotesDocId === id) {
    activeNotesDocId = null;
    document.getElementById('notes-textarea').value = '';
  }
  refreshPanelNotes();
  if (filtered.length > 0) {
    if (typeof setActiveNotesDocId === 'function') setActiveNotesDocId(filtered[0].id);
    if (typeof saveNotesToDB === 'function') await saveNotesToDB(filtered[0].content);
  } else {
    localStorage.setItem(LS_NOTES, '');
    if (typeof saveNotesToDB === 'function') await saveNotesToDB('');
  }
  showToast('Note deleted');
}
window.deletePanelNotesDoc = deletePanelNotesDoc;

// ── NOTES TEXTAREA INPUT LISTENER ────────────
document.addEventListener('DOMContentLoaded', () => {
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.addEventListener('input', (e) => {
      if (mainView === 'journal') {
        if (activeJournalEntryId) {
          scheduleJournalSave(e.target.value);
        } else {
          // If typing in journal view without an active entry, create one automatically
          createAndLoadBlankJournalEntry().then(() => {
            scheduleJournalSave(e.target.value);
          });
        }
      } else if (activeJournalEntryId) {
        scheduleJournalSave(e.target.value);
      } else if (activeNotesDocId) {
        scheduleNotesDocSave(e.target.value);
      } else if (typeof scheduleNotesSave === 'function') {
        scheduleNotesSave(e.target.value);
      }
    });
  }
});

function panelFabClick() {
  if (mainView === 'notes') openNotesManagerModal();
  else if (mainView === 'journal') createAndLoadBlankJournalEntry();
  else if (mainView === 'goals') openChoiceModal();
}
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
document.addEventListener('DOMContentLoaded', () => {
  if (!isDesktop()) return;

  const saved = localStorage.getItem(PANEL_WIDTH_KEY);
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
  setMainView('notes');

  // Override switchTab for mobile/desktop compatibility
  const originalSwitchTab = window.switchTab;
  window.switchTab = function(tab) {
    if (isDesktop()) {
      if (tab === 'todo') setMainView('goals');
      else if (tab === 'journal') setMainView('journal');
      else if (tab === 'goals') setMainView('goals');
      else setMainView('notes');
      return;
    }
    originalSwitchTab(tab);
  };

  window.addEventListener('resize', () => {
    if (isDesktop()) updateToggleBtnPosition();
  });

  // Override applyTabState to respect mainView
  const origApplyTabState = window.applyTabState;
  window.applyTabState = function() {
    if (isDesktop()) {
      const tNotes = document.getElementById('tab-notes');
      const tGoals = document.getElementById('tab-goals');
      const tJournal = document.getElementById('tab-journal');
      const calView = document.getElementById('calendar-view');
      const fab = document.getElementById('fab');
      const mainEl = document.querySelector('#desktop-notes-area .main');

      if (isCalendarView) {
        if (calView) calView.style.display = 'block';
        if (tNotes) tNotes.style.display = 'none';
        if (tGoals) tGoals.style.display = 'none';
        if (tJournal) tJournal.style.display = 'none';
        if (fab) { fab.style.opacity = '0'; fab.style.pointerEvents = 'none'; }
        if (mainEl) { mainEl.classList.remove('goals-active', 'notes-active'); }
        return;
      }

      if (calView) calView.style.display = 'none';
      if (fab) { fab.style.opacity = '1'; fab.style.pointerEvents = 'auto'; fab.style.transform = 'scale(1)'; }

      if (mainView === 'goals') {
        if (tNotes) tNotes.style.display = 'none';
        if (tGoals) {
          tGoals.style.display = 'block';
          graphUserInteracted = false;
          graphAutoFitPending = true;
          renderGoals();
          setTimeout(() => { const wrap = document.getElementById('goal-graph-wrap'); if (wrap) autoFitAndCenterGraph(wrap); }, 50);
        }
        if (tJournal) tJournal.style.display = 'none';
        if (mainEl) { mainEl.classList.add('goals-active'); mainEl.classList.remove('notes-active'); }
        if (fab) fab.style.display = 'none';
      } else if (mainView === 'journal') {
        if (tNotes) tNotes.style.display = 'none';
        if (tGoals) tGoals.style.display = 'none';
        if (tJournal) {
          tJournal.style.display = 'block';
        }
        if (mainEl) { mainEl.classList.remove('goals-active'); mainEl.classList.add('notes-active'); }
        if (fab) fab.style.display = 'none';
      } else {
        if (tNotes) tNotes.style.display = 'flex';
        if (tGoals) tGoals.style.display = 'none';
        if (tJournal) tJournal.style.display = 'none';
        if (mainEl) { mainEl.classList.add('notes-active'); mainEl.classList.remove('goals-active'); }
        if (fab) fab.style.display = '';
        showJournalDrawer();
      }

      if (panelOpen) renderPanelForView(mainView === 'goals' ? 'todo' : mainView);
      return;
    }
    origApplyTabState();
  };
});

window.toggleSidePanel = toggleSidePanel;