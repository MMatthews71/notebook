// ─────────────────────────────────────────────
//  BANKING — Basiq Open Banking widget
//  Shows live ING + NAB balances in a corner pill
// ─────────────────────────────────────────────

const BANKING_FN = `${SUPABASE_URL}/functions/v1/basiq`;
const BANKING_REFRESH_MS = 15 * 60 * 1000; // 15 min

// ── State ────────────────────────────────────────────────────
let _bwState       = 'init';   // init | disconnected | loading | connected | error
let _bwAccounts    = [];
let _bwExpanded    = false;
let _bwTimer       = null;
let _bwUserId      = null;

// ── Storage ─────────────────────────────────────────────────

function _bwGetUserId()    { return localStorage.getItem('basiq_user_id'); }
function _bwSetUserId(id)  { localStorage.setItem('basiq_user_id', id); _bwUserId = id; }

// ── Edge function proxy ──────────────────────────────────────

async function _bwCall(action, params = {}) {
  const res = await fetch(BANKING_FN, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ action, ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── API calls ────────────────────────────────────────────────

async function _bwCreateUser() {
  // Use a stable pseudo-email so the same user is always re-created the same way
  const email = 'user@notebook.local';
  const data = await _bwCall('create_user', { email });
  if (!data.id) throw new Error(data.title || data.detail || 'Failed to create Basiq user');
  _bwSetUserId(data.id);
  return data.id;
}

async function _bwGetConnectUrl() {
  let uid = _bwGetUserId();
  if (!uid) uid = await _bwCreateUser();
  const data = await _bwCall('auth_link', { userId: uid });
  // Basiq v3 returns: { links: { public: "https://connect.basiq.io/..." } }
  return data?.links?.public || data?.data?.links?.public || data?.link || null;
}

async function _bwFetchBalances() {
  const uid = _bwGetUserId();
  if (!uid) return null;
  return _bwCall('balances', { userId: uid });
}

// ── Render ────────────────────────────────────────────────────

function _bwFmt(n) {
  return '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function _bwFmtFull(n) {
  return (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _bwTotal() {
  return _bwAccounts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
}

function _bwPanelHtml() {
  const rows = _bwAccounts.map(a => {
    const bal  = parseFloat(a.balance) || 0;
    const avail = parseFloat(a.availableFunds ?? a.available ?? a.balance) || 0;
    const name = a.displayName || a.name || a.institution?.shortName || 'Account';
    const type = a.class?.product || a.class?.type || '';
    const num  = a.accountNo ? `••${String(a.accountNo).slice(-4)}` : '';
    const inst = a.institution?.shortName || a.institution?.name || '';
    const isNeg = bal < 0;
    return `
      <div class="bw-account-row">
        <div class="bw-account-left">
          <span class="bw-account-name">${_esc(name)}</span>
          <span class="bw-account-meta">${_esc(inst)}${type ? ' · ' + _esc(type) : ''}${num ? ' · ' + num : ''}</span>
        </div>
        <span class="bw-account-bal${isNeg ? ' bw-neg' : ''}">${_bwFmtFull(bal)}</span>
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
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M1 4v6h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M23 20v-6h-6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Refresh
        </button>
        <button class="bw-action-btn bw-add" onclick="bwConnect()">
          + Add account
        </button>
      </div>
    </div>`;
}

function bwRender() {
  const w = document.getElementById('banking-widget');
  if (!w) return;

  if (_bwState === 'init' || _bwState === 'loading') {
    w.innerHTML = `
      <div class="bw-pill bw-loading" aria-label="Loading balances">
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
  const isNeg = total < 0;
  w.innerHTML = `
    <div class="bw-anchor">
      <button class="bw-pill bw-balance-btn${_bwExpanded ? ' bw-open' : ''}" onclick="bwToggleExpand()">
        <svg class="bw-icon" width="13" height="13" viewBox="0 0 24 24" fill="none">
          <rect x="2" y="5" width="20" height="14" rx="3" stroke="currentColor" stroke-width="2"/>
          <path d="M2 10h20" stroke="currentColor" stroke-width="2"/>
          <circle cx="7" cy="15" r="1.2" fill="currentColor"/>
        </svg>
        <span class="bw-total-val${isNeg ? ' bw-neg' : ''}">${_bwFmt(total)}</span>
      </button>
      ${_bwExpanded ? _bwPanelHtml() : ''}
    </div>`;
}

// ── Public actions ───────────────────────────────────────────

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
      // Give user time to connect, then auto-refresh
      setTimeout(() => bwRefresh(), 15_000);
    } else {
      throw new Error('No connect URL returned');
    }
    // While user connects in new tab, show loading state briefly then restore
    _bwState = _bwGetUserId() ? 'connected' : 'disconnected';
  } catch (e) {
    console.error('[banking] connect error:', e);
    _bwState = 'error';
  }
  bwRender();
}

async function bwRefresh() {
  const uid = _bwGetUserId();
  if (!uid) {
    _bwState = 'disconnected';
    bwRender();
    return;
  }
  _bwState = 'loading';
  bwRender();
  try {
    const data = await _bwFetchBalances();
    const all = data?.data || [];
    // Filter to active/open accounts
    _bwAccounts = all.filter(a => !a.status || a.status === 'available' || a.status === 'active');
    _bwState = 'connected';
    _bwExpanded = _bwExpanded; // keep panel state
  } catch (e) {
    console.error('[banking] refresh error:', e);
    _bwState = 'error';
  }
  bwRender();
}

async function bankingInit() {
  const w = document.getElementById('banking-widget');
  if (!w) return;

  _bwUserId = _bwGetUserId();

  if (!_bwUserId) {
    _bwState = 'disconnected';
    bwRender();
    return;
  }

  await bwRefresh();

  // Schedule auto-refresh
  if (_bwTimer) clearInterval(_bwTimer);
  _bwTimer = setInterval(() => bwRefresh(), BANKING_REFRESH_MS);
}

// ── Helpers ──────────────────────────────────────────────────

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Expose globally
window.bankingInit    = bankingInit;
window.bwRefresh      = bwRefresh;
window.bwConnect      = bwConnect;
window.bwToggleExpand = bwToggleExpand;
