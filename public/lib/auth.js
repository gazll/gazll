/* Google sign-in via Google Identity Services.

   GIS hands back an ID token in-page (no redirect), which then rides along
   with every Apps Script request for the backend to verify.

   The token lives one hour and GIS does not refresh it. We schedule a silent
   renewal before expiry; if that cannot happen quietly the sign-in button
   comes back. Nothing is lost either way — the store keeps writing to
   localStorage and holds its queue until a token exists again. */
import { GOOGLE_CLIENT_ID, SCRIPT_URL } from '../config.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client?hl=en';
const SESSION_KEY = 'gazl.session';
const SKEW_MS = 90_000;   // expire early so an in-flight request cannot die mid-way

const listeners = new Set();
function emit() { for (const fn of listeners) { try { fn(Auth); } catch (e) { console.warn(e); } } }

let gisReady = null;
let renewTimer = null;

export const Auth = {
  /** { sub, email, name, picture, role, token, exp } or null. */
  session: null,
  /** Set once the stored session has been checked, to avoid a UI flash. */
  ready: false,
  error: null,

  get enabled() { return Boolean(GOOGLE_CLIENT_ID && SCRIPT_URL); },
  get user() { return this.session; },
  get isAdmin() { return this.session?.role === 'admin'; },
  get displayName() { return this.session?.name || this.session?.email || 'You'; },
  get avatar() { return this.session?.picture || ''; },

  /** A usable token, or null. Checked before every request. */
  get token() {
    const s = this.session;
    if (!s) return null;
    return Date.now() < s.exp - SKEW_MS ? s.token : null;
  },

  /** Signed in but the token lapsed — needs a fresh one. */
  get expired() { return Boolean(this.session) && !this.token; },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async init() {
    if (!this.enabled) { this.ready = true; emit(); return; }

    this.session = readSession();
    this.ready = true;
    emit();

    try {
      await loadGis();
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: onCredential,
        auto_select: true,             // returning users get signed back in silently
        cancel_on_tap_outside: false,
        use_fedcm_for_prompt: true
      });
      if (!this.token) google.accounts.id.prompt();
      scheduleRenew();
    } catch (e) {
      this.error = e.message || String(e);
      console.warn('[gazl] GIS failed:', e);
      emit();
    }
  },

  signIn() {
    if (!this.enabled) return;
    try { google.accounts.id.prompt(); } catch (e) { console.warn(e); }
  },

  signOut() {
    clearTimeout(renewTimer);
    this.session = null;
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    // Without this, auto_select signs straight back in.
    try { google.accounts.id.disableAutoSelect(); } catch (e) {}
    emit();
  },

  /** Role comes from the backend's `pull` response, not from the token. */
  applyProfile(profile) {
    if (!this.session || !profile) return;
    this.session.role = profile.role || 'user';
    if (profile.name) this.session.name = profile.name;
    if (profile.picture) this.session.picture = profile.picture;
    writeSession(this.session);
    emit();
  }
};

/* ---------- token lifecycle ---------- */

function onCredential(response) {
  const token = response?.credential;
  if (!token) return;
  const claims = decodeJwt(token);
  if (!claims) return;

  const keepRole = Auth.session?.role;    // avoid the ADMIN badge blinking off
  Auth.session = {
    sub: claims.sub,
    email: claims.email || '',
    name: claims.name || '',
    picture: claims.picture || '',
    role: keepRole || 'user',
    token,
    exp: Number(claims.exp) * 1000
  };
  writeSession(Auth.session);
  scheduleRenew();
  emit();
}

function scheduleRenew() {
  clearTimeout(renewTimer);
  if (!Auth.session) return;
  const wait = Auth.session.exp - SKEW_MS - Date.now();
  renewTimer = setTimeout(() => {
    try { google.accounts.id.prompt(); } catch (e) {}
    emit();   // token just lapsed; UI switches to the re-auth state
  }, Math.max(5_000, wait));
}

function readSession() {
  try {
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    return s && s.token && s.sub ? s : null;
  } catch (e) { return null; }
}
function writeSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {}
}

/**
 * Reads the payload for display only — this is NOT verification. The
 * signature is checked in Apps Script, so a forged token here only breaks
 * the forger's own UI.
 */
function decodeJwt(token) {
  try {
    const part = String(token).split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
    // Via TextDecoder so accented names survive.
    const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (e) {
    console.warn('[gazl] unreadable JWT:', e);
    return null;
  }
}

function loadGis() {
  if (gisReady) return gisReady;
  gisReady = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load Google Identity Services.'));
    document.head.appendChild(s);
  });
  return gisReady;
}

/* ---------- header chip ---------- */

export function mountAuthUI(el) {
  if (!el) return;
  const render = () => {
    el.innerHTML = chipHtml();
    const holder = el.querySelector('#gisBtn');
    if (holder) renderSignInButton(holder);
    const out = el.querySelector('#btnSignOut');
    if (out) out.addEventListener('click', () => Auth.signOut());
  };
  render();
  Auth.onChange(render);
}

function chipHtml() {
  if (!Auth.enabled) {
    return '<span class="authchip offline" title="Backend is not configured. Progress is saved on this device only. See README to enable sync.">'
      + '<span class="dot"></span>Offline</span>';
  }
  if (Auth.error) {
    return '<span class="authchip error" title="' + esc(Auth.error) + '"><span class="dot"></span>Sign-in error</span>';
  }
  if (!Auth.ready) return '<span class="authchip loading">…</span>';

  if (!Auth.session) return '<div class="gis-holder" id="gisBtn"></div>';

  const av = Auth.avatar
    ? '<img class="avatar" src="' + esc(Auth.avatar) + '" alt="" referrerpolicy="no-referrer">'
    : '<span class="avatar avatar-fallback">' + esc(Auth.displayName.slice(0, 1).toUpperCase()) + '</span>';

  // Keep the identity visible while expired, so it reads as "re-auth", not "signed out".
  if (Auth.expired) {
    return '<div class="authchip stale">' + av
      + '<div class="gis-holder" id="gisBtn" title="Your session expired. Sign in again to continue syncing."></div>'
      + '<button class="btn-signout" id="btnSignOut" title="Sign out" aria-label="Sign out">⏻</button></div>';
  }

  return '<div class="authchip signed">' + av
    + '<span class="authname" title="' + esc(Auth.session.email) + '">' + esc(shortName(Auth.displayName)) + '</span>'
    + (Auth.isAdmin ? '<span class="rolebadge">ADMIN</span>' : '')
    + '<button class="btn-signout" id="btnSignOut" title="Sign out" aria-label="Sign out">⏻</button>'
    + '</div>';
}

/** Google's own button: more reliable than One Tap, which FedCM can suppress. */
function renderSignInButton(holder) {
  loadGis().then(() => {
    try {
      google.accounts.id.renderButton(holder, {
        type: 'standard', theme: 'outline', size: 'medium',
        shape: 'pill', text: 'signin_with', logo_alignment: 'center',
        locale: 'en'
      });
    } catch (e) {
      holder.innerHTML = '<button class="btn-ghost">Sign in</button>';
      holder.querySelector('button').addEventListener('click', () => Auth.signIn());
    }
  }).catch(() => { holder.textContent = ''; });
}

function shortName(n) {
  const first = String(n).split(/\s+/)[0];
  return first.length > 14 ? first.slice(0, 13) + '…' : first;
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
