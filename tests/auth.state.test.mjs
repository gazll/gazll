/* The sign-in state machine in lib/auth.js.

   The bug these pin: `connecting` used to mean nothing more than "there is a
   stored profile and no token", so whenever silent sign-in quietly failed —
   FedCM suppressing the prompt, third-party cookies blocked, no Google
   session in this browser — the header span spun forever and never offered a
   way in. A silent attempt must always END: with a token, with a prompt
   notification, or with the timeout. When it ends empty the state is `stale`,
   which is a still badge and a real sign-in button.

   The credential itself is covered in security.test.mjs; this file is only
   about which state the UI is told to render. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function jwt(payload) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

/**
 * Loads auth.js with a controllable clock and a scriptable GIS stub, so a
 * silent attempt can be resolved, rejected or left to time out on demand.
 */
async function loadAuth({ storedProfile } = {}) {
  const source = await readFile(path.join(root, 'public/lib/auth.js'), 'utf8');
  const values = new Map();
  if (storedProfile) values.set('gazl.profile', JSON.stringify(storedProfile));

  const timers = [];
  let promptCallback = null;
  let promptCalls = 0;
  let credentialCallback = null;
  const listeners = {};

  const google = {
    accounts: {
      id: {
        initialize(options) { credentialCallback = options.callback; },
        prompt(cb) { promptCalls++; promptCallback = cb || null; },
        disableAutoSelect() {},
        renderButton() {}
      }
    }
  };

  const document = {
    visibilityState: 'visible',
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    createElement: () => ({ set onload(f) { f(); }, set onerror(_) {} }),
    head: { appendChild() {} }
  };

  // A movable clock, so the retry cooldown can be tested from both sides.
  let skew = 0;
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [RealDate.now() + skew])); }
    static now() { return RealDate.now() + skew; }
  }

  const context = vm.createContext({
    atob: globalThis.atob,
    console: { error() {}, log() {}, warn() {} },
    Date: FakeDate,
    document,
    google,
    localStorage: {
      getItem: k => (values.has(k) ? values.get(k) : null),
      setItem: (k, v) => values.set(k, String(v)),
      removeItem: k => values.delete(k)
    },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cancelled = true; },
    TextDecoder,
    Uint8Array,
    window: { google }
  });

  const config = new vm.SourceTextModule(
    'export const GOOGLE_CLIENT_ID = "cid"; export const SCRIPT_URL = "https://backend.invalid/exec";',
    { context, identifier: 'config.js' }
  );
  await config.link(() => {});
  await config.evaluate();

  const mod = new vm.SourceTextModule(source, { context, identifier: 'auth.js' });
  await mod.link(specifier => {
    assert.equal(specifier, '../config.js');
    return config;
  });
  await mod.evaluate();

  return {
    Auth: mod.namespace.Auth,
    /** Run the longest pending timer — stands in for SILENT_MS elapsing. */
    fireTimers() {
      const live = timers.filter(t => !t.cancelled && !t.done);
      for (const t of live) { t.done = true; t.fn(); }
    },
    tellPrompt(moment) { if (promptCallback) promptCallback(moment); },
    signInWith(claims) { credentialCallback({ credential: jwt(claims) }); },
    fireVisibility(state = 'visible') {
      document.visibilityState = state;
      for (const fn of listeners.visibilitychange || []) fn();
    },
    advance(ms) { skew += ms; },
    get promptCalls() { return promptCalls; }
  };
}

const HINT = { sub: 'u1', email: 'u@example.com', name: 'Returning Reader', picture: '' };
const validClaims = { sub: 'u1', email: 'u@example.com', name: 'Returning Reader',
  exp: Math.floor(Date.now() / 1000) + 3600 };

test('a returning reader starts in connecting, not signed out', async () => {
  const b = await loadAuth({ storedProfile: HINT });
  await b.Auth.init();

  assert.equal(b.Auth.state, 'connecting');
  assert.equal(b.Auth.displayName, 'Returning Reader', 'the known face shows immediately');
  assert.equal(b.Auth.token, null);
});

test('a silent attempt that produces nothing ends as stale, never stuck connecting', async () => {
  const b = await loadAuth({ storedProfile: HINT });
  await b.Auth.init();
  assert.equal(b.Auth.state, 'connecting');

  b.fireTimers();   // SILENT_MS elapses with no credential

  assert.equal(b.Auth.state, 'stale');
  assert.equal(b.Auth.connecting, false, 'the spinner must stop');
  assert.equal(b.Auth.identity.name, 'Returning Reader', 'we still know who they are');
});

test('GIS reporting a dead prompt ends the attempt without waiting for the timeout', async () => {
  const b = await loadAuth({ storedProfile: HINT });
  await b.Auth.init();

  b.tellPrompt({ isNotDisplayed: () => true, isSkippedMoment: () => false });

  assert.equal(b.Auth.state, 'stale');
});

test('a prompt predicate that throws does not wedge the state', async () => {
  // Under FedCM several of these are deprecated and can throw on access.
  const b = await loadAuth({ storedProfile: HINT });
  await b.Auth.init();

  b.tellPrompt({ isNotDisplayed() { throw new Error('deprecated under FedCM'); } });
  assert.equal(b.Auth.state, 'connecting', 'an unusable notification tells us nothing');

  b.fireTimers();
  assert.equal(b.Auth.state, 'stale', 'the timeout is still the backstop');
});

test('a credential arriving resolves connecting into signed', async () => {
  const b = await loadAuth({ storedProfile: HINT });
  await b.Auth.init();

  b.signInWith(validClaims);

  assert.equal(b.Auth.state, 'signed');
  assert.equal(b.Auth.connecting, false);
  assert.ok(b.Auth.token);
});

test('nobody stored means signed out, with no silent attempt at all', async () => {
  const b = await loadAuth();
  await b.Auth.init();

  assert.equal(b.Auth.state, 'anon');
  assert.equal(b.Auth.connecting, false);
});

test('returning to the tab does not re-prompt inside the cooldown', async () => {
  // Silent sign-in that just failed will fail again for the same reason, so
  // flicking between tabs must not turn into a prompt storm.
  const b = await loadAuth({ storedProfile: HINT });
  await b.Auth.init();
  b.fireTimers();
  const after = b.promptCalls;

  b.fireVisibility('visible');
  b.fireVisibility('visible');

  assert.equal(b.promptCalls, after);
  assert.equal(b.Auth.state, 'stale');
});

test('once the cooldown passes, returning to the tab retries exactly once', async () => {
  const b = await loadAuth({ storedProfile: HINT });
  await b.Auth.init();
  b.fireTimers();
  const after = b.promptCalls;

  b.advance(61_000);
  b.fireVisibility('visible');
  assert.equal(b.promptCalls, after + 1, 'one fresh attempt');
  assert.equal(b.Auth.state, 'connecting');

  // The new attempt is already in flight; a second return adds nothing.
  b.fireVisibility('visible');
  assert.equal(b.promptCalls, after + 1);
});

test('a signed-in reader is never re-prompted on tab focus', async () => {
  const b = await loadAuth({ storedProfile: HINT });
  await b.Auth.init();
  b.signInWith(validClaims);
  const after = b.promptCalls;

  b.advance(61_000);
  b.fireVisibility('visible');

  assert.equal(b.promptCalls, after);
  assert.equal(b.Auth.state, 'signed');
});

test('a hidden tab does not trigger a retry', async () => {
  const b = await loadAuth({ storedProfile: HINT });
  await b.Auth.init();
  b.fireTimers();
  const before = b.promptCalls;

  b.fireVisibility('hidden');

  assert.equal(b.promptCalls, before);
});

test('signing out drops the face and leaves nothing spinning', async () => {
  const b = await loadAuth({ storedProfile: HINT });
  await b.Auth.init();
  b.signInWith(validClaims);

  b.Auth.signOut();

  assert.equal(b.Auth.state, 'anon');
  assert.equal(b.Auth.connecting, false);
  assert.equal(b.Auth.identity, null);
});

test('an expired token reads as stale rather than signed', async () => {
  const b = await loadAuth({ storedProfile: HINT });
  await b.Auth.init();
  b.signInWith({ ...validClaims, exp: Math.floor(Date.now() / 1000) - 10 });

  assert.equal(b.Auth.token, null);
  assert.equal(b.Auth.expired, true);
  assert.equal(b.Auth.state, 'stale');
});
