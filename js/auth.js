// ─────────────────────────────────────────────
//  AUTH — WebAuthn biometric gate
//  Uses Face ID / Touch ID / Windows Hello / fingerprint.
//  The credential is device-bound: only YOU can unlock,
//  on devices where you've registered your biometric.
//
//  Falls back to password (APP_CONFIG.NOTEBOOK_PASSWORD)
//  if WebAuthn isn't available (old browser, etc.).
// ─────────────────────────────────────────────

const _WA_CRED_KEY    = 'webauthn_cred_id';   // stored credential ID (base64)
const _WA_SESSION_KEY = 'notebook_session';    // unlock timestamp
const _WA_SESSION_TTL = 12 * 60 * 60 * 1000;  // 12 hours before re-prompt

const _waAvailable = !!(
  window.PublicKeyCredential &&
  navigator.credentials?.create &&
  navigator.credentials?.get
);

// ── Session ───────────────────────────────────────────────────

function authIsLoggedIn() {
  try {
    const raw = localStorage.getItem(_WA_SESSION_KEY);
    if (!raw) return false;
    const { ts } = JSON.parse(raw);
    return (Date.now() - ts) < _WA_SESSION_TTL;
  } catch { return false; }
}

function _authSetSession() {
  localStorage.setItem(_WA_SESSION_KEY, JSON.stringify({ ts: Date.now() }));
}

// These satisfy db.js — password-gate mode keeps using the anon key.
function authGetCurrentToken()  { return SUPABASE_ANON_KEY; }
function authGetCurrentUserId() { return null; }
function authGetCurrentEmail()  { return null; }

async function authSignOut() {
  localStorage.removeItem(_WA_SESSION_KEY);
  window.location.reload();
}

// ── Credential storage ────────────────────────────────────────

function _waHasCred() {
  return !!localStorage.getItem(_WA_CRED_KEY);
}

function _waGetCredId() {
  const b64 = localStorage.getItem(_WA_CRED_KEY);
  if (!b64) return null;
  try { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
  catch { return null; }
}

function _waSaveCred(rawId) {
  localStorage.setItem(_WA_CRED_KEY, btoa(String.fromCharCode(...new Uint8Array(rawId))));
}

// ── WebAuthn: register (first-time setup) ─────────────────────

async function authRegister() {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId    = crypto.getRandomValues(new Uint8Array(16));
  const hostname  = window.location.hostname || 'localhost';

  const cred = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: 'Focus',
        id: hostname,
      },
      user: {
        id:          userId,
        name:        'owner',
        displayName: 'Owner',
      },
      pubKeyCredParams: [
        { alg: -7,   type: 'public-key' }, // ES256  (Face ID, Touch ID)
        { alg: -257, type: 'public-key' }, // RS256  (Windows Hello fallback)
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform', // built-in sensor only (no USB keys)
        userVerification: 'required',        // biometric MUST be verified
        residentKey: 'preferred',
      },
      timeout: 60000,
    },
  });

  _waSaveCred(cred.rawId);
  _authSetSession();
}

// ── WebAuthn: verify (unlock) ─────────────────────────────────

async function authVerify() {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const credId    = _waGetCredId();

  const opts = {
    publicKey: {
      challenge,
      userVerification: 'required',
      timeout: 60000,
    },
  };

  // Restrict to the registered credential so only THIS device unlocks.
  if (credId) {
    opts.publicKey.allowCredentials = [{ id: credId, type: 'public-key' }];
  }

  await navigator.credentials.get(opts); // throws if biometric fails / cancelled
  _authSetSession();
}

// ── authInit (called by initApp before data fetch) ────────────

async function authInit() {
  // Skip auth on localhost — no threat model there (you're already at the machine).
  // Biometric gate only matters on the public hosted URL.
  const host = window.location.hostname;
  if (host === 'localhost' || host === '127.0.0.1' || host === '') return true;

  return authIsLoggedIn();
}

// ── Login screen setup (called when login screen is shown) ────

async function _authInitLoginScreen() {
  const bioSection   = document.getElementById('auth-bio-section');
  const setupSection = document.getElementById('auth-setup-section');
  const pwSection    = document.getElementById('auth-pw-section');

  if (!_waAvailable) {
    // Old browser — fall back to password
    if (pwSection) pwSection.style.display = 'flex';
    return;
  }

  if (_waHasCred()) {
    // Credential registered → show unlock UI and auto-prompt
    if (bioSection) bioSection.style.display = 'flex';
    // Slight delay so the login screen is fully visible first
    setTimeout(() => _authUnlockBio(true), 400);
  } else {
    // No credential yet → show first-time setup
    if (setupSection) setupSection.style.display = 'flex';
  }
}

// Called by "Unlock" button and auto-prompt
async function _authUnlockBio(isAuto = false) {
  const errEl = document.getElementById('auth-error');
  const btn   = document.getElementById('auth-unlock-btn');
  if (errEl) errEl.style.display = 'none';
  if (btn)   btn.disabled = true;

  try {
    await authVerify();
    // Success — reload lets initApp() re-run and find the session
    window.location.reload();
  } catch (e) {
    if (btn) btn.disabled = false;
    if (!isAuto) {
      // Only show an error if the user explicitly tapped the button
      // (auto-prompts may be dismissed without it being an "error")
      if (errEl) {
        errEl.textContent   = e.name === 'NotAllowedError'
          ? 'Biometric check cancelled.'
          : 'Verification failed. Try again.';
        errEl.style.display = 'block';
      }
    }
  }
}

// Called by "Set up biometric" button
async function _authSetupBio() {
  const errEl   = document.getElementById('auth-setup-error');
  const btn     = document.getElementById('auth-setup-btn');
  if (errEl) errEl.style.display = 'none';
  if (btn)   btn.disabled = true;

  try {
    await authRegister();
    window.location.reload();
  } catch (e) {
    if (btn) btn.disabled = false;
    if (errEl) {
      errEl.textContent   = e.name === 'NotAllowedError'
        ? 'Setup cancelled.'
        : `Setup failed: ${e.message}`;
      errEl.style.display = 'block';
    }
  }
}

// Password fallback
async function _authPwUnlock() {
  const inputEl = document.getElementById('auth-password');
  const errEl   = document.getElementById('auth-pw-error');
  const entered = inputEl?.value || '';
  const expected = window.APP_CONFIG?.NOTEBOOK_PASSWORD || '';
  if (errEl) errEl.style.display = 'none';

  if (expected && entered === expected) {
    _authSetSession();
    window.location.reload();
  } else {
    if (errEl) { errEl.textContent = 'Wrong password.'; errEl.style.display = 'block'; }
    if (inputEl) { inputEl.value = ''; inputEl.focus(); inputEl.classList.add('auth-shake'); setTimeout(() => inputEl.classList.remove('auth-shake'), 400); }
  }
}

function _authPwKeydown(e) {
  if (e.key === 'Enter') _authPwUnlock();
}

// Reset the credential (run from console: authResetCredential())
function authResetCredential() {
  localStorage.removeItem(_WA_CRED_KEY);
  localStorage.removeItem(_WA_SESSION_KEY);
  window.location.reload();
}

// ── Expose globals ────────────────────────────────────────────
window.authInit             = authInit;
window.authIsLoggedIn       = authIsLoggedIn;
window.authGetCurrentToken  = authGetCurrentToken;
window.authGetCurrentUserId = authGetCurrentUserId;
window.authGetCurrentEmail  = authGetCurrentEmail;
window.authSignOut          = authSignOut;
window.authRegister         = authRegister;
window.authVerify           = authVerify;
window.authResetCredential  = authResetCredential;
window._authInitLoginScreen = _authInitLoginScreen;
window._authUnlockBio       = _authUnlockBio;
window._authSetupBio        = _authSetupBio;
window._authPwUnlock        = _authPwUnlock;
window._authPwKeydown       = _authPwKeydown;
