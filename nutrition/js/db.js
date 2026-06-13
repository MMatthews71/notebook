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

  // Re-sync today's food logs → refresh the UI
  try {
    if (typeof todayFoodLogs !== 'undefined' && typeof getActiveDateStr === 'function') {
      todayFoodLogs = await supabase.getFoodLogs(getActiveDateStr());
      if (typeof renderNutritionTab === 'function') renderNutritionTab();
    }
  } catch {}

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


supabase.insertFoodLog = async function(entry) {
  const row = { ...entry, user_id: ANON_USER_ID };
  const result = await supabase.from('food_logs').insert(row);
  // If cost column doesn't exist yet, retry without it
  if (result.error && result.error.message && result.error.message.includes('cost')) {
    const { cost, ...rowNoCost } = row;
    return supabase.from('food_logs').insert(rowNoCost);
  }
  return result;
};

supabase.deleteFoodLog = async function(id) {
  return supabase.from('food_logs').eq('id', id).delete();
};


// ── PANTRY ITEMS ──────────────────────────────
// Required Supabase table (run once in SQL editor):
//
// CREATE TABLE IF NOT EXISTS pantry_items (
//   id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
//   user_id uuid DEFAULT '00000000-0000-0000-0000-000000000001',
//   name text NOT NULL,
//   quantity float DEFAULT 0,
//   unit text DEFAULT 'g',
//   cost_per_unit float DEFAULT 0,
//   cal_per_unit float DEFAULT 0,
//   protein_per_unit float DEFAULT 0,
//   carbs_per_unit float DEFAULT 0,
//   fat_per_unit float DEFAULT 0,
//   fiber_per_unit float DEFAULT 0,
//   sodium_per_unit float DEFAULT 0,
//   created_at timestamptz DEFAULT now(),
//   updated_at timestamptz DEFAULT now()
// );
// ALTER TABLE food_logs ADD COLUMN IF NOT EXISTS cost decimal(10,2) DEFAULT 0;

supabase.getPantryItems = async function() {
  const { data, error } = await supabase.from('pantry_items')
    .select('*').eq('user_id', ANON_USER_ID).order('name');
  if (error) { console.error('getPantryItems', error); return []; }
  return data || [];
};

supabase.upsertPantryItem = async function(item) {
  const row = { ...item, user_id: ANON_USER_ID, updated_at: new Date().toISOString() };
  if (row.id) {
    const { data, error } = await supabase.from('pantry_items').eq('id', row.id).update(row);
    return { data, error };
  } else {
    delete row.id;
    const { data, error } = await supabase.from('pantry_items').insert(row);
    return { data, error };
  }
};

supabase.deletePantryItem = async function(id) {
  const { error } = await supabase.from('pantry_items').eq('id', id).delete();
  return { error };
};
