// ─────────────────────────────────────────────
//  GOALS — FETCH & RENDER
// ─────────────────────────────────────────────
let goalsResizeObserver = null;
let goalParents = []; // [{ goal_id, parent_id }] — many-to-many parent links

// Helpers for parent/child traversal
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
  // Back-fill: if a goal has legacy parent_id but no goal_parents entry, treat parent_id as a parent
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
  console.log('renderGoals called, goals count:', goals.length);
  const loadingEl = document.getElementById('goals-loading');
  const emptyEl = document.getElementById('goals-empty');
  const listEl = document.getElementById('goals-list');
  
  if (loadingEl) loadingEl.style.display = 'none';
  if (emptyEl) emptyEl.style.display = goals.length === 0 ? 'block' : 'none';
  if (listEl) listEl.style.display = goals.length > 0 ? 'block' : 'none';
  
  if (!graphUserInteracted) graphAutoFitPending = true;
  
  // Render graph immediately if we have goals and the goals tab is active
  if (goals.length > 0 && currentTab === 'goals') {
    const container = document.getElementById('goals-container');
    if (container) {
      // Disconnect any previous observer
      if (goalsResizeObserver) goalsResizeObserver.disconnect();
      
      // Create new observer
      goalsResizeObserver = new ResizeObserver(entries => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            renderGoalGraph();
            goalsResizeObserver.disconnect();
            goalsResizeObserver = null;
          }
        }
      });
      goalsResizeObserver.observe(container);
      
      // Also try immediate render (if already sized)
      const rect = container.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        renderGoalGraph();
      }
    }
  }
}

// ─────────────────────────────────────────────
//  GOAL GRAPH STATE
// ─────────────────────────────────────────────
let graphNodes = {}, graphPan = { x: 0, y: 0 }, graphPanning = false, graphPanStart = {};
let graphZoom = 1, graphUserInteracted = false, graphAutoFitPending = true;
const NODE_W = 44, NODE_H_BASE = 28;
const DOT_R = 14; // radius of node dot in px (matches CSS width/2)

// ── Layout settings (persisted to localStorage) ──────────────────────────────
let graphGapX      = +(localStorage.getItem('g_gapX')      || 55);
let graphGapY      = +(localStorage.getItem('g_gapY')      || 90);
let graphRootGap   = +(localStorage.getItem('g_rootGap')   || 35);
let graphEdgeCurve = +(localStorage.getItem('g_edgeCurve') || 0.5);

function saveGraphSettings() {
  localStorage.setItem('g_gapX',      graphGapX);
  localStorage.setItem('g_gapY',      graphGapY);
  localStorage.setItem('g_rootGap',   graphRootGap);
  localStorage.setItem('g_edgeCurve', graphEdgeCurve);
}

// ── Node position persistence ─────────────────────────────────────────────────
function saveNodePositions() {
  const toSave = {};
  goals.forEach(g => {
    const id = String(g.id);
    if (graphNodes[id]) toSave[id] = { x: graphNodes[id].x, y: graphNodes[id].y };
  });
  try { localStorage.setItem('g_nodePos', JSON.stringify(toSave)); } catch {}
}

function loadNodePositions() {
  try {
    const raw = localStorage.getItem('g_nodePos');
    if (!raw) return;
    const saved = JSON.parse(raw);
    // Only restore positions for goals that still exist
    goals.forEach(g => {
      const id = String(g.id);
      if (saved[id]) graphNodes[id] = { x: saved[id].x, y: saved[id].y };
    });
  } catch {}
}

function markGraphUserInteracted() { graphUserInteracted = true; graphAutoFitPending = false; }

function autoFitAndCenterGraph(wrapper) {
  if (!wrapper) return;
  const nDiv = document.getElementById('goal-graph-nodes');
  if (!nDiv || nDiv.children.length === 0) return;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nDiv.children) {
    const p = graphNodes[n.dataset.id]; if (!p) continue;
    // offsetWidth/Height are 0 if the node hasn't been laid out yet;
    // fall back to measured card width (140px for nodes with content) so
    // nodes with habits/todos don't get their right edge underestimated.
    const nw = n.offsetWidth  || (n.querySelector('.gnode-habits,.gnode-todos') ? 140 : NODE_W);
    const nh = n.offsetHeight || NODE_H_BASE;
    minX = Math.min(minX, p.x);    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x+nw); maxY = Math.max(maxY, p.y+nh);
  }
  if (!isFinite(minX)) return;
  const vW = wrapper.clientWidth, vH = wrapper.clientHeight;
  const pad = 80; // generous padding so nodes near the edges aren't clipped
  graphZoom = Math.max(0.12, Math.min(2.0, Math.min(
    (vW - pad) / (maxX - minX || 1),
    (vH - pad) / (maxY - minY || 1)
  )));
  graphPan.x = vW/2 - (minX + (maxX-minX)/2)*graphZoom;
  graphPan.y = vH/2 - (minY + (maxY-minY)/2)*graphZoom;
  applyGraphTransform(true);
}

// ─────────────────────────────────────────────
//  GRAPH RENDERING
// ─────────────────────────────────────────────
function renderGoalGraph() {
  const c = document.getElementById('goals-container'); if (!c) return;

  // Safety net: ensure goalParents is back-filled from legacy parent_id.
  // Covers the case where init.js loaded before goalParents was set up, or
  // where the junction table migration didn't populate all rows.
  goals.forEach(g => {
    if (g.parent_id) {
      const sid = String(g.id), spid = String(g.parent_id);
      const exists = goalParents.some(gp => gp.goal_id === sid && gp.parent_id === spid);
      if (!exists) goalParents.push({ goal_id: sid, parent_id: spid });
    }
  });

  // Keep the existing wrap if present — only create it fresh on first render.
  // Destroying + recreating on every data update (e.g. completing a todo)
  // causes the graph to jump because autoFit re-runs from scratch.
  let w = document.getElementById('goal-graph-wrap');
  const freshWrap = !w;
  if (freshWrap) {
    c.innerHTML = `<div id="goal-graph-wrap"><svg id="goal-graph-edges"></svg><div id="goal-graph-nodes"></div></div>`;
    w = document.getElementById('goal-graph-wrap');
    w.offsetHeight; // force reflow so dimensions are available immediately
    setupGraphPan(w);
  }

  loadNodePositions(); // restore user-dragged positions before auto-layout
  layoutGoals();       // only places NEW goals that don't have a position yet
  const nDiv = document.getElementById('goal-graph-nodes');
  nDiv.innerHTML = '';
  const vDStr = getActiveDateStr();
  goals.forEach(g => {
    const pos = graphNodes[g.id] || { x: 20, y: 20 };
    const isRoot = isRootGoal(g.id);
    const gid = String(g.id);

    // Habits linked to this goal that are active or have been done today
    const gHabits = habits.filter(h =>
      String(h.goal_id) === gid &&
      (isHabitActiveOnDate(h, vDStr) || ((h.doneCounts || {})[vDStr] || 0) > 0)
    );
    const habitsHtml = gHabits.length ? `<div class="gnode-habits">${
      gHabits.map(h => {
        const done = ((h.doneCounts || {})[vDStr] || 0) >= (h.target_count || 1);
        return `<div class="gnode-habit-item${done ? ' done' : ''}" data-habitid="${h.id}"><div class="gnode-habit-dot"></div><span class="gnode-habit-label">${escHtml(h.name)}</span></div>`;
      }).join('')
    }</div>` : '';

    // Todos linked to this goal: incomplete ones + any completed today
    const gTodos = (typeof todos !== 'undefined' ? todos : []).filter(t =>
      String(t.goal_id) === gid && (!t.completed || t.completed_at === vDStr)
    );
    const todosHtml = gTodos.length ? `<div class="gnode-todos">${
      gTodos.map(t => {
        const done = !!t.completed;
        return `<div class="gnode-todo-item${done ? ' done' : ''}" data-todoid="${t.id}"><div class="gnode-todo-check"></div><span class="gnode-todo-label">${escHtml(t.name)}</span></div>`;
      }).join('')
    }</div>` : '';

    const n = document.createElement('div');
    n.className = `gnode${isRoot ? ' gnode-root' : ''}`;
    n.dataset.id = g.id;
    n.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
    n.innerHTML = `<div class="gnode-dot">${g.icon || ''}</div><div class="gnode-label">${escHtml(g.name)}</div>${habitsHtml}${todosHtml}`;

    // Habit item tap — toggle habit without opening goal modal
    n.querySelectorAll('.gnode-habit-item').forEach(item => {
      item.addEventListener('click', e => { e.stopPropagation(); toggleHabit(item.dataset.habitid); });
      item.addEventListener('touchend', e => { e.stopPropagation(); e.preventDefault(); toggleHabit(item.dataset.habitid); }, { passive: false });
    });

    // Todo item tap — toggle todo without opening goal modal
    n.querySelectorAll('.gnode-todo-item').forEach(item => {
      item.addEventListener('click', e => { e.stopPropagation(); toggleTodo(item.dataset.todoid); });
      item.addEventListener('touchend', e => { e.stopPropagation(); e.preventDefault(); toggleTodo(item.dataset.todoid); }, { passive: false });
    });

    setupNodeDrag(n, g.id, () => openGoalModal(g.id));
    nDiv.appendChild(n);
  });

  renderGraphEdges();
  applyGraphTransform();
  // Auto-fit whenever graphAutoFitPending is set: first load, after Tidy,
  // or after a slider change. Does NOT fire on routine data refreshes (todo
  // toggles, habit checks) because markGraphUserInteracted() clears the flag.
  if (!graphUserInteracted && graphAutoFitPending) {
    graphAutoFitPending = false;
    // Double-rAF: node cards with habits/todos are wider than the 44px dot;
    // we need the browser to finish layout before measuring offsetWidth.
    requestAnimationFrame(() => requestAnimationFrame(() => autoFitAndCenterGraph(w)));
  }
}

// Reingold-Tilford-style hierarchical layout. Each node's horizontal slot
// is sized to fit its entire subtree, so siblings under different parents
// don't interleave or overlap. For multi-parent (DAG) nodes, the FIRST
// parent owns the layout slot; other parents draw cross-edges to it.
function layoutGoals() {
  const pos = new Set(Object.keys(graphNodes));
  if (!goals.filter(g => !pos.has(g.id)).length) return;

  // Build owner-parent map (each child belongs to its first parent for layout).
  // Iterate goals in stable order so the same node always picks the same first parent.
  const childrenOf = {}; // parentId -> [childIds]
  const ownerOf = {};    // childId -> parentId (the one that owns its slot)
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
  // Orphans (cycles or detached) — treat as roots too so they get placed.
  goals.forEach(g => {
    const sid = String(g.id);
    if (!roots.includes(sid) && !ownerOf[sid]) roots.push(sid);
  });

  // Top-down layout: roots across the top, children below.
  const GAP_X = graphGapX, GAP_Y = graphGapY, ROOT_GAP = graphRootGap;

  // Compute horizontal slot width each subtree needs.
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

  // Place each subtree, centering parents over their children.
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

// Clears all positions and runs layout from scratch. Use when the graph
// looks tangled — e.g. after deleting nodes, after adding many at once,
// or just to "reset" user-dragged positions.
function tidyGoalGraph() {
  haptic([15, 10]);
  // Clear persisted positions so auto-layout starts completely fresh
  try { localStorage.removeItem('g_nodePos'); } catch {}
  // Reset node positions and graph pan/zoom so the user sees the fresh layout
  for (const k of Object.keys(graphNodes)) delete graphNodes[k];
  graphPan = { x: 0, y: 0 };
  graphZoom = 1;
  graphUserInteracted = false;
  graphAutoFitPending = true;
  renderGoalGraph();
  saveNodePositions(); // save the fresh auto-layout positions
  showToast('Graph tidied ✨');
}
window.tidyGoalGraph = tidyGoalGraph;

// ─────────────────────────────────────────────
//  LAYOUT PANEL — sliders
// ─────────────────────────────────────────────
function toggleLayoutPanel() {
  const panel = document.getElementById('goal-layout-panel');
  if (!panel) return;
  const opening = !panel.classList.contains('open');
  panel.classList.toggle('open');
  if (opening) _syncLayoutSliders();
}
window.toggleLayoutPanel = toggleLayoutPanel;

function _syncLayoutSliders() {
  const set = (id, val, suffix = '') => {
    const el = document.getElementById(id);
    if (el) el.value = val;
    const vEl = document.getElementById(id + '-v');
    if (vEl) vEl.textContent = val + suffix;
  };
  set('gls-x',  Math.round(graphGapX));
  set('gls-y',  Math.round(graphGapY));
  set('gls-r',  Math.round(graphRootGap));
  set('gls-c',  Math.round(graphEdgeCurve * 100), '%');
}

let _layoutSliderTimer = null;
function onLayoutSlider() {
  // Read all slider values
  const gX = document.getElementById('gls-x');
  const gY = document.getElementById('gls-y');
  const gR = document.getElementById('gls-r');
  const gC = document.getElementById('gls-c');
  if (gX) { graphGapX    = +gX.value; const v = document.getElementById('gls-x-v'); if(v) v.textContent = gX.value; }
  if (gY) { graphGapY    = +gY.value; const v = document.getElementById('gls-y-v'); if(v) v.textContent = gY.value; }
  if (gR) { graphRootGap = +gR.value; const v = document.getElementById('gls-r-v'); if(v) v.textContent = gR.value; }
  if (gC) { graphEdgeCurve = +gC.value / 100; const v = document.getElementById('gls-c-v'); if(v) v.textContent = gC.value + '%'; }

  // Debounce the heavy re-layout
  clearTimeout(_layoutSliderTimer);
  _layoutSliderTimer = setTimeout(() => {
    // Full re-layout with new spacing params (clears all positions)
    for (const k of Object.keys(graphNodes)) delete graphNodes[k];
    try { localStorage.removeItem('g_nodePos'); } catch {}
    graphUserInteracted = false;
    graphAutoFitPending = true;
    renderGoalGraph();
    saveNodePositions();
    saveGraphSettings();
  }, 180);
}
window.onLayoutSlider = onLayoutSlider;

function renderGraphEdges() {
  const svg = document.getElementById('goal-graph-edges'); if (!svg) return; svg.innerHTML = '';
  goalParents.forEach(({ goal_id, parent_id }) => {
    const pP = graphNodes[parent_id], cP = graphNodes[goal_id]; if (!pP || !cP) return;
    // Top-down: connect bottom of parent dot to top of child dot
    const x1 = pP.x + NODE_W/2, y1 = pP.y + DOT_R*2;
    const x2 = cP.x + NODE_W/2, y2 = cP.y;
    const cv = graphEdgeCurve;
    const cy1 = y1 + (y2-y1)*cv, cy2 = y2 - (y2-y1)*cv;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', `M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`);
    p.setAttribute('class', 'gedge'); svg.appendChild(p);
    const d = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    d.setAttribute('cx', x2); d.setAttribute('cy', y2); d.setAttribute('r', '3');
    d.setAttribute('class', 'gedge-dot'); svg.appendChild(d);
  });
}

// ─────────────────────────────────────────────
//  GRAPH INTERACTION — NODE DRAG
// ─────────────────────────────────────────────
function setupNodeDrag(n, id, onClickCb) {
  let sX, sY, sPX, sPY, isD = false, pT, overBin = false;

  // ── Delete bin helpers ──────────────────────
  let binEl = null;
  const showBin = () => {
    if (binEl) return;
    const wrap = document.getElementById('goal-graph-wrap');
    if (!wrap) return;
    binEl = document.createElement('div');
    binEl.className = 'graph-delete-zone';
    binEl.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
    wrap.appendChild(binEl);
    requestAnimationFrame(() => binEl && binEl.classList.add('visible'));
  };
  const hideBin = () => {
    if (!binEl) return;
    binEl.classList.remove('visible');
    const b = binEl; binEl = null;
    setTimeout(() => b.remove(), 250);
  };
  const checkOverBin = (cx, cy) => {
    if (!binEl) return false;
    const r = binEl.getBoundingClientRect();
    return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
  };

  // ── Shared move handler ─────────────────────
  const oM = (cx, cy) => {
    if (!isD && (Math.abs(cx - sX) > 5 || Math.abs(cy - sY) > 5)) {
      isD = true; n.classList.add('is-dragging');
      n.style.transform = `translate(${graphNodes[id].x}px, ${graphNodes[id].y}px) scale(1.05)`;
      haptic([20]);
      showBin();
    }
    if (isD) {
      graphNodes[id].x = (cx - sPX) / graphZoom;
      graphNodes[id].y = (cy - sPY) / graphZoom;
      n.style.transform = `translate(${graphNodes[id].x}px, ${graphNodes[id].y}px) scale(1.05)`;
      renderGraphEdges();
      overBin = checkOverBin(cx, cy);
      binEl && binEl.classList.toggle('hot', overBin);
      n.classList.toggle('will-delete', overBin);
      if (overBin) haptic([8]);
    }
  };

  // ── Shared drop handler ─────────────────────
  const onDrop = () => {
    hideBin();
    n.classList.remove('is-dragging', 'will-delete');
    n.style.transform = `translate(${graphNodes[id].x}px, ${graphNodes[id].y}px)`;
    if (isD) {
      if (overBin) {
        haptic([15, 10, 30]);
        deleteGoal(String(id));
      } else {
        haptic([10]);
        saveNodePositions(); // persist the new position to localStorage
      }
    } else if (onClickCb) {
      onClickCb();
    }
    overBin = false;
  };

  n.addEventListener('mousedown', e => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('.gnode-leaf')) return;
    markGraphUserInteracted(); e.stopPropagation();
    sX = e.clientX; sY = e.clientY; isD = false;
    sPX = e.clientX - graphNodes[id].x*graphZoom; sPY = e.clientY - graphNodes[id].y*graphZoom;
    const mm = e2 => oM(e2.clientX, e2.clientY);
    const mu = () => { document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); onDrop(); };
    document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
  });

  n.addEventListener('touchstart', e => {
    if (e.target.tagName === 'BUTTON' || e.target.closest('.gnode-leaf')) return;
    markGraphUserInteracted();
    const t = e.touches[0]; sX = t.clientX; sY = t.clientY; isD = false;
    sPX = t.clientX - graphNodes[id].x*graphZoom; sPY = t.clientY - graphNodes[id].y*graphZoom;
    pT = setTimeout(() => { if (!isD) haptic([25,15,25]); }, 500);
    const tm = e2 => oM(e2.touches[0].clientX, e2.touches[0].clientY);
    const tu = () => { clearTimeout(pT); n.removeEventListener('touchmove', tm); n.removeEventListener('touchend', tu); onDrop(); };
    n.addEventListener('touchmove', tm, { passive: true }); n.addEventListener('touchend', tu);
  }, { passive: true });
}

// ─────────────────────────────────────────────
//  GRAPH INTERACTION — PAN & ZOOM
// ─────────────────────────────────────────────
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
    const rect = w.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const factor = Math.exp(-e.deltaY * 0.0008);
    const newZoom = Math.max(0.1, Math.min(3.5, graphZoom * factor));
    graphPan.x = mx - (mx - graphPan.x) * (newZoom / graphZoom);
    graphPan.y = my - (my - graphPan.y) * (newZoom / graphZoom);
    graphZoom = newZoom;
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

// ─────────────────────────────────────────────
//  GOALS — MODAL & CRUD
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
//  GOAL EMOJI PICKER
// ─────────────────────────────────────────────
const GOAL_EMOJIS = [
  '🎯','⭐','🔥','💪','🧠','📚','💰','❤️','🌱','🏆',
  '🚀','🎨','💼','🏃','🧘','🌍','🎵','📈','🤝','🏠',
  '✈️','🎓','💻','🌿','🔬','🎭','🏋️','🌞','💡','🎸',
  '⚡','🌊','🦁','🔭','🌸','📝','🛡️','🎬','🔮','🍀',
];

function renderGoalEmojiPicker(selected) {
  const grid = document.getElementById('goal-emoji-grid');
  const inp  = document.getElementById('goal-icon');
  if (!grid || !inp) return;
  const sel = selected || '🎯';
  inp.value = sel;
  grid.innerHTML = GOAL_EMOJIS.map(e =>
    `<button type="button" class="emoji-opt${e === sel ? ' selected' : ''}"
      onclick="selectGoalEmoji('${e}')">${e}</button>`
  ).join('');
}
function selectGoalEmoji(emoji) {
  const inp = document.getElementById('goal-icon');
  if (inp) inp.value = emoji;
  document.querySelectorAll('#goal-emoji-grid .emoji-opt').forEach(b =>
    b.classList.toggle('selected', b.textContent.trim() === emoji)
  );
  haptic([8]);
}
window.selectGoalEmoji = selectGoalEmoji;

// Currently-selected parent IDs while the modal is open (Set of strings)
let _modalParentIds = new Set();

function openGoalModal(gId = null, pId = null) {
  editingGoalId = gId;
  const ex = gId ? goals.find(g => g.id === gId) : null;
  document.getElementById('goal-modal-title').textContent = ex ? 'Edit Goal' : 'New Goal';
  document.getElementById('goal-name').value = ex ? ex.name : '';
  document.getElementById('goal-why').value  = ex?.why || '';

  // Seed _modalParentIds
  _modalParentIds = new Set();
  if (gId) {
    // Editing existing — pre-fill from goalParents
    getParentIdsOf(gId).forEach(p => _modalParentIds.add(String(p)));
  } else if (pId) {
    // Creating new child from a parent context (e.g. + button on a node)
    _modalParentIds.add(String(pId));
  }
  renderGoalParentChips();

  renderGoalEmojiPicker(ex?.icon || '🎯');
  document.getElementById('goal-modal').classList.add('open');
  setTimeout(() => document.getElementById('goal-name').focus(), 400);
  haptic([15]);
}

function renderGoalParentChips() {
  const wrap = document.getElementById('goal-parent-chips');
  if (!wrap) return;
  const selfId = editingGoalId ? String(editingGoalId) : null;
  // Hide self + any descendant to prevent cycles
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
  // Also show a summary line
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
  const p = id => {
    const el = document.getElementById(id);
    if (el) {
      el.innerHTML = '<option value="">Select a goal...</option>';
      goals.forEach(g => { const o = document.createElement('option'); o.value = g.id; o.textContent = `${g.icon} ${g.name}`; el.appendChild(o); });
    }
  };
  p('habit-goal'); p('todo-goal-select');
}

async function saveGoal() {
  const n = document.getElementById('goal-name').value.trim();
  const w = document.getElementById('goal-why').value.trim() || null;
  // parent_id (legacy single column) = first selected parent (for backward compat with old code)
  const parentIdsArr = [..._modalParentIds];
  const primaryParentId = parentIdsArr[0] || null;
  let iconChar = document.getElementById('goal-icon').value.trim();
  if (!iconChar) iconChar = '🎯';
  iconChar = [...iconChar].slice(0, 2).join(''); // keep full emoji (some are 2 code points)
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

  // Persist the full parent set in the junction table
  if (savedGoalId) {
    await supabase.setGoalParents(savedGoalId, parentIdsArr).catch(e => console.error('setGoalParents', e));
    // Re-fetch parents so local state matches DB
    const fresh = await supabase.getGoalParents().catch(() => null);
    if (fresh) goalParents = fresh.map(gp => ({ goal_id: String(gp.goal_id), parent_id: String(gp.parent_id) }));
  }

  // Refresh UI
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

  // Children that have THIS goal as a parent — re-parent them to this goal's
  // first parent (if any) so they don't end up orphaned silently.
  const fallbackParent = getParentIdsOf(id)[0] || null;
  const childIds = getChildIdsOf(id);
  for (const cid of childIds) {
    // Replace (cid → id) with (cid → fallbackParent), keeping any other parents intact
    const newParents = getParentIdsOf(cid).filter(p => String(p) !== String(id));
    if (fallbackParent && !newParents.includes(fallbackParent)) newParents.push(fallbackParent);
    await supabase.setGoalParents(cid, newParents);
    // Also update legacy parent_id on the child to first new parent
    const newPrimary = newParents[0] || null;
    await supabase.from('goals').eq('id', cid).update({ parent_id: newPrimary });
  }

  // Unlink habits
  await supabase.from('habits').eq('goal_id', id).update({ goal_id: null });

  // Remove all parent links touching this goal, then delete the goal row
  await supabase.removeAllGoalParentLinks(id);
  await supabase.from('goals').eq('id', id).delete();

  // Update habits local state immediately
  habits.forEach(h => { if (String(h.goal_id) === String(id)) h.goal_id = null; });
  delete graphNodes[id];

  // Re-fetch goals so the graph re-renders from DB
  await fetchGoals();
  renderTodo();
  populateGoalSelect();
  showToast('Goal removed');
}