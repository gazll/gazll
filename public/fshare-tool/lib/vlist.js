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
    sizer.style.height = items.length * ROW_HEIGHT + 'px';
    windowEl = document.createElement('div');
    windowEl.className = 'vl-window';
    sizer.appendChild(windowEl);
    viewport.appendChild(sizer);
    viewport.addEventListener('scroll', onScroll, { passive: true });
  }

  function paint(force) {
    const h = viewport.clientHeight || 600;
    const first = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN);
    const count = Math.ceil(h / ROW_HEIGHT) + OVERSCAN * 2;
    const last = Math.min(items.length, first + count);

    // Scrolling within the already-rendered slice needs no DOM work at all.
    if (!force && first === lastStart && last === lastEnd) return;
    lastStart = first;
    lastEnd = last;

    const frag = document.createDocumentFragment();
    for (let i = first; i < last; i++) frag.appendChild(renderRow(items[i], i));
    windowEl.style.transform = 'translateY(' + first * ROW_HEIGHT + 'px)';
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
    setItems(next) {
      items = next || [];
      teardown();
      if (!items.length) return;
      if (items.length < VIRTUAL_THRESHOLD) { renderPlain(); return; }
      buildScaffold();
      paint(true);
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
