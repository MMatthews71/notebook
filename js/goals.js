// ─────────────────────────────────────────────
//  GOALS — FETCH & RENDER
// ─────────────────────────────────────────────
let goalsResizeObserver = null;

async function fetchGoals(skipRender = false) {
  const { data, error } = await supabase.from('goals').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  goals = data || [];
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

// ─────────────────────────────────────────────
//  GRAPH RENDERING
// ─────────────────────────────────────────────
function renderGoalGraph() {
  const c = document.getElementById('goals-container'); if (!c) return;
  
  // Always recreate wrapper to ensure clean state
  let w = document.getElementById('goal-graph-wrap');
  if (w) w.remove(); // Remove old one
  
  c.innerHTML = `<div id="goal-graph-wrap"><svg id="goal-graph-edges"></svg><div id="goal-graph-nodes"></div></div>`;
  w = document.getElementById('goal-graph-wrap');
  
  // Force a reflow to ensure container has dimensions
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
    const isRoot = !g.parent_id;

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
          <button class="del" onclick="deleteGoal('${g.id}')">✕</button>
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
  const lOf = {}, aL = (id, l) => { lOf[id] = l; goals.filter(g => g.parent_id === id).forEach(c => aL(c.id, l + 1)); };
  goals.filter(g => !g.parent_id).forEach(g => aL(g.id, 0));
  const lvls = {}; goals.forEach(g => { const l = lOf[g.id] || 0; if (!lvls[l]) lvls[l] = []; lvls[l].push(g.id); });
  const xG = NODE_W + 80, yG = 260;
  Object.entries(lvls).forEach(([l, ids]) => {
    const y = parseInt(l) * yG + 60, tW = ids.length * xG;
    ids.forEach((id, i) => { if (!graphNodes[id]) graphNodes[id] = { x: i * xG - tW/2 + 400, y }; });
  });
}

function renderGraphEdges() {
  const svg = document.getElementById('goal-graph-edges'); if (!svg) return; svg.innerHTML = '';
  goals.filter(g => g.parent_id).forEach(c => {
    const pP = graphNodes[c.parent_id], cP = graphNodes[c.id]; if (!pP || !cP) return;
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

// ─────────────────────────────────────────────
//  GRAPH INTERACTION — NODE DRAG
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
//  GOALS — MODAL & CRUD
// ─────────────────────────────────────────────
function openGoalModal(gId = null, pId = null) {
  editingGoalId = gId;
  const ex = gId ? goals.find(g => g.id === gId) : null;
  document.getElementById('goal-modal-title').textContent = ex ? 'Edit Goal' : 'New Goal';
  document.getElementById('goal-name').value = ex ? ex.name : '';
  document.getElementById('goal-why').value  = ex?.why || '';
  const pS = document.getElementById('goal-parent');
  pS.innerHTML = `<option value="">None (Root Goal)</option>`;
  goals.forEach(g => {
    if (g.id === gId) return;
    const o = document.createElement('option'); o.value = g.id; o.textContent = `${g.icon || '🎯'} ${g.name}`; pS.appendChild(o);
  });
  pS.value = pId || ex?.parent_id || '';
  const iconInput = document.getElementById('goal-icon');
  iconInput.value = ex?.icon || '⬤';
  document.getElementById('goal-modal').classList.add('open');
  setTimeout(() => document.getElementById('goal-name').focus(), 400);
  haptic([15]);
}

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
  const pId = document.getElementById('goal-parent').value || null;
  let iconChar = document.getElementById('goal-icon').value.trim();
  if (!iconChar) iconChar = '⬤';
  iconChar = [...iconChar].slice(0, 2).join('');
  if (!n) { document.getElementById('goal-name').focus(); haptic([30,20,30]); return; }

  closeGoalModal();

  if (editingGoalId) {
    // Update directly in DB, then update local state
    const { data, error } = await supabase.from('goals')
      .eq('id', editingGoalId)
      .update({ name: n, why: w, icon: iconChar, parent_id: pId })
      .select();
    if (error) throw error;
    const idx = goals.findIndex(g => g.id === editingGoalId);
    if (idx > -1) goals[idx] = data[0];
  } else {
    const { data, error } = await supabase.from('goals')
      .insert({ name: n, why: w, icon: iconChar, parent_id: pId })
      .select();
    if (error) throw error;
    goals.push(data[0]);
  }

  // Refresh UI
  renderGoals(); renderTodo(); populateGoalSelect();
  showToast(editingGoalId ? 'Goal updated ✨' : 'Goal planted! 🌱');
}

async function deleteGoal(id) {
  if (!confirm('Delete goal? Habits will be unlinked.')) return;
  haptic([30]);

  const g = goals.find(x => x.id === id), np = g?.parent_id || null;
  
  // Update children and habits (DB cascades not set, so we do manually)
  const children = goals.filter(g => g.parent_id === id);
  for (const c of children) {
    await supabase.from('goals').eq('id', c.id).update({ parent_id: np });
  }
  await supabase.from('habits').eq('goal_id', id).update({ goal_id: null });
  await supabase.from('goals').eq('id', id).delete();

  // Update local state
  goals.forEach(g => { if (g.parent_id === id) g.parent_id = np; });
  habits.forEach(h => { if (h.goal_id === id) h.goal_id = null; });
  goals = goals.filter(g => g.id !== id);

  delete graphNodes[id];
  renderGoals(); renderTodo(); populateGoalSelect();
  showToast('Goal removed');
}