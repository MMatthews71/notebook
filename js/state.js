// ─────────────────────────────────────────────
//  TODO ITEM STREAK SUPPORT
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
//  FLEXIBLE HABIT OVERRIDES
// ─────────────────────────────────────────────
let flexOverrides = {};

async function setFlexOverride(hId, dStr) {
  flexOverrides[`${hId}_${dStr}`] = true;
  await supabase.toggleFlexOverride(hId, dStr, true);
  haptic([20, 30]);
  renderTodo(); renderGoals();
  showToast('Pulled to Today ✨');
}
window.setFlexOverride = setFlexOverride;

// ─────────────────────────────────────────────
//  SKIPPED HABITS OVERRIDES
// ─────────────────────────────────────────────
let skippedHabits = {};

async function setHabitSkipped(habitId, dateStr, skipped = true) {
  const key = `${habitId}_${dateStr}`;
  if (skipped) skippedHabits[key] = true;
  else delete skippedHabits[key];
  await supabase.toggleSkippedHabit(habitId, dateStr, skipped);
}

function isHabitSkipped(habitId, dateStr) {
  return !!skippedHabits[`${habitId}_${dateStr}`];
}

window.setHabitSkipped = setHabitSkipped;
window.isHabitSkipped = isHabitSkipped;

// ─────────────────────────────────────────────
//  HABIT DAILY ORDER (for reordering)
// ─────────────────────────────────────────────
let habitDailyOrder = {};

async function setHabitOrder(habitId, dateStr, order) {
  if (!habitDailyOrder[dateStr]) habitDailyOrder[dateStr] = {};
  habitDailyOrder[dateStr][habitId] = order;
  await supabase.upsertDailyOrder(dateStr, habitId, 'habit', order);
}

function getHabitOrder(habitId, dateStr) {
  return habitDailyOrder[dateStr]?.[habitId] ?? null;
}

window.setHabitOrder = setHabitOrder;
window.getHabitOrder = getHabitOrder;

// ─────────────────────────────────────────────
//  TODO DAILY ORDER (for reordering)
// ─────────────────────────────────────────────
let todoDailyOrder = {};

async function setTodoOrder(todoId, dateStr, order) {
  if (!todoDailyOrder[dateStr]) todoDailyOrder[dateStr] = {};
  todoDailyOrder[dateStr][todoId] = order;
  await supabase.upsertDailyOrder(dateStr, todoId, 'todo', order);
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
