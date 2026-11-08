// Passing a pack from Circuit2MIDI to MIDI2Circuit ("Convert to Circuit Tracks"). Both pages
// are on the same site, so the pack is kept in this browser's IndexedDB for the moment it
// takes to open the other page; nothing leaves the computer. The receiving page takes it
// and deletes it.
const DB = 'tracksgm-handoff';
const STORE = 'packs';
const KEY = 'pack';
const MAX_AGE_MS = 10 * 60 * 1000;   // ignore a hand-off left behind longer than this

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB is not available'));
  });
}

function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('The browser refused to store the pack'));
  });
}

// { buffer: ArrayBuffer, fileName, slot }
export async function putHandoff(item) {
  const db = await open();
  try { await run(db, 'readwrite', (s) => s.put({ ...item, time: Date.now() }, KEY)); } finally { db.close(); }
}

// The waiting pack, or null; removed either way.
export async function takeHandoff() {
  const db = await open();
  try {
    const item = await run(db, 'readonly', (s) => s.get(KEY));
    await run(db, 'readwrite', (s) => s.delete(KEY));
    if (!item || Date.now() - item.time > MAX_AGE_MS) return null;
    return item;
  } finally { db.close(); }
}
