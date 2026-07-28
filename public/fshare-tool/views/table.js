/* Table view: one client page of a folder, paginated.

   A client page spans perPage/50 upstream pages because the proxy hard-codes
   50 per page and ignores any ?limit we send. */

import { S, $, PAGE_SIZE } from '../lib/state.js';
import { apiFolder, pagesOf, fetchAllPages } from '../lib/api.js';
import { esc, fmtSize, fmtDate, isFolder, fileUrl, copyText, toast } from '../lib/util.js';
import { sel, selFolders, addFile } from '../lib/store.js';
import { bindPick } from '../lib/pick.js';
import { drillInto, renderBreadcrumb } from '../lib/nav.js';
import { touchHistory } from '../lib/store.js';
import { filterTerms, matchesFilter } from '../lib/filter.js';
import { onToggleFolder } from './tree.js';

export function setLoading() {
  $('fileList').innerHTML =
    '<tr class="center-row"><td colspan="6"><span class="spinner"></span> Loading…</td></tr>';
}

export function setError(msg) {
  $('fileList').innerHTML =
    '<tr class="center-row"><td colspan="6" style="color:var(--red)">' + esc(msg) + '</td></tr>';
}

/** Fetch one client page. Sets S.totalPages as a side effect. */
export function loadTablePage(lc, page) {
  const sort = S.sortValue;

  if (S.perPage === 0) {
    return fetchAllPages(lc, sort).then((r) => {
      S.totalPages = 1;
      return { items: r.items, meta: r.meta };
    });
  }

  const per = S.perPage / PAGE_SIZE;          // upstream pages per client page
  const first = (page - 1) * per + 1;

  return apiFolder(lc, first, sort).then((d1) => {
    const head = d1.items || [];
    const totalUp = pagesOf(d1, first, head.length);
    S.totalPages = Math.max(1, Math.ceil(totalUp / per));

    const rest = [];
    for (let p = first + 1; p <= Math.min(first + per - 1, totalUp); p++) rest.push(p);
    if (!rest.length) return { items: head, meta: d1 };

    return Promise.all(rest.map((p) =>
      apiFolder(lc, p, sort).then((d) => ({ p, items: d.items || [] }))
    )).then((parts) => {
      parts.sort((a, b) => a.p - b.p);        // parallel, so restore order
      let items = head.slice();
      parts.forEach((x) => { items = items.concat(x.items); });
      return { items, meta: d1 };
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

  // Numbering continues across pages rather than restarting at 1.
  const base = S.perPage === 0 ? 0 : (S.currentPage - 1) * S.perPage;
  S.displayList = items;
  S.lastPickIdx = -1;

  const frag = document.createDocumentFragment();
  items.forEach((it, i) => frag.appendChild(makeRow(it, base + i + 1, i)));
  tbody.appendChild(frag);

  renderPagination(linkcode);
  paintRowState();
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

/** Hide non-matching rows in place; folders stay so the drill path survives. */
export function applyTableFilter() {
  const terms = filterTerms();
  const on = terms.length > 0;
  const rows = $('fileList').querySelectorAll('tr[data-lc]');
  let shown = 0;

  for (let i = 0; i < rows.length; i++) {
    const tr = rows[i];
    if (tr.getAttribute('data-dir') === '1') { tr.style.display = ''; continue; }
    const lc = tr.getAttribute('data-lc');
    const item = S.pageItems.find((x) => x.linkcode === lc);
    const hit = !on || (item && matchesFilter(item, terms));
    tr.style.display = hit ? '' : 'none';
    if (hit) shown++;
  }
  if (on) $('statsBar').textContent = shown + ' rows match the filter';
}

export function selectPageFiles() {
  let n = 0;
  S.pageItems.forEach((it) => { if (!isFolder(it) && addFile(it, null)) n++; });
  return n;
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
