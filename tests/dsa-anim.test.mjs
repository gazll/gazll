/* The DSA step animations: data contract and frame rendering.

   The player itself needs a DOM, and this project has no test DOM library, so
   what is pinned here is everything that can go wrong without one: the frame
   schema, both languages' captions, the SVG the renderer emits, and the link
   between an item's placeholder and an animation that actually exists.

   lib/dsa-anim.js is deliberately pure — no DOM, no fetch — precisely so this
   can run in plain Node. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const pub = path.join(root, 'public');

const { renderFrame, frameExtent, validateAnimation, CELL } =
  await import(pathToFileURL(path.join(pub, 'lib/dsa-anim.js')).href);

const DATA = JSON.parse(await readFile(path.join(pub, 'data/dsa-animations.json'), 'utf8'));
const ANIMS = Object.entries(DATA.animations || {});
const LANGS = ['en', 'vi'];

const captionsOf = (anim, lang) => anim[lang]?.notes || {};
const captionAt = (anim, lang, i) =>
  captionsOf(anim, lang)[i] ?? captionsOf(anim, lang)[String(i)] ?? anim.frames[i]?.note;

test('there are animations, and every one passes its own schema check', () => {
  assert.ok(ANIMS.length >= 15, `only ${ANIMS.length} animations`);
  for (const [id, anim] of ANIMS) {
    assert.deepEqual(validateAnimation(anim, id), [], id);
  }
});

test('every frame has a caption in both languages, and they differ', () => {
  for (const [id, anim] of ANIMS) {
    anim.frames.forEach((f, i) => {
      for (const lang of LANGS) {
        const note = captionAt(anim, lang, i);
        assert.ok(String(note || '').trim(), `${id}#${i}: no ${lang} caption`);
      }
      // A VI caption identical to EN means the translation was never written.
      assert.notEqual(captionAt(anim, 'vi', i), captionAt(anim, 'en', i),
        `${id}#${i}: vi caption is a copy of en`);
    });
  }
});

test('pointers and spans stay inside their row, and cell states are known', () => {
  const states = new Set(Object.values(CELL));
  for (const [id, anim] of ANIMS) {
    anim.frames.forEach((f, i) => {
      for (const row of f.rows || []) {
        const n = (row.cells || []).length;
        for (const p of row.pointers || []) {
          assert.ok(p.at >= 0 && p.at < n, `${id}#${i}: pointer ${p.label} at ${p.at}, row has ${n}`);
        }
        if (row.span?.from != null) {
          assert.ok(row.span.from >= 0 && row.span.to < n && row.span.from <= row.span.to,
            `${id}#${i}: span ${row.span.from}..${row.span.to} outside 0..${n - 1}`);
        }
        for (const c of row.cells || []) {
          if (c.state) assert.ok(states.has(c.state), `${id}#${i}: state "${c.state}"`);
        }
      }
    });
  }
});

test('every frame renders to balanced SVG with no undefined leaking through', () => {
  for (const [id, anim] of ANIMS) {
    const extent = frameExtent(anim.frames);
    assert.ok(extent.w > 0 && extent.h > 0, id);
    for (const lang of LANGS) {
      anim.frames.forEach((f, i) => {
        const html = renderFrame({ ...f, note: captionAt(anim, lang, i) });
        assert.ok(html.trim(), `${id}#${i} ${lang}: rendered empty`);
        const open = (html.match(/<g[\s>]/g) || []).length;
        const close = (html.match(/<\/g>/g) || []).length;
        assert.equal(open, close, `${id}#${i} ${lang}: ${open} <g> vs ${close} </g>`);
        assert.equal(/undefined|NaN|\[object/.test(html), false, `${id}#${i} ${lang}: bad value in output`);
      });
    }
  }
});

test('the extent covers every frame, so the viewBox never jumps mid-playback', () => {
  for (const [id, anim] of ANIMS) {
    const extent = frameExtent(anim.frames);
    for (const f of anim.frames) {
      const solo = frameExtent([f]);
      assert.ok(solo.w <= extent.w, `${id}: a frame is wider than the shared extent`);
      assert.ok(solo.h <= extent.h, `${id}: a frame is taller than the shared extent`);
    }
  }
});

test('renderFrame escapes values rather than trusting them', () => {
  const html = renderFrame({
    rows: [{
      cells: [{ v: '<script>x</script>' }, { v: 'a & b', caption: '"q"' }],
      pointers: [{ at: 0, label: '<b>' }],
      span: { from: 0, to: 1, label: '<i>' }
    }]
  });
  assert.equal(/<script|<b>|<i>/.test(html), false, 'raw markup survived into the SVG');
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('a &amp; b'));
});

test('the caption is not drawn inside the SVG — <text> cannot wrap', () => {
  const long = 'x'.repeat(220);
  const html = renderFrame({ rows: [{ cells: [{ v: 1 }] }], note: long });
  assert.equal(html.includes(long), false, 'a long caption would overflow the viewBox');
});

test('captions carry no callout or colour syntax — the player prints them as text', () => {
  for (const [id, anim] of ANIMS) {
    for (const lang of LANGS) {
      anim.frames.forEach((f, i) => {
        const note = String(captionAt(anim, lang, i));
        assert.equal(/:::|\[\[[a-z]:/.test(note), false, `${id}#${i} ${lang}: markdown syntax in a caption`);
      });
    }
  }
});

test('every placeholder in topic 19 names a real animation, in both languages', async () => {
  const ids = new Set(Object.keys(DATA.animations || {}));
  const used = new Set();
  for (const stem of ['19-dsa-leetcode', '19-dsa-leetcode.vi']) {
    const topic = JSON.parse(await readFile(path.join(pub, `data/topics/${stem}.json`), 'utf8'));
    const items = topic.sections.flatMap(s => s.items)
      .filter(it => it.id.includes('fifteen-patterns-visualized'));
    assert.equal(items.length, 15, `${stem}: ${items.length} pattern items`);
    for (const it of items) {
      const m = /data-dsa='([a-z0-9-]+)'/.exec(it.a);
      assert.ok(m, `${stem}: ${it.id} has no animation placeholder`);
      assert.ok(ids.has(m[1]), `${stem}: ${it.id} names unknown animation "${m[1]}"`);
      used.add(m[1]);
      // The static trace was replaced, not kept alongside — no duplicate SVG.
      assert.equal(/<svg/.test(it.a), false, `${stem}: ${it.id} still carries a static SVG`);
    }
  }
  assert.equal(used.size, 15, `${used.size} distinct animations referenced, expected 15`);
});

test('an item and its Vietnamese twin point at the same animation', async () => {
  const read = async (stem) => {
    const topic = JSON.parse(await readFile(path.join(pub, `data/topics/${stem}.json`), 'utf8'));
    return new Map(topic.sections.flatMap(s => s.items)
      .filter(it => it.id.includes('fifteen-patterns-visualized'))
      .map(it => [it.id, (/data-dsa='([a-z0-9-]+)'/.exec(it.a) || [])[1]]));
  };
  const en = await read('19-dsa-leetcode');
  const vi = await read('19-dsa-leetcode.vi');
  for (const [id, anim] of en) {
    assert.equal(vi.get(id), anim, `${id}: en uses "${anim}", vi uses "${vi.get(id)}"`);
  }
});
