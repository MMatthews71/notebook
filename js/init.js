// ─────────────────────────────────────────────
//  APP INIT
// ─────────────────────────────────────────────
async function initApp() {
  const overlay = document.getElementById('app-loading-overlay');
  if (overlay) overlay.style.opacity = '1';

  updateDateDisplay();
  document.getElementById('app').style.display = 'flex';

  // ── Fetch from Supabase (all in ONE parallel batch) ──
  const today = todayStr();
  const _yd = new Date(); _yd.setDate(_yd.getDate() - 1);
  const ydStr = _yd.toISOString().slice(0, 10);

  try {
    const [
      goalsData, habitsData, completionsData, todosData,
      journalData, notesData, templatesData, goalParentsData,
      flexOv, skippedH,
      activeNotesDocId, evOrderRaw, savedUsdaKey, primaryWeeklyId, cascadeAreaOrderRaw,
      nutritionProfileData, todayFoodLogsData,
    ] = await Promise.all([
      supabase.from('goals').select('*').order('created_at', { ascending: true }),
      supabase.from('habits').select('*').order('created_at', { ascending: true }),
      supabase.from('completions').select('*'),
      supabase.from('todos').select('*').order('created_at', { ascending: true }),
      supabase.from('journal_entries').select('*').order('created_at', { ascending: false }),
      supabase.from('notes').select('*').order('updated_at', { ascending: false }),
      supabase.from('todo_templates').select('*'),
      supabase.getGoalParents().catch(() => []),
      supabase.fetchFlexOverrides(today),
      supabase.fetchSkippedHabits(today),
      supabase.getPref('active_notes_doc_id'),
      supabase.getPref('eventually_order'),
      supabase.getPref('usda_api_key'),
      supabase.getPref('primary_weekly_goal_id'),
      supabase.getPref('cascade_area_order'),
      supabase.getNutritionProfile(),
      supabase.getFoodLogs(today),
    ]);
    // Seed THE ONE THING for the week
    if (typeof _primaryWeeklyGoalId !== 'undefined') {
      _primaryWeeklyGoalId = primaryWeeklyId || null;
    }
    // Seed cascade area ordering
    if (typeof loadAreaOrderFromPref === 'function') {
      loadAreaOrderFromPref(cascadeAreaOrderRaw);
    }

    // daily_orders is slow without an index — load in background, don't block UI.
    // Until it returns, default ordering (creation order) is used.
    Promise.all([
      supabase.fetchDailyOrders(today),
      supabase.fetchDailyOrders(ydStr),
    ]).then(([todayOrders, ydOrders]) => {
      let h = todayOrders.habit || {};
      let t = todayOrders.todo  || {};
      if (Object.keys(h).length === 0 && Object.keys(t).length === 0) {
        h = ydOrders.habit || {};
        t = ydOrders.todo  || {};
      }
      habitDailyOrder = { [today]: h };
      todoDailyOrder  = { [today]: t };
      if (currentTab === 'todo' && typeof renderTodo === 'function') renderTodo();
    }).catch(e => console.warn('daily_orders deferred fetch failed:', e));

    // Goals + goal_parents (with back-fill)
    goals = goalsData.data || [];
    if (typeof goalParents !== 'undefined') {
      goalParents = (goalParentsData || []).map(gp => ({
        goal_id: String(gp.goal_id),
        parent_id: String(gp.parent_id),
      }));
      goals.forEach(g => {
        if (g.parent_id) {
          const sid = String(g.id), spid = String(g.parent_id);
          const exists = goalParents.some(gp => gp.goal_id === sid && gp.parent_id === spid);
          if (!exists) goalParents.push({ goal_id: sid, parent_id: spid });
        }
      });
    }

    // Habits + completions merged
    const rawHabits = habitsData.data || [];
    const completions = completionsData.data || [];
    todos = (todosData.data || []).map(parseTodoRow);
    const journalEntries = journalData.data || [];
    const notesDocs = notesData.data || [];
    const templates = templatesData.data || [];
    if (typeof saveJournalEntries === 'function') saveJournalEntries(journalEntries);
    habits = rawHabits.map(h => {
      const hc = completions.filter(c => c.habit_id === h.id);
      return {
        ...h,
        doneCounts: hc.reduce((acc, c) => { acc[c.date] = (acc[c.date] || 0) + 1; return acc; }, {}),
        completionIds: hc.reduce((acc, c) => { (acc[c.date] = acc[c.date] || []).push(c.id); return acc; }, {}),
      };
    });

    // Defaults — overwritten when the deferred daily_orders fetch returns
    habitDailyOrder = { [today]: {} };
    todoDailyOrder  = { [today]: {} };

    flexOverrides = flexOv || {};
    skippedHabits = skippedH || {};

    // Notes
    window._notesDocs = notesDocs;
    const notesArea = document.getElementById('notes-textarea');
    if (notesArea) {
      let resolvedDoc = null;
      if (activeNotesDocId && notesDocs.some(d => d.id === activeNotesDocId)) {
        resolvedDoc = notesDocs.find(d => d.id === activeNotesDocId);
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

    // Eventually order
    if (evOrderRaw && typeof setEventuallyOrderMemory === 'function') {
      try { setEventuallyOrderMemory(JSON.parse(evOrderRaw)); } catch (_) {}
    }

    // Nutrition
    if (nutritionProfileData) {
      nutritionProfile = nutritionProfileData;
      nutritionTargets = calcNutritionTargets(nutritionProfileData);
    }
    todayFoodLogs = todayFoodLogsData;
    // USDA key — config file takes priority; fall back to DB-saved
    if (savedUsdaKey && typeof usdaApiKey !== 'undefined' && !usdaApiKey) usdaApiKey = savedUsdaKey;
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
