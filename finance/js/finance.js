
let _finAccounts    = [];
let _finTransactions = [];
let _finRecurring   = [];
let _finCurrency    = 'AUD';
let _finEditTxId    = null;   // null = new, string = editing
let _finEditRecId   = null;
let _finRecType = 'expense';

const FIN_CATEGORIES = [
  'Food & Dining', 'Transport', 'Shopping', 'Bills & Utilities',
  'Entertainment', 'Health', 'Education', 'Travel', 'Income', 'Other',
];

const FIN_CAT_EMOJI = {
  'Food & Dining': '🍔', 'Transport': '🚗', 'Shopping': '🛍️',
  'Bills & Utilities': '💡', 'Entertainment': '🎬', 'Health': '💊',
  'Education': '📚', 'Travel': '✈️', 'Income': '💰', 'Other': '📋',
};

// Display symbols + which currencies have no minor units (whole-number amounts).
const FIN_CUR_SYM = {
  AUD: '$', USD: 'US$', EUR: '€', GBP: '£', JPY: '¥', CNY: 'CN¥', KRW: '₩',
  THB: '฿', SGD: 'S$', HKD: 'HK$', NZD: 'NZ$', INR: '₹', IDR: 'Rp', MYR: 'RM', PHP: '₱', CAD: 'C$',
};
const FIN_NO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'IDR']);
function _finSym(cur) { return FIN_CUR_SYM[cur] || (cur + ' '); }
function _finFmtCur(n, cur) {
  const v = parseFloat(n) || 0;
  return FIN_NO_DECIMAL.has(cur)
    ? Math.round(v).toLocaleString('en-AU')
    : v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function _finLoadAccounts() {
  _finAccounts = await supabase.finGetAccounts();
}

async function _finLoadTransactions() {
  _finTransactions = await supabase.finGetTransactions();
}

async function _finLoadRecurring() {
  _finRecurring = await supabase.finGetRecurring();
}

async function financeInit() {
  await Promise.all([_finLoadAccounts(), _finLoadTransactions(), _finLoadRecurring()]);
  const changed = await _finProcessRecurring();
  if (changed) await Promise.all([_finLoadTransactions(), _finLoadRecurring()]);
  renderFinanceTab();
}

// ── RECURRING ROLL-FORWARD ───────────────────
// When a recurring payment's due date has arrived, log a transaction for it
// and advance `next_due` to the next cycle. Catches up every missed occurrence
// if the app wasn't opened for a while. Idempotent: each occurrence is tagged
// in receipt_data so it can't be logged twice, and the advanced next_due is
// persisted so a later load won't reprocess.
function _finDateStr(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function _finAddDays(dStr, days) {
  const [y, m, d] = dStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return _finDateStr(dt);
}

function _finAddMonths(dStr, months) {
  const [y, m, d] = dStr.split('-').map(Number);
  const target = new Date(y, (m - 1) + months, 1);
  // Clamp to the last day of the target month (e.g. Jan 31 + 1mo → Feb 28).
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return _finDateStr(target);
}

function _finAdvanceDate(dStr, frequency) {
  switch (frequency) {
    case 'weekly':      return _finAddDays(dStr, 7);
    case 'fortnightly': return _finAddDays(dStr, 14);
    case 'yearly':      return _finAddMonths(dStr, 12);
    case 'monthly':
    default:            return _finAddMonths(dStr, 1);
  }
}

async function _finProcessRecurring() {
  const today = _finDateStr(new Date());
  let changed = false;

  for (const r of _finRecurring) {
    if (r.is_active === false || !r.next_due) continue;

    let occ = r.next_due;
    let guard = 0;
    while (occ <= today && guard < 120) {
      guard++;
      const alreadyLogged = _finTransactions.some(t =>
        t.receipt_data && t.receipt_data.recurring_id === r.id && t.receipt_data.occurrence === occ);
      if (!alreadyLogged) {
        await supabase.finInsertTransaction({
          account_id: r.account_id || _finAccounts[0]?.id || null,
          description: r.name,
          amount: r.amount,
          date: occ,
          category: r.category || 'Bills & Utilities',
          merchant: '',
          notes: 'Recurring',
          currency: 'AUD',
          receipt_data: { recurring_id: r.id, occurrence: occ },
        });
      }
      occ = _finAdvanceDate(occ, r.frequency);
    }

    if (occ !== r.next_due) {
      await supabase.finUpdateRecurring(r.id, { next_due: occ });
      r.next_due = occ; // keep in-memory state consistent
      changed = true;
    }
  }

  return changed;
}

function renderFinanceTab() {
  const el = document.getElementById('tab-finance');
  if (!el) return;

  if (_finAccounts.length === 0) {
    el.innerHTML = _finRenderSetup();
    return;
  }

  // Only hide transactions from main area if there's a real side-panel to put them in.
  // The standalone finance app has no panel, so always render transactions inline.
  const hasPanelEl = !!document.getElementById('panel-finance-content');
  el.innerHTML =
    _finRenderAccounts() +
    (hasPanelEl ? '' : _finRenderTransactions()) +
    _finRenderRecurring();

  if (hasPanelEl) renderPanelFinance();
}

function renderPanelFinance() {
  const cont = document.getElementById('panel-finance-content');
  if (!cont) return;

  const grouped = _finGroupByDate(_finTransactions);
  const keys = Object.keys(grouped).sort((a, b) => b.localeCompare(a)).slice(0, 20);

  let html = `
    <div style="padding:10px 12px 6px;border-bottom:1px solid var(--border,rgba(255,255,255,0.07));display:flex;align-items:center;justify-content:space-between">
      <span style="font-size:12px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--text-3)">Transactions</span>
      <button class="fin-text-btn" onclick="openAddTransactionModal()" style="font-size:12px;padding:2px 8px">+ Add</button>
    </div>`;

  if (keys.length === 0) {
    html += '<div class="fin-empty" style="padding:24px 16px">No transactions yet.</div>';
  } else {
    html += keys.map(dateStr => {
      const rows = grouped[dateStr].map(tx => {
        const amt = parseFloat(tx.amount) || 0;
        const isIncome = amt >= 0;
        const emoji = FIN_CAT_EMOJI[tx.category] || '📋';
        const sym = (tx.currency || 'AUD') + ' ';
        const amtStr = (isIncome ? '+' : '−') + sym + _finFmt(Math.abs(amt));
        return `<div class="fin-tx-row" onclick="openFinTxDetail('${tx.id}')" style="padding:8px 12px">
          <div class="fin-tx-icon" style="width:30px;height:30px;font-size:14px">${emoji}</div>
          <div class="fin-tx-info">
            <div class="fin-tx-desc" style="font-size:13px">${_finEsc(tx.description)}</div>
          </div>
          <div class="fin-tx-amount${isIncome ? ' income' : ''}" style="font-size:13px">${amtStr}</div>
        </div>`;
      }).join('');
      return `<div class="fin-date-group" style="margin-bottom:8px">
        <div class="fin-date-label" style="padding:6px 12px 2px">${_finFmtDate(dateStr)}</div>
        ${rows}
      </div>`;
    }).join('');
  }

  cont.innerHTML = html;
}

function _finRenderSetup() {
  return `
    <div class="fin-setup">
      <div class="fin-setup-icon">💳</div>
      <h2>Track your spending</h2>
      <p>Add an account to start tracking.</p>
      <button class="btn-primary" onclick="openFinAccountModal()">Add account</button>
      <button class="fin-text-btn" onclick="openAddTransactionModal()" style="margin-top:8px">or scan a receipt</button>
    </div>`;
}

function _finRenderAccounts() {
  const cards = _finAccounts.map(a => {
    const bal = parseFloat(a.balance) || 0;
    const fmt = _finFmt(Math.abs(bal));
    const neg = bal < 0;
    const updated = a.balance_updated_at
      ? _finRelDate(a.balance_updated_at)
      : 'not set';
    return `
      <div class="fin-account-card" onclick="openFinAccountModal('${a.id}')">
        <div class="fin-account-top">
          <span class="fin-account-name">${_finEsc(a.name)}</span>
          <span class="fin-account-bank">${_finEsc(a.bank_name || '')}</span>
        </div>
        <div class="fin-account-balance${neg ? ' negative' : ''}">${neg ? '-' : ''}$${fmt}</div>
        <div class="fin-account-meta">Updated ${updated} · tap to change</div>
      </div>`;
  }).join('');

  // Total across all accounts — only worth showing with more than one.
  let totalRow = '';
  if (_finAccounts.length > 1) {
    const total = _finAccounts.reduce((s, a) => s + (parseFloat(a.balance) || 0), 0);
    const neg = total < 0;
    totalRow = `
      <div class="fin-accounts-total">
        <span class="fin-accounts-total-label">Total</span>
        <span class="fin-accounts-total-amount${neg ? ' negative' : ''}">${neg ? '-' : ''}$${_finFmt(Math.abs(total))}</span>
      </div>`;
  }

  return `
    <div>
      <div class="fin-section-header">
        <span class="fin-section-title">Accounts</span>
        <button class="fin-text-btn" onclick="openFinAccountModal()">+ Add</button>
      </div>
      <div class="fin-accounts">${cards}</div>
      ${totalRow}
    </div>`;
}

function _finRenderTransactions() {
  const grouped = _finGroupByDate(_finTransactions);
  const keys = Object.keys(grouped).sort((a, b) => b.localeCompare(a)).slice(0, 30);

  let html = '';
  if (keys.length === 0) {
    html = '<div class="fin-empty">No transactions yet.<br>Tap + to scan a receipt or add one manually.</div>';
  } else {
    html = keys.map(dateStr => {
      const rows = grouped[dateStr].map(tx => _finTxRow(tx)).join('');
      return `<div class="fin-date-group">
        <div class="fin-date-label">${_finFmtDate(dateStr)}</div>
        ${rows}
      </div>`;
    }).join('');
  }

  return `
    <div>
      <div class="fin-section-header">
        <span class="fin-section-title">Transactions</span>
        <button class="fin-text-btn" onclick="openAddTransactionModal()">+ Add / Scan</button>
      </div>
      <div class="fin-transactions">${html}</div>
    </div>`;
}

function _finTxRow(tx) {
  const amt = parseFloat(tx.amount) || 0;
  const isIncome = amt >= 0;
  const emoji = FIN_CAT_EMOJI[tx.category] || '📋';
  const cur = tx.currency || 'AUD';
  const amtStr = (isIncome ? '+' : '-') + _finSym(cur) + _finFmtCur(Math.abs(amt), cur);
  // When a foreign amount was converted to AUD at save time, show the original.
  const fx = (tx.receipt_data && tx.receipt_data.currency) ? tx.receipt_data : null;
  const origStr = fx ? `${_finSym(fx.currency)}${_finFmtCur(fx.amount, fx.currency)}` : '';
  const meta = [origStr, tx.merchant || '', tx.category || ''].filter(Boolean).join(' · ');
  return `
    <div class="fin-tx-row" onclick="openFinTxDetail('${tx.id}')">
      <div class="fin-tx-icon">${emoji}</div>
      <div class="fin-tx-info">
        <div class="fin-tx-desc">${_finEsc(tx.description)}</div>
        ${meta ? `<div class="fin-tx-meta">${_finEsc(meta)}</div>` : ''}
      </div>
      <div class="fin-tx-amount${isIncome ? ' income' : ''}">${amtStr}</div>
    </div>`;
}

function _finRenderRecurring() {
  if (_finRecurring.length === 0) return `
    <div>
      <div class="fin-section-header">
        <span class="fin-section-title">Recurring</span>
        <button class="fin-text-btn" onclick="openFinRecModal()">+ Add</button>
      </div>
      <div class="fin-empty" style="padding:16px 0 8px">No recurring payments yet.</div>
    </div>`;

  const rows = _finRecurring.map(r => {
    const amt = parseFloat(r.amount) || 0;
    const isIncome = amt >= 0;
    const amtStr = (isIncome ? '+' : '-') + '$' + _finFmt(Math.abs(amt));
    const freqLabel = { weekly:'Weekly', fortnightly:'Fortnightly', monthly:'Monthly', yearly:'Yearly' }[r.frequency] || r.frequency;
    const due = r.next_due ? 'Due ' + _finFmtDate(r.next_due) : '';
    return `
      <div class="fin-rec-row" onclick="openFinRecModal('${r.id}')">
        <div class="fin-tx-icon">${FIN_CAT_EMOJI[r.category] || '🔁'}</div>
        <div class="fin-rec-info">
          <div class="fin-rec-name">${_finEsc(r.name)}</div>
          <div class="fin-rec-freq">${freqLabel}</div>
        </div>
        <div>
          <div class="fin-rec-amount${isIncome ? ' income' : ''}">${amtStr}</div>
          ${due ? `<div class="fin-rec-due">${due}</div>` : ''}
        </div>
      </div>`;
  }).join('');

  return `
    <div>
      <div class="fin-section-header">
        <span class="fin-section-title">Recurring</span>
        <button class="fin-text-btn" onclick="openFinRecModal()">+ Add</button>
      </div>
      <div class="fin-recurring-list">${rows}</div>
    </div>`;
}

function openFinAccountModal(id) {
  const existing = id ? _finAccounts.find(a => a.id === id) : null;
  const m = document.getElementById('fin-account-modal');
  if (!m) return;

  document.getElementById('fin-acc-id').value = existing ? existing.id : '';
  document.getElementById('fin-acc-name').value = existing ? existing.name : '';
  document.getElementById('fin-acc-bank').value = existing ? (existing.bank_name || '') : '';
  document.getElementById('fin-acc-balance').value = existing ? existing.balance : '';

  const delBtn = document.getElementById('fin-acc-delete-btn');
  if (delBtn) delBtn.style.display = existing ? 'block' : 'none';

  m.classList.add('open');
  document.getElementById('fin-acc-name').focus();
}

function closeFinAccountModal() {
  document.getElementById('fin-account-modal')?.classList.remove('open');
}

async function saveFinAccount() {
  const id = document.getElementById('fin-acc-id').value;
  const name = document.getElementById('fin-acc-name').value.trim();
  const bank_name = document.getElementById('fin-acc-bank').value.trim();
  const balance = parseFloat(document.getElementById('fin-acc-balance').value) || 0;

  if (!name) { showToast('Enter an account name'); return; }

  const btn = document.getElementById('fin-acc-save-btn');
  if (btn) btn.disabled = true;

  try {
    if (id) {
      await supabase.finUpdateAccount(id, { name, bank_name, balance, balance_updated_at: new Date().toISOString() });
    } else {
      await supabase.finInsertAccount({ name, bank_name, balance });
    }
    await _finLoadAccounts();
    renderFinanceTab();
    closeFinAccountModal();
    showToast(id ? 'Account updated' : 'Account added');
  } catch (e) {
    showToast('Error saving account');
    console.error(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function _finConfirmDelete(btn, resetLabel, onConfirm) {
  if (!btn) return;
  if (btn.dataset.confirming) { onConfirm(); return; }
  btn.dataset.confirming = '1';
  btn.textContent = 'Confirm delete';
  setTimeout(() => { btn.textContent = resetLabel; delete btn.dataset.confirming; }, 3000);
}

async function deleteFinAccount() {
  const id = document.getElementById('fin-acc-id').value;
  if (!id) return;
  _finConfirmDelete(document.getElementById('fin-acc-delete-btn'), 'Delete account', async () => {
    try {
      await supabase.finDeleteAccount(id);
      await Promise.all([_finLoadAccounts(), _finLoadTransactions(), _finLoadRecurring()]);
      renderFinanceTab(); closeFinAccountModal(); showToast('Account deleted');
    } catch(e) { showToast('Error deleting'); }
  });
}

function openAddTransactionModal() {
  _finEditTxId = null;
  _finSetVal('fin-tx-desc', '');
  _finSetVal('fin-tx-amount', '');
  _finSetVal('fin-tx-currency', 'AUD');
  const delBtn = document.getElementById('fin-tx-delete-btn');
  if (delBtn) { delBtn.style.display = 'none'; delete delBtn.dataset.confirming; }
  if (_finAccounts.length === 0) _finLoadAccounts();
  document.getElementById('fin-tx-modal')?.classList.add('open');
  document.getElementById('fin-tx-desc')?.focus();
}

function closeFinTxModal() {
  document.getElementById('fin-tx-modal')?.classList.remove('open');
}

function _finSetToggle(type, expId, incId) {
  const e = document.getElementById(expId), i = document.getElementById(incId);
  if (e) e.className = 'fin-type-btn' + (type === 'expense' ? ' active-expense' : '');
  if (i) i.className = 'fin-type-btn' + (type === 'income' ? ' active-income' : '');
}
function finSetRecType(type) { _finRecType = type;   _finSetToggle(type, 'fin-rec-type-expense', 'fin-rec-type-income'); }

// Convert an amount to AUD using the ECB rates for a given date (free, no key).
async function _finFetchAUDRate(currency, amount, date) {
  const res = await fetch(`https://api.frankfurter.app/${date}?from=${encodeURIComponent(currency)}&to=AUD&amount=${amount}`);
  if (!res.ok) throw new Error('rate fetch failed (' + res.status + ')');
  const data = await res.json();
  const aud = data?.rates?.AUD;
  if (!aud) throw new Error('no AUD rate for ' + currency);
  return { aud, rateDate: data.date };
}

async function finSaveTx() {
  const desc = (document.getElementById('fin-tx-desc')?.value || '').trim();
  const amtRaw = parseFloat(document.getElementById('fin-tx-amount')?.value || '0');
  const currency = document.getElementById('fin-tx-currency')?.value || 'AUD';
  if (!desc) { showToast('Enter a description'); return; }
  if (!amtRaw) { showToast('Enter an amount'); return; }

  const btn = document.getElementById('fin-tx-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = currency === 'AUD' ? 'Saving…' : 'Converting…'; }
  try {
    const existing = _finEditTxId ? _finTransactions.find(t => t.id === _finEditTxId) : null;
    // New entries are expenses; edits keep the transaction's existing sign.
    const sign = existing ? (parseFloat(existing.amount) >= 0 ? 1 : -1) : -1;
    const txDate = (existing && existing.date) || new Date().toISOString().slice(0, 10);

    // Convert to AUD so the stored amount, balances and totals are all in AUD.
    // Keep the original amount/currency in receipt_data for display.
    let storedAmount = Math.abs(amtRaw);
    let storedCurrency = 'AUD';
    let fx = null;
    if (currency !== 'AUD') {
      try {
        const { aud, rateDate } = await _finFetchAUDRate(currency, Math.abs(amtRaw), txDate);
        storedAmount = aud;
        fx = { amount: Math.abs(amtRaw), currency, rate_date: rateDate };
      } catch (e) {
        // Offline or unsupported currency — store the original and show it as-is.
        storedCurrency = currency;
        showToast('Saved in ' + currency + ' — couldn’t fetch AUD rate');
        console.warn('[finSaveTx] convert failed:', e);
      }
    }

    let result;
    if (_finEditTxId) {
      const patch = { description: desc, amount: sign * storedAmount, currency: storedCurrency };
      if (fx) patch.receipt_data = fx; // don't clobber other receipt_data when AUD
      result = await supabase.finUpdateTransaction(_finEditTxId, patch);
    } else {
      const row = {
        account_id: _finAccounts[0]?.id || null,
        description: desc,
        amount: sign * storedAmount,
        date: txDate,
        category: 'Other',
        currency: storedCurrency,
      };
      if (fx) row.receipt_data = fx;
      result = await supabase.finInsertTransaction(row);
    }
    if (result?.error) throw result.error;
    await _finLoadTransactions();
    renderFinanceTab();
    closeFinTxModal();
    showToast(_finEditTxId ? 'Transaction updated' : 'Transaction saved');
  } catch (e) {
    showToast('Error saving: ' + (e?.message || e));
    console.error('[finSaveTx]', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}

function openFinTxDetail(id) {
  const tx = _finTransactions.find(t => t.id === id);
  if (!tx) return;
  _finEditTxId = id;
  _finSetVal('fin-tx-desc', tx.description || '');
  _finSetVal('fin-tx-amount', Math.abs(parseFloat(tx.amount) || 0).toFixed(2));
  _finSetVal('fin-tx-currency', tx.currency || 'AUD');
  const delBtn = document.getElementById('fin-tx-delete-btn');
  if (delBtn) { delBtn.style.display = 'block'; delBtn.textContent = 'Delete transaction'; delete delBtn.dataset.confirming; }
  document.getElementById('fin-tx-modal')?.classList.add('open');
}

async function finDeleteTx() {
  if (!_finEditTxId) return;
  _finConfirmDelete(document.getElementById('fin-tx-delete-btn'), 'Delete transaction', async () => {
    try {
      const r = await supabase.finDeleteTransaction(_finEditTxId);
      if (r?.error) throw r.error;
      await _finLoadTransactions();
      renderFinanceTab(); closeFinTxModal(); showToast('Deleted');
    } catch (e) { showToast('Error deleting: ' + (e?.message || e)); console.error(e); }
  });
}

function openFinRecModal(id) {
  const existing = id ? _finRecurring.find(r => r.id === id) : null;
  _finEditRecId = id || null;

  _finSetVal('fin-rec-name', existing?.name || '');
  _finSetVal('fin-rec-amount', existing ? Math.abs(parseFloat(existing.amount) || 0).toFixed(2) : '');
  _finSetVal('fin-rec-category', existing?.category || '');
  _finSetVal('fin-rec-frequency', existing?.frequency || 'monthly');
  _finSetVal('fin-rec-due', existing?.next_due || '');

  finSetRecType(existing && parseFloat(existing.amount) >= 0 ? 'income' : 'expense');

  const delBtn = document.getElementById('fin-rec-delete-btn');
  if (delBtn) { delBtn.style.display = existing ? 'block' : 'none'; delBtn.textContent = 'Delete'; delete delBtn.dataset.confirming; }

  document.getElementById('fin-rec-modal')?.classList.add('open');
  document.getElementById('fin-rec-name')?.focus();
}

function closeFinRecModal() {
  document.getElementById('fin-rec-modal')?.classList.remove('open');
}

async function finSaveRec() {
  const name = (document.getElementById('fin-rec-name')?.value || '').trim();
  const amtRaw = parseFloat(document.getElementById('fin-rec-amount')?.value || '0');
  const category = document.getElementById('fin-rec-category')?.value || 'Bills & Utilities';
  const frequency = document.getElementById('fin-rec-frequency')?.value || 'monthly';
  const next_due = document.getElementById('fin-rec-due')?.value || null;

  if (!name) { showToast('Enter a name'); return; }
  if (!amtRaw) { showToast('Enter an amount'); return; }

  const amount = _finRecType === 'income' ? Math.abs(amtRaw) : -Math.abs(amtRaw);
  const account_id = _finAccounts[0]?.id || null;
  const btn = document.getElementById('fin-rec-save-btn');
  if (btn) btn.disabled = true;

  try {
    if (_finEditRecId) {
      await supabase.finUpdateRecurring(_finEditRecId, { name, amount, category, frequency, next_due });
    } else {
      await supabase.finInsertRecurring({ account_id, name, amount, category, frequency, next_due, is_active: true });
    }
    await _finLoadRecurring();
    renderFinanceTab();
    closeFinRecModal();
    showToast(_finEditRecId ? 'Updated' : 'Recurring payment added');
  } catch (e) {
    showToast('Error saving');
    console.error(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function finDeleteRec() {
  if (!_finEditRecId) return;
  _finConfirmDelete(document.getElementById('fin-rec-delete-btn'), 'Delete', async () => {
    try {
      await supabase.finDeleteRecurring(_finEditRecId);
      await _finLoadRecurring();
      renderFinanceTab(); closeFinRecModal(); showToast('Deleted');
    } catch (e) { showToast('Error deleting'); }
  });
}

function _finFmt(n) {
  return (parseFloat(n) || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function _finEsc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function _finSetVal(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val;
}

function _finGroupByDate(txs) {
  return txs.reduce((g, tx) => {
    const d = tx.date || tx.created_at?.slice(0, 10) || 'Unknown';
    (g[d] ??= []).push(tx);
    return g;
  }, {});
}

function _finFmtDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const now = new Date(); now.setHours(0,0,0,0);
    const t = now.getTime();
    if (d.getTime() === t) return 'Today';
    if (d.getTime() === t - 86400000) return 'Yesterday';
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  } catch { return dateStr; }
}

function _finRelDate(isoStr) {
  try {
    const d = new Date(isoStr);
    const diff = Math.floor((Date.now() - d.getTime()) / 60000);
    if (diff < 2) return 'just now';
    if (diff < 60) return diff + 'm ago';
    if (diff < 1440) return Math.floor(diff / 60) + 'h ago';
    return Math.floor(diff / 1440) + 'd ago';
  } catch { return ''; }
}

window.financeInit            = financeInit;
window.renderFinanceTab       = renderFinanceTab;
window.renderPanelFinance     = renderPanelFinance;
window.openFinAccountModal    = openFinAccountModal;
window.closeFinAccountModal   = closeFinAccountModal;
window.saveFinAccount         = saveFinAccount;
window.deleteFinAccount       = deleteFinAccount;
window.openAddTransactionModal = openAddTransactionModal;
window.closeFinTxModal        = closeFinTxModal;
window.finSaveTx              = finSaveTx;
window.finDeleteTx            = finDeleteTx;
window.openFinTxDetail        = openFinTxDetail;
window.openFinRecModal        = openFinRecModal;
window.closeFinRecModal       = closeFinRecModal;
window.finSaveRec             = finSaveRec;
window.finDeleteRec           = finDeleteRec;
window.finSetRecType          = finSetRecType;
