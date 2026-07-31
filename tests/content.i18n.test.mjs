/* The VI/EN overlay in lib/content.js.

   data/manifest.json + data/meta.json + per-topic data/topics/N.json are the
   Vietnamese source of truth and always load; data/meta.json's `en` blocks
   and optional data/topics/N.en.json files are a partial overlay keyed by
   topic `n` and item id. The rules worth pinning are the ones that make a
   partial overlay safe: a missing field falls back rather than blanking
   out, applying the overlay never mutates the Vietnamese source (or
   switching back would show English), and an absent overlay file degrades
   instead of throwing. */
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
for (const row of MANIFEST.topics) {
  TOPIC_FILES.set('data/' + row.file, JSON.parse(await readFile(path.join(pub, 'data', row.file), 'utf8')));
}
const MICRO_FILE = 'data/' + MANIFEST.microservices.file;
const MICRO = JSON.parse(await readFile(path.join(pub, MICRO_FILE), 'utf8'));

async function readOptional(file) {
  try { return JSON.parse(await readFile(path.join(pub, file), 'utf8')); }
  catch (e) { return null; }
}
const TOPIC_EN_FILES = new Map();
for (const row of MANIFEST.topics) {
  const enPath = 'data/' + row.file.replace(/\.json$/, '.en.json');
  TOPIC_EN_FILES.set(enPath, await readOptional(enPath));
}
const MICRO_EN_FILE = 'data/' + MANIFEST.microservices.file.replace(/\.json$/, '.en.json');
const MICRO_EN = await readOptional(MICRO_EN_FILE);

/** A fresh Content module with stubbed fetch + localStorage, serving the real data/ tree. */
async function load({ dropEn = false, lang, metaOverride, extraTopicEn } = {}) {
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
    if (TOPIC_FILES.has(url)) return { ok: true, json: async () => structuredClone(TOPIC_FILES.get(url)) };
    if (url === MICRO_FILE) return { ok: true, json: async () => structuredClone(MICRO) };
    if (!dropEn && TOPIC_EN_FILES.has(url) && TOPIC_EN_FILES.get(url)) {
      const override = extraTopicEn && extraTopicEn[url];
      return { ok: true, json: async () => structuredClone(override || TOPIC_EN_FILES.get(url)) };
    }
    if (!dropEn && url === MICRO_EN_FILE && MICRO_EN) return { ok: true, json: async () => structuredClone(MICRO_EN) };
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
  const topic1Row = MANIFEST.topics.find(r => r.n === 1);
  const enPath = 'data/' + topic1Row.file.replace(/\.json$/, '.en.json');
  const base = TOPIC_EN_FILES.get(enPath) || {};
  const extraTopicEn = { [enPath]: { ...base, items: { ...(base.items || {}), '1.1': { q: 'How does the JMM work?', a: 'Translated body.' } } } };
  const { Content } = await load({ extraTopicEn });
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

test('missing English item overlay files degrade to Vietnamese instead of throwing', async () => {
  // Dropping only the per-topic .en.json (item text) files must not affect
  // meta.json's own `en` block (label/title/intro/tags) — they are two
  // independent overlays.
  const { Content } = await load({ dropEn: true });
  await Content.load();

  assert.equal(Content.days.length, 24);
  assert.equal(topic(Content, 17).label, 'REST API design');
  const item = topic(Content, 1).sections[0].items[0];
  assert.match(item.a, /JMM/);
  assert.equal(Content.isFallback(item), true);
});

test('a topic with no meta.json en block falls back to Vietnamese metadata', async () => {
  const metaOverride = structuredClone(META);
  delete metaOverride.topics['17'].en;
  const { Content } = await load({ metaOverride });
  await Content.load();

  assert.equal(topic(Content, 17).label, 'Thiết kế REST API');
  // Other topics keep their English metadata.
  assert.equal(topic(Content, 1).label, META.topics['1'].en.label);
});

test('a stored language choice is honoured on the next visit', async () => {
  const { Content, fetched } = await load({ lang: 'vi' });
  assert.equal(Content.lang, 'vi');
  await Content.load();

  // Reading in Vietnamese should not pull any English file at all.
  assert.deepEqual(fetched, ['data/manifest.json', 'data/meta.json', ...MANIFEST.topics.map(r => 'data/' + r.file), MICRO_FILE]);
  assert.equal(topic(Content, 17).label, 'Thiết kế REST API');
});

test('every meta overlay topic points at something real, and every content overlay item exists', async () => {
  const byN = new Map(MANIFEST.topics.map(r => [String(r.n), r]));
  const ids = new Set([...TOPIC_FILES.values()].flatMap(c => c.sections.flatMap(s => s.items.map(i => i.id))));

  for (const [n, m] of Object.entries(META.topics)) {
    assert.ok(byN.has(n), `meta topic ${n} does not exist in manifest`);
    if (m.en) assert.ok(typeof m.en === 'object');
  }
  for (const [enPath, overlay] of TOPIC_EN_FILES) {
    if (!overlay) continue;
    const n = enPath.match(/topics\/(\d+)\.en\.json$/)[1];
    const topicRow = byN.get(n);
    assert.ok(topicRow, `overlay file ${enPath} has no matching topic`);
    const topicContent = TOPIC_FILES.get('data/' + topicRow.file);
    assert.ok((overlay.sections || []).length <= topicContent.sections.length,
      `overlay topic ${n} has more section titles than the topic has sections`);
    for (const id of Object.keys(overlay.items || {})) {
      assert.ok(ids.has(id), `overlay item ${id} does not exist`);
    }
  }
});
