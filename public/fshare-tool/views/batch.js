/* Bulk-crawl screen: paste many folder links, crawl each, gather every file
   into the one selection basket. */

import { S, $ } from '../lib/state.js';
import { extractAllLinkcodes, fetchAllPages } from '../lib/api.js';
import { esc, fmtSize, isFolder, folderUrl, toast } from '../lib/util.js';
import { addFile, selFolders, addHistory, touchHistory, changed } from '../lib/store.js';
import { scan, initScan, scanFolder } from '../lib/scan.js';

let batchAbort = false;

export function stopBatch() {
  batchAbort = true;
  scan.abort = true;
}

function makeRow(i, lc) {
  const row = document.createElement('div');
  row.className = 'bres-row';
  row.id = 'bres-' + lc;
  row.innerHTML =
    '<span class="bres-num">' + i + '</span>' +
    '<span class="bres-name"><a href="' + esc(folderUrl(lc)) + '" target="_blank" rel="noopener noreferrer">' + esc(lc) + '</a></span>' +
    '<span class="bres-stat wait">queued…</span>';
  return row;
}

function setRow(lc, name, statusText, cls) {
  const row = $('bres-' + lc);
  if (!row) return;
  if (name) {
    row.querySelector('.bres-name').innerHTML =
      '<a href="' + esc(folderUrl(lc)) + '" target="_blank" rel="noopener noreferrer">' + esc(name) + '</a>';
  }
  const st = row.querySelector('.bres-stat');
  st.textContent = statusText;
  st.className = 'bres-stat ' + cls;
}

export function runBatch() {
  const codes = extractAllLinkcodes($('batchInput').value);
  if (!codes.length) { toast('No folder links found', true); return; }

  const deep = $('batchDeep').checked;
  const box = $('batchResults');
  box.style.display = '';
  box.innerHTML = '';
  codes.forEach((lc, i) => box.appendChild(makeRow(i + 1, lc)));

  batchAbort = false;
  scan.abort = false;
  $('batchRun').disabled = true;
  $('batchHint').textContent = 'Crawling ' + codes.length + ' folders…';

  let totalFiles = 0, totalBytes = 0, done = 0, failed = 0;
  const sort = S.sortValue;

  // One folder tree at a time: scanFolder already runs CONCURRENCY requests
  // internally, so stacking them would multiply the load on the upstream proxy.
  let chain = Promise.resolve();

  codes.forEach((lc) => {
    chain = chain.then(() => {
      if (batchAbort) return;
      setRow(lc, null, 'crawling…', 'wait');
      addHistory(lc);

      let name = null;
      initScan();                       // scanFolder writes into scan.state
      scan.lastRootName = null;

      const walk = deep
        ? scanFolder(lc, true).then((fs) => { name = scan.lastRootName; return fs; })
        : fetchAllPages(lc, sort).then((r) => {
            name = (r.meta.current && r.meta.current.name) || null;
            return r.items.filter((it) => !isFolder(it));
          });

      return walk.then((files) => {
        let added = 0, bytes = 0;
        files.forEach((it) => { bytes += it.size || 0; if (addFile(it, lc)) added++; });
        totalFiles += added;
        totalBytes += bytes;
        done++;
        if (added) selFolders.add(lc);
        if (name) touchHistory(lc, name);

        setRow(lc, name, files.length + ' files · ' + fmtSize(bytes) +
          (added !== files.length ? ' (' + (files.length - added) + ' already there)' : ''), 'ok');
        changed();
        $('batchHint').textContent = done + '/' + codes.length + ' done · ' +
          totalFiles + ' files · ' + fmtSize(totalBytes);
      }).catch((e) => {
        failed++;
        setRow(lc, null, 'failed: ' + e.message, 'bad');
      });
    });
  });

  chain.then(() => {
    $('batchRun').disabled = false;
    $('batchHint').textContent = 'Done — ' + done + '/' + codes.length + ' folders' +
      (failed ? ', ' + failed + ' failed' : '') +
      ' · ' + totalFiles + ' files · ' + fmtSize(totalBytes);
    changed();
    toast(batchAbort
      ? 'Stopped'
      : 'Crawled ' + totalFiles + ' files from ' + done + ' folders');
  });
}
