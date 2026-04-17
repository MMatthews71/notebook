// ─────────────────────────────────────────────
//  APP INIT
// ─────────────────────────────────────────────
async function initApp() {
  const overlay = document.getElementById('app-loading-overlay');

  // Show loading overlay
  if (overlay) {
    overlay.style.opacity = '1';
  }

  updateDateDisplay();
  document.getElementById('app').style.display = 'flex';

  // Notes
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    const initialLocal = localStorage.getItem(LS_NOTES) || '';
    if (typeof ensureNotesDocsInitialized === 'function') ensureNotesDocsInitialized(initialLocal);
    if (typeof getActiveNotesDocId === 'function') {
      const docs = typeof getNotesDocs === 'function' ? getNotesDocs() : [];
      const activeId = getActiveNotesDocId();
      const activeDoc = docs.find(d => d.id === activeId) || docs[0];
      if (activeDoc) notesArea.value = activeDoc.content || '';
      else notesArea.value = initialLocal;
    } else {
      notesArea.value = initialLocal;
    }
    fetchNotes().then(content => {
      if (!content) return;
      if (typeof ensureNotesDocsInitialized === 'function') ensureNotesDocsInitialized(content);
      if (typeof getActiveNotesDocId === 'function') {
        const docs = typeof getNotesDocs === 'function' ? getNotesDocs() : [];
        const activeId = getActiveNotesDocId();
        const activeDoc = docs.find(d => d.id === activeId);
        if (activeDoc && (!activeDoc.content || activeDoc.content.trim() === '')) notesArea.value = content;
      } else {
        notesArea.value = content;
      }
    });

    // NOTE: The textarea input listener is intentionally NOT added here.
    // desktop.js attaches a single routing listener that correctly dispatches to
    // scheduleJournalSave, scheduleNotesDocSave, or scheduleNotesSave depending
    // on what is currently loaded. Adding a second listener here would cause journal
    // content to be saved into the notes table on every keystroke.
  }

  // Journal
  await fetchJournalEntries();
  renderJournalEntries();

  // Habits & goals from localStorage (optimistic)
  const hR = lsGet(LS_HABITS), cR = lsGet(LS_COMPLETIONS);
  habits = hR.map(h => ({ ...h, doneCounts: cR.filter(c => c.habit_id === h.id).reduce((acc, c) => { acc[c.date] = (acc[c.date] || 0) + 1; return acc; }, {}) }));
  goals = lsGet(LS_GOALS);
  todos = lsGet(LS_TODOS);

  // Sync from DB
  await Promise.all([fetchGoals(true), fetchHabits(true), fetchTodos(true)]);

  // Render views
  renderTodo(); renderGoals();

  // Hide loading overlay
  if (overlay) {
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 300);
  }

  // Notify desktop that data is fully loaded
  if (typeof window.onDataReady === 'function') {
    window.onDataReady();
  }
}

// Global beforeunload handler to flush pending saves
window.addEventListener('beforeunload', () => {
  if (typeof flushPendingSaves === 'function') flushPendingSaves();
});

initApp();