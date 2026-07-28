/* Folder navigation: the nav stack, the address bar, and view switching.

   Views import this for drillInto/navTo. To avoid a cycle it never imports a
   view back — app.js registers the renderers here at boot instead. */

import { S, $ } from './state.js';
import { addHistory } from './store.js';

const renderers = { table: null, tree: null };

export function registerView(name, fn) { renderers[name] = fn; }

export const currentLc = () =>
  S.navStack.length ? S.navStack[S.navStack.length - 1].linkcode : null;

/* ---------- screens ---------- */

export function showHome() {
  $('homeView').style.display = 'block';
  $('folderView').style.display = 'none';
  $('batchView').style.display = 'none';
  document.title = 'Fshare Bulk Copy';
}

export function showFolder() {
  $('homeView').style.display = 'none';
  $('batchView').style.display = 'none';
  $('folderView').style.display = 'block';
}

export function showBatch() {
  $('homeView').style.display = 'none';
  $('folderView').style.display = 'none';
  $('batchView').style.display = 'block';
  document.title = 'Bulk crawl — Fshare Bulk Copy';
}

/* ---------- address bar ---------- */

/* Keep the hash on the folder actually being shown. replaceState fires no
   hashchange, so this never re-enters route(). Without it the hash would stay
   on the folder you first opened, and typing that same code into the nav box
   would assign an unchanged hash — no event, no navigation, nothing happens. */
export function syncHash(lc) {
  if (lc && location.hash !== '#' + lc) history.replaceState(null, '', '#' + lc);
}

/* ---------- navigation ---------- */

export function loadFolder(linkcode, page) {
  S.currentPage = page || 1;
  syncHash(linkcode);
  renderBreadcrumb();
  const fn = renderers[S.viewMode === 'tree' ? 'tree' : 'table'];
  if (fn) fn(linkcode);
}

export function startFolder(lc) {
  S.navStack = [{ linkcode: lc, name: lc }];
  addHistory(lc);                     // the one place every entry path funnels through
  showFolder();
  loadFolder(lc, 1);
}

export function drillInto(lc, name) {
  S.navStack.push({ linkcode: lc, name });
  loadFolder(lc, 1);
}

export function navTo(idx) {
  S.navStack = S.navStack.slice(0, idx + 1);
  loadFolder(currentLc(), 1);
}

export function goHome() {
  location.hash = '';
  showHome();
}

export function renderBreadcrumb() {
  const bc = $('breadcrumb');
  if (!bc) return;
  bc.innerHTML = '';

  const home = document.createElement('span');
  home.className = 'bc-home';
  home.textContent = '🏠 Home';
  home.addEventListener('click', goHome);
  bc.appendChild(home);

  S.navStack.forEach((n, i) => {
    const sep = document.createElement('span');
    sep.className = 'bc-sep';
    sep.textContent = '›';
    bc.appendChild(sep);

    const el = document.createElement('span');
    el.textContent = n.name;
    if (i === S.navStack.length - 1) {
      el.className = 'bc-current';
    } else {
      el.className = 'bc-item';
      el.addEventListener('click', () => navTo(i));
    }
    bc.appendChild(el);
  });
}
