// ─────────────────────────────────────────────
//  APP INIT
// ─────────────────────────────────────────────
async function initApp() {
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
    notesArea.addEventListener('input', (e) => { scheduleNotesSave(e.target.value); });
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
  renderTodo(); renderGoals();
}

initApp();