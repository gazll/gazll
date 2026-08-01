#!/usr/bin/env node
/* Insert prose/code blocks or complete new items, from a patch file.

   Hand-editing data/topics/*.json is where mistakes happen: the answers are
   single JSON string lines thousands of characters long, and an editor will
   happily reformat the whole tree around your one change. This applies a
   patch instead, touching only the records it names.

     node tools/add-content.mjs patch.txt            # apply
     node tools/add-content.mjs patch.txt --dry-run  # show what would change

   Patch format — a header line, then literal content until the next header
   or EOF. Blank lines inside the content are preserved:

     @@ deep 05-db-core-index-lock.indexes-what-they-really-are.q4 en
     **`key_len` tells you how much of the index was really used:**
     <pre><code>...</code></pre>

     @@ deep 05-db-core-index-lock.indexes-what-they-really-are.q4 vi
     **`key_len` cho biết index thực sự dùng tới đâu:**
     <pre><code>...</code></pre>

   Modes decide where the block lands in the answer:
     deep  end of the :::deep block (the usual choice — senior detail)
     body  end of the main body, BEFORE the first ::: callout
     end   very end of the answer, after every callout
     answer    replace the complete answer for that item
     question  replace the complete question for that item
     replace   replace one exact answer fragment; separate old/new text with
               a line containing only "=>"
     item      append a new item; add difficulty to the header and prefix the
               first content line (the question) with "? "

     @@ item 03-spring-boot-deep-build.auto-configuration-build.q11 en extra
     ? Which platform generation should a new service target?
     Answer text starts here.

   Re-running is safe: a block already present is skipped, so a patch file can
   be applied twice without duplicating content. Always run
   tools/validate-content.mjs afterwards — this tool checks placement, not markup. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DIFFICULTIES } from '../public/lib/constants.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOPICS = ROOT + 'public/data/topics/';
const MODES = new Set(['deep', 'body', 'end', 'answer', 'question', 'replace', 'item']);
// Read from constants.js rather than repeating the literal set, so a future
// difficulty rename can't leave this parser accepting stale keys.
const DIFFICULTY_KEYS = new Set(DIFFICULTIES.map(d => d.key));
const DIFFICULTY_RE = DIFFICULTIES.map(d => d.key).join('|');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const patchPath = args.find(a => !a.startsWith('--'));
if (!patchPath) {
  console.error('usage: node tools/add-content.mjs <patch-file> [--dry-run]');
  process.exit(2);
}

/* ---------- parse the patch ---------- */
const blocks = [];
{
  const lines = readFileSync(patchPath, 'utf8').replace(/\r/g, '').split('\n');
  let cur = null;
  for (const line of lines) {
    const h = new RegExp(`^@@\\s+([\\w-]+)\\s+(\\S+)\\s+(en|vi)(?:\\s+(${DIFFICULTY_RE}))?\\s*$`).exec(line);
    if (h) {
      if (!MODES.has(h[1])) { console.error(`bad mode "${h[1]}" — use deep|body|end|answer|question|replace|item`); process.exit(2); }
      cur = { mode: h[1], id: h[2], lang: h[3], difficulty: h[4], lines: [] };
      blocks.push(cur);
      continue;
    }
    if (cur) cur.lines.push(line);
    else if (line.trim()) { console.error(`content before the first @@ header: ${line.slice(0, 60)}`); process.exit(2); }
  }
}
if (!blocks.length) { console.error('patch file has no @@ blocks'); process.exit(2); }
for (const b of blocks) {
  b.text = b.lines.join('\n').trim();
  if (!b.text) { console.error(`empty block for ${b.id} (${b.lang})`); process.exit(2); }
  if (b.mode === 'item') {
    if (!b.difficulty) {
      console.error(`item ${b.id} (${b.lang}) needs difficulty ${DIFFICULTY_RE} in its header`);
      process.exit(2);
    }
    if (!DIFFICULTY_KEYS.has(b.difficulty)) {
      console.error(`item ${b.id} (${b.lang}): "${b.difficulty}" is not a known difficulty (${[...DIFFICULTY_KEYS].join('|')})`);
      process.exit(2);
    }
    const [questionLine, ...answerLines] = b.text.split('\n');
    if (!questionLine.startsWith('? ') || questionLine.length === 2) {
      console.error(`item ${b.id} (${b.lang}) must start with one question line prefixed by "? "`);
      process.exit(2);
    }
    const answer = answerLines.join('\n').trim();
    if (!answer) {
      console.error(`item ${b.id} (${b.lang}) needs an answer after its question`);
      process.exit(2);
    }
    b.item = { id: b.id, difficulty: b.difficulty, q: questionLine.slice(2), a: answer };
  } else if (b.difficulty) {
    console.error(`difficulty is only valid for mode "item": ${b.id} (${b.lang})`);
    process.exit(2);
  }
  if (b.mode === 'replace') {
    const fragments = b.text.split('\n=>\n');
    if (fragments.length !== 2 || !fragments[0].trim() || !fragments[1].trim()) {
      console.error(`replace for ${b.id} (${b.lang}) needs non-empty old/new fragments separated by one "=>" line`);
      process.exit(2);
    }
    b.from = fragments[0].trim();
    b.to = fragments[1].trim();
  }
  if (b.mode === 'question' && b.text.includes('\n')) {
    console.error(`question for ${b.id} (${b.lang}) must be one line`);
    process.exit(2);
  }
}

/* A topic's file stem is the item id's first segment, so the patch never has
   to name a file — one less thing to get out of sync with the manifest. */
const fileOf = (id, lang) => `${TOPICS}${id.split('.')[0]}${lang === 'vi' ? '.vi' : ''}.json`;

function place(answer, mode, block) {
  if (mode === 'end') return answer.trimEnd() + '\n\n' + block;
  if (mode === 'deep') {
    // The :::deep block is closed by the answer's last ':::' on its own line.
    const i = answer.lastIndexOf('\n:::');
    if (i < 0) throw new Error('no :::deep block to append to — use mode "end"');
    return answer.slice(0, i) + '\n' + block + '\n' + answer.slice(i + 1);
  }
  // body: before the first callout, or at the end when there is none.
  const m = /^:::(deep|tip|warn)/m.exec(answer);
  if (!m) return answer.trimEnd() + '\n\n' + block;
  return answer.slice(0, m.index).trimEnd() + '\n\n' + block + '\n\n' + answer.slice(m.index);
}

/* ---------- apply, one file at a time ---------- */
const docs = new Map();       // path -> parsed json
const touched = new Set();
let applied = 0, skipped = 0;

for (const b of blocks) {
  const path = fileOf(b.id, b.lang);
  if (!docs.has(path)) {
    try { docs.set(path, JSON.parse(readFileSync(path, 'utf8'))); }
    catch (e) { console.error(`cannot read ${path}: ${e.message}`); process.exit(1); }
  }
  const doc = docs.get(path);

  if (b.mode === 'item') {
    const existing = (doc.sections || []).flatMap(sec => sec.items || []).find(it => it.id === b.id);
    if (existing) {
      const fieldsMatch = ['id', 'difficulty', 'q', 'a'].every(field => existing[field] === b.item[field]);
      if (!fieldsMatch) {
        console.error(`item "${b.id}" already exists with different content; use answer/question mode for an intentional replacement`);
        process.exit(1);
      }
      console.log(`skip  ${b.id} (${b.lang}) — item already matches`);
      skipped++;
      continue;
    }

    const idMatch = /^(.*\.[^.]+)\.q(\d+)$/.exec(b.id);
    if (!idMatch) {
      console.error(`item id "${b.id}" must end in .q<number>`);
      process.exit(1);
    }
    const sectionPrefix = idMatch[1] + '.';
    const section = (doc.sections || []).find(sec =>
      (sec.items || []).some(it => it.id.startsWith(sectionPrefix))
    );
    if (!section) {
      console.error(`cannot infer a section for new item "${b.id}"`);
      process.exit(1);
    }
    const existingNumbers = section.items
      .filter(it => it.id.startsWith(sectionPrefix))
      .map(it => /^q(\d+)$/.exec(it.id.slice(sectionPrefix.length)))
      .filter(Boolean)
      .map(match => Number(match[1]));
    const nextNumber = Number(idMatch[2]);
    const maxNumber = Math.max(0, ...existingNumbers);
    if (nextNumber <= maxNumber) {
      console.error(`new item "${b.id}" must append after q${maxNumber}`);
      process.exit(1);
    }

    section.items.push(b.item);
    console.log(`apply ${b.id} (${b.lang}) mode=item ${b.item.a.length}c`);
    applied++;
    touched.add(path);
    continue;
  }

  let hits = 0;
  for (const sec of doc.sections || []) {
    for (const it of sec.items || []) {
      if (it.id !== b.id) continue;
      hits++;
      if (b.mode === 'replace') {
        const first = it.a.indexOf(b.from);
        if (first < 0) {
          if (it.a.includes(b.to)) {
            console.log(`skip  ${b.id} (${b.lang}) — replacement already present`);
            skipped++;
            continue;
          }
          console.error(`old fragment not found in ${b.id} (${b.lang})`);
          process.exit(1);
        }
        if (it.a.indexOf(b.from, first + b.from.length) >= 0) {
          console.error(`old fragment is not unique in ${b.id} (${b.lang})`);
          process.exit(1);
        }
        it.a = it.a.slice(0, first) + b.to + it.a.slice(first + b.from.length);
        console.log(`apply ${b.id} (${b.lang}) mode=replace ${b.from.length}c→${b.to.length}c`);
        applied++;
        touched.add(path);
        continue;
      }
      if (b.mode === 'answer' || b.mode === 'question') {
        const field = b.mode === 'answer' ? 'a' : 'q';
        if (it[field] === b.text) {
          console.log(`skip  ${b.id} (${b.lang}) — ${field} already matches`);
          skipped++;
          continue;
        }
        it[field] = b.text;
        console.log(`apply ${b.id} (${b.lang}) mode=${b.mode} ${b.text.length}c`);
        applied++;
        touched.add(path);
        continue;
      }
      // Idempotency probe: the block's first line is distinctive enough, and
      // cheaper than diffing the whole answer.
      const probe = b.text.split('\n')[0];
      if (it.a.includes(probe)) { console.log(`skip  ${b.id} (${b.lang}) — already present`); skipped++; continue; }
      try { it.a = place(it.a, b.mode, b.text); }
      catch (e) { console.error(`${b.id} (${b.lang}): ${e.message}`); process.exit(1); }
      console.log(`apply ${b.id} (${b.lang}) mode=${b.mode} +${b.text.length}c`);
      applied++;
      touched.add(path);
    }
  }
  if (hits === 0) { console.error(`no item with id "${b.id}" in ${path}`); process.exit(1); }
  if (hits > 1) { console.error(`id "${b.id}" appears ${hits} times in ${path}`); process.exit(1); }
}

/* Warn on a one-sided edit: the two languages must stay in lockstep, and the
   validator only checks counts/ids, not that both got the same new block. */
for (const b of blocks) {
  const twin = blocks.some(o => o.id === b.id && o.mode === b.mode && o.lang !== b.lang);
  if (!twin) console.warn(`WARN  ${b.id}: only "${b.lang}" is patched — the other language will drift`);
}

if (dryRun) { console.log(`\ndry run — ${applied} would apply, ${skipped} already present`); process.exit(0); }

for (const path of touched) {
  // 2-space + trailing newline is the tree's existing formatting; anything
  // else turns a one-line change into a whole-file diff.
  writeFileSync(path, JSON.stringify(docs.get(path), null, 2) + '\n');
}
console.log(`\n${applied} block(s) applied, ${skipped} skipped, ${touched.size} file(s) written`);
console.log('next: node tools/validate-content.mjs --stats');
