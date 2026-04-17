// ─────────────────────────────────────────────
//  HABITS — FETCH
// ─────────────────────────────────────────────
async function fetchHabits(skipRender = false) {
  try {
    const { data: hr, error: he } = await supabase.from('habits').select('*').order('created_at', { ascending: true }); if (he) throw he;
    const { data: cr, error: ce } = await supabase.from('completions').select('*'); if (ce) throw ce;
    habits = hr.map(h => ({ ...h, doneCounts: (cr||[]).filter(c => c.habit_id === h.id).reduce((acc, c) => { acc[c.date] = (acc[c.date] || 0) + 1; return acc; }, {}) }));
    lsSet(LS_HABITS, hr); lsSet(LS_COMPLETIONS, cr||[]);
  } catch (e) {
    console.error('fetchHabits failed:', e);
    const hR = lsGet(LS_HABITS), cR = lsGet(LS_COMPLETIONS);
    habits = hR.map(h => ({ ...h, doneCounts: cR.filter(c => c.habit_id === h.id).reduce((acc, c) => { acc[c.date] = (acc[c.date] || 0) + 1; return acc; }, {}) }));
  }
  if (!skipRender) { if (currentTab === 'todo') renderTodo(); if (currentTab === 'goals') renderGoals(); populateGoalSelect(); }
}

// ─────────────────────────────────────────────
//  HABIT ACTIVE DATE CHECK
// ─────────────────────────────────────────────
function isHabitActiveOnDate(habit, dateStr) {
  if (flexOverrides[`${habit.id}_${dateStr}`]) return true;
  const freq = habit.frequency;
  if (!freq || freq === 'daily') return true;
  if (freq.startsWith('weekly:')) {
    const days = freq.substring(7).split(',');
    const d = new Date(dateStr + 'T00:00:00');
    return days.includes(DAY_KEYS[d.getDay()]);
  }
  if (freq.startsWith('interval:')) {
    const interval = parseInt(freq.substring(9), 10);
    if (isNaN(interval)) return true;
    const anchor = habit.created_at ? new Date(habit.created_at) : new Date();
    anchor.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + 'T00:00:00');
    const diffDays = Math.floor((target - anchor) / (1000 * 60 * 60 * 24));
    return diffDays >= 0 && diffDays % interval === 0;
  }
  if (freq.startsWith('flexible:')) return false;
  return true;
}

// ─────────────────────────────────────────────
//  TIME HELPERS
// ─────────────────────────────────────────────
function getCurrentMinutes() { const now = new Date(); return now.getHours() * 60 + now.getMinutes(); }

function getTokenMinutes(token) {
  if (!token) return null;
  if (token === 'morning')   return 8 * 60;
  if (token === 'afternoon') return 14 * 60;
  if (token === 'evening')   return 19 * 60;
  const [h, m] = token.split(':').map(Number);
  if (!isNaN(h) && !isNaN(m)) return h * 60 + m;
  return null;
}

function getAdjustedTimeValue(timeToken) {
  const mins = getTokenMinutes(timeToken);
  if (mins === null) return 0;
  const currentMins = getCurrentMinutes();
  return mins < currentMins ? mins - 1440 : mins;
}

// ─────────────────────────────────────────────
//  RENDER TODO LIST
// ─────────────────────────────────────────────
let currentSections = null;

function renderTodo() {
  const nG = document.getElementById('todo-no-goals'), eS = document.getElementById('todo-empty-state'), c = document.getElementById('todo-content');
  document.getElementById('loading').style.display = 'none';
  if (goals.length === 0) { nG.style.display = 'block'; c.style.display = 'none'; eS.style.display = 'none'; return; }
  nG.style.display = 'none';

  const vD = getActiveDateStr(), isT = vD === todayStr();

  const appH = habits.filter(h => isHabitActiveOnDate(h, vD) || (h.doneCounts[vD] > 0));

  function isFlexOverdue(h, dateStr) {
    const interval = parseInt(h.frequency.split(':')[1], 10);
    if (isNaN(interval)) return false;
    let lastDone = null;
    for (const [dStr, count] of Object.entries(h.doneCounts || {})) {
      if (count >= (h.target_count || 1) && dStr < dateStr) {
        const d = new Date(dStr + 'T00:00:00');
        if (!lastDone || d > lastDone) lastDone = d;
      }
    }
    const anchor = lastDone || (h.created_at ? new Date(h.created_at) : new Date());
    anchor.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + 'T00:00:00');
    const diffDays = Math.floor((target - anchor) / 86400000);
    return diffDays >= interval;
  }

  const allFlexH = habits.filter(h => h.frequency && h.frequency.startsWith('flexible:'));
  allFlexH.forEach(h => {
    if (isT && isFlexOverdue(h, vD) && !flexOverrides[`${h.id}_${vD}`] && !(h.doneCounts[vD] > 0)) {
      flexOverrides[`${h.id}_${vD}`] = true;
      localStorage.setItem('habits_flex_overrides', JSON.stringify(flexOverrides));
    }
  });

  const flexH = allFlexH.filter(h => !appH.includes(h) && !(h.doneCounts[vD] > 0));
  const appHFinal = habits.filter(h => isHabitActiveOnDate(h, vD) || (h.doneCounts[vD] > 0));

  let dT = todos.filter(t => !t.completed && t.due_date === vD);
  if (isT) dT = [...todos.filter(t => !t.completed && t.due_date && t.due_date < vD), ...dT];
  const uT = todos.filter(t => !t.due_date && !t.completed);
  const cT = todos.filter(t => t.completed && (t.completed_at || t.due_date) === vD);

  if (appHFinal.length === 0 && dT.length === 0 && uT.length === 0 && flexH.length === 0) {
    eS.style.display = 'block'; c.style.display = 'none'; return;
  }
  eS.style.display = 'none'; c.style.display = 'block';

  // Header stats
  const dH = appHFinal.filter(h => h.habit_type !== 'counter' && (h.doneCounts[vD]||0) >= (h.target_count||1)).length;
  const tH = appHFinal.filter(h => h.habit_type !== 'counter').length;
  const tM = appHFinal.reduce((s,h) => s+(h.duration_minutes||0), 0);
  const pct = tH ? Math.round(dH/tH*100) : 0;
  animateValue(document.getElementById('ring-label'), FX.currentRingPct, pct, 800, '%'); FX.currentRingPct = pct;
  const cF = 2*Math.PI*15.9, tF = (pct/100)*cF;
  document.getElementById('ring-fill').style.strokeDasharray = `${tF.toFixed(1)} ${(cF-tF).toFixed(1)}`;
  const durEl = document.getElementById('header-duration');
  if (tM > 0) { durEl.style.display = 'flex'; animateValue(document.getElementById('duration-total'), FX.currentDurMins, tM, 800, 'm'); FX.currentDurMins = tM; } else durEl.style.display = 'none';

  const dTodoDone = dT.filter(t => (t.current_count||0) >= (t.target_count||1)).length;
  const uTodoDone = uT.filter(t => (t.current_count||0) >= (t.target_count||1)).length;
  const totalItems = tH + dT.length + uT.length, doneItems = dH + dTodoDone + uTodoDone;
  const fracEl = document.getElementById('header-task-fraction');
  if (fracEl) {
    if (totalItems > 0 && isT) {
      fracEl.style.display = 'flex';
      document.getElementById('task-fraction-done').textContent = doneItems;
      document.getElementById('task-fraction-total').textContent = totalItems;
      // Also update panel fraction if on desktop
      if (typeof updatePanelTaskFraction === 'function') {
        updatePanelTaskFraction();
      }
    } else {
      fracEl.style.display = 'none';
      const panelFrac = document.getElementById('panel-task-fraction');
      if (panelFrac) panelFrac.style.display = 'none';
    }
  }

  // Section assignment
  const combinedItems = [
    ...appHFinal.map(h => ({ ...h, type: 'habit' })),
    ...dT.map(t => ({ ...t, type: 'todo' })),
    ...cT.map(t => ({ ...t, type: 'todo' }))
  ];

  function tokenToSection(token) {
    if (!token) return 'anytime';
    if (token === 'morning' || token === 'afternoon' || token === 'evening') return token;
    const mins = getTokenMinutes(token);
    if (mins !== null) {
      if (mins < 12 * 60) return 'morning';
      if (mins < 17 * 60) return 'afternoon';
      return 'evening';
    }
    return 'anytime';
  }

  function getItemSection(item) {
    let token = null;
    if (item.type === 'todo') {
      token = item.scheduled_time || null;
    } else {
      const tokens = parseHabitScheduledTimes(item.scheduled_time);
      if (tokens.length === 0) { token = null; }
      else {
        const done = item.doneCounts[vD] || 0;
        const target = item.target_count || 1;
        token = done >= target ? tokens[tokens.length - 1] : tokens[Math.min(done, tokens.length - 1)];
      }
    }
    return tokenToSection(token);
  }

  const nowMins = getCurrentMinutes();
  const CUTOFFS = { morning: 12 * 60, afternoon: 17 * 60, evening: Infinity };
  const SECTION_ORDER = ['morning', 'afternoon', 'evening'];
  let currentActiveBracket = nowMins >= 17 * 60 ? 'evening' : nowMins >= 12 * 60 ? 'afternoon' : 'morning';

  const sections = { counters: [], morning: [], afternoon: [], evening: [], completed: [] };
  currentSections = sections;
  combinedItems.forEach(item => {
    if (item.type === 'habit' && item.habit_type === 'counter') { sections.counters.push(item); return; }
    const isDone = item.type === 'habit'
      ? (item.habit_type !== 'counter' && (item.doneCounts[vD] || 0) >= (item.target_count || 1))
      : (item.current_count || 0) >= (item.target_count || 1);
    if (isDone) { sections.completed.push(item); }
    else {
      const sec = getItemSection(item);
      sections[sec === 'anytime' ? currentActiveBracket : sec].push(item);
    }
  });

  // Rollover past-section pending items to next bracket
  if (isT) {
    for (let si = 0; si < SECTION_ORDER.length - 1; si++) {
      const sec = SECTION_ORDER[si];
      if (nowMins >= CUTOFFS[sec]) {
        const secIdx = si, next = SECTION_ORDER[si + 1];
        const remaining = [];
        sections[sec].forEach(item => {
          let targetSec = next;
          if (item.type === 'habit') {
            const tokens = parseHabitScheduledTimes(item.scheduled_time);
            const done = item.doneCounts[vD] || 0;
            for (let ti = done; ti < tokens.length; ti++) {
              const tSec = tokenToSection(tokens[ti]);
              if (SECTION_ORDER.indexOf(tSec) > secIdx) { targetSec = tSec; break; }
            }
          }
          sections[targetSec].push({ ...item, _rolledOver: true });
        });
        sections[sec] = remaining;
      }
    }
  }

  // Sort by order values
  function getItemOrder(item, dateStr) {
    if (item.type === 'todo') {
      const order = getTodoOrder(item.id, dateStr);
      return order !== null ? order : Number.MAX_SAFE_INTEGER;
    } else {
      const order = getHabitOrder(item.id, dateStr);
      return order !== null ? order : Number.MAX_SAFE_INTEGER;
    }
  }

  // Initialize orders for items that don't have one yet
  function initializeDailyOrders(dateStr) {
    const habitItems = habits.filter(h => isHabitActiveOnDate(h, dateStr) || (h.doneCounts[dateStr] > 0));
    habitItems.forEach((h, idx) => { if (getHabitOrder(h.id, dateStr) === null) setHabitOrder(h.id, dateStr, idx); });

    const todoItems = todos.filter(t => t.due_date === dateStr);
    todoItems.forEach((t, idx) => { if (getTodoOrder(t.id, dateStr) === null) setTodoOrder(t.id, dateStr, idx); });
  }
  initializeDailyOrders(vD);

  ['counters','morning','afternoon','evening','completed'].forEach(sec => {
    sections[sec].sort((a, b) => {
      const aOrder = getItemOrder(a, vD);
      const bOrder = getItemOrder(b, vD);
      return aOrder - bOrder;
    });
  });

  const container = document.getElementById('items-container');
  container.innerHTML = '';

  // Cache goal lookups to avoid repeated array searches
  const goalCache = new Map();
  goals.forEach(g => goalCache.set(String(g.id), g));

  const getGoal = (id) => goalCache.get(String(id));

  const SECTION_META = [
    { key: 'morning',   label: 'Morning',   color: 'var(--gold)' },
    { key: 'afternoon', label: 'Afternoon', color: 'var(--ember)' },
    { key: 'evening',   label: 'Evening',   color: 'var(--sky)' }
  ];

  function buildItemRow(item, i) {
    if (item.type === 'habit') {
      const h = item;
      let stk = 0, tD = new Date(activeDate);
      for (let j = 0; j < 30; j++) {
        const ds = `${tD.getFullYear()}-${String(tD.getMonth()+1).padStart(2,'0')}-${String(tD.getDate()).padStart(2,'0')}`;
        if (isHabitActiveOnDate(h, ds)) { if ((h.doneCounts[ds]||0) >= (h.target_count||1)) stk++; else if (j !== 0) break; }
        tD.setDate(tD.getDate()-1);
      }
      const gB = h.goal_id ? (() => { const g = getGoal(h.goal_id); return g ? `<span class="todo-item-goal">${g.icon} ${escHtml(g.name)}</span>` : ''; })() : '';
      const durationBadge = h.duration_minutes ? `<span class="todo-due" style="color:var(--sky);background:rgba(124,205,240,0.15)">⏱ ${h.duration_minutes}m</span>` : '';
      let timeBadge = '';
      const timeToken = h.scheduled_time;
      if (timeToken) {
        const times = parseHabitScheduledTimes(timeToken);
        const done = h.doneCounts[vD] || 0;
        const idx = Math.min(done, times.length - 1);
        const token = times[idx] || '';
        if (token) {
          const formatted = formatHabitTimeToken(token);
          timeBadge = `<span class="todo-due" style="color:var(--sky);background:rgba(124,205,240,0.15)">🕐 ${formatted}</span>`;
        }
      }
      const isCounter = h.habit_type === 'counter';
      const target = h.target_count || 1, current = h.doneCounts[vD] || 0;
      const isD = !isCounter && current >= target;
      const isRootGlow = getGoal(h.goal_id) && !getGoal(h.goal_id).parent_id;
      let chk = isD ? '<path d="M3 8L6.5 11.5L13 4" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>';
      if (!isD && target > 1) chk = `<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor">${current}/${target}</text>`;
      const r = document.createElement('div');
      r.className = `todo-item-row habit-row ${isD ? 'done' : ''}${isRootGlow ? ' root-goal-glow' : ''}${isCounter ? ' counter-habit' : ''}`;
      r.setAttribute('data-id', h.id); r.style.animationDelay = `${i*30}ms`;
      r.setAttribute('draggable', 'true');
      r.setAttribute('data-type', 'habit');
      r.addEventListener('dragstart', handleDragStart);
      r.addEventListener('dragend', handleDragEnd);
      r.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragOverRow) dragOverRow.classList.remove('drag-over-row');
        dragOverRow = r;
        r.classList.add('drag-over-row');
      });
      r.addEventListener('dragleave', (e) => {
        if (e.target === r) {
          r.classList.remove('drag-over-row');
          if (dragOverRow === r) dragOverRow = null;
        }
      });
      r.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      if (isCounter) {
        const countBadge = current > 0 ? `<span class="counter-count-badge">${current}</span>` : '';
        const decBtn = current > 0 ? `<button class="counter-dec-btn" data-id="${h.id}" title="Undo one"><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></button>` : '';
        r.innerHTML = `<button class="todo-edit-btn" data-editid="${h.id}">✏️</button><button class="todo-delete-btn" data-id="${h.id}">✕</button><div class="todo-item-icon">${h.icon}</div><div class="todo-item-body"><span class="todo-item-name">${escHtml(h.name)}</span><div class="todo-item-meta">${gB}${durationBadge}${timeBadge}</div></div><div class="todo-right-group">${countBadge}${decBtn}<div class="todo-item-check counter-btn" data-id="${h.id}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></div></div>`;
      } else {
        let chk = isD ? '<path d="M3 8L6.5 11.5L13 4" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>';
        if (!isD && target > 1) chk = `<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor">${current}/${target}</text>`;
        r.innerHTML = `<button class="todo-edit-btn" data-editid="${h.id}">✏️</button><button class="todo-delete-btn" data-id="${h.id}">✕</button><div class="todo-item-icon">${h.icon}</div><div class="todo-item-body"><span class="todo-item-name">${escHtml(h.name)}</span><div class="todo-item-meta">${gB}${durationBadge}${timeBadge}</div></div><div class="todo-right-group">${stk>0?`<span class="todo-streak">🔥 ${stk}</span>`:''}<div class="todo-item-check ${!isD && current>0?'partial':''}" data-id="${h.id}"><svg width="24" height="24" viewBox="0 0 16 16" fill="none">${chk}</svg></div></div>`;
      }
      r.querySelector(isCounter ? '.counter-btn' : '.todo-item-check').addEventListener('click', () => toggleHabit(h.id));
      if (isCounter) { const db = r.querySelector('.counter-dec-btn'); if (db) db.addEventListener('click', () => decrementCounter(h.id)); }
      r.querySelector('.todo-delete-btn').addEventListener('click', () => deleteHabit(h.id));
      r.querySelector('.todo-edit-btn').addEventListener('click', () => openHabitEditModal(h.id));
      attachRowActions(r, () => openHabitEditModal(h.id), () => deleteHabit(h.id));
      return r;
    } else {
      const t = item;
      const g = getGoal(t.goal_id), isO = !t.completed && t.due_date && t.due_date < todayStr();
      const target = t.target_count || 1, current = t.current_count || 0, isD = current >= target;
      let chk = isD ? '<path d="M3 8L6.5 11.5L13 4" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>';
      if (!isD && target > 1) chk = `<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor">${current}/${target}</text>`;
      let timeBadge = '';
      if (t.scheduled_time) {
        const times = parseHabitScheduledTimes(t.scheduled_time);
        const current = t.current_count || 0;
        const idx = Math.min(current, times.length - 1);
        const token = times[idx] || '';
        if (token) {
          const formatted = formatHabitTimeToken(token);
          timeBadge = `<span class="todo-due" style="color:var(--sky);background:rgba(124,205,240,0.15)">🕐 ${formatted}</span>`;
        }
      }
      const isRootGlow = g && !g.parent_id;
      let todoTag = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px;"><rect x="2" y="3" width="12" height="2" rx="1" fill="currentColor"/><rect x="2" y="7.5" width="12" height="2" rx="1" fill="currentColor"/><rect x="2" y="12" width="8" height="2" rx="1" fill="currentColor"/></svg>Task';
      if (t.due_date && t.due_date === todayStr()) {
        todoTag = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px;"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2"/><path d="M8 4v4l2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Today';
      } else if (t.due_date && t.due_date < todayStr()) {
        todoTag = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px;"><path d="M8 1l1.5 3.5L13 5l-2.5 2.5L11 11l-3-1.5L5 11l.5-3.5L3 5l3.5-.5L8 1z" fill="currentColor"/></svg>Overdue';
      } else if (!t.due_date) {
        todoTag = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px;"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2"/><path d="M8 5v3l2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Eventually';
      }
      const r = document.createElement('div');
      r.className = `todo-item-row ${isD ? 'done' : ''}${isRootGlow ? ' root-goal-glow' : ''}`;
      r.setAttribute('data-id', t.id);
      r.setAttribute('draggable', 'true');
      r.setAttribute('data-type', 'todo');
      r.addEventListener('dragstart', handleDragStart);
      r.addEventListener('dragend', handleDragEnd);
      r.addEventListener('dragenter', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragOverRow) dragOverRow.classList.remove('drag-over-row');
        dragOverRow = r;
        r.classList.add('drag-over-row');
      });
      r.addEventListener('dragleave', (e) => {
        if (e.target === r) {
          r.classList.remove('drag-over-row');
          if (dragOverRow === r) dragOverRow = null;
        }
      });
      r.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      });
      r.innerHTML = `<button class="todo-edit-btn" data-editid="${t.id}">✏️</button><button class="todo-delete-btn" data-id="${t.id}">✕</button><div class="todo-item-icon" style="opacity:1; color: ${isO ? 'var(--ember)' : 'inherit'}">⬤</div><div class="todo-item-body"><span class="todo-item-name">${escHtml(t.name)}</span><div class="todo-item-meta">${g?`<span class="todo-item-goal">${g.icon} ${escHtml(g.name)}</span>`:''}${timeBadge}${(!isT)?`<span class="todo-due ${isO?'overdue':''}">${formatDue(t.due_date)}</span>`:''}</div></div><div class="todo-right-group"><div class="todo-item-check ${!isD && current>0?'partial':''}" data-id="${t.id}"><svg width="24" height="24" viewBox="0 0 16 16" fill="none">${chk}</svg></div></div>`;
      r.querySelector('.todo-item-check').addEventListener('click', () => toggleTodo(t.id));
      r.querySelector('.todo-delete-btn').addEventListener('click', () => deleteTodo(t.id));
      r.querySelector('.todo-edit-btn').addEventListener('click', () => openTodoEditModal(t.id));
      attachRowActions(r, () => openTodoEditModal(t.id), () => deleteTodo(t.id));
      return r;
    }
  }

  let globalIdx = 0;

  function buildCountersBracket() {
    const items = sections.counters;
    if (items.length === 0) return null;
    const group = document.createElement('div');
    group.className = 'time-section-group time-section-counters section-state-active';
    group.style.setProperty('--section-color', 'var(--green)');
    const bracket = document.createElement('div'); bracket.className = 'time-section-bracket';
    bracket.innerHTML = `<span class="time-section-label-text"></span>`; group.appendChild(bracket);
    const rowsWrap = document.createElement('div'); rowsWrap.className = 'time-section-rows';
    items.forEach(item => rowsWrap.appendChild(buildItemRow(item, globalIdx++)));
    group.appendChild(rowsWrap); return group;
  }

  let countersInserted = false;
  SECTION_META.forEach(({ key, label, color }) => {
    const items = sections[key];
    let sectionState = 'future';
    if (isT) {
      if (nowMins >= CUTOFFS[key]) sectionState = 'past';
      else {
        const prevKey = SECTION_ORDER[SECTION_ORDER.indexOf(key) - 1];
        const prevCutoff = prevKey ? CUTOFFS[prevKey] : 0;
        sectionState = nowMins >= prevCutoff ? 'active' : 'future';
      }
    }
    if (!countersInserted && (sectionState === 'active' || (!isT && key === SECTION_META[0].key))) {
      countersInserted = true;
      const cb = buildCountersBracket(); if (cb) container.appendChild(cb);
    }
    if (items.length === 0) return;
    const group = document.createElement('div');
    group.className = `time-section-group time-section-${key} section-state-${sectionState}`;
    group.style.setProperty('--section-color', color);
    group.dataset.section = key;
    const bracket = document.createElement('div'); bracket.className = 'time-section-bracket';
    bracket.innerHTML = `<span class="time-section-label-text">${label}</span>`; group.appendChild(bracket);
    const rowsWrap = document.createElement('div'); rowsWrap.className = 'time-section-rows';
    items.forEach(item => rowsWrap.appendChild(buildItemRow(item, globalIdx++)));
    group.appendChild(rowsWrap); container.appendChild(group);
  });

  if (!countersInserted) { const cb = buildCountersBracket(); if (cb) container.prepend(cb); }

  // Flexible habits section
  const flexS = document.getElementById('todo-flexible-list'); flexS.innerHTML = '';
  flexH.forEach(h => {
    const g = getGoal(h.goal_id);
    const r = document.createElement('div'); r.className = `todo-item-row flex-habit-row`;
    const flexInterval = h.frequency && h.frequency.startsWith('flexible:') ? parseInt(h.frequency.split(':')[1], 10) : 7;
    let lastDoneDate = null;
    for (const [dStr, count] of Object.entries(h.doneCounts || {})) {
      if (count >= (h.target_count || 1)) {
        const d = new Date(dStr + 'T00:00:00'); if (!lastDoneDate || d > lastDoneDate) lastDoneDate = d;
      }
    }
    const _anchor = lastDoneDate || (h.created_at ? new Date(h.created_at) : new Date());
    _anchor.setHours(0, 0, 0, 0);
    const _todayDate = new Date(todayStr() + 'T00:00:00');
    const daysSince = Math.floor((_todayDate - _anchor) / 86400000);
    const daysUntilDue = flexInterval - daysSince;
    let urgencyBadge = '';
    if (daysUntilDue <= 0) urgencyBadge = `<span class="flex-urgency overdue">overdue!</span>`;
    else if (daysUntilDue === 1) urgencyBadge = `<span class="flex-urgency soon">due tomorrow</span>`;
    else if (daysUntilDue <= 3) urgencyBadge = `<span class="flex-urgency soon">due in ${daysUntilDue}d</span>`;
    const gB = g ? `<span class="todo-item-goal">${g.icon} ${escHtml(g.name)}</span>` : '';
    r.innerHTML = `
      <button class="todo-edit-btn" data-editid="${h.id}">✏️</button>
      <button class="todo-delete-btn" data-id="${h.id}">✕</button>
      <div class="todo-item-icon">${h.icon}</div>
      <div class="todo-item-body">
        <span class="todo-item-name">${escHtml(h.name)}</span>
        <div class="todo-item-meta">${urgencyBadge}${gB}</div>
      </div>
      <div class="todo-right-group">
        ${lastDoneDate ? `<span class="todo-streak flex-days-since">${daysSince}d ago</span>` : `<span class="todo-streak flex-days-since">new</span>`}
        <div class="todo-item-check eventually-add" data-id="${h.id}" data-date="${vD}" title="Add to Today">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </div>
      </div>
    `;
    r.querySelector('.todo-delete-btn').addEventListener('click', () => deleteHabit(h.id));
    r.querySelector('.todo-edit-btn').addEventListener('click', () => openHabitEditModal(h.id));
    r.querySelector('.todo-item-check').addEventListener('click', () => setFlexOverride(h.id, vD));
    attachRowActions(r, () => openHabitEditModal(h.id), () => deleteHabit(h.id));
    flexS.appendChild(r);
  });
  document.getElementById('todo-flexible-container').style.display = flexH.length > 0 ? 'block' : 'none';

  // Eventually section
  const evS = document.getElementById('todo-eventually-list'); evS.innerHTML = '';
  uT.sort((a, b) => {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1; if (!b.deadline) return -1;
    return new Date(a.deadline) - new Date(b.deadline);
  });
  uT.forEach(t => {
    const g = getGoal(t.goal_id);
    const r = document.createElement('div'); r.className = `todo-item-row ${t.completed ? 'done' : ''}`;
    const target = t.target_count || 1, current = t.current_count || 0;
    let chk = '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>';
    if (!t.completed && target > 1) chk = `<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor">${current}/${target}</text>`;
    let todoTag = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px;"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2"/><path d="M8 5v3l2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Eventually';
    if (t.deadline && t.deadline === todayStr()) {
      todoTag = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px;"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2"/><path d="M8 4v4l2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Today';
    } else if (t.deadline && t.deadline < todayStr()) {
      todoTag = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px;"><path d="M8 1l1.5 3.5L13 5l-2.5 2.5L11 11l-3-1.5L5 11l.5-3.5L3 5l3.5-.5L8 1z" fill="currentColor"/></svg>Overdue';
    } else if (t.deadline) {
      todoTag = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px;"><rect x="3" y="4" width="10" height="8" rx="1" stroke="currentColor" stroke-width="2"/><path d="M8 2v2M8 12v2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Deadline';
    }
    r.innerHTML = `<button class="todo-edit-btn" data-editid="${t.id}">✏️</button><button class="todo-delete-btn" data-id="${t.id}">✕</button><div class="todo-item-icon" style="opacity:0.7">⏳</div><div class="todo-item-body"><span class="todo-item-name">${escHtml(t.name)}</span><div class="todo-item-meta">${g?`<span class="todo-item-goal">${g.icon} ${escHtml(g.name)}</span>`:''}${t.deadline ? `<span class="todo-due ${t.deadline<todayStr()?'overdue':''}" title="Deadline">🗓 ${formatDue(t.deadline)}</span>` : ''}</div></div><div class="todo-right-group"><div class="todo-item-check eventually-add ${!t.completed && current>0?'partial':''}" data-id="${t.id}" title="Move to Today"><svg width="16" height="16" viewBox="0 0 16 16" fill="none">${chk}</svg></div></div>`;
    r.querySelector('.todo-item-check').addEventListener('click', () => moveTodoToToday(t.id));
    r.querySelector('.todo-delete-btn').addEventListener('click', () => deleteTodo(t.id));
    r.querySelector('.todo-edit-btn').addEventListener('click', () => openTodoEditModal(t.id));
    attachRowActions(r, () => openTodoEditModal(t.id), () => deleteTodo(t.id));
    evS.appendChild(r);
  });
  document.getElementById('todo-eventually-container').style.display = uT.length > 0 ? 'block' : 'none';

  // Completed section
  const todoContent = document.getElementById('todo-content');
  const existingCompWrap = document.getElementById('completed-section');
  if (existingCompWrap) existingCompWrap.remove();
  if (sections.completed.length > 0) {
    const compWrap = document.createElement('div');
    compWrap.id = 'completed-section'; compWrap.style.marginTop = '36px';
    compWrap.innerHTML = `<p class="section-label">Completed</p>`;
    sections.completed.forEach(item => compWrap.appendChild(buildItemRow(item, globalIdx++)));
    todoContent.appendChild(compWrap);
  }

  // Add drop zone listeners to time sections
  rowsWraps = document.querySelectorAll('.time-section-rows');
  rowsWraps.forEach(rowsWrap => {
    rowsWrap.addEventListener('dragover', handleDragOver);
    rowsWrap.addEventListener('drop', handleDrop);
    rowsWrap.addEventListener('dragenter', handleDragEnter);
    rowsWrap.addEventListener('dragleave', handleDragLeave);
  });
}

// ─────────────────────────────────────────────
//  DRAG AND DROP
// ─────────────────────────────────────────────
let draggedItem = null;
let draggedItemType = null;
let draggedItemId = null;
let dragOverRow = null;
let rowsWraps = null;

function handleDragStart(e) {
  draggedItem = this;
  draggedItemType = this.getAttribute('data-type');
  draggedItemId = this.getAttribute('data-id');
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragEnd(e) {
  this.classList.remove('dragging');
  if (dragOverRow) {
    dragOverRow.classList.remove('drag-over-row');
    dragOverRow = null;
  }
  draggedItem = null;
  draggedItemType = null;
  draggedItemId = null;
  if (!rowsWraps) rowsWraps = document.querySelectorAll('.time-section-rows');
  rowsWraps.forEach(rows => rows.classList.remove('drag-over'));
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  return false;
}

function handleDragEnter(e) {
  this.classList.add('drag-over');
}

function handleDragLeave(e) {
  this.classList.remove('drag-over');
}

function getDropInsertionIndex(container, clientY) {
  const rows = Array.from(container.children).filter(el =>
    el.classList.contains('todo-item-row') && !el.classList.contains('dragging')
  );
  if (rows.length === 0) return 0;

  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i].getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    if (clientY < midpoint) return i;
  }
  return rows.length;
}

// ─────────────────────────────────────────────────────────────────────────────
//  DROP HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function handleDrop(e) {
  e.stopPropagation();
  e.preventDefault();

  const dropTarget = this;
  dropTarget.classList.remove('drag-over');

  if (!draggedItemId || !draggedItemType) return;

  const targetSectionGroup = dropTarget.closest('.time-section-group');
  if (!targetSectionGroup) return;
  const targetSection = targetSectionGroup.dataset.section;
  if (!targetSection || !['morning','afternoon','evening'].includes(targetSection)) return;

  const activeDateStr = getActiveDateStr();

  // Get the dragged row element
  const draggedRow = document.querySelector(`.todo-item-row[data-id="${draggedItemId}"]`);
  if (!draggedRow) return;

  // Determine insert position
  const rows = Array.from(dropTarget.children).filter(el =>
    el.classList.contains('todo-item-row') && !el.classList.contains('dragging')
  );
  let insertIndex = rows.length;
  if (dragOverRow && rows.includes(dragOverRow)) {
    insertIndex = rows.indexOf(dragOverRow);
  } else {
    insertIndex = getDropInsertionIndex(dropTarget, e.clientY);
  }

  // Remove hover class
  if (dragOverRow) {
    dragOverRow.classList.remove('drag-over-row');
    dragOverRow = null;
  }

  // Determine original section of dragged row
  const originalSectionGroup = draggedRow.closest('.time-section-group');
  const originalSection = originalSectionGroup?.dataset.section;

  // Move the DOM element
  if (originalSection === targetSection) {
    // Same section: just reorder
    if (insertIndex < rows.length) {
      dropTarget.insertBefore(draggedRow, rows[insertIndex]);
    } else {
      dropTarget.appendChild(draggedRow);
    }
  } else {
    // Cross-section move: remove from original, insert into target
    draggedRow.remove();
    if (insertIndex < rows.length) {
      dropTarget.insertBefore(draggedRow, rows[insertIndex]);
    } else {
      dropTarget.appendChild(draggedRow);
    }
  }

  // Update order numbers for affected sections
  const sectionsToUpdate = new Set([targetSection]);
  if (originalSection && originalSection !== targetSection) {
    sectionsToUpdate.add(originalSection);
  }

  for (const sec of sectionsToUpdate) {
    const secGroup = document.querySelector(`.time-section-group[data-section="${sec}"]`);
    if (!secGroup) continue;
    const rowsWrap = secGroup.querySelector('.time-section-rows');
    const rowsInSec = Array.from(rowsWrap.children).filter(el => el.classList.contains('todo-item-row'));
    rowsInSec.forEach((row, idx) => {
      const id = row.dataset.id;
      const type = row.dataset.type;
      if (type === 'habit') {
        setHabitOrder(id, activeDateStr, idx);
      } else if (type === 'todo') {
        setTodoOrder(id, activeDateStr, idx);
        // No scheduled_time modification – only order mapping is updated.
      }
    });
  }

  // No full re-render needed; DOM already updated.
}

async function saveTodoTime(todo) {
  try {
    const { error } = await supabase.from('todos').eq('id', todo.id).update({ scheduled_time: todo.scheduled_time });
    if (error) throw error;
  } catch (e) {
    console.error('Failed to save todo time:', e);
    const localTodos = lsGet(LS_TODOS) || [];
    const idx = localTodos.findIndex(t => t.id === todo.id);
    if (idx > -1) {
      localTodos[idx].scheduled_time = todo.scheduled_time;
      lsSet(LS_TODOS, localTodos);
    }
  }
}

// ─────────────────────────────────────────────
//  HABIT TOGGLE & DELETE
// ─────────────────────────────────────────────
async function toggleHabit(id) {
  const h = habits.find(h => h.id === id), vD = getActiveDateStr();
  const isCounter = h.habit_type === 'counter';
  const target = h.target_count || 1;
  let current = h.doneCounts[vD] || 0;
  if (!isCounter && current >= target) {
    h.doneCounts[vD] = 0; haptic([15]); renderTodo(); renderGoals();
    const { error: delErr } = await supabase.from('completions').eq('habit_id', id).eq('date', vD).delete();
    if (delErr) { console.error('completions delete failed:', delErr); const c = lsGet(LS_COMPLETIONS); lsSet(LS_COMPLETIONS, c.filter(x => !(x.habit_id===id && x.date===vD))); }
  } else {
    h.doneCounts[vD] = current + 1;
    const isNowDone = !isCounter && h.doneCounts[vD] >= target;
    const row = document.querySelector(`.todo-item-row[data-id="${id}"]`);
    if (isNowDone) {
      haptic([25, 40]); burstFromEl(row.querySelector('.todo-item-check'), 50);
      row.classList.add('just-done'); setTimeout(() => row.classList.remove('just-done'), 500);
      const ap = habits.filter(hb => isHabitActiveOnDate(hb, vD) || (hb.doneCounts[vD] > 0));
      if (ap.length > 0 && ap.every(hb => hb.habit_type === 'counter' || (hb.doneCounts[vD]||0) >= (hb.target_count||1))) {
        celebrate(); showToast('All routines complete! 🎉');
      } else showToast('Momentum building! 🔥');
    } else if (isCounter) {
      haptic([12]); if (row) { burstFromEl(row.querySelector('.counter-btn'), 12); }
      showToast(`${h.name}: ${h.doneCounts[vD]}`);
    } else {
      haptic([20]); burstFromEl(row.querySelector('.todo-item-check'), 20);
    }
    renderTodo(); renderGoals();
    const newId = crypto.randomUUID();
    const { error: insErr } = await supabase.from('completions').insert([{ id: newId, habit_id: id, date: vD }]);
    if (insErr) { console.error('completions insert failed:', insErr); const c = lsGet(LS_COMPLETIONS); c.push({ id: newId, habit_id: id, date: vD }); lsSet(LS_COMPLETIONS, c); }
  }
}

async function decrementCounter(id) {
  const h = habits.find(h => h.id === id), vD = getActiveDateStr();
  if (!h || h.habit_type !== 'counter') return;
  const current = h.doneCounts[vD] || 0;
  if (current <= 0) return;
  h.doneCounts[vD] = current - 1; haptic([15]); renderTodo(); renderGoals();
  showToast(`${h.name}: ${h.doneCounts[vD]}`);
  try {
    const { data, error } = await supabase.from('completions').select('id').eq('habit_id', id).eq('date', vD).order('created_at', { ascending: false });
    if (error) throw error;
    if (data && data.length > 0) await supabase.from('completions').eq('id', data[0].id).delete();
  } catch (e) {
    console.error('decrementCounter failed:', e);
    const c = lsGet(LS_COMPLETIONS);
    const idx = c.findLastIndex(x => x.habit_id === id && x.date === vD);
    if (idx > -1) { c.splice(idx, 1); lsSet(LS_COMPLETIONS, c); }
  }
}
window.decrementCounter = decrementCounter;

async function deleteHabit(id) {
  if (!confirm('Erase this habit completely?')) return;
  haptic([30]); habits = habits.filter(h => h.id !== id); renderTodo(); renderGoals();
  try { await supabase.from('completions').eq('habit_id', id).delete(); await supabase.from('habits').eq('id', id).delete(); }
  catch(e) { console.error('deleteHabit failed:', e); lsSet(LS_HABITS, lsGet(LS_HABITS).filter(h => h.id !== id)); lsSet(LS_COMPLETIONS, lsGet(LS_COMPLETIONS).filter(c => c.habit_id !== id)); }
  showToast('Habit removed');
}

// ─────────────────────────────────────────────
//  HABIT MODAL
// ─────────────────────────────────────────────
function openModal()                { preselectedGoalId = null; editingHabitId = null; _openHabitModal(); }
function openModalForGoal(gId)      { preselectedGoalId = gId;  editingHabitId = null; _openHabitModal(); }
function openHabitEditModal(id)     { editingHabitId = id; preselectedGoalId = null; _openHabitModal(); }

function _openHabitModal() {
  const ex = editingHabitId ? habits.find(h => h.id === editingHabitId) : null;
  document.getElementById('habit-modal-title').textContent = ex ? 'Edit Habit' : 'New Habit';
  document.getElementById('habit-save-btn').textContent    = ex ? 'Update habit' : 'Save habit';
  const iconInput = document.getElementById('habit-icon'); iconInput.value = ex?.icon || '⬤';
  if (ex && ex.frequency) {
    if      (ex.frequency === 'daily')                { selectedFreq = 'daily'; selectedDays.clear(); selectedInterval = 2; }
    else if (ex.frequency.startsWith('weekly:'))      { selectedFreq = 'weekly'; selectedDays = new Set(ex.frequency.substring(7).split(',')); selectedInterval = 2; }
    else if (ex.frequency.startsWith('interval:'))    { selectedFreq = 'interval'; selectedInterval = parseInt(ex.frequency.substring(9), 10) || 2; selectedDays.clear(); }
    else if (ex.frequency.startsWith('flexible:'))    { selectedFreq = 'flexible'; selectedInterval = parseInt(ex.frequency.substring(9), 10) || 7; selectedDays.clear(); }
    else { selectedFreq = 'daily'; selectedDays.clear(); selectedInterval = 2; }
  } else { selectedFreq = 'daily'; selectedDays = new Set(); selectedInterval = 2; }
  document.querySelectorAll('.freq-tab').forEach(b => b.classList.toggle('active', b.dataset.freq === selectedFreq));
  document.getElementById('day-picker').style.display = selectedFreq === 'weekly' ? 'flex' : 'none';
  document.getElementById('interval-picker').style.display = (selectedFreq === 'interval' || selectedFreq === 'flexible') ? 'block' : 'none';
  const intLabel = document.querySelector('.interval-picker label');
  if (intLabel) intLabel.textContent = selectedFreq === 'flexible' ? 'Within X days (deadline)' : 'Every X days';
  document.getElementById('habit-interval').value = selectedInterval;
  document.querySelectorAll('.day-btn').forEach(b => b.classList.toggle('selected', selectedDays.has(b.dataset.day)));
  document.getElementById('habit-name').value = ex ? ex.name : '';
  document.getElementById('habit-duration').value = ex?.duration_minutes || '';
  const tc = ex?.target_count || 1;
  document.getElementById('habit-target').value = tc;
  document.getElementById('habit-target-display').textContent = tc + '×';
  document.getElementById('habit-counter').checked = ex?.habit_type === 'counter';
  const presetTimes = parseHabitScheduledTimes(ex?.scheduled_time);
  renderHabitTimeSlots(tc, presetTimes);
  populateGoalSelect();
  if (ex?.goal_id) document.getElementById('habit-goal').value = ex.goal_id;
  else if (preselectedGoalId) document.getElementById('habit-goal').value = preselectedGoalId;
  selectedEmoji = iconInput.value;
  setTimeout(() => {
    document.querySelectorAll('#habit-emoji-grid .emoji-opt').forEach(el => {
      el.classList.toggle('selected', el.textContent.trim() === iconInput.value.trim());
    });
  }, 50);
  document.getElementById('modal').classList.add('open');
  setTimeout(() => document.getElementById('habit-name').focus(), 400);
  haptic([15]);
}

function closeModal()          { document.getElementById('modal').classList.remove('open'); }
function closeOnBackdrop(e)    { if (e.target === document.getElementById('modal')) closeModal(); }

function pickHabitEmoji(emoji) {
  const input = document.getElementById('habit-icon');
  if (input) { input.value = emoji; selectedEmoji = emoji; }
  document.querySelectorAll('#habit-emoji-grid .emoji-opt').forEach(el => el.classList.toggle('selected', el.textContent.trim() === emoji));
  haptic([10]);
}
function syncHabitIconPreview(input) {
  selectedEmoji = input.value || '⬤';
  const cur = input.value.trim();
  document.querySelectorAll('#habit-emoji-grid .emoji-opt').forEach(el => el.classList.toggle('selected', el.textContent.trim() === cur));
}

function selectFreq(f) {
  selectedFreq = f;
  document.querySelectorAll('.freq-tab').forEach(b => b.classList.toggle('active', b.dataset.freq === f));
  document.getElementById('day-picker').style.display = f === 'weekly' ? 'flex' : 'none';
  document.getElementById('interval-picker').style.display = (f === 'interval' || f === 'flexible') ? 'block' : 'none';
  const intLabel = document.querySelector('.interval-picker label');
  if (intLabel) intLabel.textContent = f === 'flexible' ? 'Within X days (deadline)' : 'Every X days';
  if (f === 'daily') { selectedDays.clear(); document.querySelectorAll('.day-btn').forEach(b => b.classList.remove('selected')); }
  haptic([15]);
}
document.querySelectorAll('.day-btn').forEach(b => b.addEventListener('click', () => {
  const d = b.dataset.day;
  selectedDays.has(d) ? (selectedDays.delete(d), b.classList.remove('selected')) : (selectedDays.add(d), b.classList.add('selected'));
  haptic([15]);
}));

async function saveHabit() {
  const n = document.getElementById('habit-name').value.trim();
  const dur = document.getElementById('habit-duration').value || null;
  const gId = document.getElementById('habit-goal').value || null;
  const tc = parseInt(document.getElementById('habit-target').value) || 1;
  const rawSlots = readHabitTimeSlots();
  const slots = rawSlots.map(x => x || '');
  let t = tc <= 1 ? (slots[0] || null) : JSON.stringify(slots.slice(0, tc));
  let iconChar = document.getElementById('habit-icon').value.trim();
  if (!iconChar) iconChar = '⬤';
  iconChar = Array.from(iconChar)[0];
  const habitType = document.getElementById('habit-counter').checked ? 'counter' : 'standard';
  if (!n) { document.getElementById('habit-name').focus(); haptic([30,20,30]); return; }
  if (!gId) { showToast('Please connect to a goal'); haptic([30,20,30]); return; }
  let frequencyStr;
  if      (selectedFreq === 'daily')    { frequencyStr = 'daily'; }
  else if (selectedFreq === 'weekly')   { if (selectedDays.size === 0) { showToast('Pick at least one day'); haptic([30,20,30]); return; } frequencyStr = 'weekly:' + [...selectedDays].join(','); }
  else if (selectedFreq === 'interval') { frequencyStr = 'interval:' + (parseInt(document.getElementById('habit-interval').value, 10) || 2); }
  else if (selectedFreq === 'flexible') { frequencyStr = 'flexible:' + (parseInt(document.getElementById('habit-interval').value, 10) || 7); }
  closeModal();
  if (editingHabitId) {
    const patch = { name:n, icon:iconChar, scheduled_time:t, duration_minutes:dur?parseInt(dur):null, frequency:frequencyStr, goal_id:gId, target_count:tc, habit_type:habitType };
    const i = habits.findIndex(h => h.id === editingHabitId);
    if (i > -1) habits[i] = { ...habits[i], ...patch }; renderTodo(); renderGoals();
    try { await supabase.from('habits').eq('id', editingHabitId).update(patch); showToast('Habit updated ✨'); }
    catch(e) { lsSet(LS_HABITS, habits.map(({doneCounts,...h}) => h)); showToast('Habit updated locally ✨'); }
  } else {
    try {
      await supabase.from('habits').insert([{ name:n, icon:iconChar, scheduled_time:t, duration_minutes:dur?parseInt(dur):null, frequency:frequencyStr, goal_id:gId, target_count:tc, habit_type:habitType }]);
      await fetchHabits(); haptic([20,35]); showToast('Habit planted! 🌱');
    } catch(e) {
      const nh = { id: crypto.randomUUID(), name:n, icon:iconChar, scheduled_time:t, duration_minutes:dur?parseInt(dur):null, frequency:frequencyStr, goal_id:gId, target_count:tc, habit_type:habitType, created_at: new Date().toISOString() };
      const r = lsGet(LS_HABITS); r.push(nh); lsSet(LS_HABITS, r);
      habits.push({ ...nh, doneCounts:{} }); renderTodo(); renderGoals(); haptic([20,35]); showToast('Habit saved locally 🌱');
    }
  }
}