
let _finAccounts    = [];
let _finTransactions = [];
let _finRecurring   = [];
let _finPhotoBase64 = null;
let _finPhotoMime   = null;
let _finCurrency    = 'AUD';
let _finReceiptData = null;   // parsed from Gemini
let _finEditTxId    = null;   // null = new, string = editing
let _finEditRecId   = null;
let _finTxType  = 'expense';
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
  renderFinanceTab();
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

  return `
    <div>
      <div class="fin-section-header">
        <span class="fin-section-title">Accounts</span>
        <button class="fin-text-btn" onclick="openFinAccountModal()">+ Add</button>
      </div>
      <div class="fin-accounts">${cards}</div>
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
  const sym = (tx.currency || 'AUD') + ' ';
  const amtStr = (isIncome ? '+' : '-') + sym + _finFmt(Math.abs(amt));
  const meta = [tx.merchant || '', tx.category || ''].filter(Boolean).join(' · ');
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

function _finPopulateAccountSelect(selectedId) {
  const sel = document.getElementById('fin-tx-account');
  if (!sel) return;
  if (_finAccounts.length === 0) {
    sel.innerHTML = '<option value="">No accounts yet</option>';
    return;
  }
  sel.innerHTML = _finAccounts.map(a =>
    `<option value="${a.id}"${a.id === selectedId ? ' selected' : ''}>${_finEsc(a.name)}${a.bank_name ? ' — ' + _finEsc(a.bank_name) : ''}</option>`
  ).join('');
}

function _finResetPhotoPanel() {
  const g = id => document.getElementById(id);
  const drop = g('fin-photo-drop'), preview = g('fin-photo-preview'),
        scanBtn = g('fin-scan-btn'), status = g('fin-scan-status'),
        rp = g('fin-receipt-preview'), rpM = g('fin-receipt-preview-manual'),
        curRow = g('fin-currency-row');
  if (drop)    drop.style.display = 'flex';
  if (preview) { preview.style.display = 'none'; preview.src = ''; }
  if (scanBtn) { scanBtn.style.display = 'none'; scanBtn.disabled = false; scanBtn.textContent = '✨ Scan receipt'; }
  if (status)  { status.style.display = 'none'; status.textContent = ''; }
  if (rp)      rp.style.display = 'none';
  if (rpM)     { rpM.style.display = 'none'; rpM.innerHTML = ''; }
  if (curRow)  { curRow.style.display = 'none'; const sel = g('fin-currency-select'); if (sel) sel.value = _finCurrency; }
}

function openAddTransactionModal() {
  _finEditTxId = null; _finPhotoBase64 = null; _finPhotoMime = null;
  _finReceiptData = null;
  _finResetPhotoPanel();
  _finSetVal('fin-tx-desc', ''); _finSetVal('fin-tx-amount', '');
  _finSetVal('fin-tx-currency', _finCurrency); _finUpdateConvertBtn();
  _finSetVal('fin-tx-merchant', ''); _finSetVal('fin-tx-date', new Date().toISOString().slice(0, 10));
  _finSetVal('fin-tx-category', ''); _finSetVal('fin-tx-notes', '');
  finSetType('expense');
  _finModalTabSwitch('photo');
  document.getElementById('fin-tx-modal')?.classList.add('open');
  if (_finAccounts.length > 0) _finPopulateAccountSelect(_finAccounts[0]?.id || '');
  else _finLoadAccounts().then(() => _finPopulateAccountSelect(_finAccounts[0]?.id || ''));
}

function closeFinTxModal() {
  document.getElementById('fin-tx-modal')?.classList.remove('open');
}

function _finModalTabSwitch(tab) {
  document.querySelectorAll('.fin-modal-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.fin-modal-panel').forEach(p =>
    p.classList.toggle('active', p.dataset.panel === tab));
}

function finModalTab(tab) {
  haptic([10]);
  _finModalTabSwitch(tab);
}

function finPhotoSelected(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) return;
    _finPhotoMime = match[1];
    _finPhotoBase64 = match[2];

    const drop = document.getElementById('fin-photo-drop');
    const preview = document.getElementById('fin-photo-preview');
    const scanBtn = document.getElementById('fin-scan-btn');
    const currencyRow = document.getElementById('fin-currency-row');
    if (drop) drop.style.display = 'none';
    if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
    if (currencyRow) currencyRow.style.display = 'block';
    if (scanBtn) scanBtn.style.display = 'block';
  };
  reader.readAsDataURL(file);
}

async function finScanReceipt() {
  const key = (window.APP_CONFIG && window.APP_CONFIG.GEMINI_API_KEY) || '';
  if (!key) { showToast('Add GEMINI_API_KEY to config.js'); return; }
  if (!_finPhotoBase64) { showToast('Upload a photo first'); return; }

  const btn = document.getElementById('fin-scan-btn');
  const status = document.getElementById('fin-scan-status');
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning…'; }
  if (status) { status.style.display = 'block'; status.textContent = 'Reading your receipt…'; }

  // Read the user-selected currency
  const selEl = document.getElementById('fin-currency-select');
  _finCurrency = (selEl && selEl.value) ? selEl.value : _finCurrency;

  const prompt = `Analyse this receipt/invoice image and respond with ONLY a JSON object (no markdown, no extra text):
{
  "merchant": "store or business name",
  "date": "YYYY-MM-DD or null if unclear",
  "time": "HH:MM (24-hour) or null if unclear",
  "currency": "${_finCurrency}",
  "items": [{"name": "item name", "price": 0.00}],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00,
  "category": "one of: Food & Dining, Transport, Shopping, Bills & Utilities, Entertainment, Health, Education, Travel, Other"
}
The amounts on this receipt are in ${_finCurrency}. Report all amounts as positive numbers in ${_finCurrency}. Use null for any fields you cannot determine.`;

  // Try models in order — fall back if one is overloaded (503) or errors
  const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
  const body = JSON.stringify({
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: _finPhotoMime, data: _finPhotoBase64 } },
      ],
    }],
    generationConfig: { temperature: 0.1 },
  });

  let data = null;
  let lastErr = null;
  for (const model of MODELS) {
    try {
      if (status) status.textContent = `Scanning with ${model}…`;
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
      );
      if (res.status === 503 || res.status === 429) {
        lastErr = new Error(`${model} unavailable (${res.status})`);
        continue; // try next model
      }
      data = await res.json();
      break; // success — stop trying
    } catch (e) {
      lastErr = e;
    }
  }

  try {
    if (!data) throw lastErr || new Error('All models unavailable');
    const parts = (data?.candidates?.[0]?.content?.parts) || [];
    const textPart = parts.find(p => p.text && !p.thought) || parts[parts.length - 1] || {};
    const text = textPart.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    _finReceiptData = JSON.parse(match[0]);
    // Carry the scanned currency into the receipt data so displays are consistent
    if (!_finReceiptData.currency) _finReceiptData.currency = _finCurrency;
    if (_finReceiptData.merchant) _finSetVal('fin-tx-merchant', _finReceiptData.merchant);
    if (_finReceiptData.date)     _finSetVal('fin-tx-date', _finReceiptData.date);
    if (_finReceiptData.category) _finSetVal('fin-tx-category', _finReceiptData.category);
    if (_finReceiptData.total)    _finSetVal('fin-tx-amount', _finReceiptData.total.toFixed(2));

    const items = _finReceiptData.items || [];
    const MAX_ITEMS = 3;
    let desc = _finReceiptData.merchant || 'Receipt';
    if (items.length > 0) {
      const shown = items.slice(0, MAX_ITEMS).map(it => it.name).join(', ');
      const extra = items.length > MAX_ITEMS ? ` & ${items.length - MAX_ITEMS} more` : '';
      desc = desc + ' — ' + shown + extra;
    }
    _finSetVal('fin-tx-desc', desc);

    _finSetVal('fin-tx-currency', _finCurrency);
    _finUpdateConvertBtn();

    _finRenderReceiptPreview(_finReceiptData,
      document.getElementById('fin-receipt-preview'),
      document.getElementById('fin-receipt-preview-manual'));

    if (status) { status.textContent = '✓ Scanned — converting to AUD…'; }
    if (btn) { btn.textContent = 'Rescan'; btn.disabled = false; }

    if (_finCurrency !== 'AUD' && _finReceiptData.total) {
      const receiptDate = _finReceiptData.date || new Date().toISOString().slice(0, 10);
      try {
        const { aud, rateDate } = await _finFetchAUDRate(_finCurrency, _finReceiptData.total, receiptDate);
        _finSetVal('fin-tx-amount', aud.toFixed(2));
        _finSetVal('fin-tx-currency', 'AUD');
        _finUpdateConvertBtn();
        const convertStatus = document.getElementById('fin-convert-status');
        if (convertStatus) convertStatus.textContent =
          `${_finReceiptData.total} ${_finCurrency} = ${aud.toFixed(2)} AUD  (rate on ${rateDate}${_finReceiptData.time ? ' at ' + _finReceiptData.time : ''})`;
        if (status) status.textContent = '✓ Scanned & converted to AUD';
      } catch (e) {
        if (status) status.textContent = '✓ Scanned — could not auto-convert (use button below)';
        console.warn('[finScanReceipt] auto-convert failed:', e);
      }
    } else {
      if (status) status.textContent = '✓ Receipt scanned — review below';
    }

    // Switch to manual tab to review/confirm
    setTimeout(() => _finModalTabSwitch('manual'), 500);

  } catch (e) {
    console.error('[finance] scan error:', e);
    const msg = e?.message || '';
    const isUnavailable = msg.includes('503') || msg.includes('429') || msg.includes('unavailable');
    if (status) {
      status.textContent = isUnavailable
        ? 'Gemini is overloaded right now — try again in a moment.'
        : 'Could not read receipt. Fill in manually.';
    }
    if (btn) { btn.textContent = '✨ Scan receipt'; btn.disabled = false; }
    if (!isUnavailable) _finModalTabSwitch('manual');
  }
}

function _finRenderReceiptPreview(d, ...targets) {
  if (!d) return;
  const currency = d.currency || _finCurrency || 'AUD';
  const sym = currency + ' ';
  const items = (d.items || []).map(it =>
    `<div class="fin-receipt-item"><span>${_finEsc(it.name)}</span><span>${sym}${_finFmt(it.price || 0)}</span></div>`
  ).join('');
  const subtotal = d.subtotal != null ? `<div class="fin-receipt-item"><span>Subtotal</span><span>${sym}${_finFmt(d.subtotal)}</span></div>` : '';
  const tax = d.tax ? `<div class="fin-receipt-item"><span>Tax / GST</span><span>${sym}${_finFmt(d.tax)}</span></div>` : '';
  const when = [d.date, d.time].filter(Boolean).join(' ');
  const html = `
    <div class="fin-receipt-preview-title">
      ${_finEsc(d.merchant || 'Unknown')}
      ${when ? `<span style="font-size:11px;opacity:.6;margin-left:6px">${_finEsc(when)}</span>` : ''}
      <span style="font-size:11px;opacity:.6;margin-left:4px">(${_finEsc(currency)})</span>
    </div>
    <div class="fin-receipt-items">${items}${subtotal}${tax}</div>
    ${d.total != null ? `<div class="fin-receipt-total"><span>Total</span><span>${sym}${_finFmt(d.total)}</span></div>` : ''}`;
  const els = targets.length ? targets : [document.getElementById('fin-receipt-preview')];
  els.forEach(el => { if (el) { el.innerHTML = html; el.style.display = 'block'; } });
}

function _finSetToggle(type, expId, incId) {
  const e = document.getElementById(expId), i = document.getElementById(incId);
  if (e) e.className = 'fin-type-btn' + (type === 'expense' ? ' active-expense' : '');
  if (i) i.className = 'fin-type-btn' + (type === 'income' ? ' active-income' : '');
}
function finSetType(type)    { _finTxType = type;    _finSetToggle(type, 'fin-type-expense',     'fin-type-income'); }
function finSetRecType(type) { _finRecType = type;   _finSetToggle(type, 'fin-rec-type-expense', 'fin-rec-type-income'); }

function _finUpdateConvertBtn() {
  const currency = document.getElementById('fin-tx-currency')?.value || 'AUD';
  const row = document.getElementById('fin-convert-row');
  const status = document.getElementById('fin-convert-status');
  if (!row) return;
  row.style.display = (currency && currency !== 'AUD') ? 'block' : 'none';
  if (status) status.textContent = '';
}

async function _finFetchAUDRate(currency, amount, date) {
  const res = await fetch(
    `https://api.frankfurter.app/${date}?from=${encodeURIComponent(currency)}&to=AUD&amount=${amount}`
  );
  if (!res.ok) throw new Error('Rate fetch failed (' + res.status + ')');
  const data = await res.json();
  const aud = data?.rates?.AUD;
  if (!aud) throw new Error('AUD rate not in response');
  return { aud, rateDate: data.date };
}

async function finConvertToAUD() {
  const currency = document.getElementById('fin-tx-currency')?.value;
  const amtRaw = parseFloat(document.getElementById('fin-tx-amount')?.value || '0');
  const btn = document.getElementById('fin-convert-btn');
  const status = document.getElementById('fin-convert-status');

  if (!currency || currency === 'AUD') return;
  if (!amtRaw) { if (status) status.textContent = 'Enter an amount first.'; return; }
  if (btn) { btn.disabled = true; btn.textContent = 'Fetching rate…'; }
  if (status) status.textContent = '';

  const txDate = document.getElementById('fin-tx-date')?.value || new Date().toISOString().slice(0, 10);
  try {
    const { aud, rateDate } = await _finFetchAUDRate(currency, amtRaw, txDate);
    _finSetVal('fin-tx-amount', aud.toFixed(2));
    _finSetVal('fin-tx-currency', 'AUD');
    _finUpdateConvertBtn();
    if (status) status.textContent = `${amtRaw} ${currency} = ${aud.toFixed(2)} AUD  (rate on ${rateDate})`;
  } catch (e) {
    if (status) status.textContent = 'Could not fetch rate: ' + (e.message || e);
    console.error('[finConvertToAUD]', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↔ Convert to AUD'; }
  }
}
window.finConvertToAUD = finConvertToAUD;

async function finSaveTx() {
  const desc = (document.getElementById('fin-tx-desc')?.value || '').trim();
  const amtRaw = parseFloat(document.getElementById('fin-tx-amount')?.value || '0');
  const date = document.getElementById('fin-tx-date')?.value || new Date().toISOString().slice(0, 10);
  const category = document.getElementById('fin-tx-category')?.value || 'Other';
  const merchant = (document.getElementById('fin-tx-merchant')?.value || '').trim();
  const notes = (document.getElementById('fin-tx-notes')?.value || '').trim();
  const currency = document.getElementById('fin-tx-currency')?.value || _finCurrency || 'AUD';

  if (!desc) { showToast('Enter a description'); return; }
  if (!amtRaw) { showToast('Enter an amount'); return; }

  // Remember last-used currency for convenience
  _finCurrency = currency;

  const amount = _finTxType === 'expense' ? -Math.abs(amtRaw) : Math.abs(amtRaw);
  const account_id = document.getElementById('fin-tx-account')?.value || _finAccounts[0]?.id || null;
  const btn = document.getElementById('fin-tx-save-btn');
  if (btn) btn.disabled = true;

  try {
    let result;
    if (_finEditTxId) {
      result = await supabase.finUpdateTransaction(_finEditTxId, { description: desc, amount, date, category, merchant, notes, currency, account_id });
    } else {
      result = await supabase.finInsertTransaction({ account_id, description: desc, amount, date, category, merchant, notes, currency, receipt_data: _finReceiptData });
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
    if (btn) btn.disabled = false;
  }
}

function openFinTxDetail(id) {
  const tx = _finTransactions.find(t => t.id === id);
  if (!tx) return;
  _finEditTxId = id;

  const amt = parseFloat(tx.amount) || 0;
  _finTxType = amt >= 0 ? 'income' : 'expense';

  _finPhotoBase64 = null; _finPhotoMime = null;
  _finReceiptData = tx.receipt_data || null;
  _finResetPhotoPanel();
  const rpManual = document.getElementById('fin-receipt-preview-manual');
  if (_finReceiptData) _finRenderReceiptPreview(_finReceiptData, rpManual);
  else if (rpManual) rpManual.style.display = 'none';

  _finSetVal('fin-tx-desc', tx.description || '');
  _finSetVal('fin-tx-amount', Math.abs(amt).toFixed(2));
  _finSetVal('fin-tx-currency', tx.currency || _finCurrency || 'AUD');
  _finUpdateConvertBtn();
  _finSetVal('fin-tx-date', tx.date || '');
  _finSetVal('fin-tx-category', tx.category || '');
  _finSetVal('fin-tx-merchant', tx.merchant || '');
  _finSetVal('fin-tx-notes', tx.notes || '');
  finSetType(_finTxType);

  const delBtn = document.getElementById('fin-tx-delete-btn');
  if (delBtn) { delBtn.style.display = 'block'; delBtn.textContent = 'Delete transaction'; delete delBtn.dataset.confirming; }

  _finModalTabSwitch('manual');
  document.getElementById('fin-tx-modal')?.classList.add('open');
  _finPopulateAccountSelect(tx.account_id || _finAccounts[0]?.id || '');
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
window.finModalTab            = finModalTab;
window.finPhotoSelected       = finPhotoSelected;
window.finScanReceipt         = finScanReceipt;
window.finSaveTx              = finSaveTx;
window.finDeleteTx            = finDeleteTx;
window.finSetType             = finSetType;
window.openFinTxDetail        = openFinTxDetail;
window.openFinRecModal        = openFinRecModal;
window.closeFinRecModal       = closeFinRecModal;
window.finSaveRec             = finSaveRec;
window.finDeleteRec           = finDeleteRec;
window.finSetRecType          = finSetRecType;
