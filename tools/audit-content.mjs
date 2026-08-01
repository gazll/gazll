#!/usr/bin/env node
/* Editorial checks — the ones validate-content.mjs deliberately leaves out.

   The validator answers "is this file structurally legal?". This answers
   "is this content still good?", which is a judgement call, so everything
   here prints for a human to read rather than failing a build.

     node tools/audit-content.mjs            # parity + coverage
     node tools/audit-content.mjs --stale    # + what may have aged out
     node tools/audit-content.mjs --gaps     # + per-item candidates for examples
     node tools/audit-content.mjs --refs     # + non-canonical chapter aliases

   Parity matters because the two language files are edited separately: the
   validator pins section/item counts and ids, but nothing stops one language
   gaining a code block the other never got. */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = ROOT + 'public/data/';
const TOPICS = DATA + 'topics/';
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

const meta = readJson(DATA + 'meta.json');
const byKey = {};
for (const [n, t] of Object.entries(meta.topics)) byKey[t.key] = { n: +n, type: t.topic_type };

const flag = (f) => process.argv.includes(f);
const bases = readdirSync(TOPICS).filter(f => f.endsWith('.json') && !f.endsWith('.vi.json')).sort();

/* Strip markup so prose checks see words, not tag soup. */
const prose = (s) => String(s)
  .replace(/<pre>[\s\S]*?<\/pre>/g, ' ')
  .replace(/<svg[\s\S]*?<\/svg>/g, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/`[^`]*`/g, ' ')
  .replace(/\[\[[a-z]:([^\]]*)\]\]/g, '$1');

/* Structural features that must exist equally in both languages. */
const shape = (a) => ({
  pre: (a.match(/<pre>/g) || []).length,
  table: (a.match(/<table/g) || []).length,
  svg: (a.match(/<svg/g) || []).length,
  deep: (a.match(/^:::deep/gm) || []).length,
  tip: (a.match(/^:::tip/gm) || []).length,
  warn: (a.match(/^:::warn/gm) || []).length,
  ref: (a.match(/\[\[/g) || []).length
});

const hasExplanatoryEvidence = (a) => /<pre>|<table\b|<figure\b/i.test(a);
const visibleWordCount = (s) => (prose(s).match(/\S+/g) || []).length;

const VI_DIACRITIC = /[àáảãạâầấẩẫậăằắẳẵặèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
/* English function-words that should not survive in Vietnamese prose.
   Technical nouns (request, cache, thread, index…) are kept on purpose and
   are not listed here. */
const EN_STRAY = /\b(tailored|however|therefore|instead of|because|which|that is|should be|must be|as well as|such as|rather than|note that|make sure|keep in mind|for example|in order to)\b/gi;

const items = [];
const parity = [], leak = [];

for (const f of bases) {
  const key = f.replace(/\.json$/, '');
  const en = readJson(TOPICS + f);
  let vi = null;
  try { vi = readJson(TOPICS + key + '.vi.json'); } catch { parity.push(`${key}: no .vi.json companion`); }
  const info = byKey[key] || {};

  en.sections.forEach((s, si) => s.items.forEach((it, ii) => {
    items.push({ ...it, key, type: info.type, n: info.n });

    const p = prose(it.q + ' ' + it.a);
    if (VI_DIACRITIC.test(p)) {
      const m = p.match(new RegExp(`[^.\\n]{0,60}${VI_DIACRITIC.source}[^.\\n]{0,60}`, 'i'));
      leak.push(`EN has Vietnamese  ${it.id}: …${(m ? m[0] : '').trim()}…`);
    }

    const w = vi?.sections?.[si]?.items?.[ii];
    if (!w) return;
    const a = shape(it.a), b = shape(w.a);
    for (const k of Object.keys(a)) {
      if (a[k] !== b[k]) parity.push(`${it.id}: ${k} en=${a[k]} vi=${b[k]}`);
    }
    if (it.q === w.q && VI_DIACRITIC.test(it.q) === false && it.q.split(/\s+/).length > 6) {
      parity.push(`${it.id}: question identical in both languages`);
    }
    for (const m of prose(w.a).matchAll(EN_STRAY)) {
      const ctx = prose(w.a).slice(Math.max(0, m.index - 45), m.index + m[0].length + 45).replace(/\s+/g, ' ');
      leak.push(`VI has English     ${it.id} [${m[0]}]: …${ctx}…`);
    }
  }));
}

const head = (t) => console.log(`\n${'─'.repeat(64)}\n${t}\n${'─'.repeat(64)}`);

head('EN/VI parity');
console.log(parity.length ? parity.join('\n') : 'no drift — both languages carry the same structure');

head('language leakage');
console.log(leak.length ? leak.join('\n') : 'none (quoted terms of art may appear here legitimately)');

head('coverage by topic type');
for (const t of [...new Set(items.map(i => i.type))].filter(Boolean)) {
  const r = items.filter(i => i.type === t);
  const pct = (n) => `${String(n).padStart(3)} (${String(Math.round(n / r.length * 100)).padStart(2)}%)`;
  console.log(`${t.padEnd(13)} items=${String(r.length).padStart(3)}  code=${pct(r.filter(i => i.a.includes('<pre>')).length)}  table=${pct(r.filter(i => i.a.includes('<table')).length)}  figure=${pct(r.filter(i => i.a.includes('<figure')).length)}`);
}

if (flag('--gaps')) {
  head('items without code, table, or figure; longest visible prose first (example candidates)');
  items.filter(i => !hasExplanatoryEvidence(i.a))
    .map(i => ({ ...i, visibleWords: visibleWordCount(i.q + ' ' + i.a) }))
    .sort((x, y) => y.visibleWords - x.visibleWords)
    .slice(0, 40)
    .forEach(i => console.log(`  ${String(i.visibleWords).padStart(5)} words  ${i.difficulty.padEnd(5)} ${i.id}\n              ${i.q}`));
}

if (flag('--stale')) {
  /* Anything pinned to a version, a year, or a "latest/now" claim is what
     rots first. This does not know whether a fact is still true — it just
     puts every dated claim in one list so a review can be systematic. */
  head('version- and date-bound claims (review these when revisiting)');
  const YEAR = /\b(20[12]\d)\b/g;
  const VER = /\b(Java|Spring Boot|Spring|Postgres(?:QL)?|MySQL|Kafka|Redis|Mongo(?:DB)?|Kubernetes|K8s|Go|Hibernate|JDK)\s*v?(\d+(?:\.\d+)*)\b/gi;
  const FAST_MOVING = /\b(OAuth\s*2\.1|OWASP(?:\s+(?:API\s+Security\s+)?Top\s+10)?|OpenTelemetry|OTel|Resilience4j|HikariCP|async-profiler)\b/gi;
  const hits = [];
  for (const i of items) {
    const p = prose(i.q + ' ' + i.a);
    const found = new Set();
    for (const m of p.matchAll(VER)) found.add(`${m[1]} ${m[2]}`);
    for (const m of p.matchAll(FAST_MOVING)) found.add(m[1]);
    for (const m of p.matchAll(YEAR)) found.add(m[1]);
    if (found.size) hits.push({ id: i.id, what: [...found].join(' · ') });
  }
  hits.forEach(h => console.log(`  ${h.id}\n         ${h.what}`));
  console.log(`\n${hits.length} of ${items.length} items carry a version or year.`);
}

if (flag('--refs')) {
  head('non-canonical chapter references');
  const hits = [];
  for (const i of items) {
    const aliases = [...new Set([...(i.q + ' ' + i.a).matchAll(/\bch\.\d+\b/gi)].map(m => m[0]))];
    if (aliases.length) hits.push(`${i.id}: ${aliases.join(' · ')}`);
  }
  console.log(hits.length ? hits.map(hit => `  ${hit}`).join('\n') : 'none');
}

console.log('\nreminder: this tool reports, it never fails. Structural rules live in tools/validate-content.mjs.');
