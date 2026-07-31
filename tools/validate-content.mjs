#!/usr/bin/env node
/* Structural checks for public/content.json.

   The renderer in lib/markdown.js never escapes and never validates, so a
   malformed item does not throw — it renders as broken markup that only shows
   up by eye. These are the rules that have actually bitten, each one a bug
   that reached the page at least once:

     node tools/validate-content.mjs            # check
     node tools/validate-content.mjs --stats    # check + content report
*/
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const data = JSON.parse(readFileSync(ROOT + 'public/content.json', 'utf8'));
const GROUPS = new Set(['core', 'data', 'design', 'platform', 'algorithm']);
const LVLS = new Set(['core', 'hard', 'ext']);
const RAW = 'pre|table|figure';
// Tags the renderer is expected to emit; anything else means a stray '<'.
const KNOWN = 'pre|table|figure|code|span|thead|tbody|tr|th|td|b|br|svg|defs|marker|path|rect|text|line|polygon|polyline|circle|g|small|em|i';

const errs = [];
const items = [];
const markers = new Map();
const err = (id, msg) => errs.push(`${id}: ${msg}`);

for (const topic of data.days) {
  const t = `topic ${topic.n}`;
  for (const k of ['n', 'group', 'label', 'title', 'intro', 'tags', 'sections']) {
    if (topic[k] === undefined) err(t, `missing key "${k}"`);
  }
  if (!GROUPS.has(topic.group)) err(t, `unknown group "${topic.group}"`);
  if (!Array.isArray(topic.tags) || !topic.tags.length) err(t, 'tags must be a non-empty array');

  for (const sec of topic.sections || []) {
    if (!sec.title) err(t, 'a section has no title');
    for (const it of sec.items || []) {
      items.push({ ...it, n: topic.n, group: topic.group, label: topic.label });
      const id = it.id;

      if (JSON.stringify(Object.keys(it).sort()) !== '["a","id","lvl","q"]') {
        err(id, `unexpected keys ${Object.keys(it).sort().join(',')}`);
      }
      if (!LVLS.has(it.lvl)) err(id, `bad lvl "${it.lvl}"`);
      if (!String(id).startsWith(topic.n + '.')) err(id, `id does not belong to topic ${topic.n}`);

      const a = String(it.a || '');

      // colour spans: [[r: [[g: [[o: [[b:
      for (const m of a.matchAll(/\[\[([a-z]+):/g)) {
        if (!'rgob'.includes(m[1])) err(id, `bad colour span [[${m[1]}:`);
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
      for (const m of a.matchAll(/<marker id=['"]([^'"]+)['"]/g)) {
        if (!markers.has(m[1])) markers.set(m[1], []);
        markers.get(m[1]).push(id);
      }

      // '<' only starts a tag when a letter or '/' follows; '< ' stays text.
      const outside = a.replace(new RegExp(`<(${RAW})[\\s\\S]*?</\\1>`, 'g'), '');
      for (const m of outside.matchAll(new RegExp(`<(?=[a-zA-Z/])(?!/?(?:${KNOWN})\\b)`, 'g'))) {
        err(id, `bare "<" at line ${outside.slice(0, m.index).split('\n').length} — write &lt;`);
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
    if (!seen.has(target) && Number(target.split('.')[0]) <= data.days.length) {
      err(it.id, `cross-ref (${target}) points at no item`);
    }
  }
}

if (errs.length) {
  console.error(`\ncontent.json FAILED — ${errs.length} problem(s):\n`);
  for (const e of errs) console.error('  - ' + e);
  process.exit(1);
}

console.log(`content.json OK — ${data.days.length} topics, ${items.length} items, ${markers.size} SVG markers`);

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
