// ─────────────────────────────────────────────
//  NUTRITION APP  — single-page + speed-dial FAB
// ─────────────────────────────────────────────

// ── State ────────────────────────────────────
let nutritionProfile = null;
let nutritionTargets = null;
let todayFoodLogs    = [];
let pantryItems      = [];

// FAB
let _fabOpen = false;

// Log-meal modal
let _mealSelections = {}; // { itemId: amountNum }

// Add/edit item modal
let _editingItemId = null;

// Scan receipt modal
let _receiptBase64   = null;
let _receiptMime     = null;
let _scannedItems    = [];

// ── Targets ───────────────────────────────────
function calcNutritionTargets(p) {
  const { age, sex, height_cm, weight_kg, activity_level, goal } = p;
  let bmr = sex === 'male'
    ? 10*weight_kg + 6.25*height_cm - 5*age + 5
    : 10*weight_kg + 6.25*height_cm - 5*age - 161;
  const mults = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725, very_active:1.9 };
  const tdee  = Math.round(bmr * (mults[activity_level] || 1.55));
  let calories, protPerKg;
  if (goal === 'fat_loss')    { calories = tdee - 500; protPerKg = 2.0; }
  else if (goal === 'muscle_gain') { calories = tdee + 300; protPerKg = 2.0; }
  else { calories = tdee; protPerKg = 1.6; }
  const protein_g = Math.round(weight_kg * protPerKg);
  const fat_g     = Math.round((calories * 0.28) / 9);
  const carbs_g   = Math.round((calories - protein_g*4 - fat_g*9) / 4);
  return {
    calories, protein_g, carbs_g, fat_g,
    fiber_g: sex === 'male' ? 38 : 25,
    sodium: 2300, potassium: sex === 'male' ? 3400 : 2600,
    calcium: 1000, magnesium: sex === 'male' ? 420 : 310,
    iron: sex === 'male' ? 8 : 18, zinc: sex === 'male' ? 11 : 8,
    vitamin_c: sex === 'male' ? 90 : 75, vitamin_d: 15,
    vitamin_b12: 2.4, folate: 400, vitamin_a: sex === 'male' ? 900 : 700,
  };
}

// Expose so nav.js stubs / init.js can call them
function getNutritionTargets() { return nutritionTargets; }
function getTodayFoodLogs()    { return todayFoodLogs; }

// ── Sum logs ──────────────────────────────────
function sumLogs(logs) {
  const s = { calories:0, protein_g:0, carbs_g:0, fat_g:0, fiber_g:0,
    sodium_mg:0, potassium_mg:0, calcium_mg:0, magnesium_mg:0,
    iron_mg:0, zinc_mg:0, vitamin_c_mg:0, vitamin_d_mcg:0,
    vitamin_b12_mcg:0, folate_mcg:0, vitamin_a_mcg:0 };
  logs.forEach(l => {
    s.calories      += l.calories       || 0;
    s.protein_g     += l.protein_g      || 0;
    s.carbs_g       += l.carbs_g        || 0;
    s.fat_g         += l.fat_g          || 0;
    s.fiber_g       += l.fiber_g        || 0;
    s.sodium_mg     += l.sodium_mg      || 0;
    s.potassium_mg  += l.potassium_mg   || 0;
    s.calcium_mg    += l.calcium_mg     || 0;
    s.magnesium_mg  += l.magnesium_mg   || 0;
    s.iron_mg       += l.iron_mg        || 0;
    s.zinc_mg       += l.zinc_mg        || 0;
    s.vitamin_c_mg  += l.vitamin_c_mg   || 0;
    s.vitamin_d_mcg += l.vitamin_d_mcg  || 0;
    s.vitamin_b12_mcg += l.vitamin_b12_mcg || 0;
    s.folate_mcg    += l.folate_mcg     || 0;
    s.vitamin_a_mcg += l.vitamin_a_mcg  || 0;
  });
  return s;
}

// ── Master render ─────────────────────────────
function renderNutritionTab() {
  const el = document.getElementById('nutrition-content');
  if (!el) return;

  if (!nutritionProfile) {
    el.innerHTML = '<div class="nutr-setup-scroll">' + _renderSetupForm() + '</div>';
    return;
  }

  const totals      = sumLogs(todayFoodLogs);
  const targets     = nutritionTargets;
  const totalCost   = todayFoodLogs.reduce((s, l) => s + (l.cost || 0), 0);
  const pantryCount = pantryItems.length;

  const SETTINGS_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
      '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
    '</svg>';

  el.innerHTML =
    '<div class="nutr-col-layout">' +

    // ── Overview column ─────────────────────────────────────
    '<div class="nutr-col nutr-col-stats">' +
      '<div class="nutr-col-hd">' +
        '<span class="nutr-col-title">Overview</span>' +
        '<button class="nutr-settings-btn" onclick="openNutritionSettingsModal()" title="Settings">' +
          SETTINGS_ICON +
        '</button>' +
      '</div>' +
      '<div class="nutr-col-bd">' +
        _renderCaloriesCard(totals, targets) +
        _renderMacrosCard(totals, targets) +
        _renderMicrosCard(totals, targets) +
      '</div>' +
    '</div>' +

    // ── Diary column ─────────────────────────────────────────
    '<div class="nutr-col nutr-col-diary">' +
      '<div class="nutr-col-hd">' +
        '<span class="nutr-col-title">Diary</span>' +
        (totalCost > 0
          ? '<span class="nutr-food-total-cost">$' + totalCost.toFixed(2) + '</span>'
          : '') +
      '</div>' +
      '<div class="nutr-col-bd">' +
        _renderFoodColContent(todayFoodLogs) +
      '</div>' +
    '</div>' +

    // ── Pantry column ────────────────────────────────────────
    '<div class="nutr-col nutr-col-pantry">' +
      '<div class="nutr-col-hd">' +
        '<span class="nutr-col-title">Pantry</span>' +
        (pantryCount > 0
          ? '<span class="pantry-count-badge">' + pantryCount + ' item' + (pantryCount !== 1 ? 's' : '') + '</span>'
          : '') +
      '</div>' +
      '<div class="nutr-col-bd">' +
        _renderPantryColContent() +
      '</div>' +
    '</div>' +

    '</div>';
}

// ── Calories card ─────────────────────────────
function _renderCaloriesCard(totals, targets) {
  const act = Math.round(totals.calories), tgt = targets.calories;
  const pct = Math.min(100, Math.round((act / tgt) * 100));
  const over = act > tgt;
  const rem  = tgt - act;
  return '<div class="nutr-calories-card">' +
    '<div class="nutr-calories-top">' +
      '<div>' +
        '<div class="nutr-calories-num">' + act + '</div>' +
        '<div class="nutr-calories-target">of ' + tgt + ' kcal</div>' +
      '</div>' +
      '<div class="nutr-calories-remaining">' + (over ? (act-tgt)+' over' : rem+' left') + '</div>' +
    '</div>' +
    '<div class="nutr-progress-track">' +
      '<div class="nutr-progress-fill ' + (over?'over':'mint') + '" style="width:'+pct+'%"></div>' +
    '</div>' +
  '</div>';
}

// ── Macros card ───────────────────────────────
function _macroBar(label, actual, target, color) {
  const a = Math.round(actual*10)/10, t = Math.round(target);
  const pct = Math.min(100, Math.round((a/t)*100));
  const over = a > t, done = a >= t;
  return '<div class="nutr-macro-row">' +
    '<div class="nutr-macro-label-row">' +
      '<span class="nutr-macro-label'+(done?' done':'')+'">'+label+(done?' ✓':'')+'</span>' +
      '<span class="nutr-macro-values"><span>'+a+'</span> / '+t+'g</span>' +
    '</div>' +
    '<div class="nutr-progress-track">' +
      '<div class="nutr-progress-fill '+(over?'over':color)+'" style="width:'+pct+'%"></div>' +
    '</div>' +
  '</div>';
}

function _renderMacrosCard(totals, targets) {
  return '<div class="nutr-macros-card">' +
    '<p class="section-label" style="font-size:11px;margin-bottom:14px">Macros</p>' +
    _macroBar('Protein', totals.protein_g, targets.protein_g, 'mint') +
    _macroBar('Carbs',   totals.carbs_g,   targets.carbs_g,   'gold') +
    _macroBar('Fat',     totals.fat_g,     targets.fat_g,     'sky')  +
    _macroBar('Fiber',   totals.fiber_g,   targets.fiber_g,   'sage') +
  '</div>';
}

// ── Micros card ───────────────────────────────
function _renderMicrosCard(totals, targets) {
  const micros = [
    { label:'Sodium',     unit:'mg',  val:totals.sodium_mg,      tgt:targets.sodium },
    { label:'Potassium',  unit:'mg',  val:totals.potassium_mg,   tgt:targets.potassium },
    { label:'Calcium',    unit:'mg',  val:totals.calcium_mg,     tgt:targets.calcium },
    { label:'Magnesium',  unit:'mg',  val:totals.magnesium_mg,   tgt:targets.magnesium },
    { label:'Iron',       unit:'mg',  val:totals.iron_mg,        tgt:targets.iron },
    { label:'Zinc',       unit:'mg',  val:totals.zinc_mg,        tgt:targets.zinc },
    { label:'Vitamin C',  unit:'mg',  val:totals.vitamin_c_mg,   tgt:targets.vitamin_c },
    { label:'Vitamin D',  unit:'mcg', val:totals.vitamin_d_mcg,  tgt:targets.vitamin_d },
    { label:'Vitamin B12',unit:'mcg', val:totals.vitamin_b12_mcg,tgt:targets.vitamin_b12 },
    { label:'Folate',     unit:'mcg', val:totals.folate_mcg,     tgt:targets.folate },
    { label:'Vitamin A',  unit:'mcg', val:totals.vitamin_a_mcg,  tgt:targets.vitamin_a },
  ];
  const rows = micros.map(m => {
    const pct = Math.min(100, Math.round(((m.val||0)/m.tgt)*100));
    const done = pct >= 100, over = (m.val||0) > m.tgt*1.5;
    return '<div class="nutr-micro-row">' +
      '<span class="nutr-micro-label'+(done?' done':'')+'">'+m.label+(done?' ✓':'')+'</span>' +
      '<div class="nutr-micro-track"><div class="nutr-micro-fill'+(over?' over':'')+'" style="width:'+pct+'%"></div></div>' +
      '<span class="nutr-micro-pct'+(done?' done':'')+'">'+pct+'%</span>' +
    '</div>';
  }).join('');
  return '<div class="nutr-micros-card">' +
    '<button class="nutr-micros-toggle" onclick="toggleNutrMicros(this)">' +
      '<span class="nutr-micros-toggle-label">Micronutrients</span>' +
      '<svg class="nutr-micros-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none">' +
        '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>' +
    '</button>' +
    '<div class="nutr-micros-body">'+rows+'</div>' +
  '</div>';
}

function toggleNutrMicros(btn) {
  const body    = btn.nextElementSibling;
  const chevron = btn.querySelector('.nutr-micros-chevron');
  const open    = body.classList.toggle('open');
  chevron && chevron.classList.toggle('open', open);
}

// ── Food log content for column view ─────────
function _renderFoodColContent(logs) {
  if (!logs.length) {
    return '<div class="nutr-food-empty">Nothing logged today.<br>Tap + to log a meal.</div>';
  }
  return '<div class="nutr-food-list">' + logs.map(l => {
    const cals    = Math.round(l.calories || 0);
    const costStr = l.cost > 0 ? ' · $' + parseFloat(l.cost).toFixed(2) : '';
    return '<div class="nutr-food-row">' +
      '<span class="nutr-food-name" title="' + _esc(l.food_name) + '">' + _esc(l.food_name) + '</span>' +
      '<span class="nutr-food-cals">' + cals + ' kcal' + costStr + '</span>' +
      '<button class="nutr-food-delete" onclick="deleteFoodLog(\'' + l.id + '\')">' +
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none">' +
          '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
        '</svg>' +
      '</button>' +
    '</div>';
  }).join('') + '</div>';
}

async function deleteFoodLog(id) {
  haptic([20]);
  await supabase.deleteFoodLog(id);
  todayFoodLogs = todayFoodLogs.filter(l => l.id !== id);
  showToast('Removed');
  renderNutritionTab();
}

// ── Pantry content for column view ────────────
function _renderPantryColContent() {
  if (!pantryItems.length) {
    return '<div class="nutr-food-empty">Pantry is empty.<br>Tap + to scan or add items.</div>';
  }
  const rows = pantryItems.map(item => {
    const stock   = _fmtQty(item.quantity, item.unit);
    const factor  = item.unit === 'piece' ? 1 : 100;
    const unitLbl = item.unit === 'piece' ? '/pc' : '/100' + item.unit;
    const calStr  = item.cal_per_unit > 0
      ? Math.round(item.cal_per_unit * factor) + ' kcal' + unitLbl : '';
    const costStr = item.cost_per_unit > 0 && item.quantity > 0
      ? '$' + (item.quantity * item.cost_per_unit).toFixed(2) + ' value' : '';
    return '<div class="pantry-row" onclick="openEditItemModal(\'' + item.id + '\')">' +
      '<div class="pantry-row-left">' +
        '<span class="pantry-row-name">' + _esc(item.name) + '</span>' +
        '<span class="pantry-row-stock">' + stock + ' in stock</span>' +
      '</div>' +
      '<div class="pantry-row-right">' +
        (calStr  ? '<span class="pantry-row-cal">'  + calStr  + '</span>' : '') +
        (costStr ? '<span class="pantry-row-cost">' + costStr + '</span>' : '') +
      '</div>' +
    '</div>';
  }).join('');
  return '<div class="pantry-list">' + rows + '</div>';
}

function _fmtQty(qty, unit) {
  if (qty == null) return '—';
  const n = Math.round(qty * 10) / 10;
  if (unit === 'g'  && qty >= 1000) return (qty/1000).toFixed(2).replace(/\.?0+$/,'')+' kg';
  if (unit === 'ml' && qty >= 1000) return (qty/1000).toFixed(2).replace(/\.?0+$/,'')+' L';
  return n + (unit === 'piece' ? (n===1?' piece':' pieces') : ' '+unit);
}

// ── Setup form ────────────────────────────────
function _renderSetupForm() {
  return '<div class="nutr-setup-card">' +
    '<div class="nutr-setup-icon">🥦</div>' +
    '<h2 class="nutr-setup-title">Set up Nutrition</h2>' +
    '<p class="nutr-setup-subtitle">Enter your details to get personalised targets.</p>' +
    '<div class="nutr-setup-form">' +
      '<div class="nutr-form-row">' +
        '<div class="form-group" style="margin-bottom:0"><label>Age</label>' +
          '<input type="number" id="nutr-setup-age" placeholder="e.g. 28" min="10" max="100"/></div>' +
        '<div class="form-group" style="margin-bottom:0"><label>Sex</label>' +
          '<select id="nutr-setup-sex"><option value="male">Male</option><option value="female">Female</option></select></div>' +
      '</div>' +
      '<div class="nutr-form-row" style="margin-top:12px">' +
        '<div class="form-group" style="margin-bottom:0"><label>Height (cm)</label>' +
          '<input type="number" id="nutr-setup-height" placeholder="e.g. 175"/></div>' +
        '<div class="form-group" style="margin-bottom:0"><label>Weight (kg)</label>' +
          '<input type="number" id="nutr-setup-weight" placeholder="e.g. 75"/></div>' +
      '</div>' +
      '<div class="nutr-form-row single" style="margin-top:12px">' +
        '<div class="form-group" style="margin-bottom:0"><label>Activity Level</label>' +
          '<select id="nutr-setup-activity">' +
            '<option value="sedentary">Sedentary</option>' +
            '<option value="light">Light (1–3×/week)</option>' +
            '<option value="moderate" selected>Moderate (3–5×/week)</option>' +
            '<option value="active">Active (6–7×/week)</option>' +
            '<option value="very_active">Very Active</option>' +
          '</select></div>' +
      '</div>' +
      '<div class="nutr-form-row single" style="margin-top:12px">' +
        '<div class="form-group" style="margin-bottom:0"><label>Goal</label>' +
          '<select id="nutr-setup-goal">' +
            '<option value="maintenance">Maintenance</option>' +
            '<option value="fat_loss">Fat Loss (−500 kcal/day)</option>' +
            '<option value="muscle_gain">Muscle Gain (+300 kcal/day)</option>' +
            '<option value="performance">Performance</option>' +
          '</select></div>' +
      '</div>' +
      '<div class="modal-actions" style="margin-top:24px;padding:0">' +
        '<button class="btn-primary" style="width:100%" onclick="saveNutritionProfile()">Save &amp; Get Targets</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

async function saveNutritionProfile(fromModal) {
  const pre = fromModal ? 'nutr-edit' : 'nutr-setup';
  const age           = parseInt(_getVal(pre+'-age'), 10);
  const sex           = _getVal(pre+'-sex');
  const height_cm     = parseFloat(_getVal(pre+'-height'));
  const weight_kg     = parseFloat(_getVal(pre+'-weight'));
  const activity_level= _getVal(pre+'-activity');
  const goal          = _getVal(pre+'-goal');
  if (!age||!height_cm||!weight_kg) { showToast('Fill in all fields'); return; }
  haptic([15,10]);
  const profile = { age, sex, height_cm, weight_kg, activity_level, goal };
  const { error } = await supabase.upsertNutritionProfile(profile);
  if (error) { showToast('Failed to save'); return; }
  nutritionProfile = { ...profile };
  nutritionTargets = calcNutritionTargets(profile);
  if (fromModal) { closeNutritionSettingsModal(); showToast('Profile updated ✓'); }
  else showToast('Profile saved ✓');
  renderNutritionTab();
}

// ── FAB speed dial ────────────────────────────
function toggleFabDial() {
  _fabOpen = !_fabOpen;
  document.getElementById('fab-dial-menu')?.classList.toggle('open', _fabOpen);
  document.getElementById('fab-overlay')?.classList.toggle('open', _fabOpen);
  document.getElementById('fab')?.classList.toggle('dial-open', _fabOpen);
  if (_fabOpen) haptic([20, 15]);
}

function closeFabDial() {
  _fabOpen = false;
  document.getElementById('fab-dial-menu')?.classList.remove('open');
  document.getElementById('fab-overlay')?.classList.remove('open');
  document.getElementById('fab')?.classList.remove('dial-open');
}

// ── Log Meal Modal ────────────────────────────
function openLogMealModal() {
  if (!pantryItems.length) { showToast('Add items to your pantry first'); return; }
  _mealSelections = {};
  _setVal('meal-log-name', '');
  _setVal('meal-search', '');
  _renderMealItems('');
  _updateMealTotals();
  document.getElementById('log-meal-modal').classList.add('open');
  haptic([20, 15]);
}

function closeLogMealModal() {
  document.getElementById('log-meal-modal')?.classList.remove('open');
}

function _renderMealItems(filter) {
  const list = document.getElementById('log-meal-items-list');
  if (!list) return;
  const q = (filter||'').toLowerCase().trim();
  const items = q ? pantryItems.filter(i => i.name.toLowerCase().includes(q)) : pantryItems;

  if (!items.length) {
    list.innerHTML = '<div class="meal-no-results">No items found</div>';
    return;
  }

  list.innerHTML = items.map(item => {
    const sel = _mealSelections.hasOwnProperty(item.id);
    const amt = sel ? (_mealSelections[item.id] || '') : '';
    return '<div class="meal-item-row'+(sel?' selected':'')+'">' +
      '<label class="meal-item-check">' +
        '<input type="checkbox"'+(sel?' checked':'')+
          ' onchange="toggleMealItem(\''+item.id+'\',this.checked)" />' +
        '<div class="meal-item-info">' +
          '<span class="meal-item-name">'+_esc(item.name)+'</span>' +
          '<span class="meal-item-stock">'+_fmtQty(item.quantity, item.unit)+' in stock</span>' +
        '</div>' +
      '</label>' +
      (sel ?
        '<div class="meal-item-amount">' +
          '<input type="number" min="0" step="any" value="'+amt+'" placeholder="Amount"' +
            ' oninput="setMealAmount(\''+item.id+'\',this.value)"' +
            ' class="meal-amount-input" />' +
          '<span class="meal-amount-unit">'+_esc(item.unit)+'</span>' +
        '</div>'
      : '') +
    '</div>';
  }).join('');
}

function toggleMealItem(id, checked) {
  if (checked) _mealSelections[id] = 0;
  else delete _mealSelections[id];
  _renderMealItems(_getVal('meal-search'));
  _updateMealTotals();
}

function setMealAmount(id, val) {
  _mealSelections[id] = parseFloat(val) || 0;
  _updateMealTotals();
}

function _updateMealTotals() {
  let cost=0, cal=0, prot=0, carbs=0, fat=0;
  Object.entries(_mealSelections).forEach(([id, amt]) => {
    const it = pantryItems.find(i => i.id === id);
    if (!it || !amt) return;
    cost  += amt * (it.cost_per_unit    || 0);
    cal   += amt * (it.cal_per_unit     || 0);
    prot  += amt * (it.protein_per_unit || 0);
    carbs += amt * (it.carbs_per_unit   || 0);
    fat   += amt * (it.fat_per_unit     || 0);
  });
  const costEl  = document.getElementById('meal-total-cost');
  const calEl   = document.getElementById('meal-total-cal');
  const macroEl = document.getElementById('meal-total-macros');
  if (costEl)  costEl.textContent  = '$'+cost.toFixed(2);
  if (calEl)   calEl.textContent   = Math.round(cal)+' kcal';
  if (macroEl) macroEl.textContent =
    Math.round(prot)+'g protein · '+Math.round(carbs)+'g carbs · '+Math.round(fat)+'g fat';
}

async function logMealFromPantry() {
  const name    = (_getVal('meal-log-name')||'').trim() || 'Meal';
  const pairs   = Object.entries(_mealSelections).filter(([,a]) => a > 0);
  if (!pairs.length) { showToast('Select items and enter amounts'); return; }

  let cost=0, cal=0, prot=0, carbs=0, fat=0, fiber=0, sodium=0, servG=0;
  pairs.forEach(([id, amt]) => {
    const it = pantryItems.find(i => i.id === id);
    if (!it) return;
    cost  += amt * (it.cost_per_unit    || 0);
    cal   += amt * (it.cal_per_unit     || 0);
    prot  += amt * (it.protein_per_unit || 0);
    carbs += amt * (it.carbs_per_unit   || 0);
    fat   += amt * (it.fat_per_unit     || 0);
    fiber += amt * (it.fiber_per_unit   || 0);
    sodium+= amt * (it.sodium_per_unit  || 0);
    if (it.unit==='g'||it.unit==='ml') servG += amt;
  });

  const entry = {
    food_name: name, meal_type:'meal', date: getActiveDateStr(),
    serving_g: Math.round(servG),
    calories: Math.round(cal),
    protein_g: r1(prot), carbs_g: r1(carbs), fat_g: r1(fat),
    fiber_g: r1(fiber), sodium_mg: Math.round(sodium),
    cost: Math.round(cost*100)/100,
    potassium_mg:0, calcium_mg:0, magnesium_mg:0,
    iron_mg:0, zinc_mg:0, vitamin_c_mg:0, vitamin_d_mcg:0,
    vitamin_b12_mcg:0, folate_mcg:0, vitamin_a_mcg:0,
    saturated_fat_g:0, sugar_g:0,
  };

  // Deduct from pantry stock
  for (const [id, amt] of pairs) {
    const it = pantryItems.find(i => i.id === id);
    if (!it) continue;
    const newQty = Math.max(0, it.quantity - amt);
    await supabase.upsertPantryItem({ ...it, quantity: newQty });
    it.quantity = newQty;
  }

  const { data, error } = await supabase.insertFoodLog(entry);
  if (error) { showToast('Failed to log meal'); console.error(error); return; }

  todayFoodLogs.push((data&&data[0]) || { ...entry, id: crypto.randomUUID() });
  closeLogMealModal();
  showToast('Meal logged ✓');
  haptic([15,10]);
  renderNutritionTab();
}

function r1(n) { return Math.round(n*10)/10; }

// ── Add Item Modal ────────────────────────────
function openAddItemModal() {
  closeFabDial();
  _editingItemId = null;
  _clearItemForm();
  document.getElementById('add-item-title').textContent = 'Add Item';
  document.getElementById('item-delete-btn').style.display = 'none';
  _updateNutrLabel();
  document.getElementById('add-item-modal').classList.add('open');
  haptic([20,15]);
}

function openEditItemModal(id) {
  _editingItemId = id;
  const it = pantryItems.find(i => i.id === id);
  if (!it) return;
  _setVal('item-name', it.name);
  _setVal('item-quantity', it.quantity);
  _setVal('item-unit', it.unit);
  _setVal('item-price', (it.quantity * (it.cost_per_unit||0)).toFixed(2));
  const factor = it.unit==='piece' ? 1 : 100;
  _setVal('item-cal',     it.cal_per_unit     > 0 ? Math.round(it.cal_per_unit    * factor) : '');
  _setVal('item-protein', it.protein_per_unit > 0 ? r1(it.protein_per_unit * factor) : '');
  _setVal('item-carbs',   it.carbs_per_unit   > 0 ? r1(it.carbs_per_unit   * factor) : '');
  _setVal('item-fat',     it.fat_per_unit     > 0 ? r1(it.fat_per_unit     * factor) : '');
  document.getElementById('add-item-title').textContent = 'Edit Item';
  const delBtn = document.getElementById('item-delete-btn');
  delBtn.style.display = 'block';
  delBtn.textContent   = 'Delete';
  delete delBtn.dataset.confirming;
  delBtn.style.cssText = '';
  _updateNutrLabel();
  document.getElementById('add-item-modal').classList.add('open');
  haptic([20,15]);
}

function closeAddItemModal() {
  document.getElementById('add-item-modal')?.classList.remove('open');
}

function _clearItemForm() {
  ['item-name','item-quantity','item-price','item-cal','item-protein','item-carbs','item-fat']
    .forEach(id => _setVal(id, ''));
  _setVal('item-unit', 'g');
}

function _updateNutrLabel() {
  const unit  = document.getElementById('item-unit')?.value || 'g';
  const label = document.getElementById('item-nutr-label');
  if (label) label.textContent =
    unit==='piece' ? 'Nutrition (per piece)' : `Nutrition (per 100${unit})`;
}

async function saveItem() {
  const name = (_getVal('item-name')||'').trim();
  if (!name) { showToast('Enter an item name'); return; }

  const quantity   = parseFloat(_getVal('item-quantity')) || 0;
  const unit       = (_getVal('item-unit')||'g').trim();
  const totalPrice = parseFloat(_getVal('item-price'))    || 0;
  const costPerUnit = quantity > 0 ? totalPrice / quantity : 0;

  const factor  = unit==='piece' ? 1 : 100;
  const cal100  = parseFloat(_getVal('item-cal'))     || 0;
  const prot100 = parseFloat(_getVal('item-protein')) || 0;
  const carbs100= parseFloat(_getVal('item-carbs'))   || 0;
  const fat100  = parseFloat(_getVal('item-fat'))     || 0;

  const row = {
    name, quantity, unit,
    cost_per_unit:    costPerUnit,
    cal_per_unit:     cal100  / factor,
    protein_per_unit: prot100 / factor,
    carbs_per_unit:   carbs100/ factor,
    fat_per_unit:     fat100  / factor,
    fiber_per_unit:   0,
    sodium_per_unit:  0,
  };
  if (_editingItemId) row.id = _editingItemId;

  haptic([15,10]);
  const { error } = await supabase.upsertPantryItem(row);
  if (error) { showToast('Failed to save item'); console.error(error); return; }

  pantryItems = await supabase.getPantryItems();
  closeAddItemModal();
  showToast(_editingItemId ? 'Item updated ✓' : 'Item added ✓');
  renderNutritionTab();
}

async function deleteItem() {
  if (!_editingItemId) return;
  const btn = document.getElementById('item-delete-btn');
  if (!btn) return;
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    btn.textContent = 'Confirm delete?';
    btn.style.cssText = 'background:rgba(240,118,79,.15);border-color:rgba(240,118,79,.4);color:var(--ember)';
    setTimeout(() => {
      if (btn.dataset.confirming) {
        delete btn.dataset.confirming;
        btn.textContent  = 'Delete';
        btn.style.cssText= '';
      }
    }, 3000);
    return;
  }
  haptic([20]);
  await supabase.deletePantryItem(_editingItemId);
  pantryItems = pantryItems.filter(i => i.id !== _editingItemId);
  closeAddItemModal();
  showToast('Item removed');
  renderNutritionTab();
}

async function aiEstimateItemNutrition() {
  const key = (window.APP_CONFIG && window.APP_CONFIG.GEMINI_API_KEY) || '';
  if (!key) { showToast('Add GEMINI_API_KEY to config.js'); return; }
  const name = (_getVal('item-name')||'').trim();
  if (!name) { showToast('Enter item name first'); return; }
  const unit = _getVal('item-unit') || 'g';

  const btn = document.getElementById('item-ai-btn');
  if (btn) { btn.disabled=true; btn.textContent='Estimating…'; }
  try {
    const per    = unit==='piece' ? 'per piece' : 'per 100g';
    const prompt = `Estimate typical nutrition ${per} for: "${name}". Return ONLY valid JSON: {"cal":X,"protein":X,"carbs":X,"fat":X}`;
    const result = await _callGeminiText(prompt, key);
    if (result.cal !== undefined) {
      _setVal('item-cal',     Math.round(result.cal || 0));
      _setVal('item-protein', r1(result.protein || 0));
      _setVal('item-carbs',   r1(result.carbs   || 0));
      _setVal('item-fat',     r1(result.fat      || 0));
      showToast('Nutrition estimated ✓');
      haptic([10]);
    }
  } catch(e) { showToast('AI estimate failed'); }
  finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg> AI fill';
    }
  }
}

// ── Scan Receipt Modal ────────────────────────
function openScanReceiptModal() {
  closeFabDial();
  _receiptBase64 = null; _receiptMime = null; _scannedItems = [];
  const modal = document.getElementById('scan-receipt-modal');
  if (!modal) return;
  _showReceiptPanel('scan');
  const prev = document.getElementById('receipt-preview');
  if (prev) { prev.style.display='none'; prev.src=''; }
  const scanBtn = document.getElementById('receipt-scan-btn');
  if (scanBtn) scanBtn.style.display='none';
  const inp = document.getElementById('receipt-photo-input');
  if (inp) inp.value='';
  const status = document.getElementById('receipt-scan-status');
  if (status) { status.style.display='none'; status.textContent=''; }
  modal.classList.add('open');
  haptic([20,15]);
}

function closeScanReceiptModal() {
  document.getElementById('scan-receipt-modal')?.classList.remove('open');
}

function _showReceiptPanel(which) {
  document.getElementById('receipt-scan-panel').style.display    = which==='scan'    ? 'block' : 'none';
  document.getElementById('receipt-results-panel').style.display = which==='results' ? 'block' : 'none';
}

function receiptPhotoSelected(input) {
  const file = input.files[0];
  if (!file) return;
  _receiptMime = file.type || 'image/jpeg';
  const reader = new FileReader();
  reader.onload = e => {
    _receiptBase64 = e.target.result.split(',')[1];
    const prev = document.getElementById('receipt-preview');
    if (prev) { prev.src=e.target.result; prev.style.display='block'; }
    const btn = document.getElementById('receipt-scan-btn');
    if (btn) btn.style.display='flex';
  };
  reader.readAsDataURL(file);
}

async function scanReceipt() {
  const key = (window.APP_CONFIG && window.APP_CONFIG.GEMINI_API_KEY) || '';
  if (!key)            { showToast('Add GEMINI_API_KEY to config.js'); return; }
  if (!_receiptBase64) { showToast('Select a receipt photo first');    return; }

  const btn    = document.getElementById('receipt-scan-btn');
  const status = document.getElementById('receipt-scan-status');
  if (btn)    { btn.disabled=true; btn.textContent='Scanning…'; }
  if (status) { status.style.display='block'; status.textContent='Reading receipt…'; }

  try {
    const prompt =
      'This is a grocery or supermarket receipt. Extract every food or grocery item purchased.\n\n' +
      'For each item return:\n' +
      '- name: clean readable food name\n' +
      '- quantity: weight or count (number)\n' +
      '- unit: "g", "ml", "kg", "L", or "piece"\n' +
      '- total_price: price shown on receipt (number)\n' +
      '- cal_per_unit: estimated kcal per 1 unit\n' +
      '- protein_per_unit: protein grams per 1 unit\n' +
      '- carbs_per_unit: carbs grams per 1 unit\n' +
      '- fat_per_unit: fat grams per 1 unit\n\n' +
      'Exclude non-food items. Return ONLY a valid JSON array, no markdown.';

    const data = await _callGeminiVision(_receiptBase64, _receiptMime, key, prompt);
    _scannedItems = Array.isArray(data) ? data : [];
    if (!_scannedItems.length) { showToast('No items found on receipt'); return; }

    _renderScannedItems();
    _showReceiptPanel('results');
    if (status) status.style.display='none';
    showToast('Found '+_scannedItems.length+' item'+(_scannedItems.length!==1?'s':'')+' ✓');
    haptic([15,10]);
  } catch(e) {
    console.error('Receipt scan error', e);
    if (status) status.textContent = 'Scan failed: '+(e.message||'');
    showToast('Scan failed');
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='Scan receipt'; }
  }
}

function _renderScannedItems() {
  const list = document.getElementById('scanned-items-list');
  if (!list) return;
  list.innerHTML = _scannedItems.map((item, idx) =>
    '<div class="scanned-row">' +
      '<div class="scanned-row-top">' +
        '<input type="text" class="scanned-name" value="'+_esc(item.name)+'"' +
          ' oninput="_scannedItems['+idx+'].name=this.value" placeholder="Item name" />' +
        '<button class="scanned-remove" onclick="removeScannedItem('+idx+')">×</button>' +
      '</div>' +
      '<div class="scanned-row-bottom">' +
        '<input type="number" min="0" step="any" class="scanned-field scanned-qty" value="'+(item.quantity||'')+'"' +
          ' placeholder="Qty" oninput="_scannedItems['+idx+'].quantity=parseFloat(this.value)||0" />' +
        '<select class="scanned-field scanned-unit" onchange="_scannedItems['+idx+'].unit=this.value">' +
          ['g','ml','piece','kg','L'].map(u =>
            '<option value="'+u+'"'+(item.unit===u?' selected':'')+'>'+u+'</option>'
          ).join('') +
        '</select>' +
        '<span class="scanned-dollar">$</span>' +
        '<input type="number" min="0" step="0.01" class="scanned-field scanned-price"' +
          ' value="'+(item.total_price||'')+'" placeholder="Price"' +
          ' oninput="_scannedItems['+idx+'].total_price=parseFloat(this.value)||0" />' +
      '</div>' +
    '</div>'
  ).join('');
}

function removeScannedItem(idx) {
  _scannedItems.splice(idx, 1);
  _renderScannedItems();
  if (!_scannedItems.length) _showReceiptPanel('scan');
}

async function addScannedItemsToPantry() {
  if (!_scannedItems.length) return;
  const btn = document.getElementById('receipt-add-btn');
  if (btn) { btn.disabled=true; btn.textContent='Adding…'; }

  let added = 0;
  for (const item of _scannedItems) {
    const name = (item.name||'').trim();
    if (!name) continue;
    const qty   = parseFloat(item.quantity) || 1;
    const price = parseFloat(item.total_price) || 0;
    const existing = pantryItems.find(p => p.name.toLowerCase()===name.toLowerCase());
    const row = {
      name, unit: item.unit||'g',
      quantity:         (existing ? existing.quantity : 0) + qty,
      cost_per_unit:    qty > 0 ? price/qty : 0,
      cal_per_unit:     parseFloat(item.cal_per_unit)     || 0,
      protein_per_unit: parseFloat(item.protein_per_unit) || 0,
      carbs_per_unit:   parseFloat(item.carbs_per_unit)   || 0,
      fat_per_unit:     parseFloat(item.fat_per_unit)     || 0,
      fiber_per_unit:   0, sodium_per_unit: 0,
    };
    if (existing) row.id = existing.id;
    const { error } = await supabase.upsertPantryItem(row);
    if (!error) added++;
  }

  pantryItems = await supabase.getPantryItems();
  closeScanReceiptModal();
  showToast('Added '+added+' item'+(added!==1?'s':'')+' to pantry ✓');
  haptic([15,10]);
  renderNutritionTab();
  if (btn) { btn.disabled=false; btn.textContent='Add all to pantry'; }
}

// ── Nutrition Settings Modal ──────────────────
function openNutritionSettingsModal() {
  const modal = document.getElementById('nutrition-settings-modal');
  if (!modal) return;
  if (nutritionProfile) {
    _setVal('nutr-edit-age',    nutritionProfile.age);
    _setVal('nutr-edit-height', nutritionProfile.height_cm);
    _setVal('nutr-edit-weight', nutritionProfile.weight_kg);
    _setVal('nutr-edit-sex',    nutritionProfile.sex);
    _setVal('nutr-edit-activity', nutritionProfile.activity_level);
    _setVal('nutr-edit-goal',   nutritionProfile.goal);
  }
  modal.classList.add('open');
  haptic([20,15]);
}

function closeNutritionSettingsModal() {
  document.getElementById('nutrition-settings-modal')?.classList.remove('open');
}

// Backdrop handlers
function closeLogMealOnBackdrop(e) {
  if (e.target===document.getElementById('log-meal-modal')) closeLogMealModal();
}
function closeAddItemOnBackdrop(e) {
  if (e.target===document.getElementById('add-item-modal')) closeAddItemModal();
}
function closeScanReceiptOnBackdrop(e) {
  if (e.target===document.getElementById('scan-receipt-modal')) closeScanReceiptModal();
}
function closeNutritionSettingsOnBackdrop(e) {
  if (e.target===document.getElementById('nutrition-settings-modal')) closeNutritionSettingsModal();
}

// ── DOM helpers ───────────────────────────────
function _setVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = (val != null) ? val : '';
}
function _getVal(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}
function _esc(str) {
  return String(str||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Gemini helpers ────────────────────────────
async function _callGeminiText(prompt, apiKey) {
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key='+apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature:0.1, maxOutputTokens:1024, responseMimeType:'application/json' }
      })
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error((err.error&&err.error.message)||'HTTP '+res.status);
  }
  const data = await res.json();
  const parts = data.candidates[0].content.parts || [];
  const text  = (parts.find(p=>p.text&&!p.thought)||parts[parts.length-1]||{}).text || '';
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('No JSON in response');
  return JSON.parse(m[0]);
}

// ════════════════════════════════════════════
//  MEAL IDEAS SIDEBAR
// ════════════════════════════════════════════

let mealIdeas   = { breakfast: [], dinner: [], snacks: [] };
let _ideaLoaded = false;
let _editingIdeaSection = null;
let _editingIdeaId      = null;

const IDEA_SECTIONS = [
  { key: 'breakfast', label: 'Breakfast' },
  { key: 'dinner',    label: 'Dinner'    },
  { key: 'snacks',    label: 'Snacks'    },
];

async function openMealIdeasSidebar() {
  // Lazy-load from user_preferences on first open
  if (!_ideaLoaded) {
    try {
      const raw = await supabase.getPref('meal_ideas');
      if (raw) {
        const parsed = JSON.parse(raw);
        mealIdeas = { breakfast: [], dinner: [], snacks: [], ...parsed };
      }
    } catch {}
    _ideaLoaded = true;
  }
  renderMealIdeasSidebar();
  document.getElementById('meal-ideas-sidebar')?.classList.add('open');
  if (window.innerWidth < 768) {
    document.getElementById('ideas-overlay')?.classList.add('open');
    haptic([20, 15]);
  }
}

function closeMealIdeasSidebar() {
  if (window.innerWidth >= 768) return; // desktop sidebar is always visible
  document.getElementById('meal-ideas-sidebar')?.classList.remove('open');
  document.getElementById('ideas-overlay')?.classList.remove('open');
}

function renderMealIdeasSidebar() {
  const content = document.getElementById('meal-ideas-content');
  if (!content) return;

  content.innerHTML = IDEA_SECTIONS.map(sec => {
    const items = mealIdeas[sec.key] || [];

    const rows = items.length === 0
      ? '<p class="ideas-empty">No meals yet.</p>'
      : items.map(meal => {
          const hasIng = meal.ingredients && meal.ingredients.trim();
            const effortStars = '<div class="idea-effort-row">' +
            Array.from({length: 5}, (_, i) =>
              '<span class="idea-effort-star' + (i < (meal.effort || 0) ? ' on' : '') + '">★</span>'
            ).join('') +
          '</div>';
          return (
            '<div class="idea-row">' +
              '<div class="idea-row-header" onclick="_toggleIdeaIng(\'' + meal.id + '\')">' +
                '<div class="idea-row-meta">' +
                  '<span class="idea-row-name">' + _esc(meal.name) + '</span>' +
                  effortStars +
                '</div>' +
                '<div class="idea-row-actions">' +
                  (hasIng
                    ? '<svg class="idea-chevron" id="idea-chev-' + meal.id + '" width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
                    : '') +
                  '<button class="idea-edit-btn" onclick="event.stopPropagation();openEditIdeaModal(\'' + sec.key + '\',\'' + meal.id + '\')" title="Edit">' +
                    '<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
                  '</button>' +
                '</div>' +
              '</div>' +
              (hasIng
                ? '<div class="idea-row-ingredients" id="idea-ing-' + meal.id + '">' + _esc(meal.ingredients) + '</div>'
                : '') +
            '</div>'
          );
        }).join('');

    return '<div class="ideas-section">' +
      '<div class="ideas-section-header">' +
        '<span class="ideas-section-title">' + sec.label + '</span>' +
        '<button class="ideas-add-btn" onclick="openAddIdeaModal(\'' + sec.key + '\')">' +
          '<svg width="12" height="12" viewBox="0 0 20 20" fill="none">' +
            '<path d="M10 3v14M3 10h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
          '</svg>' +
        '</button>' +
      '</div>' +
      '<div class="ideas-section-body">' + rows + '</div>' +
    '</div>';
  }).join('');
}

function _toggleIdeaIng(id) {
  const ing   = document.getElementById('idea-ing-' + id);
  const chev  = document.getElementById('idea-chev-' + id);
  if (!ing) return;
  const open = ing.classList.toggle('open');
  if (chev) chev.classList.toggle('open', open);
}

// ── Effort rating picker ──────────────────────
function setIdeaEffort(val) {
  var hidden = document.getElementById('idea-effort');
  if (hidden) hidden.value = val;
  document.querySelectorAll('#idea-effort-picker .effort-star').forEach(function(btn, i) {
    if (i < val) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}
window.setIdeaEffort = setIdeaEffort;

// ── Add / Edit Idea Modal ─────────────────────
function openAddIdeaModal(section) {
  _editingIdeaSection = section;
  _editingIdeaId      = null;
  _setVal('idea-name',        '');
  _setVal('idea-ingredients', '');
  _setVal('idea-section',     section);
  setIdeaEffort(0);
  document.getElementById('idea-modal-title').textContent = 'Add Meal Idea';
  document.getElementById('idea-delete-btn').style.display = 'none';
  document.getElementById('meal-idea-modal').classList.add('open');
  haptic([20, 15]);
}

function openEditIdeaModal(section, id) {
  _editingIdeaSection = section;
  _editingIdeaId      = id;
  const meal = (mealIdeas[section] || []).find(m => m.id === id);
  if (!meal) return;
  _setVal('idea-name',        meal.name);
  _setVal('idea-ingredients', meal.ingredients || '');
  _setVal('idea-section',     section);
  setIdeaEffort(meal.effort || 0);
  document.getElementById('idea-modal-title').textContent = 'Edit Meal Idea';
  const delBtn = document.getElementById('idea-delete-btn');
  delBtn.style.display = 'block';
  delBtn.textContent   = 'Delete';
  delBtn.style.cssText = '';
  delete delBtn.dataset.confirming;
  document.getElementById('meal-idea-modal').classList.add('open');
  haptic([20, 15]);
}

function closeIdeaModal() {
  document.getElementById('meal-idea-modal')?.classList.remove('open');
}

async function saveIdeaMeal() {
  const name        = (_getVal('idea-name') || '').trim();
  if (!name) { showToast('Enter a meal name'); return; }
  const ingredients = (_getVal('idea-ingredients') || '').trim();
  const section     = _getVal('idea-section') || 'dinner';
  const effort      = parseInt(document.getElementById('idea-effort')?.value) || 0;

  if (_editingIdeaId) {
    // If section changed, remove from old section
    if (_editingIdeaSection !== section) {
      mealIdeas[_editingIdeaSection] = (mealIdeas[_editingIdeaSection] || [])
        .filter(m => m.id !== _editingIdeaId);
      if (!mealIdeas[section]) mealIdeas[section] = [];
      mealIdeas[section].push({ id: _editingIdeaId, name, ingredients, effort });
    } else {
      const meal = (mealIdeas[section] || []).find(m => m.id === _editingIdeaId);
      if (meal) { meal.name = name; meal.ingredients = ingredients; meal.effort = effort; }
    }
  } else {
    if (!mealIdeas[section]) mealIdeas[section] = [];
    mealIdeas[section].push({ id: crypto.randomUUID(), name, ingredients, effort });
  }

  haptic([15, 10]);
  await supabase.setPref('meal_ideas', JSON.stringify(mealIdeas));
  closeIdeaModal();
  renderMealIdeasSidebar();
  showToast(_editingIdeaId ? 'Meal updated ✓' : 'Meal added ✓');
}

async function deleteIdeaMeal() {
  if (!_editingIdeaId) return;
  const btn = document.getElementById('idea-delete-btn');
  if (!btn) return;
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    btn.textContent  = 'Confirm delete?';
    btn.style.cssText= 'background:rgba(240,118,79,.15);border-color:rgba(240,118,79,.4);color:var(--ember)';
    setTimeout(() => {
      if (btn.dataset.confirming) {
        delete btn.dataset.confirming;
        btn.textContent  = 'Delete';
        btn.style.cssText= '';
      }
    }, 3000);
    return;
  }
  mealIdeas[_editingIdeaSection] = (mealIdeas[_editingIdeaSection] || [])
    .filter(m => m.id !== _editingIdeaId);
  haptic([20]);
  await supabase.setPref('meal_ideas', JSON.stringify(mealIdeas));
  closeIdeaModal();
  renderMealIdeasSidebar();
  showToast('Removed');
}

async function _callGeminiVision(base64, mimeType, apiKey, prompt) {
  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key='+apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [
          { inline_data: { mime_type: mimeType, data: base64 } },
          { text: prompt }
        ]}],
        generationConfig: { temperature:0.1, maxOutputTokens:4096, responseMimeType:'application/json' }
      })
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(()=>({}));
    throw new Error((err.error&&err.error.message)||'HTTP '+res.status);
  }
  const data = await res.json();
  const parts = data.candidates[0].content.parts || [];
  const text  = (parts.find(p=>p.text&&!p.thought)||parts[parts.length-1]||{}).text || '';
  const m = text.match(/[\[\{][\s\S]*[\]\}]/);
  if (!m) throw new Error('No JSON in response');
  return JSON.parse(m[0]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Window exports — every function referenced by an inline onclick/oninput/
// onchange handler (in index.html or in dynamically-generated HTML) must be
// explicitly on window so the browser can always find it.
// ─────────────────────────────────────────────────────────────────────────────
Object.assign(window, {
  // FAB
  toggleFabDial,
  closeFabDial,

  // Log-meal modal
  openLogMealModal,
  closeLogMealModal,
  closeLogMealOnBackdrop,
  _renderMealItems,
  toggleMealItem,
  setMealAmount,
  logMealFromPantry,

  // Add/edit pantry item modal
  openAddItemModal,
  openEditItemModal,
  closeAddItemModal,
  closeAddItemOnBackdrop,
  _updateNutrLabel,
  saveItem,
  deleteItem,
  aiEstimateItemNutrition,

  // Scan receipt modal
  openScanReceiptModal,
  closeScanReceiptModal,
  closeScanReceiptOnBackdrop,
  receiptPhotoSelected,
  scanReceipt,
  removeScannedItem,
  addScannedItemsToPantry,

  // Nutrition settings modal
  openNutritionSettingsModal,
  closeNutritionSettingsModal,
  closeNutritionSettingsOnBackdrop,
  saveNutritionProfile,

  // Dashboard UI
  toggleNutrMicros,
  deleteFoodLog,

  // Meal ideas sidebar
  openMealIdeasSidebar,
  closeMealIdeasSidebar,
  openAddIdeaModal,
  openEditIdeaModal,
  closeIdeaModal,
  saveIdeaMeal,
  deleteIdeaMeal,
  setIdeaEffort,
  _toggleIdeaIng,
});
