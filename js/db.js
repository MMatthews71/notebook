// ─────────────────────────────────────────────
//  SUPABASE CONFIG
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://ozfwtvrdcxpykfaqlfhl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Znd0dnJkY3hweWtmYXFsZmhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDYwMjAsImV4cCI6MjA5MDk4MjAyMH0.n3EAR6jUl9sfJG0LEZVA7J6wNr3tLRyff2C9oPxh4tw';

// ─────────────────────────────────────────────
//  SUPABASE CLIENT (Inline Fetch)
// ─────────────────────────────────────────────
const supabase = (() => {
  const BASE_HEADERS = {
    'apikey': SUPABASE_ANON_KEY,
    'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };

  /**
   * Performs a fetch to Supabase REST API.
   * Always returns { data, error } – never throws.
   */
  async function request(method, url, body, extraHeaders = {}) {
    const headers = { ...BASE_HEADERS, ...extraHeaders };
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    try {
      const res = await fetch(url, options);
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

        // Build URL from current state
        _buildUrl() {
          let url = `${SUPABASE_URL}/rest/v1/${this._table}`;
          const params = [];
          if (this._select) params.push(`select=${this._select}`);
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
          const url = this._buildUrl();
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