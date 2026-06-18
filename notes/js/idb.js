// Focus PWA — IndexedDB offline store
// One object store per Supabase table. Used as the offline read cache
// and as the write-ahead store for mutations made while offline.
//
// All five Focus apps share the same origin and therefore the same
// `focus-db` database. To avoid VersionError when one app's store list is
// ahead of another's, this opener is version-agnostic: it opens whatever
// version exists, and only bumps the version when a required store is
// missing (which triggers an upgrade that creates it). No hard-coded
// DB_VERSION — so the apps can never fight over the version number.

const IDB = (() => {
  const DB_NAME = 'focus-db';
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

  // Every store any Focus app may use. Harmless for an app to have stores it
  // never reads — keeping the list identical across apps prevents version drift.
  const ALL_STORES = [
    'goals', 'habits', 'completions', 'todos', 'journal_entries', 'notes',
    'todo_templates', 'food_logs', 'saved_meals',
    'finance_accounts', 'finance_transactions', 'finance_recurring',
    'user_preferences', 'journal_analyses', 'nutrition_profile',
    'daily_orders', 'flex_overrides', 'skipped_habits', 'goal_parents',
    'pantry_items',
  ];

  function _createMissingStores(db) {
    ALL_STORES.forEach(name => {
      if (!db.objectStoreNames.contains(name)) {
        const keyPath = COMPOUND_KEYS[name] || KEY_PATHS[name] || 'id';
        db.createObjectStore(name, { keyPath });
      }
    });
  }

  function _missingStores(db) {
    return ALL_STORES.filter(n => !db.objectStoreNames.contains(n));
  }

  // Open at a specific version (or the current version when `version` is
  // undefined). Creates any missing stores on upgrade.
  function _openAt(version) {
    return new Promise((resolve, reject) => {
      const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      req.onupgradeneeded = e => _createMissingStores(e.target.result);
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
      // Another tab holds an older connection open — it will close and let us through.
      req.onblocked = () => {};
    });
  }

  async function _openInternal() {
    // 1. Open whatever version currently exists (creates v1 if brand new).
    let db = await _openAt();
    // 2. If this app needs stores the existing DB lacks, bump the version so
    //    onupgradeneeded fires and creates them.
    if (_missingStores(db).length) {
      const nextVersion = db.version + 1;
      db.close();
      db = await _openAt(nextVersion);
    }
    // 3. If another app later upgrades the DB, drop our cached handle so the
    //    next call reopens cleanly instead of erroring.
    db.onversionchange = () => { try { db.close(); } catch {} _db = null; _openPromise = null; };
    return db;
  }

  function open() {
    if (_db) return Promise.resolve(_db);
    if (_openPromise) return _openPromise;
    _openPromise = _openInternal()
      .then(db => { _db = db; _openPromise = null; return db; })
      .catch(err => { _openPromise = null; throw err; });
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
