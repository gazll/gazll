/* Selection basket: the manager dialog and every export format. */

import { S, $ } from '../lib/state.js';
import { fmtSize, fileUrl, folderOf, downloadTxt, toast } from '../lib/util.js';
import { sel, removeFile, clearSelection, selTotals, changed } from '../lib/store.js';

let search = '', sortBy = 'add', dupOnly = false, textMode = false;

/* ---------- duplicates ---------- */

/** Names appearing more than once in the basket, lowercased. */
export function dupNames() {
  const seen = Object.create(null), dup = Object.create(null);
  sel.forEach((v) => {
    const k = String(v.name || '').toLowerCase();
    if (seen[k]) dup[k] = true; else seen[k] = true;
  });
  return dup;
}

export function basketRows() {
  const dup = dupNames();
  let rows = Array.from(sel.values()).map((v, i) => ({
    v, i, isDup: !!dup[String(v.name || '').toLowerCase()]
  }));

  const q = search.trim().toLowerCase();
  if (q) rows = rows.filter((r) => String(r.v.name || '').toLowerCase().indexOf(q) !== -1);
  if (dupOnly) rows = rows.filter((r) => r.isDup);

  switch (sortBy) {
    case 'name':  rows.sort((a, b) => String(a.v.name).localeCompare(String(b.v.name))); break;
    case 'size':  rows.sort((a, b) => (a.v.size || 0) - (b.v.size || 0)); break;
    case '-size': rows.sort((a, b) => (b.v.size || 0) - (a.v.size || 0)); break;
    case 'folder':
      rows.sort((a, b) => {
        const f = folderOf(a.v.path).localeCompare(folderOf(b.v.path));
        return f !== 0 ? f : String(a.v.name).localeCompare(String(b.v.name));
      });
      break;
  }
  return rows;
}

/* ---------- rendering ---------- */

export function renderBasket() {
  const dup = dupNames();
  let dupCount = 0;
  sel.forEach((v) => { if (dup[String(v.name || '').toLowerCase()]) dupCount++; });

  $('bkDup').textContent = 'Duplicates: ' + dupCount;
  $('bkDup').classList.toggle('on', dupOnly);
  $('bkList').style.display = textMode ? 'none' : '';
  $('listArea').style.display = textMode ? '' : 'none';
  $('bkMode').textContent = textMode ? 'List view' : 'Text view';
  if (textMode) $('listArea').value = buildText($('fmtSelect').value);

  const rows = basketRows();
  let bytes = 0;
  rows.forEach((r) => { bytes += r.v.size || 0; });
  $('bkTotal').textContent = rows.length + ' / ' + sel.size + ' files' +
    (bytes ? ' · ' + fmtSize(bytes) : '');
  $('listTitle').textContent = 'Selection basket (' + sel.size + ' files)';

  if (textMode) return;

  const box = $('bkList');
  box.innerHTML = '';
  if (!rows.length) {
    box.innerHTML = '<div class="bk-empty">No rows match.</div>';
    return;
  }

  const frag = document.createDocumentFragment();
  rows.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = 'bk-row' + (r.isDup ? ' dup' : '');

    const n = document.createElement('span');
    n.className = 'bk-n';
    n.textContent = i + 1;
    row.appendChild(n);

    const nm = document.createElement('span');
    nm.className = 'bk-name';
    const a = document.createElement('a');
    a.href = fileUrl(r.v.linkcode);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = r.v.name;
    a.title = r.v.name;
    nm.appendChild(a);
    const fo = folderOf(r.v.path);
    if (fo) {
      const f = document.createElement('span');
      f.className = 'bk-fold';
      f.textContent = fo;
      nm.appendChild(f);
    }
    row.appendChild(nm);

    const sz = document.createElement('span');
    sz.className = 'bk-sz';
    sz.textContent = fmtSize(r.v.size || 0);
    row.appendChild(sz);

    const x = document.createElement('button');
    x.className = 'bk-x';
    x.textContent = '✕';
    x.title = 'Remove from basket';
    x.addEventListener('click', () => {
      removeFile(r.v.linkcode);
      changed();
      renderBasket();
    });
    row.appendChild(x);

    frag.appendChild(row);
  });
  box.appendChild(frag);
}

export function openBasket() {
  renderBasket();
  $('listModal').classList.add('on');
  setTimeout(() => $('bkSearch').focus(), 50);
}

/* ---------- tray ---------- */

export function renderTray() {
  const t = selTotals();
  const tray = $('tray');
  tray.classList.toggle('on', t.count > 0);
  $('trayCount').textContent = t.count + ' files selected';
  $('traySub').textContent = t.bytes ? 'Total ' + fmtSize(t.bytes) : '';
  document.body.style.paddingBottom = t.count > 0 ? '96px' : '24px';
}

/* ---------- export ---------- */

/** RFC 4180: quote when the value holds a comma, quote or newline. */
export function csvCell(s) {
  s = String(s == null ? '' : s);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function buildLines(fmt) {
  const lines = [];
  sel.forEach((v) => {
    const url = fileUrl(v.linkcode);
    const fo = folderOf(v.path);
    const tag = fo ? '[' + fo + '] ' : '';
    switch (fmt) {
      case 'name-link':        lines.push(v.name + ' — ' + url); break;
      case 'link-name':        lines.push(url + '  # ' + v.name); break;
      case 'md':               lines.push('- [' + v.name + '](' + url + ')'); break;
      case 'full':             lines.push(v.name + ' | ' + fmtSize(v.size) + ' | ' + url); break;
      case 'folder-link':      lines.push(tag + url); break;
      case 'folder-name-link': lines.push(tag + v.name + ' — ' + url); break;
      case 'csv':              lines.push([v.name, fo, v.size || 0, url].map(csvCell).join(',')); break;
      default:                 lines.push(url);
    }
  });
  if (fmt === 'csv') lines.unshift('name,folder,size_bytes,url');
  return lines;
}

export function buildJson() {
  return JSON.stringify(Array.from(sel.values()).map((v) => ({
    name: v.name,
    folder: folderOf(v.path),
    size: v.size || 0,
    linkcode: v.linkcode,
    url: fileUrl(v.linkcode)
  })), null, 2);
}

export function buildText(fmt) {
  return fmt === 'json' ? buildJson() : buildLines(fmt).join('\n');
}

export function exportName() {
  const base = S.navStack.length ? S.navStack[S.navStack.length - 1].name : 'fshare';
  const fmt = $('fmtSelect').value;
  const ext = fmt === 'csv' ? '.csv' : fmt === 'json' ? '.json' : '.txt';
  return String(base).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 60) + ext;
}

/** Split the basket into several files of `size` links each. */
export function exportChunks(size) {
  const lines = buildLines($('fmtSelect').value);
  if (!lines.length) return;
  size = Math.max(1, Math.min(10000, size || 49));

  const parts = Math.ceil(lines.length / size);
  const width = String(parts).length;
  const base = exportName().replace(/\.(txt|csv|json)$/, '');

  // Sequential with a gap: browsers throttle or block a burst of downloads.
  let i = 0;
  const next = () => {
    if (i >= parts) { toast('Downloaded ' + parts + ' files × ' + size + ' links'); return; }
    const slice = lines.slice(i * size, (i + 1) * size);
    downloadTxt(slice.join('\r\n') + '\r\n',
                base + '-part-' + String(i + 1).padStart(width, '0') + '.txt');
    i++;
    setTimeout(next, 350);
  };
  next();
}

/* ---------- wiring ---------- */

export function wireBasket() {
  $('bkSearch').addEventListener('input', () => { search = $('bkSearch').value; renderBasket(); });
  $('bkSort').addEventListener('change', () => { sortBy = $('bkSort').value; renderBasket(); });
  $('bkDup').addEventListener('click', () => { dupOnly = !dupOnly; renderBasket(); });
  $('bkMode').addEventListener('click', () => { textMode = !textMode; renderBasket(); });
  $('bkChunk').addEventListener('click', () => { if (sel.size) exportChunks(S.chunkSize); });

  $('bkRemoveShown').addEventListener('click', () => {
    const rows = basketRows();
    if (!rows.length) return;
    if (rows.length === sel.size && !search && !dupOnly) {
      clearSelection();
      renderBasket();
      return;
    }
    rows.forEach((r) => removeFile(r.v.linkcode));
    changed();
    renderBasket();
    toast('Removed ' + rows.length + ' files from the basket');
  });
}

/** Used by the copy fallback when the clipboard is blocked. */
export function forceTextMode() {
  textMode = true;
  renderBasket();
}
