/* Table view: one client page of a folder, paginated.

   A client page spans perPage/50 upstream pages because the proxy hard-codes
   50 per page and ignores any ?limit we send. */

import { S, $, PAGE_SIZE } from '../lib/state.js';
import { apiFolder, pagesOf, fetchAllPages } from '../lib/api.js';
import { cacheGet, cachePageGet, cachePageSet, isBypassed } from '../lib/cache.js';
import { esc, fmtSize, fmtDate, isFolder, fileUrl, copyText, toast } from '../lib/util.js';
import { sel, selFolders } from '../lib/store.js';
import { bindPick } from '../lib/pick.js';
import { drillInto, renderBreadcrumb } from '../lib/nav.js';
import { touchHistory } from '../lib/store.js';
import { filterTerms, matchesFilter } from '../lib/filter.js';
import { createVTable } from '../lib/vlist.js';
import { onToggleFolder } from './tree.js';

export function setLoading() {
  $('fileList').innerHTML =
    '<tr class="center-row"><td colspan="6"><span class="spinner"></span> Loading…</td></tr>';
}

export function setError(msg) {
  $('fileList').innerHTML =
    '<tr class="center-row"><td colspan="6" style="color:var(--red)">' + esc(msg) + '</td></tr>';
}

/** One upstream page, from cache when possible. */
function upstreamPage(lc, sort, page) {
  if (!isBypassed()) {
    const hit = cachePageGet(lc, sort, page);
    if (hit) {
      return Promise.resolve({
        items: hit.items,
        meta: { current: { name: hit.name, path: hit.path } },
        totalPages: hit.totalPages,
        cached: true
      });
    }
  }
  return apiFolder(lc, page, sort).then((d) => {
    const items = d.items || [];
    const tp = pagesOf(d, page, items.length);
    const cur = d.current || {};
    cachePageSet(lc, sort, page, items, cur.name || '', cur.path || '', tp);
    return { items, meta: d, totalPages: tp, cached: false };
  });
}

/**
 * Fetch one client page, which spans perPage/50 upstream pages. Sets
 * S.totalPages as a side effect.
 *
 * A whole-folder cache entry wins outright: if the tree already crawled this
 * folder, every table page is just a slice of memory.
 */
export function loadTablePage(lc, page) {
  const sort = S.sortValue;

  if (S.perPage === 0) {
    return fetchAllPages(lc, sort).then((r) => {
      S.totalPages = 1;
      return { items: r.items, meta: r.meta };
    });
  }

  const per = S.perPage / PAGE_SIZE;          // upstream pages per client page

  if (!isBypassed()) {
    const whole = cacheGet(lc, sort);
    if (whole) {
      S.totalPages = Math.max(1, Math.ceil(whole.items.length / S.perPage));
      const from = (page - 1) * S.perPage;
      return Promise.resolve({
        items: whole.items.slice(from, from + S.perPage),
        meta: { current: { name: whole.name, path: whole.path } }
      });
    }
  }

  const first = (page - 1) * per + 1;

  return upstreamPage(lc, sort, first).then((r1) => {
    const totalUp = r1.totalPages;
    S.totalPages = Math.max(1, Math.ceil(totalUp / per));

    const rest = [];
    for (let p = first + 1; p <= Math.min(first + per - 1, totalUp); p++) rest.push(p);
    if (!rest.length) return { items: r1.items, meta: r1.meta };

    return Promise.all(rest.map((p) =>
      upstreamPage(lc, sort, p).then((r) => ({ p, items: r.items }))
    )).then((parts) => {
      parts.sort((a, b) => a.p - b.p);        // parallel, so restore order
      let items = r1.items.slice();
      parts.forEach((x) => { items = items.concat(x.items); });
      return { items, meta: r1.meta };
    });
  });
}

/** Entry point registered with nav.js. */
export function showTable(linkcode) {
  setLoading();
  loadTablePage(linkcode, S.currentPage)
    .then((r) => renderFolder(r.items, r.meta, linkcode))
    .catch((e) => setError('Could not load folder: ' + e.message));
}

export function renderFolder(items, meta, linkcode) {
  const current = (meta && meta.current) || {};
  items = Array.isArray(items) ? items : [];
  S.pageItems = items;                        // S.totalPages was set by loadTablePage

  const entry = S.navStack[S.navStack.length - 1];
  const fname = current.name || (meta && meta.name) || entry.name;
  entry.name = fname;
  if (S.navStack.length === 1) touchHistory(linkcode, fname);

  if (S.navStack.length === 1) {
    const fpath = current.path || '';
    $('folderHeader').innerHTML =
      '<div class="folder-title"><svg width="22" height="22" viewBox="0 0 24 24" fill="#f5a623" style="flex-shrink:0"><path d="M10 4H2v16h20V6H12l-2-2z"/></svg>' + esc(fname) + '</div>' +
      (fpath ? '<div class="folder-path">Fshare:// <span>' + esc(fpath) + '</span></div>' : '');
    document.title = fname + ' — Fshare Bulk Copy';
  }
  renderBreadcrumb();

  let nFolders = 0, nFiles = 0, bytes = 0;
  items.forEach((it) => {
    if (isFolder(it)) nFolders++; else { nFiles++; bytes += it.size || 0; }
  });
  $('statsBar').textContent = nFolders + ' folders, ' + nFiles + ' files' +
    (bytes ? ' — ' + fmtSize(bytes) : '');

  const tbody = $('fileList');
  tbody.innerHTML = '';
  if (!items.length) {
    tbody.innerHTML = '<tr class="center-row"><td colspan="6">This folder is empty.</td></tr>';
    renderPagination(linkcode);
    return;
  }

  S.displayList = items;
  S.lastPickIdx = -1;
  // A filter typed before this folder finished loading still applies to it.
  if (filterTerms().length) applyTableFilter();
  else { paintRows(); paintRowState(); }
  renderPagination(linkcode);
}

/**
 * Build the rows for whatever is already in S.pageItems. Up to 1000 rows per
 * page, so the same virtualisation the tree uses.
 */
function paintRows() {
  // Numbering continues across pages rather than restarting at 1.
  const base = S.perPage === 0 ? 0 : (S.currentPage - 1) * S.perPage;
  vtable().setItems(S.pageItems.map((it, i) => ({ it, seq: base + i + 1, idx: i })));
}

/** Rebuild the full, unfiltered page — density change, or a cleared filter. */
export function rerenderTable() {
  if (!S.pageItems.length) return;
  S.displayList = S.pageItems;
  S.lastPickIdx = -1;
  paintRows();
  paintRowState();
}

let vt = null;
function vtable() {
  if (!vt) {
    vt = createVTable($('fileList'), (row) => makeRow(row.it, row.seq, row.idx));
  }
  return vt;
}

function makeRow(item, seq, idx) {
  const folder = isFolder(item);
  const lc = item.linkcode || item.code || '';
  const name = item.name || item.filename || '(no name)';

  const tr = document.createElement('tr');
  tr.setAttribute('data-lc', lc);
  tr.setAttribute('data-dir', folder ? '1' : '0');

  const numTd = document.createElement('td');
  numTd.className = 'num-col';
  numTd.textContent = seq;
  tr.appendChild(numTd);

  const chkTd = document.createElement('td');
  chkTd.className = 'chk-col';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.title = folder ? 'Select this whole folder (recursive crawl)'
                    : 'Select this file — Shift+click for a range';
  if (folder) cb.addEventListener('change', () => onToggleFolder(lc, name, cb));
  else bindPick(cb, idx, item);
  chkTd.appendChild(cb);
  tr.appendChild(chkTd);

  const nameTd = document.createElement('td');
  nameTd.className = 'name-col';
  const cell = document.createElement('div');
  cell.className = 'name-cell';

  const iconWrap = document.createElement('div');
  iconWrap.className = 'file-icon-wrap ' + (folder ? 'is-folder' : 'is-file');
  iconWrap.innerHTML = folder
    ? '<svg class="file-icon" viewBox="0 0 24 24" fill="#f5a623"><path d="M10 4H2v16h20V6H12l-2-2z"/></svg>'
    : '<svg class="file-icon" viewBox="0 0 24 24" fill="none" stroke="#4a9eff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  cell.appendChild(iconWrap);

  const nameEl = folder ? document.createElement('span') : document.createElement('a');
  nameEl.className = 'item-name ' + (folder ? 'item-folder' : 'item-file-link');
  nameEl.textContent = name;
  nameEl.title = name;
  if (folder) nameEl.addEventListener('click', () => drillInto(lc, name));
  else {
    nameEl.href = fileUrl(lc);
    nameEl.target = '_blank';
    nameEl.rel = 'noopener noreferrer';
  }
  cell.appendChild(nameEl);
  nameTd.appendChild(cell);
  tr.appendChild(nameTd);

  const sizeTd = document.createElement('td');
  sizeTd.className = 'size-cell';
  sizeTd.textContent = folder ? 'Folder' : fmtSize(item.size || 0);
  tr.appendChild(sizeTd);

  const dateTd = document.createElement('td');
  dateTd.className = 'date-cell';
  dateTd.textContent = fmtDate(item.modified || item.updated || item.created || '');
  tr.appendChild(dateTd);

  const actTd = document.createElement('td');
  actTd.className = 'act-col';
  const badge = document.createElement('span');
  badge.className = 'badge ' + (folder ? 'badge-folder' : 'badge-copy');
  badge.textContent = folder ? 'Open' : 'Copy link';
  if (folder) badge.addEventListener('click', () => drillInto(lc, name));
  else badge.addEventListener('click', () => {
    copyText(fileUrl(lc)).then(() => {
      const orig = badge.textContent;
      badge.textContent = 'Copied!';
      badge.classList.add('badge-ok');
      setTimeout(() => { badge.textContent = orig; badge.classList.remove('badge-ok'); }, 1500);
    }).catch(() => toast('The browser blocked clipboard access', true));
  });
  actTd.appendChild(badge);
  tr.appendChild(actTd);

  return tr;
}

/** Repaint checkboxes and highlights without refetching. */
export function paintRowState() {
  const rows = $('fileList').querySelectorAll('tr[data-lc]');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lc = row.getAttribute('data-lc');
    const on = row.getAttribute('data-dir') === '1' ? selFolders.has(lc) : sel.has(lc);
    const cb = row.querySelector('input[type=checkbox]');
    if (cb) cb.checked = on;
    row.classList.toggle('picked', on);
  }
  syncHeaderCheckbox();
}

export function syncHeaderCheckbox() {
  const files = S.pageItems.filter((it) => !isFolder(it));
  const picked = files.filter((it) => sel.has(it.linkcode)).length;
  const cb = $('chkAll');
  if (!cb) return;
  cb.checked = files.length > 0 && picked === files.length;
  cb.indeterminate = picked > 0 && picked < files.length;
}

/**
 * Drop non-matching rows; folders stay so the drill path survives.
 *
 * Rebuilt rather than hidden in place: the virtual scroller sizes its spacers
 * from the item count, so `display:none` rows would leave it measuring a
 * height the table no longer has.
 */
export function applyTableFilter() {
  const terms = filterTerms();
  const on = terms.length > 0;
  if (!on) { rerenderTable(); return; }

  // The row number keeps referring to the unfiltered page; `idx` has to be the
  // position within what is on screen, because Shift+click ranges index it.
  const base = S.perPage === 0 ? 0 : (S.currentPage - 1) * S.perPage;
  const rows = [];
  const shownItems = [];
  let files = 0;

  S.pageItems.forEach((it, i) => {
    if (!isFolder(it) && !matchesFilter(it, terms)) return;
    if (!isFolder(it)) files++;
    rows.push({ it, seq: base + i + 1, idx: rows.length });
    shownItems.push(it);
  });

  S.displayList = shownItems;
  S.lastPickIdx = -1;
  vtable().setItems(rows);
  paintRowState();
  $('statsBar').textContent = files + ' files match the filter';
}

/* ---------- pagination ---------- */

export function renderPagination(linkcode) {
  const info = $('pgInfo');
  [$('paginationTop'), $('paginationBot')].forEach((wrap) => {
    wrap.innerHTML = '';
    if (S.totalPages <= 1) return;

    const mk = (label, page, opts) => {
      const b = document.createElement('button');
      b.className = 'pg-btn' + (opts && opts.active ? ' active' : '');
      b.textContent = label;
      if (opts && opts.disabled) b.disabled = true;
      else b.addEventListener('click', () => {
        S.currentPage = page;
        showTable(linkcode);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      wrap.appendChild(b);
    };

    mk('← Prev', S.currentPage - 1, { disabled: S.currentPage <= 1 });
    buildPageList(S.currentPage, S.totalPages).forEach((p) => {
      if (p === '...') {
        const e = document.createElement('span');
        e.className = 'pg-ellipsis';
        e.textContent = '…';
        wrap.appendChild(e);
      } else {
        mk(String(p), p, { active: p === S.currentPage, disabled: p === S.currentPage });
      }
    });
    mk('Next →', S.currentPage + 1, { disabled: S.currentPage >= S.totalPages });
  });

  info.textContent = S.totalPages > 1 ? 'Page ' + S.currentPage + ' of ' + S.totalPages : '';
}

export function buildPageList(p, tot) {
  const pages = [1];
  if (p - 2 > 2) pages.push('...');
  for (let i = Math.max(2, p - 2); i <= Math.min(tot - 1, p + 2); i++) pages.push(i);
  if (p + 2 < tot - 1) pages.push('...');
  if (tot > 1) pages.push(tot);
  return pages;
}
