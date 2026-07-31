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

// fileURLToPath, not .pathname — on Windows the latter yields "/D:/…", which
// node then resolves against the current drive as "D:\D:\…".
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = ROOT + 'public/data/';
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const readOptionalJson = (p) => { try { return readJson(p); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; } };

const manifest = readJson(DATA + 'manifest.json');
const meta = readJson(DATA + 'meta.json');
const GROUPS = new Set(['core', 'data', 'design', 'platform', 'algorithm']);
const LVLS = new Set(['core', 'hard', 'ext']);
const RAW = 'pre|table|figure';
// Tags the renderer is expected to emit; anything else means a stray '<'.
const KNOWN = 'pre|table|figure|code|span|thead|tbody|tr|th|td|b|br|svg|defs|marker|path|rect|text|line|polygon|polyline|circle|g|small|em|i';

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
  if (!GROUPS.has(row.group)) err(t, `unknown group "${row.group}"`);
  if (!m) { err(t, 'missing meta.json entry'); continue; }
  for (const k of ['label', 'title', 'intro', 'tags']) {
    if (m.vi?.[k] === undefined) err(t, `meta.json missing vi.${k}`);
  }
  if (!Array.isArray(m.vi?.tags) || !m.vi.tags.length) err(t, 'vi.tags must be a non-empty array');
  if (content.n !== row.n) err(t, `content file n=${content.n} does not match manifest n=${row.n}`);

  for (const sec of content.sections || []) {
    if (!sec.title) err(t, 'a section has no title');
    for (const it of sec.items || []) {
      items.push({ ...it, n: row.n, group: row.group, label: m.vi?.label });
      const id = it.id;

      if (JSON.stringify(Object.keys(it).sort()) !== '["a","id","lvl","q"]') {
        err(id, `unexpected keys ${Object.keys(it).sort().join(',')}`);
      }
      if (!LVLS.has(it.lvl)) err(id, `bad lvl "${it.lvl}"`);
      if (!String(id).startsWith(row.n + '.')) err(id, `id does not belong to topic ${row.n}`);

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

// Cross-references written as "(12.4)" must point at a real item.
for (const it of items) {
  for (const m of String(it.a).matchAll(/\((\d{1,2}\.\d{1,2})\)/g)) {
    const target = m[1];
    // Skip decimals that are prose, not references (e.g. "0.1/0.2", "1.5x").
    if (!/^\d{1,2}\.\d{1,2}$/.test(target) || target.startsWith('0.')) continue;
    if (!seen.has(target) && Number(target.split('.')[0]) <= topics.length) {
      err(it.id, `cross-ref (${target}) points at no item`);
    }
  }
}

/* ---------- data/meta.json + topics/N.en.json — the optional English overlay ----------

   Every field is optional and falls back to the Vietnamese source, so the
   only real failure mode is an overlay that points at nothing: a topic
   number or item id that does not exist gets silently ignored at runtime and
   the reader just never sees the translation they wrote. */
let enTopics = 0, enItems = 0;
for (const [n, m] of Object.entries(meta.topics)) {
  const row = manifest.topics.find(r => String(r.n) === n);
  if (!row) { errs.push(`meta.json: topic "${n}" does not exist in manifest`); continue; }
  if (m.en) enTopics++;
}

for (const { row } of topics) {
  const enFile = readOptionalJson(DATA + row.file.replace(/\.json$/, '.en.json'));
  if (!enFile) continue;
  const content = topics.find(t => t.row.n === row.n).content;
  if (Array.isArray(enFile.sections) && enFile.sections.length > content.sections.length) {
    errs.push(`topic ${row.n}.en.json: ${enFile.sections.length} section titles for ${content.sections.length} sections`);
  }
  for (const [id, oi] of Object.entries(enFile.items || {})) {
    if (!seen.has(id)) { errs.push(`topic ${row.n}.en.json: item "${id}" does not exist`); continue; }
    if (!String(id).startsWith(row.n + '.')) errs.push(`topic ${row.n}.en.json: item "${id}" is filed under topic ${row.n}`);
    if (oi.a) enItems++;
  }
}

// Microservices
const micro = readJson(DATA + manifest.microservices.file);
const microMeta = meta.microservices || {};
for (const k of ['title', 'intro', 'tags']) {
  if (microMeta.vi?.[k] === undefined) errs.push(`meta.json: missing microservices.vi.${k}`);
}
const microEn = readOptionalJson(DATA + manifest.microservices.file.replace(/\.json$/, '.en.json'));
if (microEn) {
  const chapters = Array.isArray(microEn.chapters) ? microEn.chapters.length : 0;
  const realChapters = (micro.chapters || []).length;
  if (chapters > realChapters) {
    errs.push(`microservices.en.json: ${chapters} chapter titles for ${realChapters} chapters`);
  }
}

if (errs.length) {
  console.error(`\ncontent FAILED — ${errs.length} problem(s):\n`);
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}

console.log(`content OK — ${topics.length} topics, ${items.length} items, ${markers.size} SVG markers`);
console.log(`English overlay — ${enTopics}/${topics.length} topics with meta translated, ${enItems}/${items.length} answers translated`);

if (process.argv.includes('--stats')) {
  const by = (fn) => items.reduce((m, i) => (m[fn(i)] = (m[fn(i)] || 0) + 1, m), {});
  const refs = items.reduce((n, i) => n + [...String(i.a).matchAll(/\((\d{1,2}\.\d{1,2})\)/g)]
    .filter(m => seen.has(m[1])).length, 0);
  const thin = items.filter(i => i.a.length < 800);
  const lens = items.map(i => i.a.length).sort((x, y) => x - y);

  console.log('\ntopics per group :', by(i => i.group));
  console.log('items per lvl    :', by(i => i.lvl));
  console.log('answer length    : median', lens[lens.length >> 1], '· min', lens[0], '· max', lens.at(-1));
  console.log('cross-references :', refs, `(${(refs / items.length).toFixed(2)} per item)`);
  console.log('thin items <800  :', thin.length, '→', thin.map(i => i.id).join(' '));
  console.log('items with code  :', items.filter(i => i.a.includes('<pre>')).length);
  console.log('items with table :', items.filter(i => i.a.includes('<table')).length);
  console.log('items with SVG   :', items.filter(i => i.a.includes('<svg')).length);
}
