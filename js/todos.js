// ─────────────────────────────────────────────
//  TODOS — FETCH & CRUD
// ─────────────────────────────────────────────
async function fetchTodos(skipRender = false) {
  try {
    const { data, error } = await supabase.from('todos').select('*').order('created_at', { ascending: true });
    if (error) throw error; todos = (data || []).map(t => ({ ...t, type: t.type || 'standard', streak_dates: t.streak_dates || [] })); lsSet(LS_TODOS, todos);
  } catch (e) { console.error('fetchTodos failed:', e); todos = lsGet(LS_TODOS).map(t => ({ ...t, type: t.type || 'standard', streak_dates: t.streak_dates || [] })); }
  if (!skipRender) { if (currentTab === 'todo') renderTodo(); if (currentTab === 'goals') renderGoals(); }
}

async function toggleTodo(id) {
  const t = todos.find(t => t.id === id); if (!t) return;
  const target = t.target_count || 1, current = t.current_count || 0;
  if (current >= target) {
    t.current_count = 0; t.completed = false; t.completed_at = null; haptic([15]);
  } else {
    t.current_count = current + 1; t.completed = t.current_count >= target;
    if (t.completed) {
      t.completed_at = todayStr();
      const r = document.querySelector(`.todo-item-check[data-id="${id}"]`);
      haptic([25, 40]);
      if (r) { burstFromEl(r, 40); r.parentElement.classList.add('just-done'); setTimeout(() => r.parentElement.classList.remove('just-done'), 500); }
      showToast('Action complete! ✅');
    } else { haptic([20]); }
  }
  renderTodo(); renderGoals();
  try { await supabase.from('todos').eq('id', id).update({ completed: t.completed, current_count: t.current_count, completed_at: t.completed_at }); }
  catch (e) { lsSet(LS_TODOS, todos); }
}

async function deleteTodo(id) {
  haptic([30]); todos = todos.filter(t => t.id !== id); renderTodo(); renderGoals();
  try { await supabase.from('todos').eq('id', id).delete(); }
  catch(e) { console.error('deleteTodo failed:', e); lsSet(LS_TODOS, todos); }
  showToast('To-do removed');
}

async function moveTodoToToday(id) {
  const t = todos.find(t => t.id === id); if (!t) return;
  t.due_date = todayStr(); haptic([20,30]); renderTodo(); renderGoals();
  try { await supabase.from('todos').eq('id', id).update({ due_date: t.due_date }); }
  catch(e) { console.error('moveTodoToToday failed:', e); lsSet(LS_TODOS, todos); }
  showToast('Pulled to Today ✨');
}

async function moveTodoToTomorrow(id) {
  const todo = todos.find(t => t.id === id);
  if (!todo) return;
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0,10);
  todo.due_date = tomorrowStr;
  haptic([20,30]);
  renderTodo();
  renderGoals();
  try {
    await supabase.from('todos').eq('id', id).update({ due_date: tomorrowStr });
    showToast('Moved to tomorrow');
  } catch(e) {
    console.error('moveTodoToTomorrow failed:', e);
    lsSet(LS_TODOS, todos);
    showToast('Moved locally');
  }
}
window.moveTodoToTomorrow = moveTodoToTomorrow;

// ── STREAK TODO FUNCTIONS ──────────────────
async function toggleStreakTodoToday(id) {
  const t = todos.find(t => t.id === id);
  if (!t || t.type !== 'streak') return;

  // Ensure streak_dates is always an array
  if (!Array.isArray(t.streak_dates)) {
    try {
      t.streak_dates = JSON.parse(t.streak_dates || '[]');
    } catch {
      t.streak_dates = [];
    }
  }

  const today = getActiveDateStr();
  const index = t.streak_dates.indexOf(today);
  if (index > -1) {
    t.streak_dates.splice(index, 1);
    haptic([15]);
  } else {
    t.streak_dates.push(today);
    haptic([20, 40]); // stronger haptic when completing for today
    // Burst particles from the button if found
    const btn = document.querySelector(`.streak-today-btn[data-id="${id}"]`);
    if (btn) burstFromEl(btn, 30);
  }
  // Always keep dates sorted and unique
  t.streak_dates = [...new Set(t.streak_dates)].sort();
  renderTodo();
  renderGoals();
  try {
    await supabase.from('todos').eq('id', id).update({
      streak_dates: JSON.stringify(t.streak_dates),
    });
  } catch (e) {
    lsSet(LS_TODOS, todos);
  }
}
window.toggleStreakTodoToday = toggleStreakTodoToday;

async function completeStreakForever(id) {
  const t = todos.find(t => t.id === id);
  if (!t || t.type !== 'streak') return;

  // Ensure streak_dates is always an array (defensive)
  if (!Array.isArray(t.streak_dates)) {
    try {
      t.streak_dates = JSON.parse(t.streak_dates || '[]');
    } catch {
      t.streak_dates = [];
    }
  }

  t.completed = true;
  t.completed_at = todayStr();
  haptic([25, 40]);
  const btn = document.querySelector(`.streak-forever-btn[data-id="${id}"]`);
  if (btn) burstFromEl(btn, 50);
  renderTodo();
  renderGoals();
  try {
    await supabase.from('todos').eq('id', id).update({
      completed: true,
      completed_at: t.completed_at,
    });
  } catch (e) {
    lsSet(LS_TODOS, todos);
  }
  showToast('Task completed forever! 🏁');
}
window.completeStreakForever = completeStreakForever;

// ─────────────────────────────────────────────
//  TODO MODAL
// ─────────────────────────────────────────────
function openTodoModal() {
  editingTodoId = null;
  document.getElementById('todo-modal-title').textContent = 'New To-do';
  document.getElementById('todo-name').value = '';
  document.getElementById('todo-target').value = '1';
  document.getElementById('todo-target-display').textContent = '1×';
  document.getElementById('todo-deadline').value = '';
  document.getElementById('todo-due').value = '';
  Object.keys(_modalCalState).forEach(k => delete _modalCalState[k]);
  setTodoTimeValue(null);
  populateGoalSelect();
  document.getElementById('todo-goal-select').value = '';
  setWhenOption('today');
  const cb = document.getElementById('save-as-template');
  const nameInput = document.getElementById('template-name-input');
  if (cb) cb.checked = false;
  if (nameInput) { nameInput.value = ''; nameInput.style.display = 'none'; }
  const saveRow = document.getElementById('template-save-row');
  if (saveRow) saveRow.style.display = 'flex';
  const templateRow = document.getElementById('template-row');
  if (templateRow) templateRow.style.display = 'flex';
  const templateSelect = document.getElementById('todo-template-select');
  if (templateSelect) templateSelect.value = '';
  const delBtn = document.getElementById('delete-template-btn');
  if (delBtn) delBtn.style.display = 'none';
  populateTemplateSelect();
  const streakCheck = document.getElementById('todo-streak');
  if (streakCheck) streakCheck.checked = false;
  document.getElementById('todo-modal').classList.add('open');
  setTimeout(() => document.getElementById('todo-name').focus(), 400);
  haptic([15]);
}

function openTodoEditModal(id) {
  const t = todos.find(x => x.id === id); if (!t) return;
  editingTodoId = id;
  document.getElementById('todo-modal-title').textContent = 'Edit To-do';
  document.getElementById('todo-name').value = t.name;
  const tc = t.target_count || 1;
  document.getElementById('todo-target').value = tc;
  document.getElementById('todo-target-display').textContent = tc + '×';
  document.getElementById('todo-deadline').value = t.deadline || '';
  setTodoTimeValue(t.scheduled_time);
  populateGoalSelect();
  document.getElementById('todo-goal-select').value = t.goal_id || '';
  if (t.due_date) {
    if (t.due_date === todayStr()) setWhenOption('today');
    else { document.getElementById('todo-due').value = t.due_date; Object.keys(_modalCalState).forEach(k => delete _modalCalState[k]); setWhenOption('scheduled'); }
  } else { Object.keys(_modalCalState).forEach(k => delete _modalCalState[k]); setWhenOption('eventually'); }
  const templateRow = document.getElementById('template-row');
  const saveRow = document.getElementById('template-save-row');
  if (templateRow) templateRow.style.display = 'none';
  if (saveRow) saveRow.style.display = 'none';
  const streakCheck = document.getElementById('todo-streak');
  if (streakCheck) streakCheck.checked = t.type === 'streak';
  document.getElementById('todo-modal').classList.add('open');
  setTimeout(() => document.getElementById('todo-name').focus(), 400);
  haptic([15]);
}

function closeTodoModal()       { document.getElementById('todo-modal').classList.remove('open'); }
function closeTodoOnBackdrop(e) { if (e.target === document.getElementById('todo-modal')) closeTodoModal(); }

async function saveTodo() {
  const n = document.getElementById('todo-name').value.trim();
  const gId = document.getElementById('todo-goal-select').value;
  const tc = parseInt(document.getElementById('todo-target').value) || 1;
  const activeWhen = document.querySelector('.when-option.active')?.dataset.when || 'today';
  const type = document.getElementById('todo-streak')?.checked ? 'streak' : 'standard';
  let due_date = null, deadline = null, scheduled_time = null;
  if (activeWhen === 'today') {
    due_date = todayStr(); scheduled_time = getTodoTimeValue();
  } else if (activeWhen === 'scheduled') {
    due_date = document.getElementById('todo-due').value || getActiveDateStr();
    scheduled_time = getTodoTimeValue();
  } else {
    due_date = null; deadline = document.getElementById('todo-deadline').value || null; scheduled_time = null;
  }
  if (!n) { document.getElementById('todo-name').focus(); haptic([30,20,30]); return; }
  if (!gId) { showToast('Please connect to a goal'); haptic([30,20,30]); return; }
  maybeSaveTemplate(n, gId, tc, scheduled_time);
  closeTodoModal();
  if (editingTodoId) {
    const patch = { name: n, goal_id: gId, due_date, deadline, target_count: tc, scheduled_time, type };
    const existing = todos.find(x => x.id === editingTodoId);
    if (existing) {
      patch.streak_dates = type === 'streak' ? JSON.stringify(existing.streak_dates || []) : null;
    }
    const idx = todos.findIndex(x => x.id === editingTodoId);
    if (idx > -1) todos[idx] = { ...todos[idx], ...patch };
    renderTodo(); renderGoals();
    try { await supabase.from('todos').eq('id', editingTodoId).update(patch); showToast('To-do updated ✨'); }
    catch(e) { lsSet(LS_TODOS, todos); showToast('To-do updated locally ✨'); }
  } else {
    const streak_dates = type === 'streak' ? [] : undefined;
    const newTodo = { id: crypto.randomUUID(), name: n, goal_id: gId, due_date, deadline, completed: false, target_count: tc, current_count: 0, scheduled_time, type, streak_dates, created_at: new Date().toISOString() };
    try {
      await supabase.from('todos').insert([{ name: n, goal_id: gId, due_date, deadline, completed: false, target_count: tc, current_count: 0, scheduled_time, type, streak_dates: streak_dates ? JSON.stringify(streak_dates) : null }]);
      await fetchTodos(); if (currentTab === 'goals') renderGoals(); haptic([20,35]); showToast('Action added ✅');
    } catch(e) {
      const r = lsGet(LS_TODOS); r.push(newTodo); lsSet(LS_TODOS, r);
      todos.push(newTodo); renderTodo(); if (currentTab === 'goals') renderGoals(); haptic([20,35]); showToast('Action saved locally ✅');
    }
  }
}

// ─────────────────────────────────────────────
//  TODO TEMPLATES
// ─────────────────────────────────────────────
const LS_TEMPLATES = 'habits_todo_templates';
function getTemplates()      { return lsGet(LS_TEMPLATES); }
function saveTemplates(arr)  { lsSet(LS_TEMPLATES, arr); }

function populateTemplateSelect() {
  const select = document.getElementById('todo-template-select'); if (!select) return;
  const templates = getTemplates();
  select.innerHTML = '<option value="">Select a template…</option>';
  templates.forEach((t, i) => { const opt = document.createElement('option'); opt.value = i; opt.textContent = t.label || t.name; select.appendChild(opt); });
  const delBtn = document.getElementById('delete-template-btn');
  if (delBtn) delBtn.style.display = select.value !== '' ? 'flex' : 'none';
}

function applyTemplate(idx) {
  const delBtn = document.getElementById('delete-template-btn');
  if (idx === '') { if (delBtn) delBtn.style.display = 'none'; return; }
  if (delBtn) delBtn.style.display = 'flex';
  const t = getTemplates()[parseInt(idx)]; if (!t) return;
  if (t.name) document.getElementById('todo-name').value = t.name;
  if (t.goal_id) { const sel = document.getElementById('todo-goal-select'); if (sel) sel.value = t.goal_id; }
  if (t.target_count) document.getElementById('todo-target').value = t.target_count;
  if (t.scheduled_time) setTodoTimeValue(t.scheduled_time);
  haptic([15]);
}

function deleteTemplate(idx) {
  const templates = getTemplates(); templates.splice(idx, 1); saveTemplates(templates);
  const select = document.getElementById('todo-template-select'); select.value = '';
  populateTemplateSelect(); applyTemplate(''); haptic([20]); showToast('Template deleted');
}

function maybeSaveTemplate(taskName, goalId, targetCount, scheduledTime) {
  const cb = document.getElementById('save-as-template'); if (!cb || !cb.checked) return;
  const labelInput = document.getElementById('template-name-input');
  const label = (labelInput && labelInput.value.trim()) || taskName;
  const templates = getTemplates();
  if (!templates.find(t => t.label === label)) {
    templates.push({ label, name: taskName, goal_id: goalId, target_count: targetCount, scheduled_time: scheduledTime });
    saveTemplates(templates); showToast('Template saved');
  }
  cb.checked = false;
  if (labelInput) { labelInput.value = ''; labelInput.style.display = 'none'; }
}

// Wire up "save as template" checkbox
document.addEventListener('DOMContentLoaded', () => {
  const cb = document.getElementById('save-as-template');
  const nameInput = document.getElementById('template-name-input');
  if (cb && nameInput) {
    cb.addEventListener('change', () => {
      nameInput.style.display = cb.checked ? 'block' : 'none';
      if (cb.checked) {
        const taskName = document.getElementById('todo-name').value.trim();
        if (taskName && !nameInput.value) nameInput.value = taskName;
        nameInput.focus();
      }
    });
  }
});