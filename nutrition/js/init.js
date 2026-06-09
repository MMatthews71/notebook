// journal.js is not loaded in this app — stub the drawer functions nav.js calls
window.hideJournalDrawer = function() {};
window.showJournalDrawer = function() {};

// nav.js stubs — nutrition app reloads food logs + re-renders on date change
window.renderTodo  = function() {};
window.renderGoals = async function() {
  try {
    todayFoodLogs = await supabase.getFoodLogs(getActiveDateStr());
  } catch (e) { console.warn('food log reload:', e); }
  if (typeof renderNutritionTab === 'function') renderNutritionTab();
};

async function initApp() {
  const overlay = document.getElementById('app-loading-overlay');
  if (overlay) overlay.style.opacity = '1';

  updateDateDisplay();
  document.getElementById('app').style.display = 'flex';

  const today = todayStr();

  try {
    const [nutritionProfileData, todayFoodLogsData, savedUsdaKey] = await Promise.all([
      supabase.getNutritionProfile(),
      supabase.getFoodLogs(today),
      supabase.getPref('usda_api_key'),
    ]);

    if (nutritionProfileData) {
      nutritionProfile = nutritionProfileData;
      nutritionTargets = calcNutritionTargets(nutritionProfileData);
    }
    todayFoodLogs = todayFoodLogsData;

    if (savedUsdaKey && typeof usdaApiKey !== 'undefined' && !usdaApiKey) usdaApiKey = savedUsdaKey;

  } catch (e) {
    console.error('Init load failed:', e);
    showToast('Failed to load data. Check connection.');
  }

  renderNutritionTab();

  if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); }
}

initApp();
