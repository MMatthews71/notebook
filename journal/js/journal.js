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
