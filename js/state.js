// ─────────────────────────────────────────────
//  LOCAL STORAGE KEYS & HELPERS
// ─────────────────────────────────────────────
const LS_HABITS      = 'habits_local_habits';
const LS_GOALS       = 'habits_local_goals';
const LS_COMPLETIONS = 'habits_local_completions';
const LS_TODOS       = 'habits_local_todos';
const LS_NOTES       = 'habits_local_notes';

function lsGet(key) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } }
function lsSet(key, val) { localStorage.setItem(key, JSON.stringify(val)); }

// ── TODO ITEM STREAK SUPPORT ─────────────────
// Ensure every todo has type 'standard' by default and streak_dates array.
function normalizeTodos(todoList) {
  return todoList.map(t => ({
    ...t,
    type: t.type || 'standard',
    streak_dates: Array.isArray(t.streak_dates)
      ? t.streak_dates
      : (t.streak_dates ? JSON.parse(t.streak_dates) : []),
  }));
}

// Override lsSet for todos to keep consistency
const _lsSet = lsSet;
lsSet = (key, val) => {
  if (key === LS_TODOS) {
    val = normalizeTodos(val);
  }
  _lsSet(key, val);
};

// ─────────────────────────────────────────────
//  FLEXIBLE HABIT OVERRIDES
// ─────────────────────────────────────────────
let flexOverrides = {};
try { flexOverrides = JSON.parse(localStorage.getItem('habits_flex_overrides')) || {}; } catch(e){}

function setFlexOverride(hId, dStr) {
  flexOverrides[`${hId}_${dStr}`] = true;
  localStorage.setItem('habits_flex_overrides', JSON.stringify(flexOverrides));
  haptic([20, 30]);
  renderTodo(); renderGoals();
  showToast('Pulled to Today ✨');
}
window.setFlexOverride = setFlexOverride;

// ─────────────────────────────────────────────
//  SKIPPED HABITS OVERRIDES
// ─────────────────────────────────────────────
let skippedHabits = {};
try { skippedHabits = JSON.parse(localStorage.getItem('habits_skipped')) || {}; } catch(e){}

function setHabitSkipped(habitId, dateStr, skipped = true) {
  const key = `${habitId}_${dateStr}`;
  if (skipped) skippedHabits[key] = true;
  else delete skippedHabits[key];
  localStorage.setItem('habits_skipped', JSON.stringify(skippedHabits));
}

function isHabitSkipped(habitId, dateStr) {
  return !!skippedHabits[`${habitId}_${dateStr}`];
}

window.setHabitSkipped = setHabitSkipped;
window.isHabitSkipped = isHabitSkipped;

// ─────────────────────────────────────────────
//  HABIT DAILY ORDER (for reordering)
// ─────────────────────────────────────────────
const LS_HABIT_ORDER = 'habits_daily_order';
let habitDailyOrder = {};

try {
  habitDailyOrder = JSON.parse(localStorage.getItem(LS_HABIT_ORDER)) || {};
} catch(e) {}

function setHabitOrder(habitId, dateStr, order) {
  if (!habitDailyOrder[dateStr]) habitDailyOrder[dateStr] = {};
  habitDailyOrder[dateStr][habitId] = order;
  localStorage.setItem(LS_HABIT_ORDER, JSON.stringify(habitDailyOrder));
}

function getHabitOrder(habitId, dateStr) {
  return habitDailyOrder[dateStr]?.[habitId] ?? null;
}

window.setHabitOrder = setHabitOrder;
window.getHabitOrder = getHabitOrder;

// ─────────────────────────────────────────────
//  TODO DAILY ORDER (for reordering)
// ─────────────────────────────────────────────
const LS_TODO_ORDER = 'todos_daily_order';
let todoDailyOrder = {};

try {
  todoDailyOrder = JSON.parse(localStorage.getItem(LS_TODO_ORDER)) || {};
} catch(e) {}

function setTodoOrder(todoId, dateStr, order) {
  if (!todoDailyOrder[dateStr]) todoDailyOrder[dateStr] = {};
  todoDailyOrder[dateStr][todoId] = order;
  localStorage.setItem(LS_TODO_ORDER, JSON.stringify(todoDailyOrder));
}

function getTodoOrder(todoId, dateStr) {
  return todoDailyOrder[dateStr]?.[todoId] ?? null;
}

window.setTodoOrder = setTodoOrder;
window.getTodoOrder = getTodoOrder;

// ─────────────────────────────────────────────
//  GLOBAL APP STATE
// ─────────────────────────────────────────────
let habits = [], goals = [], todos = [];
let selectedEmoji = '⬤', selectedGoalEmoji = '⬤';
let selectedFreq = 'daily', selectedDays = new Set(), selectedInterval = 2;
let currentTab = 'todo';
let editingGoalId = null, preselectedGoalId = null, editingHabitId = null, editingTodoId = null;
let activeDate = new Date(), calDate = new Date(), isCalendarView = false;

const DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];