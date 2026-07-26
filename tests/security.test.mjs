import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    api: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    }
  };
}

function jwt(payload) {
  const encoded = Buffer.from(JSON.stringify(payload))
    .toString('base64url');
  return `header.${encoded}.signature`;
}

async function loadAuth({ storedSession } = {}) {
  const source = await readFile(path.join(root, 'public/lib/auth.js'), 'utf8');
  const storage = memoryStorage(storedSession
    ? { 'gazl.session': JSON.stringify(storedSession) }
    : {});
  const consoleCalls = [];
  let credentialCallback = null;

  const google = {
    accounts: {
      id: {
        initialize(options) { credentialCallback = options.callback; },
        prompt() {},
        disableAutoSelect() {},
        renderButton() {}
      }
    }
  };

  const context = vm.createContext({
    atob: globalThis.atob,
    clearTimeout() {},
    console: {
      error(...args) { consoleCalls.push(['error', ...args]); },
      log(...args) { consoleCalls.push(['log', ...args]); },
      warn(...args) { consoleCalls.push(['warn', ...args]); }
    },
    document: {},
    google,
    localStorage: storage.api,
    setTimeout() { return 1; },
    TextDecoder,
    Uint8Array,
    window: { google }
  });

  const config = new vm.SourceTextModule(
    'export const GOOGLE_CLIENT_ID = "browser-client"; export const SCRIPT_URL = "https://backend.invalid/exec";',
    { context, identifier: 'config.js' }
  );
  await config.link(() => {});
  await config.evaluate();

  const auth = new vm.SourceTextModule(source, {
    context,
    identifier: path.join(root, 'public/lib/auth.js')
  });
  await auth.link(specifier => {
    assert.equal(specifier, '../config.js');
    return config;
  });
  await auth.evaluate();

  return {
    Auth: auth.namespace.Auth,
    consoleCalls,
    credential(response) {
      assert.ok(credentialCallback, 'GIS credential callback was registered');
      credentialCallback(response);
    },
    storage: storage.values
  };
}

async function loadBackend() {
  const source = await readFile(path.join(root, 'apps-script/Code.gs'), 'utf8');
  const context = vm.createContext({
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput(text) {
        return {
          text,
          setMimeType() { return this; }
        };
      }
    }
  });
  new vm.Script(source, { filename: 'apps-script/Code.gs' }).runInContext(context);
  return context;
}

async function loadApi() {
  const source = await readFile(path.join(root, 'public/lib/api.js'), 'utf8');
  const requests = [];
  const context = vm.createContext({
    fetch: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true, data: { accepted: true } });
        }
      };
    }
  });

  const config = new vm.SourceTextModule(
    'export const SCRIPT_URL = "https://backend.invalid/exec";',
    { context, identifier: 'config.js' }
  );
  await config.link(() => {});
  await config.evaluate();

  const api = new vm.SourceTextModule(source, {
    context,
    identifier: path.join(root, 'public/lib/api.js')
  });
  await api.link(specifier => {
    assert.equal(specifier, '../config.js');
    return config;
  });
  await api.evaluate();

  return { call: api.namespace.call, requests };
}

function responseBody(output) {
  return JSON.parse(output.text);
}

test('Google ID tokens live in memory only and a legacy stored token is discarded', async () => {
  const oldToken = 'legacy-secret-token';
  const browser = await loadAuth({
    storedSession: {
      sub: 'old-user',
      email: 'old@example.com',
      role: 'admin',
      token: oldToken,
      exp: Date.now() + 3_600_000
    }
  });

  await browser.Auth.init();

  assert.equal(browser.Auth.session, null);
  assert.equal(browser.storage.has('gazl.session'), false);

  const newToken = jwt({
    sub: 'new-user',
    email: 'new@example.com',
    name: 'New User',
    exp: Math.floor(Date.now() / 1000) + 3600
  });
  browser.credential({ credential: newToken });

  assert.equal(browser.Auth.token, newToken);
  assert.equal(browser.storage.has('gazl.session'), false);
});

test('a malformed Google credential never writes diagnostic details to the console', async () => {
  const browser = await loadAuth();
  await browser.Auth.init();

  browser.credential({ credential: 'private-malformed-token' });

  assert.deepEqual(browser.consoleCalls, []);
});

test('the API transport keeps the ID token out of URLs, headers, caches and referrers', async () => {
  const api = await loadApi();
  const token = 'private-id-token';

  await api.call('pull', {}, token);

  assert.equal(api.requests.length, 1);
  const request = api.requests[0];
  assert.doesNotMatch(request.url, /private-id-token/);
  assert.doesNotMatch(JSON.stringify(request.options.headers), /private-id-token/);
  assert.equal(JSON.parse(request.options.body).idToken, token);
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
});

test('an unauthenticated backend request is rejected before any action can run', async () => {
  const backend = await loadBackend();
  let actionRan = false;
  backend.ACTIONS['security.probe'] = function () {
    actionRan = true;
    return {};
  };

  const body = responseBody(backend.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'security.probe',
        payload: {},
        idToken: ''
      })
    }
  }));

  assert.equal(body.ok, false);
  assert.equal(actionRan, false);
});

test('backend responses do not disclose internal exception details', async () => {
  const backend = await loadBackend();
  backend.requireUser = function () {
    return { sub: 'user-a', role: 'user' };
  };
  backend.ACTIONS['security.leak'] = function () {
    throw new Error('private sheet id: secret-sheet-123');
  };

  const body = responseBody(backend.doPost({
    postData: {
      contents: JSON.stringify({
        action: 'security.leak',
        payload: {},
        idToken: 'valid-for-test'
      })
    }
  }));

  assert.equal(body.ok, false);
  assert.equal(body.error, 'Lỗi máy chủ. Vui lòng thử lại sau.');
  assert.doesNotMatch(JSON.stringify(body), /secret-sheet-123/);
});

test('row ownership is isolated by the verified Google subject', async () => {
  const backend = await loadBackend();
  const rows = [
    { user_id: 'user-a', item_id: 'A' },
    { user_id: 'user-b', item_id: 'B' },
    { user_id: 'user-a', item_id: 'C' }
  ];

  const mine = backend.mine(rows, { sub: 'user-b' });

  assert.deepEqual(JSON.parse(JSON.stringify(mine)), [
    { user_id: 'user-b', item_id: 'B' }
  ]);
});

test('a normal user is denied before the admin action reads any sheet', async () => {
  const backend = await loadBackend();

  assert.throws(
    () => backend.ACTIONS['admin.overview']({ sub: 'user-a', role: 'user' }),
    /admin/i
  );
});
