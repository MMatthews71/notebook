// ─────────────────────────────────────────────
//  SUPABASE CONFIG
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://ozfwtvrdcxpykfaqlfhl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Znd0dnJkY3hweWtmYXFsZmhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDYwMjAsImV4cCI6MjA5MDk4MjAyMH0.n3EAR6jUl9sfJG0LEZVA7J6wNr3tLRyff2C9oPxh4tw';

// ─────────────────────────────────────────────
//  OFFLINE CACHE & QUEUE
// ─────────────────────────────────────────────
const _OC = 'oc_'; // localStorage prefix

// Simple numeric hash → short key
function _urlKey(url) {
  let h = 0;
  for (let i = 0; i < url.length; i++) h = (Math.imul(31, h) + url.charCodeAt(i)) | 0;
  return _OC + (h >>> 0).toString(36);
}
function _cacheGet(url) {
  try { const r = localStorage.getItem(_urlKey(url)); return r ? JSON.parse(r) : null; } catch { return null; }
}
function _cacheSet(url, data) {
  try { localStorage.setItem(_urlKey(url), JSON.stringify(data)); } catch {}
}

const _QUEUE_KEY = _OC + 'queue';
function _queueGet() { try { return JSON.parse(localStorage.getItem(_QUEUE_KEY) || '[]'); } catch { return []; } }
function _queueSave(q) { try { localStorage.setItem(_QUEUE_KEY, JSON.stringify(q)); } catch {} }
function _queueAdd(method, url, body, extraHeaders) {
  const q = _queueGet();
  q.push({ method, url, body, extraHeaders, ts: Date.now() });
  _queueSave(q);
}

// Will be set by the IIFE below once _doFetch is in scope
let _doFetch = null;

// Called when the browser regains connectivity — replay all queued writes
async function _flushOfflineQueue() {
  if (!_doFetch) return;
  const q = _queueGet();
  if (!q.length) return;
  _queueSave([]); // optimistic clear so new writes aren't re-added
  let failures = 0;
  for (const item of q) {
    const { error } = await _doFetch(item.method, item.url, item.body, item.extraHeaders);
    if (error) { failures++; console.warn('[offline] flush failed:', item.method, item.url, error); }
  }

  // Re-sync primary tables from Supabase → refresh IDB and in-memory state
  try {
    const base = `${SUPABASE_URL}/rest/v1`;
    const [gR, hR, cR, tR] = await Promise.all([
      _doFetch('GET', `${base}/goals?select=*&order=created_at`),
      _doFetch('GET', `${base}/habits?select=*&order=created_at`),
      _doFetch('GET', `${base}/completions?select=*`),
      _doFetch('GET', `${base}/todos?select=*&order=created_at`),
    ]);
    if (gR.data) {
      IDB.replaceAll('goals', gR.data).catch(() => {});
      if (typeof goals !== 'undefined') goals = gR.data;
    }
    if (tR.data) {
      IDB.replaceAll('todos', tR.data).catch(() => {});
      if (typeof todos !== 'undefined')
        todos = tR.data.map(t => typeof parseTodoRow === 'function' ? parseTodoRow(t) : t);
    }
    if (hR.data && cR.data) {
      IDB.replaceAll('habits',      hR.data).catch(() => {});
      IDB.replaceAll('completions', cR.data).catch(() => {});
      if (typeof habits !== 'undefined') {
        habits = hR.data.map(h => {
          const hc = cR.data.filter(c => c.habit_id === h.id);
          return {
            ...h,
            doneCounts:    hc.reduce((acc, c) => { acc[c.date] = (acc[c.date] || 0) + 1; return acc; }, {}),
            completionIds: hc.reduce((acc, c) => { (acc[c.date] = acc[c.date] || []).push(c.id); return acc; }, {}),
          };
        });
      }
    }
  } catch {}

  try { if (typeof renderTodo  === 'function') renderTodo();  } catch {}
  try { if (typeof renderGoals === 'function') renderGoals(); } catch {}
  try { if (typeof syncJournalFromCloud === 'function') await syncJournalFromCloud(); } catch {}
  const msg = failures ? `Sync: ${q.length - failures}/${q.length} sent` : '☁️ Synced';
  try { if (typeof showToast === 'function') showToast(msg); } catch {}
}

window.addEventListener('online',  () => {
  console.log('[offline] back online — flushing queue');
  _flushOfflineQueue();
});
window.addEventListener('offline', () => {
  console.log('[offline] went offline');
  try { if (typeof showToast === 'function') showToast('Offline — changes saved locally'); } catch {}
});

// ─────────────────────────────────────────────
//  IDB QUERY HELPERS
// ─────────────────────────────────────────────
function _parsedFilters(filterStrings) {
  return filterStrings.map(f => {
    let m;
    if ((m = f.match(/^([^=]+)=eq\.(.*)$/)))     { const [,col,val]=m, dv=decodeURIComponent(val); return r => r[col]!=null ? String(r[col])===dv : dv==='null'; }
    if ((m = f.match(/^([^=]+)=in\.\((.+)\)$/))) { const [,col,vs]=m,  arr=vs.split(',').map(decodeURIComponent); return r => arr.includes(String(r[col])); }
    if ((m = f.match(/^([^=]+)=gte\.(.*)$/)))    { const [,col,val]=m, dv=decodeURIComponent(val); return r => String(r[col]??'') >= dv; }
    if ((m = f.match(/^([^=]+)=lt\.(.*)$/)))     { const [,col,val]=m, dv=decodeURIComponent(val); return r => String(r[col]??'')  < dv; }
    return () => true;
  });
}

function _idbFilter(records, filterStrings) {
  if (!filterStrings.length) return records;
  const preds = _parsedFilters(filterStrings);
  return records.filter(r => preds.every(p => p(r)));
}

function _idbOrder(records, orders) {
  if (!orders || !orders.length) return records;
  return [...records].sort((a, b) => {
    for (const ord of orders) {
      const desc = ord.endsWith('.desc');
      const col  = desc ? ord.slice(0, -5) : ord;
      const av = a[col], bv = b[col];
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      if (cmp !== 0) return desc ? -cmp : cmp;
    }
    return 0;
  });
}

async function _idbRead(table, filters, orders, limit) {
  let rows = await IDB.getAll(table);
  rows = _idbFilter(rows, filters);
  rows = _idbOrder(rows, orders);
  if (limit != null) rows = rows.slice(0, limit);
  return rows;
}

async function _idbApplyUpdate(table, filterStrings, patch) {
  const records = await IDB.getAll(table);
  const preds   = _parsedFilters(filterStrings);
  const updated = records.filter(r => preds.every(p => p(r))).map(r => ({ ...r, ...patch }));
  if (updated.length) await IDB.putMany(table, updated);
  return updated;
}

async function _idbApplyDelete(table, filterStrings) {
  const preds = _parsedFilters(filterStrings);
  await IDB.delWhere(table, r => preds.every(p => p(r)));
}

// ─────────────────────────────────────────────
//  SUPABASE CLIENT (Inline Fetch)
// ─────────────────────────────────────────────
const supabase = (() => {
  /**
   * Performs a fetch to Supabase REST API.
   * Always returns { data, error } – never throws.
   * Aborts after REQUEST_TIMEOUT_MS so the app can't hang on network issues.
   *
   * Auth: uses the current user's JWT when available (set by auth.js),
   * falling back to the anon key for unauthenticated calls.
   */
  const REQUEST_TIMEOUT_MS = 30000;

  // Core fetch — no offline logic, used by flush replays too.
  // Exposed to outer scope via the module-level _doFetch variable.
  _doFetch = async function _doFetch(method, url, body, extraHeaders = {}) {
    const token = (typeof authGetCurrentToken === 'function')
      ? authGetCurrentToken()
      : SUPABASE_ANON_KEY;
    const headers = {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const controller = new AbortController();
    options.signal = controller.signal;
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(url, options);
      clearTimeout(timer);
      if (res.status === 204) return { data: null, error: null };
      if (!res.ok) {
        let errText = '';
        try { errText = await res.text(); } catch {}
        return { data: null, error: new Error(`Supabase error ${res.status}: ${errText}`) };
      }
      const text = await res.text();
      const data = text ? JSON.parse(text) : [];
      return { data, error: null };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        return { data: null, error: new Error(`Supabase timeout (${REQUEST_TIMEOUT_MS}ms): ${method} ${url}`) };
      }
      return { data: null, error: err };
    }
  }

  // Public request — adds offline cache/queue logic
  async function request(method, url, body, extraHeaders = {}) {
    const isRead = method === 'GET';

    // ── OFFLINE (or not connected) ────────────
    if (!navigator.onLine) {
      if (isRead) {
        const cached = _cacheGet(url);
        return { data: cached ?? [], error: null };
      }
      _queueAdd(method, url, body, extraHeaders);
      return { data: null, error: null }; // optimistic success
    }

    // ── ONLINE: attempt fetch ─────────────────
    const result = await _doFetch(method, url, body, extraHeaders);

    if (result.error) {
      // Network/fetch failure — treat as offline for writes
      if (!isRead) {
        _queueAdd(method, url, body, extraHeaders);
        return { data: null, error: null }; // optimistic success
      }
      // Read failure — serve cache if available
      const cached = _cacheGet(url);
      if (cached !== null) return { data: cached, error: null };
      return result;
    }

    // ── SUCCESS ──────────────────────────────
    // Cache all successful GET responses
    if (isRead && result.data !== null) {
      _cacheSet(url, result.data);
    }
    return result;
  }

  return {
    from(table) {
      return {
        _table: table,
        _select: '*',
        _filters: [],
        _orders: [],   // supports multiple order() calls
        _limit: null,

        select(cols = '*') { this._select = cols; return this; },
        order(col, { ascending = true } = {}) {
          this._orders.push(ascending ? col : `${col}.desc`);
          return this;
        },
        eq(col, val)  { this._filters.push(`${col}=eq.${encodeURIComponent(val)}`);  return this; },
        in(col, vals) {
          const encoded = vals.map(v => encodeURIComponent(v)).join(',');
          this._filters.push(`${col}=in.(${encoded})`);
          return this;
        },
        gte(col, val) { this._filters.push(`${col}=gte.${encodeURIComponent(val)}`); return this; },
        lt(col, val)  { this._filters.push(`${col}=lt.${encodeURIComponent(val)}`);  return this; },
        limit(n) { this._limit = n; return this; },

        // Build URL from current state. `skipSelect` excludes the select=*
        // param — needed for DELETE since PostgREST may reject it without
        // a matching Prefer: return=representation header.
        _buildUrl(skipSelect = false) {
          let url = `${SUPABASE_URL}/rest/v1/${this._table}`;
          const params = [];
          if (!skipSelect && this._select) params.push(`select=${this._select}`);
          this._filters.forEach(f => params.push(f));
          if (this._orders.length) params.push(`order=${this._orders.join(',')}`);
          if (this._limit != null) params.push(`limit=${this._limit}`);
          if (params.length) url += '?' + params.join('&');
          return url;
        },

        // GET — serve from IDB when offline; cache to IDB on every successful fetch
        async then(resolve, reject) {
          const { _table: t, _filters: f, _orders: o, _limit: l } = this;
          if (!navigator.onLine) {
            try { resolve({ data: await _idbRead(t, f, o, l), error: null }); }
            catch  { resolve({ data: [], error: null }); }
            return;
          }
          const { data, error } = await request('GET', this._buildUrl());
          if (error) {
            try { resolve({ data: await _idbRead(t, f, o, l), error: null }); }
            catch  { reject(error); }
            return;
          }
          if (data) IDB.putMany(t, data).catch(() => {});
          resolve({ data, error: null });
        },

        insert(rows) {
          const self   = this;
          const rowsArr = Array.isArray(rows) ? rows : [rows];
          // Assign client UUIDs to rows that need a simple 'id' key
          if (!IDB.COMPOUND_KEYS[self._table] && !IDB.KEY_PATHS[self._table]) {
            rowsArr.forEach(r => { if (!r.id) r.id = crypto.randomUUID(); });
          }
          const now   = new Date().toISOString();
          const local = rowsArr.map(r => ({ created_at: now, ...r }));
          IDB.putMany(self._table, local).catch(() => {});

          const _run = async () => {
            const url = self._buildUrl();
            const { data, error } = await request('POST', url, rowsArr, { Prefer: 'return=representation' });
            if (error) return { data: null, error };
            if (data && data.length) IDB.putMany(self._table, data).catch(() => {});
            // When offline/queued, data is null — return the local optimistic records instead
            return { data: data || local, error: null };
          };
          const p = _run();
          return {
            then(res, rej) { return p.then(res, rej); },
            catch(rej)     { return p.catch(rej); },
            select()       { return { then(res, rej) { return p.then(res, rej); } }; },
          };
        },

        update(patch) {
          const self = this;
          const _run = async () => {
            // Apply patch to IDB first so offline reads stay fresh
            const idbResult = await _idbApplyUpdate(self._table, self._filters, patch).catch(() => null);
            const url = self._buildUrl();
            const { data, error } = await request('PATCH', url, patch, { Prefer: 'return=representation' });
            if (error) return { data: null, error };
            if (data && data.length) IDB.putMany(self._table, data).catch(() => {});
            // When offline/queued, data is null — return IDB-patched records as fallback
            return { data: data || idbResult, error: null };
          };
          const p = _run();
          return {
            then(res, rej) { return p.then(res, rej); },
            catch(rej)     { return p.catch(rej); },
            select()       { return { then(res, rej) { return p.then(res, rej); } }; },
          };
        },

        async delete() {
          // Remove from IDB immediately so offline reads don't return stale data
          _idbApplyDelete(this._table, this._filters).catch(() => {});
          const url = this._buildUrl(true); // exclude select=* — PostgREST rejects it on DELETE
          const { data, error } = await request('DELETE', url);
          if (error) return { data: null, error };
          return { data: null, error: null };
        },

        // Upsert bypasses _buildUrl() so select=* is never included
        async upsert(rows, opts = {}) {
          const onConflict = opts.onConflict || 'id';
          const rowsArr = Array.isArray(rows) ? rows : [rows];
          IDB.putMany(this._table, rowsArr).catch(() => {});
          const url = `${SUPABASE_URL}/rest/v1/${this._table}?on_conflict=${onConflict}`;
          const { data, error } = await request('POST', url, rowsArr, {
            Prefer: 'return=representation,resolution=merge-duplicates',
            'Content-Type': 'application/json',
          });
          if (error) return { data: null, error };
          if (data && data.length) IDB.putMany(this._table, data).catch(() => {});
          return { data: data?.[0] || null, error: null };
        },

        async maybeSingle() {
          const { _table: t, _filters: f } = this;
          if (!navigator.onLine) {
            try {
              const rows = await _idbRead(t, f, [], 1);
              return { data: rows?.[0] || null, error: null };
            } catch { return { data: null, error: null }; }
          }
          const base = this._buildUrl();
          const url  = base + (base.includes('?') ? '&' : '?') + 'limit=1';
          const { data, error } = await request('GET', url);
          if (error) {
            try {
              const rows = await _idbRead(t, f, [], 1);
              return { data: rows?.[0] || null, error: null };
            } catch { return { data: null, error }; }
          }
          const single = data?.[0] || null;
          if (single) IDB.put(t, single).catch(() => {});
          return { data: single, error: null };
        },
      };
    },
  };
})();

// ── DAILY ORDERS, FLEX OVERRIDES, SKIPPED HABITS, TEMPLATES, PREFERENCES, ANALYSES ──
// All these now work because the underlying chain works.

supabase.upsertDailyOrder = async function (date, itemId, itemType, sortOrder) {
  const { error } = await supabase.from('daily_orders')
    .upsert({ date, item_id: itemId, item_type: itemType, sort_order: sortOrder },
      { onConflict: 'date,item_id,item_type' });
  if (error) console.error('upsertDailyOrder', error);
};

supabase.fetchDailyOrders = async function (date) {
  const { data, error } = await supabase.from('daily_orders')
    .select('*').eq('date', date);
  if (error) { console.error('fetchDailyOrders', error); return []; }
  const orders = {};
  (data || []).forEach(row => {
    if (!orders[row.item_type]) orders[row.item_type] = {};
    orders[row.item_type][row.item_id] = row.sort_order;
  });
  return orders;
};

supabase.toggleFlexOverride = async function (habitId, date, active = true) {
  if (!active) {
    await supabase.from('flex_overrides').delete().eq('habit_id', habitId).eq('date', date);
  } else {
    await supabase.from('flex_overrides').upsert({ habit_id: habitId, date }, { onConflict: 'habit_id,date' });
  }
};

supabase.fetchFlexOverrides = async function (date) {
  const { data, error } = await supabase.from('flex_overrides')
    .select('habit_id').eq('date', date);
  if (error) { console.error('fetchFlexOverrides', error); return {}; }
  const overrides = {};
  (data || []).forEach(row => overrides[row.habit_id] = true);
  return overrides;
};

supabase.toggleSkippedHabit = async function (habitId, date, skip = true) {
  if (!skip) {
    await supabase.from('skipped_habits').delete().eq('habit_id', habitId).eq('date', date);
  } else {
    await supabase.from('skipped_habits').upsert({ habit_id: habitId, date }, { onConflict: 'habit_id,date' });
  }
};

supabase.fetchSkippedHabits = async function (date) {
  const { data, error } = await supabase.from('skipped_habits')
    .select('habit_id').eq('date', date);
  if (error) { console.error('fetchSkippedHabits', error); return {}; }
  const skipped = {};
  (data || []).forEach(row => skipped[row.habit_id] = true);
  return skipped;
};

supabase.fetchTemplates = async function () {
  const { data, error } = await supabase.from('todo_templates').select('*');
  if (error) { console.error('fetchTemplates', error); return []; }
  return data || [];
};

supabase.saveTemplate = async function (template) {
  const { data, error } = await supabase.from('todo_templates').insert(template);
  if (error) throw error;
  return data;
};

supabase.deleteTemplate = async function (templateId) {
  await supabase.from('todo_templates').delete().eq('id', templateId);
};

const ANON_USER_ID = '00000000-0000-0000-0000-000000000001';

supabase.getPref = async function (key) {
  const { data } = await supabase.from('user_preferences')
    .select('value').eq('key', key).eq('user_id', ANON_USER_ID).maybeSingle();
  return data?.value ?? null;
};

supabase.setPref = async function (key, value) {
  // Manual upsert: no ON CONFLICT constraint required
  const existing = await supabase.getPref(key);
  if (existing !== null) {
    await supabase.from('user_preferences')
      .eq('user_id', ANON_USER_ID).eq('key', key)
      .update({ value });
  } else {
    await supabase.from('user_preferences')
      .insert({ user_id: ANON_USER_ID, key, value });
  }
};

supabase.saveAnalysis = async function (entryId, analysis) {
  await supabase.from('journal_analyses')
    .upsert({ entry_id: entryId, analysis, analysed_at: new Date().toISOString() }, { onConflict: 'entry_id' });
};

supabase.fetchAnalysis = async function (entryId) {
  const { data } = await supabase.from('journal_analyses')
    .select('analysis').eq('entry_id', entryId).maybeSingle();
  return data?.analysis || null;
};

// ── GOAL PARENTS (many-to-many) ──────────────
supabase.getGoalParents = async function() {
  const { data } = await supabase.from('goal_parents')
    .select('*').eq('user_id', ANON_USER_ID);
  return data || [];
};

supabase.setGoalParents = async function(goalId, parentIds) {
  // Replace all parent links for this goal: delete existing, insert new
  await supabase.from('goal_parents').eq('goal_id', goalId).eq('user_id', ANON_USER_ID).delete();
  const filtered = (parentIds || []).filter(pid => pid && pid !== goalId);
  if (filtered.length === 0) return { data: [], error: null };
  const rows = filtered.map(pid => ({ goal_id: goalId, parent_id: pid, user_id: ANON_USER_ID }));
  return supabase.from('goal_parents').insert(rows);
};

supabase.removeAllGoalParentLinks = async function(goalId) {
  // Used on goal deletion — removes both (goalId as child) and (goalId as parent) links
  await supabase.from('goal_parents').eq('goal_id', goalId).eq('user_id', ANON_USER_ID).delete();
  await supabase.from('goal_parents').eq('parent_id', goalId).eq('user_id', ANON_USER_ID).delete();
};

// ── NUTRITION ────────────────────────────────
supabase.getNutritionProfile = async function() {
  const { data } = await supabase.from('nutrition_profile')
    .select('*').eq('user_id', ANON_USER_ID).maybeSingle();
  return data || null;
};

supabase.upsertNutritionProfile = async function(profile) {
  const existing = await supabase.getNutritionProfile();
  const row = { ...profile, user_id: ANON_USER_ID, updated_at: new Date().toISOString() };
  if (existing) {
    return supabase.from('nutrition_profile').eq('user_id', ANON_USER_ID).update(row);
  } else {
    return supabase.from('nutrition_profile').insert(row);
  }
};

supabase.getFoodLogs = async function(date) {
  const { data } = await supabase.from('food_logs')
    .select('*').eq('user_id', ANON_USER_ID).eq('date', date)
    .order('created_at', { ascending: true });
  return data || [];
};

supabase.getFoodLogsPast = async function(sinceDate) {
  const d = new Date();
  const today = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  const { data } = await supabase.from('food_logs')
    .select('*').eq('user_id', ANON_USER_ID)
    .gte('date', sinceDate)
    .lt('date', today)
    .order('date', { ascending: false })
    .order('created_at', { ascending: true });
  return data || [];
};

supabase.insertFoodLog = async function(entry) {
  return supabase.from('food_logs').insert({ ...entry, user_id: ANON_USER_ID });
};

supabase.deleteFoodLog = async function(id) {
  return supabase.from('food_logs').eq('id', id).delete();
};

supabase.getSavedMeals = async function() {
  const { data } = await supabase.from('saved_meals')
    .select('*').eq('user_id', ANON_USER_ID).order('name', { ascending: true });
  return data || [];
};

supabase.upsertSavedMeal = async function(meal) {
  const row = { ...meal, user_id: ANON_USER_ID, updated_at: new Date().toISOString() };
  if (row.id) {
    return supabase.from('saved_meals').eq('id', row.id).eq('user_id', ANON_USER_ID).update(row);
  } else {
    delete row.id;
    return supabase.from('saved_meals').insert(row);
  }
};

supabase.deleteSavedMeal = async function(id) {
  return supabase.from('saved_meals').eq('id', id).eq('user_id', ANON_USER_ID).delete();
};

// ── FINANCE ──────────────────────────────────

supabase.finGetAccounts = async function() {
  const { data } = await supabase.from('finance_accounts')
    .select('*').eq('user_id', ANON_USER_ID).order('created_at', { ascending: true });
  return data || [];
};

supabase.finInsertAccount = async function(acc) {
  return supabase.from('finance_accounts').insert({ ...acc, user_id: ANON_USER_ID });
};

supabase.finUpdateAccount = async function(id, patch) {
  return supabase.from('finance_accounts').eq('id', id).eq('user_id', ANON_USER_ID).update(patch);
};

supabase.finDeleteAccount = async function(id) {
  return supabase.from('finance_accounts').eq('id', id).eq('user_id', ANON_USER_ID).delete();
};

supabase.finGetTransactions = async function() {
  const { data } = await supabase.from('finance_transactions')
    .select('*').eq('user_id', ANON_USER_ID)
    .order('date', { ascending: false }).order('created_at', { ascending: false })
    .limit(200);
  return data || [];
};

supabase.finInsertTransaction = async function(tx) {
  return supabase.from('finance_transactions').insert({ ...tx, user_id: ANON_USER_ID });
};

supabase.finUpdateTransaction = async function(id, patch) {
  return supabase.from('finance_transactions').eq('id', id).eq('user_id', ANON_USER_ID).update(patch);
};

supabase.finDeleteTransaction = async function(id) {
  return supabase.from('finance_transactions').eq('id', id).eq('user_id', ANON_USER_ID).delete();
};

supabase.finGetRecurring = async function() {
  const { data } = await supabase.from('finance_recurring')
    .select('*').eq('user_id', ANON_USER_ID).order('created_at', { ascending: true });
  return data || [];
};

supabase.finInsertRecurring = async function(rec) {
  return supabase.from('finance_recurring').insert({ ...rec, user_id: ANON_USER_ID });
};

supabase.finUpdateRecurring = async function(id, patch) {
  return supabase.from('finance_recurring').eq('id', id).eq('user_id', ANON_USER_ID).update(patch);
};

supabase.finDeleteRecurring = async function(id) {
  return supabase.from('finance_recurring').eq('id', id).eq('user_id', ANON_USER_ID).delete();
};