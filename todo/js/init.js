async function initApp() {
  const overlay = document.getElementById('app-loading-overlay');
  if (overlay) overlay.style.opacity = '1';

  updateDateDisplay();
  document.getElementById('app').style.display = 'flex';

  const today = todayStr();
  const _yd = new Date(); _yd.setDate(_yd.getDate() - 1);
  const ydStr = _yd.toISOString().slice(0, 10);

  try {
    const [
      goalsData, habitsData, completionsData, todosData, templatesData, goalParentsData,
      flexOv, skippedH,
      evOrderRaw, restDaysRaw,
      todayOrdersData, ydOrdersData,
    ] = await Promise.all([
      supabase.from('goals').select('*').order('created_at', { ascending: true }),
      supabase.from('habits').select('*').order('created_at', { ascending: true }),
      supabase.from('completions').select('*'),
      supabase.from('todos').select('*').order('created_at', { ascending: true }),
      supabase.from('todo_templates').select('*'),
      supabase.getGoalParents().catch(() => []),
      supabase.fetchFlexOverrides(today),
      supabase.fetchSkippedHabits(today),
      supabase.getPref('eventually_order'),
      supabase.getPref('rest_days'),
      supabase.fetchDailyOrders(today).catch(() => ({ habit: {}, todo: {} })),
      supabase.fetchDailyOrders(ydStr).catch(() => ({ habit: {}, todo: {} })),
    ]);

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

    const rawHabits = habitsData.data || [];
    const completions = completionsData.data || [];
    todos = (todosData.data || []).map(parseTodoRow);

    habits = rawHabits.map(h => {
      const hc = completions.filter(c => c.habit_id === h.id);
      return {
        ...h,
        doneCounts:    hc.reduce((acc, c) => { acc[c.date] = (acc[c.date] || 0) + 1; return acc; }, {}),
        completionIds: hc.reduce((acc, c) => { (acc[c.date] = acc[c.date] || []).push(c.id); return acc; }, {}),
      };
    });

    // Populate daily orders — fetched above in the same Promise.all so they are
    // ready before the first renderTodo() call.  This prevents initializeDailyOrders()
    // from overwriting the user's saved custom order with default sequential indices.
    {
      let h = (todayOrdersData && todayOrdersData.habit) || {};
      let t = (todayOrdersData && todayOrdersData.todo)  || {};
      if (Object.keys(h).length === 0 && Object.keys(t).length === 0) {
        h = (ydOrdersData && ydOrdersData.habit) || {};
        t = (ydOrdersData && ydOrdersData.todo)  || {};
      }
      habitDailyOrder = { [today]: h };
      todoDailyOrder  = { [today]: t };
    }
    flexOverrides = flexOv || {};
    skippedHabits = skippedH || {};

    if (evOrderRaw && typeof setEventuallyOrderMemory === 'function') {
      try { setEventuallyOrderMemory(JSON.parse(evOrderRaw)); } catch (_) {}
    }
    if (restDaysRaw) {
      try {
        const arr = JSON.parse(restDaysRaw);
        if (Array.isArray(arr)) arr.forEach(d => restDays.add(d));
      } catch (_) {}
    }

    // Seed templates into todos.js if it has a setter
    const templates = templatesData.data || [];
    if (typeof window._setTodoTemplates === 'function') window._setTodoTemplates(templates);

  } catch (e) {
    console.error('Init load failed:', e);
    showToast('Failed to load data. Check connection.');
  }

  renderTodo();
  renderGoals();
  populateGoalSelect();

  const isDesktopView = window.matchMedia('(min-width: 768px)').matches;
  if (isDesktopView) {
    mainView = 'goals';
    window.mainView = 'goals';
    if (typeof applyMainView === 'function') applyMainView();
  } else {
    if (typeof switchTab === 'function') switchTab('todo');
  }

  if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); }
  if (typeof window.onDataReady === 'function') window.onDataReady();

  _startPolling();
}

let _pollTimer = null;

async function _pollForUpdates() {
  if (!navigator.onLine || document.hidden) return;
  try {
    const [habitsRes, completionsRes, todosRes] = await Promise.all([
      supabase.from('habits').select('*').order('created_at', { ascending: true }),
      supabase.from('completions').select('*'),
      supabase.from('todos').select('*').order('created_at', { ascending: true }),
    ]);
    if (habitsRes.data && completionsRes.data) {
      habits = habitsRes.data.map(h => {
        const hc = completionsRes.data.filter(c => c.habit_id === h.id);
        return {
          ...h,
          doneCounts:    hc.reduce((acc, c) => { acc[c.date] = (acc[c.date] || 0) + 1; return acc; }, {}),
          completionIds: hc.reduce((acc, c) => { (acc[c.date] = acc[c.date] || []).push(c.id); return acc; }, {}),
        };
      });
    }
    if (todosRes.data) todos = todosRes.data.map(t => typeof parseTodoRow === 'function' ? parseTodoRow(t) : t);
    if (typeof renderTodo  === 'function') renderTodo();
    if (typeof renderGoals === 'function') renderGoals();
  } catch {}
}

function _startPolling() {
  clearInterval(_pollTimer);
  _pollTimer = setInterval(_pollForUpdates, 60000);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearInterval(_pollTimer);
  else { _pollForUpdates(); _startPolling(); }
});

initApp();
