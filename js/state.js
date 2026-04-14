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
//  GLOBAL APP STATE
// ─────────────────────────────────────────────
let habits = [], goals = [], todos = [];
let selectedEmoji = '⬤', selectedGoalEmoji = '⬤';
let selectedFreq = 'daily', selectedDays = new Set(), selectedInterval = 2;
let currentTab = 'todo';
let editingGoalId = null, preselectedGoalId = null, editingHabitId = null, editingTodoId = null;
let activeDate = new Date(), calDate = new Date(), isCalendarView = false;

const DAY_KEYS = ['sun','mon','tue','wed','thu','fri','sat'];