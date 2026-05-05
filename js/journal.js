// ─────────────────────────────────────────────
//  NOTES — Supabase persistence
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
//  NOTES FORMATTING HELPERS
// ─────────────────────────────────────────────

function getTextarea() {
  return document.getElementById('notes-textarea');
}

function insertText(wrapperStart, wrapperEnd = wrapperStart) {
  const textarea = getTextarea();
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.substring(start, end);
  const before = textarea.value.substring(0, start);
  const after = textarea.value.substring(end);

  const newText = wrapperStart + selectedText + wrapperEnd;
  textarea.value = before + newText + after;

  // Restore selection (place cursor after the inserted wrapper if no selection)
  const newCursorPos = start + wrapperStart.length + selectedText.length;
  textarea.setSelectionRange(newCursorPos, newCursorPos);
  textarea.focus();

  // Trigger input event to auto-save
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

function formatBold() {
  insertText('**', '**');
}

function formatItalic() {
  insertText('*', '*');
}

function formatUnderline() {
  insertText('<u>', '</u>');
}

function formatBullet() {
  const textarea = getTextarea();
  if (!textarea) return;

  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.substring(start, end);
  const lines = selectedText.split('\n');

  const bulletedLines = lines.map(line => {
    // Don't add bullet if line already starts with "- " or "* "
    if (/^\s*[-*]\s/.test(line)) return line;
    return '- ' + line;
  });

  const newText = bulletedLines.join('\n');
  const before = textarea.value.substring(0, start);
  const after = textarea.value.substring(end);

  textarea.value = before + newText + after;
  const newCursorPos = start + newText.length;
  textarea.setSelectionRange(newCursorPos, newCursorPos);
  textarea.focus();
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

// Attach toolbar event listeners
function initNotesToolbar() {
  const toolbar = document.querySelector('.notes-toolbar');
  if (!toolbar) return;

  toolbar.addEventListener('click', (e) => {
    const btn = e.target.closest('.format-btn');
    if (!btn) return;
    const format = btn.dataset.format;
    switch (format) {
      case 'bold': formatBold(); break;
      case 'italic': formatItalic(); break;
      case 'underline': formatUnderline(); break;
      case 'bullet': formatBullet(); break;
    }
    haptic([10]);
  });

  // Keyboard shortcuts (Ctrl+B, Ctrl+I, Ctrl+U)
  const textarea = getTextarea();
  if (textarea) {
    textarea.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'b') {
          e.preventDefault();
          formatBold();
        } else if (e.key === 'i') {
          e.preventDefault();
          formatItalic();
        } else if (e.key === 'u') {
          e.preventDefault();
          formatUnderline();
        }
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

async function setNotesDocs(docs) {
  window._notesDocs = docs;  // keep sync cache up to date
  const { error } = await supabase.from('notes').upsert(docs);
  if (error) throw error;
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
  const first = [{ id, title: 'Notes', content: initialContent || '', updated_at: now }];
  await setNotesDocs(first);
  await setActiveNotesDocId(id);
  // Also sync desktop.js in-memory variable for the new doc
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
  if (notesArea) notesArea.value = doc.content || '';
  // FIX: Removed scheduleNotesSave here — loading content from DB doesn't need saving.
  // The old call was firing with the stale previous activeNotesDocId and overwriting
  // the previous doc with the new doc's (empty) content.

  if (typeof refreshPanelNotes === 'function') refreshPanelNotes();
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
  await ensureNotesDocsInitialized(content);
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
  renderNotesDocsList();
  modal.classList.add('open');
  setTimeout(() => {
    const title = document.getElementById('notes-new-title');
    if (title) title.focus();
  }, 300);
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
  await ensureNotesDocsInitialized(notesArea ? notesArea.value : '');
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
  closeNotesManagerModal();
}

async function renderNotesDocsList() {
  const notesArea = document.getElementById('notes-textarea');
  await ensureNotesDocsInitialized(notesArea ? notesArea.value : '');
  const list = document.getElementById('notes-docs-list');
  if (!list) return;
  const docs = (window._notesDocs && window._notesDocs.length > 0)
    ? window._notesDocs
    : await getNotesDocs();
  const activeId = await getActiveNotesDocId();
  if (docs.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = docs.map(d => {
    const isActive = d.id === activeId;
    const safeTitle = escHtml(d.title || 'Untitled');
    return `
      <button class="btn-ghost" style="width:100%;text-align:left;display:flex;justify-content:space-between;align-items:center;padding:12px 14px;margin:8px 0;border:1px solid var(--border);border-radius:12px;" onclick="openNotesDoc('${d.id}')">
        <span style="font-weight:700;color:var(--text-2)">${safeTitle}</span>
        <span style="font-size:12px;color:${isActive ? 'var(--mint)' : 'var(--text-3)'};font-weight:800">${isActive ? 'OPEN' : 'OPEN'}</span>
      </button>
    `;
  }).join('');
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
//  JOURNAL — Storage
// ─────────────────────────────────────────────

async function fetchJournalEntries() {
  const { data, error } = await supabase.from('journal_entries').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
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
  const { error } = await supabase.from('journal_entries').insert(newEntry);
  if (error) throw error;
  closeJournalModal(); await renderJournalEntries(); haptic([20, 35]);
  if (typeof refreshPanelJournalEntries === 'function') refreshPanelJournalEntries();
  showToast('Journal entry saved');
}

async function deleteJournalEntry(id) {
  const { error } = await supabase.from('journal_entries').eq('id', id).delete();
  if (error) throw error;
  await renderJournalEntries(); haptic([20]);
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
window.saveNotesToDB         = saveNotesToDB;