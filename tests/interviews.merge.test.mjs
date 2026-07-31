/* Merge of the two interview-journal sources.

   The seed (interviews.json, in the repo) and the reader's own Sheet rows are
   shown as one list. These tests pin the rules that keeps them apart: own rows
   first, seed entries the reader already imported drop out, `own` marks which
   rows may be written, and a backend failure still leaves the seed visible.

   config.js is gitignored, so it is written to a temp dir and the modules are
   imported from there — that is the only reason for the copy step below. */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT_URL = 'https://script.example.test/exec';
const PUBLIC = new URL('../public/', import.meta.url).pathname;

let dir, Interviews, Auth;

const SEED = {
  companies: [
    { name: 'Rakuten', role: 'Senior Backend Engineer', date: '2026-07', result: 'pending',
      stack: ['Java'], questions: [{ round: 'Vòng 1 · Coding', q: 'LC 30', a: 'sliding window', note: 'n' }] },
    { name: 'Công ty mẫu', role: 'SBE', date: '2026-06', result: 'pending', stack: [], questions: [] }
  ]
};

/** Serves interviews.json locally and fakes the Apps Script endpoint. */
function stubFetch({ remote = [], fail = false } = {}) {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('interviews.json')) {
      return { ok: true, json: async () => SEED };
    }
    if (u === SCRIPT_URL) {
      calls.push(JSON.parse(opts.body));
      if (fail) throw new Error('backend down');
      const { action, payload } = JSON.parse(opts.body);
      if (action === 'interviews.list') {
        return { ok: true, text: async () => JSON.stringify({ ok: true, data: { companies: remote } }) };
      }
      if (action === 'interviews.save') {
        const id = 'uuid-' + (remote.length + 1);
        remote.push({ id, ...payload.company });
        return { ok: true, text: async () => JSON.stringify({ ok: true, data: { id } }) };
      }
    }
    throw new Error('unexpected fetch: ' + u);
  };
  return calls;
}

const signIn = () => { Auth.session = { sub: 'u1', token: 't', exp: Date.now() + 3600e3 }; };
const signOut = () => { Auth.session = null; };

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'iv-'));
  cpSync(PUBLIC + 'lib', join(dir, 'lib'), { recursive: true });
  writeFileSync(join(dir, 'config.js'),
    `export const GOOGLE_CLIENT_ID = 'cid';\nexport const SCRIPT_URL = '${SCRIPT_URL}';\n`);
  ({ Interviews } = await import(join(dir, 'lib/interviews.js')));
  ({ Auth } = await import(join(dir, 'lib/auth.js')));
});

after(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => { signOut(); Interviews.companies = []; Interviews.error = null; });

test('signed out shows the seed, read-only', async () => {
  stubFetch();
  await Interviews.load();
  assert.equal(Interviews.source, 'seed');
  assert.equal(Interviews.editable, false);
  assert.deepEqual(Interviews.companies.map(c => c.name), ['Rakuten', 'Công ty mẫu']);
  assert.ok(Interviews.companies.every(c => c.own === false));
});

test('signed in shows own rows first, then the seed', async () => {
  stubFetch({ remote: [{ id: 'uuid-1', name: 'Grab', questions: [] }] });
  signIn();
  await Interviews.load();

  assert.equal(Interviews.source, 'remote');
  assert.equal(Interviews.editable, true);
  assert.deepEqual(Interviews.companies.map(c => c.name), ['Grab', 'Rakuten', 'Công ty mẫu']);
  assert.deepEqual(Interviews.companies.map(c => c.own), [true, false, false]);
  assert.equal(Interviews.ownCompanies.length, 1);
  assert.equal(Interviews.seedCompanies.length, 2);
});

test('a seed entry already imported is not shown twice', async () => {
  stubFetch({ remote: [{ id: 'uuid-1', name: '  rakuten ', questions: [] }] });   // case + spacing differ
  signIn();
  await Interviews.load();

  const names = Interviews.companies.map(c => c.name.trim().toLowerCase());
  assert.equal(names.filter(n => n === 'rakuten').length, 1, 'Rakuten must appear once');
  assert.equal(Interviews.companies.find(c => c.name.trim().toLowerCase() === 'rakuten').own, true);
});

test('importSeed copies the seed row into the Sheet and the seed card drops out', async () => {
  stubFetch({ remote: [] });
  signIn();
  await Interviews.load();

  const seedRakuten = Interviews.companies.find(c => c.name === 'Rakuten');
  assert.equal(seedRakuten.own, false);
  assert.equal(seedRakuten.id, 'seed-0');

  await Interviews.importSeed(seedRakuten.id);

  const after = Interviews.companies.filter(c => c.name === 'Rakuten');
  assert.equal(after.length, 1, 'no duplicate after import');
  assert.equal(after[0].own, true, 'the surviving Rakuten is the own row');
  assert.equal(after[0].questions.length, 1, 'questions came across');
});

test('importSeed does not send the seed id, so the backend creates a new row', async () => {
  const calls = stubFetch({ remote: [] });
  signIn();
  await Interviews.load();
  await Interviews.importSeed('seed-0');

  const save = calls.find(c => c.action === 'interviews.save');
  assert.equal(save.payload.company.id, undefined, 'seed-0 must not travel to the backend');
  assert.ok(save.payload.company.questions.every(q => q.id === undefined));
});

test('importSeed refuses a row that is already the reader\'s own', async () => {
  stubFetch({ remote: [{ id: 'uuid-1', name: 'Grab', questions: [] }] });
  signIn();
  await Interviews.load();
  await assert.rejects(() => Interviews.importSeed('uuid-1'), /đã nằm trong nhật ký/);
});

test('a backend failure still leaves the seed visible', async () => {
  stubFetch({ fail: true });
  signIn();
  await Interviews.load();

  assert.equal(Interviews.source, 'seed');
  assert.equal(Interviews.editable, false);
  assert.deepEqual(Interviews.companies.map(c => c.name), ['Rakuten', 'Công ty mẫu']);
  assert.ok(Interviews.error, 'the error is surfaced to the view');
});

test('seed ids cannot collide with Sheet uuids', async () => {
  stubFetch({ remote: [{ id: 'uuid-1', name: 'Grab', questions: [] }] });
  signIn();
  await Interviews.load();
  const ids = Interviews.companies.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, 'ids stay unique across both sources');
  assert.ok(Interviews.seedCompanies.every(c => c.id.startsWith('seed-')));
});
