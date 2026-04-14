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
        }
      };
    }
  };
})();