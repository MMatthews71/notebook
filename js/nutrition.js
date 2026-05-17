// ─────────────────────────────────────────────
//  NUTRITION TAB
// ─────────────────────────────────────────────

// ── State ────────────────────────────────────
let nutritionProfile = null;
let nutritionTargets = null;
let todayFoodLogs = [];
let usdaApiKey = (window.APP_CONFIG && window.APP_CONFIG.USDA_API_KEY) || '';
let _photoBase64 = null;
let _photoMediaType = null;

// ── Targets Calculator ────────────────────────
function calcNutritionTargets(profile) {
  const { age, sex, height_cm, weight_kg, activity_level, goal } = profile;

  // Mifflin-St Jeor BMR
  let bmr;
  if (sex === 'male') {
    bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age + 5;
  } else {
    bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age - 161;
  }

  const multipliers = {
    sedentary:   1.2,
    light:       1.375,
    moderate:    1.55,
    active:      1.725,
    very_active: 1.9,
  };
  const mult = multipliers[activity_level] || 1.55;
  let tdee = Math.round(bmr * mult);

  // Goal adjustment
  let calories;
  let proteinPerKg;
  if (goal === 'fat_loss') {
    calories = tdee - 500;
    proteinPerKg = 2.0;
  } else if (goal === 'muscle_gain') {
    calories = tdee + 300;
    proteinPerKg = 2.0;
  } else {
    calories = tdee;
    proteinPerKg = 1.6;
  }

  const protein_g = Math.round(weight_kg * proteinPerKg);
  const fat_g     = Math.round((calories * 0.28) / 9);
  const protein_cal = protein_g * 4;
  const fat_cal     = fat_g * 9;
  const carbs_g   = Math.round((calories - protein_cal - fat_cal) / 4);

  // Sex-specific fiber
  const fiber_g = sex === 'male' ? 38 : 25;

  // Micronutrient RDAs
  const micros = {
    sodium:      2300,
    potassium:   sex === 'male' ? 3400 : 2600,
    calcium:     1000,
    magnesium:   sex === 'male' ? 420 : 310,
    iron:        sex === 'male' ? 8 : 18,
    zinc:        sex === 'male' ? 11 : 8,
    vitamin_c:   sex === 'male' ? 90 : 75,
    vitamin_d:   15,
    vitamin_b12: 2.4,
    folate:      400,
    vitamin_a:   sex === 'male' ? 900 : 700,
  };

  return { calories, protein_g, carbs_g, fat_g, fiber_g, tdee, ...micros };
}

// ── Getter helpers ────────────────────────────
function getNutritionTargets() {
  return nutritionTargets;
}

function getTodayFoodLogs() {
  return todayFoodLogs;
}

// ── Summation helper ─────────────────────────
function sumLogs(logs) {
  const s = {
    calories: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0,
    sodium_mg: 0, potassium_mg: 0, calcium_mg: 0, magnesium_mg: 0,
    iron_mg: 0, zinc_mg: 0, vitamin_c_mg: 0, vitamin_d_mcg: 0,
    vitamin_b12_mcg: 0, folate_mcg: 0, vitamin_a_mcg: 0,
  };
  logs.forEach(function(l) {
    s.calories    += (l.calories    || 0);
    s.protein_g   += (l.protein_g   || 0);
    s.carbs_g     += (l.carbs_g     || 0);
    s.fat_g       += (l.fat_g       || 0);
    s.fiber_g     += (l.fiber_g     || 0);
    s.sodium_mg   += (l.sodium_mg   || 0);
    s.potassium_mg+= (l.potassium_mg|| 0);
    s.calcium_mg  += (l.calcium_mg  || 0);
    s.magnesium_mg+= (l.magnesium_mg|| 0);
    s.iron_mg     += (l.iron_mg     || 0);
    s.zinc_mg     += (l.zinc_mg     || 0);
    s.vitamin_c_mg+= (l.vitamin_c_mg|| 0);
    s.vitamin_d_mcg+=(l.vitamin_d_mcg||0);
    s.vitamin_b12_mcg+=(l.vitamin_b12_mcg||0);
    s.folate_mcg  += (l.folate_mcg  || 0);
    s.vitamin_a_mcg+=(l.vitamin_a_mcg||0);
  });
  return s;
}

// ── Render ────────────────────────────────────
function renderNutritionTab() {
  const container = document.getElementById('tab-nutrition');
  if (!container) return;

  if (!nutritionProfile) {
    container.innerHTML = _renderSetupForm();
    return;
  }

  const totals  = sumLogs(todayFoodLogs);
  const targets = nutritionTargets;
  if (!targets) { container.innerHTML = '<p style="color:var(--text-3);padding:32px;text-align:center;">Loading…</p>'; return; }

  container.innerHTML =
    _renderDashboardHeader() +
    _renderCaloriesCard(totals, targets) +
    _renderMacrosCard(totals, targets) +
    _renderMicrosCard(totals, targets) +
    _renderFoodSection(todayFoodLogs);
}

function _renderDashboardHeader() {
  return '<div class="nutr-section-header">' +
    '<p class="section-label" style="margin-bottom:0">Nutrition</p>' +
    '<button class="nutr-settings-btn" onclick="openNutritionSettingsModal()" title="Settings">' +
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none">' +
        '<circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>' +
        '<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
      '</svg>' +
    '</button>' +
  '</div>';
}

function _renderCaloriesCard(totals, targets) {
  const act = Math.round(totals.calories);
  const tgt = targets.calories;
  const pct = Math.min(100, Math.round((act / tgt) * 100));
  const rem = tgt - act;
  const over = act > tgt;
  const fillClass = over ? 'over' : 'mint';
  return '<div class="nutr-calories-card">' +
    '<div class="nutr-calories-top">' +
      '<div>' +
        '<div class="nutr-calories-num">' + act + '</div>' +
        '<div class="nutr-calories-target">of ' + tgt + ' kcal</div>' +
      '</div>' +
      '<div class="nutr-calories-remaining">' +
        (over ? (act - tgt) + ' over' : rem + ' left') +
      '</div>' +
    '</div>' +
    '<div class="nutr-progress-track">' +
      '<div class="nutr-progress-fill ' + fillClass + '" style="width:' + pct + '%"></div>' +
    '</div>' +
  '</div>';
}

function _renderMacroBar(label, actual, target, colorClass) {
  const a = Math.round(actual * 10) / 10;
  const t = Math.round(target);
  const pct = Math.min(100, Math.round((a / t) * 100));
  const over = a > t;
  const fill = over ? 'over' : colorClass;
  const done = a >= t;
  const checkmark = done ? ' ✓' : '';
  return '<div class="nutr-macro-row">' +
    '<div class="nutr-macro-label-row">' +
      '<span class="nutr-macro-label' + (done ? ' done' : '') + '">' + label + checkmark + '</span>' +
      '<span class="nutr-macro-values"><span>' + a + '</span> / ' + t + 'g</span>' +
    '</div>' +
    '<div class="nutr-progress-track">' +
      '<div class="nutr-progress-fill ' + fill + '" style="width:' + pct + '%"></div>' +
    '</div>' +
  '</div>';
}

function _renderMacrosCard(totals, targets) {
  return '<div class="nutr-macros-card">' +
    '<p class="section-label" style="font-size:11px;margin-bottom:14px">Macros</p>' +
    _renderMacroBar('Protein', totals.protein_g, targets.protein_g, 'mint') +
    _renderMacroBar('Carbs', totals.carbs_g, targets.carbs_g, 'gold') +
    _renderMacroBar('Fat', totals.fat_g, targets.fat_g, 'sky') +
    _renderMacroBar('Fiber', totals.fiber_g, targets.fiber_g, 'sage') +
  '</div>';
}

function _renderMicrosCard(totals, targets) {
  const micros = [
    { key: 'sodium',      label: 'Sodium',    unit: 'mg', val: totals.sodium_mg,    tgt: targets.sodium },
    { key: 'potassium',   label: 'Potassium', unit: 'mg', val: totals.potassium_mg, tgt: targets.potassium },
    { key: 'calcium',     label: 'Calcium',   unit: 'mg', val: totals.calcium_mg,   tgt: targets.calcium },
    { key: 'magnesium',   label: 'Magnesium', unit: 'mg', val: totals.magnesium_mg, tgt: targets.magnesium },
    { key: 'iron',        label: 'Iron',      unit: 'mg', val: totals.iron_mg,      tgt: targets.iron },
    { key: 'zinc',        label: 'Zinc',      unit: 'mg', val: totals.zinc_mg,      tgt: targets.zinc },
    { key: 'vitamin_c',   label: 'Vitamin C', unit: 'mg', val: totals.vitamin_c_mg, tgt: targets.vitamin_c },
    { key: 'vitamin_d',   label: 'Vitamin D', unit: 'mcg', val: totals.vitamin_d_mcg, tgt: targets.vitamin_d },
    { key: 'vitamin_b12', label: 'Vitamin B12', unit: 'mcg', val: totals.vitamin_b12_mcg, tgt: targets.vitamin_b12 },
    { key: 'folate',      label: 'Folate',    unit: 'mcg', val: totals.folate_mcg,  tgt: targets.folate },
    { key: 'vitamin_a',   label: 'Vitamin A', unit: 'mcg', val: totals.vitamin_a_mcg, tgt: targets.vitamin_a },
  ];

  let rows = '';
  micros.forEach(function(m) {
    const pct = Math.min(100, Math.round(((m.val || 0) / m.tgt) * 100));
    const done = pct >= 100;
    const over = (m.val || 0) > m.tgt * 1.5;
    const fillClass = over ? 'over' : '';
    const checkmark = done ? ' ✓' : '';
    rows += '<div class="nutr-micro-row">' +
      '<span class="nutr-micro-label' + (done ? ' done' : '') + '">' + m.label + checkmark + '</span>' +
      '<div class="nutr-micro-track">' +
        '<div class="nutr-micro-fill ' + fillClass + '" style="width:' + pct + '%"></div>' +
      '</div>' +
      '<span class="nutr-micro-pct' + (done ? ' done' : '') + '">' + pct + '%</span>' +
    '</div>';
  });

  return '<div class="nutr-micros-card">' +
    '<button class="nutr-micros-toggle" onclick="toggleNutrMicros(this)">' +
      '<span class="nutr-micros-toggle-label">Micronutrients</span>' +
      '<svg class="nutr-micros-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none">' +
        '<path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '</svg>' +
    '</button>' +
    '<div class="nutr-micros-body">' + rows + '</div>' +
  '</div>';
}

function toggleNutrMicros(btn) {
  const body = btn.nextElementSibling;
  const chevron = btn.querySelector('.nutr-micros-chevron');
  const open = body.classList.toggle('open');
  if (chevron) chevron.classList.toggle('open', open);
}

function _renderFoodSection(logs) {
  let listHtml;
  if (logs.length === 0) {
    listHtml = '<div class="nutr-food-empty">No food logged today. Tap + to add a meal.</div>';
  } else {
    const rows = logs.map(function(l) {
      const mealLabel = l.meal_type
        ? l.meal_type.charAt(0).toUpperCase() + l.meal_type.slice(1)
        : 'Meal';
      const cals = Math.round(l.calories || 0);
      return '<div class="nutr-food-row">' +
        '<span class="nutr-food-meal-badge">' + mealLabel + '</span>' +
        '<span class="nutr-food-name" title="' + _esc(l.food_name) + '">' + _esc(l.food_name) + '</span>' +
        '<span class="nutr-food-cals">' + cals + ' kcal</span>' +
        '<button class="nutr-food-delete" onclick="deleteFoodLog(\'' + l.id + '\')" title="Remove">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none">' +
            '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
          '</svg>' +
        '</button>' +
      '</div>';
    }).join('');
    listHtml = '<div class="nutr-food-list">' + rows + '</div>';
  }

  return '<div class="nutr-food-section">' +
    '<div class="nutr-food-section-header">' +
      '<p class="section-label" style="margin-bottom:0">Today\'s Food</p>' +
      '<button class="nutr-add-food-btn" onclick="openAddFoodModal()">' +
        '<svg width="12" height="12" viewBox="0 0 20 20" fill="none">' +
          '<path d="M10 3v14M3 10h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>' +
        '</svg>' +
        'Add food' +
      '</button>' +
    '</div>' +
    listHtml +
  '</div>';
}

function _renderSetupForm() {
  return '<div class="nutr-setup-card">' +
    '<div class="nutr-setup-icon">🥦</div>' +
    '<h2 class="nutr-setup-title">Set up Nutrition</h2>' +
    '<p class="nutr-setup-subtitle">Enter your details to get personalized calorie and macro targets.</p>' +
    '<div class="nutr-setup-form">' +
      '<div class="nutr-form-row">' +
        '<div class="form-group" style="margin-bottom:0">' +
          '<label>Age</label>' +
          '<input type="number" id="nutr-setup-age" placeholder="e.g. 28" min="10" max="100" />' +
        '</div>' +
        '<div class="form-group" style="margin-bottom:0">' +
          '<label>Sex</label>' +
          '<select id="nutr-setup-sex">' +
            '<option value="male">Male</option>' +
            '<option value="female">Female</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="nutr-form-row" style="margin-top:12px">' +
        '<div class="form-group" style="margin-bottom:0">' +
          '<label>Height (cm)</label>' +
          '<input type="number" id="nutr-setup-height" placeholder="e.g. 175" min="100" max="250" />' +
        '</div>' +
        '<div class="form-group" style="margin-bottom:0">' +
          '<label>Weight (kg)</label>' +
          '<input type="number" id="nutr-setup-weight" placeholder="e.g. 75" min="30" max="300" />' +
        '</div>' +
      '</div>' +
      '<div class="nutr-form-row single" style="margin-top:12px">' +
        '<div class="form-group" style="margin-bottom:0">' +
          '<label>Activity Level</label>' +
          '<select id="nutr-setup-activity">' +
            '<option value="sedentary">Sedentary (desk job, no exercise)</option>' +
            '<option value="light">Light (1–3 days/week)</option>' +
            '<option value="moderate" selected>Moderate (3–5 days/week)</option>' +
            '<option value="active">Active (6–7 days/week)</option>' +
            '<option value="very_active">Very Active (hard training daily)</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="nutr-form-row single" style="margin-top:12px">' +
        '<div class="form-group" style="margin-bottom:0">' +
          '<label>Goal</label>' +
          '<select id="nutr-setup-goal">' +
            '<option value="maintenance">Maintenance</option>' +
            '<option value="fat_loss">Fat Loss (−500 kcal/day)</option>' +
            '<option value="muscle_gain">Muscle Gain (+300 kcal/day)</option>' +
            '<option value="performance">Performance</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div class="modal-actions" style="margin-top:24px;padding:0">' +
        '<button class="btn-primary" style="width:100%" onclick="saveNutritionProfile()">Save & Get Targets</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function _esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Save profile ──────────────────────────────
async function saveNutritionProfile(fromModal) {
  let age, sex, height_cm, weight_kg, activity_level, goal;
  if (fromModal) {
    age           = parseInt(document.getElementById('nutr-edit-age').value, 10);
    sex           = document.getElementById('nutr-edit-sex').value;
    height_cm     = parseFloat(document.getElementById('nutr-edit-height').value);
    weight_kg     = parseFloat(document.getElementById('nutr-edit-weight').value);
    activity_level= document.getElementById('nutr-edit-activity').value;
    goal          = document.getElementById('nutr-edit-goal').value;
  } else {
    age           = parseInt(document.getElementById('nutr-setup-age').value, 10);
    sex           = document.getElementById('nutr-setup-sex').value;
    height_cm     = parseFloat(document.getElementById('nutr-setup-height').value);
    weight_kg     = parseFloat(document.getElementById('nutr-setup-weight').value);
    activity_level= document.getElementById('nutr-setup-activity').value;
    goal          = document.getElementById('nutr-setup-goal').value;
  }

  if (!age || !sex || !height_cm || !weight_kg || !activity_level || !goal) {
    showToast('Please fill in all fields');
    return;
  }
  if (isNaN(age) || age < 10 || age > 100) { showToast('Enter a valid age (10–100)'); return; }
  if (isNaN(height_cm) || height_cm < 100 || height_cm > 250) { showToast('Enter a valid height (cm)'); return; }
  if (isNaN(weight_kg) || weight_kg < 30 || weight_kg > 300) { showToast('Enter a valid weight (kg)'); return; }

  haptic([15, 10]);
  const profile = { age, sex, height_cm, weight_kg, activity_level, goal };
  const { error } = await supabase.upsertNutritionProfile(profile);
  if (error) { showToast('Failed to save profile'); console.error(error); return; }

  nutritionProfile = { ...profile };
  nutritionTargets = calcNutritionTargets(profile);

  if (fromModal) {
    closeNutritionSettingsModal();
    showToast('Profile updated ✓');
  } else {
    showToast('Profile saved ✓');
  }
  renderNutritionTab();
}

// ── Food log actions ──────────────────────────
async function addFoodLog(entry) {
  const row = {
    date:            todayStr(),
    meal_type:       entry.meal_type || 'meal',
    food_name:       entry.food_name,
    fdc_id:          entry.fdc_id || null,
    serving_g:       entry.serving_g || 100,
    calories:        entry.calories || 0,
    protein_g:       entry.protein_g || 0,
    carbs_g:         entry.carbs_g || 0,
    fat_g:           entry.fat_g || 0,
    fiber_g:         entry.fiber_g || 0,
    sodium_mg:       entry.sodium_mg || 0,
    potassium_mg:    entry.potassium_mg || 0,
    calcium_mg:      entry.calcium_mg || 0,
    magnesium_mg:    entry.magnesium_mg || 0,
    iron_mg:         entry.iron_mg || 0,
    zinc_mg:         entry.zinc_mg || 0,
    vitamin_c_mg:    entry.vitamin_c_mg || 0,
    vitamin_d_mcg:   entry.vitamin_d_mcg || 0,
    vitamin_b12_mcg: entry.vitamin_b12_mcg || 0,
    folate_mcg:      entry.folate_mcg || 0,
    vitamin_a_mcg:   entry.vitamin_a_mcg || 0,
    saturated_fat_g: entry.saturated_fat_g || 0,
    sugar_g:         entry.sugar_g || 0,
  };

  const { data, error } = await supabase.insertFoodLog(row);
  if (error) { showToast('Failed to add food'); console.error(error); return; }

  // Optimistic: push returned row (or row itself) into cache
  const saved = (data && data[0]) || row;
  todayFoodLogs.push(saved);

  closeAddFoodModal();
  showToast('Food logged ✓');
  haptic([15, 10]);
  renderNutritionTab();
  if (typeof renderPanelNutrition === 'function') renderPanelNutrition();
}

async function deleteFoodLog(id) {
  haptic([20]);
  const { error } = await supabase.deleteFoodLog(id);
  if (error) { showToast('Failed to delete'); console.error(error); return; }
  todayFoodLogs = todayFoodLogs.filter(function(l) { return l.id !== id; });
  showToast('Removed');
  renderNutritionTab();
  if (typeof renderPanelNutrition === 'function') renderPanelNutrition();
}

// ── USDA Search ───────────────────────────────
async function searchUSDA(query) {
  if (!usdaApiKey) {
    showToast('Set your USDA API key in Settings first');
    return [];
  }
  try {
    const url = 'https://api.nal.usda.gov/fdc/v1/foods/search' +
      '?query=' + encodeURIComponent(query) +
      '&pageSize=15' +
      '&api_key=' + encodeURIComponent(usdaApiKey);
    const res = await fetch(url);
    if (!res.ok) { showToast('USDA search failed (check API key)'); return []; }
    const json = await res.json();
    return json.foods || [];
  } catch (e) {
    console.error('USDA search error', e);
    showToast('USDA search failed');
    return [];
  }
}

// Map USDA nutrient IDs to our fields (per 100g)
function _usdaFoodToEntry(food, servingG) {
  // USDA returns nutrientId for Foundation/SR Legacy, nutrientNumber for Branded
  // Build map keyed by both so lookups work for all food types
  const nMap = {};
  const numMap = { '203':1003,'204':1004,'205':1005,'208':1008,'209':1009,
                   '291':1079,'301':1087,'303':1089,'304':1090,'306':1092,
                   '307':1093,'309':1095,'401':1162,'324':1110,'418':1178,
                   '431':1177,'320':1106,'606':1258,'269':2000 };
  (food.foodNutrients || []).forEach(function(n) {
    const id = n.nutrientId || (n.nutrientNumber ? numMap[n.nutrientNumber] : null);
    if (id) nMap[id] = n.value || 0;
  });
  const scale = (servingG || 100) / 100;
  return {
    food_name:       food.description,
    fdc_id:          String(food.fdcId),
    serving_g:       servingG || 100,
    calories:        Math.round((nMap[1008] || 0) * scale * 10) / 10,
    protein_g:       Math.round((nMap[1003] || 0) * scale * 10) / 10,
    fat_g:           Math.round((nMap[1004] || 0) * scale * 10) / 10,
    carbs_g:         Math.round((nMap[1005] || 0) * scale * 10) / 10,
    fiber_g:         Math.round((nMap[1079] || 0) * scale * 10) / 10,
    sugar_g:         Math.round((nMap[2000] || 0) * scale * 10) / 10,
    calcium_mg:      Math.round((nMap[1087] || 0) * scale * 10) / 10,
    iron_mg:         Math.round((nMap[1089] || 0) * scale * 10) / 10,
    magnesium_mg:    Math.round((nMap[1090] || 0) * scale * 10) / 10,
    potassium_mg:    Math.round((nMap[1092] || 0) * scale * 10) / 10,
    sodium_mg:       Math.round((nMap[1093] || 0) * scale * 10) / 10,
    zinc_mg:         Math.round((nMap[1095] || 0) * scale * 10) / 10,
    vitamin_c_mg:    Math.round((nMap[1162] || 0) * scale * 10) / 10,
    vitamin_d_mcg:   Math.round((nMap[1110] || 0) * scale * 10) / 10,
    vitamin_b12_mcg: Math.round((nMap[1178] || 0) * scale * 10) / 10,
    folate_mcg:      Math.round((nMap[1177] || 0) * scale * 10) / 10,
    vitamin_a_mcg:   Math.round((nMap[1106] || 0) * scale * 10) / 10,
    saturated_fat_g: Math.round((nMap[1258] || 0) * scale * 10) / 10,
  };
}

// ── Add Food Modal ────────────────────────────
let _usdaResults = [];
let _selectedUsdaFood = null;

function openAddFoodModal() {
  haptic([20, 15]);
  _usdaResults = [];
  _selectedUsdaFood = null;
  const modal = document.getElementById('add-food-modal');
  if (!modal) return;
  _resetAddFoodForm();
  modal.classList.add('open');
  setTimeout(function() {
    const inp = document.getElementById('nutr-food-name');
    if (inp) inp.focus();
  }, 200);
}

function closeAddFoodModal() {
  const modal = document.getElementById('add-food-modal');
  if (modal) modal.classList.remove('open');
}

function _resetAddFoodForm() {
  var fields = ['nutr-food-name','nutr-food-cals','nutr-food-protein','nutr-food-carbs',
    'nutr-food-fat','nutr-food-fiber','nutr-food-sodium','nutr-food-potassium',
    'nutr-food-calcium','nutr-food-magnesium','nutr-food-iron','nutr-food-zinc',
    'nutr-food-vitc','nutr-food-vitd','nutr-food-b12','nutr-food-folate','nutr-food-vita',
    'nutr-usda-query'];
  fields.forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var servEl = document.getElementById('nutr-food-serving');
  if (servEl) servEl.value = '100';
  var mealEl = document.getElementById('nutr-food-meal');
  if (mealEl) mealEl.value = 'breakfast';
  var resultsEl = document.getElementById('nutr-usda-results');
  if (resultsEl) { resultsEl.innerHTML = ''; resultsEl.style.display = 'none'; }
  _photoBase64 = null;
  _photoMediaType = null;
  var photoPreview = document.getElementById('nutr-photo-preview');
  if (photoPreview) { photoPreview.style.display = 'none'; photoPreview.src = ''; }
  var analyzeBtn = document.getElementById('nutr-analyze-btn');
  if (analyzeBtn) analyzeBtn.style.display = 'none';
  var analyzeStatus = document.getElementById('nutr-analyze-status');
  if (analyzeStatus) { analyzeStatus.style.display = 'none'; analyzeStatus.textContent = ''; }
  var dropLabel = document.getElementById('nutr-photo-drop-label');
  if (dropLabel) dropLabel.textContent = 'Tap to upload a photo';
  var photoInput = document.getElementById('nutr-photo-input');
  if (photoInput) photoInput.value = '';
  var descInput = document.getElementById('nutr-photo-desc');
  if (descInput) { descInput.value = ''; descInput.style.display = 'none'; }
  // Switch to manual tab
  _switchFoodModalTab('manual');
}

function _switchFoodModalTab(tab) {
  document.querySelectorAll('.nutr-modal-tab').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('.nutr-modal-tab-panel').forEach(function(p) {
    p.classList.toggle('active', p.dataset.panel === tab);
  });
}

function nutrModalTabSwitch(tab) {
  haptic([10]);
  _switchFoodModalTab(tab);
}

// USDA search from modal
async function nutrUsdaSearch() {
  const query = (document.getElementById('nutr-usda-query').value || '').trim();
  if (!query) return;
  haptic([15]);
  const resultsEl = document.getElementById('nutr-usda-results');
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = '<div class="nutr-usda-loading">Searching…</div>';

  const foods = await searchUSDA(query);
  _usdaResults = foods;

  if (!foods.length) {
    resultsEl.innerHTML = '<div class="nutr-usda-loading">No results found.</div>';
    return;
  }

  resultsEl.innerHTML = foods.map(function(f, i) {
    const nutrients = f.foodNutrients || [];
    const energyN = nutrients.find(function(n) {
      return n.nutrientId === 1008 || n.nutrientNumber === '208' || n.nutrientName === 'Energy';
    });
    const kcal = energyN ? Math.round(energyN.value || 0) : '?';
    const brand = f.brandOwner ? '<span class="nutr-usda-brand">' + _esc(f.brandOwner) + '</span>' : '';
    return '<div class="nutr-usda-result-item" onclick="nutrSelectUsdaFood(' + i + ')">' +
      '<div class="nutr-usda-result-name">' + _esc(f.description) + brand + '</div>' +
      '<div class="nutr-usda-result-sub">' + kcal + ' kcal / 100g</div>' +
    '</div>';
  }).join('');
}

function nutrSelectUsdaFood(index) {
  _selectedUsdaFood = _usdaResults[index];
  const servingG = parseFloat(document.getElementById('nutr-food-serving').value) || 100;
  const entry = _usdaFoodToEntry(_selectedUsdaFood, servingG);
  _fillManualForm(entry);
  _switchFoodModalTab('manual');
  haptic([10]);
  showToast('Food selected. Review & save.');
}

function _fillManualForm(entry) {
  var map = {
    'nutr-food-name':       entry.food_name      || '',
    'nutr-food-cals':       entry.calories       || '',
    'nutr-food-protein':    entry.protein_g      || '',
    'nutr-food-carbs':      entry.carbs_g        || '',
    'nutr-food-fat':        entry.fat_g          || '',
    'nutr-food-fiber':      entry.fiber_g        || '',
    'nutr-food-sodium':     entry.sodium_mg      || '',
    'nutr-food-potassium':  entry.potassium_mg   || '',
    'nutr-food-calcium':    entry.calcium_mg     || '',
    'nutr-food-magnesium':  entry.magnesium_mg   || '',
    'nutr-food-iron':       entry.iron_mg        || '',
    'nutr-food-zinc':       entry.zinc_mg        || '',
    'nutr-food-vitc':       entry.vitamin_c_mg   || '',
    'nutr-food-vitd':       entry.vitamin_d_mcg  || '',
    'nutr-food-b12':        entry.vitamin_b12_mcg|| '',
    'nutr-food-folate':     entry.folate_mcg     || '',
    'nutr-food-vita':       entry.vitamin_a_mcg  || '',
  };
  Object.keys(map).forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.value = map[id];
  });
}

// Serving size changes → rescale if USDA food selected
function nutrServingChanged() {
  if (!_selectedUsdaFood) return;
  var servingG = parseFloat(document.getElementById('nutr-food-serving').value) || 100;
  var entry = _usdaFoodToEntry(_selectedUsdaFood, servingG);
  _fillManualForm(entry);
}

// Toggle optional micro fields
function nutrToggleOptional(btn) {
  const panel = document.getElementById('nutr-optional-fields');
  const open = panel.classList.toggle('open');
  btn.classList.toggle('open', open);
}

// Save from the add food modal
async function nutrSaveFoodEntry() {
  var name = (document.getElementById('nutr-food-name').value || '').trim();
  if (!name) { showToast('Enter a food name'); return; }

  var cal  = parseFloat(document.getElementById('nutr-food-cals').value) || 0;
  var prot = parseFloat(document.getElementById('nutr-food-protein').value) || 0;
  var carb = parseFloat(document.getElementById('nutr-food-carbs').value) || 0;
  var fat  = parseFloat(document.getElementById('nutr-food-fat').value) || 0;
  var fib  = parseFloat(document.getElementById('nutr-food-fiber').value) || 0;
  var serv = parseFloat(document.getElementById('nutr-food-serving').value) || 100;
  var meal = document.getElementById('nutr-food-meal').value || 'meal';

  var entry = {
    food_name:       name,
    fdc_id:          _selectedUsdaFood ? String(_selectedUsdaFood.fdcId) : null,
    serving_g:       serv,
    meal_type:       meal,
    calories:        cal,
    protein_g:       prot,
    carbs_g:         carb,
    fat_g:           fat,
    fiber_g:         fib,
    sodium_mg:       parseFloat(document.getElementById('nutr-food-sodium').value)    || 0,
    potassium_mg:    parseFloat(document.getElementById('nutr-food-potassium').value) || 0,
    calcium_mg:      parseFloat(document.getElementById('nutr-food-calcium').value)   || 0,
    magnesium_mg:    parseFloat(document.getElementById('nutr-food-magnesium').value) || 0,
    iron_mg:         parseFloat(document.getElementById('nutr-food-iron').value)      || 0,
    zinc_mg:         parseFloat(document.getElementById('nutr-food-zinc').value)      || 0,
    vitamin_c_mg:    parseFloat(document.getElementById('nutr-food-vitc').value)      || 0,
    vitamin_d_mcg:   parseFloat(document.getElementById('nutr-food-vitd').value)      || 0,
    vitamin_b12_mcg: parseFloat(document.getElementById('nutr-food-b12').value)       || 0,
    folate_mcg:      parseFloat(document.getElementById('nutr-food-folate').value)    || 0,
    vitamin_a_mcg:   parseFloat(document.getElementById('nutr-food-vita').value)      || 0,
  };

  await addFoodLog(entry);
}

// ── Nutrition Settings Modal ──────────────────
function openNutritionSettingsModal() {
  haptic([20, 15]);
  const modal = document.getElementById('nutrition-settings-modal');
  if (!modal) return;
  // Pre-fill profile fields
  if (nutritionProfile) {
    var p = nutritionProfile;
    _setVal('nutr-edit-age',      p.age);
    _setVal('nutr-edit-height',   p.height_cm);
    _setVal('nutr-edit-weight',   p.weight_kg);
    _setSelVal('nutr-edit-sex',      p.sex);
    _setSelVal('nutr-edit-activity', p.activity_level);
    _setSelVal('nutr-edit-goal',     p.goal);
  }
  _setVal('nutr-settings-apikey', usdaApiKey);
  modal.classList.add('open');
}

function closeNutritionSettingsModal() {
  const modal = document.getElementById('nutrition-settings-modal');
  if (modal) modal.classList.remove('open');
}

function _setVal(id, val) {
  var el = document.getElementById(id);
  if (el) el.value = val !== null && val !== undefined ? val : '';
}

function _setSelVal(id, val) {
  var el = document.getElementById(id);
  if (el) el.value = val || '';
}

async function nutrSaveApiKey() {
  var key = (document.getElementById('nutr-settings-apikey').value || '').trim();
  usdaApiKey = key;
  await supabase.setPref('usda_api_key', key);
  showToast('API key saved ✓');
  haptic([15]);
}

// ── Backdrop close helpers ────────────────────
function closeAddFoodOnBackdrop(e) {
  if (e.target === document.getElementById('add-food-modal')) closeAddFoodModal();
}

function closeNutritionSettingsOnBackdrop(e) {
  if (e.target === document.getElementById('nutrition-settings-modal')) closeNutritionSettingsModal();
}

// ── Photo Tab ─────────────────────────────────
function nutrPhotoSelected(input) {
  const file = input.files[0];
  if (!file) return;
  _photoMediaType = file.type || 'image/jpeg';
  const reader = new FileReader();
  reader.onload = function(e) {
    const dataUrl = e.target.result;
    // Strip the data:image/...;base64, prefix
    _photoBase64 = dataUrl.split(',')[1];
    const preview = document.getElementById('nutr-photo-preview');
    const analyzeBtn = document.getElementById('nutr-analyze-btn');
    const dropLabel = document.getElementById('nutr-photo-drop-label');
    if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
    if (analyzeBtn) analyzeBtn.style.display = 'flex';
    if (dropLabel) dropLabel.textContent = file.name;
    var descInput = document.getElementById('nutr-photo-desc');
    if (descInput) { descInput.style.display = 'block'; descInput.focus(); }
  };
  reader.readAsDataURL(file);
}

async function nutrAnalyzePhoto() {
  const key = (window.APP_CONFIG && window.APP_CONFIG.GEMINI_API_KEY) || '';
  if (!key) { showToast('Add GEMINI_API_KEY to config.js'); return; }
  if (!_photoBase64) { showToast('Upload a photo first'); return; }

  const description = (document.getElementById('nutr-photo-desc') || {}).value || '';

  const btn = document.getElementById('nutr-analyze-btn');
  const status = document.getElementById('nutr-analyze-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Analyzing…'; }
  if (status) { status.style.display = 'block'; status.textContent = 'Reading image…'; }

  try {
    const result = await _callGeminiVision(_photoBase64, _photoMediaType, key, description);
    if (status) status.textContent = result.notes || 'Done! Review the values below.';
    _fillManualForm(result);
    setTimeout(function() {
      nutrModalTabSwitch('manual');
      showToast('AI filled the form — review & save');
      haptic([15, 10]);
    }, 600);
  } catch(e) {
    console.error('Vision error', e);
    const msg = e.message || 'Analysis failed';
    if (status) status.textContent = msg;
    showToast('Photo analysis failed: ' + msg);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg> Analyze with AI'; }
  }
}

async function _callGeminiVision(base64, mediaType, apiKey, description) {
  const descHint = description ? 'The user describes it as: "' + description + '". Use this as a strong hint.\n\n' : '';
  const prompt = 'You are a nutrition expert. Analyze this food image carefully.\n\n' +
    descHint +
    'If the image shows a NUTRITION LABEL: read the exact values printed on it.\n' +
    'If the image shows a MEAL or FOOD: estimate nutritional content for the visible portion.\n' +
    'If the image shows PACKAGED FOOD: identify the product and use typical values per serving shown.\n\n' +
    'Respond with ONLY valid JSON — no markdown, no explanation, just the object:\n' +
    '{\n' +
    '  "food_name": "specific descriptive name",\n' +
    '  "serving_g": <estimated grams>,\n' +
    '  "calories": <number>,\n' +
    '  "protein_g": <number>,\n' +
    '  "carbs_g": <number>,\n' +
    '  "fat_g": <number>,\n' +
    '  "fiber_g": <number>,\n' +
    '  "sodium_mg": <number>,\n' +
    '  "notes": "<one short sentence about confidence or what you identified>"\n' +
    '}';

  const res = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mediaType, data: base64 } },
            { text: prompt }
          ]
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
      })
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err.error && err.error.message) || ('HTTP ' + res.status));
  }
  const data = await res.json();
  const text = ((data.candidates[0].content.parts[0]) || {}).text || '';
  const cleaned = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  return JSON.parse(cleaned);
}
