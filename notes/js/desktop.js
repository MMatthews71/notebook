// ─────────────────────────────────────────────
//  DESKTOP SIDE PANEL
// ─────────────────────────────────────────────

function togglePanelEditMode() {
  const panel = document.getElementById('side-panel');
  const btn = document.getElementById('panel-edit-btn');
  if (!panel) return;
  panel.classList.toggle('edit-mode');
  if (btn) btn.classList.toggle('active', panel.classList.contains('edit-mode'));
}
window.togglePanelEditMode = togglePanelEditMode;

let panelOpen = true;
let activeJournalEntryId = null;
let activeNotesDocId = null;       // legacy (kept for mobile compat)
let activeNotesEntryId = null;     // desktop notes entry (like journal)
let mainView = 'goals'; // 'notes', 'goals', 'nutrition', 'finance'
window.mainView = mainView;
let _notesSubview = 'notes'; // 'notes' | 'journal'
let notesEntrySaveTimeout = null;

// In-memory cache — populated by initApp, kept in sync
let _journalEntriesCache = [];
let _notesEntriesCache = [];
let pastFoodLogs = [];

function getJournalEntries() { return _journalEntriesCache; }
function saveJournalEntries(arr) { _journalEntriesCache = arr; }

function getNotesEntries() { return _notesEntriesCache; }
function saveNotesEntries(arr) { _notesEntriesCache = arr; }

// Called from init.js to seed the notes entries cache from DB rows
window.initNotesEntries = function(rows) {
  _notesEntriesCache = (rows || []).map(r => ({
    id: r.id,
    content: r.content || '',
    title: r.title || '',
    created_at: r.created_at || r.updated_at || new Date().toISOString(),
  }));
  _notesEntriesCache.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
};

function isDesktop() {
  return window.matchMedia('(min-width: 768px)').matches;
}

// FIX: Expose a synchronous getter so journal.js can read the in-memory activeNotesDocId
// without async DB calls, eliminating the race in updateActiveNotesDocContent.
window._getDesktopActiveNotesDocId = function() {
  return activeNotesDocId;
};

// FIX: Expose a synchronous setter so journal.js can update this variable
// immediately (before any async work) when switching notes docs.
// This ensures the textarea input handler always targets the correct doc.
window.setActiveNotesDocIdInMemory = function(id) {
  activeNotesDocId = id;
  activeJournalEntryId = null;
  activeNotesEntryId = null;  // prevent stale entry ID intercepting saves after a doc switch
};

// ── MAIN VIEW TOGGLE ─────────────────────────
function setMainView(view) {
  if (!isDesktop()) return;
  flushPendingSaves();                     // save any pending changes

  // Clear the editor immediately to prevent visual carry-over
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) notesArea.innerHTML = '';

  // Reset both active IDs – we'll set the correct one in applyMainView
  activeJournalEntryId = null;
  activeNotesDocId = null;

  mainView = view;
  window.mainView = view;
  // Sync currentTab for compatibility with render logic
  if (view === 'goals') currentTab = 'goals';
  else if (view === 'nutrition') currentTab = 'nutrition';
  else if (view === 'finance') currentTab = 'finance';
  else currentTab = 'notes';

  document.querySelectorAll('.view-toggle-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`desktop-${view}-toggle-btn`).classList.add('active');
  applyMainView();
  haptic([15]);
}
window.setMainView = setMainView;

function switchNotesView(sub) {
  if (!isDesktop()) return;
  flushPendingSaves();
  _notesSubview = sub;
  const notesArea = document.getElementById('notes-textarea');

  if (sub === 'journal') {
    const journalSection = document.getElementById('journal-section');
    if (journalSection) journalSection.style.display = 'none';
    // Clear notes entry state so no carryover
    activeNotesEntryId = null;
    if (notesArea) {
      notesArea.setAttribute('data-placeholder', 'Select or create a journal entry');
      loadActiveJournalEntryToTextarea();
    }
    hideJournalDrawer();
  } else {
    // Clear journal state so no carryover
    activeJournalEntryId = null;
    if (notesArea) {
      notesArea.setAttribute('data-placeholder', 'Select or create a note');
      loadActiveNotesEntryToTextarea();
    }
  }
  renderPanelForView('notes');
  haptic([10]);
}
window.switchNotesView = switchNotesView;

function applyMainView() {
  if (!isDesktop()) return;
  const notesTab = document.getElementById('tab-notes');
  const goalsTab = document.getElementById('tab-goals');
  const journalTab = document.getElementById('tab-journal');
  const mainEl = document.querySelector('#desktop-notes-area .main');
  const fab = document.getElementById('fab');
  const notesArea = document.getElementById('notes-textarea');

  const nutritionTab = document.getElementById('tab-nutrition');
  const financeTab   = document.getElementById('tab-finance');

  // Hide all main views
  if (notesTab) notesTab.style.display = 'none';
  if (goalsTab) goalsTab.style.display = 'none';
  if (journalTab) journalTab.style.display = 'none';
  if (nutritionTab) nutritionTab.style.display = 'none';
  if (financeTab) financeTab.style.display = 'none';
  if (mainEl) mainEl.classList.remove('goals-active', 'notes-active', 'journal-active');

  if (mainView === 'goals') {
    if (goalsTab) {
      goalsTab.style.display = 'block';
      const goalsList = document.getElementById('goals-list');
      const goalsContainer = document.getElementById('goals-container');
      if (goalsList) goalsList.style.display = 'flex';
      if (goalsContainer) {
        goalsContainer.style.height = '100%';
        // Force reflow
        goalsContainer.offsetHeight;
      }
      // Force layout recalculation
      goalsTab.offsetHeight;
      graphUserInteracted = false;
      graphAutoFitPending = true;
      renderGoals();
      requestAnimationFrame(() => {
        const wrap = document.getElementById('goal-graph-wrap');
        if (wrap) autoFitAndCenterGraph(wrap);
      });
    }
    if (mainEl) mainEl.classList.add('goals-active');
    if (fab) fab.style.display = 'none';
    renderPanelForView('todo');

  } else if (mainView === 'nutrition') {
    // ── NUTRITION ────────────────────────────
    if (nutritionTab) nutritionTab.style.display = 'block';
    if (mainEl) mainEl.classList.add('notes-active');
    if (fab) fab.style.display = '';
    hideJournalDrawer();
    renderPanelForView('nutrition');
    if (typeof renderNutritionTab === 'function') renderNutritionTab();

  } else if (mainView === 'finance') {
    // ── FINANCE ──────────────────────────────
    if (financeTab) financeTab.style.display = 'block';
    if (mainEl) mainEl.classList.add('notes-active');
    if (fab) fab.style.display = '';
    hideJournalDrawer();
    renderPanelForView('finance');
    if (typeof renderFinanceTab === 'function') renderFinanceTab();

  } else { // notes (includes journal sub-view)
    if (notesTab) { notesTab.style.display = 'flex'; notesTab.style.flexDirection = 'column'; }
    if (mainEl) mainEl.classList.add('notes-active');
    hideJournalDrawer();

    if (_notesSubview === 'journal') {
      // ── JOURNAL sub-view ─────────────────
      const journalSection = document.getElementById('journal-section');
      if (journalSection) journalSection.style.display = 'none';
      activeNotesEntryId = null;
      if (notesArea) {
        notesArea.style.display = 'block';
        notesArea.setAttribute('data-placeholder', 'Select or create a journal entry');
        loadActiveJournalEntryToTextarea();
      }
      if (fab) fab.style.display = 'none';
    } else {
      // ── NOTES sub-view ───────────────────
      activeJournalEntryId = null;
      if (notesArea) {
        notesArea.style.display = 'block';
        notesArea.setAttribute('data-placeholder', 'Select or create a note');
        loadActiveNotesEntryToTextarea();
      }
      if (fab) fab.style.display = '';
    }
    renderPanelForView('notes');
  }
}

// ── PANEL DATE NAVIGATOR ─────────────────────
function renderPanelDateNavigator() {
  const container = document.getElementById('panel-date-navigator');
  if (!container) return;

  const activeDateStr = getActiveDateStr();
  const todayStrVal = todayStr();
  let prefix = '';
  if (activeDateStr === todayStrVal) prefix = 'Today, ';
  else {
    const diff = Math.round((new Date(activeDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000);
    if (diff === 1) prefix = 'Tomorrow, ';
    else if (diff === -1) prefix = 'Yesterday, ';
  }
  const displayDate = activeDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  container.innerHTML = `
    <button class="nav-btn" onclick="offsetActiveDate(-1); renderPanelDateNavigator();" aria-label="Previous day">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M15 18l-6-6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <span class="header-date" onclick="toggleCalendarView(); renderPanelDateNavigator();" title="Open Calendar">${prefix}${displayDate}</span>
    <button class="nav-btn" onclick="offsetActiveDate(1); renderPanelDateNavigator();" aria-label="Next day">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 18l6-6-6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  `;

  // Highlight if calendar is open
  if (isCalendarView) {
    container.querySelector('.header-date').classList.add('active');
  }
}

// ── PANEL CONTENT RENDERER ───────────────────
function renderPanelForView(view) {
  const sidePanel = document.getElementById('side-panel');
  if (sidePanel) {
    sidePanel.classList.toggle('view-todo', view === 'todo');
  }

  const panelTitle = document.getElementById('panel-title');
  const todoCont = document.getElementById('panel-todo-content');
  const journalCont = document.getElementById('panel-journal-content');
  const notesCont = document.getElementById('panel-notes-content');
  const nutritionCont = document.getElementById('panel-nutrition-content');
  const calendarCont = document.getElementById('panel-calendar-content');
  const financeCont  = document.getElementById('panel-finance-content');
  const dateNav = document.getElementById('panel-date-navigator');

  // Hide all panel content
  if (todoCont) todoCont.style.display = 'none';
  if (journalCont) journalCont.style.display = 'none';
  if (notesCont) notesCont.style.display = 'none';
  if (nutritionCont) nutritionCont.style.display = 'none';
  if (calendarCont) calendarCont.style.display = 'none';
  if (financeCont) financeCont.style.display = 'none';

  // Calendar sidebar mode — date nav moves into the panel topbar
  if (view === 'calendar') {
    if (panelTitle) panelTitle.textContent = '';
    if (dateNav) {
      dateNav.style.display = 'flex';
      if (typeof renderPanelCalendarDateNav === 'function') renderPanelCalendarDateNav();
    }
    if (calendarCont) {
      calendarCont.style.display = 'block';
      if (typeof renderCalendarSidebar === 'function') renderCalendarSidebar();
    }
    return;
  }

  // Hide date navigator by default
  if (dateNav) dateNav.style.display = 'none';

  // Handle fraction element in panel header
  const headerRight = document.getElementById('side-panel-actions');
  let fractionEl = document.getElementById('panel-task-fraction');

  // Reset edit mode on view change
  document.getElementById('side-panel')?.classList.remove('edit-mode');

  // ── Shared cleanup: reset header elements not used by every view ──
  // Hide rest-day button (only shown in todo view)
  const existingRdBtn = document.getElementById('panel-rest-day-btn');
  if (existingRdBtn) existingRdBtn.style.display = 'none';
  // Clear any notes sub-tabs from the title slot
  if (panelTitle) { panelTitle.style.cssText = ''; panelTitle.textContent = ''; }

  if (view === 'todo') {
    // Date navigator replaces the title — no separate label needed
    if (dateNav) {
      dateNav.style.display = 'flex';
      renderPanelDateNavigator();
    }
    if (todoCont) {
      todoCont.style.display = 'block';
      const origTodo = document.getElementById('tab-todo');
      if (origTodo) {
        if (origTodo.parentElement !== todoCont) todoCont.appendChild(origTodo);
        origTodo.style.display = 'block';
        const todoWrap = document.getElementById('todo-content-wrap');
        if (todoWrap) todoWrap.style.display = 'block';
        renderTodo();
      }
    }

    // ── Rest day button in the header actions ──
    let rdBtn = document.getElementById('panel-rest-day-btn');
    if (!rdBtn) {
      rdBtn = document.createElement('button');
      rdBtn.id = 'panel-rest-day-btn';
      rdBtn.className = 'panel-action-btn';
      rdBtn.title = 'Toggle rest day';
      rdBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
      rdBtn.addEventListener('click', () => {
        if (typeof toggleRestDay === 'function' && typeof getActiveDateStr === 'function') {
          toggleRestDay(getActiveDateStr());
          // Sync active state after toggle
          setTimeout(() => {
            const active = typeof isRestDay === 'function' && isRestDay(getActiveDateStr());
            rdBtn.classList.toggle('active', active);
          }, 50);
        }
      });
      const addBtn = document.getElementById('panel-add-btn');
      if (addBtn) headerRight.insertBefore(rdBtn, addBtn);
      else headerRight.appendChild(rdBtn);
    }
    // Sync active state with current date
    const rdActive = typeof isRestDay === 'function' && typeof getActiveDateStr === 'function' && isRestDay(getActiveDateStr());
    rdBtn.classList.toggle('active', rdActive);
    rdBtn.style.display = '';

    // Create fraction element if not exists
    if (!fractionEl) {
      fractionEl = document.createElement('span');
      fractionEl.id = 'panel-task-fraction';
      fractionEl.className = 'panel-task-fraction';
      const addBtn = document.getElementById('panel-add-btn');
      if (headerRight && addBtn) headerRight.insertBefore(fractionEl, addBtn);
      else if (headerRight) headerRight.appendChild(fractionEl);
    }
    fractionEl.style.display = 'inline-block';
    updatePanelTaskFraction();

  } else {
    // Hide fraction for other views
    if (fractionEl) fractionEl.style.display = 'none';

    if (view === 'finance') {
      if (financeCont) {
        financeCont.style.display = 'block';
        if (typeof renderPanelFinance === 'function') renderPanelFinance();
      }
    } else if (view === 'nutrition') {
      if (panelTitle) panelTitle.textContent = 'Food Log';
      if (nutritionCont) {
        nutritionCont.style.display = 'block';
        renderPanelNutrition();
        loadPastFoodLogs();
      }
    } else if (view === 'notes') {
      // ── Notes/Journal sub-tabs live in the header title slot ──
      if (panelTitle) {
        const sub = _notesSubview;
        panelTitle.style.cssText = 'display:flex;gap:3px;flex:1;min-width:0;';
        panelTitle.innerHTML = `
          <button class="panel-hdr-tab${sub === 'notes' ? ' active' : ''}" onclick="switchNotesView('notes')">Notes</button>
          <button class="panel-hdr-tab${sub === 'journal' ? ' active' : ''}" onclick="switchNotesView('journal')">Journal</button>`;
      }
      if (notesCont) {
        notesCont.style.display = 'block';
        const sub = _notesSubview;
        // Sub-tabs are in the header — body has only the lists
        notesCont.innerHTML = `
          <div id="panel-notes-current" style="${sub !== 'notes' ? 'display:none' : ''}"></div>
          <div id="panel-journal-entries" style="${sub !== 'journal' ? 'display:none' : ''}"></div>`;
        if (sub === 'notes') refreshPanelNotes();
        else refreshPanelJournalEntries();
      }
    }
  }
}

function _renderPncMealGroups(logs, deletable) {
  const mealOrder = ['breakfast', 'lunch', 'dinner', 'snack'];
  const byMeal = {};
  logs.forEach(function(f) {
    const m = (f.meal_type || 'other').toLowerCase();
    if (!byMeal[m]) byMeal[m] = [];
    byMeal[m].push(f);
  });
  const keys = [...mealOrder.filter(function(m) { return byMeal[m]; }),
                ...Object.keys(byMeal).filter(function(m) { return !mealOrder.includes(m) && byMeal[m]; })];
  let html = '';
  keys.forEach(function(meal) {
    const items = byMeal[meal];
    const mealCals = Math.round(items.reduce(function(s, f) { return s + (f.calories || 0); }, 0));
    html += `<div class="pnc-meal-group">
      <div class="pnc-meal-label">${meal.toUpperCase()} <span class="pnc-meal-cals">${mealCals} kcal</span></div>`;
    items.forEach(function(f) {
      const p = f.protein_g || 0, c = f.carbs_g || 0, ft = f.fat_g || 0;
      const macroLine = [p ? `${p}g P` : '', c ? `${c}g C` : '', ft ? `${ft}g F` : ''].filter(Boolean).join(' · ');
      const cals = Math.round(f.calories || 0);
      html += `<div class="pnc-food-row">
        <div class="pnc-food-info">
          <span class="pnc-food-name">${f.food_name || ''}</span>
          ${macroLine ? `<span class="pnc-food-macros">${macroLine}</span>` : ''}
        </div>
        <div class="pnc-food-right">
          <span class="pnc-food-cals">${cals}</span>
          ${deletable ? `<button class="pnc-food-del" onclick="panelDeleteFood('${f.id}')" title="Remove">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
          </button>` : ''}
        </div>
      </div>`;
    });
    html += `</div>`;
  });
  return html;
}

function _formatPastDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const todayD = new Date();
  const yest = new Date(todayD.getFullYear(), todayD.getMonth(), todayD.getDate() - 1);
  if (date.toDateString() === yest.toDateString()) return 'Yesterday';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

async function loadPastFoodLogs() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  const since = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  pastFoodLogs = await supabase.getFoodLogsPast(since);
  renderPanelNutrition();
}

function renderPanelNutrition() {
  const cont = document.getElementById('panel-nutrition-content');
  if (!cont) return;

  const logs = (typeof todayFoodLogs !== 'undefined' ? todayFoodLogs : []);
  const targets = (typeof nutritionTargets !== 'undefined' ? nutritionTargets : null);
  const totalCals = Math.round(logs.reduce((s, f) => s + (f.calories || 0), 0));
  const targetCals = targets ? targets.calories : 0;
  const pct = targetCals > 0 ? Math.min(100, Math.round(totalCals / targetCals * 100)) : 0;
  const over = targetCals > 0 && totalCals > targetCals;

  let html = `<div class="pnc-summary">
    <div class="pnc-cals">
      <span class="pnc-cals-eaten${over ? ' over' : ''}">${totalCals}</span>
      <span class="pnc-cals-sep"> / ${targetCals} kcal</span>
    </div>
    <div class="pnc-bar-track"><div class="pnc-bar-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>
  </div>`;

  if (logs.length === 0) {
    html += `<div class="pnc-empty">No food logged today.<br>Hit + to add a meal.</div>`;
  } else {
    html += _renderPncMealGroups(logs, true);
  }

  // Past days
  if (pastFoodLogs.length > 0) {
    // Group by date
    const byDate = {};
    pastFoodLogs.forEach(function(f) {
      if (!byDate[f.date]) byDate[f.date] = [];
      byDate[f.date].push(f);
    });
    const dates = Object.keys(byDate).sort().reverse();

    html += `<div class="pnc-past-divider">Past Days</div>`;
    dates.forEach(function(dateStr) {
      const dayLogs = byDate[dateStr];
      const dayCals = Math.round(dayLogs.reduce(function(s, f) { return s + (f.calories || 0); }, 0));
      html += `<div class="pnc-day-section">
        <div class="pnc-day-header">
          <span class="pnc-day-label">${_formatPastDate(dateStr)}</span>
          <span class="pnc-day-cals">${dayCals} kcal</span>
        </div>
        ${_renderPncMealGroups(dayLogs, true)}
      </div>`;
    });
  }

  cont.innerHTML = html;
}
window.renderPanelNutrition = renderPanelNutrition;

function panelDeleteFood(id) {
  if (typeof deleteFoodLog === 'function') deleteFoodLog(id);
}
window.panelDeleteFood = panelDeleteFood;

// ── PANEL OPEN / CLOSE ──────────────────────
function toggleSidePanel() { panelOpen = !panelOpen; applyPanelState(); }

async function applyPanelState() {
  const panel = document.getElementById('side-panel');
  const toggleBtn = document.getElementById('panel-toggle-btn');
  if (!panel) return;
  if (panelOpen) {
    panel.classList.add('open');
    const currentWidth = parseInt(panel.style.getPropertyValue('--panel-width')) || 360;
    if (currentWidth < 360) {
      panel.style.setProperty('--panel-width', '360px');
      await supabase.setPref('panel_width', '360');
    }
    if (toggleBtn) toggleBtn.querySelector('svg path').setAttribute('d', 'M3 1L7 5L3 9');
    renderPanelForView(mainView === 'goals' ? 'todo' : mainView === 'journal' ? 'journal' : mainView);
  } else {
    panel.classList.remove('open');
    if (toggleBtn) toggleBtn.querySelector('svg path').setAttribute('d', 'M7 1L3 5L7 9');
  }
  updateToggleBtnPosition();
}

async function updateToggleBtnPosition() {
  const panel = document.getElementById('side-panel');
  const toggleBtn = document.getElementById('panel-toggle-btn');
  if (!panel || !toggleBtn || !isDesktop()) return;
  if (panelOpen) {
    const savedWidth = await supabase.getPref('panel_width');
    const w = parseInt(panel.style.getPropertyValue('--panel-width')) || parseInt(savedWidth) || 360;
    toggleBtn.style.right = w + 'px';
  } else {
    toggleBtn.style.right = '0px';
  }
}

// ── PANEL JOURNAL ENTRIES ────────────────────
function refreshPanelJournalEntries() {
  const container = document.getElementById('panel-journal-entries');
  if (!container) return;
  const allEntries = getJournalEntries();
  allEntries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  if (allEntries.length === 0) {
    container.innerHTML = `<div class="journal-empty">No journal entries yet. Click + to add one.</div>`;
    return;
  }
  container.innerHTML = '';
  allEntries.forEach(entry => {
    const date = new Date(entry.created_at);
    const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const content = entry.content || '';
    const isActive = entry.id === activeJournalEntryId;

    const row = document.createElement('div');
    row.className = 'todo-item-row panel-journal-row';
    row.setAttribute('data-type', 'journal');
    row.setAttribute('data-id', entry.id);
    row.style.cursor = 'pointer';
    row.innerHTML = `
      <button class="todo-delete-btn">✕</button>
      <div class="todo-item-icon">📓</div>
      <div class="todo-item-body" style="flex:1;">
        <span class="todo-item-name">${timeStr}</span>
        <div class="todo-item-meta" style="font-size:13px;color:var(--text-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${content.substring(0, 100)}${content.length > 100 ? '...' : ''}</div>
      </div>
      ${isActive ? '<span style="color:var(--mint);font-size:12px;margin-left:8px;">✓</span>' : ''}
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      loadJournalEntryToNotes(entry.id, content);
    });

    const delBtn = row.querySelector('.todo-delete-btn');
    if (delBtn) delBtn.addEventListener('click', (e) => { e.stopPropagation(); deletePanelJournalEntry(entry.id); });

    container.appendChild(row);
  });
}

// ── PANEL NOTES ENTRIES (mirrors journal, with rename) ────
function refreshPanelNotes() {
  const container = document.getElementById('panel-notes-current');
  if (!container) return;
  const allEntries = getNotesEntries();
  if (allEntries.length === 0) {
    container.innerHTML = `<div class="journal-empty">No notes yet. Click + to add one.</div>`;
    return;
  }
  container.innerHTML = '';
  allEntries.forEach(entry => {
    const date = new Date(entry.created_at);
    const timeStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      + ' · ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

    // Strip HTML for content preview
    const tmp = document.createElement('div');
    tmp.innerHTML = entry.content || '';
    const plain = (tmp.textContent || '').trim();
    const preview = escHtml(plain.substring(0, 80) + (plain.length > 80 ? '…' : ''));

    // Title line: custom title or timestamp fallback
    const displayTitle = escHtml(entry.title || timeStr);
    // Meta line: if titled, show timestamp + preview; else just preview
    const metaLine = entry.title
      ? escHtml(timeStr) + (preview ? ' · ' + preview : '')
      : (preview || '<em style="opacity:.45">Empty note</em>');

    const isActive = entry.id === activeNotesEntryId;

    const row = document.createElement('div');
    row.className = 'todo-item-row panel-note-row';
    row.setAttribute('data-type', 'note');
    row.setAttribute('data-id', entry.id);
    row.style.cursor = 'pointer';
    row.innerHTML = `
      <button class="todo-delete-btn" title="Delete">✕</button>
      <div class="todo-item-icon">📝</div>
      <div class="todo-item-body" style="flex:1;min-width:0;">
        <div class="note-title-row">
          <span class="todo-item-name note-entry-title">${displayTitle}</span>
          <button class="note-rename-btn" title="Rename">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </button>
        </div>
        <div class="todo-item-meta">${metaLine}</div>
      </div>
      ${isActive ? '<span style="color:var(--mint);font-size:11px;margin-left:4px;flex-shrink:0;">✓</span>' : ''}
    `;

    // Click row → load entry
    row.addEventListener('click', (e) => {
      if (e.target.closest('button') || e.target.closest('.note-rename-btn')) return;
      loadNotesEntryToTextarea(entry.id, entry.content || '');
    });

    // Delete button
    const delBtn = row.querySelector('.todo-delete-btn');
    if (delBtn) delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePanelNotesEntry(entry.id);
    });

    // Rename button → inline edit
    const renameBtn = row.querySelector('.note-rename-btn');
    if (renameBtn) renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startRenameNotesEntry(entry.id, entry.title || '', row);
    });

    container.appendChild(row);
  });
}
window.refreshPanelNotes = refreshPanelNotes;

// ── INLINE RENAME ──────────────────────────
function startRenameNotesEntry(id, currentTitle, row) {
  const titleEl = row.querySelector('.note-entry-title');
  const renameBtn = row.querySelector('.note-rename-btn');
  if (!titleEl) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentTitle;
  input.placeholder = 'Note title…';
  input.className = 'note-rename-input';
  input.addEventListener('click', e => e.stopPropagation());

  titleEl.replaceWith(input);
  if (renameBtn) renameBtn.style.display = 'none';
  input.focus();
  input.select();

  const commit = async () => {
    const newTitle = input.value.trim();
    await saveNotesEntryTitle(id, newTitle);
    // Full re-render to restore proper DOM
    refreshPanelNotes();
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') {
      input.removeEventListener('blur', commit);
      refreshPanelNotes(); // cancel — restore
    }
  });
}

async function saveNotesEntryTitle(id, title) {
  const entries = getNotesEntries();
  const entry = entries.find(e => e.id === id);
  if (!entry) return;
  entry.title = title;
  saveNotesEntries(entries);
  try { await supabase.from('notes').update({ title }).eq('id', id); }
  catch (e) { console.error('[saveNotesEntryTitle]', e); }
}

// ── LOAD CONTENT INTO TEXTAREA ───────────────

// Load a notes entry (new journal-style flow)
function loadNotesEntryToTextarea(entryId, content) {
  flushPendingSaves();
  activeNotesEntryId = entryId;
  activeJournalEntryId = null;
  activeNotesDocId = null;
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.innerHTML = content;
    notesArea.setAttribute('data-placeholder', 'Write your note…');
    refreshPanelNotes();
  }
}
window.loadNotesEntryToTextarea = loadNotesEntryToTextarea;

// Load whatever note entry was last active (on sub-view switch)
function loadActiveNotesEntryToTextarea() {
  const notesArea = document.getElementById('notes-textarea');
  if (!notesArea) return;
  if (activeNotesEntryId) {
    const entry = getNotesEntries().find(e => e.id === activeNotesEntryId);
    if (entry) { notesArea.innerHTML = entry.content || ''; return; }
    activeNotesEntryId = null;
  }
  notesArea.innerHTML = '';
  notesArea.setAttribute('data-placeholder', 'Select or create a note');
}

// Legacy — kept so mobile journal.js code still compiles
async function loadNotesDocToTextarea(docId, content) {
  loadNotesEntryToTextarea(docId, content);
}
window.loadNotesDocToTextarea = loadNotesDocToTextarea;

// ── CREATE BLANK NOTE ENTRY ──────────────────
async function createAndLoadBlankNotesEntry() {
  const now = new Date().toISOString();
  const newEntry = { id: crypto.randomUUID(), content: '', title: '', created_at: now };
  const entries = getNotesEntries();
  entries.unshift(newEntry);
  saveNotesEntries(entries);
  refreshPanelNotes();
  loadNotesEntryToTextarea(newEntry.id, '');
  try {
    await supabase.from('notes').insert([{
      id: newEntry.id, content: '', title: '',
      created_at: now, updated_at: now,
    }]);
  } catch (e) { console.error('[createAndLoadBlankNotesEntry]', e); }
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) notesArea.focus();
}
window.createAndLoadBlankNotesEntry = createAndLoadBlankNotesEntry;

// ── SAVE NOTE ENTRY ──────────────────────────
async function _desktopSaveNotesEntry(content) {
  if (!activeNotesEntryId) return;
  const entries = getNotesEntries();
  const entry = entries.find(e => e.id === activeNotesEntryId);
  if (entry) {
    entry.content = content;
    saveNotesEntries(entries);
    refreshPanelNotes();
    try { await supabase.from('notes').update({ content, updated_at: new Date().toISOString() }).eq('id', activeNotesEntryId); }
    catch (e) { console.error('[_desktopSaveNotesEntry]', e); }
  }
}

function scheduleNotesEntrySave(content) {
  if (!activeNotesEntryId) return;
  clearTimeout(notesEntrySaveTimeout);
  notesEntrySaveTimeout = setTimeout(() => _desktopSaveNotesEntry(content), 1000);
}

// ── DELETE NOTE ENTRY ────────────────────────
async function deletePanelNotesEntry(id) {
  flushPendingSaves();
  const filtered = getNotesEntries().filter(e => e.id !== id);
  saveNotesEntries(filtered);
  if (activeNotesEntryId === id) {
    activeNotesEntryId = null;
    const notesArea = document.getElementById('notes-textarea');
    if (notesArea) { notesArea.innerHTML = ''; notesArea.setAttribute('data-placeholder', 'Select or create a note'); }
  }
  refreshPanelNotes();
  try { await supabase.from('notes').eq('id', id).delete(); showToast('Note deleted'); }
  catch (e) { showToast('Note deleted locally'); }
}
window.deletePanelNotesEntry = deletePanelNotesEntry;

function loadJournalEntryToNotes(entryId, content) {
  flushPendingSaves();
  activeJournalEntryId = entryId;
  activeNotesDocId = null;
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.textContent = content; // plain text — no HTML formatting in journal entries
    notesArea.setAttribute('data-placeholder', 'Write your journal entry...');
    refreshPanelJournalEntries();
  }
  // If in journal view, ensure the editor is visible
  if (mainView === 'journal') {
    const notesTab = document.getElementById('tab-notes');
    if (notesTab) notesTab.style.display = 'flex';
  }
}
window.loadJournalEntryToNotes = loadJournalEntryToNotes;

function loadActiveJournalEntryToTextarea() {
  const notesArea = document.getElementById('notes-textarea');
  if (!notesArea) return;

  if (activeJournalEntryId) {
    const entries = getJournalEntries();
    const entry = entries.find(e => e.id === activeJournalEntryId);
    if (entry) {
      notesArea.textContent = entry.content || '';
      notesArea.setAttribute('data-placeholder', 'Write your journal entry...');
    } else {
      activeJournalEntryId = null;
      notesArea.textContent = '';
      notesArea.setAttribute('data-placeholder', 'Select or create a journal entry');
    }
  } else {
    notesArea.textContent = '';
    notesArea.setAttribute('data-placeholder', 'Select or create a journal entry');
  }
}

// ── SAVE / DELETE HELPERS ────────────────────
let notesSaveTimeout = null;
function scheduleNotesDocSave(content) {
  if (!activeNotesDocId) return;
  clearTimeout(notesSaveTimeout);
  notesSaveTimeout = setTimeout(() => saveNotesDoc(content), 1000);
}
async function saveNotesDoc(content) {
  if (!activeNotesDocId) return;
  const docs = window._notesDocs || [];
  const doc = docs.find(d => d.id === activeNotesDocId);
  if (!doc) return;
  const now = new Date().toISOString();
  doc.content = content;
  doc.updated_at = now;
  window._notesDocs = docs;
  refreshPanelNotes();
  try {
    const { error } = await supabase.from('notes').eq('id', activeNotesDocId).update({ content, updated_at: now });
    if (error) console.error('[saveNotesDoc] update failed:', error);
  } catch (e) { console.error('[saveNotesDoc]', e); }
}

async function _desktopSaveJournalEntry(content) {
  if (!activeJournalEntryId) return;
  const entries = getJournalEntries();
  const entry = entries.find(e => e.id === activeJournalEntryId);
  if (entry) {
    entry.content = content;
    saveJournalEntries(entries);
    refreshPanelJournalEntries();
    try { await supabase.from('journal_entries').update({ content }).eq('id', activeJournalEntryId); } catch (e) {}
  }
}
let journalSaveTimeout = null;
function scheduleJournalSave(content) {
  if (!activeJournalEntryId) return;
  clearTimeout(journalSaveTimeout);
  journalSaveTimeout = setTimeout(() => _desktopSaveJournalEntry(content), 1000);
}

// flushPendingSaves — captures all active IDs synchronously, then persists.
// Three distinct save targets: notes entry, journal entry, legacy notes doc.
function flushPendingSaves() {
  clearTimeout(notesSaveTimeout);
  clearTimeout(notesEntrySaveTimeout);
  clearTimeout(journalSaveTimeout);
  notesSaveTimeout = null;
  notesEntrySaveTimeout = null;
  journalSaveTimeout = null;

  const notesArea = document.getElementById('notes-textarea');
  if (!notesArea) return;

  // Capture synchronously before any async work
  const capturedJournalId    = activeJournalEntryId;
  const capturedNotesEntryId = activeNotesEntryId;
  const capturedNotesDocId   = activeNotesDocId;   // legacy

  if (capturedJournalId) {
    const content = notesArea.innerText;            // journal = plain text
    const entries = getJournalEntries();
    const entry = entries.find(e => e.id === capturedJournalId);
    if (entry) {
      entry.content = content;
      saveJournalEntries(entries);
      if (typeof refreshPanelJournalEntries === 'function') refreshPanelJournalEntries();
      try { supabase.from('journal_entries').eq('id', capturedJournalId).update({ content }); } catch (e) {}
    }
  } else if (capturedNotesEntryId) {
    const content = notesArea.innerHTML;            // notes = rich text HTML
    const entries = getNotesEntries();
    const entry = entries.find(e => e.id === capturedNotesEntryId);
    if (entry) {
      entry.content = content;
      saveNotesEntries(entries);
      if (typeof refreshPanelNotes === 'function') refreshPanelNotes();
      try { supabase.from('notes').eq('id', capturedNotesEntryId).update({ content, updated_at: new Date().toISOString() }); } catch (e) {}
    }
  } else if (capturedNotesDocId) {
    // Legacy: mobile notes doc
    const content = notesArea.innerHTML;
    const docs = window._notesDocs || [];
    const doc = docs.find(d => d.id === capturedNotesDocId);
    if (doc) {
      const now = new Date().toISOString();
      doc.content = content; doc.updated_at = now;
      window._notesDocs = docs;
      try { supabase.from('notes').eq('id', capturedNotesDocId).update({ content, updated_at: now }); } catch (e) {}
    }
  }
}

window.flushPendingSaves = flushPendingSaves;

function updatePanelTaskFraction() {
  const doneEl = document.getElementById('task-fraction-done');
  const totalEl = document.getElementById('task-fraction-total');
  const panelFraction = document.getElementById('panel-task-fraction');
  if (panelFraction && doneEl && totalEl) {
    const done = doneEl.textContent;
    const total = totalEl.textContent;
    panelFraction.textContent = `${done}/${total}`;
    panelFraction.title = `${done} of ${total} tasks completed`;
  }
}

window.updatePanelTaskFraction = updatePanelTaskFraction;

async function createAndLoadBlankJournalEntry() {
  const newEntry = { id: crypto.randomUUID(), content: '', created_at: new Date().toISOString() };
  const entries = getJournalEntries();
  entries.unshift(newEntry);
  saveJournalEntries(entries);
  refreshPanelJournalEntries();
  loadJournalEntryToNotes(newEntry.id, '');
  try { await supabase.from('journal_entries').insert([{ id: newEntry.id, content: newEntry.content, created_at: newEntry.created_at }]); } catch (e) {}
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) notesArea.focus();
}
window.createAndLoadBlankJournalEntry = createAndLoadBlankJournalEntry;

async function deletePanelJournalEntry(id) {
  const entries = getJournalEntries();
  const filtered = entries.filter(e => e.id !== id);
  saveJournalEntries(filtered);
  if (activeJournalEntryId === id) {
    activeJournalEntryId = null;
    const notesArea = document.getElementById('notes-textarea');
    if (notesArea) {
      notesArea.textContent = '';
      notesArea.setAttribute('data-placeholder', 'Write your journal entry...');
    }
  }
  refreshPanelJournalEntries();
  try { await supabase.from('journal_entries').eq('id', id).delete(); showToast('Journal entry deleted'); } catch (e) { showToast('Entry deleted locally'); }
}
window.deletePanelJournalEntry = deletePanelJournalEntry;

// deletePanelNotesDoc — now delegates to entry-based delete
async function deletePanelNotesDoc(id) {
  await deletePanelNotesEntry(id);
}
window.deletePanelNotesDoc = deletePanelNotesDoc;

// ── INPUT LISTENER ────────────────────────────
// Route saves by the active sub-view, not just mainView,
// so notes-subview and journal-subview never bleed into each other.
document.addEventListener('DOMContentLoaded', () => {
  const notesArea = document.getElementById('notes-textarea');
  if (notesArea) {
    notesArea.addEventListener('input', (e) => {
      if (mainView !== 'notes') return; // goals/nutrition/finance — ignore

      if (_notesSubview === 'journal') {
        // ── Journal sub-view ──────────────────
        const content = e.target.innerText; // plain text
        if (activeJournalEntryId) {
          scheduleJournalSave(content);
        } else {
          // Auto-create on first keystroke
          createAndLoadBlankJournalEntry().then(() => scheduleJournalSave(content));
        }
      } else {
        // ── Notes sub-view ────────────────────
        const content = e.target.innerHTML; // rich text
        if (activeNotesEntryId) {
          scheduleNotesEntrySave(content);
        } else if (activeNotesDocId) {
          // Mobile / legacy-docs fallback: after switchToNotesDoc() the entry ID
          // is cleared but the doc ID is set — save via the docs path.
          if (typeof scheduleNotesSave === 'function') scheduleNotesSave(content);
        } else {
          // Auto-create on first keystroke (no active note at all)
          createAndLoadBlankNotesEntry().then(() => scheduleNotesEntrySave(content));
        }
      }
    });
  }
});

function panelFabClick() {
  if (mainView === 'notes') {
    if (_notesSubview === 'journal') createAndLoadBlankJournalEntry();
    else createAndLoadBlankNotesEntry();
  } else if (mainView === 'goals')     openChoiceModal();
  else if (mainView === 'nutrition')   openAddFoodModal();
  else if (mainView === 'finance')     openAddTransactionModal();
}
window.panelFabClick = panelFabClick;

// ── RESIZE HANDLE ────────────────────────────
(function initPanelResize() {
  let isResizing = false, startX = 0, startWidth = 0;
  function onMouseDown(e) {
    if (!isDesktop()) return;
    isResizing = true; startX = e.clientX;
    const panel = document.getElementById('side-panel');
    startWidth = parseInt(getComputedStyle(panel).width) || 380;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.getElementById('panel-resize-handle').classList.add('dragging');
    panel.style.transition = 'none';
    document.getElementById('panel-toggle-btn').style.transition = 'none';
    e.preventDefault();
  }
  function onMouseMove(e) {
    if (!isResizing) return;
    const panel = document.getElementById('side-panel');
    const dx = startX - e.clientX;
    let newWidth = Math.max(360, Math.min(700, startWidth + dx));
    panel.style.setProperty('--panel-width', newWidth + 'px');
    supabase.setPref('panel_width', String(newWidth));
    updateToggleBtnPosition();
  }
  function onMouseUp() {
    if (!isResizing) return;
    isResizing = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.getElementById('panel-resize-handle').classList.remove('dragging');
    document.getElementById('side-panel').style.transition = '';
    document.getElementById('panel-toggle-btn').style.transition = '';
  }
  document.addEventListener('DOMContentLoaded', () => {
    const handle = document.getElementById('panel-resize-handle');
    if (handle) handle.addEventListener('mousedown', onMouseDown);
  });
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
})();

// ── INIT ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!isDesktop()) return;

  const saved = await supabase.getPref('panel_width');
  if (saved) {
    const panel = document.getElementById('side-panel');
    if (panel) panel.style.setProperty('--panel-width', Math.max(360, parseInt(saved) || 360) + 'px');
  }

  const header = document.querySelector('header.header');
  const notesArea = document.getElementById('desktop-notes-area');
  if (header && notesArea && !notesArea.contains(header)) {
    notesArea.insertBefore(header, notesArea.firstChild);
  }

  applyPanelState();
  setMainView('goals');

  // Override switchTab for mobile/desktop compatibility
  const originalSwitchTab = window.switchTab;
  window.switchTab = function(tab) {
    if (isDesktop()) {
      if (tab === 'todo') setMainView('goals');
      else if (tab === 'journal') setMainView('journal');
      else if (tab === 'goals') setMainView('goals');
      else if (tab === 'nutrition') setMainView('nutrition');
      else setMainView('notes');
      return;
    }
    originalSwitchTab(tab);
  };

  let _resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeT);
    _resizeT = setTimeout(() => {
      if (isDesktop()) updateToggleBtnPosition();
    }, 150);
  });

  // Override applyTabState to respect mainView
  const origApplyTabState = window.applyTabState;
  window.applyTabState = function() {
    if (isDesktop()) {
      const tNotes = document.getElementById('tab-notes');
      const tGoals = document.getElementById('tab-goals');
      const tJournal = document.getElementById('tab-journal');
      const fab = document.getElementById('fab');
      const mainEl = document.querySelector('#desktop-notes-area .main');

      // #calendar-view is a fixed overlay — it manages its own display.
      // Do NOT touch it here; toggleCalendarView owns it.

      if (fab) { fab.style.opacity = '1'; fab.style.pointerEvents = 'auto'; fab.style.transform = 'scale(1)'; }

      if (mainView === 'goals') {
        if (tNotes) tNotes.style.display = 'none';
        if (tGoals) {
          tGoals.style.display = 'block';
          graphUserInteracted = false;
          graphAutoFitPending = true;
          renderGoals();
          setTimeout(() => { const wrap = document.getElementById('goal-graph-wrap'); if (wrap) autoFitAndCenterGraph(wrap); }, 50);
        }
        if (tJournal) tJournal.style.display = 'none';
        if (mainEl) { mainEl.classList.add('goals-active'); mainEl.classList.remove('notes-active'); }
        if (fab) fab.style.display = 'none';
      } else if (mainView === 'journal') {
        if (tNotes) tNotes.style.display = 'none';
        if (tGoals) tGoals.style.display = 'none';
        if (tJournal) tJournal.style.display = 'block';
        if (mainEl) { mainEl.classList.remove('goals-active'); mainEl.classList.add('notes-active'); }
        if (fab) fab.style.display = 'none';
      } else if (mainView === 'nutrition' || mainView === 'finance') {
        if (tNotes) tNotes.style.display = 'none';
        if (tGoals) tGoals.style.display = 'none';
        if (tJournal) tJournal.style.display = 'none';
        if (mainEl) { mainEl.classList.add('notes-active'); mainEl.classList.remove('goals-active'); }
        if (fab) fab.style.display = '';
        hideJournalDrawer();
      } else {
        if (tNotes) tNotes.style.display = 'flex';
        if (tGoals) tGoals.style.display = 'none';
        if (tJournal) tJournal.style.display = 'none';
        if (mainEl) { mainEl.classList.add('notes-active'); mainEl.classList.remove('goals-active'); }
        if (fab) fab.style.display = '';
        showJournalDrawer();
      }

      if (panelOpen) renderPanelForView(mainView === 'goals' ? 'todo' : mainView);
      return;
    }
    origApplyTabState();
  };
});

window.toggleSidePanel = toggleSidePanel;

// Called when init.js finishes loading all data
window.onDataReady = function() {
  if (!isDesktop()) return;
  applyMainView();
  if (mainView === 'goals' && panelOpen) renderPanelForView('todo');
  // Cascade view doesn't need post-init re-render; renderGoals was already
  // called by initApp. (The old code here called renderGoalGraph which would
  // wipe the cascade by overwriting goals-container's innerHTML.)
};