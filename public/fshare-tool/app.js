/* Boot and event wiring. All behaviour lives in lib/ and views/. */

import { S, $ } from './lib/state.js';
import { on, EV } from './lib/bus.js';
import { isFolder, copyText, downloadTxt, toast, fmtAgo, debounce } from './lib/util.js';
import { extractLinkcode } from './lib/api.js';
import {
  sel, addFile, removeFile, clearSelection, changed,
  loadSelection, loadSettings, saveSetting,
  history_, clearHistory, togglePin
} from './lib/store.js';
import {
  registerView, startFolder, showHome, showFolder, showBatch,
  currentLc, loadFolder
} from './lib/nav.js';
import { filterTerms } from './lib/filter.js';
import { scan } from './lib/scan.js';
import { cacheStats, cacheClear, cacheDelete, setBypass } from './lib/cache.js';
import { openDialog, closeDialog } from './lib/a11y.js';
import { wireLoadBar } from './lib/loadbar.js';
import { Sync, syncInit, syncPush, syncSignIn, syncSignOut, setConfigApplier } from './lib/sync.js';

import {
  showTable, paintRowState as paintTableRows, applyTableFilter, rerenderTable
} from './views/table.js';
import {
  openTree, renderTree, paintRowState as paintTreeRows,
  expandAllTree, collapseAllTree, runScan, collectSubtree, renderExtChips
} from './views/tree.js';
import {
  renderTray, renderBasket, openBasket, wireBasket,
  buildText, exportChunks, exportName, forceTextMode
} from './views/basket.js';
import { runBatch, stopBatch } from './views/batch.js';

/* ---------- view registry ---------- */

registerView('table', showTable);
registerView('tree', openTree);

function paintRows() {
  if (S.viewMode === 'tree') paintTreeRows();
  else paintTableRows();
}

on(EV.SELECTION, () => { paintRows(); renderTray(); renderCacheBadge(); });
on(EV.HISTORY, () => { renderHistory(); syncPush(); });
on(EV.CONFIG, () => syncPush());

/* ---------- theme ---------- */

let theme = localStorage.getItem('fsbc-theme') || 'dark';

function applyTheme() {
  document.body.classList.toggle('light', theme === 'light');
  $('themeBtn').textContent = theme === 'dark' ? '☀️ Light' : '🌙 Dark';
}

$('themeBtn').addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  localStorage.setItem('fsbc-theme', theme);
  applyTheme();
});

/* ---------- sticky offsets ---------- */

/* The tree header and the table's column headers pin directly under the
   controls block. That block wraps onto extra lines on a narrow window and
   grows when the filter chips appear, so its height is measured rather than
   assumed — a hard-coded offset shows a strip of rows above the header on one
   size and leaves a gap on another. */
function measureStickTop() {
  const nav = document.querySelector('.topnav');
  const ctl = document.querySelector('.sticky-controls');
  if (!nav || !ctl) return;
  /* On the home screen #folderView is hidden and the controls measure 0.
     Writing 56px then would pin the headers under the nav, where the controls
     block covers them the moment a folder opens. Wait for a real height — the
     observer fires again as soon as the view is shown. */
  if (ctl.offsetHeight <= 0) return;
  document.documentElement.style.setProperty(
    '--stick-top', (nav.offsetHeight + ctl.offsetHeight) + 'px');
}

const stickTargets = ['.sticky-controls', '.topnav']
  .map((s) => document.querySelector(s))
  .filter(Boolean);

if (typeof ResizeObserver === 'function' && stickTargets.length) {
  const ro = new ResizeObserver(measureStickTop);
  stickTargets.forEach((el) => ro.observe(el));
}
// Kept regardless: ResizeObserver does not fire for a zoom change alone.
window.addEventListener('resize', measureStickTop);
measureStickTop();

/* ---------- view switching ---------- */

let booted = false;

function setView(mode) {
  S.viewMode = mode;
  saveSetting('view', mode);

  const segs = $('viewSeg').querySelectorAll('button');
  for (let i = 0; i < segs.length; i++) {
    segs[i].classList.toggle('on', segs[i].getAttribute('data-view') === mode);
  }

  const tree = mode === 'tree';
  $('treeWrap').classList.toggle('on', tree);
  document.querySelector('.table-wrap').style.display = tree ? 'none' : '';
  $('paginationTop').style.display = tree ? 'none' : '';
  $('paginationBot').style.display = tree ? 'none' : '';
  $('pgInfo').style.display = tree ? 'none' : '';
  $('expandAllBtn').style.display = tree ? '' : 'none';
  $('collapseAllBtn').style.display = tree ? '' : 'none';
  // Tree loads a whole folder at once, so per-page has nothing to act on.
  $('perPageLabel').style.display = tree ? 'none' : '';
  $('perPageSelect').style.display = tree ? 'none' : '';

  if (booted && currentLc()) loadFolder(currentLc(), 1);
}

const segBtns = $('viewSeg').querySelectorAll('button');
for (let i = 0; i < segBtns.length; i++) {
  segBtns[i].addEventListener('click', function () { setView(this.getAttribute('data-view')); });
}

/* ---------- history panel ---------- */

function renderHistory() {
  const wrap = $('histList');
  if (!wrap) return;
  $('histWrap').style.display = history_.length ? '' : 'none';
  wrap.innerHTML = '';

  // Pinned first; each group is already newest-first.
  const ordered = history_.filter((h) => h.pin).concat(history_.filter((h) => !h.pin));

  ordered.slice(0, 14).forEach((h) => {
    const row = document.createElement('div');
    row.className = 'hist-row';

    const pin = document.createElement('button');
    pin.className = 'hist-pin' + (h.pin ? ' on' : '');
    pin.textContent = h.pin ? '★' : '☆';
    pin.title = h.pin ? 'Unpin' : 'Pin to the top';
    pin.addEventListener('click', (e) => { e.stopPropagation(); togglePin(h.lc); });
    row.appendChild(pin);

    const a = document.createElement('span');
    a.className = 'hist-name';
    a.textContent = h.name || h.lc;
    a.title = h.lc;
    a.addEventListener('click', () => {
      if (location.hash === '#' + h.lc) startFolder(h.lc); else location.hash = h.lc;
    });
    row.appendChild(a);

    const meta = document.createElement('span');
    meta.className = 'hist-meta';
    meta.textContent = fmtAgo(h.at) + (h.hits > 1 ? ' · ' + h.hits + '×' : '');
    row.appendChild(meta);

    wrap.appendChild(row);
  });
}

$('histClear').addEventListener('click', () => { clearHistory(); toast('History cleared'); });

/* ---------- search boxes ---------- */

function goFrom(inputId, errId) {
  const lc = extractLinkcode($(inputId).value);
  if (!lc) { if (errId) $(errId).textContent = 'Not a valid URL or link code.'; return; }
  if (errId) $(errId).textContent = '';
  // Assigning an unchanged hash fires no hashchange, so route() would never run.
  // startFolder() records history, so both paths log exactly once.
  if (location.hash === '#' + lc) startFolder(lc);
  else location.hash = lc;
}

$('heroBtn').addEventListener('click', () => goFrom('heroInput', 'homeError'));
$('navBtn').addEventListener('click', () => goFrom('navInput', null));
$('heroInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') goFrom('heroInput', 'homeError'); });
$('navInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') goFrom('navInput', null); });

/* ---------- settings ---------- */

$('sortSelect').addEventListener('change', () => {
  S.sortValue = $('sortSelect').value;
  saveSetting('sort', S.sortValue);
  S.nodes.clear();                 // cached pages were fetched under the old order
  if (currentLc()) loadFolder(currentLc(), 1);
});

$('perPageSelect').addEventListener('change', () => {
  S.perPage = Number($('perPageSelect').value);
  saveSetting('perpage', S.perPage);
  if (S.viewMode !== 'tree' && currentLc()) loadFolder(currentLc(), 1);
});

$('chunkInput').addEventListener('change', () => {
  S.chunkSize = Math.max(1, Math.min(10000, Number($('chunkInput').value) || 49));
  $('chunkInput').value = S.chunkSize;
  saveSetting('chunk', S.chunkSize);
});

/* ---------- quick select ---------- */

$('chkAll').addEventListener('change', () => {
  const want = $('chkAll').checked;
  S.pageItems.forEach((it) => {
    if (isFolder(it)) return;
    if (want) addFile(it, null); else removeFile(it.linkcode);
  });
  changed();
});

$('selDeepBtn').addEventListener('click', () => {
  const lc = currentLc();
  if (!lc) return;
  // If the tree is already fully expanded, take the files from cache instead.
  const cached = [];
  if (collectSubtree(lc, cached)) {
    let n = 0;
    cached.forEach((it) => { if (addFile(it, null)) n++; });
    changed();
    toast('Added ' + n + ' files (from cache)');
    return;
  }
  runScan(lc, true, null, 'Crawling the whole tree…');
});

/* The tree's header checkbox. Acts on the files on screen — same scope as the
   table's header box, and as Ctrl+A. Folders are left alone: ticking one starts
   a recursive crawl, which is not what "select all shown" should trigger. */
$('treeChkAll').addEventListener('change', () => {
  const want = $('treeChkAll').checked;
  let n = 0;
  S.displayList.forEach((it) => {
    if (!it || isFolder(it)) return;
    // Count only real changes, so the toast cannot claim more than it did.
    if (want) { if (addFile(it, null)) n++; }
    else if (removeFile(it.linkcode)) n++;
  });
  changed();
  toast((want ? 'Selected ' : 'Cleared ') + n + ' files');
});

$('selNoneBtn').addEventListener('click', clearSelection);

/* ---------- cache + density ---------- */

function renderCacheBadge() {
  const s = cacheStats();
  const b = $('cacheBadge');
  b.classList.toggle('on', s.folders > 0);
  b.innerHTML = s.folders
    ? '⚡ <b>' + s.folders + '</b> folders cached · ' + Math.round(s.bytes / 1024) + ' KB'
    : '';
  b.title = 'Cached listings load instantly. Refresh re-fetches this folder; ' +
            'click this badge to drop the whole cache.';
}

$('cacheBadge').addEventListener('click', () => {
  cacheClear();
  renderCacheBadge();
  toast('Cache cleared');
});

$('refreshBtn').addEventListener('click', () => {
  const lc = currentLc();
  if (!lc) return;

  /* Invalidate the whole subtree, not just this folder. Dropping only the
     current node left every child serving its old cached listing, so Refresh
     appeared to do nothing once you expanded again. */
  const seen = new Set([lc]);
  const stack = [lc];
  while (stack.length) {
    const cur = stack.pop();
    const n = S.nodes.get(cur);
    if (!n || !n.loaded) continue;
    n.items.forEach((it) => {
      if (isFolder(it) && !seen.has(it.linkcode)) { seen.add(it.linkcode); stack.push(it.linkcode); }
    });
  }
  let dropped = 0;
  seen.forEach((code) => { dropped += cacheDelete(code); S.nodes.delete(code); });

  setBypass(true);
  loadFolder(lc, S.currentPage);
  // One load only; anything queued afterwards should use the cache again.
  setTimeout(() => setBypass(false), 50);
  renderCacheBadge();
  toast('Re-fetching — dropped ' + dropped + ' cached entries');
});

/* Row height. A single toggling button read as a state label as often as an
   action ("▤ Compact" — am I compact, or does clicking make me compact?), so
   it is a segmented control now: the highlighted half is the current height. */
let compact = localStorage.getItem('fsbc-compact') === '1';

function applyDensity() {
  document.body.classList.toggle('compact', compact);
  const btns = $('densitySeg').querySelectorAll('button');
  for (let i = 0; i < btns.length; i++) {
    btns[i].classList.toggle('on', (btns[i].getAttribute('data-d') === '1') === compact);
  }
}

const densBtns = $('densitySeg').querySelectorAll('button');
for (let i = 0; i < densBtns.length; i++) {
  densBtns[i].addEventListener('click', function () {
    const want = this.getAttribute('data-d') === '1';
    if (want === compact) return;
    compact = want;
    localStorage.setItem('fsbc-compact', compact ? '1' : '0');
    applyDensity();
    // The virtual scroller reads --row-h, so it has to rebuild at the new height.
    if (S.viewMode === 'tree') renderTree(); else if (currentLc()) rerenderTable();
  });
}
$('expandAllBtn').addEventListener('click', expandAllTree);
$('collapseAllBtn').addEventListener('click', collapseAllTree);
$('tpMore').addEventListener('click', expandAllTree);

/* ---------- filter ---------- */

function applyFilter() {
  renderExtChips(toggleExtToken);
  const active = filterTerms().length > 0;
  $('filterClear').style.display = active ? '' : 'none';
  $('selMatchBtn').style.display = active ? '' : 'none';
  if (S.viewMode === 'tree') renderTree();
  else applyTableFilter();
}

function toggleExtToken(tok) {
  const cur = S.filterText.split(/\s+/).filter(Boolean);
  const at = cur.indexOf(tok);
  if (at >= 0) cur.splice(at, 1); else cur.push(tok);
  S.filterText = cur.join(' ');
  $('filterInput').value = S.filterText;
  applyFilter();
}

$('filterInput').addEventListener('input', debounce(() => {
  S.filterText = $('filterInput').value.trim();
  applyFilter();
}, 180));

$('filterClear').addEventListener('click', () => {
  S.filterText = '';
  $('filterInput').value = '';
  applyFilter();
});

$('selMatchBtn').addEventListener('click', () => {
  let n = 0;
  S.displayList.forEach((it) => { if (it && !isFolder(it) && addFile(it, null)) n++; });
  changed();
  toast('Added ' + n + ' matching files');
});

/* ---------- export ---------- */

$('copyAllBtn').addEventListener('click', () => {
  if (!sel.size) return;
  copyText(buildText($('fmtSelect').value))
    .then(() => toast('Copied ' + sel.size + ' links'))
    .catch(() => { toast('Clipboard blocked — open the basket to copy manually', true); openBasket(); });
});

$('txtBtn').addEventListener('click', () => {
  if (sel.size) downloadTxt(buildText($('fmtSelect').value), exportName());
});

$('chunkBtn').addEventListener('click', () => { if (sel.size) exportChunks(S.chunkSize); });
$('viewBtn').addEventListener('click', () => { if (sel.size) openBasket(); });

$('fmtSelect').addEventListener('change', () => {
  if ($('listModal').classList.contains('on')) renderBasket();
});

$('listClose').addEventListener('click', () => hideModal('listModal'));
$('listModal').addEventListener('click', (e) => {
  if (e.target === $('listModal')) hideModal('listModal');
});
$('listTxt').addEventListener('click', () => downloadTxt(buildText($('fmtSelect').value), exportName()));
$('listCopy').addEventListener('click', () => {
  copyText(buildText($('fmtSelect').value))
    .then(() => toast('Copied ' + sel.size + ' links'))
    .catch(() => { forceTextMode(); toast('Clipboard blocked — press Ctrl+A then Ctrl+C', true); });
});

wireBasket();
wireLoadBar();

/* ---------- batch + scan ---------- */

$('goBatchBtn').addEventListener('click', showBatch);
$('batchBack').addEventListener('click', () => { stopBatch(); showHome(); renderHistory(); });
$('batchRun').addEventListener('click', runBatch);
$('scanCancel').addEventListener('click', () => {
  scan.abort = true;
  $('scanTitle').textContent = 'Stopping…';
});

/* ---------- sync ---------- */

$('syncBtn').addEventListener('click', () => { if (Sync.on) syncSignOut(); else syncSignIn(); });

setConfigApplier(() => {
  $('perPageSelect').value = String(S.perPage);
  $('chunkInput').value = String(S.chunkSize);
  $('sortSelect').value = S.sortValue;
  setView(S.viewMode);
});

/* ---------- help + keyboard ---------- */

/** Single place that shows/hides a dialog, so focus handling cannot drift. */
function showModal(id, focusFirst) {
  const m = $(id);
  m.classList.add('on');
  openDialog(m, focusFirst);
}

function hideModal(id) {
  const m = $(id);
  if (!m.classList.contains('on')) return;
  m.classList.remove('on');
  closeDialog(m);
}

$('helpBtn').addEventListener('click', () => showModal('helpModal'));
$('helpClose').addEventListener('click', () => hideModal('helpModal'));
$('helpModal').addEventListener('click', (e) => {
  if (e.target === $('helpModal')) hideModal('helpModal');
});

const typingInField = (e) => {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
};
const anyModalOpen = () =>
  $('listModal').classList.contains('on') || $('helpModal').classList.contains('on');

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (anyModalOpen()) {
      hideModal('listModal');
      hideModal('helpModal');
      return;
    }
    if ($('scanOv').classList.contains('on')) { scan.abort = true; return; }
    if (S.filterText) { S.filterText = ''; $('filterInput').value = ''; applyFilter(); return; }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    return;
  }

  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'a' && !typingInField(e)) {
      e.preventDefault();
      let n = 0;
      S.displayList.forEach((it) => { if (it && !isFolder(it) && addFile(it, null)) n++; });
      changed();
      toast('Selected ' + n + ' files');
    } else if (k === 'd' && !typingInField(e)) {
      e.preventDefault();
      clearSelection();
      toast('Selection cleared');
    } else if (k === 'c' && !typingInField(e) && sel.size && String(window.getSelection()) === '') {
      // Only hijack copy when the user has not highlighted text themselves.
      e.preventDefault();
      copyText(buildText($('fmtSelect').value))
        .then(() => toast('Copied ' + sel.size + ' links'))
        .catch(() => toast('Clipboard blocked', true));
    }
    return;
  }

  if (typingInField(e) || anyModalOpen()) return;

  if (e.key === '/') { e.preventDefault(); $('filterInput').focus(); }
  else if (e.key === '?') showModal('helpModal');
  else if (e.key === 'b' || e.key === 'B') { if (sel.size) openBasket(); }
  else if (e.key === 't' || e.key === 'T') setView(S.viewMode === 'tree' ? 'table' : 'tree');
  else if ((e.key === 'e' || e.key === 'E') && S.viewMode === 'tree' && S.treeRoot) expandAllTree();
});

/* ---------- routing ---------- */

function route() {
  const lc = extractLinkcode(location.hash.replace(/^#/, ''));
  if (!lc) { showHome(); renderHistory(); return; }
  if (currentLc() !== lc) startFolder(lc);
  else showFolder();
}

window.addEventListener('hashchange', route);

/* ---------- boot ---------- */

loadSettings();
loadSelection();

$('perPageSelect').value = String(S.perPage);
$('chunkInput').value = String(S.chunkSize);
$('sortSelect').value = S.sortValue;

applyTheme();
applyDensity();
setView(S.viewMode);          // booted is still false, so this only paints chrome
booted = true;

renderTray();
renderHistory();
renderCacheBadge();
syncInit();
route();
