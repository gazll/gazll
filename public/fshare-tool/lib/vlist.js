/* Virtual list.

   A fully expanded tree is ~900 rows and a 1000-row page is worse; building
   that many DOM nodes is what makes the list feel sluggish, and every repaint
   pays for it again. This renders only the slice inside the viewport plus a
   small overscan, so cost is bound by screen height rather than item count.

   The *page* is the scroll container. An inner scroll box nested in a page that
   also scrolls is disorienting — two scrollbars, and the list never shows how
   long it really is. So the viewport is the window, and how far the list has
   passed the top of the screen decides which slice is live.

   It needs a fixed row height to map that offset onto an index, which is why
   the stylesheet pins rows to --row-h and ellipsises long names instead of
   letting them wrap. Below VIRTUAL_THRESHOLD items everything is rendered
   directly, so short folders keep the simpler behaviour. */

import { ROW_HEIGHT, VIRTUAL_THRESHOLD } from './state.js';

const OVERSCAN = 8;

/* Read from CSS rather than assumed, so the density toggle cannot get out of
   step with the maths — a mismatch here misplaces every row. */
function cssRowHeight() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--row-h');
  const n = parseInt(v, 10);
  return n > 0 ? n : ROW_HEIGHT;
}

/**
 * Which rows to render, given how far `el` has scrolled past the top of the
 * window. `el` is the element whose first child is row 0.
 */
function sliceFor(el, total, rowH) {
  const passed = Math.max(0, -el.getBoundingClientRect().top);
  const first = Math.max(0, Math.floor(passed / rowH) - OVERSCAN);
  const count = Math.ceil(window.innerHeight / rowH) + OVERSCAN * 2;
  return [first, Math.min(total, first + count)];
}

/**
 * Trust the DOM over the stylesheet. If a row really renders taller than
 * --row-h claims, every row past the first screen is misplaced and the list
 * jitters as you scroll. Measuring one real row costs a single layout read and
 * removes the whole class of bug.
 *
 * @returns {number} the corrected height, or 0 when the CSS was right
 */
function calibrate(sample, rowH) {
  if (!sample) return 0;
  const h = sample.offsetHeight;
  return h > 0 && Math.abs(h - rowH) > 1 ? h : 0;
}

/**
 * @param {HTMLElement} container  holds the rows; grows with the page
 * @param {(item:any, index:number) => HTMLElement} renderRow
 */
export function createVList(container, renderRow) {
  let items = [];
  let sizer = null;
  let windowEl = null;
  let lastStart = -1;
  let lastEnd = -1;
  let virtual = false;
  let bound = false;
  let rowH = ROW_HEIGHT;

  function bind(on) {
    if (on === bound) return;
    bound = on;
    const fn = on ? 'addEventListener' : 'removeEventListener';
    window[fn]('scroll', onScroll, { passive: true });
    window[fn]('resize', onScroll);
  }

  function teardown() {
    bind(false);
    container.innerHTML = '';
    sizer = windowEl = null;
    lastStart = lastEnd = -1;
  }

  function renderPlain() {
    virtual = false;
    bind(false);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < items.length; i++) frag.appendChild(renderRow(items[i], i));
    container.replaceChildren(frag);
  }

  function buildScaffold() {
    virtual = true;
    sizer = document.createElement('div');
    sizer.className = 'vl-sizer';
    windowEl = document.createElement('div');
    windowEl.className = 'vl-window';
    sizer.appendChild(windowEl);
    container.replaceChildren(sizer);
    sizer.style.height = items.length * rowH + 'px';
    bind(true);
  }

  function paint(force) {
    const [first, last] = sliceFor(container, items.length, rowH);

    // Scrolling within the already-rendered slice needs no DOM work at all.
    if (!force && first === lastStart && last === lastEnd) return;
    lastStart = first;
    lastEnd = last;

    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) frag.appendChild(renderRow(items[i], i));
    windowEl.style.transform = 'translateY(' + first * rowH + 'px)';
    windowEl.replaceChildren(frag);

    const fixed = calibrate(windowEl.firstElementChild, rowH);
    if (fixed) {
      rowH = fixed;
      sizer.style.height = items.length * rowH + 'px';
      lastStart = lastEnd = -1;
      paint(true);
    }
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; paint(false); });
  }

  return {
    /** Page scroll survives a rebuild on its own, so there is no offset to restore. */
    setItems(next) {
      items = next || [];
      rowH = cssRowHeight();       // re-read: density may have changed
      lastStart = lastEnd = -1;
      if (!items.length) { teardown(); return; }

      if (items.length < VIRTUAL_THRESHOLD) renderPlain();
      else { buildScaffold(); paint(true); }
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
 * @param {HTMLElement} tbody  measured directly; its first child is row 0
 * @param {(item:any, index:number) => HTMLTableRowElement} renderRow
 */
export function createVTable(tbody, renderRow) {
  let items = [];
  let virtual = false;
  let bound = false;
  let rowH = ROW_HEIGHT;
  let lastStart = -1, lastEnd = -1;
  /* A <tr> with no cells collapses to nothing in some engines no matter what
     height it is given, so each spacer carries one full-width cell. */
  const mkSpacer = () => {
    const tr = document.createElement('tr');
    tr.className = 'vt-spacer';
    tr.setAttribute('aria-hidden', 'true');
    const td = document.createElement('td');
    td.colSpan = 6;
    tr.appendChild(td);
    return tr;
  };
  const top = mkSpacer();
  const bot = mkSpacer();
  const setSpacer = (tr, px) => {
    tr.style.height = px + 'px';
    tr.firstChild.style.height = px + 'px';
  };

  function bind(on) {
    if (on === bound) return;
    bound = on;
    const fn = on ? 'addEventListener' : 'removeEventListener';
    window[fn]('scroll', onScroll, { passive: true });
    window[fn]('resize', onScroll);
  }

  function renderPlain() {
    virtual = false;
    bind(false);
    const frag = document.createDocumentFragment();
    for (let i = 0; i < items.length; i++) frag.appendChild(renderRow(items[i], i));
    tbody.replaceChildren(frag);
  }

  function paint(force) {
    const [first, last] = sliceFor(tbody, items.length, rowH);
    if (!force && first === lastStart && last === lastEnd) return;
    lastStart = first;
    lastEnd = last;

    const frag = document.createDocumentFragment();
    setSpacer(top, first * rowH);
    frag.appendChild(top);
    for (let i = first; i < last; i++) frag.appendChild(renderRow(items[i], i));
    setSpacer(bot, Math.max(0, (items.length - last) * rowH));
    frag.appendChild(bot);

    // Swapped in one go: an empty tbody would let the browser clamp the page
    // scroll to a page that is momentarily short.
    tbody.replaceChildren(frag);

    const fixed = calibrate(top.nextElementSibling, rowH);
    if (fixed) {
      rowH = fixed;
      lastStart = lastEnd = -1;
      paint(true);
    }
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
      rowH = cssRowHeight();
      lastStart = lastEnd = -1;
      if (!items.length) { bind(false); tbody.replaceChildren(); return; }

      if (items.length < VIRTUAL_THRESHOLD) { renderPlain(); return; }
      virtual = true;
      bind(true);
      paint(true);
    },
    refresh() {
      if (!items.length) return;
      if (!virtual) renderPlain(); else paint(true);
    },
    get virtual() { return virtual; }
  };
}
