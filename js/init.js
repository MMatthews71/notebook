// ─────────────────────────────────────────────
//  APP INIT
// ─────────────────────────────────────────────
async function initApp() {
  const overlay = document.getElementById('app-loading-overlay');
  if (overlay) overlay.style.opacity = '1';

  updateDateDisplay();
  document.getElementById('app').style.display = 'flex';

  // ── Fetch from Supabase ──────────────────
  try {
    const [goalsData, habitsData, completionsData, todosData,
           journalData, notesData, templatesData] = await Promise.all([
      supabase.from('goals').select('*').order('created_at', { ascending: true }),
      supabase.from('habits').select('*').order('created_at', { ascending: true }),
      supabase.from('completions').select('*'),
      supabase.from('todos').select('*').order('created_at', { ascending: true }),
      supabase.from('journal_entries').select('*').order('created_at', { ascending: false }),
      supabase.from('notes').select('*').order('updated_at', { ascending: false }),
      supabase.from('todo_templates').select('*')
    ]);

    // Handle errors (each call returns { data, error })
    goals = goalsData.data || [];
    const rawHabits = habitsData.data || [];
    const completions = completionsData.data || [];
    todos = (todosData.data || []).map(parseTodoRow);
    const journalEntries = journalData.data || [];
    const notesDocs = notesData.data || [];
    const templates = templatesData.data || [];

    // Populate journal entries cache for desktop.js
    if (typeof saveJournalEntries === 'function') saveJournalEntries(journalEntries);

    // ── Merge completions into habits ──
    habits = rawHabits.map(h => {
      const hc = completions.filter(c => c.habit_id === h.id);
      return {
        ...h,
        doneCounts: hc.reduce((acc, c) => { acc[c.date] = (acc[c.date] || 0) + 1; return acc; }, {}),
        completionIds: hc.reduce((acc, c) => { (acc[c.date] = acc[c.date] || []).push(c.id); return acc; }, {}),
      };
    });

    // ── Load daily orders for today ──────────
    const today = todayStr();
    const orders = await supabase.fetchDailyOrders(today);
    habitDailyOrder = { [today]: orders.habit || {} };
    todoDailyOrder  = { [today]: orders.todo  || {} };

    // ── Load flex overrides & skipped habits for today ──
    flexOverrides = await supabase.fetchFlexOverrides(today);
    skippedHabits = await supabase.fetchSkippedHabits(today);

    // ── Handle notes (multiple docs) ─────────
    window._notesDocs = notesDocs;
    const notesArea = document.getElementById('notes-textarea');
    if (notesArea) {
      const activeDocId = await supabase.getPref('active_notes_doc_id');
      let resolvedDoc = null;
      if (activeDocId && notesDocs.some(d => d.id === activeDocId)) {
        resolvedDoc = notesDocs.find(d => d.id === activeDocId);
      } else if (notesDocs.length > 0) {
        resolvedDoc = notesDocs[0];
      }
      if (resolvedDoc) {
        if (typeof setActiveNotesDocId === 'function') setActiveNotesDocId(resolvedDoc.id);
        if (typeof window.setActiveNotesDocIdInMemory === 'function') window.setActiveNotesDocIdInMemory(resolvedDoc.id);
        notesArea.innerHTML = resolvedDoc.content || '';
      }
      if (typeof updateMobileNoteTitle === 'function') updateMobileNoteTitle();
    }
  } catch (e) {
    console.error('Init load failed:', e);
    showToast('Failed to load data. Check connection.');
  }

  // ── Journal render ────────────────────────
  renderJournalEntries();

  // ── UI setup ───────────────────────────────
  renderTodo(); renderGoals(); populateGoalSelect();

  // Hide loading overlay
  if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); }
  if (typeof window.onDataReady === 'function') window.onDataReady();
}

// Global beforeunload handler to flush pending saves
window.addEventListener('beforeunload', () => {
  if (typeof flushPendingSaves === 'function') flushPendingSaves();
});

initApp();