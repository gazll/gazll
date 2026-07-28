/* Tree view: lazy folder expansion, the load-progress bar, and the flat
   result list shown while a filter is active. */

import { S, $, CONCURRENCY, MAX_FOLDERS, ROW_HEIGHT } from '../lib/state.js';
import { fetchAllPages } from '../lib/api.js';
import { esc, fmtSize, isFolder, fileUrl, folderOf, copyText, toast } from '../lib/util.js';
import { sel, selFolders, addFile, unselectFolder, touchHistory, changed } from '../lib/store.js';
import { bindPick } from '../lib/pick.js';
import { drillInto, renderBreadcrumb } from '../lib/nav.js';
import { filterTerms, filteredFiles, extCounts } from '../lib/filter.js';
import { createVList } from '../lib/vlist.js';
import { scan, openScan, closeScan, paintScan, scanFolder, setScanProgressHook } from '../lib/scan.js';

let vlist = null;

function viewport() {
  const el = $('treeBody');
  if (!vlist) vlist = createVList(el, (entry, i) => entry.build(i));
  return vlist;
}

/* ---------- node cache ---------- */

export function getNode(lc, name) {
  let n = S.nodes.get(lc);
  if (!n) {
    n = { lc, name: name || lc, items: [], loaded: false, loading: false, expanded: false, error: null };
    S.nodes.set(lc, n);
  } else if (name && n.name === n.lc) {
    n.name = name;
  }
  return n;
}

/** Fetch every page of one folder once, then serve it from cache forever. */
export function loadNode(lc, name) {
  const n = getNode(lc, name);
  if (n.loaded) return Promise.resolve(n);
  if (n.loading) return n.loading;

  n.error = null;
  n.loading = fetchAllPages(lc, S.sortValue).then((r) => {
    n.items = r.items;
    n.loaded = true;
    n.loading = false;
    n.name = (r.meta.current && r.meta.current.name) || n.name;
    renderTree();
    return n;
  }).catch((e) => {
    n.loading = false;
    n.error = e.message;
    renderTree();
    throw e;
  });

  renderTree();
  return n.loading;
}

export function toggleNode(lc, name) {
  const n = getNode(lc, name);
  if (n.expanded) { n.expanded = false; renderTree(); return; }
  loadNode(lc, name).then((nn) => { nn.expanded = true; renderTree(); }).catch(() => {});
}

/** Flatten the currently expanded part of the tree into renderable rows. */
export function visibleRows(lc, depth, out) {
  const n = S.nodes.get(lc);
  if (!n || !n.expanded || !n.loaded) return;
  n.items.forEach((it) => {
    out.push({ item: it, depth });
    if (isFolder(it)) visibleRows(it.linkcode, depth + 1, out);
  });
}

/** Gather files from cache. False when any folder below is still unloaded. */
export function collectSubtree(lc, out) {
  const n = S.nodes.get(lc);
  if (!n || !n.loaded) return false;
  let complete = true;
  n.items.forEach((it) => {
    if (isFolder(it)) { if (!collectSubtree(it.linkcode, out)) complete = false; }
    else out.push(it);
  });
  return complete;
}

/**
 * Cumulative size below a folder. `complete` is false while any descendant is
 * unloaded, so the number renders as a lower bound rather than a wrong total.
 * The placeholder written before recursing also breaks folder cycles.
 */
export function calcSize(lc, memo) {
  if (memo[lc]) return memo[lc];
  const n = S.nodes.get(lc);
  if (!n || !n.loaded) return (memo[lc] = { bytes: 0, files: 0, complete: false });

  memo[lc] = { bytes: 0, files: 0, complete: false };   // cycle guard
  let bytes = 0, files = 0, complete = true;
  for (let i = 0; i < n.items.length; i++) {
    const it = n.items[i];
    if (isFolder(it)) {
      const s = calcSize(it.linkcode, memo);
      bytes += s.bytes; files += s.files;
      if (!s.complete) complete = false;
    } else {
      bytes += it.size || 0; files++;
    }
  }
  return (memo[lc] = { bytes, files, complete });
}

let sizeMemo = {};

/* ---------- rows ---------- */

function treeRow(item, depth, seq, idx) {
  const folder = isFolder(item);
  const lc = item.linkcode || item.code || '';
  const n = folder ? S.nodes.get(lc) : null;

  const row = document.createElement('div');
  row.className = 'trow';
  row.setAttribute('data-lc', lc);
  row.setAttribute('data-dir', folder ? '1' : '0');
  row.style.paddingLeft = (14 + depth * 22) + 'px';

  const num = document.createElement('span');
  num.className = 'tnum';
  num.textContent = seq;
  row.appendChild(num);

  const chev = document.createElement('span');
  chev.className = 'tchev' + (folder ? (n && n.expanded ? ' open' : '') : ' leaf');
  chev.textContent = '▶';
  if (folder) chev.addEventListener('click', () => toggleNode(lc, item.name));
  row.appendChild(chev);

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = folder ? selFolders.has(lc) : sel.has(lc);
  cb.title = folder ? 'Select every file inside' : 'Select this file — Shift+click for a range';
  if (folder) cb.addEventListener('change', () => onToggleFolderTree(lc, item.name, cb));
  else bindPick(cb, idx, item);
  row.appendChild(cb);

  const icon = document.createElement('div');
  icon.className = 'file-icon-wrap sm ' + (folder ? 'is-folder' : 'is-file');
  icon.innerHTML = folder
    ? '<svg class="file-icon" viewBox="0 0 24 24" fill="#f5a623"><path d="M10 4H2v16h20V6H12l-2-2z"/></svg>'
    : '<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="#4a9eff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  row.appendChild(icon);

  const nameEl = document.createElement('div');
  nameEl.className = 'tname' + (folder ? ' dir' : '');
  nameEl.title = item.name;
  if (folder) {
    nameEl.textContent = item.name;
    nameEl.addEventListener('click', () => toggleNode(lc, item.name));
  } else {
    const a = document.createElement('a');
    a.href = fileUrl(lc);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = item.name;
    nameEl.appendChild(a);
  }
  row.appendChild(nameEl);

  if (folder && n) {
    if (n.loading) {
      const sp = document.createElement('span');
      sp.className = 'tspin';
      row.appendChild(sp);
    } else if (n.error) {
      const er = document.createElement('span');
      er.className = 'terr';
      er.textContent = 'failed';
      row.appendChild(er);
    } else if (n.loaded) {
      const c = document.createElement('span');
      c.className = 'tcount';
      const nf = n.items.filter((x) => !isFolder(x)).length;
      c.textContent = (n.items.length - nf) + ' folders · ' + nf + ' files';
      row.appendChild(c);
    }
  }

  const meta = document.createElement('span');
  meta.className = 'tmeta';
  if (!folder) {
    meta.textContent = fmtSize(item.size || 0);
  } else {
    const s = calcSize(lc, sizeMemo);
    if (!n || !n.loaded) meta.textContent = '';
    else if (s.complete) meta.textContent = fmtSize(s.bytes);
    else {
      meta.textContent = '~' + fmtSize(s.bytes);
      meta.className = 'tmeta partial';
      meta.title = 'Subfolders are not fully loaded — this is a lower bound';
    }
  }
  row.appendChild(meta);

  const badge = document.createElement('span');
  badge.className = 'badge ' + (folder ? 'badge-folder' : 'badge-copy');
  badge.textContent = folder ? 'Enter' : 'Copy';
  if (folder) badge.addEventListener('click', () => drillInto(lc, item.name));
  else badge.addEventListener('click', () => {
    copyText(fileUrl(lc)).then(() => {
      badge.textContent = 'OK';
      badge.classList.add('badge-ok');
      setTimeout(() => { badge.textContent = 'Copy'; badge.classList.remove('badge-ok'); }, 1400);
    }).catch(() => toast('The browser blocked clipboard access', true));
  });
  row.appendChild(badge);

  return row;
}

function filterRow(item, seq, idx) {
  const row = document.createElement('div');
  row.className = 'trow';
  row.setAttribute('data-lc', item.linkcode);
  row.setAttribute('data-dir', '0');

  const num = document.createElement('span');
  num.className = 'tnum';
  num.textContent = seq;
  row.appendChild(num);

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = sel.has(item.linkcode);
  cb.title = 'Shift+click for a range';
  bindPick(cb, idx, item);
  row.appendChild(cb);

  const icon = document.createElement('div');
  icon.className = 'file-icon-wrap sm is-file';
  icon.innerHTML = '<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="#4a9eff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  row.appendChild(icon);

  const nm = document.createElement('div');
  nm.className = 'tname';
  nm.title = item.name;
  const a = document.createElement('a');
  a.href = fileUrl(item.linkcode);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = item.name;
  nm.appendChild(a);
  const fo = folderOf(item.path);
  if (fo) {
    const badge = document.createElement('span');
    badge.className = 'tcount';
    badge.style.marginLeft = '8px';
    badge.textContent = fo;
    nm.appendChild(badge);
  }
  row.appendChild(nm);

  const meta = document.createElement('span');
  meta.className = 'tmeta';
  meta.textContent = fmtSize(item.size || 0);
  row.appendChild(meta);

  return row;
}

/* ---------- rendering ---------- */

export function renderTree() {
  renderTreeProgress(!S.quietRender);
  if (S.quietRender || S.viewMode !== 'tree' || !S.treeRoot) return;

  const body = $('treeBody');
  const root = S.nodes.get(S.treeRoot);

  if (!root || (!root.loaded && root.loading)) {
    if (vlist) vlist.setItems([]);
    body.innerHTML = '<div class="tree-empty"><span class="spinner"></span> Loading…</div>';
    return;
  }
  if (root && root.error) {
    if (vlist) vlist.setItems([]);
    body.innerHTML = '<div class="tree-empty" style="color:var(--red)">Error: ' + esc(root.error) + '</div>';
    return;
  }

  // With a filter on, the tree shape gets in the way of picking, so show a flat
  // list of every matching file across all loaded folders instead.
  if (filterTerms().length) { renderFilterList(); return; }

  const rows = [];
  visibleRows(S.treeRoot, 0, rows);
  if (!rows.length) {
    if (vlist) vlist.setItems([]);
    body.innerHTML = '<div class="tree-empty">This folder is empty.</div>';
    $('treeStat').textContent = '';
    return;
  }

  sizeMemo = {};                                  // sizes shift as folders load
  S.displayList = rows.map((r) => r.item);
  S.lastPickIdx = -1;

  viewport().setItems(rows.map((r) => ({
    build: (i) => treeRow(r.item, r.depth, i + 1, i)
  })));

  let loadedFolders = 0, knownFiles = 0;
  S.nodes.forEach((n) => {
    if (!n.loaded) return;
    loadedFolders++;
    knownFiles += n.items.filter((x) => !isFolder(x)).length;
  });
  $('treeStat').textContent = rows.length + ' rows · ' + loadedFolders +
    ' folders loaded · ' + knownFiles + ' files';
}

export function renderFilterList() {
  const body = $('treeBody');
  const hits = filteredFiles();

  if (!hits.length) {
    if (vlist) vlist.setItems([]);
    body.innerHTML = '<div class="tree-empty">Nothing matches inside what is loaded.' +
      '<br><span style="font-size:.8rem">Expand more folders, then filter again.</span></div>';
    $('treeStat').textContent = '0 results';
    return;
  }

  let bytes = 0;
  hits.forEach((it) => { bytes += it.size || 0; });
  $('treeStat').textContent = hits.length + ' results · ' + fmtSize(bytes);

  S.displayList = hits;
  S.lastPickIdx = -1;
  viewport().setItems(hits.map((it) => ({ build: (i) => filterRow(it, i + 1, i) })));
}

/** Repaint checkboxes in the rendered slice without rebuilding the list. */
export function paintRowState() {
  const rows = $('treeBody').querySelectorAll('.trow[data-lc]');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lc = row.getAttribute('data-lc');
    const on = row.getAttribute('data-dir') === '1' ? selFolders.has(lc) : sel.has(lc);
    const cb = row.querySelector('input[type=checkbox]');
    if (cb) cb.checked = on;
    row.classList.toggle('picked', on);
  }
}

/* ---------- load progress ---------- */

/**
 * Walk everything discovered below treeRoot and report how much is loaded.
 * Folders are only ever discovered by reading a loaded parent, so pending === 0
 * genuinely means the whole subtree is in memory — nothing is left to find.
 */
export function treeProgress() {
  const seen = Object.create(null);
  const stack = [S.treeRoot];
  let total = 0, loaded = 0, files = 0, bytes = 0;
  seen[S.treeRoot] = true;

  while (stack.length) {
    const lc = stack.pop();
    total++;
    const n = S.nodes.get(lc);
    if (!n || !n.loaded) continue;
    loaded++;
    for (let i = 0; i < n.items.length; i++) {
      const it = n.items[i];
      if (isFolder(it)) {
        if (!seen[it.linkcode]) { seen[it.linkcode] = true; stack.push(it.linkcode); }
      } else {
        files++;
        bytes += it.size || 0;
      }
    }
  }
  return { total, loaded, pending: total - loaded, files, bytes, complete: total === loaded };
}

let progTimer = null;

export function renderTreeProgress(force) {
  if (S.viewMode !== 'tree' || !S.treeRoot) return;
  if (!force && progTimer) return;
  if (!force) progTimer = setTimeout(() => { progTimer = null; }, 120);

  const p = treeProgress();
  const pct = p.total ? Math.round(p.loaded / p.total * 100) : 0;
  const wrap = $('treeProg');
  wrap.classList.toggle('done', p.complete);
  $('tpBar').style.width = pct + '%';
  $('tpPct').textContent = pct + '%';
  $('tpMore').style.display = p.complete ? 'none' : '';
  $('tpLabel').innerHTML = p.complete
    ? '✓ Fully loaded — <b>' + p.total + '</b> folders, <b>' + p.files + '</b> files' +
      (p.bytes ? ', <b>' + fmtSize(p.bytes) + '</b>' : '')
    : 'Loaded <b>' + p.loaded + '</b>/<b>' + p.total + '</b> folders · <b>' + p.pending +
      '</b> still closed · <b>' + p.files + '</b> files seen';
}

/* ---------- crawling ---------- */

export function runScan(rootLc, recursive, srcTag, title) {
  openScan(title);
  return scanFolder(rootLc, recursive).then((files) => {
    let added = 0;
    files.forEach((it) => { if (addFile(it, srcTag)) added++; });
    closeScan();
    changed();
    renderTree();
    toast(scan.abort
      ? 'Stopped — added ' + added + ' files'
      : 'Added ' + added + ' files' +
        (added !== files.length ? ' (' + (files.length - added) + ' already there)' : ''));
    return added;
  }).catch((e) => {
    closeScan();
    toast('Crawl failed: ' + e.message, true);
  });
}

/** Table view uses this too, hence the export. */
export function onToggleFolder(lc, name, cb) {
  if (!cb.checked) {
    unselectFolder(lc);
    changed();
    return;
  }
  selFolders.add(lc);
  cb.disabled = true;
  runScan(lc, true, lc, 'Crawling "' + name + '"…').then(() => {
    cb.disabled = false;
    let any = false;
    sel.forEach((v) => { if (v.src === lc) any = true; });
    if (!any) selFolders.delete(lc);
    changed();
  });
}

/** Prefers the cache: after Expand all this is instant and hits no network. */
export function onToggleFolderTree(lc, name, cb) {
  if (!cb.checked) {
    unselectFolder(lc);
    changed();
    return;
  }
  selFolders.add(lc);

  const cached = [];
  if (collectSubtree(lc, cached)) {
    let added = 0;
    cached.forEach((it) => { if (addFile(it, lc)) added++; });
    changed();
    toast('Added ' + added + ' files (from cache)');
    return;
  }
  runScan(lc, true, lc, 'Crawling "' + (name || lc) + '"…').then(() => {
    let any = false;
    sel.forEach((v) => { if (v.src === lc) any = true; });
    if (!any) selFolders.delete(lc);
    changed();
  });
}

export function expandAllTree() {
  if (!S.treeRoot) return;
  openScan('Expanding the whole tree…');

  const seen = Object.create(null);
  const queue = [S.treeRoot];
  let seenCount = 1;
  seen[S.treeRoot] = true;
  scan.state.total = 1;
  S.quietRender = true;

  const step = () => {
    if (scan.abort || !queue.length) return Promise.resolve();
    const batch = queue.splice(0, CONCURRENCY);

    return Promise.all(batch.map((lc) =>
      loadNode(lc, null).then((n) => {
        n.expanded = true;
        $('scNow').textContent = n.name;
        n.items.forEach((it) => {
          if (isFolder(it)) {
            if (!seen[it.linkcode] && seenCount < MAX_FOLDERS) {
              seen[it.linkcode] = true;
              seenCount++;
              queue.push(it.linkcode);
              scan.state.total++;
            }
          } else scan.state.files++;
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

  return step().then(() => {
    S.quietRender = false;
    closeScan();
    renderTree();
    renderTreeProgress(true);
    toast(scan.abort
      ? 'Stopped — loaded ' + scan.state.done + ' folders'
      : 'Loaded ' + scan.state.done + ' folders, ' + scan.state.files + ' files');
  }).catch((e) => {
    S.quietRender = false;
    closeScan();
    renderTreeProgress(true);
    toast('Failed: ' + e.message, true);
  });
}

export function collapseAllTree() {
  S.nodes.forEach((n) => { if (n.lc !== S.treeRoot) n.expanded = false; });
  renderTree();
}

/* ---------- entry point ---------- */

export function openTree(lc) {
  S.treeRoot = lc;
  const n = getNode(lc, S.navStack.length ? S.navStack[S.navStack.length - 1].name : lc);
  n.expanded = true;

  if (n.loaded) { touchHistory(lc, n.name); renderTree(); return; }
  loadNode(lc, n.name).then((nn) => {
    if (S.navStack.length === 1) touchHistory(lc, nn.name);
    if (S.navStack.length) S.navStack[S.navStack.length - 1].name = nn.name;
    renderBreadcrumb();
    renderTree();
  }).catch(() => {});
}

export function renderExtChips(onPick) {
  const wrap = $('extChips');
  if (!wrap) return;
  wrap.innerHTML = '';
  extCounts().forEach((e) => {
    const b = document.createElement('button');
    b.className = 'chip' + (S.filterText.toLowerCase().indexOf('.' + e.ext) !== -1 ? ' on' : '');
    b.textContent = '.' + e.ext + ' (' + e.n + ')';
    b.addEventListener('click', () => onPick('.' + e.ext));
    wrap.appendChild(b);
  });
}

// Keep the inline progress bar live while a crawl runs behind the overlay.
setScanProgressHook(() => renderTreeProgress(false));
