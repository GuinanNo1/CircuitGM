// Passing a pack from one page to another: Circuit2MIDI to MIDI2Circuit ("Convert to Circuit
// Tracks" / "Rebuild in MIDI2Circuit"), and Circuit2MIDI or MIDI2Circuit to PackTrim ("Trim
// this pack in PackTrim"). The pages are on the same site, so the pack is kept in this
// browser's IndexedDB for the moment it takes to open the other page; nothing leaves the
// computer. The receiving page takes it and deletes it. Each receiving page has its own key.
const DB = 'tracksgm-handoff';
const STORE = 'packs';
const KEY = 'pack';          // MIDI2Circuit's key (kept from before PackTrim took packs too)
const keyFor = (to) => (to === 'midi2circuit' ? KEY : `pack-${to}`);
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

// item = { buffer: ArrayBuffer, fileName, slot? }; to = the receiving page: 'midi2circuit' or 'packtrim'.
export async function putHandoff(item, to = 'midi2circuit') {
  const db = await open();
  try { await run(db, 'readwrite', (s) => s.put({ ...item, time: Date.now() }, keyFor(to))); } finally { db.close(); }
}

// The pack waiting for this page, or null; removed either way.
export async function takeHandoff(to = 'midi2circuit') {
  const db = await open();
  const key = keyFor(to);
  try {
    const item = await run(db, 'readonly', (s) => s.get(key));
    await run(db, 'readwrite', (s) => s.delete(key));
    if (!item || Date.now() - item.time > MAX_AGE_MS) return null;
    return item;
  } finally { db.close(); }
}
