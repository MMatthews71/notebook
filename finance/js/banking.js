// ─────────────────────────────────────────────
//  BANKING — Basiq Open Banking widget
//  Shows live ING + NAB balances in a corner pill
// ─────────────────────────────────────────────

const BANKING_FN = `${SUPABASE_URL}/functions/v1/basiq`;
const BANKING_REFRESH_MS = 15 * 60 * 1000; // 15 min

// ── State ─────────────────────────────────────────────────────
let _bwState    = 'init';  // init | disconnected | loading | connected | error
let _bwAccounts = [];
let _bwExpanded = false;
let _bwTimer    = null;

// ── Device-local secret ──────────────────────────────────────
// Generated once per browser, stored in localStorage.
// Sent as X-Banking-Secret on every Edge Function request.
// The Edge Function validates it against the basiq_secrets table.
// Never appears in source code or network responses.

function _bwSecret() {
  let s = localStorage.getItem('basiq_widget_secret');
  if (!s) {
    // Generate a 32-byte hex secret using the Web Crypto API
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    s = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('basiq_widget_secret', s);
  }
  return s;
}

function _bwGetUserId()   { return localStorage.getItem('basiq_user_id'); }
function _bwSetUserId(id) { localStorage.setItem('basiq_user_id', id); }

// ── Edge Function proxy ──────────────────────────────────────

async function _bwCall(action, params = {}) {
  const res = await fetch(BANKING_FN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY,
      'X-Banking-Secret': _bwSecret(),
    },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── API calls ────────────────────────────────────────────────

async function _bwCreateUser() {
  // The secret is sent in the header; the Edge Function stores it
  // alongside the new userId, binding this device to this Basiq user.
  const data = await _bwCall('create_user', { email: 'user@notebook.local' });
  if (!data.id) throw new Error(data.title || data.detail || 'Failed to create Basiq user');
  _bwSetUserId(data.id);
  return data.id;
}

function _bwGetMobile() {
  let m = localStorage.getItem('basiq_mobile');
  if (!m) {
    m = prompt('Enter your mobile number for bank verification\n(include country code, e.g. +61412345678):');
    if (m) localStorage.setItem('basiq_mobile', m.trim());
  }
  return m ? m.trim() : null;
}

async function _bwGetConnectUrl() {
  let uid = _bwGetUserId();
  if (!uid) uid = await _bwCreateUser();

  const mobile = _bwGetMobile();
  const linkParams = { userId: uid, ...(mobile ? { mobile } : {}) };

  const data = await _bwCall('auth_link', linkParams);
  // Basiq v3: { links: { public: "https://connect.basiq.io/..." } }
  const url = data?.links?.public || data?.data?.links?.public || data?.link;
  if (!url && data?.error) throw new Error(data.error);
  return url || null;
}

async function _bwFetchBalances() {
  const uid = _bwGetUserId();
  if (!uid) return null;
  return _bwCall('balances', { userId: uid });
}

// ── Formatting ────────────────────────────────────────────────

function _bwFmt(n) {
  return '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function _bwFmtFull(n) {
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _bwTotal() {
  return _bwAccounts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Panel HTML ────────────────────────────────────────────────

function _bwPanelHtml() {
  const rows = _bwAccounts.map(a => {
    const bal  = parseFloat(a.balance) || 0;
    const name = a.displayName || a.name || a.institution?.shortName || 'Account';
    const type = a.class?.product || a.class?.type || '';
    const num  = a.accountNo ? `••${String(a.accountNo).slice(-4)}` : '';
    const inst = a.institution?.shortName || a.institution?.name || '';
    return `
      <div class="bw-account-row">
        <div class="bw-account-left">
          <span class="bw-account-name">${_esc(name)}</span>
          <span class="bw-account-meta">${_esc(inst)}${type ? ' · ' + _esc(type) : ''}${num ? ' · ' + num : ''}</span>
        </div>
        <span class="bw-account-bal${bal < 0 ? ' bw-neg' : ''}">${_bwFmtFull(bal)}</span>
      </div>`;
  }).join('');

  const total = _bwTotal();
  return `
    <div class="bw-panel" onclick="event.stopPropagation()">
      <div class="bw-panel-header">
        <span class="bw-panel-title">Accounts</span>
        <button class="bw-panel-close" onclick="bwToggleExpand()" aria-label="Close">
          <svg width="10" height="10" viewBox="0 0 12 12"><path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="bw-accounts-list">
        ${rows || '<p class="bw-empty">No accounts connected yet.</p>'}
      </div>
      <div class="bw-panel-footer">
        <span class="bw-footer-label">Total</span>
        <span class="bw-footer-total">${_bwFmtFull(total)}</span>
      </div>
      <div class="bw-panel-actions">
        <button class="bw-action-btn bw-refresh" onclick="bwRefresh()">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path d="M1 4v6h6M23 20v-6h-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          Refresh
        </button>
        <button class="bw-action-btn bw-add" onclick="bwConnect()">+ Add account</button>
      </div>
    </div>`;
}

// ── Render ────────────────────────────────────────────────────

function bwRender() {
  const w = document.getElementById('banking-widget');
  if (!w) return;

  if (_bwState === 'init' || _bwState === 'loading') {
    w.innerHTML = `
      <div class="bw-pill bw-loading">
        <div class="bw-spinner"></div>
      </div>`;
    return;
  }

  if (_bwState === 'disconnected') {
    w.innerHTML = `
      <button class="bw-pill bw-connect-btn" onclick="bwConnect()">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <path d="M3 12a9 9 0 1016.95-4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
          <path d="M16 6l4-2-2 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 7v5l3 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Connect bank
      </button>`;
    return;
  }

  if (_bwState === 'error') {
    w.innerHTML = `
      <button class="bw-pill bw-error-btn" onclick="bwRefresh()" title="Tap to retry">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>
          <path d="M12 8v4m0 4h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        Retry
      </button>`;
    return;
  }

  // connected
  const total = _bwTotal();
  w.innerHTML = `
    <div class="bw-anchor">
      <button class="bw-pill bw-balance-btn${_bwExpanded ? ' bw-open' : ''}" onclick="bwToggleExpand()">
        <svg class="bw-icon" width="13" height="13" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" stroke-width="2"/>
          <path d="M2 10h20" stroke="currentColor" stroke-width="2"/>
          <circle cx="7" cy="15" r="1.2" fill="currentColor"/>
        </svg>
        <span class="bw-total-val${total < 0 ? ' bw-neg' : ''}">${_bwFmt(total)}</span>
      </button>
      ${_bwExpanded ? _bwPanelHtml() : ''}
    </div>`;
}

// ── Public actions ────────────────────────────────────────────

function bwToggleExpand() {
  _bwExpanded = !_bwExpanded;
  bwRender();
}

async function bwConnect() {
  _bwExpanded = false;
  _bwState = 'loading';
  bwRender();
  try {
    const url = await _bwGetConnectUrl();
    if (url) {
      window.open(url, '_blank', 'noopener');
      // Auto-refresh after user has had time to connect
      setTimeout(() => bwRefresh(), 15_000);
    } else {
      throw new Error('No connect URL returned from Basiq');
    }
    _bwState = _bwGetUserId() ? 'connected' : 'disconnected';
  } catch (e) {
    console.error('[banking] connect error:', e);
    _bwState = 'error';
  }
  bwRender();
}

async function bwRefresh() {
  if (!_bwGetUserId()) {
    _bwState = 'disconnected';
    bwRender();
    return;
  }
  _bwState = 'loading';
  bwRender();
  try {
    const data = await _bwFetchBalances();
    _bwAccounts = (data?.data || []).filter(
      a => !a.status || a.status === 'available' || a.status === 'active',
    );
    _bwState = 'connected';
  } catch (e) {
    console.error('[banking] refresh error:', e);
    _bwState = 'error';
  }
  bwRender();
}

async function bankingInit() {
  const w = document.getElementById('banking-widget');
  if (!w) return;

  // Ensure the device secret exists (idempotent)
  _bwSecret();

  if (!_bwGetUserId()) {
    _bwState = 'disconnected';
    bwRender();
    return;
  }

  await bwRefresh();

  // Auto-refresh every 15 min
  if (_bwTimer) clearInterval(_bwTimer);
  _bwTimer = setInterval(() => bwRefresh(), BANKING_REFRESH_MS);
}

// Expose globally
window.bankingInit    = bankingInit;
window.bwRefresh      = bwRefresh;
window.bwConnect      = bwConnect;
window.bwToggleExpand = bwToggleExpand;
