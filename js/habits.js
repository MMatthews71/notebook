// ─────────────────────────────────────────────
//  HABITS — FETCH
// ─────────────────────────────────────────────
async function fetchHabits(skipRender = false) {
  const { data: hr, error: he } = await supabase.from('habits').select('*').order('created_at', { ascending: true });
  if (he) throw he;
  const { data: cr, error: ce } = await supabase.from('completions').select('*');
  if (ce) throw ce;
  habits = hr.map(h => ({ ...h, doneCounts: (cr||[]).filter(c => c.habit_id === h.id).reduce((acc, c) => { acc[c.date] = (acc[c.date] || 0) + 1; return acc; }, {}) }));
  if (!skipRender) { if (currentTab === 'todo') renderTodo(); if (currentTab === 'goals') renderGoals(); populateGoalSelect(); }
}

// ─────────────────────────────────────────────
//  HABIT ACTIVE DATE CHECK
// ─────────────────────────────────────────────
function isHabitActiveOnDate(habit, dateStr) {
  // Skip override takes precedence
  if (typeof isHabitSkipped === 'function' && isHabitSkipped(habit.id, dateStr)) {
    return false;
  }
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
      supabase.toggleFlexOverride(h.id, vD, true);
    }
  });

  const flexH = allFlexH.filter(h => !appH.includes(h) && !(h.doneCounts[vD] > 0));
  const appHFinal = habits.filter(h => isHabitActiveOnDate(h, vD) || (h.doneCounts[vD] > 0));

  // Standard todos (excluding streaks)
  let dT = todos.filter(t => !t.completed && t.type !== 'streak' && t.due_date === vD);
  if (isT) dT = [...todos.filter(t => !t.completed && t.type !== 'streak' && t.due_date && t.due_date < vD), ...dT];

  const uT = todos.filter(t => !t.due_date && !t.completed && t.type !== 'streak');

  // Completed todos (including forever-completed streaks and standard completed)
  const cT = todos.filter(t => t.completed && (t.completed_at || t.due_date) === vD);

  // Active streak todos (appear every day until forever-done)
  const streakActive = todos.filter(t => t.type === 'streak' && !t.completed);

  if (appHFinal.length === 0 && dT.length === 0 && uT.length === 0 && flexH.length === 0 && streakActive.length === 0) {
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
    ...dT.map(t => ({ ...t })),
    ...streakActive,    // streak todos appear every day
    ...cT.map(t => ({ ...t }))
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
    // If not a habit, treat as todo (handles missing/unknown types)
    if (item.type !== 'habit') {
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
      : (item.type === 'standard' || item.type === 'todo')
        ? (item.current_count || 0) >= (item.target_count || 1)
        : item.type === 'streak'
          ? (item.completed || (Array.isArray(item.streak_dates) ? item.streak_dates : []).includes(vD))
          : false;
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

  // Sort by order values — todos have type 'standard'/'streak', not 'todo'
  function getItemOrder(item, dateStr) {
    if (item.type !== 'habit') {
      const order = getTodoOrder(item.id, dateStr);
      return order !== null ? order : Number.MAX_SAFE_INTEGER;
    } else {
      const order = getHabitOrder(item.id, dateStr);
      return order !== null ? order : Number.MAX_SAFE_INTEGER;
    }
  }

  // Assign initial orders based on actual section layout (only for items without one)
  function initializeDailyOrders(dateStr) {
    ['morning', 'afternoon', 'evening', 'counters'].forEach(sec => {
      (sections[sec] || []).forEach((item, idx) => {
        if (item.type === 'habit') {
          if (getHabitOrder(item.id, dateStr) === null) setHabitOrder(item.id, dateStr, idx);
        } else {
          if (getTodoOrder(item.id, dateStr) === null) setTodoOrder(item.id, dateStr, idx);
        }
      });
    });
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
      r.setAttribute('data-id', h.id);
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
        r.innerHTML = `
          <button class="todo-edit-btn" data-editid="${h.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="todo-delete-btn" data-id="${h.id}">✕</button>
          <button class="todo-skip-btn" data-skipid="${h.id}">⏭️</button>

          <span class="item-icon">${h.icon}</span>
          <div class="todo-item-body">
            <span class="todo-item-name">${escHtml(h.name)}</span>
            ${(gB || durationBadge) ? `<div class="todo-item-meta">${gB}${durationBadge}</div>` : ''}
          </div>
          <div class="todo-right-group">
            ${current > 0 ? `<span class="counter-count-badge">${current}</span><button class="counter-dec-btn" data-id="${h.id}" title="Undo one"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></button>` : ''}
            <div class="todo-item-check counter-btn" data-id="${h.id}"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg></div>
          </div>`;
      } else {
        let chk = isD ? '<path d="M3 8L6.5 11.5L13 4" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>';
        if (!isD && target > 1) chk = `<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor">${current}/${target}</text>`;
        r.innerHTML = `
          <button class="todo-edit-btn" data-editid="${h.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="todo-delete-btn" data-id="${h.id}">✕</button>
          <button class="todo-skip-btn" data-skipid="${h.id}">⏭️</button>

          <span class="item-icon">${h.icon}</span>
          <div class="todo-item-body">
            <span class="todo-item-name">${escHtml(h.name)}</span>
            ${(gB || durationBadge || timeBadge) ? `<div class="todo-item-meta">${gB}${durationBadge}${timeBadge}</div>` : ''}
          </div>
          <div class="todo-right-group">
            ${stk > 0 ? `<span class="todo-streak">🔥 ${stk}</span>` : ''}
            <div class="todo-item-check ${!isD && current > 0 ? 'partial' : ''}" data-id="${h.id}"><svg width="24" height="24" viewBox="0 0 16 16" fill="none">${chk}</svg></div>
          </div>`;
      }
      r.querySelector(isCounter ? '.counter-btn' : '.todo-item-check').addEventListener('click', () => toggleHabit(h.id));
      if (isCounter) { const db = r.querySelector('.counter-dec-btn'); if (db) db.addEventListener('click', () => decrementCounter(h.id)); }
      r.querySelector('.todo-delete-btn').addEventListener('click', (e) => { e.stopPropagation(); withConfirm(e.currentTarget, () => deleteHabit(h.id)); });
      r.querySelector('.todo-edit-btn').addEventListener('click', () => openHabitEditModal(h.id));
      const skipBtn = r.querySelector('.todo-skip-btn');
      if (skipBtn) { skipBtn.addEventListener('click', (e) => { e.stopPropagation(); skipHabitToday(h.id); }); }
      attachRowActions(r, () => openHabitEditModal(h.id), () => deleteHabit(h.id), () => skipHabitToday(h.id), '⏭️ Skip today');
      attachPointerDrag(r);
      return r;
    } else {
      // ── STREAK TODO ──────────────────────────
      if (item.type === 'streak') {
        const streakDates = Array.isArray(item.streak_dates) ? item.streak_dates : [];
        const doneToday = streakDates.includes(vD);
        const streakLen = streakDates.length;
        const isForeverDone = item.completed;
        const g = getGoal(item.goal_id);
        const gB = g ? `<span class="todo-item-goal">${g.icon} ${escHtml(g.name)}</span>` : '';
        const isRootGlow = g && !g.parent_id;
        const doneClass = (isForeverDone || doneToday) ? ' done' : '';
        const r = document.createElement('div');
        r.className = `todo-item-row${doneClass}${isRootGlow ? ' root-goal-glow' : ''}`;
        r.setAttribute('data-id', item.id);
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
        r.innerHTML = `
          <button class="todo-edit-btn" data-editid="${item.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="todo-delete-btn" data-id="${item.id}">✕</button>
          <button class="todo-tomorrow-btn" data-tomorrowid="${item.id}">⏩</button>

          <div class="todo-item-body">
            <span class="todo-item-name">${escHtml(item.name)}</span>
            ${(gB || streakLen > 0) ? `<div class="todo-item-meta">${gB}${streakLen > 0 ? `<span class="streak-count">🔥 ${streakLen}d</span>` : ''}</div>` : ''}
          </div>
          <div class="todo-right-group streak-actions">
            <button class="streak-today-btn ${doneToday ? 'done-today' : ''}" data-id="${item.id}" title="${doneToday ? 'Undo today' : 'Done today'}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2.5"/>
                ${doneToday
                  ? '<path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
                  : '<path d="M12 8v8M8 12h8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>'}
              </svg>
            </button>
            <button class="streak-forever-btn" data-id="${item.id}" title="Complete forever">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          </div>
        `;

        // Attach events
        r.querySelector('.streak-today-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          toggleStreakTodoToday(item.id);
        });
        r.querySelector('.streak-forever-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          completeStreakForever(item.id);
        });
        r.querySelector('.todo-delete-btn').addEventListener('click', (e) => { e.stopPropagation(); withConfirm(e.currentTarget, () => deleteTodo(item.id)); });
        r.querySelector('.todo-edit-btn').addEventListener('click', () => openTodoEditModal(item.id));
        const tomorrowBtn = r.querySelector('.todo-tomorrow-btn');
        if (tomorrowBtn) { tomorrowBtn.addEventListener('click', (e) => { e.stopPropagation(); moveTodoToTomorrow(item.id); }); }
        attachRowActions(r, () => openTodoEditModal(item.id), () => deleteTodo(item.id), () => moveTodoToTomorrow(item.id), '⏩ Tomorrow');
        attachPointerDrag(r);
        return r;
      }

      // ── STANDARD TODO (unchanged) ────────────
      const t = item;
      const g = getGoal(t.goal_id), isO = !t.completed && t.due_date && t.due_date < todayStr();
      const target = t.target_count || 1, current = t.current_count || 0, isD = current >= target;
      let chk = '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>';
      if (!t.completed && target > 1) chk = `<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor">${current}/${target}</text>`;
      let todoTag = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px;"><circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2"/><path d="M8 5v3l2 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>Eventually';
      chk = isD ? '<path d="M3 8L6.5 11.5L13 4" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' : '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>';
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
      todoTag = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" style="display:inline-block;vertical-align:middle;margin-right:4px;"><rect x="2" y="3" width="12" height="2" rx="1" fill="currentColor"/><rect x="2" y="7.5" width="12" height="2" rx="1" fill="currentColor"/><rect x="2" y="12" width="8" height="2" rx="1" fill="currentColor"/></svg>Task';
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
      const _dueBadge = t.due_date
        ? (isT && isO ? `<span class="todo-due overdue">overdue</span>`
          : !isT ? `<span class="todo-due ${isO ? 'overdue' : ''}">${formatDue(t.due_date)}</span>`
          : '')
        : '';
      const _metaBadges = [g ? `<span class="todo-item-goal">${g.icon} ${escHtml(g.name)}</span>` : '', timeBadge, _dueBadge].filter(Boolean).join('');
      r.innerHTML = `
        <button class="todo-edit-btn" data-editid="${t.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="todo-delete-btn" data-id="${t.id}">✕</button>
        <button class="todo-tomorrow-btn" data-tomorrowid="${t.id}">⏩</button>
        <div class="todo-item-body">
          <span class="todo-item-name">${escHtml(t.name)}</span>
          ${_metaBadges ? `<div class="todo-item-meta">${_metaBadges}</div>` : ''}
        </div>
        <div class="todo-right-group">
          <div class="todo-item-check ${!isD && current > 0 ? 'partial' : ''}" data-id="${t.id}"><svg width="24" height="24" viewBox="0 0 16 16" fill="none">${chk}</svg></div>
        </div>`;
      r.querySelector('.todo-item-check').addEventListener('click', () => toggleTodo(t.id));
      r.querySelector('.todo-delete-btn').addEventListener('click', (e) => { e.stopPropagation(); withConfirm(e.currentTarget, () => deleteTodo(t.id)); });
      r.querySelector('.todo-edit-btn').addEventListener('click', () => openTodoEditModal(t.id));
      const tomorrowBtn = r.querySelector('.todo-tomorrow-btn');
      if (tomorrowBtn) { tomorrowBtn.addEventListener('click', (e) => { e.stopPropagation(); moveTodoToTomorrow(t.id); }); }
      attachRowActions(r, () => openTodoEditModal(t.id), () => deleteTodo(t.id), () => moveTodoToTomorrow(t.id), '⏩ Tomorrow');
      attachPointerDrag(r);
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
    group.dataset.section = 'counters';
    const bracket = document.createElement('div'); bracket.className = 'time-section-bracket';
    bracket.innerHTML = `<span class="time-section-label-text"></span>`;
    group.appendChild(bracket);
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
    bracket.innerHTML = `<span class="time-section-label-text">${label}</span>`;
    group.appendChild(bracket);
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
      <button class="todo-edit-btn" data-editid="${h.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button class="todo-delete-btn" data-id="${h.id}">✕</button>
      <span class="item-icon">${h.icon}</span>
      <div class="todo-item-body">
        <span class="todo-item-name">${escHtml(h.name)}</span>
        ${(urgencyBadge || gB) ? `<div class="todo-item-meta">${urgencyBadge}${gB}</div>` : ''}
      </div>
      <div class="todo-right-group">
        ${lastDoneDate ? `<span class="todo-streak flex-days-since">${daysSince}d ago</span>` : `<span class="todo-streak flex-days-since">new</span>`}
        <div class="todo-item-check eventually-add" data-id="${h.id}" data-date="${vD}" title="Add to Today">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </div>
      </div>
    `;
    r.querySelector('.todo-delete-btn').addEventListener('click', (e) => { e.stopPropagation(); withConfirm(e.currentTarget, () => deleteHabit(h.id)); });
    r.querySelector('.todo-edit-btn').addEventListener('click', () => openHabitEditModal(h.id));
    r.querySelector('.todo-item-check').addEventListener('click', () => setFlexOverride(h.id, vD));
    attachRowActions(r, () => openHabitEditModal(h.id), () => deleteHabit(h.id));
    flexS.appendChild(r);
  });
  document.getElementById('todo-flexible-container').style.display = flexH.length > 0 ? 'block' : 'none';

  // ── This Week section — weekly ONE Things from the cascade ──
  const weekS = document.getElementById('todo-week-list');
  const weekContainer = document.getElementById('todo-week-container');
  if (weekS && typeof LIFE_AREAS !== 'undefined' && typeof getCellGoal === 'function') {
    weekS.innerHTML = '';
    const weeklyCells = [];
    for (const area of LIFE_AREAS) {
      const cell = getCellGoal(area.key, 'weekly');
      if (cell) weeklyCells.push({ area, cell });
    }
    // Surface THE ONE first
    weeklyCells.sort((a, b) => {
      const aIsOne = a.cell.id === _primaryWeeklyGoalId ? -1 : 0;
      const bIsOne = b.cell.id === _primaryWeeklyGoalId ? -1 : 0;
      return aIsOne - bIsOne;
    });
    weeklyCells.forEach(({ area, cell }) => {
      const isPrimary = cell.id === _primaryWeeklyGoalId;
      const done = _isCompletedToday(cell);
      const r = document.createElement('div');
      r.className = `todo-item-row week-one ${done ? 'done' : ''} ${isPrimary ? 'is-primary' : ''}`;
      r.setAttribute('data-week-cell', cell.id);
      r.innerHTML = `
        <div class="todo-item-body">
          <span class="todo-item-name">${isPrimary ? '⭐ ' : ''}${escHtml(cell.name)}</span>
          <div class="todo-item-meta">
            <span class="todo-item-goal">${area.icon} ${escHtml(area.name)}</span>
          </div>
        </div>
        <div class="todo-right-group">
          <div class="todo-item-check ${done ? 'done' : ''}" title="Mark done"><svg width="16" height="16" viewBox="0 0 16 16" fill="none">${done ? '<path d="M3 8l3 3 7-7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' : ''}</svg></div>
        </div>`;
      r.querySelector('.todo-item-check').addEventListener('click', (e) => {
        e.stopPropagation();
        if (typeof toggleCascadeDone === 'function') toggleCascadeDone(area.key, 'weekly');
        // Re-render this section + cascade in sync
        setTimeout(() => { renderTodo(); if (typeof renderCascade === 'function') renderCascade(); }, 60);
      });
      r.addEventListener('click', () => {
        if (typeof openCascadeCell === 'function') openCascadeCell(area.key, 'weekly');
      });
      weekS.appendChild(r);
    });
    if (weekContainer) weekContainer.style.display = weeklyCells.length > 0 ? 'block' : 'none';
  }

  // Eventually section
  const evS = document.getElementById('todo-eventually-list'); evS.innerHTML = '';
  const _evOrder = typeof getEventuallyOrder === 'function' ? getEventuallyOrder() : [];
  uT.sort((a, b) => {
    const ai = _evOrder.indexOf(String(a.id)), bi = _evOrder.indexOf(String(b.id));
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1; if (!b.deadline) return -1;
    return new Date(a.deadline) - new Date(b.deadline);
  });
  uT.forEach(t => {
    const g = getGoal(t.goal_id);
    const r = document.createElement('div'); r.className = `todo-item-row ${t.completed ? 'done' : ''}`;
    r.setAttribute('data-id', t.id);
    r.setAttribute('data-type', 'todo');
    r.setAttribute('draggable', 'true');
    const target = t.target_count || 1, current = t.current_count || 0;
    let chk = '<path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>';
    if (!t.completed && target > 1) chk = `<text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="10" font-weight="800" fill="currentColor">${current}/${target}</text>`;
    const _evMeta = [g ? `<span class="todo-item-goal">${g.icon} ${escHtml(g.name)}</span>` : '', t.deadline ? `<span class="todo-due ${t.deadline < todayStr() ? 'overdue' : ''}">🗓 ${formatDue(t.deadline)}</span>` : ''].filter(Boolean).join('');
    r.innerHTML = `
      <button class="todo-edit-btn" data-editid="${t.id}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      <button class="todo-delete-btn" data-id="${t.id}">✕</button>
      <div class="todo-item-body">
        <span class="todo-item-name">${escHtml(t.name)}</span>
        ${_evMeta ? `<div class="todo-item-meta">${_evMeta}</div>` : ''}
      </div>
      <div class="todo-right-group">
        <div class="todo-item-check eventually-add ${!t.completed && current > 0 ? 'partial' : ''}" data-id="${t.id}" title="Move to Today"><svg width="16" height="16" viewBox="0 0 16 16" fill="none">${chk}</svg></div>
      </div>`;
    r.addEventListener('dragstart', handleDragStart);
    r.addEventListener('dragend', handleDragEnd);
    r.addEventListener('dragenter', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (dragOverRow) dragOverRow.classList.remove('drag-over-row');
      dragOverRow = r; r.classList.add('drag-over-row');
    });
    r.addEventListener('dragleave', (e) => {
      if (e.target === r) { r.classList.remove('drag-over-row'); if (dragOverRow === r) dragOverRow = null; }
    });
    r.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    r.querySelector('.todo-item-check').addEventListener('click', () => moveTodoToToday(t.id));
    r.querySelector('.todo-delete-btn').addEventListener('click', (e) => { e.stopPropagation(); withConfirm(e.currentTarget, () => deleteTodo(t.id)); });
    r.querySelector('.todo-edit-btn').addEventListener('click', () => openTodoEditModal(t.id));
    attachRowActions(r, () => openTodoEditModal(t.id), () => deleteTodo(t.id));
    attachPointerDrag(r);
    evS.appendChild(r);
  });
  // HTML5 drop handler for eventually list
  evS.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  evS.addEventListener('drop', (e) => {
    e.stopPropagation(); e.preventDefault();
    if (!draggedItemId) return;
    const draggedRow = evS.querySelector(`.todo-item-row[data-id="${draggedItemId}"]`);
    if (!draggedRow) return;
    const rows = Array.from(evS.children).filter(el => el.classList.contains('todo-item-row') && !el.classList.contains('dragging'));
    const insertIndex = (dragOverRow && rows.includes(dragOverRow)) ? rows.indexOf(dragOverRow) : getDropInsertionIndex(evS, e.clientY);
    if (dragOverRow) { dragOverRow.classList.remove('drag-over-row'); dragOverRow = null; }
    if (insertIndex < rows.length) evS.insertBefore(draggedRow, rows[insertIndex]);
    else evS.appendChild(draggedRow);
    saveEventuallyOrder();
  });
  // Always show the Eventually section so the user knows it exists and can drag items in
  document.getElementById('todo-eventually-container').style.display = 'block';
  if (uT.length === 0) {
    evS.innerHTML = '<div class="eventually-empty">No eventually todos. Add one with the + button.</div>';
  }

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

  // If the ONE Thing time-block habit exists, decorate its row with the
  // current THE ONE Thing as a subtitle.
  if (typeof decorateTimeBlockRow === 'function') decorateTimeBlockRow();
  // Flag any habits/todos that aren't aligned with a goal
  if (typeof decorateUnlinkedRows === 'function') decorateUnlinkedRows();
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
  if (originalSection && originalSection !== targetSection) sectionsToUpdate.add(originalSection);
  updateSectionOrders(sectionsToUpdate, activeDateStr);
}

// ─────────────────────────────────────────────
//  SHARED ORDER HELPERS
// ─────────────────────────────────────────────
function updateSectionOrders(sectionsToUpdate, activeDateStr) {
  for (const sec of sectionsToUpdate) {
    const secGroup = document.querySelector(`.time-section-group[data-section="${sec}"]`);
    if (!secGroup) continue;
    const wrap = secGroup.querySelector('.time-section-rows');
    if (!wrap) continue;
    Array.from(wrap.children).filter(el => el.classList.contains('todo-item-row')).forEach((row, idx) => {
      if (row.dataset.type === 'habit') setHabitOrder(row.dataset.id, activeDateStr, idx);
      else setTodoOrder(row.dataset.id, activeDateStr, idx);
    });
  }
}

function saveEventuallyOrder() {
  const evList = document.getElementById('todo-eventually-list');
  if (!evList) return;
  const ids = Array.from(evList.querySelectorAll('.todo-item-row')).map(r => r.dataset.id).filter(Boolean);
  if (typeof setEventuallyOrderMemory === 'function') setEventuallyOrderMemory(ids);
  supabase.setPref('eventually_order', JSON.stringify(ids)).catch(e => console.error('[saveEventuallyOrder]', e));
}

// ─────────────────────────────────────────────
//  POINTER DRAG  (touch long-press + mouse fallback)
// ─────────────────────────────────────────────
let ptrDrag = null;

function attachPointerDrag(row) {
  let pressTimer = null;
  let startX = 0, startY = 0, activePointerId = null;

  row.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return; // mouse uses HTML5 DnD
    if (e.target.closest('button, .todo-item-check, .counter-btn, .streak-today-btn, .streak-forever-btn')) return;
    activePointerId = e.pointerId;
    startX = e.clientX; startY = e.clientY;
    pressTimer = setTimeout(() => {
      if (activePointerId === null) return;
      row.setPointerCapture(activePointerId);
      startPtrDrag(row, e.clientX, e.clientY);
    }, 350);
  });

  row.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointerId) return;
    if (ptrDrag) {
      e.preventDefault();
      movePtrDrag(e.clientX, e.clientY);
    } else if (Math.hypot(e.clientX - startX, e.clientY - startY) > 8) {
      clearTimeout(pressTimer); // finger moved before drag — cancel
    }
  });

  row.addEventListener('pointerup', (e) => {
    if (e.pointerId !== activePointerId) return;
    clearTimeout(pressTimer); activePointerId = null;
    if (ptrDrag) endPtrDrag(false);
  });

  row.addEventListener('pointercancel', (e) => {
    clearTimeout(pressTimer); activePointerId = null;
    if (ptrDrag) endPtrDrag(true);
  });
}

function startPtrDrag(row, clientX, clientY) {
  const rect = row.getBoundingClientRect();
  const ghost = row.cloneNode(true);
  ghost.id = 'ptr-drag-ghost';
  ghost.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;` +
    `opacity:0.9;pointer-events:none;z-index:9999;transform:scale(1.03) rotate(0.5deg);` +
    `box-shadow:0 12px 40px rgba(0,0,0,0.6);border-radius:10px;transition:none;`;
  document.body.appendChild(ghost);
  ptrDrag = {
    row, ghost,
    offsetY: clientY - rect.top,
    originalSection: row.closest('.time-section-group')?.dataset.section,
    isEventually: !!row.closest('#todo-eventually-list'),
    dropTarget: null, insertBefore: true,
  };
  row.style.opacity = '0.25';
  if (typeof haptic === 'function') haptic([20, 15]);
}

function movePtrDrag(clientX, clientY) {
  if (!ptrDrag) return;
  ptrDrag.ghost.style.top = (clientY - ptrDrag.offsetY) + 'px';

  const rows = Array.from(document.querySelectorAll(
    ptrDrag.isEventually ? '#todo-eventually-list .todo-item-row' : '.time-section-rows .todo-item-row'
  )).filter(r => r !== ptrDrag.row);
  let nearest = null, nearestDist = Infinity, insertBefore = true;
  rows.forEach(r => {
    const rect = r.getBoundingClientRect();
    const mid = rect.top + rect.height / 2;
    const dist = Math.abs(clientY - mid);
    if (dist < nearestDist) { nearestDist = dist; nearest = r; insertBefore = clientY < mid; }
  });
  ptrDrag.dropTarget = nearest;
  ptrDrag.insertBefore = insertBefore;

  let line = document.getElementById('ptr-drop-line');
  if (!line) {
    line = document.createElement('div');
    line.id = 'ptr-drop-line';
    line.style.cssText = 'position:fixed;height:2px;background:var(--mint);box-shadow:0 0 8px var(--mint);' +
      'z-index:9998;pointer-events:none;border-radius:2px;';
    document.body.appendChild(line);
  }
  if (nearest) {
    const rect = nearest.getBoundingClientRect();
    line.style.left = rect.left + 4 + 'px';
    line.style.width = rect.width - 8 + 'px';
    line.style.top = (insertBefore ? rect.top : rect.bottom) - 1 + 'px';
    line.style.display = 'block';
  } else {
    line.style.display = 'none';
  }
}

function endPtrDrag(cancel) {
  if (!ptrDrag) return;
  const { row, ghost, dropTarget, insertBefore, originalSection, isEventually } = ptrDrag;
  ghost.remove();
  document.getElementById('ptr-drop-line')?.remove();
  row.style.opacity = '';
  ptrDrag = null;

  if (cancel || !dropTarget || dropTarget === row) return;

  const next = insertBefore ? dropTarget : dropTarget.nextSibling;

  if (isEventually) {
    const evList = document.getElementById('todo-eventually-list');
    if (!evList) return;
    next ? evList.insertBefore(row, next) : evList.appendChild(row);
    saveEventuallyOrder();
  } else {
    const targetWrap = dropTarget.closest('.time-section-rows');
    if (!targetWrap) return;
    next ? targetWrap.insertBefore(row, next) : targetWrap.appendChild(row);
    const targetSection = dropTarget.closest('.time-section-group')?.dataset.section;
    const toUpdate = new Set([targetSection]);
    if (originalSection && originalSection !== targetSection) toUpdate.add(originalSection);
    updateSectionOrders(toUpdate, getActiveDateStr());
  }
  if (typeof haptic === 'function') haptic([15, 20]);
}

async function saveTodoTime(todo) {
  const { error } = await supabase.from('todos').eq('id', todo.id).update({ scheduled_time: todo.scheduled_time });
  if (error) throw error;
}

// ─────────────────────────────────────────────
//  DEFERRED RENDER SCHEDULER
// ─────────────────────────────────────────────
let _renderPending = false;
function scheduleRender() {
  if (_renderPending) return;
  _renderPending = true;
  requestAnimationFrame(() => {
    _renderPending = false;
    renderTodo();
    if (currentTab === 'goals') renderGoals();
  });
}

// ─────────────────────────────────────────────
//  HABIT TOGGLE & DELETE
// ─────────────────────────────────────────────
function toggleHabit(id) {
  const h = habits.find(h => h.id === id);
  if (!h) return;
  const vD = getActiveDateStr();
  const isCounter = h.habit_type === 'counter';
  const target = h.target_count || 1;
  const current = h.doneCounts[vD] || 0;
  if (!h.completionIds) h.completionIds = {};

  if (!isCounter && current >= target) {
    // UNDO — optimistic
    h.doneCounts[vD] = Math.max(0, current - 1);
    const ids = h.completionIds[vD] || [];
    const deletedId = ids.length ? ids.splice(ids.length - 1, 1)[0] : null;
    haptic([15]);
    scheduleRender();

    // DB in background
    if (deletedId) {
      supabase.from('completions').eq('id', deletedId).delete().then(({ error }) => {
        if (error) {
          console.error('[toggleHabit] undo failed:', error);
          h.doneCounts[vD] = (h.doneCounts[vD] || 0) + 1;
          (h.completionIds[vD] = h.completionIds[vD] || []).push(deletedId);
          scheduleRender();
          showToast('Save failed — check connection');
        }
      });
    } else {
      supabase.from('completions').select('id').eq('habit_id', id).eq('date', vD)
        .order('created_at', { ascending: false }).limit(1).then(({ data }) => {
          if (data?.[0]) supabase.from('completions').eq('id', data[0].id).delete();
        });
    }

  } else {
    // ADD — optimistic
    const newId = crypto.randomUUID();
    h.doneCounts[vD] = current + 1;
    (h.completionIds[vD] = h.completionIds[vD] || []).push(newId);

    const isNowDone = !isCounter && h.doneCounts[vD] >= target;
    const row = document.querySelector(`.todo-item-row[data-id="${id}"]`);

    if (isNowDone) {
      haptic([25, 40]);
      if (row) {
        burstFromEl(row.querySelector('.todo-item-check'), 50);
        row.classList.add('just-done');
        setTimeout(() => row.classList.remove('just-done'), 500);
      }
      const ap = habits.filter(hb => isHabitActiveOnDate(hb, vD) || (hb.doneCounts[vD] > 0));
      if (ap.length && ap.every(hb => hb.habit_type === 'counter' || (hb.doneCounts[vD]||0) >= (hb.target_count||1))) {
        celebrate(); showToast('All routines complete! 🎉');
      } else { showToast('Momentum building! 🔥'); }
    } else if (isCounter) {
      haptic([12]);
      if (row) burstFromEl(row.querySelector('.counter-btn'), 12);
      showToast(`${h.name}: ${h.doneCounts[vD]}`);
    } else {
      haptic([20]);
      if (row) burstFromEl(row.querySelector('.todo-item-check'), 20);
    }

    scheduleRender();

    // DB in background
    supabase.from('completions').insert({ id: newId, habit_id: id, date: vD }).then(({ error }) => {
      if (error) {
        console.error('[toggleHabit] insert failed:', error);
        h.doneCounts[vD] = Math.max(0, (h.doneCounts[vD] || 0) - 1);
        h.completionIds[vD] = (h.completionIds[vD] || []).filter(cid => cid !== newId);
        scheduleRender();
        showToast('Save failed — check connection');
      }
    });
  }
}

async function skipHabitToday(id) {
  const habit = habits.find(h => h.id === id);
  if (!habit) return;
  const dateStr = getActiveDateStr();
  await setHabitSkipped(id, dateStr, true);
  haptic([20]);
  renderTodo();
  renderGoals();
  showToast(`${habit.name} hidden for today`);
}
window.skipHabitToday = skipHabitToday;

async function decrementCounter(id) {
  const h = habits.find(h => h.id === id), vD = getActiveDateStr();
  if (!h || h.habit_type !== 'counter') return;
  const current = h.doneCounts[vD] || 0;
  if (current <= 0) return;
  
  const { data, error } = await supabase.from('completions').select('id').eq('habit_id', id).eq('date', vD).order('created_at', { ascending: false });
  if (error) throw error;
  if (data && data.length > 0) {
    await supabase.from('completions').eq('id', data[0].id).delete();
  }
  
  h.doneCounts[vD] = current - 1; 
  haptic([15]); 
  renderTodo(); renderGoals();
  showToast(`${h.name}: ${h.doneCounts[vD]}`);
}
window.decrementCounter = decrementCounter;

async function deleteHabit(id) {
  haptic([30]);

  await supabase.from('completions').eq('habit_id', id).delete();
  await supabase.from('habits').eq('id', id).delete();

  // Re-fetch to guarantee fresh UI (manual filtering didn't reliably re-render)
  if (typeof fetchHabits === 'function') {
    await fetchHabits();
  } else {
    habits = habits.filter(h => String(h.id) !== String(id));
  }
  renderTodo(); renderGoals();
  showToast('Habit removed');
}
window.deleteHabit = deleteHabit;

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
    const { data, error } = await supabase.from('habits').eq('id', editingHabitId).update(patch).select();
    if (error) throw error;
    const i = habits.findIndex(h => h.id === editingHabitId);
    if (i > -1) habits[i] = data[0];
    renderTodo(); renderGoals();
    showToast('Habit updated ✨');
  } else {
    const { data, error } = await supabase.from('habits').insert({ name:n, icon:iconChar, scheduled_time:t, duration_minutes:dur?parseInt(dur):null, frequency:frequencyStr, goal_id:gId, target_count:tc, habit_type:habitType }).select();
    if (error) throw error;
    habits.push({ ...data[0], doneCounts:{} });
    renderTodo(); renderGoals();
    haptic([20,35]); showToast('Habit planted! 🌱');
  }
}