/* Recursive folder crawling and the progress overlay it drives. */

import { S, $, CONCURRENCY, MAX_DEPTH, MAX_FOLDERS } from './state.js';
import { fetchAllPages } from './api.js';
import { isFolder } from './util.js';

export const scan = {
  abort: false,
  state: null,             // {done, total, files, errors, t0}
  lastRootName: null       // the batch screen reads this after a crawl
};

/** Prepare counters without showing the overlay, for headless callers. */
export function initScan() {
  scan.abort = false;
  scan.state = { done: 0, total: 1, files: 0, errors: 0, t0: Date.now() };
}

export function openScan(title) {
  initScan();
  $('scanTitle').textContent = title;
  $('scErr').textContent = '';
  $('scNow').textContent = '';
  $('scEta').textContent = '';
  paintScan();
  $('scanOv').classList.add('on');
}

export function closeScan() {
  $('scanOv').classList.remove('on');
}

/** Remaining time from the average so far; meaningless until a few are done. */
export function scanEta() {
  const st = scan.state;
  if (!st || st.done < 3) return '';
  const elapsed = (Date.now() - st.t0) / 1000;
  const rate = st.done / elapsed;
  if (!(rate > 0)) return '';
  const left = Math.max(0, st.total - st.done) / rate;
  const mm = Math.floor(left / 60);
  const ss = Math.round(left % 60);
  return (mm ? mm + 'm' + (ss < 10 ? '0' : '') + ss + 's' : ss + 's') +
         ' · ' + rate.toFixed(1) + ' folders/s';
}

/** Hook set by the tree view so the inline progress bar tracks a live crawl. */
let onProgress = null;
export function setScanProgressHook(fn) { onProgress = fn; }

export function paintScan() {
  const st = scan.state;
  if (!st) return;
  $('scDone').textContent = st.done;
  $('scTotal').textContent = st.total;
  $('scFiles').textContent = st.files;
  const pct = st.total ? Math.round(st.done / st.total * 100) : 0;
  $('scBar').style.width = Math.min(pct, 100) + '%';
  const eta = scanEta();
  $('scEta').textContent = eta ? 'About ' + eta + ' left' : '';
  if (onProgress) onProgress();
}

/**
 * Walk a folder and return its files. With recursive=false it stops at the
 * first level. Folders are traversed, never returned.
 */
export function scanFolder(rootLc, recursive) {
  const sort = S.sortValue;
  const seen = Object.create(null);
  const queue = [{ lc: rootLc, depth: 0 }];
  const files = [];
  let seenCount = 1;
  seen[rootLc] = true;

  const stop = () => scan.abort;

  const step = () => {
    if (scan.abort || !queue.length) return Promise.resolve();
    const batch = queue.splice(0, CONCURRENCY);

    return Promise.all(batch.map((node) =>
      fetchAllPages(node.lc, sort, stop).then((r) => {
        const rname = (r.meta.current && r.meta.current.name) || null;
        if (node.depth === 0) scan.lastRootName = rname;
        $('scNow').textContent = rname || node.lc;

        r.items.forEach((it) => {
          if (isFolder(it)) {
            if (recursive && !seen[it.linkcode] &&
                node.depth < MAX_DEPTH && seenCount < MAX_FOLDERS) {
              seen[it.linkcode] = true;
              seenCount++;
              queue.push({ lc: it.linkcode, depth: node.depth + 1 });
              scan.state.total++;
            }
          } else {
            files.push(it);
            scan.state.files++;
          }
        });
      }).catch((e) => {
        scan.state.errors++;
        $('scErr').textContent = 'Skipped ' + scan.state.errors + ' failed folder(s) (' + e.message + ')';
      }).then(() => {
        scan.state.done++;
        paintScan();
      })
    )).then(step);
  };

  return step().then(() => files);
}
