/* Release notes are bilingual data, not study items.

   data/release-notes.json carries `en` and `vi` blocks per release and per
   change, resolved by the header switch like meta.json. These pin the parts a
   hand-edited entry gets wrong: a missing translation, a `target` naming a
   topic that no longer exists, a date the view cannot format, and the rule that
   notes never enter the progress denominator. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const pub = path.join(root, 'public');

const NOTES = JSON.parse(await readFile(path.join(pub, 'data/release-notes.json'), 'utf8'));
const META = JSON.parse(await readFile(path.join(pub, 'data/meta.json'), 'utf8'));
const MANIFEST = JSON.parse(await readFile(path.join(pub, 'data/manifest.json'), 'utf8'));

const releases = NOTES.releases || [];
const changes = releases.flatMap(r => (r.changes || []).map(c => ({ release: r, change: c })));
const LANGS = ['en', 'vi'];
/* Targets that name something other than a topic: a feature, or the whole tree.
   Keep this closed rather than skipping any unresolvable target — a typo in a
   topic key should fail here, not silently render without its badge. */
const NON_TOPIC_TARGETS = new Set([
  'case-studies', 'boot', 'language', 'all-topics', 'release-notes'
]);

test('there is at least one release, and every release is dated ISO yyyy-mm-dd', () => {
  assert.ok(releases.length > 0);
  for (const r of releases) {
    assert.match(String(r.date), /^\d{4}-\d{2}-\d{2}$/, JSON.stringify(r.date));
    // Rejects 2026-13-40: the view formats by hand and would print it verbatim.
    assert.equal(new Date(r.date + 'T00:00:00Z').toISOString().slice(0, 10), r.date);
  }
});

test('releases are ordered newest first — the view does not sort', () => {
  const dates = releases.map(r => r.date);
  // Non-increasing, not strictly decreasing: a day can hold several releases.
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test('releases sharing a date stay adjacent, so grouping never splits a day', () => {
  const seen = new Set();
  let prev = null;
  for (const r of releases) {
    if (r.date !== prev) {
      assert.equal(seen.has(r.date), false,
        `${r.date} appears again after another date — grouping would show it twice`);
      seen.add(r.date);
      prev = r.date;
    }
  }
});

test('every release and every change carries both languages', () => {
  for (const r of releases) {
    for (const lang of LANGS) {
      assert.ok(r[lang], `release ${r.date} is missing its "${lang}" block`);
      assert.ok(String(r[lang].title || '').trim(), `release ${r.date} has no ${lang} title`);
    }
  }
  for (const { release, change } of changes) {
    for (const lang of LANGS) {
      assert.ok(change[lang], `${release.date}/${change.target}: no "${lang}" block`);
      assert.ok(String(change[lang].text || '').trim(),
        `${release.date}/${change.target}: empty ${lang} text`);
    }
  }
});

test('a change naming a topic names one that exists, by its immutable key', () => {
  const keys = new Set(Object.values(META.topics).map(t => t.key));
  const stems = new Set(MANIFEST.topics.map(row => path.basename(row.file, '.json')));
  for (const { release, change } of changes) {
    const target = String(change.target || '');
    assert.ok(target, `${release.date}: a change has no target`);
    if (NON_TOPIC_TARGETS.has(target)) continue;
    assert.ok(keys.has(target), `${release.date}: target "${target}" is not a meta.json key`);
    assert.ok(stems.has(target), `${release.date}: target "${target}" has no topic file`);
  }
});

test('counts are positive integers, and a release total matches its changes', () => {
  for (const { release, change } of changes) {
    if (change.count === undefined) continue;
    assert.ok(Number.isInteger(change.count) && change.count > 0,
      `${release.date}/${change.target}: count ${change.count}`);
  }
  for (const r of releases) {
    if (r.items_added === undefined) continue;
    // Only "topic" changes add questions; a feature row may carry its own count.
    const sum = (r.changes || [])
      .filter(c => c.kind === 'topic')
      .reduce((n, c) => n + (c.count || 0), 0);
    assert.equal(r.items_added, sum,
      `release ${r.date}: items_added ${r.items_added} but topic counts sum to ${sum}`);
  }
});

test('a section named by a change exists in that topic, in that language', async () => {
  for (const { release, change } of changes) {
    if (NON_TOPIC_TARGETS.has(String(change.target))) continue;
    for (const lang of LANGS) {
      const section = change[lang]?.section;
      if (!section) continue;
      const file = 'data/topics/' + change.target + (lang === 'vi' ? '.vi' : '') + '.json';
      const topic = JSON.parse(await readFile(path.join(pub, file), 'utf8'));
      const titles = topic.sections.map(s => s.title);
      assert.ok(titles.includes(section),
        `${release.date}: ${file} has no section "${section}" (has: ${titles.join(' | ')})`);
    }
  }
});

test('release notes are not study items — no ids, difficulty, or progress weight', () => {
  for (const { change } of changes) {
    assert.equal(change.id, undefined);
    assert.equal(change.difficulty, undefined);
  }
  const raw = JSON.stringify(NOTES);
  // An item id would make this data look like something the progress ring counts.
  assert.equal(/"[0-9]{2}-[a-z0-9-]+\.[a-z0-9-]+\.q\d+"/.test(raw), false);
});

test('groupByDate collects a day into one group and rolls its totals up', async () => {
  const { groupByDate } = await import(
    pathToFileURL(path.join(pub, 'views/release-notes.js')).href);

  const days = groupByDate([
    { date: '2026-08-09', items_added: 2, changes: [{}, {}] },
    { date: '2026-08-09', items_added: 3, changes: [{}] },
    { date: '2026-08-08', changes: [{}] }
  ]);

  assert.equal(days.length, 2, 'two distinct dates');
  assert.equal(days[0].date, '2026-08-09');
  assert.equal(days[0].releases.length, 2, 'both releases land in the same day');
  assert.equal(days[0].items_added, 5, 'question counts add up across the day');
  assert.equal(days[0].changeCount, 3);
  assert.equal(days[1].releases.length, 1);
  assert.equal(days[1].items_added, 0, 'a release with no items_added counts as zero');

  // Input order is preserved: the data file is already newest-first.
  assert.deepEqual(groupByDate([]).length, 0);
});

test('the real data groups without losing a release', async () => {
  const { groupByDate } = await import(
    pathToFileURL(path.join(pub, 'views/release-notes.js')).href);
  const days = groupByDate(releases);
  assert.equal(days.reduce((n, d) => n + d.releases.length, 0), releases.length);
  assert.equal(days.length, new Set(releases.map(r => r.date)).size);
  const dates = days.map(d => d.date);
  assert.deepEqual(dates, [...new Set(dates)], 'a date was grouped twice');
});

test('the view renders both languages and falls back rather than blanking', async () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };

  // One extra change with only a vi block, to prove the fallback path.
  const patched = structuredClone(NOTES);
  patched.releases[0].changes.push({
    kind: 'topic', target: '01-java-core-jvm',
    vi: { text: 'Ghi chú chỉ có tiếng Việt.' }
  });

  globalThis.fetch = async (url) => {
    const clean = String(url).replace(/^\.?\//, '').split('?')[0];
    if (clean === 'data/release-notes.json') return { ok: true, json: async () => structuredClone(patched) };
    const body = await readFile(path.join(pub, clean), 'utf8');
    return { ok: true, json: async () => JSON.parse(body), text: async () => body };
  };

  // The view holds its own reference to lib/content.js. Import both without a
  // cache-buster so the Content the test switches is the one the view reads —
  // busting only one URL hands the view a second, untouched module instance.
  const view = await import(pathToFileURL(path.join(pub, 'views/release-notes.js')).href);
  const { Content } = await import(pathToFileURL(path.join(pub, 'lib/content.js')).href);
  await Content.load('en');

  const render = async (lang) => {
    await Content.setLang(lang);
    let html = '';
    const host = { querySelector: (s) => (s === '[data-rn-body]' ? { set innerHTML(v) { html = v; } } : null) };
    view.renderReleaseNotes();
    await view.mountReleaseNotes(host);
    return html;
  };

  const en = await render('en');
  const vi = await render('vi');

  const dayCount = new Set(releases.map(r => r.date)).size;
  for (const html of [en, vi]) {
    // One block per release, but the date is printed once per day.
    assert.equal((html.match(/class="rn-rel"/g) || []).length, releases.length);
    assert.equal((html.match(/class="rn-day"/g) || []).length, dayCount);
    assert.equal((html.match(/class="rn-date"/g) || []).length, dayCount,
      'a date was repeated instead of grouping its releases');
    assert.equal((html.match(/<li/g) || []).length, (html.match(/<\/li>/g) || []).length);
    assert.equal((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length);
    assert.equal(/class="rn-text"><\/div>/.test(html), false, 'a change rendered with no text');
    assert.equal(/:::|\[\[[a-z]:/.test(html), false, 'callout syntax leaked to the page');
    // The vi-only change must appear in both languages, never as a blank row.
    assert.ok(html.includes('Ghi chú chỉ có tiếng Việt.'));
  }

  assert.notEqual(en, vi, 'switching language changed nothing');
  assert.ok(en.includes(releases[0].en.title));
  assert.ok(vi.includes(releases[0].vi.title));
  // Dates follow the reader's language, not the browser locale.
  assert.ok(/>\d{1,2} [A-Z][a-z]{2} \d{4}</.test(en));
  assert.ok(/>\d{2}\/\d{2}\/\d{4}</.test(vi));
  // Chrome stays English on both sides — CLAUDE.md's interface rule.
  for (const html of [en, vi]) assert.ok(html.includes('>Topic<'));
});
