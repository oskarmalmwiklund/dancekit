// Tiny IndexedDB key-value cache for track features.
const DB_NAME = 'dancekit';
const STORE = 'features';

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function cacheGetMany(ids) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readonly');
  const store = tx.objectStore(STORE);
  const result = new Map();
  await Promise.all(
    ids.map(
      (id) =>
        new Promise((resolve) => {
          const req = store.get(id);
          req.onsuccess = () => {
            if (req.result !== undefined) result.set(id, req.result);
            resolve();
          };
          req.onerror = () => resolve();
        })
    )
  );
  return result;
}

export async function cacheSet(id, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
