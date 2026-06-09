// ── Minimal desktop.js stubs needed by journal.js ──────────────────────────
let _journalEntriesCache = [];
function getJournalEntries() { return _journalEntriesCache; }
function saveJournalEntries(arr) { _journalEntriesCache = arr; }
window.getJournalEntries = getJournalEntries;
window.saveJournalEntries = saveJournalEntries;

// journal.js may call these — provide no-op stubs
window.flushPendingSaves = function() {};
window.scheduleJournalSave = function() {};
window.refreshPanelJournalEntries = function() {
  if (typeof renderJournalEntries === 'function') renderJournalEntries();
};

// nav.js calls renderTodo/renderGoals on date change — use renderGoals to refresh entries
window.renderTodo  = function() {};
window.renderGoals = async function() {
  if (typeof renderJournalEntries === 'function') await renderJournalEntries();
};

// ── App init ────────────────────────────────────────────────────────────────
async function initApp() {
  const overlay = document.getElementById('app-loading-overlay');
  if (overlay) overlay.style.opacity = '1';

  const loggedIn = (typeof authInit === 'function') ? await authInit() : true;
  if (!loggedIn) {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.style.display = 'flex';
    if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay?.remove(), 300); }
    if (typeof _authInitLoginScreen === 'function') _authInitLoginScreen();
    return;
  }

  _initAuthStatus();
  updateDateDisplay();
  document.getElementById('app').style.display = 'flex';

  try {
    const [journalData] = await Promise.all([
      supabase.from('journal_entries').select('*').order('created_at', { ascending: false }),
    ]);

    const journalEntries = journalData.data || [];
    saveJournalEntries(journalEntries);

    // Merge with any offline-written entries
    if (typeof _journalLocalLoad === 'function' && typeof _journalMerge === 'function') {
      const local = _journalLocalLoad();
      const merged = _journalMerge(local, journalEntries);
      if (typeof _journalLocalSave === 'function') _journalLocalSave(merged);
      if (merged.length !== journalEntries.length) saveJournalEntries(merged);
    }

  } catch (e) {
    console.error('Init load failed:', e);
    showToast('Failed to load data. Check connection.');
  }

  renderJournalEntries();

  if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); }
}

function _initAuthStatus() {
  const el = document.getElementById('auth-status-btn');
  if (!el) return;
  const email = (typeof authGetCurrentEmail === 'function') ? authGetCurrentEmail() : null;
  el.title = email ? `Signed in as ${email}\nClick to sign out` : 'Sign out';
  el.style.display = 'flex';
}

window.addEventListener('beforeunload', () => {
  if (typeof flushPendingSaves === 'function') flushPendingSaves();
});

initApp();
