#!/usr/bin/env node
/* Structural checks for public/data/*.

   The renderer in lib/markdown.js never escapes and never validates, so a
   malformed item does not throw — it renders as broken markup that only shows
   up by eye. These are the rules that have actually bitten, each one a bug
   that reached the page at least once:

     node tools/validate-content.mjs            # check
     node tools/validate-content.mjs --stats    # check + content report
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TOPIC_TYPES, DIFFICULTIES } from '../public/lib/constants.js';

// fileURLToPath, not .pathname — on Windows the latter yields "/D:/…", which
// node then resolves against the current drive as "D:\D:\…".
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = ROOT + 'public/data/';
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readOptionalJson = (p) => { try { return readJson(p); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; } };

const manifest = readJson(DATA + 'manifest.json');
const meta = readJson(DATA + 'meta.json');
const TOPIC_TYPE_KEYS = new Set(TOPIC_TYPES.map(t => t.key));
const DIFFICULTY_KEYS = new Set(DIFFICULTIES.map(d => d.key));
const RAW = 'pre|table|figure';
// Tags the renderer is expected to emit; anything else means a stray '<'.
const KNOWN = 'pre|table|figure|code|span|thead|tbody|tr|th|td|b|br|svg|defs|marker|path|rect|text|line|polygon|polyline|circle|g|small|em|i';
// item id: {topic-key}.{section-slug}.q{n} — topic-key/section-slug are
// slugs (lowercase, hyphenated), the item index is always numeric.
const ID_RE = /^([a-z0-9-]+)\.([a-z0-9-]+)\.q(\d+)$/;

const errs = [];
const items = [];
const markers = new Map();
const err = (id, msg) => errs.push(`${id}: ${msg}`);

// Load every topic's content file + its meta entry, keeping the manifest's
// declared order (that order is the browse order the track view walks).
const topics = manifest.topics.map(row => ({
  row,
  content: readJson(DATA + row.file),
  meta: meta.topics[String(row.n)]
}));

for (const { row, content, meta: m } of topics) {
  const t = `topic ${row.n}`;
  if (!TOPIC_TYPE_KEYS.has(row.topic_type)) err(t, `unknown topic_type "${row.topic_type}"`);
  if (!m) { err(t, 'missing meta.json entry'); continue; }
  for (const k of ['label', 'title', 'intro', 'tags']) {
    if (m.vi?.[k] === undefined) err(t, `meta.json missing vi.${k}`);
  }
  if (!Array.isArray(m.vi?.tags) || !m.vi.tags.length) err(t, 'vi.tags must be a non-empty array');
  const topicKey = row.file.replace(/^topics\//, '').replace(/\.json$/, '');

  for (const sec of content.sections || []) {
    if (!sec.title) err(t, 'a section has no title');
    for (const it of sec.items || []) {
      items.push({ ...it, n: row.n, topic_type: row.topic_type, label: m.vi?.label });
      const id = it.id;

      if (JSON.stringify(Object.keys(it).sort()) !== '["a","difficulty","id","q"]') {
        err(id, `unexpected keys ${Object.keys(it).sort().join(',')}`);
      }
      if (!DIFFICULTY_KEYS.has(it.difficulty)) err(id, `bad difficulty "${it.difficulty}"`);

      const match = String(id).match(ID_RE);
      if (!match) err(id, `id does not match {topic-key}.{section-slug}.q{n}`);
      else if (match[1] !== topicKey) err(id, `id's topic key "${match[1]}" does not match its file's key "${topicKey}"`);

      const a = String(it.a || '');

      // colour spans: [[r: [[g: [[o: [[b:
      for (const m2 of a.matchAll(/\[\[([a-z]+):/g)) {
        if (!'rgob'.includes(m2[1])) err(id, `bad colour span [[${m2[1]}:`);
      }
      if ((a.match(/\[\[/g) || []).length !== (a.match(/\]\]/g) || []).length) {
        err(id, 'unbalanced [[ ]]');
      }

      // ::: callouts
      const open = (a.match(/^:::(deep|tip|warn)/gm) || []).length;
      const close = (a.match(/^:::\s*$/gm) || []).length;
      if (open !== close) err(id, `${open} callout opens vs ${close} closes`);

      // A raw-HTML block ends at the first blank line, so a blank line inside
      // <pre>/<table>/<figure> truncates it and dumps the rest as text.
      for (const tag of RAW.split('|')) {
        const re = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, 'g');
        for (const blk of a.match(re) || []) {
          if (blk.includes('\n\n')) err(id, `blank line inside <${tag}> — truncates the block`);
        }
        const o = (a.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
        const c = (a.match(new RegExp(`</${tag}>`, 'g')) || []).length;
        if (o !== c) err(id, `unbalanced <${tag}> (${o} open, ${c} close)`);
      }

      // SVG marker ids share one DOM once several cards are open.
      for (const m2 of a.matchAll(/<marker id=['"]([^'"]+)['"]/g)) {
        if (!markers.has(m2[1])) markers.set(m2[1], []);
        markers.get(m2[1]).push(id);
      }

      // '<' only starts a tag when a letter or '/' follows; '< ' stays text.
      const outside = a.replace(new RegExp(`<(${RAW})[\\s\\S]*?</\\1>`, 'g'), '');
      for (const m2 of outside.matchAll(new RegExp(`<(?=[a-zA-Z/])(?!/?(?:${KNOWN})\\b)`, 'g'))) {
        err(id, `bare "<" at line ${outside.slice(0, m2.index).split('\n').length} — write &lt;`);
      }
    }
  }
}

const seen = new Map();
for (const it of items) {
  if (seen.has(it.id)) err(it.id, 'duplicate item id');
  seen.set(it.id, it);
}
for (const [mid, where] of markers) {
  if (where.length > 1) errs.push(`SVG marker id "${mid}" reused by ${where.join(', ')} — must be unique file-wide`);
}

// Cross-references written as "(topic-key.section-slug.qN)" must point at a real item.
const REF_RE = /\(([a-z0-9-]+\.[a-z0-9-]+\.q\d+)\)/g;
for (const it of items) {
  for (const m of String(it.a).matchAll(REF_RE)) {
    const target = m[1];
    if (!seen.has(target)) err(it.id, `cross-ref (${target}) points at no item`);
  }
}

/* ---------- data/meta.json + topics/NN-slug.vi.json ----------

   Each English base file has a complete Vietnamese companion. Both item
   sequences use the same four-key schema and IDs in the same order.
   meta.json's `en`/`vi` keys must actually hold the language they claim. */
for (const [n, m] of Object.entries(meta.topics)) {
  const row = manifest.topics.find(r => String(r.n) === n);
  if (!row) { errs.push(`meta.json: topic "${n}" does not exist in manifest`); continue; }
  if (!TOPIC_TYPE_KEYS.has(m.topic_type)) errs.push(`meta.json: topic ${n} has unknown topic_type "${m.topic_type}"`);
  if (m.topic_type !== row.topic_type) errs.push(`meta.json: topic ${n} topic_type does not match manifest`);
  for (const k of ['label', 'title', 'intro', 'tags']) {
    if (m.en?.[k] === undefined) errs.push(`meta.json: topic ${n} missing en.${k}`);
  }
  if (!m.key) errs.push(`meta.json: topic ${n} missing key`);
  else if (`topics/${m.key}.json` !== row.file) {
    errs.push(`meta.json: topic ${n} key "${m.key}" does not match manifest file "${row.file}"`);
  }
}

for (const { row, content } of topics) {
  const viFile = readOptionalJson(DATA + row.file.replace(/\.json$/, '.vi.json'));
  if (!viFile) { errs.push(`topic ${row.n}: missing ${row.file.replace(/\.json$/, '.vi.json')}`); continue; }
  if (!Array.isArray(viFile.sections) || viFile.sections.length !== content.sections.length) {
    errs.push(`topic ${row.n}.vi.json: ${(viFile.sections || []).length} sections for ${content.sections.length} in the base file`);
  }
  for (const [sectionIndex, sec] of (viFile.sections || []).entries()) {
    const baseItems = content.sections[sectionIndex]?.items || [];
    const viItems = sec.items || [];
    if (viItems.length !== baseItems.length) {
      errs.push(`topic ${row.n}.vi.json: section ${sectionIndex + 1} has ${viItems.length} items for ${baseItems.length} in the base file`);
    }
    for (const [itemIndex, it] of viItems.entries()) {
      if (JSON.stringify(Object.keys(it).sort()) !== '["a","difficulty","id","q"]') {
        errs.push(`topic ${row.n}.vi.json: item "${it.id}" unexpected keys ${Object.keys(it).sort().join(',')}`);
      }
      const baseItem = baseItems[itemIndex];
      if (baseItem && it.id !== baseItem.id) {
        errs.push(`topic ${row.n}.vi.json: section ${sectionIndex + 1} item ${itemIndex + 1} id "${it.id}" does not match base item "${baseItem.id}"`);
      }
    }
  }
}

if (errs.length) {
  console.error(`\ncontent FAILED — ${errs.length} problem(s):\n`);
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}

console.log(`content OK — ${topics.length} topics, ${items.length} items, ${markers.size} SVG markers`);

if (process.argv.includes('--stats')) {
  const by = (fn) => items.reduce((m, i) => (m[fn(i)] = (m[fn(i)] || 0) + 1, m), {});
  const refs = items.reduce((n, i) => n + [...String(i.a).matchAll(REF_RE)]
    .filter(m => seen.has(m[1])).length, 0);
  const thin = items.filter(i => i.a.length < 800);
  const lens = items.map(i => i.a.length).sort((x, y) => x - y);

  console.log('\ntopics per type  :', by(i => i.topic_type));
  console.log('items per diff.  :', by(i => i.difficulty));
  console.log('answer length    : median', lens[lens.length >> 1], '· min', lens[0], '· max', lens.at(-1));
  console.log('cross-references :', refs, `(${(refs / items.length).toFixed(2)} per item)`);
  console.log('thin items <800  :', thin.length, '→', thin.map(i => i.id).join(' '));
  console.log('items with code  :', items.filter(i => i.a.includes('<pre>')).length);
  console.log('items with table :', items.filter(i => i.a.includes('<table')).length);
  console.log('items with SVG   :', items.filter(i => i.a.includes('<svg')).length);
}
