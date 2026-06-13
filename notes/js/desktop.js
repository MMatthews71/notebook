// ─────────────────────────────────────────────
//  DESKTOP SIDE PANEL — notes list + editor
// ─────────────────────────────────────────────

let panelOpen = true;
let activeNotesDocId = null;       // legacy (kept for mobile compat)
let activeNotesEntryId = null;     // desktop notes entry
let mainView = 'notes';
window.mainView = mainView;
let notesEntrySaveTimeout = null;

// In-memory cache — populated by initApp, kept in sync
let _notesEntriesCache = [];

function getNotesEntries() { return _notesEntriesCache; }
function saveNotesEntries(arr) { _notesEntriesCache = arr; }

// Called from init.js to seed the notes entries cache from DB rows
window.initNotesEntries = function(rows) {
  _notesEntriesCache = (rows || []).map(r => ({
    id: r.id,
    content: r.content || '',
    title: r.title || '',
    created_at: r.created_at || r.updated_at || new Date().toISOString(),
  }));
  _notesEntriesCache.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
};

function isDesktop() {
  return window.matchMedia('(min-width: 768px)').matches;
}

// Synchronous getter so journal.js can read the in-memory activeNotesDocId
// without async DB calls, eliminating the race in updateActiveNotesDocContent.
window._getDesktopActiveNotesDocId = function() {
  return activeNotesDocId;
};

// Synchronous setter so journal.js can update this variable immediately
// (before any async work) when switching notes docs. This ensures the
// textarea input handler always targets the correct doc.
window.setActiveNotesDocIdInMemory = function(id) {
  activeNotesDocId = id;
  activeNotesEntryId = null;  // prevent stale entry ID intercepting saves after a doc switch
};

// Lay out the desktop split view: editor on the left, notes list panel on
// the right. Called by init.js once data is loaded.
function applyMainView() {
  if (!isDesktop()) return;
  const notesTab = document.getElementById('tab-notes');
  const notesArea = document.getElementById('notes-textarea');

  if (notesTab) { notesTab.style.display = 'flex'; notesTab.style.flexDirection = 'column'; }
  if (notesArea) {
    notesArea.style.display = 'block';
    notesArea.setAttribute('data-placeholder', 'Select or create a note');
    loadActiveNotesEntryToTextarea();
  }
  renderPanelForView();
}
window.applyMainView = applyMainView;

// ── PANEL CONTENT RENDERER ───────────────────
function renderPanelForView() {
  const notesCont = document.getElementById('panel-notes-content');
  if (notesCont) {
    notesCont.style.display = 'block';
    notesCont.innerHTML = '<div id="panel-notes-current"></div>';
    refreshPanelNotes();
  }
}

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
    renderPanelForView();
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

// ── PIN HELPERS ───────────────────────────────
function getPinnedNoteIds() {
  try { return JSON.parse(localStorage.getItem('pinned_note_ids') || '[]'); } catch { return []; }
}
function setPinnedNoteIds(ids) {
  localStorage.setItem('pinned_note_ids', JSON.stringify(ids));
}
function togglePinNote(id) {
  const pinned = getPinnedNoteIds();
  const idx = pinned.indexOf(id);
  if (idx === -1) pinned.unshift(id);
  else pinned.splice(idx, 1);
  setPinnedNoteIds(pinned);
  refreshPanelNotes();
}
window.togglePinNote = togglePinNote;

// ── PANEL NOTES ENTRIES ──────────────────────
function refreshPanelNotes() {
  const container = document.getElementById('panel-notes-current');
  if (!container) return;
  const allEntries = getNotesEntries();

  if (allEntries.length === 0) {
    container.innerHTML = '<div class="note-list-empty">No notes yet.<br>Press + to create one.</div>';
    return;
  }

  const pinnedIds = getPinnedNoteIds();
  const pinnedEntries = allEntries.filter(e => pinnedIds.includes(e.id))
    .sort((a, b) => pinnedIds.indexOf(a.id) - pinnedIds.indexOf(b.id));
  const unpinnedEntries = allEntries.filter(e => !pinnedIds.includes(e.id));
  const sorted = [...pinnedEntries, ...unpinnedEntries];

  const PIN_SVG = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V17z"/></svg>`;

  container.innerHTML = '';

  sorted.forEach((entry, i) => {
    if (pinnedEntries.length > 0 && unpinnedEntries.length > 0 && i === pinnedEntries.length) {
      const divider = document.createElement('div');
      divider.className = 'note-section-divider';
      container.appendChild(divider);
    }

    const isPinned = pinnedIds.includes(entry.id);
    const title = escHtml(entry.title || 'Untitled');
    const isActive = entry.id === activeNotesEntryId;

    const row = document.createElement('div');
    row.className = 'note-row' + (isActive ? ' active' : '') + (isPinned ? ' pinned' : '');
    row.dataset.id = entry.id;
    row.innerHTML = `
      <div class="note-row-body">
        <div class="note-row-title">${title}</div>
      </div>
      <div class="note-row-actions">
        <button class="note-row-btn note-row-pin${isPinned ? ' is-pinned' : ''}" title="${isPinned ? 'Unpin' : 'Pin'}">${PIN_SVG}</button>
        <button class="note-row-btn note-row-rename" title="Rename">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="note-row-btn note-row-delete" title="Delete">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>`;

    row.addEventListener('click', (e) => {
      if (e.target.closest('.note-row-actions')) return;
      loadNotesEntryToTextarea(entry.id, entry.content || '');
    });

    row.querySelector('.note-row-pin').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePinNote(entry.id);
    });

    row.querySelector('.note-row-rename').addEventListener('click', (e) => {
      e.stopPropagation();
      startRenameNotesEntry(entry.id, entry.title || '', row);
    });

    row.querySelector('.note-row-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      withConfirm(e.currentTarget, () => deletePanelNotesEntry(entry.id));
    });

    container.appendChild(row);
  });
}
window.refreshPanelNotes = refreshPanelNotes;

// ── INLINE RENAME ──────────────────────────
function startRenameNotesEntry(id, currentTitle, row) {
  const titleEl = row.querySelector('.note-row-title');
  const renameBtn = row.querySelector('.note-row-rename');
  if (!titleEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentTitle;
  input.placeholder = 'Note title…';
  input.className = 'note-rename-input';
  input.addEventListener('click', e => e.stopPropagation());

  titleEl.replaceWith(input);
  if (renameBtn) renameBtn.style.display = 'none';
  input.focus();
  input.select();

  const commit = async () => {
    const newTitle = input.value.trim();
    await saveNotesEntryTitle(id, newTitle);
    // Full re-render to restore proper DOM
    refreshPanelNotes();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      input.removeEventListener('blur', commit);
      refreshPanelNotes(); // cancel — restore
    }
  });
}

async function saveNotesEntryTitle(id, title) {
  const entries = getNotesEntries();
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  entry.title = title;
  saveNotesEntries(entries);
  try { await supabase.from('notes').eq('id', id).update({ title }); }
  catch (e) { console.error('[saveNotesEntryTitle]', e); }
}

// ── LOAD CONTENT INTO TEXTAREA ───────────────
function loadNotesEntryToTextarea(entryId, content) {
  flushPendingSaves();
  activeNotesEntryId = entryId;
  activeNotesDocId = null;
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.innerHTML = content;
    notesArea.setAttribute('data-placeholder', 'Write your note…');
    refreshPanelNotes();
  }
}
window.loadNotesEntryToTextarea = loadNotesEntryToTextarea;

// Load whatever note entry was last active
function loadActiveNotesEntryToTextarea() {
  const notesArea = document.getElementById('notes-textarea');
  if (!notesArea) return;
  if (activeNotesEntryId) {
    const entry = getNotesEntries().find(e => e.id === activeNotesEntryId);
    if (entry) { notesArea.innerHTML = entry.content || ''; return; }
    activeNotesEntryId = null;
  }
  notesArea.innerHTML = '';
  notesArea.setAttribute('data-placeholder', 'Select or create a note');
}

// Legacy — kept so mobile journal.js code still works
async function loadNotesDocToTextarea(docId, content) {
  loadNotesEntryToTextarea(docId, content);
}
window.loadNotesDocToTextarea = loadNotesDocToTextarea;

// ── CREATE BLANK NOTE ENTRY ──────────────────
async function createAndLoadBlankNotesEntry() {
  const now = new Date().toISOString();
  const newEntry = { id: crypto.randomUUID(), content: '', title: '', created_at: now };
  const entries = getNotesEntries();
  entries.unshift(newEntry);
  saveNotesEntries(entries);
  refreshPanelNotes();
  loadNotesEntryToTextarea(newEntry.id, '');
  try {
    await supabase.from('notes').insert([{
      id: newEntry.id, content: '', title: '',
      created_at: now, updated_at: now,
    }]);
  } catch (e) { console.error('[createAndLoadBlankNotesEntry]', e); }
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) notesArea.focus();
}
window.createAndLoadBlankNotesEntry = createAndLoadBlankNotesEntry;

// ── SAVE NOTE ENTRY ──────────────────────────
async function _desktopSaveNotesEntry(content) {
  if (!activeNotesEntryId) return;
  const entries = getNotesEntries();
  const entry = entries.find(e => e.id === activeNotesEntryId);
  if (entry) {
    entry.content = content;
    saveNotesEntries(entries);
    refreshPanelNotes();
    try { await supabase.from('notes').eq('id', activeNotesEntryId).update({ content, updated_at: new Date().toISOString() }); }
    catch (e) { console.error('[_desktopSaveNotesEntry]', e); }
  }
}

function scheduleNotesEntrySave(content) {
  if (!activeNotesEntryId) return;
  clearTimeout(notesEntrySaveTimeout);
  notesEntrySaveTimeout = setTimeout(() => _desktopSaveNotesEntry(content), 1000);
}

// ── DELETE NOTE ENTRY ────────────────────────
async function deletePanelNotesEntry(id) {
  flushPendingSaves();
  const filtered = getNotesEntries().filter(e => e.id !== id);
  saveNotesEntries(filtered);
  if (activeNotesEntryId === id) {
    activeNotesEntryId = null;
    const notesArea = document.getElementById('notes-textarea');
    if (notesArea) { notesArea.innerHTML = ''; notesArea.setAttribute('data-placeholder', 'Select or create a note'); }
  }
  refreshPanelNotes();
  try { await supabase.from('notes').eq('id', id).delete(); showToast('Note deleted'); }
  catch (e) { showToast('Note deleted locally'); }
}
window.deletePanelNotesEntry = deletePanelNotesEntry;

// deletePanelNotesDoc — delegates to entry-based delete (mobile manager modal)
async function deletePanelNotesDoc(id) {
  await deletePanelNotesEntry(id);
}
window.deletePanelNotesDoc = deletePanelNotesDoc;

// ── FLUSH PENDING SAVES ──────────────────────
// Captures the active ID synchronously, then persists. Two save targets:
// desktop notes entry and the legacy mobile notes doc.
function flushPendingSaves() {
  clearTimeout(notesEntrySaveTimeout);
  notesEntrySaveTimeout = null;

  const notesArea = document.getElementById('notes-textarea');
  if (!notesArea) return;

  // Capture synchronously before any async work
  const capturedNotesEntryId = activeNotesEntryId;
  const capturedNotesDocId   = activeNotesDocId;   // legacy

  if (capturedNotesEntryId) {
    const content = notesArea.innerHTML;            // notes = rich text HTML
    const entries = getNotesEntries();
    const entry = entries.find(e => e.id === capturedNotesEntryId);
    if (entry) {
      entry.content = content;
      saveNotesEntries(entries);
      refreshPanelNotes();
      try { supabase.from('notes').eq('id', capturedNotesEntryId).update({ content, updated_at: new Date().toISOString() }); } catch (e) {}
    }
  } else if (capturedNotesDocId) {
    // Legacy: mobile notes doc
    const content = notesArea.innerHTML;
    const docs = window._notesDocs || [];
    const doc = docs.find(d => d.id === capturedNotesDocId);
    if (doc) {
      const now = new Date().toISOString();
      doc.content = content; doc.updated_at = now;
      window._notesDocs = docs;
      try { supabase.from('notes').eq('id', capturedNotesDocId).update({ content, updated_at: now }); } catch (e) {}
    }
  }
}
window.flushPendingSaves = flushPendingSaves;

// ── INPUT LISTENER ────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.addEventListener('input', (e) => {
      const content = e.target.innerHTML; // rich text
      if (activeNotesEntryId) {
        scheduleNotesEntrySave(content);
      } else if (activeNotesDocId) {
        // Mobile / legacy-docs fallback: after switchToNotesDoc() the entry ID
        // is cleared but the doc ID is set — save via the docs path.
        if (typeof scheduleNotesSave === 'function') scheduleNotesSave(content);
      } else {
        // Auto-create on first keystroke (no active note at all)
        createAndLoadBlankNotesEntry().then(() => scheduleNotesEntrySave(content));
      }
    });
  }
});

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

  applyPanelState();

  let _resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeT);
    _resizeT = setTimeout(() => {
      if (isDesktop()) updateToggleBtnPosition();
    }, 150);
  });
});
