/* The VI/EN language switch in lib/content.js.

   data/manifest.json + data/meta.json + per-topic data/topics/NN-slug.json
   are the English base and always load — including the Microservices track,
   filed as topic_type "microservice" like any other topic (n=25). Every
   topic's Vietnamese original always lives alongside it as
   data/topics/NN-slug.vi.json — the complete, ground-truth content — and is
   fetched eagerly too, so switching language never needs a refetch. An
   item's `translated` flag says whether its text is authentically written
   in that file's language: the EN base carries Vietnamese text verbatim
   (translated:false) until someone actually translates it, while every item
   in a .vi.json file is translated:true. The rules worth pinning: a topic
   with zero real English translations still renders (falls back to the
   Vietnamese text, flagged), applying a language never mutates the other
   language's source, and the reported hasEn/hasVi availability matches
   what's actually on the page. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const pub = path.join(root, 'public');

const MANIFEST = JSON.parse(await readFile(path.join(pub, 'data/manifest.json'), 'utf8'));
const META = JSON.parse(await readFile(path.join(pub, 'data/meta.json'), 'utf8'));
const TOPIC_FILES = new Map();
const TOPIC_VI_FILES = new Map();
for (const row of MANIFEST.topics) {
  TOPIC_FILES.set('data/' + row.file, JSON.parse(await readFile(path.join(pub, 'data', row.file), 'utf8')));
  const viPath = 'data/' + row.file.replace(/\.json$/, '.vi.json');
  TOPIC_VI_FILES.set(viPath, JSON.parse(await readFile(path.join(pub, viPath), 'utf8')));
}

/** A fresh Content module with stubbed fetch + localStorage, serving the real data/ tree. */
async function load({ lang, metaOverride, topicOverrides, dropVi } = {}) {
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
    if (url === 'data/manifest.json') return { ok: true, json: async () => structuredClone(MANIFEST) };
    if (url === 'data/meta.json') return { ok: true, json: async () => structuredClone(metaOverride || META) };
    if (topicOverrides && topicOverrides[url]) return { ok: true, json: async () => structuredClone(topicOverrides[url]) };
    if (TOPIC_FILES.has(url)) return { ok: true, json: async () => structuredClone(TOPIC_FILES.get(url)) };
    if (!dropVi && TOPIC_VI_FILES.has(url)) return { ok: true, json: async () => structuredClone(TOPIC_VI_FILES.get(url)) };
    return { ok: false, status: 404 };
  };
  // Cache-bust so every test gets its own module instance.
  const url = pathToFileURL(path.join(pub, 'lib/content.js')).href + '?t=' + Math.random();
  const { Content } = await import(url);
  return { Content, fetched, store };
}

const topic = (Content, n) => Content.topics.find(t => t.n === n);

beforeEach(() => { delete globalThis.fetch; });

test('English is the default language and every topic loads, including microservice', async () => {
  const { Content } = await load();
  assert.equal(Content.lang, 'en');
  await Content.load();
  assert.equal(Content.topics.length, 25);
  assert.equal(topic(Content, 25).topic_type, 'microservice');
});

test('an item with no real translation falls back to Vietnamese and is flagged', async () => {
  const { Content } = await load();
  await Content.load();
  const item = topic(Content, 1).sections[0].items[0];

  assert.match(item.a, /JMM/);
  assert.equal(Content.isFallback(item), true);
  // Falling back must never drop items — the ring denominator depends on it.
  assert.equal(Content.totalTopicItems, 324);
});

test('a translated item is used and stops being flagged', async () => {
  const topic1Row = MANIFEST.topics.find(r => r.n === 1);
  const enPath = 'data/' + topic1Row.file;
  const base = TOPIC_FILES.get(enPath);
  const patched = structuredClone(base);
  patched.sections[0].items[0] = { ...patched.sections[0].items[0], q: 'How does the JMM work?', a: 'Translated body.', translated: true };
  const { Content } = await load({ topicOverrides: { [enPath]: patched } });
  await Content.load();

  const item = topic(Content, 1).sections[0].items[0];
  assert.equal(item.q, 'How does the JMM work?');
  assert.equal(item.a, 'Translated body.');
  assert.equal(Content.isFallback(item), false);
});

test('switching to Vietnamese shows the complete source, and back again needs no refetch', async () => {
  const { Content, fetched } = await load();
  await Content.load();

  await Content.setLang('vi');
  const viItem = topic(Content, 1).sections[0].items[0];
  assert.equal(Content.isFallback(viItem), false);
  const viBase = TOPIC_VI_FILES.get('data/' + MANIFEST.topics[0].file.replace(/\.json$/, '.vi.json'));
  assert.equal(topic(Content, 1).sections[0].title, viBase.sections[0].title);

  const before = fetched.length;
  await Content.setLang('en');
  assert.equal(fetched.length, before, 'both languages are already in memory');
});

test('a stored language choice is honoured, and both languages are fetched upfront', async () => {
  const { Content, fetched } = await load({ lang: 'vi' });
  assert.equal(Content.lang, 'vi');
  await Content.load();

  const expected = ['data/manifest.json', 'data/meta.json',
    ...MANIFEST.topics.map(r => 'data/' + r.file),
    ...MANIFEST.topics.map(r => 'data/' + r.file.replace(/\.json$/, '.vi.json'))
  ];
  assert.deepEqual([...fetched].sort(), [...expected].sort());
});

test('a topic with zero translated items reports hasEn:false, hasVi:true', async () => {
  const { Content } = await load();
  await Content.load();
  // None of the seed data has real translations yet.
  assert.equal(topic(Content, 1).hasEn, false);
  assert.equal(topic(Content, 1).hasVi, true);
});

test('a topic with at least one translated item reports hasEn:true', async () => {
  const topic1Row = MANIFEST.topics.find(r => r.n === 1);
  const enPath = 'data/' + topic1Row.file;
  const base = TOPIC_FILES.get(enPath);
  const patched = structuredClone(base);
  patched.sections[0].items[0] = { ...patched.sections[0].items[0], translated: true };
  const { Content } = await load({ topicOverrides: { [enPath]: patched } });
  await Content.load();

  assert.equal(topic(Content, 1).hasEn, true);
});

test('a missing .vi.json degrades to the English base instead of throwing', async () => {
  const { Content } = await load({ dropVi: true });
  await Content.load();
  assert.equal(Content.topics.length, 25);

  await Content.setLang('vi');
  // No VI file fetched successfully, so VI falls back to whatever the base has.
  const item = topic(Content, 1).sections[0].items[0];
  assert.match(item.a, /JMM/);
});

test('applying a language never mutates the other language source', async () => {
  const { Content } = await load();
  await Content.load();
  const enLabel = topic(Content, 17).label;

  await Content.setLang('vi');
  const viLabel = topic(Content, 17).label;
  await Content.setLang('en');
  assert.equal(topic(Content, 17).label, enLabel);
  await Content.setLang('vi');
  assert.equal(topic(Content, 17).label, viLabel);
});

test('every meta.json topic points at a real manifest entry, and key matches the file', async () => {
  const byN = new Map(MANIFEST.topics.map(r => [String(r.n), r]));
  for (const [n, m] of Object.entries(META.topics)) {
    const row = byN.get(n);
    assert.ok(row, `meta topic ${n} does not exist in manifest`);
    assert.equal('topics/' + m.key + '.json', row.file, `meta topic ${n} key does not match its manifest file`);
    assert.equal(m.topic_type, row.topic_type, `meta topic ${n} topic_type does not match manifest`);
  }
});

test('every .vi.json item exists in the base file and is translated:true', async () => {
  const ids = new Set([...TOPIC_FILES.values()].flatMap(c => c.sections.flatMap(s => s.items.map(i => i.id))));
  for (const [viPath, viContent] of TOPIC_VI_FILES) {
    for (const sec of viContent.sections) {
      for (const it of sec.items) {
        assert.ok(ids.has(it.id), `${viPath}: item ${it.id} does not exist in the base file`);
        assert.equal(it.translated, true, `${viPath}: item ${it.id} must be translated:true`);
      }
    }
  }
});

test('every item id encodes its own topic key', async () => {
  for (const row of MANIFEST.topics) {
    const key = row.file.replace(/^topics\//, '').replace(/\.json$/, '');
    const content = TOPIC_FILES.get('data/' + row.file);
    for (const sec of content.sections) {
      for (const it of sec.items) {
        assert.ok(it.id.startsWith(key + '.'), `item ${it.id} does not start with topic key ${key}`);
      }
    }
  }
});
