// ─────────────────────────────────────────────
//  SUPABASE CONFIG
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://ozfwtvrdcxpykfaqlfhl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Znd0dnJkY3hweWtmYXFsZmhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDYwMjAsImV4cCI6MjA5MDk4MjAyMH0.n3EAR6jUl9sfJG0LEZVA7J6wNr3tLRyff2C9oPxh4tw';

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
  async function request(method, url, body, extraHeaders = {}) {
    // Resolve auth token at call-time (not init-time) so it reflects the
    // current login state — auth.js exposes authGetCurrentToken() globally.
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
      // 204 No Content → success with no body
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

  return {
    from(table) {
      return {
        _table: table,
        _select: '*',
        _filters: [],
        _order: null,
        _limit: null,

        select(cols = '*') { this._select = cols; return this; },
        order(col, { ascending = true } = {}) {
          this._order = ascending ? col : `${col}.desc`;
          return this;
        },
        eq(col, val) { this._filters.push(`${col}=eq.${encodeURIComponent(val)}`); return this; },
        in(col, vals) {
          const encoded = vals.map(v => encodeURIComponent(v)).join(',');
          this._filters.push(`${col}=in.(${encoded})`);
          return this;
        },
        limit(n) { this._limit = n; return this; },

        // Build URL from current state. `skipSelect` excludes the select=*
        // param — needed for DELETE since PostgREST may reject it without
        // a matching Prefer: return=representation header.
        _buildUrl(skipSelect = false) {
          let url = `${SUPABASE_URL}/rest/v1/${this._table}`;
          const params = [];
          if (!skipSelect && this._select) params.push(`select=${this._select}`);
          this._filters.forEach(f => params.push(f));
          if (this._order) params.push(`order=${this._order}`);
          if (this._limit != null) params.push(`limit=${this._limit}`);
          if (params.length) url += '?' + params.join('&');
          return url;
        },

        // GET – resolves with { data, error } so callers can destructure correctly
        async then(resolve, reject) {
          const { data, error } = await request('GET', this._buildUrl());
          if (error) reject(error);
          else resolve({ data, error: null });
        },

        insert(rows) {
          const self = this;
          const _run = async () => {
            const url = self._buildUrl();
            const { data, error } = await request('POST', url, Array.isArray(rows) ? rows : [rows], {
              Prefer: 'return=representation',
            });
            if (error) return { data: null, error };
            return { data: data || [], error: null };
          };
          const p = _run();
          return {
            then(res, rej) { return p.then(res, rej); },
            catch(rej)     { return p.catch(rej); },
            select() { return { then(res, rej) { return p.then(res, rej); } }; },
          };
        },

        update(patch) {
          const self = this;
          const _run = async () => {
            const url = self._buildUrl();
            const { data, error } = await request('PATCH', url, patch, {
              Prefer: 'return=representation',
            });
            if (error) return { data: null, error };
            return { data, error: null };
          };
          const p = _run();
          return {
            then(res, rej) { return p.then(res, rej); },
            catch(rej)     { return p.catch(rej); },
            select() { return { then(res, rej) { return p.then(res, rej); } }; },
          };
        },

        async delete() {
          const url = this._buildUrl(true); // exclude select=* — PostgREST rejects it on DELETE
          const { data, error } = await request('DELETE', url);
          if (error) return { data: null, error };
          return { data: null, error: null };
        },

        // Upsert bypasses _buildUrl() so select=* is never included
        async upsert(rows, opts = {}) {
          const onConflict = opts.onConflict || 'id';
          const url = `${SUPABASE_URL}/rest/v1/${this._table}?on_conflict=${onConflict}`;
          const { data, error } = await request('POST', url, Array.isArray(rows) ? rows : [rows], {
            Prefer: 'return=representation,resolution=merge-duplicates',
            'Content-Type': 'application/json',
          });
          if (error) return { data: null, error };
          return { data: data?.[0] || null, error: null };
        },

        async maybeSingle() {
          const base = this._buildUrl();
          const url  = base + (base.includes('?') ? '&' : '?') + 'limit=1';
          const { data, error } = await request('GET', url);
          if (error) return { data: null, error };
          return { data: data?.[0] || null, error: null };
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