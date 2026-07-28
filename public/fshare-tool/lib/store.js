/* Selection basket, recent-folder history, and their localStorage persistence.

   Mutations emit on the bus instead of calling into views, so nothing here
   imports a view and the module graph stays acyclic. */

import { S, HIST_MAX, PER_PAGE_OPTS } from './state.js';
import { emit, EV } from './bus.js';
import { isFolder } from './util.js';

/* ---------- selection ---------- */

/** linkcode -> {linkcode, name, size, path, src} */
export const sel = new Map();

/** Folders selected as a whole; `src` on a file records which one added it. */
export const selFolders = new Set();

export function addFile(item, src) {
  const lc = item.linkcode || item.code || '';
  if (!lc || sel.has(lc)) return false;
  sel.set(lc, {
    linkcode: lc,
    name: item.name || item.filename || '(no name)',
    size: item.size || 0,
    path: item.path || '',
    src: src || null
  });
  return true;
}

export const removeFile = (lc) => sel.delete(lc);

export function clearSelection() {
  sel.clear();
  selFolders.clear();
  changed();
}

/** Drop everything a given folder's crawl contributed. */
export function unselectFolder(lc) {
  selFolders.delete(lc);
  const kill = [];
  sel.forEach((v, k) => { if (v.src === lc) kill.push(k); });
  kill.forEach((k) => sel.delete(k));
}

export function selTotals() {
  let bytes = 0;
  sel.forEach((v) => { bytes += v.size || 0; });
  return { count: sel.size, bytes };
}

/** Call after any batch of mutations; persists and notifies the views once. */
export function changed() {
  saveSelection();
  emit(EV.SELECTION);
}

function saveSelection() {
  try {
    localStorage.setItem('fsbc-sel', JSON.stringify({
      files: Array.from(sel.values()),
      folders: Array.from(selFolders)
    }));
  } catch (e) {
    // Quota exceeded on a very large basket: drop the saved copy rather than
    // leave a half-written one that would restore a wrong selection later.
    try { localStorage.removeItem('fsbc-sel'); } catch (e2) { /* nothing else to do */ }
  }
}

export function loadSelection() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem('fsbc-sel') || 'null'); } catch (e) { return; }
  if (!raw || !Array.isArray(raw.files)) return;
  raw.files.forEach((v) => { if (v && v.linkcode) sel.set(v.linkcode, v); });
  (raw.folders || []).forEach((lc) => selFolders.add(lc));
}

/* ---------- range selection ---------- */

/** Select or clear every file between two display indices. Folders are skipped
    because ticking a folder means "crawl it", which a range must never trigger. */
export function applyRange(a, b, on) {
  let n = 0;
  for (let i = a; i <= b; i++) {
    const it = S.displayList[i];
    if (!it || isFolder(it)) continue;
    if (on) { if (addFile(it, null)) n++; }
    else { removeFile(it.linkcode); n++; }
  }
  return n;
}

/* ---------- history ---------- */

export let history_ = [];
try { history_ = JSON.parse(localStorage.getItem('fsbc-history') || '[]') || []; } catch (e) { history_ = []; }

export function saveHistory() {
  try { localStorage.setItem('fsbc-history', JSON.stringify(history_.slice(0, HIST_MAX))); } catch (e) { /* ignore */ }
  emit(EV.HISTORY);
}

/** Newest-first and de-duplicated, so revisiting moves an entry up. */
export function addHistory(lc, name) {
  if (!lc) return;
  let i = -1;
  for (let k = 0; k < history_.length; k++) if (history_[k].lc === lc) { i = k; break; }
  const rec = i >= 0 ? history_.splice(i, 1)[0] : { lc, name: '', hits: 0 };
  rec.at = Date.now();
  rec.hits = (rec.hits || 0) + 1;
  if (name) rec.name = name;
  history_.unshift(rec);
  history_ = history_.slice(0, HIST_MAX);
  saveHistory();
}

/** Fill in the real folder name once known, without bumping the counter. */
export function touchHistory(lc, name) {
  if (!lc || !name) return;
  for (let k = 0; k < history_.length; k++) {
    if (history_[k].lc === lc && history_[k].name !== name) {
      history_[k].name = name;
      saveHistory();
      return;
    }
  }
}

export function togglePin(lc) {
  for (let k = 0; k < history_.length; k++) {
    if (history_[k].lc === lc) { history_[k].pin = !history_[k].pin; break; }
  }
  saveHistory();
}

export function clearHistory() {
  history_ = [];
  saveHistory();
}

/** Union by linkcode, keeping the larger hit count and the newer timestamp. */
export function mergeHistory(remote) {
  const byLc = Object.create(null);
  history_.forEach((h) => {
    byLc[h.lc] = { lc: h.lc, name: h.name || '', hits: h.hits || 1, at: h.at || 0, pin: !!h.pin };
  });
  (remote || []).forEach((r) => {
    const at = r.at ? Date.parse(r.at) || 0 : 0;
    const cur = byLc[r.lc];
    if (!cur) byLc[r.lc] = { lc: r.lc, name: r.name || '', hits: r.hits || 1, at, pin: false };
    else {
      cur.hits = Math.max(cur.hits, r.hits || 1);
      cur.at = Math.max(cur.at, at);
      if (!cur.name && r.name) cur.name = r.name;
    }
  });
  history_ = Object.keys(byLc).map((k) => byLc[k])
    .sort((a, b) => b.at - a.at)
    .slice(0, HIST_MAX);
  saveHistory();
}

/* ---------- settings ---------- */

export function loadSettings() {
  const view = localStorage.getItem('fsbc-view');
  if (view === 'tree' || view === 'table') S.viewMode = view;

  const per = Number(localStorage.getItem('fsbc-perpage'));
  if (PER_PAGE_OPTS.indexOf(per) !== -1) S.perPage = per;

  const chunk = Number(localStorage.getItem('fsbc-chunk'));
  if (chunk >= 1 && chunk <= 10000) S.chunkSize = chunk;

  const sort = localStorage.getItem('fsbc-sort');
  if (sort) S.sortValue = sort;
}

export function saveSetting(key, value) {
  try { localStorage.setItem('fsbc-' + key, String(value)); } catch (e) { /* ignore */ }
  emit(EV.CONFIG);
}
