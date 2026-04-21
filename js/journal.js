// ─────────────────────────────────────────────
//  NOTES — Supabase persistence
// ─────────────────────────────────────────────
const LS_NOTES_ID = 'habits_notes_id';
const LS_NOTES_DOCS = 'habits_notes_docs';
const LS_NOTES_ACTIVE_DOC = 'habits_notes_active_doc';

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

function getNotesId() {
  let id = localStorage.getItem(LS_NOTES_ID);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(LS_NOTES_ID, id); }
  return id;
}

function getNotesDocs() {
  try { return JSON.parse(localStorage.getItem(LS_NOTES_DOCS)) || []; }
  catch { return []; }
}

function setNotesDocs(docs) {
  localStorage.setItem(LS_NOTES_DOCS, JSON.stringify(docs));
}

function getActiveNotesDocId() {
  return localStorage.getItem(LS_NOTES_ACTIVE_DOC) || '';
}

function setActiveNotesDocId(id) {
  localStorage.setItem(LS_NOTES_ACTIVE_DOC, id);
}

function ensureNotesDocsInitialized(initialContent = '') {
  const docs = getNotesDocs();
  if (docs.length > 0) {
    const activeId = getActiveNotesDocId();
    if (!activeId || !docs.some(d => d.id === activeId)) setActiveNotesDocId(docs[0].id);
    return;
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const first = [{ id, title: 'Notes', content: initialContent || '', updated_at: now }];
  setNotesDocs(first);
  setActiveNotesDocId(id);
}

function getActiveNotesDoc() {
  const docs = getNotesDocs();
  const activeId = getActiveNotesDocId();
  return docs.find(d => d.id === activeId) || docs[0] || null;
}

function updateActiveNotesDocContent(content) {
  const docs = getNotesDocs();
  const activeId = getActiveNotesDocId();
  const now = new Date().toISOString();
  const next = docs.map(d => (d.id === activeId ? { ...d, content, updated_at: now } : d));
  setNotesDocs(next);
}

function switchToNotesDoc(id) {
  if (typeof flushPendingSaves === 'function') flushPendingSaves();
  const docs = getNotesDocs();
  const doc = docs.find(d => d.id === id);
  if (!doc) return;
  setActiveNotesDocId(id);
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) notesArea.value = doc.content || '';
  localStorage.setItem(LS_NOTES, doc.content || '');
  if (notesArea) scheduleNotesSave(notesArea.value);
  if (typeof refreshPanelNotes === 'function') refreshPanelNotes();
}

async function fetchNotes() {
  try {
    const { data, error } = await supabase.from('notes').select('*').eq('id', getNotesId());
    if (error) throw error;
    if (data && data.length > 0) {
      const content = data[0].content || '';
      localStorage.setItem(LS_NOTES, content);
      return content;
    }
  } catch (e) { console.error('fetchNotes failed:', e); }
  return localStorage.getItem(LS_NOTES) || '';
}

async function saveNotesToDB(content) {
  localStorage.setItem(LS_NOTES, content);
  ensureNotesDocsInitialized(content);
  updateActiveNotesDocContent(content);
  const nid = getNotesId();
  const { error: upErr } = await supabase.from('notes').eq('id', nid).update({ content, updated_at: new Date().toISOString() });
  if (upErr) {
    const { error: insErr } = await supabase.from('notes').insert([{ id: nid, content, updated_at: new Date().toISOString() }]);
    if (insErr) console.error('saveNotes failed:', insErr);
  }
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

function createNewNoteDoc() {
  ensureNotesDocsInitialized(localStorage.getItem(LS_NOTES) || '');
  const titleEl = document.getElementById('notes-new-title');
  const title = (titleEl && titleEl.value ? titleEl.value.trim() : '') || 'Untitled';
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const docs = getNotesDocs();
  docs.unshift({ id, title, content: '', updated_at: now });
  setNotesDocs(docs);
  if (titleEl) titleEl.value = '';
  switchToNotesDoc(id);
  renderNotesDocsList();
  closeNotesManagerModal();
}

function renderNotesDocsList() {
  ensureNotesDocsInitialized(localStorage.getItem(LS_NOTES) || '');
  const list = document.getElementById('notes-docs-list');
  if (!list) return;
  const docs = getNotesDocs().slice().sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));
  const activeId = getActiveNotesDocId();
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
const LS_JOURNAL = 'habits_journal_entries';

function getJournalEntries() {
  try { return JSON.parse(localStorage.getItem(LS_JOURNAL)) || []; } catch { return []; }
}
function saveJournalEntries(entries) {
  localStorage.setItem(LS_JOURNAL, JSON.stringify(entries));
}

async function fetchJournalEntries() {
  try {
    const { data, error } = await supabase.from('journal_entries').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    const entries = data || []; saveJournalEntries(entries); return entries;
  } catch (e) { console.error('fetchJournalEntries failed:', e); return getJournalEntries(); }
}

// ─────────────────────────────────────────────
//  JOURNAL — Render
// ─────────────────────────────────────────────
function renderJournalEntries() {
  const container = document.getElementById('journal-entries-list'); if (!container) return;
  const allEntries = getJournalEntries();
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
  const entries = getJournalEntries(); entries.push(newEntry); saveJournalEntries(entries);
  closeJournalModal(); renderJournalEntries(); haptic([20, 35]);
  if (typeof refreshPanelJournalEntries === 'function') refreshPanelJournalEntries();
  try { await supabase.from('journal_entries').insert([{ id: newEntry.id, content: newEntry.content, created_at: newEntry.created_at }]); showToast('Journal entry saved'); }
  catch (e) { console.error('saveJournalEntry failed:', e); showToast('Entry saved locally'); }
}

async function deleteJournalEntry(id) {
  let entries = getJournalEntries(); entries = entries.filter(e => e.id !== id);
  saveJournalEntries(entries); renderJournalEntries(); haptic([20]);
  if (typeof refreshPanelJournalEntries === 'function') refreshPanelJournalEntries();
  try { await supabase.from('journal_entries').eq('id', id).delete(); showToast('Entry deleted'); }
  catch (e) { console.error('deleteJournalEntry failed:', e); showToast('Entry deleted locally'); }
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

function toggleJournalDrawer() {
  journalDrawerExpanded = !journalDrawerExpanded;
  const section = document.getElementById('journal-section');
  const btn = document.getElementById('journal-toggle-btn');
  if (section) section.style.display = journalDrawerExpanded ? 'block' : 'none';
  if (btn) btn.classList.toggle('active', journalDrawerExpanded);
  if (journalDrawerExpanded) renderJournalEntries();
  haptic([15]);
}

function expandJournalDrawer() {
  journalDrawerExpanded = true;
  const section = document.getElementById('journal-section');
  const btn = document.getElementById('journal-toggle-btn');
  if (section) section.style.display = 'block';
  if (btn) btn.classList.add('active');
  renderJournalEntries();
}

function collapseJournalDrawer() {
  journalDrawerExpanded = false;
  const section = document.getElementById('journal-section');
  const btn = document.getElementById('journal-toggle-btn');
  if (section) section.style.display = 'none';
  if (btn) btn.classList.remove('active');
}

function toggleJournalViewAll(e) {
  e.stopPropagation();
  journalViewAll = !journalViewAll;
  const btn = document.getElementById('journal-view-all-btn');
  if (btn) btn.classList.toggle('active', journalViewAll);
  renderJournalEntries();
}

// Expose globals
window.openJournalModal      = openJournalModal;
window.closeJournalModal     = closeJournalModal;
window.closeJournalOnBackdrop= closeJournalOnBackdrop;
window.saveJournalEntry      = saveJournalEntry;
window.deleteJournalEntry    = deleteJournalEntry;
window.toggleJournalViewAll  = toggleJournalViewAll;
window.toggleJournalDrawer   = toggleJournalDrawer;
window.saveNotesToDB        = saveNotesToDB;