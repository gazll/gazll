#!/usr/bin/env node
/* Insert prose/code blocks into existing items, from a patch file.

   Hand-editing data/topics/*.json is where mistakes happen: the answers are
   single JSON string lines thousands of characters long, and an editor will
   happily reformat the whole tree around your one change. This applies a
   patch instead, touching only the `a` strings it names.

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

   Re-running is safe: a block already present is skipped, so a patch file can
   be applied twice without duplicating content. Always run
   tools/validate-content.mjs afterwards — this tool checks placement, not markup. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TOPICS = ROOT + 'public/data/topics/';
const MODES = new Set(['deep', 'body', 'end', 'answer', 'question']);

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
    const h = /^@@\s+([\w-]+)\s+(\S+)\s+(en|vi)\s*$/.exec(line);
    if (h) {
      if (!MODES.has(h[1])) { console.error(`bad mode "${h[1]}" — use deep|body|end|answer|question`); process.exit(2); }
      cur = { mode: h[1], id: h[2], lang: h[3], lines: [] };
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

  let hits = 0;
  for (const sec of doc.sections || []) {
    for (const it of sec.items || []) {
      if (it.id !== b.id) continue;
      hits++;
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
