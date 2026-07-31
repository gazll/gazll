/* The VI/EN overlay in lib/content.js.

   content.json is the Vietnamese source of truth and always loads;
   content.en.json is a partial overlay keyed by topic `n` and item id. The
   rules worth pinning are the ones that make a partial file safe: a missing
   field falls back rather than blanking out, applying the overlay never
   mutates the Vietnamese source (or switching back would show English), and
   an absent overlay file degrades instead of throwing. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const pub = path.join(root, 'public');

const SOURCE = JSON.parse(await readFile(path.join(pub, 'content.json'), 'utf8'));
const OVERLAY = JSON.parse(await readFile(path.join(pub, 'content.en.json'), 'utf8'));

/** A fresh Content module with stubbed fetch + localStorage. */
async function load({ overlay = OVERLAY, lang } = {}) {
  const store = new Map();
  if (lang) store.set('gazl.contentLang', lang);
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const fetched = [];
  globalThis.fetch = async (url) => {
    fetched.push(url);
    if (url === 'content.json') return { ok: true, json: async () => structuredClone(SOURCE) };
    if (url === 'content.en.json' && overlay) return { ok: true, json: async () => structuredClone(overlay) };
    return { ok: false, status: 404 };
  };
  // Cache-bust so every test gets its own module instance.
  const url = pathToFileURL(path.join(pub, 'lib/content.js')).href + '?t=' + Math.random();
  const { Content } = await import(url);
  return { Content, fetched, store };
}

const topic = (Content, n) => Content.days.find(d => d.n === n);

beforeEach(() => { delete globalThis.fetch; });

test('English is the default and the overlay replaces topic metadata', async () => {
  const { Content } = await load();
  assert.equal(Content.lang, 'en');
  await Content.load();

  assert.equal(topic(Content, 17).label, 'REST API design');
  assert.equal(topic(Content, 1).sections[0].title, 'Memory & execution model');
  assert.equal(topic(Content, 10).tags[0], '7-step framework');
  assert.match(Content.micro.chapters[8].title, /Central Link/);
});

test('an answer with no translation falls back to Vietnamese and is flagged', async () => {
  const { Content } = await load();
  await Content.load();
  const item = topic(Content, 1).sections[0].items[0];

  assert.match(item.a, /JMM/);
  assert.equal(Content.isFallback(item), true);
  // Falling back must never drop items — the ring denominator depends on it.
  assert.equal(Content.totalDayItems, 282);
});

test('a translated answer is used and stops being flagged', async () => {
  const overlay = structuredClone(OVERLAY);
  overlay.days['1'].items = { '1.1': { q: 'How does the JMM work?', a: 'Translated body.' } };
  const { Content } = await load({ overlay });
  await Content.load();

  const item = topic(Content, 1).sections[0].items[0];
  assert.equal(item.q, 'How does the JMM work?');
  assert.equal(item.a, 'Translated body.');
  assert.equal(Content.isFallback(item), false);
});

test('switching to Vietnamese restores the source, and back again needs no refetch', async () => {
  const { Content, fetched, store } = await load();
  await Content.load();

  await Content.setLang('vi');
  assert.equal(topic(Content, 17).label, 'Thiết kế REST API');
  assert.equal(topic(Content, 1).sections[0].title, 'Bộ nhớ & mô hình thực thi');
  assert.equal(Content.isFallback(topic(Content, 1).sections[0].items[0]), false);
  assert.equal(store.get('gazl.contentLang'), 'vi');

  const before = fetched.length;
  await Content.setLang('en');
  assert.equal(fetched.length, before, 'both languages are already in memory');
  assert.equal(topic(Content, 17).label, 'REST API design');
});

test('applying the overlay does not mutate the Vietnamese source', async () => {
  // Without a clone in _apply, the first EN render would overwrite the source
  // and switching back to VI would keep showing English.
  const { Content } = await load();
  await Content.load();
  assert.equal(topic(Content, 17).label, 'REST API design');

  await Content.setLang('vi');
  assert.equal(topic(Content, 17).label, 'Thiết kế REST API');
  await Content.setLang('en');
  await Content.setLang('vi');
  assert.equal(topic(Content, 17).label, 'Thiết kế REST API');
});

test('a missing content.en.json degrades to Vietnamese instead of throwing', async () => {
  const { Content } = await load({ overlay: null });
  await Content.load();

  assert.equal(Content.days.length, 24);
  assert.equal(topic(Content, 17).label, 'Thiết kế REST API');
});

test('a stored language choice is honoured on the next visit', async () => {
  const { Content, fetched } = await load({ lang: 'vi' });
  assert.equal(Content.lang, 'vi');
  await Content.load();

  // Reading in Vietnamese should not pull the English file at all.
  assert.deepEqual(fetched, ['content.json']);
  assert.equal(topic(Content, 17).label, 'Thiết kế REST API');
});

test('every overlay topic and item id points at something real', async () => {
  const byN = new Map(SOURCE.days.map(d => [String(d.n), d]));
  const ids = new Set(SOURCE.days.flatMap(d => d.sections.flatMap(s => s.items.map(i => i.id))));

  for (const [n, o] of Object.entries(OVERLAY.days || {})) {
    assert.ok(byN.has(n), `overlay topic ${n} does not exist`);
    assert.ok((o.sections || []).length <= byN.get(n).sections.length,
      `overlay topic ${n} has more section titles than the topic has sections`);
    for (const id of Object.keys(o.items || {})) {
      assert.ok(ids.has(id), `overlay item ${id} does not exist`);
    }
  }
});
