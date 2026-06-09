// Focus PWA — IndexedDB offline store
// One object store per Supabase table. Used as the offline read cache
// and as the write-ahead store for mutations made while offline.

const IDB = (() => {
  const DB_NAME    = 'focus-db';
  const DB_VERSION = 2; // bumped: added pantry_items store
  let _db          = null;
  let _openPromise = null;

  // Tables whose primary key spans multiple columns
  const COMPOUND_KEYS = {
    daily_orders:  ['date', 'item_id', 'item_type'],
    flex_overrides: ['habit_id', 'date'],
    skipped_habits: ['habit_id', 'date'],
    goal_parents:   ['goal_id', 'parent_id'],
  };

  // Tables whose primary key is not 'id'
  const KEY_PATHS = {
    user_preferences: 'key',
    journal_analyses: 'entry_id',
    nutrition_profile: 'user_id',
  };

  const ALL_STORES = [
    'goals', 'habits', 'completions', 'todos', 'journal_entries', 'notes',
    'todo_templates', 'food_logs', 'saved_meals',
    'finance_accounts', 'finance_transactions', 'finance_recurring',
    'user_preferences', 'journal_analyses', 'nutrition_profile',
    'daily_orders', 'flex_overrides', 'skipped_habits', 'goal_parents',
    'pantry_items',
  ];

  function open() {
    if (_db) return Promise.resolve(_db);
    if (_openPromise) return _openPromise;
    _openPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        ALL_STORES.forEach(name => {
          if (!db.objectStoreNames.contains(name)) {
            const keyPath = COMPOUND_KEYS[name] || KEY_PATHS[name] || 'id';
            db.createObjectStore(name, { keyPath });
          }
        });
      };
      req.onsuccess = e => { _db = e.target.result; _openPromise = null; resolve(_db); };
      req.onerror   = e => { _openPromise = null; reject(e.target.error); };
    });
    return _openPromise;
  }

  function getAll(storeName) {
    return open().then(db => new Promise(resolve => {
      const tx  = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => resolve([]);
    })).catch(() => []);
  }

  function put(storeName, record) {
    return open().then(db => new Promise(resolve => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    })).catch(() => {});
  }

  function putMany(storeName, records) {
    if (!records || !records.length) return Promise.resolve();
    return open().then(db => new Promise(resolve => {
      const tx    = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      records.forEach(r => { try { store.put(r); } catch {} });
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    })).catch(() => {});
  }

  async function delWhere(storeName, predFn) {
    try {
      const records  = await getAll(storeName);
      const toDelete = records.filter(predFn);
      if (!toDelete.length) return;
      const keyPath = COMPOUND_KEYS[storeName] || KEY_PATHS[storeName] || 'id';
      const db = await open();
      await new Promise(resolve => {
        const tx    = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        toDelete.forEach(r => {
          try {
            const key = Array.isArray(keyPath) ? keyPath.map(k => r[k]) : r[keyPath];
            store.delete(key);
          } catch {}
        });
        tx.oncomplete = () => resolve();
        tx.onerror    = () => resolve();
      });
    } catch {}
  }

  function replaceAll(storeName, records) {
    return open().then(db => new Promise(resolve => {
      const tx    = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      store.clear();
      (records || []).forEach(r => { try { store.put(r); } catch {} });
      tx.oncomplete = () => resolve();
      tx.onerror    = () => resolve();
    })).catch(() => {});
  }

  return { open, getAll, put, putMany, delWhere, replaceAll, COMPOUND_KEYS, KEY_PATHS };
})();
