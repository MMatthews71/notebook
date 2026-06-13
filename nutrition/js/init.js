
async function initApp() {
  const overlay = document.getElementById('app-loading-overlay');
  if (overlay) overlay.style.opacity = '1';

  updateDateDisplay();
  document.getElementById('app').style.display = 'flex';

  const today = todayStr();

  try {
    const [nutritionProfileData, todayFoodLogsData, pantryData, mealIdeasRaw] = await Promise.all([
      supabase.getNutritionProfile(),
      supabase.getFoodLogs(today),
      supabase.getPantryItems().catch(() => []),
      supabase.getPref('meal_ideas').catch(() => null),
    ]);

    if (nutritionProfileData) {
      nutritionProfile = nutritionProfileData;
      nutritionTargets = calcNutritionTargets(nutritionProfileData);
    }
    todayFoodLogs = todayFoodLogsData;
    pantryItems   = pantryData || [];

    // Pre-load meal ideas so the sidebar is populated on first paint
    if (mealIdeasRaw) {
      try {
        mealIdeas = { breakfast: [], dinner: [], snacks: [], ...JSON.parse(mealIdeasRaw) };
      } catch {}
    }
    _ideaLoaded = true;

  } catch (e) {
    console.error('Init load failed:', e);
    showToast('Failed to load data. Check connection.');
  }

  renderNutritionTab();

  // Show sidebar by default (openMealIdeasSidebar skips the fetch since _ideaLoaded = true)
  if (typeof openMealIdeasSidebar === 'function') openMealIdeasSidebar();

  if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); }
}

initApp();
