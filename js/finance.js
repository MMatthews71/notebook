// ─────────────────────────────────────────────
//  FINANCE TAB
//  Accounts · Receipt scanning · Transactions · Recurring
// ─────────────────────────────────────────────

// ── State ─────────────────────────────────────
let _finAccounts    = [];
let _finTransactions = [];
let _finRecurring   = [];
let _finPhotoBase64 = null;
let _finPhotoMime   = null;
let _finReceiptData = null;   // parsed from Gemini
let _finEditTxId    = null;   // null = new, string = editing
let _finEditRecId   = null;
let _finTxType      = 'expense'; // 'expense' | 'income'

const FIN_CATEGORIES = [
  'Food & Dining', 'Transport', 'Shopping', 'Bills & Utilities',
  'Entertainment', 'Health', 'Education', 'Travel', 'Income', 'Other',
];

const FIN_CAT_EMOJI = {
  'Food & Dining': '🍔', 'Transport': '🚗', 'Shopping': '🛍️',
  'Bills & Utilities': '💡', 'Entertainment': '🎬', 'Health': '💊',
  'Education': '📚', 'Travel': '✈️', 'Income': '💰', 'Other': '📋',
};

// ── DB helpers (wired to db.js pattern) ──────

async function _finLoadAccounts() {
  _finAccounts = await supabase.finGetAccounts();
}

async function _finLoadTransactions() {
  _finTransactions = await supabase.finGetTransactions();
}

async function _finLoadRecurring() {
  _finRecurring = await supabase.finGetRecurring();
}

// ── Init ──────────────────────────────────────

async function financeInit() {
  await Promise.all([_finLoadAccounts(), _finLoadTransactions(), _finLoadRecurring()]);
  renderFinanceTab();
}

// ── Render ────────────────────────────────────

function renderFinanceTab() {
  const el = document.getElementById('tab-finance');
  if (!el) return;

  if (_finAccounts.length === 0) {
    el.innerHTML = _finRenderSetup();
    return;
  }

  const onDesktop = window.matchMedia('(min-width: 768px)').matches;
  el.innerHTML =
    _finRenderAccounts() +
    (onDesktop ? '' : _finRenderTransactions()) +
    _finRenderRecurring();

  if (onDesktop) renderPanelFinance();
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
        const amtStr = (isIncome ? '+' : '−') + '$' + _finFmt(Math.abs(amt));
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
      <p>Add a bank account to start tracking<br>your balance, receipts & bills.</p>
      <button class="btn-primary" onclick="openFinAccountModal()">Add bank account</button>
      <button class="fin-text-btn" onclick="openAddTransactionModal()" style="margin-top:8px">Or scan a receipt first</button>
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
  const amtStr = (isIncome ? '+' : '-') + '$' + _finFmt(Math.abs(amt));
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

// ── Account Modal ────────────────────────────

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

async function deleteFinAccount() {
  const id = document.getElementById('fin-acc-id').value;
  if (!id) return;
  const btn = document.getElementById('fin-acc-delete-btn');
  if (btn.dataset.confirming) {
    try {
      await supabase.finDeleteAccount(id);
      await Promise.all([_finLoadAccounts(), _finLoadTransactions(), _finLoadRecurring()]);
      renderFinanceTab();
      closeFinAccountModal();
      showToast('Account deleted');
    } catch(e) { showToast('Error deleting'); }
  } else {
    btn.dataset.confirming = '1';
    btn.textContent = 'Confirm delete';
    setTimeout(() => { btn.textContent = 'Delete account'; delete btn.dataset.confirming; }, 3000);
  }
}

// ── Add Transaction Modal ────────────────────

function openAddTransactionModal() {
  _finEditTxId = null;
  _finPhotoBase64 = null;
  _finPhotoMime = null;
  _finReceiptData = null;
  _finTxType = 'expense';

  // Reset photo UI
  const drop = document.getElementById('fin-photo-drop');
  const preview = document.getElementById('fin-photo-preview');
  const scanBtn = document.getElementById('fin-scan-btn');
  const status = document.getElementById('fin-scan-status');
  const receiptPreview = document.getElementById('fin-receipt-preview');
  if (drop) drop.style.display = 'flex';
  if (preview) { preview.style.display = 'none'; preview.src = ''; }
  if (scanBtn) { scanBtn.style.display = 'none'; scanBtn.disabled = false; scanBtn.textContent = '✨ Scan receipt'; }
  if (status) { status.style.display = 'none'; status.textContent = ''; }
  if (receiptPreview) receiptPreview.style.display = 'none';

  // Reset manual form
  _finSetVal('fin-tx-desc', '');
  _finSetVal('fin-tx-amount', '');
  _finSetVal('fin-tx-merchant', '');
  _finSetVal('fin-tx-date', new Date().toISOString().slice(0, 10));
  _finSetVal('fin-tx-category', '');
  _finSetVal('fin-tx-notes', '');
  _finSetTypeBtn('expense');

  _finModalTabSwitch('photo');
  document.getElementById('fin-tx-modal')?.classList.add('open');
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

// ── Receipt Photo ────────────────────────────

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
    if (drop) drop.style.display = 'none';
    if (preview) { preview.src = dataUrl; preview.style.display = 'block'; }
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

  const prompt = `Analyse this receipt/invoice image and respond with ONLY a JSON object (no markdown, no extra text):
{
  "merchant": "store or business name",
  "date": "YYYY-MM-DD or null if unclear",
  "items": [{"name": "item name", "price": 0.00}],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00,
  "category": "one of: Food & Dining, Transport, Shopping, Bills & Utilities, Entertainment, Health, Education, Travel, Other"
}
Use null for any fields you cannot determine. All amounts should be positive numbers.`;

  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + key,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: prompt },
              { inline_data: { mime_type: _finPhotoMime, data: _finPhotoBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.1 },
        }),
      }
    );

    const data = await res.json();
    const parts = (data?.candidates?.[0]?.content?.parts) || [];
    const textPart = parts.find(p => p.text && !p.thought) || parts[parts.length - 1] || {};
    const text = textPart.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in response');

    _finReceiptData = JSON.parse(match[0]);
    _finRenderReceiptPreview(_finReceiptData);

    // Auto-fill manual form
    if (_finReceiptData.merchant) _finSetVal('fin-tx-merchant', _finReceiptData.merchant);
    if (_finReceiptData.date) _finSetVal('fin-tx-date', _finReceiptData.date);
    if (_finReceiptData.category) _finSetVal('fin-tx-category', _finReceiptData.category);
    if (_finReceiptData.total) _finSetVal('fin-tx-amount', _finReceiptData.total.toFixed(2));
    const desc = _finReceiptData.merchant || 'Receipt';
    _finSetVal('fin-tx-desc', desc);

    if (status) { status.textContent = '✓ Receipt scanned — review below'; }
    if (btn) { btn.textContent = 'Rescan'; btn.disabled = false; }

    // Switch to manual tab to review/confirm
    setTimeout(() => _finModalTabSwitch('manual'), 500);

  } catch (e) {
    console.error('[finance] scan error:', e);
    if (status) { status.textContent = 'Could not read receipt. Fill in manually.'; }
    if (btn) { btn.textContent = '✨ Scan receipt'; btn.disabled = false; }
    _finModalTabSwitch('manual');
  }
}

function _finRenderReceiptPreview(d) {
  const el = document.getElementById('fin-receipt-preview');
  if (!el || !d) return;

  const items = (d.items || []).map(it =>
    `<div class="fin-receipt-item"><span>${_finEsc(it.name)}</span><span>$${_finFmt(it.price || 0)}</span></div>`
  ).join('');

  const tax = d.tax ? `<div class="fin-receipt-item"><span>Tax / GST</span><span>$${_finFmt(d.tax)}</span></div>` : '';

  el.innerHTML = `
    <div class="fin-receipt-preview-title">Receipt from ${_finEsc(d.merchant || 'Unknown')}</div>
    <div class="fin-receipt-items">${items}${tax}</div>
    ${d.total != null ? `<div class="fin-receipt-total"><span>Total</span><span>$${_finFmt(d.total)}</span></div>` : ''}`;
  el.style.display = 'block';
}

// ── Transaction save / delete ────────────────

function _finSetTypeBtn(type) {
  _finTxType = type;
  const expBtn = document.getElementById('fin-type-expense');
  const incBtn = document.getElementById('fin-type-income');
  if (expBtn) expBtn.className = 'fin-type-btn' + (type === 'expense' ? ' active-expense' : '');
  if (incBtn) incBtn.className = 'fin-type-btn' + (type === 'income' ? ' active-income' : '');
}

function finSetType(type) { _finSetTypeBtn(type); }

async function finSaveTx() {
  const desc = (document.getElementById('fin-tx-desc')?.value || '').trim();
  const amtRaw = parseFloat(document.getElementById('fin-tx-amount')?.value || '0');
  const date = document.getElementById('fin-tx-date')?.value || new Date().toISOString().slice(0, 10);
  const category = document.getElementById('fin-tx-category')?.value || 'Other';
  const merchant = (document.getElementById('fin-tx-merchant')?.value || '').trim();
  const notes = (document.getElementById('fin-tx-notes')?.value || '').trim();

  if (!desc) { showToast('Enter a description'); return; }
  if (!amtRaw) { showToast('Enter an amount'); return; }

  const amount = _finTxType === 'expense' ? -Math.abs(amtRaw) : Math.abs(amtRaw);
  const account_id = _finAccounts[0]?.id || null;
  const receipt_data = _finReceiptData || null;

  const btn = document.getElementById('fin-tx-save-btn');
  if (btn) btn.disabled = true;

  try {
    if (_finEditTxId) {
      await supabase.finUpdateTransaction(_finEditTxId, { description: desc, amount, date, category, merchant, notes });
    } else {
      await supabase.finInsertTransaction({ account_id, description: desc, amount, date, category, merchant, notes, receipt_data });
    }
    await _finLoadTransactions();
    renderFinanceTab();
    closeFinTxModal();
    showToast(_finEditTxId ? 'Transaction updated' : 'Transaction saved');
  } catch (e) {
    showToast('Error saving transaction');
    console.error(e);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Transaction detail (tap existing) ────────

function openFinTxDetail(id) {
  const tx = _finTransactions.find(t => t.id === id);
  if (!tx) return;
  _finEditTxId = id;

  const amt = parseFloat(tx.amount) || 0;
  _finTxType = amt >= 0 ? 'income' : 'expense';

  _finPhotoBase64 = null;
  _finPhotoMime = null;
  _finReceiptData = tx.receipt_data || null;

  // Reset photo UI
  const drop = document.getElementById('fin-photo-drop');
  const preview = document.getElementById('fin-photo-preview');
  const scanBtn = document.getElementById('fin-scan-btn');
  const status = document.getElementById('fin-scan-status');
  if (drop) drop.style.display = 'flex';
  if (preview) { preview.style.display = 'none'; preview.src = ''; }
  if (scanBtn) scanBtn.style.display = 'none';
  if (status) { status.style.display = 'none'; }

  if (_finReceiptData) _finRenderReceiptPreview(_finReceiptData);
  else { const rp = document.getElementById('fin-receipt-preview'); if (rp) rp.style.display = 'none'; }

  _finSetVal('fin-tx-desc', tx.description || '');
  _finSetVal('fin-tx-amount', Math.abs(amt).toFixed(2));
  _finSetVal('fin-tx-date', tx.date || '');
  _finSetVal('fin-tx-category', tx.category || '');
  _finSetVal('fin-tx-merchant', tx.merchant || '');
  _finSetVal('fin-tx-notes', tx.notes || '');
  _finSetTypeBtn(_finTxType);

  const delBtn = document.getElementById('fin-tx-delete-btn');
  if (delBtn) { delBtn.style.display = 'block'; delBtn.textContent = 'Delete transaction'; delete delBtn.dataset.confirming; }

  _finModalTabSwitch('manual');
  document.getElementById('fin-tx-modal')?.classList.add('open');
}

async function finDeleteTx() {
  if (!_finEditTxId) return;
  const btn = document.getElementById('fin-tx-delete-btn');
  if (btn?.dataset.confirming) {
    try {
      await supabase.finDeleteTransaction(_finEditTxId);
      await _finLoadTransactions();
      renderFinanceTab();
      closeFinTxModal();
      showToast('Deleted');
    } catch (e) { showToast('Error deleting'); }
  } else {
    if (btn) { btn.dataset.confirming = '1'; btn.textContent = 'Confirm delete'; }
    setTimeout(() => { if (btn) { btn.textContent = 'Delete transaction'; delete btn.dataset.confirming; } }, 3000);
  }
}

// ── Recurring Modal ──────────────────────────

function openFinRecModal(id) {
  const existing = id ? _finRecurring.find(r => r.id === id) : null;
  _finEditRecId = id || null;

  _finSetVal('fin-rec-name', existing?.name || '');
  _finSetVal('fin-rec-amount', existing ? Math.abs(parseFloat(existing.amount) || 0).toFixed(2) : '');
  _finSetVal('fin-rec-category', existing?.category || '');
  _finSetVal('fin-rec-frequency', existing?.frequency || 'monthly');
  _finSetVal('fin-rec-due', existing?.next_due || '');

  const isIncome = existing ? parseFloat(existing.amount) >= 0 : false;
  _finRecType = isIncome ? 'income' : 'expense';
  const expBtn = document.getElementById('fin-rec-type-expense');
  const incBtn = document.getElementById('fin-rec-type-income');
  if (expBtn) expBtn.className = 'fin-type-btn' + (!isIncome ? ' active-expense' : '');
  if (incBtn) incBtn.className = 'fin-type-btn' + (isIncome ? ' active-income' : '');

  const delBtn = document.getElementById('fin-rec-delete-btn');
  if (delBtn) { delBtn.style.display = existing ? 'block' : 'none'; delBtn.textContent = 'Delete'; delete delBtn.dataset.confirming; }

  document.getElementById('fin-rec-modal')?.classList.add('open');
  document.getElementById('fin-rec-name')?.focus();
}

let _finRecType = 'expense';

function finSetRecType(type) {
  _finRecType = type;
  const expBtn = document.getElementById('fin-rec-type-expense');
  const incBtn = document.getElementById('fin-rec-type-income');
  if (expBtn) expBtn.className = 'fin-type-btn' + (type === 'expense' ? ' active-expense' : '');
  if (incBtn) incBtn.className = 'fin-type-btn' + (type === 'income' ? ' active-income' : '');
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
  const btn = document.getElementById('fin-rec-delete-btn');
  if (btn?.dataset.confirming) {
    try {
      await supabase.finDeleteRecurring(_finEditRecId);
      await _finLoadRecurring();
      renderFinanceTab();
      closeFinRecModal();
      showToast('Deleted');
    } catch (e) { showToast('Error deleting'); }
  } else {
    if (btn) { btn.dataset.confirming = '1'; btn.textContent = 'Confirm delete'; }
    setTimeout(() => { if (btn) { btn.textContent = 'Delete'; delete btn.dataset.confirming; } }, 3000);
  }
}

// ── Helpers ───────────────────────────────────

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
  const g = {};
  txs.forEach(tx => {
    const d = tx.date || tx.created_at?.slice(0, 10) || 'Unknown';
    if (!g[d]) g[d] = [];
    g[d].push(tx);
  });
  return g;
}

function _finFmtDate(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
    if (d.getTime() === today.getTime()) return 'Today';
    if (d.getTime() === yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: d.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
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

// ── Expose globals ────────────────────────────
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
