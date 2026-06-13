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

window.saveNotesToDB         = saveNotesToDB;
