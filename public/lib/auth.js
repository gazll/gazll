/* Google sign-in via Google Identity Services.

   GIS hands back an ID token in-page (no redirect), which then rides along
   with every Apps Script request for the backend to verify.

   The token lives one hour and GIS does not refresh it. We schedule a silent
   renewal before expiry; if that cannot happen quietly the sign-in button
   comes back. The credential exists in JavaScript memory only — never in
   localStorage/sessionStorage — while study data keeps its own offline queue.

   What IS persisted is the profile *hint*: display name, email and avatar URL.
   That is not a credential — it cannot authenticate anything, and the backend
   ignores it entirely (user_id always comes from the verified token's `sub`).
   It exists so a returning reader sees their own avatar on first paint instead
   of a signed-out header, while `auto_select` fetches a real token in the
   background. Never put `token` in here.

   Silent sign-in fails routinely — FedCM suppresses the prompt, third-party
   cookies are blocked, no Google session in this profile. So every attempt is
   BOUNDED: unbounded, the header spun forever and never offered a way in.
   Ending empty means `stale`, which asks for a click. */
import { GOOGLE_CLIENT_ID, SCRIPT_URL } from '../config.js';

const GIS_SRC = 'https://accounts.google.com/gsi/client?hl=en';
const LEGACY_SESSION_KEY = 'gazl.session';
const HINT_KEY = 'gazl.profile';
const SKEW_MS = 90_000;      // expire early so an in-flight request cannot die mid-way
const SILENT_MS = 8_000;     // hard ceiling on one silent attempt
const RETRY_COOLDOWN = 60_000; // do not re-prompt on every tab focus

const listeners = new Set();
function emit() { for (const fn of listeners) { try { fn(Auth); } catch (e) {} } }

let gisReady = null;
let renewTimer = null;
let silentTimer = null;
let silentPending = false;
let lastSilentAt = 0;
let wiredWake = false;

export const Auth = {
  /** { sub, email, name, picture, role, token, exp } or null. */
  session: null,
  /** { sub, email, name, picture } from localStorage — display only, no token. */
  hint: null,
  /** Set once startup has discarded any legacy persisted credential. */
  ready: false,
  error: null,

  get enabled() { return Boolean(GOOGLE_CLIENT_ID && SCRIPT_URL); },
  get user() { return this.session; },
  get isAdmin() { return this.session?.role === 'admin'; },

  /** Whoever we can show in the header: a live session, else the stored hint. */
  get identity() { return this.session || this.hint; },
  get displayName() { return this.identity?.name || this.identity?.email || 'You'; },
  get avatar() { return this.identity?.picture || ''; },
  get email() { return this.identity?.email || ''; },

  /** Known face, no usable token, and a silent attempt is genuinely running. */
  get connecting() { return Boolean(this.hint) && !this.token && silentPending; },

  /** A usable token, or null. Checked before every request. */
  get token() {
    const s = this.session;
    if (!s) return null;
    return Date.now() < s.exp - SKEW_MS ? s.token : null;
  },

  /** Signed in but the token lapsed — needs a fresh one. */
  get expired() { return Boolean(this.session) && !this.token; },

  /** The one value the UI switches on. */
  get state() {
    if (!this.enabled) return 'offline';
    if (!this.ready) return 'loading';
    if (this.session && this.token) return 'signed';
    if (this.error) return 'error';
    if (this.connecting) return 'connecting';
    if (this.identity) return 'stale';
    return 'anon';
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async init() {
    // Versions before July 2026 persisted the full ID token. Remove that
    // credential before rendering anything, even when sync is disabled.
    clearLegacySession();
    this.session = null;
    if (!this.enabled) { this.ready = true; emit(); return; }

    // Marked as attempting before GIS loads, so a returning reader sees their
    // own face instead of a flash of "signed out".
    this.hint = readHint();
    this.ready = true;
    if (this.hint) beginSilent();
    emit();

    try {
      await loadGis();
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: onCredential,
        auto_select: true,             // returning users get signed back in silently
        cancel_on_tap_outside: true,   // false traps clicks under FedCM's native prompt
        use_fedcm_for_prompt: true
      });
      if (!this.token) promptSilently();
      scheduleRenew();
      wakeOnFocus();
    } catch (e) {
      this.error = 'Could not load Google sign-in.';
      endSilent();
      emit();
    }
  },

  /** Explicit, user-initiated. Unlike the silent path this may show UI. */
  signIn() {
    if (!this.enabled) return;
    this.error = null;
    try {
      beginSilent();
      google.accounts.id.prompt(handlePromptMoment);
      emit();
    } catch (e) {
      endSilent();
      this.error = 'Could not open Google sign-in.';
      emit();
    }
  },

  signOut() {
    clearTimeout(renewTimer);
    endSilent();
    this.session = null;
    this.hint = null;
    this.error = null;
    clearLegacySession();
    clearHint();
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
    writeHint(this.session);
    emit();
  }
};

/* ---------- silent sign-in, always bounded ---------- */

function beginSilent() {
  silentPending = true;
  lastSilentAt = Date.now();
  clearTimeout(silentTimer);
  silentTimer = setTimeout(() => { if (silentPending) { endSilent(); emit(); } }, SILENT_MS);
}

function endSilent() {
  silentPending = false;
  clearTimeout(silentTimer);
}

function promptSilently() {
  beginSilent();
  try { google.accounts.id.prompt(handlePromptMoment); }
  catch (e) { endSilent(); emit(); }
}

/** Under FedCM these predicates are deprecated and some throw, so probe each
    one; if none answers, SILENT_MS still ends the attempt. */
function handlePromptMoment(notification) {
  if (!notification || !silentPending) return;
  const says = name => {
    try { return typeof notification[name] === 'function' && notification[name](); }
    catch (e) { return false; }
  };
  if (says('isNotDisplayed') || says('isSkippedMoment') || says('isDismissedMoment')) {
    endSilent();
    emit();
  }
}

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
  Auth.hint = writeHint(Auth.session);
  Auth.error = null;
  endSilent();
  scheduleRenew();
  emit();
}

function scheduleRenew() {
  clearTimeout(renewTimer);
  if (!Auth.session) return;
  const wait = Auth.session.exp - SKEW_MS - Date.now();
  renewTimer = setTimeout(() => {
    promptSilently();
    emit();   // token just lapsed; UI switches to the re-auth state
  }, Math.max(5_000, wait));
}

/** Coming back to the tab is when Google is most likely to have a session
    again. Rate-limited so tab-flicking cannot become a prompt loop. */
function wakeOnFocus() {
  if (wiredWake) return;
  if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return;
  wiredWake = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (Auth.token || silentPending || !Auth.identity) return;
    if (Date.now() - lastSilentAt < RETRY_COOLDOWN) return;
    promptSilently();
    emit();
  });
}

function clearLegacySession() {
  try { localStorage.removeItem(LEGACY_SESSION_KEY); } catch (e) {}
}

/* ---------- profile hint (display only — never the token) ---------- */

function writeHint(s) {
  const hint = { sub: s.sub, email: s.email || '', name: s.name || '', picture: s.picture || '' };
  try { localStorage.setItem(HINT_KEY, JSON.stringify(hint)); } catch (e) {}
  return hint;
}

function readHint() {
  try {
    const raw = localStorage.getItem(HINT_KEY);
    if (!raw) return null;
    const h = JSON.parse(raw);
    if (!h || typeof h !== 'object' || !h.sub) return null;
    // A stored `token`/`exp` would mean an older or tampered entry. Drop it:
    // this object must never be able to authenticate anything.
    return { sub: String(h.sub), email: String(h.email || ''), name: String(h.name || ''), picture: String(h.picture || '') };
  } catch (e) { return null; }
}

function clearHint() {
  try { localStorage.removeItem(HINT_KEY); } catch (e) {}
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
  } catch (e) { return null; }
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

/* ---------- header avatar + account menu ----------

   States needing a click carry a text label: an avatar alone is too quiet to
   read as "signed out". The popover hosts Google's own rendered button,
   because FedCM can suppress One Tap without telling the user anything. */

export function mountAuthUI(el) {
  if (!el) return;
  let open = false;

  const render = () => {
    el.innerHTML = avatarHtml() + (open ? menuHtml() : '');
    el.classList.toggle('open', open);

    const holder = el.querySelector('#gisBtn');
    if (holder) renderSignInButton(holder);
    el.querySelector('#btnSignOut')?.addEventListener('click', () => { open = false; Auth.signOut(); });
    el.querySelector('#btnRetry')?.addEventListener('click', () => Auth.signIn());
  };

  const setOpen = v => { if (open !== v) { open = v; render(); } };

  el.addEventListener('click', e => {
    if (e.target.closest('#authBtn')) { e.stopPropagation(); setOpen(!open); }
  });
  document.addEventListener('click', e => { if (open && !el.contains(e.target)) setOpen(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setOpen(false); });

  render();
  Auth.onChange(render);
}

function avatarFace() {
  if (Auth.avatar) {
    return '<img class="avatar" src="' + esc(Auth.avatar) + '" alt="" referrerpolicy="no-referrer">';
  }
  if (Auth.identity) {
    return '<span class="avatar avatar-fallback">' + esc(Auth.displayName.slice(0, 1).toUpperCase()) + '</span>';
  }
  // Signed out: a neutral face, still a button.
  return '<span class="avatar avatar-anon" aria-hidden="true">'
    + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">'
    + '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.5 20c1.4-3.9 4.1-5.8 7.5-5.8s6.1 1.9 7.5 5.8"/></svg></span>';
}

const STATE_LABEL = {
  offline: 'Offline mode — backend not configured',
  loading: 'Loading…',
  error: 'Sign-in failed — click to retry',
  signed: () => 'Account: ' + Auth.displayName,
  connecting: 'Reconnecting…',
  stale: 'Session ended — click to sign in',
  anon: 'Sign in with Google'
};

const STATE_CHIP = { anon: 'Sign in', stale: 'Sign in', error: 'Retry' };

function avatarHtml() {
  const state = Auth.state;
  const raw = STATE_LABEL[state] || STATE_LABEL.anon;
  const label = typeof raw === 'function' ? raw() : raw;
  const chip = STATE_CHIP[state];

  return '<button class="authbtn" id="authBtn" data-state="' + state + '"'
    + ' aria-haspopup="dialog" title="' + esc(label) + '" aria-label="' + esc(label) + '">'
    + avatarFace()
    + (chip ? '<span class="auth-chip">' + chip + '</span>' : '')
    + (Auth.isAdmin && state === 'signed' ? '<span class="av-admin" title="Admin">★</span>' : '')
    + '</button>';
}

function menuHtml() {
  const state = Auth.state;
  let body;

  if (state === 'offline') {
    body = '<p class="am-note">No backend is configured, so progress is kept on this device only. '
      + 'See the README to turn on Google Sheet sync.</p>';
  } else if (state === 'signed') {
    body = '<div class="am-id">'
      + '<div class="am-name">' + esc(Auth.displayName) + (Auth.isAdmin ? '<span class="rolebadge">ADMIN</span>' : '') + '</div>'
      + (Auth.email ? '<div class="am-mail">' + esc(Auth.email) + '</div>' : '')
      + '</div>'
      + '<p class="am-note ok">Progress, notes and the interview journal are syncing to your Google Sheet.</p>'
      + '<button class="am-action danger" id="btnSignOut">Sign out</button>';
  } else if (state === 'connecting') {
    body = '<div class="am-id">'
      + '<div class="am-name">' + esc(Auth.displayName) + '</div>'
      + (Auth.email ? '<div class="am-mail">' + esc(Auth.email) + '</div>' : '')
      + '</div>'
      + '<p class="am-note">Trying to sign you back in without asking. This takes a moment — '
      + 'if nothing happens, a sign-in button will appear here.</p>';
  } else if (Auth.identity) {
    body = '<div class="am-id">'
      + '<div class="am-name">' + esc(Auth.displayName) + '</div>'
      + (Auth.email ? '<div class="am-mail">' + esc(Auth.email) + '</div>' : '')
      + '</div>'
      + '<p class="am-note">Your session ended and Google could not renew it silently — that is normal '
      + 'when third-party cookies are blocked. Sign in again to resume syncing; anything waiting is '
      + 'still safe on this device.</p>'
      + '<div class="gis-holder" id="gisBtn"></div>'
      + '<button class="am-action danger" id="btnSignOut">Forget this account</button>';
  } else {
    body = '<p class="am-note">Sign in with Google to keep your progress, notes and interview journal '
      + 'in your own Google Sheet. Everything works signed out too — it just stays on this device.</p>'
      + '<div class="gis-holder" id="gisBtn"></div>';
  }

  return '<div class="authmenu" role="dialog" aria-label="Account">'
    + (Auth.error ? '<p class="am-note err">' + esc(Auth.error) + '</p>' : '')
    + body + '</div>';
}

/** Google's own button: more reliable than One Tap, which FedCM can suppress. */
function renderSignInButton(holder) {
  loadGis().then(() => {
    try {
      google.accounts.id.renderButton(holder, {
        type: 'standard', theme: 'outline', size: 'large',
        shape: 'pill', text: 'signin_with', logo_alignment: 'center',
        locale: 'en', width: 240
      });
    } catch (e) {
      holder.innerHTML = '<button class="am-action" id="btnRetry">Sign in with Google</button>';
      holder.querySelector('button').addEventListener('click', () => Auth.signIn());
    }
  }).catch(() => {
    holder.innerHTML = '<p class="am-note err">Could not load Google sign-in.</p>';
  });
}
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
