/* Step-player for the DSA patterns — the data model and the frame renderer.

   Why data and not 15 hand-drawn animations: every pattern in topic 19 shows
   the same handful of visual primitives (a row of cells, pointers under it, a
   window bracket, a stack, a tree, a grid, a table). Describing each step as
   data means one renderer to maintain and one keyboard/reduced-motion story,
   and a new pattern costs a JSON entry rather than a new SVG.

   A frame is a snapshot, not a delta: it carries the whole visual state. That
   makes scrubbing to any step O(1) and stops the drift you get from replaying
   deltas. `note` is the caption; `caption` on a cell is its per-cell label. */

/** Cell states, in priority order — the last one set wins for the fill. */
export const CELL = Object.freeze({
  IDLE: 'idle',        // untouched
  ACTIVE: 'active',    // being compared/read right now
  DONE: 'done',        // resolved, kept
  DROPPED: 'dropped',  // eliminated from consideration
  WINDOW: 'window'     // inside the current window
});

export const MAX_STEP_MS = 4000;
export const MIN_STEP_MS = 200;
export const DEFAULT_STEP_MS = 1100;

/* Geometry is fixed so every pattern lines up in the same column grid; the
   SVG scales with the card via viewBox + width:100%. */
const GEO = Object.freeze({
  cell: 44, gap: 6, rowH: 56, padX: 14, padY: 12,
  labelH: 18, stackW: 54, stackH: 26
});

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const cellX = (i) => GEO.padX + i * (GEO.cell + GEO.gap);
const rowWidth = (n) => GEO.padX * 2 + n * GEO.cell + Math.max(0, n - 1) * GEO.gap;

/* ---------- primitives ---------- */

function drawCells(row, y) {
  const cells = row.cells || [];
  let out = '';
  cells.forEach((c, i) => {
    const state = c.state || CELL.IDLE;
    const x = cellX(i);
    out += '<g class="da-cell da-s-' + esc(state) + '">'
      + '<rect x="' + x + '" y="' + y + '" width="' + GEO.cell + '" height="' + (GEO.cell - 8) + '" rx="5"/>'
      + '<text class="da-val" x="' + (x + GEO.cell / 2) + '" y="' + (y + GEO.cell / 2 - 1) + '">'
      + esc(c.v) + '</text>'
      + '</g>';
    if (c.caption) {
      out += '<text class="da-cap" x="' + (x + GEO.cell / 2) + '" y="' + (y + GEO.cell + 6) + '">'
        + esc(c.caption) + '</text>';
    }
  });
  return out;
}

/* Pointers sit under their cell. Several on one index stack horizontally so
   L and R landing together stay readable. */
function drawPointers(row, y) {
  const ptrs = row.pointers || [];
  const byIndex = new Map();
  for (const p of ptrs) {
    if (!byIndex.has(p.at)) byIndex.set(p.at, []);
    byIndex.get(p.at).push(p);
  }
  let out = '';
  for (const [at, group] of byIndex) {
    const cx = cellX(at) + GEO.cell / 2;
    const span = (group.length - 1) * 20;
    group.forEach((p, k) => {
      const x = cx - span / 2 + k * 20;
      out += '<g class="da-ptr' + (p.tone ? ' da-t-' + esc(p.tone) : '') + '">'
        + '<path d="M' + x + ' ' + (y + 12) + ' L' + x + ' ' + (y + 2) + '"/>'
        + '<text x="' + x + '" y="' + (y + 26) + '">' + esc(p.label) + '</text>'
        + '</g>';
    });
  }
  return out;
}

/** A bracket spanning [from..to], used for windows and merged intervals. */
function drawSpan(span, y) {
  if (!span || span.from == null) return '';
  const x1 = cellX(span.from) - 3;
  const x2 = cellX(span.to) + GEO.cell + 3;
  return '<g class="da-span' + (span.tone ? ' da-t-' + esc(span.tone) : '') + '">'
    + '<rect x="' + x1 + '" y="' + (y - 5) + '" width="' + (x2 - x1) + '" height="' + (GEO.cell + 2) + '" rx="7"/>'
    + (span.label
      ? '<text x="' + ((x1 + x2) / 2) + '" y="' + (y - 10) + '">' + esc(span.label) + '</text>'
      : '')
    + '</g>';
}

/** A stack drawn bottom-up, so index 0 is the bottom like the real thing. */
function drawStack(stack, x, baseY) {
  if (!stack) return '';
  const items = stack.items || [];
  let out = '<text class="da-lbl" x="' + (x + GEO.stackW / 2) + '" y="' + (baseY + 16) + '">'
    + esc(stack.label || 'stack') + '</text>';
  items.forEach((it, i) => {
    const y = baseY - (i + 1) * (GEO.stackH + 4);
    out += '<g class="da-cell da-s-' + esc(it.state || CELL.ACTIVE) + '">'
      + '<rect x="' + x + '" y="' + y + '" width="' + GEO.stackW + '" height="' + GEO.stackH + '" rx="4"/>'
      + '<text class="da-val" x="' + (x + GEO.stackW / 2) + '" y="' + (y + GEO.stackH / 2 + 4) + '">'
      + esc(it.v) + '</text></g>';
  });
  if (items.length) {
    const topY = baseY - items.length * (GEO.stackH + 4);
    out += '<text class="da-cap" x="' + (x - 8) + '" y="' + (topY + GEO.stackH / 2 + 4) + '" '
      + 'text-anchor="end">top</text>';
  }
  return out;
}

/** A grid of rows × cols, for matrix and DP frames. */
function drawGrid(grid, y) {
  if (!grid) return '';
  const rows = grid.rows || [];
  const w = 46, h = 34;
  let out = '';
  rows.forEach((row, r) => {
    row.forEach((c, k) => {
      const cell = (c && typeof c === 'object') ? c : { v: c };
      const x = GEO.padX + k * (w + 4);
      const yy = y + r * (h + 4);
      out += '<g class="da-cell da-s-' + esc(cell.state || CELL.IDLE) + '">'
        + '<rect x="' + x + '" y="' + yy + '" width="' + w + '" height="' + h + '" rx="4"/>'
        + '<text class="da-val" x="' + (x + w / 2) + '" y="' + (yy + h / 2 + 4) + '">'
        + esc(cell.v) + '</text></g>';
    });
  });
  return out;
}

/** Nodes at explicit coordinates + edges by id — trees and graphs. */
function drawNodes(shape, y) {
  if (!shape) return '';
  const nodes = shape.nodes || [];
  const byId = new Map(nodes.map(n => [n.id, n]));
  let out = '';
  for (const [a, b] of shape.edges || []) {
    const p = byId.get(a), q = byId.get(b);
    if (!p || !q) continue;
    out += '<line class="da-edge" x1="' + p.x + '" y1="' + (p.y + y) + '" x2="' + q.x
      + '" y2="' + (q.y + y) + '"/>';
  }
  for (const n of nodes) {
    out += '<g class="da-node da-s-' + esc(n.state || CELL.IDLE) + '">'
      + '<circle cx="' + n.x + '" cy="' + (n.y + y) + '" r="15"/>'
      + '<text class="da-val" x="' + n.x + '" y="' + (n.y + y + 4) + '">' + esc(n.v) + '</text></g>';
  }
  return out;
}

/* ---------- frame ---------- */

/** Widest thing in the animation decides the viewBox, so frames never jump. */
export function frameExtent(frames) {
  let w = 320, h = 120;
  for (const f of frames || []) {
    for (const row of f.rows || []) w = Math.max(w, rowWidth((row.cells || []).length));
    if (f.stack) w = Math.max(w, rowWidth(6) + GEO.stackW + 40);
    if (f.grid) {
      w = Math.max(w, GEO.padX * 2 + (f.grid.rows?.[0]?.length || 0) * 50);
      h = Math.max(h, 90 + (f.grid.rows?.length || 0) * 38);
    }
    if (f.shape) {
      for (const n of f.shape.nodes || []) { w = Math.max(w, n.x + 40); h = Math.max(h, n.y + 150); }
    }
    const rowCount = (f.rows || []).length;
    // No noteH: the caption lives in HTML beside the stage, not in the viewBox.
    h = Math.max(h, GEO.padY * 2 + rowCount * GEO.rowH + (f.stack ? 120 : 20));
  }
  return { w, h };
}

/* One frame -> SVG inner markup. Pure: no DOM, so it is testable in Node.
   The caption is not part of the drawing — see the note at the end. */
export function renderFrame(frame) {
  if (!frame) return '';
  let y = GEO.padY + 8;
  let out = '';

  if (frame.title) {
    out += '<text class="da-title" x="' + GEO.padX + '" y="' + y + '">' + esc(frame.title) + '</text>';
    y += 20;
  }

  for (const row of frame.rows || []) {
    if (row.label) {
      out += '<text class="da-lbl" x="' + GEO.padX + '" y="' + (y - 4) + '">' + esc(row.label) + '</text>';
      y += 10;
    }
    out += drawSpan(row.span, y);
    out += drawCells(row, y);
    out += drawPointers(row, y + GEO.cell - 8);
    y += GEO.rowH + (row.pointers?.length ? 14 : 0);
  }

  if (frame.grid) { out += drawGrid(frame.grid, y); y += (frame.grid.rows?.length || 0) * 38 + 12; }
  if (frame.shape) { out += drawNodes(frame.shape, y); y += 150; }
  if (frame.stack) {
    const baseY = y + 100;
    out += '<line class="da-base" x1="' + GEO.padX + '" y1="' + baseY + '" x2="'
      + (GEO.padX + GEO.stackW + 20) + '" y2="' + baseY + '"/>';
    out += drawStack(frame.stack, GEO.padX + 8, baseY);
    y = baseY + 24;
  }

  // The caption is deliberately NOT drawn here: SVG <text> does not wrap, so a
  // 200-character note would run off the viewBox. The player prints it in an
  // HTML <figcaption> beside the stage, which wraps and is selectable.
  return out;
}

/* Shape check with a real message — bad frame data should say what is wrong.
   Captions are per language (`en.notes[i]` / `vi.notes[i]`) because the frames
   are shared, so a step is captioned if either the language map or the frame
   itself supplies one. */
export function validateAnimation(anim, id) {
  const errs = [];
  const where = id || anim?.id || '(anonymous)';
  if (!anim || typeof anim !== 'object') return [`${where}: not an object`];
  if (!Array.isArray(anim.frames) || !anim.frames.length) errs.push(`${where}: no frames`);
  for (const lang of ['en', 'vi']) {
    if (!anim[lang] || typeof anim[lang].notes !== 'object') {
      errs.push(`${where}: missing "${lang}.notes"`);
    }
  }
  (anim.frames || []).forEach((f, i) => {
    const at = `${where}#${i}`;
    if (!f || typeof f !== 'object') { errs.push(`${at}: not an object`); return; }
    for (const lang of ['en', 'vi']) {
      const note = anim[lang]?.notes?.[i] ?? anim[lang]?.notes?.[String(i)] ?? f.note;
      if (!String(note || '').trim()) errs.push(`${at}: no ${lang} caption`);
    }
    for (const row of f.rows || []) {
      const n = (row.cells || []).length;
      for (const p of row.pointers || []) {
        if (!Number.isInteger(p.at) || p.at < 0 || p.at >= n) {
          errs.push(`${at}: pointer "${p.label}" at ${p.at} is outside 0..${n - 1}`);
        }
        if (!p.label) errs.push(`${at}: a pointer has no label`);
      }
      if (row.span && row.span.from != null) {
        const { from, to } = row.span;
        if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to < n && from <= to)) {
          errs.push(`${at}: span ${from}..${to} is outside 0..${n - 1}`);
        }
      }
      for (const c of row.cells || []) {
        if (c.state && !Object.values(CELL).includes(c.state)) {
          errs.push(`${at}: unknown cell state "${c.state}"`);
        }
      }
    }
    for (const n2 of f.shape?.nodes || []) {
      if (!Number.isFinite(n2.x) || !Number.isFinite(n2.y)) errs.push(`${at}: node "${n2.id}" has no coordinates`);
    }
  });
  return errs;
}
