/* Persistent folder cache.

   Measured on the Doraemon tree: 39 folders / 938 files takes 45-67 seconds to
   crawl, and the upstream latency has a very long tail (p50 1.7s, p90 9.8s).
   Concurrency barely moves that — going from 6 to 12 parallel requests saved
   only 7%. Caching is the lever that actually matters: a second visit costs
   nothing at all.

   Items are stored as positional arrays rather than objects. The full API
   response is 598 KB for that tree; keeping only the six fields the UI reads
   brings it to 255 KB, about 5% of a typical 5 MB localStorage budget. */

const KEY = 'fsbc-cache-v1';
const TTL_MS = 24 * 60 * 60 * 1000;      // folder listings change rarely
const MAX_BYTES = 3 * 1024 * 1024;       // leave room for selection + history

let mem = null;    // parsed once, written back on change

function load() {
  if (mem) return mem;
  try { mem = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
  catch (e) { mem = {}; }
  return mem;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(mem));
  } catch (e) {
    // Over quota: drop the oldest half and try once more. Failing that, give
    // up on caching rather than leaving a half-written blob behind.
    const entries = Object.entries(mem).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
    entries.slice(0, Math.ceil(entries.length / 2)).forEach(([k]) => delete mem[k]);
    try { localStorage.setItem(KEY, JSON.stringify(mem)); }
    catch (e2) { try { localStorage.removeItem(KEY); } catch (e3) { /* nothing left to do */ } mem = {}; }
  }
}

const pack = (it) => [
  it.linkcode || it.code || '',
  it.name || '',
  it.size || 0,
  it.type,
  it.path || '',
  it.modified || it.updated || it.created || 0
];

const unpack = (a) => ({
  linkcode: a[0], name: a[1], size: a[2], type: a[3], path: a[4], modified: a[5]
});

/** Cached listing for a folder, or null when absent, stale or sorted differently. */
export function cacheGet(lc, sort) {
  const db = load();
  const e = db[lc];
  if (!e) return null;
  if (e.sort !== sort) return null;                       // order would be wrong
  if (Date.now() - (e.at || 0) > TTL_MS) return null;
  return { items: e.i.map(unpack), name: e.n, path: e.p, at: e.at };
}

export function cacheSet(lc, sort, items, name, path) {
  const db = load();
  db[lc] = {
    at: Date.now(),
    sort,
    n: name || '',
    p: path || '',
    i: items.map(pack)
  };
  trim();
  persist();
}

/** Keep the store under MAX_BYTES by evicting least-recently-written folders. */
function trim() {
  let size = JSON.stringify(mem).length;
  if (size <= MAX_BYTES) return;
  const entries = Object.entries(mem).sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
  for (const [k] of entries) {
    delete mem[k];
    size = JSON.stringify(mem).length;
    if (size <= MAX_BYTES) break;
  }
}

/* ---------- page-level entries ----------

   The table view fetches individual upstream pages rather than whole folders,
   so it cannot use the entries above. Without its own entries, paging back and
   forth re-fetched every time while the tree served the same data instantly.

   A folder entry always wins when present: it holds the same rows and avoids
   storing them twice. */

/* One constant, used by the key builder, the prefix scan and the stats
   classifier alike — three hand-written copies of the same literal is exactly
   how they drift apart. A linkcode is alphanumeric, so it can never collide. */
const PAGE_PREFIX = 'page|';
const pageKey = (lc, sort, page) => PAGE_PREFIX + lc + '|' + sort + '|' + page;
const isPageKey = (k) => k.indexOf(PAGE_PREFIX) === 0;

export function cachePageGet(lc, sort, page) {
  const db = load();
  const e = db[pageKey(lc, sort, page)];
  if (!e) return null;
  if (Date.now() - (e.at || 0) > TTL_MS) return null;
  return { items: e.i.map(unpack), name: e.n, path: e.p, totalPages: e.tp };
}

export function cachePageSet(lc, sort, page, items, name, path, totalPages) {
  const db = load();
  db[pageKey(lc, sort, page)] = {
    at: Date.now(),
    n: name || '',
    p: path || '',
    tp: totalPages || 1,
    i: items.map(pack)
  };
  trim();
  persist();
}

/** Drop a folder and every page of it. Used by Refresh. */
export function cacheDelete(lc) {
  const db = load();
  let n = 0;
  if (db[lc]) { delete db[lc]; n++; }
  const prefix = PAGE_PREFIX + lc + '|';
  for (const k in db) {
    if (k.indexOf(prefix) === 0) { delete db[k]; n++; }
  }
  if (n) persist();
  return n;
}

export function cacheClear() {
  mem = {};
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function cacheStats() {
  const db = load();
  let folders = 0, pages = 0, files = 0;
  for (const k in db) {
    if (isPageKey(k)) pages++; else folders++;
    files += db[k].i.length;
  }
  let bytes = 0;
  try { bytes = (localStorage.getItem(KEY) || '').length; } catch (e) { bytes = 0; }
  return { folders, pages, files, bytes };
}

/* Set from the UI to bypass the cache for one crawl, so a stale listing can
   always be refreshed without clearing everything. */
let bypass = false;
export const setBypass = (v) => { bypass = !!v; };
export const isBypassed = () => bypass;
