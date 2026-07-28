/* Virtual list.

   A fully expanded tree is ~900 rows and a 1000-row page is worse; building
   that many DOM nodes is what makes the list feel sluggish, and every repaint
   pays for it again. This renders only the slice inside the viewport plus a
   small overscan, so cost is bound by screen height rather than item count.

   It needs a fixed row height to map scrollTop onto an index, which is why the
   stylesheet pins rows to ROW_HEIGHT and ellipsises long names instead of
   letting them wrap. Below VIRTUAL_THRESHOLD items everything is rendered
   directly, so short folders keep the simpler behaviour. */

import { ROW_HEIGHT, VIRTUAL_THRESHOLD } from './state.js';

const OVERSCAN = 6;

/* Read from CSS rather than assumed, so the compact-density toggle cannot get
   out of step with the maths — a mismatch here misplaces every row. */
function rowHeight() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--row-h');
  const n = parseInt(v, 10);
  return n > 0 ? n : ROW_HEIGHT;
}

/**
 * @param {HTMLElement} viewport  scrollable element, must have a bounded height
 * @param {(item:any, index:number) => HTMLElement} renderRow
 */
export function createVList(viewport, renderRow) {
  let items = [];
  let sizer = null;
  let windowEl = null;
  let lastStart = -1;
  let lastEnd = -1;
  let virtual = false;
  let rowH = ROW_HEIGHT;

  function teardown() {
    viewport.removeEventListener('scroll', onScroll);
    viewport.innerHTML = '';
    sizer = windowEl = null;
    lastStart = lastEnd = -1;
  }

  function renderPlain() {
    virtual = false;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < items.length; i++) frag.appendChild(renderRow(items[i], i));
    viewport.innerHTML = '';
    viewport.appendChild(frag);
  }

  function buildScaffold() {
    virtual = true;
    viewport.innerHTML = '';
    sizer = document.createElement('div');
    sizer.className = 'vl-sizer';
    sizer.style.height = items.length * rowH + 'px';
    windowEl = document.createElement('div');
    windowEl.className = 'vl-window';
    sizer.appendChild(windowEl);
    viewport.appendChild(sizer);
    viewport.addEventListener('scroll', onScroll, { passive: true });
  }

  function paint(force) {
    const h = viewport.clientHeight || 600;
    const first = Math.max(0, Math.floor(viewport.scrollTop / rowH) - OVERSCAN);
    const count = Math.ceil(h / rowH) + OVERSCAN * 2;
    const last = Math.min(items.length, first + count);

    // Scrolling within the already-rendered slice needs no DOM work at all.
    if (!force && first === lastStart && last === lastEnd) return;
    lastStart = first;
    lastEnd = last;

    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) frag.appendChild(renderRow(items[i], i));
    windowEl.style.transform = 'translateY(' + first * rowH + 'px)';
    windowEl.innerHTML = '';
    windowEl.appendChild(frag);
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; paint(false); });
  }

  return {
    /**
     * Rebuilding wipes innerHTML, which zeroes scrollTop — so expanding a
     * folder 600 rows down would throw you back to the top. Callers that are
     * re-rendering the same list keep the offset; navigation resets it.
     */
    setItems(next, opts) {
      const keep = !(opts && opts.resetScroll);
      const prevTop = keep ? viewport.scrollTop : 0;

      items = next || [];
      rowH = rowHeight();          // re-read: density may have changed
      teardown();
      if (!items.length) return;

      if (items.length < VIRTUAL_THRESHOLD) renderPlain();
      else { buildScaffold(); paint(true); }

      if (prevTop) {
        const max = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
        viewport.scrollTop = Math.min(prevTop, max);
        if (virtual) paint(true);
      }
    },

    /** Repaint the visible slice in place, e.g. after a selection change. */
    refresh() {
      if (!items.length) return;
      if (!virtual) { renderPlain(); return; }
      paint(true);
    },

    get virtual() { return virtual; },
    get count() { return items.length; },
    destroy: teardown
  };
}

/**
 * Same idea for a <table>. A tbody cannot hold arbitrary wrappers, so the
 * offset is carried by two spacer rows instead of a transform.
 *
 * @param {HTMLElement} scroller  the scrollable ancestor (.table-wrap)
 * @param {HTMLElement} tbody
 * @param {(item:any, index:number) => HTMLTableRowElement} renderRow
 */
export function createVTable(scroller, tbody, renderRow) {
  let items = [];
  let virtual = false;
  let rowH = ROW_HEIGHT;
  let lastStart = -1, lastEnd = -1;
  const top = document.createElement('tr');
  const bot = document.createElement('tr');
  top.className = bot.className = 'vt-spacer';
  top.setAttribute('aria-hidden', 'true');
  bot.setAttribute('aria-hidden', 'true');

  function renderPlain() {
    virtual = false;
    scroller.removeEventListener('scroll', onScroll);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < items.length; i++) frag.appendChild(renderRow(items[i], i));
    tbody.innerHTML = '';
    tbody.appendChild(frag);
  }

  function paint(force) {
    const h = scroller.clientHeight || 600;
    const first = Math.max(0, Math.floor(scroller.scrollTop / rowH) - OVERSCAN);
    const count = Math.ceil(h / rowH) + OVERSCAN * 2;
    const last = Math.min(items.length, first + count);
    if (!force && first === lastStart && last === lastEnd) return;
    lastStart = first;
    lastEnd = last;

    const frag = document.createDocumentFragment();
    top.style.height = first * rowH + 'px';
    frag.appendChild(top);
    for (let i = first; i < last; i++) frag.appendChild(renderRow(items[i], i));
    bot.style.height = Math.max(0, (items.length - last) * rowH) + 'px';
    frag.appendChild(bot);

    tbody.innerHTML = '';
    tbody.appendChild(frag);
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; paint(false); });
  }

  return {
    setItems(next) {
      items = next || [];
      rowH = rowHeight();
      lastStart = lastEnd = -1;
      scroller.removeEventListener('scroll', onScroll);
      tbody.innerHTML = '';
      if (!items.length) return;

      if (items.length < VIRTUAL_THRESHOLD) { renderPlain(); return; }
      virtual = true;
      scroller.scrollTop = 0;
      scroller.addEventListener('scroll', onScroll, { passive: true });
      paint(true);
    },
    refresh() {
      if (!items.length) return;
      if (!virtual) renderPlain(); else paint(true);
    },
    get virtual() { return virtual; }
  };
}
