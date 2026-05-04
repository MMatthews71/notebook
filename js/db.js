// ─────────────────────────────────────────────
//  SUPABASE CONFIG
// ─────────────────────────────────────────────
const SUPABASE_URL = 'https://ozfwtvrdcxpykfaqlfhl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96Znd0dnJkY3hweWtmYXFsZmhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MDYwMjAsImV4cCI6MjA5MDk4MjAyMH0.n3EAR6jUl9sfJG0LEZVA7J6wNr3tLRyff2C9oPxh4tw';

// ─────────────────────────────────────────────
//  SUPABASE CLIENT (Inline Fetch)
// ─────────────────────────────────────────────
const supabase = (() => {
  const headers = { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };
  async function query(table, opts = {}) {
    let url = `${SUPABASE_URL}/rest/v1/${table}`;
    const params = [];
    if (opts.select)  params.push(`select=${opts.select}`);
    if (opts.eq)      Object.entries(opts.eq).forEach(([k, v]) => params.push(`${k}=eq.${encodeURIComponent(v)}`));
    if (opts.in)      params.push(`${opts.in[0]}=in.(${opts.in[1].map(v => encodeURIComponent(v)).join(',')})`);
    if (opts.order)   params.push(`order=${opts.order}`);
    if (params.length) url += '?' + params.join('&');
    const res = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
    if (!res.ok) { const errText = await res.text(); throw new Error(`Supabase error ${res.status}: ${errText}`); }
    const text = await res.text(); return text ? JSON.parse(text) : [];
  }
  return {
    from(table) {
      return {
        _table: table,
        _select: '*',
        _eq: null,
        _in: null,
        _order: null,
        select(cols = '*') { this._select = cols; return this; },
        order(col, { ascending = true } = {}) { this._order = ascending ? col : `${col}.desc`; return this; },
        eq(col, val) { this._eq = { ...(this._eq || {}), [col]: val }; return this; },
        in(col, vals) { this._in = [col, vals]; return this; },
        // Supports both `await chain` and `.then()` for GET requests
        then(resolve, reject) {
          query(this._table, { select: this._select, eq: this._eq, in: this._in, order: this._order })
            .then(data => resolve({ data, error: null }))
            .catch(e => resolve({ data: null, error: e }));
        },
        async insert(rows) {
          try {
            const data = await query(this._table, { method: 'POST', body: Array.isArray(rows) ? rows : [rows] });
            return { data: data[0] || null, error: null };
          } catch(e) { return { data: null, error: e }; }
        },
        async update(patch) {
          try {
            const data = await query(this._table, { method: 'PATCH', body: patch, eq: this._eq });
            return { data, error: null };
          } catch(e) { return { data: null, error: e }; }
        },
        async delete() {
          try {
            await query(this._table, { method: 'DELETE', eq: this._eq, in: this._in });
            return { data: null, error: null };
          } catch(e) { return { data: null, error: e }; }
        },
        async upsert(row, opts = {}) {
          try {
            const data = await query(this._table, { method: 'POST', body: row, ...opts });
            return { data: data[0] || null, error: null };
          } catch(e) { return { data: null, error: e }; }
        },
        async maybeSingle() {
          const { data, error } = await query(this._table, { select: this._select, eq: this._eq, in: this._in, order: this._order, limit: 1 });
          if (error) return { data: null, error };
          return { data: data[0] || null, error: null };
        }
      };
    }
  };
})();

// ── DAILY ORDERS ───────────────────────────
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
  data.forEach(row => {
    if (!orders[row.item_type]) orders[row.item_type] = {};
    orders[row.item_type][row.item_id] = row.sort_order;
  });
  return orders;
};

// ── FLEX OVERRIDES ─────────────────────────
supabase.toggleFlexOverride = async function (habitId, date, active = true) {
  if (!active) {
    await supabase.from('flex_overrides').delete().eq('habit_id', habitId).eq('date', date);
  } else {
    await supabase.from('flex_overrides').upsert({ habit_id: habitId, date });
  }
};

supabase.fetchFlexOverrides = async function (date) {
  const { data, error } = await supabase.from('flex_overrides')
    .select('habit_id').eq('date', date);
  if (error) { console.error('fetchFlexOverrides', error); return {}; }
  const overrides = {};
  data.forEach(row => overrides[row.habit_id] = true);
  return overrides;
};

// ── SKIPPED HABITS ─────────────────────────
supabase.toggleSkippedHabit = async function (habitId, date, skip = true) {
  if (!skip) {
    await supabase.from('skipped_habits').delete().eq('habit_id', habitId).eq('date', date);
  } else {
    await supabase.from('skipped_habits').upsert({ habit_id: habitId, date });
  }
};

supabase.fetchSkippedHabits = async function (date) {
  const { data, error } = await supabase.from('skipped_habits')
    .select('habit_id').eq('date', date);
  if (error) { console.error('fetchSkippedHabits', error); return {}; }
  const skipped = {};
  data.forEach(row => skipped[row.habit_id] = true);
  return skipped;
};

// ── TODO TEMPLATES ─────────────────────────
supabase.fetchTemplates = async function () {
  const { data, error } = await supabase.from('todo_templates').select('*');
  if (error) { console.error('fetchTemplates', error); return []; }
  return data;
};

supabase.saveTemplate = async function (template) {
  const { data, error } = await supabase.from('todo_templates').insert(template).select();
  if (error) throw error;
  return data[0];
};

supabase.deleteTemplate = async function (templateId) {
  await supabase.from('todo_templates').delete().eq('id', templateId);
};

// ── USER PREFERENCES ───────────────────────
supabase.getPref = async function (key) {
  const { data, error } = await supabase.from('user_preferences')
    .select('value').eq('key', key).maybeSingle();
  if (error) return null;
  return data?.value ?? null;
};

supabase.setPref = async function (key, value) {
  await supabase.from('user_preferences').upsert({ key, value });
};

// ── JOURNAL ANALYSES (optional, if you want to persist) ──
supabase.saveAnalysis = async function (entryId, analysis) {
  await supabase.from('journal_analyses').upsert({
    entry_id: entryId,
    analysis,
    analysed_at: new Date().toISOString()
  });
};

supabase.fetchAnalysis = async function (entryId) {
  const { data, error } = await supabase.from('journal_analyses')
    .select('analysis')
    .eq('entry_id', entryId)
    .single();
  if (error) return null;
  return data?.analysis || null;
};