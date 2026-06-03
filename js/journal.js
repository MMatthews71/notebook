// ─────────────────────────────────────────────
//  NOTES — Supabase persistence
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  NOTES RICH-TEXT EDITOR HELPERS
// ─────────────────────────────────────────────

function getEditor() {
  return document.getElementById('notes-textarea');
}

// execCommand wrapper — keeps selection alive by preventing toolbar mousedown
// from stealing focus, then runs the command and fires input to trigger save.
function execFmt(cmd, value) {
  const ed = getEditor();
  if (!ed) return;
  ed.focus();
  document.execCommand(cmd, false, value || null);
  ed.dispatchEvent(new Event('input', { bubbles: true }));
}

function formatBold()     { execFmt('bold'); }
function formatItalic()   { execFmt('italic'); }
function formatStrike()   { execFmt('strikeThrough'); }
function formatH1()       { execFmt('formatBlock', 'h1'); }
function formatH2()       { execFmt('formatBlock', 'h2'); }
function formatH3()       { execFmt('formatBlock', 'h3'); }
function formatBullet()   { execFmt('insertUnorderedList'); }
function formatNumbered() { execFmt('insertOrderedList'); }
function formatHR()       { execFmt('insertHorizontalRule'); }

function formatCode() {
  const ed = getEditor();
  if (!ed) return;
  ed.focus();
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const code = document.createElement('code');
  if (!sel.isCollapsed) {
    try { range.surroundContents(code); } catch {}
  } else {
    code.innerHTML = '&#8203;'; // zero-width space so cursor can enter
    range.insertNode(code);
    const r = document.createRange();
    r.setStart(code.firstChild, 1);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  ed.dispatchEvent(new Event('input', { bubbles: true }));
}

function formatCodeBlock() {
  execFmt('formatBlock', 'pre');
}

// Attach toolbar event listeners
function initNotesToolbar() {
  const toolbar = document.querySelector('.notes-toolbar');
  if (!toolbar) return;

  // Prevent toolbar clicks from stealing focus / collapsing selection
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.format-btn')) e.preventDefault();
  });

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.format-btn');
    if (!btn) return;
    const format = btn.dataset.format;
    switch (format) {
      case 'bold':      formatBold();      break;
      case 'italic':    formatItalic();    break;
      case 'strike':    formatStrike();    break;
      case 'h1':        formatH1();        break;
      case 'h2':        formatH2();        break;
      case 'h3':        formatH3();        break;
      case 'bullet':    formatBullet();    break;
      case 'numbered':  formatNumbered();  break;
      case 'code':      formatCode();      break;
      case 'codeblock': formatCodeBlock(); break;
      case 'hr':        formatHR();        break;
    }
    haptic([10]);
  });

  // Keyboard shortcuts
  const ed = getEditor();
  if (ed) {
    ed.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'b') { e.preventDefault(); formatBold(); }
        else if (e.key === 'i') { e.preventDefault(); formatItalic(); }
      }
    });
  }
}

// Call init after DOM ready
document.addEventListener('DOMContentLoaded', initNotesToolbar);

async function getNotesId() {
  let id = await supabase.getPref('notes_id');
  if (!id) { id = crypto.randomUUID(); await supabase.setPref('notes_id', id); }
  return id;
}

async function getNotesDocs() {
  const { data, error } = await supabase.from('notes').select('*');
  if (error) throw error;
  return data || [];
}

function setNotesDocs(docs) {
  window._notesDocs = docs;
}

async function getActiveNotesDocId() {
  return await supabase.getPref('active_notes_doc_id') || '';
}

async function setActiveNotesDocId(id) {
  await supabase.setPref('active_notes_doc_id', id);
}

async function ensureNotesDocsInitialized(initialContent = '') {
  const docs = (window._notesDocs && window._notesDocs.length > 0)
    ? window._notesDocs
    : await getNotesDocs();
  if (docs.length > 0) {
    window._notesDocs = docs;
    const activeId = await getActiveNotesDocId();
    if (!activeId || !docs.some(d => d.id === activeId)) await setActiveNotesDocId(docs[0].id);
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const first = { id, title: 'Notes', content: initialContent || '', updated_at: now };
  window._notesDocs = [first];
  await supabase.from('notes').insert(first);
  await setActiveNotesDocId(id);
  if (typeof window.setActiveNotesDocIdInMemory === 'function') {
    window.setActiveNotesDocIdInMemory(id);
  }
}

async function getActiveNotesDoc() {
  const docs = (window._notesDocs && window._notesDocs.length > 0)
    ? window._notesDocs
    : await getNotesDocs();
  const activeId = await getActiveNotesDocId();
  return docs.find(d => d.id === activeId) || docs[0] || null;
}

// FIX: Use in-memory cache and targeted single-doc update to avoid race conditions.
// Previously this called getNotesDocs() and getActiveNotesDocId() from the DB,
// which could race with a just-written new active ID and corrupt the wrong doc.
async function updateActiveNotesDocContent(content) {
  // Prefer desktop.js's synchronous in-memory activeNotesDocId (set before any async work).
  // Fall back to DB only if unavailable.
  let activeId = null;
  if (typeof window._getDesktopActiveNotesDocId === 'function') {
    activeId = window._getDesktopActiveNotesDocId();
  }
  if (!activeId) {
    activeId = await getActiveNotesDocId();
  }
  if (!activeId) return;

  const now = new Date().toISOString();

  // Update in-memory cache without touching other docs
  const docs = window._notesDocs || [];
  window._notesDocs = docs.map(d => d.id === activeId ? { ...d, content, updated_at: now } : d);

  // Targeted single-row update — no full upsert of all docs
  const { error } = await supabase.from('notes').eq('id', activeId).update({ content, updated_at: now });
  if (error) throw error;
}

// FIX: No longer fires scheduleNotesSave after loading (prevented saving new-doc
// content back to the old doc). Also updates desktop.js's in-memory activeNotesDocId
// BEFORE the async setActiveNotesDocId DB write, so the input handler always has
// the correct ID to save to.
async function switchToNotesDoc(id) {
  if (typeof flushPendingSaves === 'function') flushPendingSaves();

  // Use in-memory cache to avoid an extra DB fetch
  const docs = (window._notesDocs && window._notesDocs.length > 0)
    ? window._notesDocs
    : await getNotesDocs();
  const doc = docs.find(d => d.id === id);
  if (!doc) return;

  // Update desktop.js's in-memory variable FIRST (synchronously), so the input
  // listener immediately targets the correct doc before any await completes.
  if (typeof window.setActiveNotesDocIdInMemory === 'function') {
    window.setActiveNotesDocIdInMemory(id);
  }

  // Then persist to DB (async — order no longer matters for save correctness)
  await setActiveNotesDocId(id);

  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) notesArea.innerHTML = doc.content || '';
  if (typeof refreshPanelNotes === 'function') refreshPanelNotes();
  updateMobileNoteTitle();
}

async function fetchNotes() {
  const docs = (window._notesDocs && window._notesDocs.length > 0)
    ? window._notesDocs
    : await getNotesDocs();
  const activeId = await getActiveNotesDocId();
  const doc = docs.find(d => d.id === activeId) || docs[0];
  return doc ? doc.content || '' : '';
}

async function saveNotesToDB(content) {
  await updateActiveNotesDocContent(content);
}

let _notesSaveTimer = null;

function scheduleNotesSave(content) {
  clearTimeout(_notesSaveTimer);
  _notesSaveTimer = setTimeout(() => saveNotesToDB(content), 1000);
}

function openNotesManagerModal() {
  const modal = document.getElementById('notes-manager-modal');
  if (!modal) return;
  const titleEl = document.getElementById('notes-new-title');
  if (titleEl) titleEl.value = '';
  renderNotesDocsList();
  modal.classList.add('open');
  haptic([15]);
}

function closeNotesManagerModal() {
  const modal = document.getElementById('notes-manager-modal');
  if (modal) modal.classList.remove('open');
}

function closeNotesManagerOnBackdrop(e) {
  if (e.target === document.getElementById('notes-manager-modal')) closeNotesManagerModal();
}

async function createNewNoteDoc() {
  const notesArea = document.getElementById('notes-textarea');
  await ensureNotesDocsInitialized(notesArea ? notesArea.innerHTML : '');
  const titleEl = document.getElementById('notes-new-title');
  const title = (titleEl && titleEl.value ? titleEl.value.trim() : '') || 'Untitled';
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const newDoc = { id, title, content: '', updated_at: now };

  // Add to in-memory cache immediately so switchToNotesDoc can find it without a DB fetch
  window._notesDocs = [newDoc, ...(window._notesDocs || [])];

  await supabase.from('notes').insert(newDoc);
  await switchToNotesDoc(id);
  renderNotesDocsList();
  updateMobileNoteTitle();
  closeNotesManagerModal();
}

async function updateMobileNoteTitle() {
  const el = document.getElementById('mobile-note-title');
  if (!el) return;
  let activeId = null;
  if (typeof window._getDesktopActiveNotesDocId === 'function') activeId = window._getDesktopActiveNotesDocId();
  const docs = window._notesDocs || [];
  const doc = docs.find(d => d.id === activeId);
  el.textContent = (doc && doc.title) ? doc.title : (docs.length === 0 ? 'New Note' : 'Notes');
}
window.updateMobileNoteTitle = updateMobileNoteTitle;

async function renderNotesDocsList() {
  const notesArea = document.getElementById('notes-textarea');
  await ensureNotesDocsInitialized(notesArea ? notesArea.innerHTML : '');
  const list = document.getElementById('notes-docs-list');
  if (!list) return;
  let docs = (window._notesDocs && window._notesDocs.length > 0)
    ? window._notesDocs
    : await getNotesDocs();

  // Apply saved order
  try {
    const orderPref = await supabase.getPref('notes_order');
    if (orderPref) {
      const order = JSON.parse(orderPref);
      docs = [...docs].sort((a, b) => {
        const ai = order.indexOf(a.id), bi = order.indexOf(b.id);
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1; if (bi === -1) return -1;
        return ai - bi;
      });
      window._notesDocs = docs;
    }
  } catch {}

  let activeId = null;
  if (typeof window._getDesktopActiveNotesDocId === 'function') activeId = window._getDesktopActiveNotesDocId();
  if (!activeId) activeId = await getActiveNotesDocId();
  if (docs.length === 0) { list.innerHTML = '<div class="journal-empty">No notes yet.</div>'; return; }

  list.innerHTML = docs.map((d, i) => {
    const isActive = d.id === activeId;
    const safeTitle = escHtml(d.title || 'Untitled');
    const tmp = document.createElement('div');
    tmp.innerHTML = d.content || '';
    const preview = escHtml((tmp.textContent || '').trim().substring(0, 60));
    return `
      <div class="notes-doc-row" draggable="true" data-doc-id="${d.id}" data-doc-idx="${i}">
        <span class="notes-doc-drag">⠿</span>
        <button class="notes-doc-btn${isActive ? ' active-doc' : ''}" onclick="openNotesDoc('${d.id}')">
          <div style="min-width:0;flex:1">
            <div class="notes-doc-title">${safeTitle}</div>
            ${preview ? `<div class="notes-doc-preview">${preview}</div>` : ''}
          </div>
          ${isActive ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="flex-shrink:0;color:var(--mint)"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>` : ''}
        </button>
        <button class="notes-doc-delete-btn" onclick="deletePanelNotesDoc('${d.id}')" title="Delete note">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </button>
      </div>
    `;
  }).join('');

  // Wire up drag-to-reorder
  let dragSrcIdx = null;
  list.querySelectorAll('.notes-doc-row').forEach(row => {
    row.addEventListener('dragstart', e => {
      dragSrcIdx = parseInt(row.dataset.docIdx);
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      list.querySelectorAll('.notes-doc-row').forEach(r => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    row.addEventListener('dragenter', () => {
      list.querySelectorAll('.notes-doc-row').forEach(r => r.classList.remove('drag-over'));
      row.classList.add('drag-over');
    });
    row.addEventListener('drop', async e => {
      e.preventDefault();
      const dropIdx = parseInt(row.dataset.docIdx);
      if (dragSrcIdx === null || dragSrcIdx === dropIdx) return;
      const d = window._notesDocs || [];
      const moved = d.splice(dragSrcIdx, 1)[0];
      d.splice(dropIdx, 0, moved);
      window._notesDocs = [...d];
      await supabase.setPref('notes_order', JSON.stringify(d.map(x => x.id)));
      dragSrcIdx = null;
      renderNotesDocsList();
    });
  });
}

function openNotesDoc(id) {
  switchToNotesDoc(id);
  closeNotesManagerModal();
}

window.openNotesManagerModal = openNotesManagerModal;
window.closeNotesManagerModal = closeNotesManagerModal;
window.closeNotesManagerOnBackdrop = closeNotesManagerOnBackdrop;
window.createNewNoteDoc = createNewNoteDoc;
window.openNotesDoc = openNotesDoc;
window.ensureNotesDocsInitialized = ensureNotesDocsInitialized;

// ─────────────────────────────────────────────
//  JOURNAL — Local persistence
// ─────────────────────────────────────────────
const _LOCAL_JOURNAL_KEY = 'local_journal';
let _lastJournalSync = 0; // timestamp of last successful Supabase pull

function _journalLocalLoad() {
  try { return JSON.parse(localStorage.getItem(_LOCAL_JOURNAL_KEY) || '[]'); } catch { return []; }
}

function _journalLocalSave(entries) {
  try { localStorage.setItem(_LOCAL_JOURNAL_KEY, JSON.stringify(entries)); } catch {}
}

// Merge two arrays of entries by id — remote wins on conflict
function _journalMerge(local, remote) {
  const map = new Map(local.map(e => [e.id, e]));
  remote.forEach(e => map.set(e.id, e)); // remote overwrites
  return [...map.values()].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Pull latest from Supabase → update local store + in-memory cache.
// Called on reconnect, tab focus, and explicit refresh.
async function syncJournalFromCloud() {
  if (!navigator.onLine) return;
  try {
    const { data, error } = await supabase.from('journal_entries')
      .select('*').order('created_at', { ascending: false });
    if (error || !data) return;
    const merged = _journalMerge(_journalLocalLoad(), data);
    _journalLocalSave(merged);
    _lastJournalSync = Date.now();
    // Update in-memory cache used by desktop panel
    if (typeof saveJournalEntries === 'function') saveJournalEntries(merged);
    return merged;
  } catch {}
}
window.syncJournalFromCloud = syncJournalFromCloud;

// ─────────────────────────────────────────────
//  JOURNAL — Storage
// ─────────────────────────────────────────────

async function fetchJournalEntries() {
  // 1. Serve local store immediately (instant, works offline)
  const local = _journalLocalLoad();

  // 2. If online, also pull from Supabase to pick up mobile writes
  if (navigator.onLine) {
    try {
      const { data, error } = await supabase.from('journal_entries')
        .select('*').order('created_at', { ascending: false });
      if (!error && data) {
        const merged = _journalMerge(local, data);
        _journalLocalSave(merged);
        _lastJournalSync = Date.now();
        if (typeof saveJournalEntries === 'function') saveJournalEntries(merged);
        return merged;
      }
    } catch {}
  }

  return local;
}

// ─────────────────────────────────────────────
//  JOURNAL — Render
// ─────────────────────────────────────────────
async function renderJournalEntries() {
  const container = document.getElementById('journal-entries-list'); if (!container) return;
  const allEntries = await fetchJournalEntries();
  allEntries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const showAll = journalViewAll;
  const activeDStr = getActiveDateStr();
  const entries = showAll ? allEntries : allEntries.filter(e => e.created_at && e.created_at.slice(0, 10) === activeDStr);
  const dayLabel = document.getElementById('journal-section-day');
  if (dayLabel) dayLabel.textContent = showAll ? 'All' : 'Today';
  if (entries.length === 0) {
    container.innerHTML = `<div class="journal-empty">${showAll ? 'No journal entries yet.' : 'No entries today. Tap + to add one.'}</div>`;
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

// ─────────────────────────────────────────────
//  JOURNAL — Modal
// ─────────────────────────────────────────────
function openJournalModal() {
  document.getElementById('journal-content').value = '';
  document.getElementById('journal-modal').classList.add('open');
  setTimeout(() => document.getElementById('journal-content').focus(), 400);
  haptic([15]);
}
function closeJournalModal()       { document.getElementById('journal-modal').classList.remove('open'); }
function closeJournalOnBackdrop(e) { if (e.target === document.getElementById('journal-modal')) closeJournalModal(); }

async function saveJournalEntry() {
  const content = document.getElementById('journal-content').value.trim();
  if (!content) { haptic([30,20,30]); return; }
  const newEntry = { id: crypto.randomUUID(), content, created_at: new Date().toISOString() };

  // Write to local store immediately (works offline)
  const local = _journalLocalLoad();
  local.unshift(newEntry);
  _journalLocalSave(local);
  if (typeof saveJournalEntries === 'function') saveJournalEntries(local);

  // Send to Supabase (queued if offline via db.js)
  await supabase.from('journal_entries').insert(newEntry);

  closeJournalModal();
  await renderJournalEntries();
  haptic([20, 35]);
  if (typeof refreshPanelJournalEntries === 'function') refreshPanelJournalEntries();
  showToast('Journal entry saved');
}

async function deleteJournalEntry(id) {
  // Remove from local store immediately
  const local = _journalLocalLoad().filter(e => e.id !== id);
  _journalLocalSave(local);
  if (typeof saveJournalEntries === 'function') saveJournalEntries(local);

  // Delete from Supabase (queued if offline)
  await supabase.from('journal_entries').eq('id', id).delete();

  await renderJournalEntries();
  haptic([20]);
  if (typeof refreshPanelJournalEntries === 'function') refreshPanelJournalEntries();
  showToast('Entry deleted');
}

// ─────────────────────────────────────────────
//  JOURNAL — Inline Drawer
// ─────────────────────────────────────────────
let journalDrawerExpanded = false;
let journalViewAll = false;

function showJournalDrawer() {
  const btn = document.getElementById('journal-toggle-btn'); if (btn) btn.style.display = 'flex';
  const ring = document.getElementById('progress-ring-wrap');
  const dur  = document.getElementById('header-duration');
  if (ring) ring.style.display = 'none';
  if (dur)  dur.style.display  = 'none';
}

function hideJournalDrawer() {
  const btn = document.getElementById('journal-toggle-btn'); if (btn) btn.style.display = 'none';
  const ring = document.getElementById('progress-ring-wrap'); if (ring) ring.style.display = '';
  const section = document.getElementById('journal-section'); if (section) section.style.display = 'none';
  journalDrawerExpanded = false;
  const toggleBtn = document.getElementById('journal-toggle-btn'); if (toggleBtn) toggleBtn.classList.remove('active');
}

async function toggleJournalDrawer() {
  journalDrawerExpanded = !journalDrawerExpanded;
  const section = document.getElementById('journal-section');
  const btn = document.getElementById('journal-toggle-btn');
  if (section) section.style.display = journalDrawerExpanded ? 'block' : 'none';
  if (btn) btn.classList.toggle('active', journalDrawerExpanded);
  if (journalDrawerExpanded) await renderJournalEntries();
  haptic([15]);
}

async function expandJournalDrawer() {
  journalDrawerExpanded = true;
  const section = document.getElementById('journal-section');
  const btn = document.getElementById('journal-toggle-btn');
  if (section) section.style.display = 'block';
  if (btn) btn.classList.add('active');
  await renderJournalEntries();
}

async function collapseJournalDrawer() {
  journalDrawerExpanded = false;
  const section = document.getElementById('journal-section');
  const btn = document.getElementById('journal-toggle-btn');
  if (section) section.style.display = 'none';
  if (btn) btn.classList.remove('active');
}

async function toggleJournalViewAll(e) {
  e.stopPropagation();
  journalViewAll = !journalViewAll;
  const btn = document.getElementById('journal-view-all-btn');
  if (btn) btn.classList.toggle('active', journalViewAll);
  await renderJournalEntries();
}

// Expose globals
window.openJournalModal      = openJournalModal;
window.closeJournalModal     = closeJournalModal;
window.closeJournalOnBackdrop= closeJournalOnBackdrop;
window.saveJournalEntry      = saveJournalEntry;
window.deleteJournalEntry    = deleteJournalEntry;
window.toggleJournalViewAll  = toggleJournalViewAll;
window.toggleJournalDrawer   = toggleJournalDrawer;

// ─────────────────────────────────────────────
//  JOURNAL — Auto-sync triggers
// ─────────────────────────────────────────────

// On reconnect: pull latest entries (picks up mobile writes)
window.addEventListener('online', async () => {
  const synced = await syncJournalFromCloud();
  if (!synced) return;
  // Re-render journal if it's currently visible
  const section = document.getElementById('journal-section');
  if (section && section.style.display !== 'none') await renderJournalEntries();
  if (typeof refreshPanelJournalEntries === 'function') refreshPanelJournalEntries();
});

// On tab focus: silently re-pull if it's been more than 2 minutes
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  const twoMin = 2 * 60 * 1000;
  if (Date.now() - _lastJournalSync < twoMin) return;
  const synced = await syncJournalFromCloud();
  if (!synced) return;
  // Refresh panel if on desktop and journal tab is open
  if (typeof refreshPanelJournalEntries === 'function') refreshPanelJournalEntries();
});
window.saveNotesToDB         = saveNotesToDB;