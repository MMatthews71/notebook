// ─────────────────────────────────────────────
//  AUTH — Supabase magic-link authentication
//  No password. One email → click link → done.
//  Supports both PKCE (Supabase v2 default) and
//  implicit/hash flows transparently.
// ─────────────────────────────────────────────

const AUTH_URL         = `${SUPABASE_URL}/auth/v1`;
const AUTH_SESSION_KEY = 'sb_session';
const AUTH_PKCE_KEY    = 'sb_pkce_verifier';

let _authSession = null; // { access_token, refresh_token, expires_at, user }

// ── PKCE helpers ──────────────────────────────────────────────

async function _pkceMakeVerifier() {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function _pkceMakeChallenge(verifier) {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Session helpers ───────────────────────────────────────────

function _authSave(data) {
  _authSession = {
    access_token:  data.access_token,
    refresh_token: data.refresh_token  ?? _authSession?.refresh_token,
    expires_at:    Date.now() + ((data.expires_in ?? 3600) * 1000),
    user:          data.user           ?? _authSession?.user,
  };
  try { localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(_authSession)); } catch {}
}

function _authLoad() {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function _authClear() {
  _authSession = null;
  try { localStorage.removeItem(AUTH_SESSION_KEY); } catch {}
  try { sessionStorage.removeItem(AUTH_PKCE_KEY); } catch {}
}

// ── Token refresh ─────────────────────────────────────────────

async function _authRefresh() {
  if (!_authSession?.refresh_token) throw new Error('No refresh token');
  const res = await fetch(`${AUTH_URL}/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: _authSession.refresh_token }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Refresh failed: ${data.msg || data.error_description || ''}`);
  _authSave(data);
  return data.access_token;
}

// ── Public token/user getters (called per-request from db.js) ─

function authGetCurrentToken() {
  return _authSession?.access_token || SUPABASE_ANON_KEY;
}

function authGetCurrentUserId() {
  return _authSession?.user?.id || null;
}

function authGetCurrentEmail() {
  return _authSession?.user?.email || null;
}

function authIsLoggedIn() {
  return !!_authSession?.access_token;
}

// ── Send magic link ───────────────────────────────────────────

async function authSendMagicLink(email) {
  // Generate PKCE params so this works whether the project uses
  // Supabase v1 (implicit flow) or v2 (PKCE) auth settings.
  const verifier   = await _pkceMakeVerifier();
  const challenge  = await _pkceMakeChallenge(verifier);
  sessionStorage.setItem(AUTH_PKCE_KEY, verifier);

  const res = await fetch(`${AUTH_URL}/otp`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      create_user: true,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.msg || err.error_description || err.message || 'Failed to send magic link');
  }
}

// ── Sign out ──────────────────────────────────────────────────

async function authSignOut() {
  if (_authSession?.access_token) {
    fetch(`${AUTH_URL}/logout`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${_authSession.access_token}`,
      },
    }).catch(() => {});
  }
  _authClear();
  window.location.reload();
}

// ── URL callback (called on every page load) ──────────────────

async function _authHandleCallback() {
  // 1. PKCE flow → ?code=XXX arrives after clicking the email link
  const code = new URLSearchParams(window.location.search).get('code');
  if (code) {
    const verifier = sessionStorage.getItem(AUTH_PKCE_KEY);
    if (verifier) {
      try {
        const res = await fetch(`${AUTH_URL}/token?grant_type=pkce`, {
          method: 'POST',
          headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ auth_code: code, code_verifier: verifier }),
        });
        const data = await res.json();
        if (data.access_token) {
          _authSave(data);
          sessionStorage.removeItem(AUTH_PKCE_KEY);
          history.replaceState(null, '', window.location.pathname);
          return true;
        }
      } catch (e) {
        console.warn('[auth] PKCE exchange failed:', e);
      }
    }
  }

  // 2. Implicit flow → #access_token=XXX arrives in the URL hash
  const hash = window.location.hash;
  if (hash?.includes('access_token=')) {
    const p = new URLSearchParams(hash.slice(1));
    const accessToken = p.get('access_token');
    if (accessToken) {
      _authSave({
        access_token:  accessToken,
        refresh_token: p.get('refresh_token') || '',
        expires_in:    parseInt(p.get('expires_in') || '3600'),
      });
      history.replaceState(null, '', window.location.pathname + window.location.search);
      return true;
    }
  }

  return false;
}

async function _authFetchUser() {
  if (!_authSession?.access_token) return null;
  try {
    const res = await fetch(`${AUTH_URL}/user`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${_authSession.access_token}`,
      },
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

// ── Init (run once at startup) ────────────────────────────────

async function authInit() {
  // Handle magic-link redirect FIRST (tokens arrive in URL)
  const gotTokens = await _authHandleCallback();

  // Load session from localStorage
  _authSession = _authLoad();
  if (!_authSession?.access_token) return false;

  // Refresh if expired or close to expiry
  if (Date.now() > (_authSession.expires_at || 0) - 60_000) {
    try { await _authRefresh(); }
    catch { _authClear(); return false; }
  }

  // Populate user object if missing or freshly logged in
  if (gotTokens || !_authSession?.user?.id) {
    const user = await _authFetchUser();
    if (user?.id) {
      _authSession = { ..._authSession, user };
      try { localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(_authSession)); } catch {}
    }
  }

  return !!_authSession?.access_token;
}

// ── Login screen helpers (used by index.html inline handlers) ─

async function _authLoginSend() {
  const emailEl = document.getElementById('auth-email');
  const errEl   = document.getElementById('auth-error');
  const btn     = document.getElementById('auth-send-btn');
  const email   = emailEl?.value.trim();
  if (!email) { emailEl?.focus(); return; }

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    await authSendMagicLink(email);
    document.getElementById('auth-form').style.display    = 'none';
    document.getElementById('auth-sent').style.display    = 'flex';
  } catch (e) {
    errEl.textContent    = e.message;
    errEl.style.display  = 'block';
    btn.disabled         = false;
    btn.textContent      = 'Send magic link';
  }
}

function _authLoginReset() {
  document.getElementById('auth-form').style.display = 'flex';
  document.getElementById('auth-sent').style.display = 'none';
  const btn = document.getElementById('auth-send-btn');
  if (btn) { btn.disabled = false; btn.textContent = 'Send magic link'; }
  const err = document.getElementById('auth-error');
  if (err) err.style.display = 'none';
}

// Handle Enter key in email field
function _authEmailKeydown(e) {
  if (e.key === 'Enter') _authLoginSend();
}

// Expose everything globally
window.authInit           = authInit;
window.authIsLoggedIn     = authIsLoggedIn;
window.authGetCurrentToken  = authGetCurrentToken;
window.authGetCurrentUserId = authGetCurrentUserId;
window.authGetCurrentEmail  = authGetCurrentEmail;
window.authSendMagicLink  = authSendMagicLink;
window.authSignOut        = authSignOut;
window._authLoginSend     = _authLoginSend;
window._authLoginReset    = _authLoginReset;
window._authEmailKeydown  = _authEmailKeydown;
