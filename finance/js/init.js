async function initApp() {
  const overlay = document.getElementById('app-loading-overlay');
  if (overlay) overlay.style.opacity = '1';

  const loggedIn = (typeof authInit === 'function') ? await authInit() : true;
  if (!loggedIn) {
    const loginScreen = document.getElementById('login-screen');
    if (loginScreen) loginScreen.style.display = 'flex';
    if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay?.remove(), 300); }
    if (typeof _authInitLoginScreen === 'function') _authInitLoginScreen();
    return;
  }

  _initAuthStatus();
  document.getElementById('app').style.display = 'flex';

  // finance.js handles its own data loading via financeInit()
  if (typeof financeInit === 'function') await financeInit();

  if (overlay) { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 300); }
}

function _initAuthStatus() {
  const el = document.getElementById('auth-status-btn');
  if (!el) return;
  const email = (typeof authGetCurrentEmail === 'function') ? authGetCurrentEmail() : null;
  el.title = email ? `Signed in as ${email}\nClick to sign out` : 'Sign out';
  el.style.display = 'flex';
}

initApp();
