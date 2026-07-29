/* Foreground load indicator.

   A folder is fetched 50 items at a time, so a large one runs to 130 sequential
   requests — around two minutes with nothing on screen but skeleton rows. There
   was no way to tell a slow fetch from a dead one.

   This owns the bar above the list: which page is in flight, how many items have
   arrived, and a Stop that actually cuts the loop short. The recursive crawl has
   its own overlay, so only single-folder loads come through here. */

import { $ } from './state.js';

/* A cached folder resolves in a few milliseconds. Showing the bar for that is a
   flash of grey that reads as a glitch, so nothing appears until a load has
   proved itself slow. */
const REVEAL_MS = 150;

let stopped = false;
let active = false;
let shown = false;
let revealTimer = null;

/** Passed to fetchAllPages as shouldStop, so Stop takes effect mid-chain. */
export const loadStopped = () => stopped;

export function startLoad(what) {
  stopped = false;
  active = true;
  pendingLabel = what || 'Loading…';
  clearTimeout(revealTimer);
  revealTimer = setTimeout(reveal, REVEAL_MS);
}

let pendingLabel = 'Loading…';

function reveal() {
  revealTimer = null;
  if (!active || shown) return;
  const wrap = $('loadBar');
  if (!wrap) return;
  shown = true;
  wrap.style.display = '';
  $('lbText').textContent = pendingLabel;
  $('lbStop').style.display = '';
  setFill(0);
}

/**
 * @param {number} page   the page that just arrived
 * @param {number} total  pages in this folder, known only after page 1
 * @param {number} files  items accumulated so far
 */
export function stepLoad(page, total, files) {
  if (!active) return;

  // One page is the common case; it finishes before REVEAL_MS and stays hidden.
  pendingLabel = total > 1
    ? 'Loading page ' + page + ' of ' + total + ' · ' + files + ' items so far'
    : 'Loading · ' + files + ' items';

  if (!shown) return;
  $('lbText').textContent = pendingLabel;
  setFill(total > 0 ? Math.round(page / total * 100) : 0);
}

export function endLoad(msg) {
  active = false;
  clearTimeout(revealTimer);
  revealTimer = null;

  const wrap = $('loadBar');
  if (!wrap) return;
  if (!msg) { shown = false; wrap.style.display = 'none'; return; }

  // Left visible to explain a short listing — stopped, or failed.
  shown = true;
  wrap.style.display = '';
  $('lbText').textContent = msg;
  $('lbStop').style.display = 'none';
  setFill(100);
}

function setFill(pct) {
  const fill = $('lbFill');
  const track = $('lbTrack');
  if (fill) fill.style.width = pct + '%';
  if (track) track.setAttribute('aria-valuenow', String(pct));
}

export function wireLoadBar() {
  const btn = $('lbStop');
  if (!btn) return;
  btn.addEventListener('click', () => {
    stopped = true;
    endLoad('Stopped — showing what had loaded');
  });
}
