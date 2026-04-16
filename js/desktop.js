// ─────────────────────────────────────────────
//  DESKTOP SIDE PANEL
// ─────────────────────────────────────────────
const PANEL_WIDTH_KEY = 'focus_panel_width';
let panelTab = 'todo';
let panelOpen = true;
let activeJournalEntryId = null;
let activeNotesDocId = null;
let mainView = 'notes'; // 'notes' or 'goals'

function isDesktop() {
  return window.matchMedia('(hover: hover) and (min-width: 768px)').matches;
}

// ── MAIN VIEW TOGGLE (Notes/Goals) ─────────────
function toggleMainGoalsView() {
  if (!isDesktop()) return;
  mainView = mainView === 'notes' ? 'goals' : 'notes';
  const btn = document.getElementById('desktop-goals-toggle-btn');
  if (btn) btn.classList.toggle('active', mainView === 'goals');
  applyMainView();
  haptic([15]);
}

function applyMainView() {
  if (!isDesktop()) return;
  const notesTab = document.getElementById('tab-notes');
  const goalsTab = document.getElementById('tab-goals');
  const mainEl = document.querySelector('#desktop-notes-area .main');
  const fab = document.getElementById('fab');

  if (mainView === 'goals') {
    if (notesTab) notesTab.style.display = 'none';
    if (goalsTab) {
      goalsTab.style.display = 'block';
      // Ensure the graph renders and auto-fits
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
  } else {
    if (notesTab) notesTab.style.display = 'flex';
    if (goalsTab) goalsTab.style.display = 'none';
    if (mainEl) {
      mainEl.classList.add('notes-active');
      mainEl.classList.remove('goals-active');
    }
    if (fab) fab.style.display = '';
    // Refresh notes display
    showJournalDrawer();
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
    // Enforce minimum width when opening
    const currentWidth = parseInt(panel.style.getPropertyValue('--panel-width')) || 360;
    if (currentWidth < 360) {
      panel.style.setProperty('--panel-width', '360px');
      localStorage.setItem(PANEL_WIDTH_KEY, '360');
    }
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
           || 360;
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
  document.getElementById('panel-tab-journal').classList.toggle('active', tab === 'journal');
  document.getElementById('panel-notes-content').style.display = tab === 'notes'   ? 'block' : 'none';
  document.getElementById('panel-todo-content').style.display  = tab === 'todo'    ? 'block' : 'none';
  document.getElementById('panel-journal-content').style.display = tab === 'journal' ? 'block' : 'none';
  renderPanelContent();
}

// ── RENDER PANEL CONTENT ────────────────────
function renderPanelContent() {
  if (!isDesktop()) return;
  const todoCont  = document.getElementById('panel-todo-content');
  const journalCont = document.getElementById('panel-journal-content');
  const notesCont  = document.getElementById('panel-notes-content');
  const origTodo  = document.getElementById('tab-todo');
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

function loadNotesDocToTextarea(docId, content) {
  activeNotesDocId = docId;
  activeJournalEntryId = null;
  // FIX: Also sync journal.js's active doc pointer so subsequent saves
  // via scheduleNotesSave → saveNotesToDB → updateActiveNotesDocContent
  // update the correct doc in LS_NOTES_DOCS.
  if (typeof setActiveNotesDocId === 'function') setActiveNotesDocId(docId);
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.value = content;
    // Writing to LS_NOTES here is correct — this IS a note, not a journal entry.
    // On reload, init.js reads LS_NOTES to bootstrap the textarea.
    localStorage.setItem(LS_NOTES, content);
    refreshPanelNotes();
  }
}

window.loadNotesDocToTextarea = loadNotesDocToTextarea;

let notesSaveTimeout = null;

function scheduleNotesDocSave(content) {
  if (!activeNotesDocId) return;
  if (notesSaveTimeout) clearTimeout(notesSaveTimeout);
  notesSaveTimeout = setTimeout(() => saveNotesDoc(content), 1000);
}

async function saveNotesDoc(content) {
  if (!activeNotesDocId) return;
  const docs = typeof getNotesDocs === 'function' ? getNotesDocs() : [];
  const doc = docs.find(d => d.id === activeNotesDocId);
  if (doc) {
    doc.content = content;
    // FIX: was calling nonexistent saveNotesDocs(); correct name is setNotesDocs()
    if (typeof setNotesDocs === 'function') setNotesDocs(docs);
    refreshPanelNotes();
    // FIX: was doing supabase.from('notes').update().eq('id', activeNotesDocId)
    // which uses the wrong ID — activeNotesDocId is a local doc UUID, not the
    // Supabase notes row key. Delegate to saveNotesToDB() which uses getNotesId().
    if (typeof saveNotesToDB === 'function') await saveNotesToDB(content);
  }
}

// FIX: Renamed from saveJournalEntry to _desktopSaveJournalEntry to avoid
// overriding journal.js's saveJournalEntry() function. The journal.js version
// is called from the mobile modal (no args, reads from #journal-content textarea).
// This desktop version takes a content string and requires activeJournalEntryId.
// Both living as "saveJournalEntry" in global scope meant whichever file loaded
// last won, silently breaking the other's flow.
async function _desktopSaveJournalEntry(content) {
  if (!activeJournalEntryId) return;
  const entries = getJournalEntries();
  const entry = entries.find(e => e.id === activeJournalEntryId);
  if (entry) {
    entry.content = content;
    saveJournalEntries(entries);
    refreshPanelJournalEntries();
    try {
      await supabase.from('journal_entries').update({ content }).eq('id', activeJournalEntryId);
    } catch (e) { console.error('_desktopSaveJournalEntry failed:', e); }
  }
}

function loadJournalEntryToNotes(entryId, content) {
  activeJournalEntryId = entryId;
  activeNotesDocId = null;
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.value = content;
    // FIX: Removed localStorage.setItem(LS_NOTES, content) that was here.
    // LS_NOTES is the notes store — writing journal content into it caused the
    // notes textarea to reload with journal text on the next app start.
    refreshPanelJournalEntries();
  }
}

window.loadJournalEntryToNotes = loadJournalEntryToNotes;

async function createAndLoadBlankJournalEntry() {
  const newEntry = { id: crypto.randomUUID(), content: '', created_at: new Date().toISOString() };
  const entries = getJournalEntries();
  entries.unshift(newEntry);
  saveJournalEntries(entries);
  refreshPanelJournalEntries();
  loadJournalEntryToNotes(newEntry.id, '');
  try {
    await supabase.from('journal_entries').insert([{ id: newEntry.id, content: newEntry.content, created_at: newEntry.created_at }]);
  } catch (e) { console.error('createAndLoadBlankJournalEntry failed:', e); }
}

window.createAndLoadBlankJournalEntry = createAndLoadBlankJournalEntry;

async function deletePanelJournalEntry(id) {
  const entries = getJournalEntries();
  const filtered = entries.filter(e => e.id !== id);
  saveJournalEntries(filtered);
  if (activeJournalEntryId === id) {
    activeJournalEntryId = null;
    const notesArea = document.getElementById('notes-textarea');
    if (notesArea) notesArea.value = '';
  }
  refreshPanelJournalEntries();
  try {
    await supabase.from('journal_entries').eq('id', id).delete();
    showToast('Journal entry deleted');
  } catch (e) { console.error('deletePanelJournalEntry failed:', e); showToast('Entry deleted locally'); }
}

window.deletePanelJournalEntry = deletePanelJournalEntry;

async function deletePanelNotesDoc(id) {
  const docs = typeof getNotesDocs === 'function' ? getNotesDocs() : [];
  const filtered = docs.filter(d => d.id !== id);
  if (typeof setNotesDocs === 'function') setNotesDocs(filtered);
  if (activeNotesDocId === id) {
    activeNotesDocId = null;
    const notesArea = document.getElementById('notes-textarea');
    if (notesArea) notesArea.value = '';
  }
  refreshPanelNotes();
  if (filtered.length > 0) {
    const remainingDoc = filtered[0];
    if (typeof setActiveNotesDocId === 'function') setActiveNotesDocId(remainingDoc.id);
    if (typeof saveNotesToDB === 'function') await saveNotesToDB(remainingDoc.content);
  } else {
    localStorage.setItem(LS_NOTES, '');
    if (typeof saveNotesToDB === 'function') await saveNotesToDB('');
  }
  showToast('Note deleted');
}

window.deletePanelNotesDoc = deletePanelNotesDoc;

let journalSaveTimeout = null;

function scheduleJournalSave(content) {
  if (!activeJournalEntryId) return;
  if (journalSaveTimeout) clearTimeout(journalSaveTimeout);
  journalSaveTimeout = setTimeout(() => _desktopSaveJournalEntry(content), 1000);
}

// Single routing input listener for the notes textarea.
// This is the ONLY input listener on notes-textarea — init.js intentionally
// does not attach one. Routing logic:
//   • activeJournalEntryId set → editing a journal entry in the panel → save to journal_entries
//   • activeNotesDocId set     → editing a notes doc in the panel     → save to notes (via doc system)
//   • neither set (mobile or fresh load) → plain notes save via scheduleNotesSave
document.addEventListener('DOMContentLoaded', () => {
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.addEventListener('input', (e) => {
      if (activeJournalEntryId) {
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
  if (panelTab === 'notes') openNotesManagerModal();
  else if (panelTab === 'journal') createAndLoadBlankJournalEntry();
  else openChoiceModal(); // todo tab
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
    // Lowered the minimum boundary from 500 to 360
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
      // Lowered from 500 to 360
      const width = Math.max(360, parseInt(saved) || 360);
      panel.style.setProperty('--panel-width', width + 'px');
    }
  }

  // Relocate header inside desktop-notes-area for full-height panel
  const header = document.querySelector('header.header');
  const notesArea = document.getElementById('desktop-notes-area');
  if (header && notesArea && !notesArea.contains(header)) {
    notesArea.insertBefore(header, notesArea.firstChild);
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

  // Apply initial main view state
  applyMainView();

  window.addEventListener('resize', () => {
    if (isDesktop()) updateToggleBtnPosition();
  });

  // Override applyTabState to be desktop-aware
  const origApplyTabState = window.applyTabState;
  window.applyTabState = function() {
    if (isDesktop()) {
      const tNotes = document.getElementById('tab-notes');
      const tGoals = document.getElementById('tab-goals');
      const calView = document.getElementById('calendar-view');
      const fab = document.getElementById('fab');
      const mainEl = document.querySelector('#desktop-notes-area .main');

      if (isCalendarView) {
        if (calView) calView.style.display = 'block';
        if (tNotes) tNotes.style.display = 'none';
        if (tGoals) tGoals.style.display = 'none';
        if (fab) { fab.style.opacity = '0'; fab.style.pointerEvents = 'none'; }
        if (mainEl) { mainEl.classList.remove('goals-active', 'notes-active'); }
        return;
      }

      if (calView) calView.style.display = 'none';
      if (fab) { fab.style.opacity = '1'; fab.style.pointerEvents = 'auto'; fab.style.transform = 'scale(1)'; }

      // Respect the mainView toggle
      if (mainView === 'goals') {
        if (tNotes) tNotes.style.display = 'none';
        if (tGoals) {
          tGoals.style.display = 'block';
          graphUserInteracted = false;
          graphAutoFitPending = true;
          renderGoals();
          setTimeout(() => {
            const wrap = document.getElementById('goal-graph-wrap');
            if (wrap) autoFitAndCenterGraph(wrap);
          }, 50);
        }
        if (mainEl) { mainEl.classList.add('goals-active'); mainEl.classList.remove('notes-active'); }
        if (fab) fab.style.display = 'none';
      } else {
        if (tNotes) tNotes.style.display = 'flex';
        if (tGoals) tGoals.style.display = 'none';
        if (mainEl) { mainEl.classList.add('notes-active'); mainEl.classList.remove('goals-active'); }
        if (fab) fab.style.display = '';
        showJournalDrawer();
      }

      if (panelOpen) renderPanelContent();
      return;
    }
    origApplyTabState();
  };
});

window.toggleSidePanel = toggleSidePanel;
window.switchPanelTab  = switchPanelTab;
window.panelFabClick   = panelFabClick;