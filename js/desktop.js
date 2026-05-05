// ─────────────────────────────────────────────
//  DESKTOP SIDE PANEL
// ─────────────────────────────────────────────

function togglePanelEditMode() {
  const panel = document.getElementById('side-panel');
  const btn = document.getElementById('panel-edit-btn');
  if (!panel) return;
  panel.classList.toggle('edit-mode');
  if (btn) btn.classList.toggle('active', panel.classList.contains('edit-mode'));
}
window.togglePanelEditMode = togglePanelEditMode;

let panelOpen = true;
let activeJournalEntryId = null;
let activeNotesDocId = null;
let mainView = 'notes'; // 'notes', 'goals', 'journal'
window.mainView = mainView;  // expose for cross-module checks

// In-memory cache — populated by initApp, kept in sync by journal functions
let _journalEntriesCache = [];

function getJournalEntries() {
  return _journalEntriesCache;
}

function saveJournalEntries(arr) {
  _journalEntriesCache = arr;
  // Note: individual Supabase calls handle persistence; this just updates the cache
}

function isDesktop() {
  return window.matchMedia('(hover: hover) and (min-width: 768px)').matches;
}

// FIX: Expose a synchronous getter so journal.js can read the in-memory activeNotesDocId
// without async DB calls, eliminating the race in updateActiveNotesDocContent.
window._getDesktopActiveNotesDocId = function() {
  return activeNotesDocId;
};

// FIX: Expose a synchronous setter so journal.js can update this variable
// immediately (before any async work) when switching notes docs.
// This ensures the textarea input handler always targets the correct doc.
window.setActiveNotesDocIdInMemory = function(id) {
  activeNotesDocId = id;
  activeJournalEntryId = null;
};

// ── MAIN VIEW TOGGLE ─────────────────────────
function setMainView(view) {
  if (!isDesktop()) return;
  flushPendingSaves();                     // save any pending changes

  // Clear the textarea immediately to prevent visual carry-over
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) notesArea.value = '';

  // Reset both active IDs – we'll set the correct one in applyMainView
  activeJournalEntryId = null;
  activeNotesDocId = null;

  mainView = view;
  window.mainView = view;
  // Sync currentTab for compatibility with render logic
  if (view === 'goals') currentTab = 'goals';
  else if (view === 'journal') currentTab = 'notes'; // journal uses notes tab
  else currentTab = 'notes';

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
  const notesArea = document.getElementById('notes-textarea');

  // Hide all main views
  if (notesTab) notesTab.style.display = 'none';
  if (goalsTab) goalsTab.style.display = 'none';
  if (journalTab) journalTab.style.display = 'none';
  if (mainEl) mainEl.classList.remove('goals-active', 'notes-active', 'journal-active');

  if (mainView === 'goals') {
    if (goalsTab) {
      goalsTab.style.display = 'block';
      const goalsList = document.getElementById('goals-list');
      const goalsContainer = document.getElementById('goals-container');
      if (goalsList) goalsList.style.display = 'flex';
      if (goalsContainer) {
        goalsContainer.style.height = '100%';
        // Force reflow
        goalsContainer.offsetHeight;
      }
      // Force layout recalculation
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

  } else if (mainView === 'journal') {
    // ── JOURNAL ──────────────────────────────
    if (notesTab) {
      notesTab.style.display = 'flex';
      notesTab.style.flexDirection = 'column';
    }
    const journalSection = document.getElementById('journal-section');
    if (journalSection) journalSection.style.display = 'none';

    if (notesArea) {
      notesArea.style.display = 'block';
      notesArea.disabled = false;
      notesArea.readOnly = false;
      notesArea.placeholder = 'Select or create a journal entry';
      // Load the active journal entry (if any)
      loadActiveJournalEntryToTextarea();
    }

    if (mainEl) mainEl.classList.add('journal-active');
    if (fab) fab.style.display = 'none';
    renderPanelForView('journal');

  } else { // notes
    // ── NOTES ────────────────────────────────
    if (notesTab) {
      notesTab.style.display = 'flex';
      notesTab.style.flexDirection = 'column';
    }
    if (notesArea) {
      notesArea.style.display = 'block';
      notesArea.disabled = false;
      notesArea.readOnly = false;
      notesArea.placeholder = 'Jot down your thoughts...';
      // Load the active notes doc
      const docs = window._notesDocs || [];
      let activeDoc = null;
      if (activeNotesDocId) {
        activeDoc = docs.find(d => d.id === activeNotesDocId);
      }
      if (!activeDoc && docs.length > 0) {
        activeDoc = docs[0];
        activeNotesDocId = activeDoc.id;
        if (typeof setActiveNotesDocId === 'function') setActiveNotesDocId(activeDoc.id);
      }
      if (activeDoc) {
        notesArea.value = activeDoc.content || '';
      } else {
        notesArea.value = '';
      }
    }
    if (mainEl) mainEl.classList.add('notes-active');
    if (fab) fab.style.display = '';  // FAB is hidden on desktop anyway
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
  const sidePanel = document.getElementById('side-panel');
  if (sidePanel) {
    sidePanel.classList.toggle('view-todo', view === 'todo');
  }

  const panelTitle = document.getElementById('panel-title');
  const todoCont = document.getElementById('panel-todo-content');
  const journalCont = document.getElementById('panel-journal-content');
  const notesCont = document.getElementById('panel-notes-content');
  const dateNav = document.getElementById('panel-date-navigator');

  // ─── BUTTON MANAGEMENT ─────────────────────────────
  const micBtn = document.getElementById('panel-mic-btn');
  const polishBtn = document.getElementById('panel-polish-btn');

  // Remove buttons if they exist and we're NOT in journal/notes
  if (view !== 'journal' && view !== 'notes') {
    if (micBtn) micBtn.remove();
    if (polishBtn) polishBtn.remove();
  }

  // If we're in journal/notes and buttons don't exist, create them
  if ((view === 'journal' || view === 'notes') && (!micBtn || !polishBtn)) {
    // Clean up any partial leftovers
    document.getElementById('panel-mic-btn')?.remove();
    document.getElementById('panel-polish-btn')?.remove();
    // Inject fresh buttons
    if (typeof injectPanelMicButton === 'function') {
      injectPanelMicButton();
    }
  }
  // ─── END BUTTON MANAGEMENT ─────────────────────────

  // Hide all panel content
  if (todoCont) todoCont.style.display = 'none';
  if (journalCont) journalCont.style.display = 'none';
  if (notesCont) notesCont.style.display = 'none';

  // Hide date navigator by default
  if (dateNav) dateNav.style.display = 'none';

  // Handle fraction element in panel header
  const headerRight = document.getElementById('side-panel-actions');
  let fractionEl = document.getElementById('panel-task-fraction');

  // Reset edit mode on view change
  document.getElementById('side-panel')?.classList.remove('edit-mode');
  const editBtn = document.getElementById('panel-edit-btn');
  if (editBtn) {
    editBtn.classList.remove('active');
    editBtn.style.display = ['todo', 'journal', 'notes'].includes(view) ? '' : 'none';
  }

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

    // Create fraction element if not exists
    if (!fractionEl) {
      fractionEl = document.createElement('span');
      fractionEl.id = 'panel-task-fraction';
      fractionEl.className = 'panel-task-fraction';
      // Insert before the add button
      const addBtn = document.getElementById('panel-add-btn');
      if (headerRight && addBtn) {
        headerRight.insertBefore(fractionEl, addBtn);
      } else if (headerRight) {
        headerRight.appendChild(fractionEl);
      }
    }
    fractionEl.style.display = 'inline-block';
    // Update its content immediately (renderTodo will also update it)
    updatePanelTaskFraction();
  } else {
    // Hide fraction for other views
    if (fractionEl) fractionEl.style.display = 'none';

    if (view === 'journal') {
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
}

// ── PANEL OPEN / CLOSE ──────────────────────
function toggleSidePanel() { panelOpen = !panelOpen; applyPanelState(); }

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
    renderPanelForView(mainView === 'goals' ? 'todo' : mainView);
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

// ── PANEL JOURNAL ENTRIES ────────────────────
function refreshPanelJournalEntries() {
  const container = document.getElementById('panel-journal-entries');
  if (!container) return;
  const allEntries = getJournalEntries();
  allEntries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (allEntries.length === 0) {
    container.innerHTML = `<div class="journal-empty">No journal entries yet. Click + to add one.</div>`;
    return;
  }
  container.innerHTML = '';
  allEntries.forEach(entry => {
    const date = new Date(entry.created_at);
    const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const content = entry.content || '';
    const isActive = entry.id === activeJournalEntryId;

    const row = document.createElement('div');
    row.className = 'todo-item-row panel-journal-row';
    row.setAttribute('data-type', 'journal');
    row.setAttribute('data-id', entry.id);
    row.style.cursor = 'pointer';
    row.innerHTML = `
      <button class="todo-delete-btn">✕</button>
      <div class="todo-item-icon">📓</div>
      <div class="todo-item-body" style="flex:1;">
        <span class="todo-item-name">${timeStr}</span>
        <div class="todo-item-meta" style="font-size:13px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${content.substring(0, 100)}${content.length > 100 ? '...' : ''}</div>
      </div>
      ${isActive ? '<span style="color:var(--mint);font-size:12px;margin-left:8px;">✓</span>' : ''}
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      loadJournalEntryToNotes(entry.id, content);
    });

    const delBtn = row.querySelector('.todo-delete-btn');
    if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); deletePanelJournalEntry(entry.id); });

    container.appendChild(row);
  });
}

// ── PANEL NOTES DOCS ─────────────────────────
function refreshPanelNotes() {
  const container = document.getElementById('panel-notes-current');
  if (!container) return;
  const docs = window._notesDocs || [];
  if (docs.length === 0) {
    container.innerHTML = `<div class="journal-empty">No notes yet. Click + to create one.</div>`;
    return;
  }
  container.innerHTML = '';
  docs.forEach(doc => {
    const isActive = doc.id === activeNotesDocId;
    const safeTitle = escHtml(doc.title || 'Untitled');
    const content = doc.content || '';

    const row = document.createElement('div');
    row.className = 'todo-item-row panel-note-row';
    row.setAttribute('data-type', 'note');
    row.setAttribute('data-id', doc.id);
    row.style.cursor = 'pointer';
    row.innerHTML = `
      <button class="todo-delete-btn">✕</button>
      <div class="todo-item-icon">📄</div>
      <div class="todo-item-body" style="flex:1;">
        <span class="todo-item-name">${safeTitle}</span>
        <div class="todo-item-meta" style="font-size:13px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${content.substring(0, 100)}${content.length > 100 ? '...' : ''}</div>
      </div>
      ${isActive ? '<span style="color:var(--mint);font-size:12px;margin-left:8px;">✓</span>' : ''}
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      loadNotesDocToTextarea(doc.id, content);
    });

    const delBtn = row.querySelector('.todo-delete-btn');
    if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); deletePanelNotesDoc(doc.id); });

    container.appendChild(row);
  });
}
window.refreshPanelNotes = refreshPanelNotes;

// ── LOAD CONTENT INTO TEXTAREA ───────────────
async function loadNotesDocToTextarea(docId, content) {
  flushPendingSaves();
  // FIX: update in-memory var synchronously before any async work
  activeNotesDocId = docId;
  activeJournalEntryId = null;
  if (typeof setActiveNotesDocId === 'function') setActiveNotesDocId(docId);
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.value = content;
    refreshPanelNotes();
  }
}
window.loadNotesDocToTextarea = loadNotesDocToTextarea;

function loadJournalEntryToNotes(entryId, content) {
  flushPendingSaves();
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

  notesArea.disabled = false;
  notesArea.readOnly = false;

  if (activeJournalEntryId) {
    const entries = getJournalEntries();
    const entry = entries.find(e => e.id === activeJournalEntryId);
    if (entry) {
      notesArea.value = entry.content || '';
      notesArea.placeholder = 'Write your journal entry...';
    } else {
      activeJournalEntryId = null;
      notesArea.value = '';
      notesArea.placeholder = 'Select or create a journal entry';
    }
  } else {
    notesArea.value = '';
    notesArea.placeholder = 'Select or create a journal entry';
  }
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
  const docs = window._notesDocs || [];
  const doc = docs.find(d => d.id === activeNotesDocId);
  if (doc) {
    doc.content = content;
    window._notesDocs = docs;
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

// FIX: flushPendingSaves now captures active IDs synchronously at call time,
// then performs targeted DB updates using those captured IDs — no DB re-fetch
// means no race with a just-written new active ID.
function flushPendingSaves() {
  clearTimeout(notesSaveTimeout);
  clearTimeout(journalSaveTimeout);
  notesSaveTimeout = null;
  journalSaveTimeout = null;

  const notesArea = document.getElementById('notes-textarea');
  if (!notesArea) return;

  const content = notesArea.value;

  // Capture IDs synchronously right now before any async work
  const capturedJournalId = activeJournalEntryId;
  const capturedNotesId = activeNotesDocId;

  if (capturedJournalId) {
    // Save journal entry using captured ID
    const entries = getJournalEntries();
    const entry = entries.find(e => e.id === capturedJournalId);
    if (entry) {
      entry.content = content;
      saveJournalEntries(entries);
      if (typeof refreshPanelJournalEntries === 'function') refreshPanelJournalEntries();
      // FIX: use captured ID directly — not re-fetched from DB
      try { supabase.from('journal_entries').eq('id', capturedJournalId).update({ content }); } catch (e) {}
    }
  } else if (capturedNotesId) {
    // Save notes doc using captured ID
    const docs = window._notesDocs || [];
    const doc = docs.find(d => d.id === capturedNotesId);
    if (doc) {
      doc.content = content;
      window._notesDocs = docs;
      if (typeof setNotesDocs === 'function') setNotesDocs(docs);
      if (typeof refreshPanelNotes === 'function') refreshPanelNotes();
      // FIX: targeted single-row update with captured ID — no saveNotesToDB
      // (which would call getActiveNotesDocId() from DB and risk getting the new ID)
      const now = new Date().toISOString();
      try { supabase.from('notes').eq('id', capturedNotesId).update({ content, updated_at: now }); } catch (e) {}
    }
  } else {
    // Legacy fallback (no doc/journal active)
    if (typeof saveNotesToDB === 'function') {
      try { saveNotesToDB(content); } catch (e) {}
    }
  }
}

window.flushPendingSaves = flushPendingSaves;

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
  const docs = window._notesDocs || [];
  const filtered = docs.filter(d => d.id !== id);
  window._notesDocs = filtered;
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
    if (typeof saveNotesToDB === 'function') await saveNotesToDB('');
  }
  showToast('Note deleted');
}
window.deletePanelNotesDoc = deletePanelNotesDoc;

// ── INPUT LISTENER (strict separation) ───────
document.addEventListener('DOMContentLoaded', () => {
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.addEventListener('input', (e) => {
      const content = e.target.value;

      if (mainView === 'journal') {
        // Only save to journal
        if (activeJournalEntryId) {
          scheduleJournalSave(content);
        } else {
          // Auto-create a blank entry when typing starts
          createAndLoadBlankJournalEntry().then(() => {
            scheduleJournalSave(content);
          });
        }
      } else if (mainView === 'notes') {
        // Only save to notes
        if (activeNotesDocId) {
          scheduleNotesDocSave(content);
        } else {
          // If no doc, fallback to legacy notes save
          if (typeof scheduleNotesSave === 'function') {
            scheduleNotesSave(content);
          }
        }
      }
      // If mainView is 'goals', we ignore input completely.
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
  setMainView('goals');

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

  let _resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeT);
    _resizeT = setTimeout(() => {
      if (isDesktop()) updateToggleBtnPosition();
    }, 150);
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

// Called when init.js finishes loading all data
window.onDataReady = function() {
  if (!isDesktop()) return;
  applyMainView();
  setTimeout(() => {
    if (mainView === 'goals' && goals.length > 0) {
      const wrap = document.getElementById('goal-graph-wrap');
      if (wrap) autoFitAndCenterGraph(wrap);
      else renderGoalGraph();
    }
  }, 150);
};