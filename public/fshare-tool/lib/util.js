/* Formatting, escaping, clipboard and download helpers. No app state here. */

import { $ } from './state.js';

export function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function fmtSize(b) {
  if (!b) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < 4) { b /= 1024; i++; }
  return b.toFixed(i ? 1 : 0) + ' ' + u[i];
}

export function fmtDate(s) {
  if (!s) return '-';
  const n = Number(s);
  const d = (!isNaN(n) && n > 1e9) ? new Date(n * 1000) : new Date(s);
  if (isNaN(d.getTime())) return String(s);
  const p = (x) => ('0' + x).slice(-2);
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ' ' +
         p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

export function fmtAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 2592000) return Math.floor(s / 86400) + ' d ago';
  return fmtDate(Math.floor(ts / 1000));
}

/** Item type 0 is a folder; the other two keys are older API shapes. */
export function isFolder(it) {
  return it.type === 0 || it.type === '0' || it.mimetype === 'folder' || it.ftype === 'folder';
}

export const fileUrl = (lc) => 'https://www.fshare.vn/file/' + lc;
export const folderUrl = (lc) => 'https://www.fshare.vn/folder/' + lc;

/** Folder a file lives in, taken from the last segment of its API path. */
export function folderOf(path) {
  if (!path) return '';
  const parts = String(path).split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

export function extOf(name) {
  const m = String(name || '').match(/\.([A-Za-z0-9]{1,5})$/);
  return m ? m[1].toLowerCase() : '';
}

/* ---------- clipboard ---------- */

/** The Clipboard API needs a secure context; fall back to execCommand. */
export function copyText(txt) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(txt).catch(() => legacyCopy(txt));
  }
  return legacyCopy(txt);
}

function legacyCopy(txt) {
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = txt;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    ok ? resolve() : reject(new Error('clipboard blocked'));
  });
}

export function downloadTxt(text, filename) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- toast ---------- */

let toastTimer = null;

export function toast(msg, bad) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('bad', !!bad);
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

/** Placeholder rows that match the real row height, so nothing jumps on load. */
export function skeletonRows(n) {
  let html = '';
  for (let i = 0; i < n; i++) {
    html += '<div class="skel"><i class="s1"></i><i class="s2"></i><i class="s3"></i><i class="s4"></i></div>';
  }
  return html;
}

export function debounce(fn, ms) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(null, args), ms);
  };
}
