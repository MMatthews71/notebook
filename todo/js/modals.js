// ─────────────────────────────────────────────
//  HABIT TIME SLOT HELPERS
// ─────────────────────────────────────────────
function parseHabitScheduledTimes(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v !== 'string') return [];
  const s = v.trim(); if (!s) return [];
  if (s.startsWith('[')) { try { const arr = JSON.parse(s); return Array.isArray(arr) ? arr : []; } catch { return []; } }
  return [s];
}

function formatHabitTimeToken(token) {
  if (!token) return '';
  if (token === 'morning' || token === 'afternoon' || token === 'evening') return token.charAt(0).toUpperCase() + token.slice(1);
  const d = new Date(`1970-01-01T${token}`);
  const h = d.getHours(), m = d.getMinutes();
  const hr = h % 12 || 12;
  return m ? `${hr}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}` : `${hr}${h < 12 ? 'am' : 'pm'}`;
}

function toggleSpecificTime(selectEl) {
  const slot = selectEl?.closest('.habit-time-slot');
  const timeInput = slot?.querySelector('.habit-time'); if (!timeInput) return;
  timeInput.style.display = selectEl.value === 'specific' ? 'block' : 'none';
  if (selectEl.value !== 'specific') timeInput.value = '';
}

function readHabitTimeSlots() {
  return [...document.querySelectorAll('#modal .habit-time-slot')].map(s => {
    const period = s.querySelector('.habit-time-period')?.value || '';
    const t = s.querySelector('.habit-time')?.value || '';
    if (!period) return '';
    return period === 'specific' ? (t || '') : period;
  });
}

function renderHabitTimeSlots(slotCount, presetTimes = []) {
  const container = document.querySelector('#modal .habit-time-slots'); if (!container) return;
  const count = Math.max(1, Math.min(10, parseInt(slotCount, 10) || 1));
  const times = [...presetTimes]; while (times.length < count) times.push('');
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const slot = document.createElement('div'); slot.className = 'habit-time-slot'; slot.dataset.slot = String(i);
    slot.innerHTML = `<select class="habit-time-period" onchange="toggleSpecificTime(this)"><option value="">No time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option><option value="specific">Specific time</option></select><input class="habit-time" type="time" style="display:none;" />`;
    const raw = times[i] || '';
    const periodEl = slot.querySelector('.habit-time-period'), timeEl = slot.querySelector('.habit-time');
    if (raw === 'morning' || raw === 'afternoon' || raw === 'evening' || raw === '') { periodEl.value = raw; timeEl.style.display = 'none'; timeEl.value = ''; }
    else { periodEl.value = 'specific'; timeEl.style.display = 'block'; timeEl.value = raw; }
    container.appendChild(slot);
  }
}

// ─────────────────────────────────────────────
//  TODO TIME SLOT HELPERS (mirrors habit slots)
// ─────────────────────────────────────────────
function renderTodoTimeSlots(slotCount, presetTimes = []) {
  const container = document.querySelector('.todo-time-slots'); if (!container) return;
  const count = Math.max(1, Math.min(10, parseInt(slotCount, 10) || 1));
  const times = [...presetTimes]; while (times.length < count) times.push('');
  container.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const slot = document.createElement('div'); slot.className = 'habit-time-slot'; slot.dataset.slot = String(i);
    slot.innerHTML = `<select class="habit-time-period" onchange="toggleSpecificTime(this)"><option value="">No time</option><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option><option value="specific">Specific time</option></select><input class="habit-time" type="time" style="display:none;" />`;
    const raw = times[i] || '';
    const periodEl = slot.querySelector('.habit-time-period'), timeEl = slot.querySelector('.habit-time');
    if (raw === 'morning' || raw === 'afternoon' || raw === 'evening' || raw === '') { periodEl.value = raw; timeEl.style.display = 'none'; timeEl.value = ''; }
    else { periodEl.value = 'specific'; timeEl.style.display = 'block'; timeEl.value = raw; }
    container.appendChild(slot);
  }
}

function readTodoTimeSlots() {
  return [...document.querySelectorAll('.todo-time-slots .habit-time-slot')].map(s => {
    const period = s.querySelector('.habit-time-period')?.value || '';
    const t = s.querySelector('.habit-time')?.value || '';
    if (!period) return '';
    return period === 'specific' ? (t || '') : period;
  });
}

function getTodoTimeValue() {
  const slots = readTodoTimeSlots();
  if (slots.length === 0) return null;
  if (slots.length === 1) return slots[0] || null;
  return JSON.stringify(slots);
}

function setTodoTimeValue(timeToken) {
  const times = parseHabitScheduledTimes(timeToken);
  const tc = parseInt(document.getElementById('todo-target')?.value) || 1;
  renderTodoTimeSlots(Math.max(tc, times.length || 0), times);
}

// ─────────────────────────────────────────────
//  STEPPER BUTTONS
// ─────────────────────────────────────────────
function stepHabitTarget(delta) {
  const input = document.getElementById('habit-target');
  const next = Math.max(1, Math.min(10, (parseInt(input.value) || 1) + delta));
  input.value = next;
  document.getElementById('habit-target-display').textContent = next + '×';
  renderHabitTimeSlots(next, readHabitTimeSlots());
  haptic([10]);
}

function stepTodoTarget(delta) {
  const input = document.getElementById('todo-target');
  const next = Math.max(1, Math.min(10, (parseInt(input.value) || 1) + delta));
  input.value = next;
  document.getElementById('todo-target-display').textContent = next + '×';
  renderTodoTimeSlots(next, readTodoTimeSlots());
  haptic([10]);
}

// ─────────────────────────────────────────────
//  MODAL INLINE CALENDAR
// ─────────────────────────────────────────────
const _modalCalState = {};

function renderModalCal(containerId, inputId, selectedDateStr) {
  const wrap = document.getElementById(containerId); if (!wrap) return;
  const key = containerId;
  if (!_modalCalState[key]) {
    const base = selectedDateStr || todayStr();
    const d = new Date(base + 'T00:00:00');
    _modalCalState[key] = { year: d.getFullYear(), month: d.getMonth() };
  }
  const { year, month } = _modalCalState[key];
  const selected = document.getElementById(inputId)?.value || '';
  const today = todayStr();
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let html = `<div class="mcal"><div class="mcal-nav"><button type="button" class="mcal-nav-btn" onclick="_modalCalPrev('${containerId}','${inputId}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span class="mcal-month-label">${MONTHS[month]} ${year}</span><button type="button" class="mcal-nav-btn" onclick="_modalCalNext('${containerId}','${inputId}')"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div><div class="mcal-weekdays"><span>Su</span><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span></div><div class="mcal-grid">`;
  for (let i = 0; i < firstDay; i++) html += `<div class="mcal-cell empty"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const dStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    html += `<div class="mcal-cell${dStr===today?' mcal-today':''}${dStr===selected?' mcal-selected':''}" onclick="_modalCalPick('${containerId}','${inputId}','${dStr}')">${d}</div>`;
  }
  html += `</div></div>`;
  wrap.innerHTML = html;
}

function _modalCalPrev(containerId, inputId) {
  const s = _modalCalState[containerId]; if (!s) return;
  s.month--; if (s.month < 0) { s.month = 11; s.year--; }
  renderModalCal(containerId, inputId); haptic([10]);
}
function _modalCalNext(containerId, inputId) {
  const s = _modalCalState[containerId]; if (!s) return;
  s.month++; if (s.month > 11) { s.month = 0; s.year++; }
  renderModalCal(containerId, inputId); haptic([10]);
}
function _modalCalPick(containerId, inputId, dateStr) {
  const input = document.getElementById(inputId); if (input) input.value = dateStr;
  renderModalCal(containerId, inputId, dateStr); haptic([15]);
}
window._modalCalPrev = _modalCalPrev;
window._modalCalNext = _modalCalNext;
window._modalCalPick = _modalCalPick;

// ─────────────────────────────────────────────
//  "WHEN" SELECTOR
// ─────────────────────────────────────────────
function setWhenOption(when, skipCalRender = false) {
  const dueGroup      = document.getElementById('due-date-group');
  const deadlineGroup = document.getElementById('deadline-group');
  const timeGroup     = document.getElementById('todo-time-group');
  const dueInput      = document.getElementById('todo-due');
  document.querySelectorAll('.when-option').forEach(opt => opt.classList.remove('active'));
  document.querySelector(`.when-option[data-when="${when}"]`).classList.add('active');
  if (when === 'today') {
    dueGroup.style.display = 'none'; deadlineGroup.style.display = 'none'; timeGroup.style.display = 'block';
    dueInput.value = todayStr();
  } else if (when === 'scheduled') {
    dueGroup.style.display = 'block'; deadlineGroup.style.display = 'none'; timeGroup.style.display = 'block';
    if (!dueInput.value) dueInput.value = getActiveDateStr();
    if (!skipCalRender) { delete _modalCalState['modal-cal-due']; renderModalCal('modal-cal-due', 'todo-due', dueInput.value || getActiveDateStr()); }
  } else {
    dueGroup.style.display = 'none'; deadlineGroup.style.display = 'block'; timeGroup.style.display = 'none';
    if (!skipCalRender) { const dlVal = document.getElementById('todo-deadline').value; delete _modalCalState['modal-cal-deadline']; renderModalCal('modal-cal-deadline', 'todo-deadline', dlVal || todayStr()); }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('when-selector');
  if (container) {
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.when-option');
      if (btn) { const when = btn.dataset.when; if (when) setWhenOption(when); }
    });
  }
});

// ─────────────────────────────────────────────
//  CHOICE MODAL
// ─────────────────────────────────────────────
function openChoiceModal()       { document.getElementById('choice-modal').classList.add('open'); haptic([15]); }
function closeChoiceModal()      { document.getElementById('choice-modal').classList.remove('open'); }
function closeChoiceOnBackdrop(e){ if (e.target === document.getElementById('choice-modal')) closeChoiceModal(); }