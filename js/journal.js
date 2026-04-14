// ─────────────────────────────────────────────
//  NOTES — Supabase persistence
// ─────────────────────────────────────────────
const LS_NOTES_ID = 'habits_notes_id';
function getNotesId() {
  let id = localStorage.getItem(LS_NOTES_ID);
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(LS_NOTES_ID, id); }
  return id;
}
let _notesSaveTimer = null;

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
  const nid = getNotesId();
  const { error: upErr } = await supabase.from('notes').eq('id', nid).update({ content, updated_at: new Date().toISOString() });
  if (upErr) {
    const { error: insErr } = await supabase.from('notes').insert([{ id: nid, content, updated_at: new Date().toISOString() }]);
    if (insErr) console.error('saveNotes failed:', insErr);
  }
}

function scheduleNotesSave(content) {
  clearTimeout(_notesSaveTimer);
  _notesSaveTimer = setTimeout(() => saveNotesToDB(content), 1000);
}

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
  const frac = document.getElementById('header-task-fraction');
  const dur  = document.getElementById('header-duration');
  if (ring) ring.style.display = 'none';
  if (frac) frac.style.display = 'none';
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