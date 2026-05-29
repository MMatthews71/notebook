// ─────────────────────────────────────────────
//  GOALS — Cascade view based on "The One Thing" (Gary Keller)
//  Each goal cell = (life_area, time_horizon, text). The cell's
//  parent is the cell ONE horizon larger in the same area.
//  Editing a cell prompts the Focusing Question.
// ─────────────────────────────────────────────
let goalsResizeObserver = null;
let goalParents = []; // legacy: [{ goal_id, parent_id }] — kept for back-compat with old graph code

// ── Life areas (Keller's 7 + Learning for skills & education) ────
const LIFE_AREAS = [
  { key: 'spiritual',     name: 'Spiritual',     icon: '🔭' },
  { key: 'physical',      name: 'Physical',      icon: '💪' },
  { key: 'personal',      name: 'Personal',      icon: '🧠' },
  { key: 'learning',      name: 'Learning',      icon: '📚' },
  { key: 'relationships', name: 'Relationships', icon: '🫂' },
  { key: 'job',           name: 'Job',           icon: '💼' },
  { key: 'business',      name: 'Business',      icon: '📈' },
  { key: 'financial',     name: 'Financial',     icon: '💰' },
];

// ── Five horizons: Someday → 5y → 1y → Month → Week (full Keller cascade) ──
const TIME_HORIZONS = [
  { key: 'someday',  label: 'Someday',   short: 'Someday',
    prompt: 'What\'s the ONE thing I want in <strong>{area}</strong> someday?',
    maintenancePrompt: 'What practice do I want to keep alive in <strong>{area}</strong> throughout my life?' },
  { key: 'year_5',   label: '5 years',   short: '5 years',
    prompt: 'What\'s the ONE thing I can do by <strong>{year_5}</strong> for <strong>{area}</strong> such that by doing it my Someday goal becomes easier or unnecessary?',
    maintenancePrompt: 'What identity am I building through this practice in <strong>{area}</strong> by <strong>{year_5}</strong>?' },
  { key: 'year_1',   label: 'This year', short: '1 year',
    prompt: 'What\'s the ONE thing I can do in <strong>{year}</strong> for <strong>{area}</strong> such that by doing it my 5-year goal becomes easier or unnecessary?',
    maintenancePrompt: 'What\'s the test that this practice was alive in <strong>{area}</strong> by end of <strong>{year}</strong>?' },
  { key: 'monthly',  label: 'This month',short: 'Month',
    prompt: 'What\'s the ONE thing I can do in <strong>{month}</strong> for <strong>{area}</strong> such that by doing it my {year} goal becomes easier or unnecessary?',
    maintenancePrompt: 'What would keep this practice strong in <strong>{month}</strong> for <strong>{area}</strong>?' },
  { key: 'weekly',   label: 'This week', short: 'Week',
    prompt: 'What\'s the ONE thing I can do this week for <strong>{area}</strong> such that by doing it my monthly goal becomes easier or unnecessary?',
    maintenancePrompt: 'What would keep this practice alive this week for <strong>{area}</strong>?' },
];

// User-defined ordering of area columns (saved to user_preferences).
let _areaOrder = null;

// Primary weekly goal ID (across all areas)
let _primaryWeeklyGoalId = null;

function getOrderedAreas() {
  if (!_areaOrder || !Array.isArray(_areaOrder) || _areaOrder.length === 0) return LIFE_AREAS;
  const ordered = [];
  const seen = new Set();
  _areaOrder.forEach(key => {
    const area = LIFE_AREAS.find(a => a.key === key);
    if (area && !seen.has(key)) {
      ordered.push(area);
      seen.add(key);
    }
  });
  LIFE_AREAS.forEach(area => {
    if (!seen.has(area.key)) ordered.push(area);
  });
  return ordered;
}

async function saveAreaOrder() {
  try {
    await supabase.setPref('cascade_area_order', JSON.stringify(_areaOrder));
  } catch (e) { console.warn('saveAreaOrder failed', e); }
}

function loadAreaOrderFromPref(raw) {
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) _areaOrder = parsed;
  } catch (e) {}
}
window.loadAreaOrderFromPref = loadAreaOrderFromPref;

// Returns true if the habit/todo's goal_id is missing or points to a goal
// that no longer exists (so the user can fix it).
function isItemUnlinked(item) {
  if (!item || !item.goal_id) return true;
  return !goals.some(g => g.id === item.goal_id);
}
window.isItemUnlinked = isItemUnlinked;

function _areaMeta(key)    { return LIFE_AREAS.find(a => a.key === key); }
function _horizonMeta(key) { return TIME_HORIZONS.find(h => h.key === key); }
function _horizonIndex(key){ return TIME_HORIZONS.findIndex(h => h.key === key); }

function getHorizonShort(key) {
  const now = new Date();
  switch (key) {
    case 'someday': return 'Someday';
    case 'year_5':  return String(now.getFullYear() + 5);
    case 'year_1':  return String(now.getFullYear());
    case 'monthly': return now.toLocaleString('default', { month: 'short' });
    case 'weekly':  return 'Week';
    default: return key;
  }
}
function getHorizonLabel(key) {
  const now = new Date();
  switch (key) {
    case 'someday': return 'Someday';
    case 'year_5':  return `By ${now.getFullYear() + 5}`;
    case 'year_1':  return `This year (${now.getFullYear()})`;
    case 'monthly': return `${now.toLocaleString('default', { month: 'long' })} ${now.getFullYear()}`;
    case 'weekly':  return 'This week';
    default: return key;
  }
}

function getCellGoal(areaKey, horizonKey) {
  return goals.find(g => g.life_area === areaKey && g.time_horizon === horizonKey) || null;
}

function getParentCellGoal(areaKey, horizonKey) {
  const idx = _horizonIndex(horizonKey);
  for (let i = idx - 1; i >= 0; i--) {
    const g = getCellGoal(areaKey, TIME_HORIZONS[i].key);
    if (g) return g;
  }
  return null;
}

function focusingQuestion(areaKey, horizonKey, isMaintenance) {
  const area = _areaMeta(areaKey);
  const hzn = _horizonMeta(horizonKey);
  if (!hzn) return '';
  const template = isMaintenance && hzn.maintenancePrompt ? hzn.maintenancePrompt : hzn.prompt;
  const now = new Date();
  const year = now.getFullYear();
  const monthName = now.toLocaleString('default', { month: 'long' });
  return template
    .replace('{area}', area.name)
    .replace('{year}', year)
    .replace('{year_5}', year + 5)
    .replace('{month}', monthName);
}

function _isCompletedToday(goal) {
  if (!goal || !goal.completed_at) return false;
  const d = new Date(goal.completed_at);
  return d.toISOString().slice(0, 10) === (typeof todayStr === 'function' ? todayStr() : new Date().toISOString().slice(0, 10));
}

function getParentIdsOf(goalId) {
  const sid = String(goalId);
  return goalParents
    .filter(gp => String(gp.goal_id) === sid)
    .map(gp => String(gp.parent_id));
}
function getChildIdsOf(goalId) {
  const sid = String(goalId);
  return goalParents
    .filter(gp => String(gp.parent_id) === sid)
    .map(gp => String(gp.goal_id));
}
function isRootGoal(goalId) {
  return getParentIdsOf(goalId).length === 0;
}

async function fetchGoals(skipRender = false) {
  const [goalsRes, parentsArr] = await Promise.all([
    supabase.from('goals').select('*').order('created_at', { ascending: true }),
    supabase.getGoalParents().catch(() => []),
  ]);
  if (goalsRes.error) throw goalsRes.error;
  goals = goalsRes.data || [];
  goalParents = (parentsArr || []).map(gp => ({
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
  if (!skipRender) { renderGoals(); if (currentTab === 'todo') renderTodo(); }
}

function renderGoals() {
  const loadingEl = document.getElementById('goals-loading');
  const emptyEl   = document.getElementById('goals-empty');
  const listEl    = document.getElementById('goals-list');

  if (loadingEl) loadingEl.style.display = 'none';
  if (emptyEl)   emptyEl.style.display   = 'none';
  if (listEl)    listEl.style.display    = 'block';

  renderCascade();
}

// ── CASCADE RENDERING (transposed: horizons = rows, areas = columns) ──
let _editingCell = null;

function renderCascade() {
  const container = document.getElementById('goals-container');
  if (!container) {
    console.warn('[cascade] #goals-container not in DOM, skipping render');
    return;
  }
  container.innerHTML = _focusedArea ? renderAreaView(_focusedArea) : renderMainView();
}

function renderMainView() {
  const primary = _primaryWeeklyGoalId
    ? goals.find(g => g.id === _primaryWeeklyGoalId)
    : null;

  let html = '<div class="cascade-wrap">';

  // ── THE ONE THING hero ────────────────────
  html += '<div class="cascade-the-one">';
  if (primary) {
    const area = _areaMeta(primary.life_area);
    const done = _isCompletedToday(primary);
    html += `<div class="the-one-label">This week's ONE Thing</div>
      <div class="the-one-card ${done ? 'done' : ''}">
        <button class="the-one-check" onclick="toggleCascadeDone('${primary.life_area}','weekly')" aria-label="Toggle done">${done ? '✓' : ''}</button>
        <div class="the-one-body" onclick="openCascadeCell('${primary.life_area}','weekly')">
          <div class="the-one-area">${area ? area.icon + ' ' + area.name : ''}</div>
          <div class="the-one-text">${escHtml(primary.name)}</div>
        </div>
      </div>`;
  } else {
    html += `<div class="the-one-label">This week's ONE Thing</div>
      <div class="the-one-card empty">
        <div class="the-one-text muted">Tap a weekly goal's ⭐ to make it THE ONE.</div>
      </div>`;
  }
  html += '</div>';

  // ── Transposed grid: horizons as rows, areas as columns ──
  html += renderCascadeGrid();

  html += '</div>';
  return html;
}

function renderCascadeGrid() {
  const orderedAreas = getOrderedAreas();
  let html = '<div class="cascade-grid-scroll"><div class="cascade-grid">';

  // Header row: empty corner + area names
  html += '<div class="cascade-grid-row cascade-grid-header">';
  html += '<div class="cg-cell-header cg-corner-header"></div>';
  orderedAreas.forEach(area => {
    html += `<div class="cg-cell-header cg-area-header" data-area-key="${area.key}">${area.icon} ${area.name}</div>`;
  });
  html += '</div>';

  // Data rows: one per horizon
  TIME_HORIZONS.forEach(hzn => {
    const isWeekly = hzn.key === 'weekly';
    html += `<div class="cascade-grid-row" data-horizon-key="${hzn.key}">`;
    // Horizon label cell
    html += `<div class="cg-cell-header cg-horizon-label">${getHorizonShort(hzn.key)}</div>`;

    orderedAreas.forEach(area => {
      const cell = getCellGoal(area.key, hzn.key);
      const isWeeklyCell = isWeekly;
      const cellDone = isWeeklyCell && _isCompletedToday(cell);
      const isPrimary = isWeeklyCell && cell && cell.id === _primaryWeeklyGoalId;
      const maintBadge = cell && cell.is_maintenance ? '<span class="cg-maint-badge" title="Maintenance — keep this practice alive">∞</span>' : '';
      const CELL_LIMIT = 120;
      const displayName = cell ? (cell.name.length > CELL_LIMIT ? cell.name.slice(0, CELL_LIMIT).trimEnd() + '…' : cell.name) : null;
      const text = displayName ? `<span class="cg-cell-text" title="${escHtml(cell.name)}">${escHtml(displayName)}</span>` : '<span class="cg-cell-empty">—</span>';

      html += `<div class="cg-cell ${isWeeklyCell ? 'is-weekly' : ''} ${cellDone ? 'done' : ''} ${isPrimary ? 'is-primary' : ''} ${cell ? '' : 'empty'} ${cell && cell.is_maintenance ? 'is-maintenance' : ''}" onclick="openCascadeCell('${area.key}','${hzn.key}')">`;
      html += `${maintBadge}${text}`;
      // For weekly cells, add action buttons inline
      if (isWeeklyCell && cell) {
        html += `<div class="cg-cell-actions" onclick="event.stopPropagation()">`;
        html += `<button class="cg-btn-promote ${isPrimary ? 'is-on' : ''}" onclick="togglePrimaryWeekly('${cell.id}')" title="${isPrimary ? 'THE ONE' : 'Make THE ONE'}">${isPrimary ? '⭐' : '☆'}</button>`;
        html += `<button class="cg-btn-check ${cellDone ? 'on' : ''}" onclick="toggleCascadeDone('${area.key}','weekly')" aria-label="Done">${cellDone ? '✓' : ''}</button>`;
        html += `</div>`;
      }
      html += `</div>`;
    });
    html += '</div>';
  });

  html += '</div></div>';
  return html;
}

// ── AREA VIEW (drill-in) – unchanged from original ──
let _focusedArea = null;
function focusArea(key) {
  _focusedArea = key;
  haptic && haptic([15, 10]);
  renderCascade();
  const c = document.getElementById('goals-container');
  if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function clearFocusedArea() {
  _focusedArea = null;
  haptic && haptic([10]);
  renderCascade();
}
window.focusArea = focusArea;
window.clearFocusedArea = clearFocusedArea;

function renderAreaView(areaKey) {
  const area = _areaMeta(areaKey);
  if (!area) return renderMainView();

  let html = '<div class="cascade-wrap area-view">';
  html += `<div class="area-view-header">
    <button class="area-view-back" onclick="clearFocusedArea()">← Back</button>
    <div class="area-view-title">
      <span class="area-view-icon">${area.icon}</span>
      <span class="area-view-name">${area.name}</span>
    </div>
  </div>`;
  html += '<div class="area-view-cells">';
  TIME_HORIZONS.forEach(hzn => {
    const cell = getCellGoal(areaKey, hzn.key);
    const isWeekly = hzn.key === 'weekly';
    const isPrimary = isWeekly && cell && cell.id === _primaryWeeklyGoalId;
    const done = isWeekly && _isCompletedToday(cell);
    const text = cell ? escHtml(cell.name) : '<em>tap to set</em>';
    const maintBadge = cell && cell.is_maintenance ? '<span class="av-maint-badge" title="Maintenance">∞</span>' : '';
    html += `<div class="av-cell ${hzn.key} ${cell ? '' : 'empty'} ${isPrimary ? 'is-primary' : ''} ${done ? 'done' : ''} ${cell && cell.is_maintenance ? 'is-maintenance' : ''}" onclick="openCascadeCell('${areaKey}','${hzn.key}')">
      <div class="av-cell-label">${getHorizonLabel(hzn.key)}${maintBadge}</div>
      <div class="av-cell-text">${text}</div>
      ${isWeekly && cell ? `
        <div class="av-cell-actions" onclick="event.stopPropagation()">
          <button class="area-promote ${isPrimary ? 'is-on' : ''}" onclick="togglePrimaryWeekly('${cell.id}')" title="${isPrimary ? 'THE ONE' : 'Make THE ONE'}">${isPrimary ? '⭐' : '☆'}</button>
          <button class="area-check ${done ? 'on' : ''}" onclick="toggleCascadeDone('${areaKey}','weekly')" aria-label="Done">${done ? '✓' : ''}</button>
        </div>
      ` : ''}
    </div>`;
  });
  html += '</div>';
  html += `<div class="area-view-hint">Each cell answers the Focusing Question — what's the ONE thing that, if done, makes the next-bigger goal easier or unnecessary?</div>`;
  html += '</div>';
  return html;
}

async function togglePrimaryWeekly(goalId) {
  haptic && haptic([15, 10]);
  if (_primaryWeeklyGoalId === goalId) {
    _primaryWeeklyGoalId = null;
  } else {
    _primaryWeeklyGoalId = goalId;
  }
  try {
    await supabase.setPref('primary_weekly_goal_id', _primaryWeeklyGoalId);
  } catch (e) { console.warn('save primary failed', e); }
  renderCascade();
}
window.togglePrimaryWeekly = togglePrimaryWeekly;

async function loadPrimaryWeekly() {
  try {
    _primaryWeeklyGoalId = (await supabase.getPref('primary_weekly_goal_id')) || null;
  } catch (e) {
    _primaryWeeklyGoalId = null;
  }
}
window.loadPrimaryWeekly = loadPrimaryWeekly;

function decorateUnlinkedRows() {
  document.querySelectorAll('.todo-item-row[data-id]').forEach(row => {
    const id = row.dataset.id;
    if (!id) return;
    const item = habits.find(h => String(h.id) === String(id)) || todos.find(t => String(t.id) === String(id));
    if (!item) return;
    const existing = row.querySelector('.unlinked-badge');
    if (isItemUnlinked(item)) {
      if (!existing) {
        const body = row.querySelector('.todo-item-body, .todo-item-name')?.closest('.todo-item-body');
        const target = body || row;
        const badge = document.createElement('button');
        badge.className = 'unlinked-badge';
        badge.title = 'Link this to a goal';
        badge.textContent = '⚠ link';
        badge.onclick = (e) => {
          e.stopPropagation();
          if (habits.some(h => String(h.id) === String(id))) {
            if (typeof openHabitEditModal === 'function') openHabitEditModal(id);
          } else if (typeof openTodoEditModal === 'function') {
            openTodoEditModal(id);
          }
        };
        target.appendChild(badge);
      }
    } else if (existing) {
      existing.remove();
    }
  });
}
window.decorateUnlinkedRows = decorateUnlinkedRows;

function openCascadeCell(areaKey, horizonKey) {
  _editingCell = { area: areaKey, horizon: horizonKey };
  haptic && haptic([15]);
  const modal = document.getElementById('cascade-cell-modal');
  if (!modal) return;
  const area = _areaMeta(areaKey);
  const hzn = _horizonMeta(horizonKey);
  const cell = getCellGoal(areaKey, horizonKey);
  const parent = getParentCellGoal(areaKey, horizonKey);

  document.getElementById('cascade-cell-title').textContent = `${area.icon} ${area.name} — ${getHorizonLabel(horizonKey)}`;
  const isMaint = !!(cell && cell.is_maintenance);
  document.getElementById('cascade-focus-q').innerHTML = focusingQuestion(areaKey, horizonKey, isMaint);
  const maintBox = document.getElementById('cascade-cell-maintenance');
  if (maintBox) maintBox.checked = isMaint;
  const ctxEl = document.getElementById('cascade-parent-context');
  if (parent) {
    const parentLabel = getHorizonLabel(parent.time_horizon);
    ctxEl.innerHTML = `<span class="cascade-ctx-label">${parentLabel}:</span>
      <span class="cascade-ctx-text" onclick="openCascadeCell('${areaKey}','${parent.time_horizon}')" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;">${escHtml(parent.name)}</span>`;
    ctxEl.style.display = 'block';
  } else if (horizonKey !== 'someday') {
    const parentIdx = _horizonIndex(horizonKey) - 1;
    if (parentIdx >= 0) {
      const parentHzn = TIME_HORIZONS[parentIdx];
      ctxEl.innerHTML = `<span class="cascade-ctx-label">${getHorizonLabel(parentHzn.key)}:</span>
        <span class="cascade-ctx-text" onclick="openCascadeCell('${areaKey}','${parentHzn.key}')" style="cursor:pointer;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;"><em>tap to set the bigger picture first</em></span>`;
      ctxEl.style.display = 'block';
    } else {
      ctxEl.style.display = 'none';
    }
  } else {
    ctxEl.style.display = 'none';
  }
  const inp = document.getElementById('cascade-cell-input');
  inp.value = cell?.name || '';
  const delBtn = document.getElementById('cascade-cell-delete');
  if (delBtn) delBtn.style.display = cell ? 'inline-block' : 'none';
  modal.classList.add('open');
  setTimeout(() => inp.focus(), 300);
}
window.openCascadeCell = openCascadeCell;

function closeCascadeCellModal() {
  const m = document.getElementById('cascade-cell-modal');
  if (m) m.classList.remove('open');
  _editingCell = null;
}
window.closeCascadeCellModal = closeCascadeCellModal;

function closeCascadeCellOnBackdrop(e) {
  if (e.target === document.getElementById('cascade-cell-modal')) closeCascadeCellModal();
}
window.closeCascadeCellOnBackdrop = closeCascadeCellOnBackdrop;

function onMaintenanceToggle() {
  if (!_editingCell) return;
  const { area, horizon } = _editingCell;
  const isMaint = !!document.getElementById('cascade-cell-maintenance').checked;
  document.getElementById('cascade-focus-q').innerHTML = focusingQuestion(area, horizon, isMaint);
}
window.onMaintenanceToggle = onMaintenanceToggle;

async function saveCascadeCell() {
  if (!_editingCell) return;
  const { area, horizon } = _editingCell;
  const text = (document.getElementById('cascade-cell-input').value || '').trim();
  if (!text) {
    return deleteCascadeCell();
  }
  const existing = getCellGoal(area, horizon);
  const parent = getParentCellGoal(area, horizon);
  const areaMeta = _areaMeta(area);
  const isMaintenance = !!document.getElementById('cascade-cell-maintenance').checked;

  closeCascadeCellModal();

  if (existing) {
    const { error } = await supabase.from('goals').eq('id', existing.id).update({
      name: text,
      parent_id: parent ? parent.id : null,
      is_maintenance: isMaintenance,
    });
    if (error) { showToast('Save failed'); console.error(error); return; }
  } else {
    const row = {
      name: text,
      icon: areaMeta.icon,
      life_area: area,
      time_horizon: horizon,
      parent_id: parent ? parent.id : null,
      is_maintenance: isMaintenance,
    };
    const { data, error } = await supabase.from('goals').insert(row).select();
    if (error) { showToast('Save failed'); console.error(error); return; }
  }
  showToast('Saved ✨');
  await fetchGoals();
}
window.saveCascadeCell = saveCascadeCell;

async function deleteCascadeCell() {
  if (!_editingCell) return;
  const { area, horizon } = _editingCell;
  const existing = getCellGoal(area, horizon);
  closeCascadeCellModal();
  if (!existing) return;
  await supabase.from('goals').eq('id', existing.id).delete();
  showToast('Cleared');
  await fetchGoals();
}
window.deleteCascadeCell = deleteCascadeCell;

async function toggleCascadeDone(areaKey, horizonKey) {
  const cell = getCellGoal(areaKey, horizonKey);
  if (!cell) return;
  const isDone = _isCompletedToday(cell);
  const newVal = isDone ? null : new Date().toISOString();
  const { error } = await supabase.from('goals').eq('id', cell.id).update({ completed_at: newVal });
  if (error) { showToast('Save failed'); console.error(error); return; }
  haptic && haptic(isDone ? [10] : [20, 30]);
  cell.completed_at = newVal;
  renderCascade();
}
window.toggleCascadeDone = toggleCascadeDone;

// ── GOAL GRAPH (unchanged from original) ─────────────────────
let graphNodes = {}, graphPan = { x: 0, y: 0 }, graphPanning = false, graphPanStart = {};
let graphZoom = 1, graphUserInteracted = false, graphAutoFitPending = true;
const NODE_W = 210, NODE_H_BASE = 80;

function markGraphUserInteracted() { graphUserInteracted = true; graphAutoFitPending = false; }

function autoFitAndCenterGraph(wrapper) {
  if (!wrapper) return;
  const nDiv = document.getElementById('goal-graph-nodes');
  if (!nDiv || nDiv.children.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nDiv.children) {
    const p = graphNodes[n.dataset.id]; if (!p) continue;
    const w = n.offsetWidth || NODE_W, h = n.offsetHeight || NODE_H_BASE;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x+w); maxY = Math.max(maxY, p.y+h);
  }
  if (!isFinite(minX)) return;
  const vW = wrapper.clientWidth, vH = wrapper.clientHeight;
  graphZoom = Math.max(0.2, Math.min(2.0, Math.min(vW/(maxX-minX+100), vH/(maxY-minY+100)))) * 0.85;
  graphPan.x = vW/2 - (minX + (maxX-minX)/2)*graphZoom;
  graphPan.y = vH/2 - (minY + (maxY-minY)/2)*graphZoom;
  applyGraphTransform(true);
}

function renderGoalGraph() {
  const c = document.getElementById('goals-container'); if (!c) return;
  goals.forEach(g => {
    if (g.parent_id) {
      const sid = String(g.id), spid = String(g.parent_id);
      const exists = goalParents.some(gp => gp.goal_id === sid && gp.parent_id === spid);
      if (!exists) goalParents.push({ goal_id: sid, parent_id: spid });
    }
  });
  let w = document.getElementById('goal-graph-wrap');
  if (w) w.remove();
  c.innerHTML = `<div id="goal-graph-wrap"><svg id="goal-graph-edges"></svg><div id="goal-graph-nodes"></div></div>`;
  w = document.getElementById('goal-graph-wrap');
  w.offsetHeight;
  setupGraphPan(w);
  layoutGoals(); renderGraphEdges();
  const nDiv = document.getElementById('goal-graph-nodes'); nDiv.innerHTML = '';
  const vDStr = getActiveDateStr(), isT = vDStr === todayStr();

  goals.forEach(g => {
    const pos = graphNodes[g.id] || { x: 20, y: 20 }, gid = String(g.id);
    const lH = habits.filter(h => String(h.goal_id) === gid);
    const appT = lH.filter(h => isHabitActiveOnDate(h, vDStr) || (h.doneCounts[vDStr]||0) > 0);
    const dTod = appT.filter(h => (h.doneCounts[vDStr]||0) >= (h.target_count||1)).length;
    let gTod = todos.filter(t => String(t.goal_id) === gid && t.due_date === vDStr);
    if (isT) gTod = [...todos.filter(t => String(t.goal_id) === gid && t.due_date && t.due_date < vDStr && !t.completed), ...gTod];
    gTod = [...gTod, ...todos.filter(t => String(t.goal_id) === gid && !t.due_date)];

    let leavesHtml = '';
    const h4d = lH.filter(h => isHabitActiveOnDate(h, vDStr) || (h.doneCounts[vDStr]||0) > 0);
    h4d.forEach(h => {
      leavesHtml += `<div class="gnode-leaf ${(h.doneCounts[vDStr]||0)>=(h.target_count||1) ? 'done' : ''}" data-habitid="${h.id}"><div class="gnode-leaf-check"></div><span class="gnode-leaf-name">${h.icon ? h.icon + ' ' : ''}${escHtml(h.name)}</span></div>`;
    });
    gTod.forEach(t => {
      leavesHtml += `<div class="gnode-leaf ${t.completed ? 'done' : ''}" data-todoid="${t.id}"><div class="gnode-leaf-check"></div><span class="gnode-leaf-name">${!t.due_date ? '⏳ ' : ''}${escHtml(t.name)}</span></div>`;
    });

    const totalLeaves = h4d.length + gTod.length;
    const leavesSection = leavesHtml
      ? `<div class="gnode-leaves"${totalLeaves > 4 ? ' style="max-height:120px;overflow-y:auto;"' : ''}>${leavesHtml}</div>`
      : '';

    const progressPct = appT.length > 0 ? Math.round(dTod / appT.length * 100) : -1;
    const isRoot = isRootGoal(g.id);

    const n = document.createElement('div');
    n.className = `gnode${isRoot ? ' gnode-root' : ''}`;
    n.dataset.id = g.id;
    n.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    n.innerHTML = `
      <div class="gnode-card${isRoot ? ' gnode-root-card' : ''}">
        <div class="gnode-icon">${g.icon || '🎯'}</div>
        <div class="gnode-body">
          <div class="gnode-name">${escHtml(g.name)}</div>
          ${g.why ? `<div class="gnode-why">${escHtml(g.why)}</div>` : ''}
          ${appT.length > 0 ? `<div class="gnode-habit-count">${dTod}/${appT.length} done</div>` : ''}
          ${progressPct >= 0 ? `<div class="gnode-progress"><div class="gnode-progress-fill" style="width:${progressPct}%"></div></div>` : ''}
        </div>
        <div class="gnode-actions">
          <button onclick="openModalForGoal('${g.id}')">🌿</button>
          <button onclick="openGoalModal(null,'${g.id}')">＋</button>
          <button onclick="openGoalModal('${g.id}')"><svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
          <button class="del" onclick="confirmDeleteGoal(this,'${g.id}')">✕</button>
        </div>
      </div>
      ${leavesSection}`;

    n.querySelectorAll('.gnode-leaf').forEach(l => l.addEventListener('click', e => {
      e.stopPropagation();
      if (l.dataset.todoid) toggleTodo(l.dataset.todoid);
      if (l.dataset.habitid) toggleHabit(l.dataset.habitid);
    }));
    setupNodeDrag(n, g.id);
    nDiv.appendChild(n);
  });

  applyGraphTransform();
  if (!graphUserInteracted && graphAutoFitPending) {
    graphAutoFitPending = false;
    requestAnimationFrame(() => autoFitAndCenterGraph(w));
  }
}

function layoutGoals() {
  const pos = new Set(Object.keys(graphNodes));
  if (!goals.filter(g => !pos.has(g.id)).length) return;
  const childrenOf = {};
  const ownerOf = {};
  goals.forEach(g => {
    const sid = String(g.id);
    const parents = getParentIdsOf(sid);
    if (parents.length === 0) return;
    const owner = String(parents[0]);
    ownerOf[sid] = owner;
    if (!childrenOf[owner]) childrenOf[owner] = [];
    if (!childrenOf[owner].includes(sid)) childrenOf[owner].push(sid);
  });
  const roots = goals.filter(g => isRootGoal(g.id)).map(g => String(g.id));
  goals.forEach(g => {
    const sid = String(g.id);
    if (!roots.includes(sid) && !ownerOf[sid]) roots.push(sid);
  });
  const GAP_X = 60, GAP_Y = 260, ROOT_GAP = 100;
  const widthOf = {};
  const seen = new Set();
  function computeWidth(id) {
    if (seen.has(id)) return widthOf[id] || NODE_W;
    seen.add(id);
    const kids = childrenOf[id] || [];
    if (kids.length === 0) { widthOf[id] = NODE_W; return NODE_W; }
    const total = kids.reduce((s, k) => s + computeWidth(k), 0) + (kids.length - 1) * GAP_X;
    widthOf[id] = Math.max(NODE_W, total);
    return widthOf[id];
  }
  roots.forEach(computeWidth);
  let xCursor = 0;
  const placed = new Set();
  function placeSubtree(id, depth) {
    if (placed.has(id)) return;
    placed.add(id);
    const kids = childrenOf[id] || [];
    if (kids.length === 0) {
      const x = xCursor + (widthOf[id] - NODE_W) / 2;
      if (!graphNodes[id]) graphNodes[id] = { x, y: depth * GAP_Y + 60 };
      xCursor += widthOf[id] + GAP_X;
      return;
    }
    const startX = xCursor;
    kids.forEach(k => placeSubtree(k, depth + 1));
    const endX = xCursor - GAP_X;
    const center = (startX + endX) / 2;
    if (!graphNodes[id]) graphNodes[id] = { x: center - NODE_W / 2, y: depth * GAP_Y + 60 };
  }
  roots.forEach(root => {
    placeSubtree(root, 0);
    xCursor += ROOT_GAP;
  });
}

function tidyGoalGraph() {
  haptic([15, 10]);
  for (const k of Object.keys(graphNodes)) delete graphNodes[k];
  graphPan = { x: 0, y: 0 };
  graphZoom = 1;
  graphUserInteracted = false;
  graphAutoFitPending = true;
  renderGoalGraph();
  showToast('Graph tidied ✨');
}
window.tidyGoalGraph = tidyGoalGraph;

function renderGraphEdges() {
  const svg = document.getElementById('goal-graph-edges'); if (!svg) return; svg.innerHTML = '';
  goalParents.forEach(({ goal_id, parent_id }) => {
    const pP = graphNodes[parent_id], cP = graphNodes[goal_id]; if (!pP || !cP) return;
    const x1 = pP.x + NODE_W/2, y1 = pP.y + NODE_H_BASE, x2 = cP.x + NODE_W/2, y2 = cP.y;
    const cy1 = y1 + (y2 - y1) * 0.5, cy2 = y2 - (y2 - y1) * 0.5;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', `M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`);
    p.setAttribute('class', 'gedge'); svg.appendChild(p);
    const d = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    d.setAttribute('cx', x2); d.setAttribute('cy', y2); d.setAttribute('r', '6');
    d.setAttribute('class', 'gedge-dot'); svg.appendChild(d);
  });
}

function setupNodeDrag(n, id) {
  let sX, sY, sPX, sPY, isD = false, pT;
  const oM = (cx, cy) => {
    if (!isD && (Math.abs(cx - sX) > 5 || Math.abs(cy - sY) > 5)) {
      isD = true; n.classList.add('is-dragging');
      n.style.transform = `translate(${graphNodes[id].x}px, ${graphNodes[id].y}px) scale(1.05)`;
      haptic([20]);
    }
    if (isD) {
      graphNodes[id].x = (cx - sPX) / graphZoom;
      graphNodes[id].y = (cy - sPY) / graphZoom;
      n.style.transform = `translate(${graphNodes[id].x}px, ${graphNodes[id].y}px) scale(1.05)`;
      renderGraphEdges();
    }
  };
  n.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('.gnode-leaf')) return;
    markGraphUserInteracted(); e.stopPropagation();
    sX = e.clientX; sY = e.clientY;
    sPX = e.clientX - graphNodes[id].x*graphZoom; sPY = e.clientY - graphNodes[id].y*graphZoom; isD = false;
    const mm = e2 => oM(e2.clientX, e2.clientY);
    const mu = () => {
      document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu);
      n.classList.remove('is-dragging');
      n.style.transform = `translate(${graphNodes[id].x}px, ${graphNodes[id].y}px)`;
      if (isD) haptic([10]);
    };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  });
  n.addEventListener('touchstart', e => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('.gnode-leaf')) return;
    markGraphUserInteracted();
    const t = e.touches[0]; sX = t.clientX; sY = t.clientY;
    sPX = t.clientX - graphNodes[id].x*graphZoom; sPY = t.clientY - graphNodes[id].y*graphZoom; isD = false;
    pT = setTimeout(() => { if (!isD) haptic([25,15,25]); }, 500);
    const tm = e2 => oM(e2.touches[0].clientX, e2.touches[0].clientY);
    const tu = () => {
      clearTimeout(pT); n.removeEventListener('touchmove', tm); n.removeEventListener('touchend', tu);
      n.classList.remove('is-dragging');
      n.style.transform = `translate(${graphNodes[id].x}px, ${graphNodes[id].y}px)`;
      if (isD) haptic([10]);
    };
    n.addEventListener('touchmove', tm, { passive: true }); n.addEventListener('touchend', tu);
  }, { passive: true });
}

function setupGraphPan(w) {
  let rAF;
  w.addEventListener('mousedown', e => {
    if (e.target.closest('.gnode')) return;
    markGraphUserInteracted(); graphPanning = true;
    graphPanStart = { x: e.clientX - graphPan.x, y: e.clientY - graphPan.y };
  });
  document.addEventListener('mousemove', e => {
    if (!graphPanning) return;
    graphPan.x = e.clientX - graphPanStart.x; graphPan.y = e.clientY - graphPanStart.y;
    if (!rAF) rAF = requestAnimationFrame(() => { applyGraphTransform(); rAF = null; });
  });
  document.addEventListener('mouseup', () => graphPanning = false);
  w.addEventListener('mouseleave', () => graphPanning = false);
  w.addEventListener('wheel', e => {
    e.preventDefault(); markGraphUserInteracted();
    graphZoom = Math.max(0.15, Math.min(2.5, graphZoom * (e.deltaY > 0 ? 0.85 : 1.15)));
    if (!rAF) rAF = requestAnimationFrame(() => { applyGraphTransform(); rAF = null; });
  }, { passive: false });
  let initPinchDist = null, initZoom = 1;
  w.addEventListener('touchstart', e => {
    if (e.target.closest('.gnode')) return;
    markGraphUserInteracted();
    if (e.touches.length === 1) {
      graphPanning = true;
      graphPanStart = { x: e.touches[0].clientX - graphPan.x, y: e.touches[0].clientY - graphPan.y };
    } else if (e.touches.length === 2) {
      graphPanning = false;
      initPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      initZoom = graphZoom;
    }
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (graphPanning && e.touches.length === 1) {
      graphPan.x = e.touches[0].clientX - graphPanStart.x;
      graphPan.y = e.touches[0].clientY - graphPanStart.y;
      if (!rAF) rAF = requestAnimationFrame(() => { applyGraphTransform(); rAF = null; });
    } else if (e.touches.length === 2 && initPinchDist) {
      const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      graphZoom = Math.max(0.15, Math.min(2.5, initZoom * (dist / initPinchDist)));
      if (!rAF) rAF = requestAnimationFrame(() => { applyGraphTransform(); rAF = null; });
    }
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (e.touches.length < 2) initPinchDist = null;
    if (e.touches.length === 0) graphPanning = false;
  });
}

function applyGraphTransform(anim = false) {
  const nD = document.getElementById('goal-graph-nodes'), s = document.getElementById('goal-graph-edges');
  if (!nD || !s) return;
  if (anim) {
    nD.style.transition = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
    s.style.transition  = 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)';
    setTimeout(() => { nD.style.transition = ''; s.style.transition = ''; }, 500);
  }
  const t = `translate(${graphPan.x}px, ${graphPan.y}px) scale(${graphZoom})`;
  nD.style.transform = t; s.style.transform = t;
}

// ── GOAL MODAL & CRUD (unchanged) ───────────────────────────
let _modalParentIds = new Set();

function openGoalModal(gId = null, pId = null) {
  editingGoalId = gId;
  const ex = gId ? goals.find(g => g.id === gId) : null;
  document.getElementById('goal-modal-title').textContent = ex ? 'Edit Goal' : 'New Goal';
  document.getElementById('goal-name').value = ex ? ex.name : '';
  document.getElementById('goal-why').value  = ex?.why || '';
  _modalParentIds = new Set();
  if (gId) {
    getParentIdsOf(gId).forEach(p => _modalParentIds.add(String(p)));
  } else if (pId) {
    _modalParentIds.add(String(pId));
  }
  renderGoalParentChips();
  const iconInput = document.getElementById('goal-icon');
  iconInput.value = ex?.icon || '⬤';
  document.getElementById('goal-modal').classList.add('open');
  setTimeout(() => document.getElementById('goal-name').focus(), 400);
  haptic([15]);
}

function renderGoalParentChips() {
  const wrap = document.getElementById('goal-parent-chips');
  if (!wrap) return;
  const selfId = editingGoalId ? String(editingGoalId) : null;
  const descendants = selfId ? collectDescendants(selfId) : new Set();
  const candidates = goals.filter(g => {
    const sid = String(g.id);
    return sid !== selfId && !descendants.has(sid);
  });
  if (candidates.length === 0) {
    wrap.innerHTML = '<span class="parent-chip-empty">No other goals yet — this will be a root goal.</span>';
    return;
  }
  wrap.innerHTML = candidates.map(g => {
    const sid = String(g.id);
    const on = _modalParentIds.has(sid);
    return `<button type="button" class="parent-chip${on ? ' on' : ''}" data-pid="${sid}" onclick="toggleGoalParent('${sid}')">${g.icon || '🎯'} ${escHtml(g.name)}</button>`;
  }).join('');
  const summary = document.getElementById('goal-parent-summary');
  if (summary) {
    const n = _modalParentIds.size;
    summary.textContent = n === 0 ? 'No parents selected — root goal' :
                          n === 1 ? '1 parent selected' :
                          `${n} parents selected`;
  }
}

function collectDescendants(rootId) {
  const out = new Set();
  const walk = (id) => {
    getChildIdsOf(id).forEach(cid => {
      if (out.has(cid)) return;
      out.add(cid);
      walk(cid);
    });
  };
  walk(String(rootId));
  return out;
}

function toggleGoalParent(pid) {
  const sid = String(pid);
  if (_modalParentIds.has(sid)) _modalParentIds.delete(sid);
  else _modalParentIds.add(sid);
  haptic([8]);
  renderGoalParentChips();
}
window.toggleGoalParent = toggleGoalParent;

function closeGoalModal()          { document.getElementById('goal-modal').classList.remove('open'); }
function closeGoalOnBackdrop(e)    { if (e.target === document.getElementById('goal-modal')) closeGoalModal(); }

function populateGoalSelect() {
  const fill = id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = '<option value="">Select a goal…</option>';
    const orderedAreas = getOrderedAreas();
    orderedAreas.forEach(area => {
      const cells = goals
        .filter(g => g.life_area === area.key)
        .sort((a, b) => _horizonIndex(a.time_horizon) - _horizonIndex(b.time_horizon));
      if (cells.length === 0) return;
      const group = document.createElement('optgroup');
      group.label = `${area.icon} ${area.name}`;
      cells.forEach(g => {
        const o = document.createElement('option');
        o.value = g.id;
        const hzn = _horizonMeta(g.time_horizon);
        const horizonLabel = hzn ? getHorizonShort(g.time_horizon) : '';
        o.textContent = horizonLabel ? `${horizonLabel} · ${g.name}` : g.name;
        group.appendChild(o);
      });
      el.appendChild(group);
    });
    const orphans = goals.filter(g => !g.life_area);
    if (orphans.length > 0) {
      const group = document.createElement('optgroup');
      group.label = 'Other';
      orphans.forEach(g => {
        const o = document.createElement('option');
        o.value = g.id;
        o.textContent = `${g.icon || ''} ${g.name}`.trim();
        group.appendChild(o);
      });
      el.appendChild(group);
    }
  };
  fill('habit-goal');
  fill('todo-goal-select');
}

async function saveGoal() {
  const n = document.getElementById('goal-name').value.trim();
  const w = document.getElementById('goal-why').value.trim() || null;
  const parentIdsArr = [..._modalParentIds];
  const primaryParentId = parentIdsArr[0] || null;
  let iconChar = document.getElementById('goal-icon').value.trim();
  if (!iconChar) iconChar = '⬤';
  iconChar = [...iconChar].slice(0, 2).join('');
  if (!n) { document.getElementById('goal-name').focus(); haptic([30,20,30]); return; }
  closeGoalModal();
  let savedGoalId = editingGoalId;
  if (editingGoalId) {
    const { data, error } = await supabase.from('goals')
      .eq('id', editingGoalId)
      .update({ name: n, why: w, icon: iconChar, parent_id: primaryParentId })
      .select();
    if (error) throw error;
    const idx = goals.findIndex(g => g.id === editingGoalId);
    if (idx > -1 && data && data[0]) goals[idx] = data[0];
  } else {
    const { data, error } = await supabase.from('goals')
      .insert({ name: n, why: w, icon: iconChar, parent_id: primaryParentId })
      .select();
    if (error) throw error;
    if (data && data[0]) {
      goals.push(data[0]);
      savedGoalId = data[0].id;
    }
  }
  if (savedGoalId) {
    await supabase.setGoalParents(savedGoalId, parentIdsArr).catch(e => console.error('setGoalParents', e));
    const fresh = await supabase.getGoalParents().catch(() => null);
    if (fresh) goalParents = fresh.map(gp => ({ goal_id: String(gp.goal_id), parent_id: String(gp.parent_id) }));
  }
  renderGoals(); renderTodo(); populateGoalSelect();
  showToast(editingGoalId ? 'Goal updated ✨' : 'Goal planted! 🌱');
}

function confirmDeleteGoal(btn, id) {
  if (btn.dataset.confirming) {
    deleteGoal(id);
  } else {
    btn.dataset.confirming = '1';
    btn.textContent = '?';
    btn.style.background = 'rgba(240,118,79,0.25)';
    btn.style.color = 'var(--ember, #f0764f)';
    setTimeout(function() {
      if (btn.dataset.confirming) {
        btn.dataset.confirming = '';
        btn.textContent = '✕';
        btn.style.background = '';
        btn.style.color = '';
      }
    }, 3000);
  }
}

async function deleteGoal(id) {
  haptic([30]);
  const fallbackParent = getParentIdsOf(id)[0] || null;
  const childIds = getChildIdsOf(id);
  for (const cid of childIds) {
    const newParents = getParentIdsOf(cid).filter(p => String(p) !== String(id));
    if (fallbackParent && !newParents.includes(fallbackParent)) newParents.push(fallbackParent);
    await supabase.setGoalParents(cid, newParents);
    const newPrimary = newParents[0] || null;
    await supabase.from('goals').eq('id', cid).update({ parent_id: newPrimary });
  }
  await supabase.from('habits').eq('goal_id', id).update({ goal_id: null });
  await supabase.removeAllGoalParentLinks(id);
  await supabase.from('goals').eq('id', id).delete();
  habits.forEach(h => { if (String(h.goal_id) === String(id)) h.goal_id = null; });
  delete graphNodes[id];
  await fetchGoals();
  renderTodo();
  populateGoalSelect();
  showToast('Goal removed');
}