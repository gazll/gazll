/* Optional Google sync.

   Without signing in the tool behaves exactly as before and everything lives
   in localStorage. Signing in mirrors history and settings into the project's
   existing Sheet through the same Apps Script backend.

   The ID token is a credential. It stays in this module's scope only: never
   written to localStorage/sessionStorage, never placed in a URL or header,
   never logged. text/plain keeps the request CORS-simple, because Apps Script
   cannot answer a preflight OPTIONS — which is also why the token goes in the
   body rather than an Authorization header. */

import { S, $, PER_PAGE_OPTS } from './state.js';
import { toast } from './util.js';
import { history_, mergeHistory, saveSetting } from './store.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client?hl=en';

export const Sync = {
  ready: false, enabled: false, on: false,
  clientId: '', scriptUrl: '', email: '',
  token: null,          // MEMORY ONLY
  busy: false
};

/** Set by app.js so a pull can re-apply settings to the live UI. */
let applyConfig = () => {};
export function setConfigApplier(fn) { applyConfig = fn; }

export function syncInit() {
  // config.js is generated at deploy time and gitignored locally, so a missing
  // file simply means "sync unavailable" rather than an error.
  import('../../config.js').then((cfg) => {
    Sync.clientId = cfg.GOOGLE_CLIENT_ID || '';
    Sync.scriptUrl = cfg.SCRIPT_URL || '';
    Sync.enabled = Boolean(Sync.clientId && Sync.scriptUrl);
    Sync.ready = true;
    renderSyncBtn();
  }).catch(() => {
    Sync.ready = true;
    Sync.enabled = false;
    renderSyncBtn();
  });
}

function loadGis() {
  return new Promise((resolve, reject) => {
    if (window.google && google.accounts && google.accounts.id) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
}

/** Display claims only; the backend re-verifies the token itself. */
function peekClaims(tok) {
  try {
    const p = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent(escape(atob(p))));
  } catch (e) { return null; }
}

export function syncSignIn() {
  if (!Sync.enabled) { toast('Sync is not configured on this build', true); return; }
  loadGis().then(() => {
    google.accounts.id.initialize({
      client_id: Sync.clientId,
      callback: onCredential,
      auto_select: true,
      cancel_on_tap_outside: false,
      use_fedcm_for_prompt: true
    });
    google.accounts.id.prompt();
  }).catch((e) => toast(e.message, true));
}

export function syncSignOut() {
  Sync.token = null;
  Sync.on = false;
  Sync.email = '';
  try { google.accounts.id.disableAutoSelect(); } catch (e) { /* not loaded */ }
  renderSyncBtn();
  toast('Signed out — data is still saved locally');
}

function onCredential(resp) {
  const tok = resp && resp.credential;
  if (!tok) return;
  const claims = peekClaims(tok);
  Sync.token = tok;
  Sync.on = true;
  Sync.email = (claims && claims.email) || '';
  renderSyncBtn();
  syncPull();
}

function syncCall(action, payload) {
  if (!Sync.token) return Promise.reject(new Error('Not signed in'));
  return fetch(Sync.scriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, payload: payload || {}, idToken: Sync.token }),
    cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'follow'
  }).then((res) => res.text()).then((txt) => {
    let body;
    try { body = JSON.parse(txt); }
    catch (e) { throw new Error('Backend did not return JSON'); }
    if (!body.ok) throw new Error(body.error || 'Backend reported an error');
    return body.data;
  });
}

export function currentConfig() {
  return {
    perPage: String(S.perPage),
    chunk: String(S.chunkSize),
    view: S.viewMode,
    sort: S.sortValue
  };
}

function applyRemoteConfig(cfg) {
  if (!cfg) return;
  if (cfg.perPage !== undefined) {
    const v = Number(cfg.perPage);
    if (PER_PAGE_OPTS.indexOf(v) !== -1) { S.perPage = v; saveSetting('perpage', v); }
  }
  if (cfg.chunk !== undefined) {
    const c = Number(cfg.chunk);
    if (c >= 1 && c <= 10000) { S.chunkSize = c; saveSetting('chunk', c); }
  }
  if (cfg.view === 'tree' || cfg.view === 'table') S.viewMode = cfg.view;
  if (cfg.sort) { S.sortValue = cfg.sort; saveSetting('sort', cfg.sort); }
  applyConfig();
}

export function syncPull() {
  if (!Sync.on || Sync.busy) return Promise.resolve();
  Sync.busy = true;
  renderSyncBtn();
  return syncCall('fshare.pull', { app: 'fshare' }).then((d) => {
    mergeHistory(d && d.history);
    applyRemoteConfig(d && d.config);
    Sync.busy = false;
    renderSyncBtn();
    return syncPush(true);              // write the merged result straight back
  }).catch((e) => {
    Sync.busy = false;
    renderSyncBtn();
    toast('Sync failed: ' + e.message, true);
  });
}

let pushTimer = null;

export function syncPush(now) {
  if (!Sync.on) return Promise.resolve();
  clearTimeout(pushTimer);
  if (!now) {
    pushTimer = setTimeout(() => syncPush(true), 2500);
    return Promise.resolve();
  }
  return syncCall('fshare.push', {
    app: 'fshare',
    history: history_.map((h) => ({
      lc: h.lc, name: h.name || '', hits: h.hits || 1,
      at: new Date(h.at || Date.now()).toISOString()
    })),
    config: currentConfig()
  }).then(renderSyncBtn).catch((e) => toast('Sync failed: ' + e.message, true));
}

export function renderSyncBtn() {
  const b = $('syncBtn');
  if (!b) return;
  if (!Sync.ready) { b.textContent = '…'; b.title = ''; return; }
  if (!Sync.enabled) { b.style.display = 'none'; return; }
  b.style.display = '';
  if (Sync.busy) { b.textContent = '⏳ Syncing'; return; }
  b.textContent = Sync.on ? '✅ ' + (Sync.email || 'Synced') : '☁️ Sign in to sync';
  b.title = Sync.on ? 'Click to sign out — data stays saved locally'
                    : 'Optional: mirror history and settings into Google Sheets';
}
