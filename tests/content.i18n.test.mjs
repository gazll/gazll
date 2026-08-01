/* The VI/EN language switch in lib/content.js.

   data/manifest.json + data/meta.json + per-topic data/topics/NN-slug.json
   are complete English sources and always load — including the Microservices
   track, filed as topic_type "microservice" like any other topic (n=25).
   Every topic's complete Vietnamese companion lives alongside it as
   data/topics/NN-slug.vi.json and is fetched eagerly too, so switching
   language never needs a refetch. Applying a language must not mutate the
   other language's source. */
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

test('every bilingual item uses the final four-key schema', () => {
  for (const files of [TOPIC_FILES, TOPIC_VI_FILES]) {
    for (const [file, content] of files) {
      for (const section of content.sections) {
        for (const item of section.items) {
          assert.deepEqual(Object.keys(item).sort(), ['a', 'difficulty', 'id', 'q'], `${file}: ${item.id}`);
        }
      }
    }
  }
});

test('switching to Vietnamese shows the complete source, and back again needs no refetch', async () => {
  const { Content, fetched } = await load();
  await Content.load();

  await Content.setLang('vi');
  const viItem = topic(Content, 1).sections[0].items[0];
  const viBase = TOPIC_VI_FILES.get('data/' + MANIFEST.topics[0].file.replace(/\.json$/, '.vi.json'));
  assert.equal(topic(Content, 1).sections[0].title, viBase.sections[0].title);
  assert.equal(viItem.q, viBase.sections[0].items[0].q);
  assert.equal(viItem.a, viBase.sections[0].items[0].a);

  const before = fetched.length;
  await Content.setLang('en');
  assert.equal(fetched.length, before, 'both languages are already in memory');
  const enBase = TOPIC_FILES.get('data/' + MANIFEST.topics[0].file);
  const enItem = topic(Content, 1).sections[0].items[0];
  assert.equal(enItem.q, enBase.sections[0].items[0].q);
  assert.equal(enItem.a, enBase.sections[0].items[0].a);
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

test('a missing .vi.json degrades to the English base instead of throwing', async () => {
  const { Content } = await load({ dropVi: true });
  await Content.load();
  assert.equal(Content.topics.length, 25);

  await Content.setLang('vi');
  // No VI file fetched successfully, so VI uses the complete English base.
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

test('every Vietnamese companion has the base file item IDs in order', () => {
  for (const row of MANIFEST.topics) {
    const basePath = 'data/' + row.file;
    const viPath = basePath.replace(/\.json$/, '.vi.json');
    const baseIds = TOPIC_FILES.get(basePath).sections.flatMap(section => section.items.map(item => item.id));
    const viIds = TOPIC_VI_FILES.get(viPath).sections.flatMap(section => section.items.map(item => item.id));
    assert.deepEqual(viIds, baseIds, `${viPath}: item IDs must match ${basePath} in order`);
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

test('content review metadata is keyed by real immutable item ids', async () => {
  const reviewPath = path.join(pub, 'data/content-reviews.json');
  const raw = await readFile(reviewPath, 'utf8').catch(() => null);
  assert.ok(raw, 'public/data/content-reviews.json must exist');

  const reviews = JSON.parse(raw);
  const ids = new Set(
    [...TOPIC_FILES.values()].flatMap(content =>
      content.sections.flatMap(section => section.items.map(item => item.id)))
  );
  const entries = Object.entries(reviews);
  assert.ok(entries.length >= 10, 'the high-risk refresh needs provenance for more than a token sample');

  for (const [id, review] of entries) {
    assert.ok(ids.has(id), `${id}: review metadata points at no English item`);
    assert.match(review.reviewed_at, /^\d{4}-\d{2}-\d{2}$/, `${id}: reviewed_at must be YYYY-MM-DD`);
    assert.ok(
      ['normative', 'heuristic', 'example'].includes(review.claim_type),
      `${id}: unsupported claim_type ${review.claim_type}`
    );
    assert.ok(Array.isArray(review.target_versions) && review.target_versions.length > 0,
      `${id}: target_versions must be a non-empty array`);
    assert.ok(review.target_versions.every(version => typeof version === 'string' && version.length > 0),
      `${id}: target_versions must contain non-empty strings`);
    assert.ok(Array.isArray(review.sources) && review.sources.length > 0,
      `${id}: sources must be a non-empty array`);
    assert.ok(review.sources.every(source => /^https:\/\//.test(source)),
      `${id}: every source must be an HTTPS URL`);
  }
});
