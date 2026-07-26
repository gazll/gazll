/* Shared UI fragments used by both app.js and the views. */

export const chevSVG = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';

export const BADGE = {
  hard: '<span class="qbadge hard">NÂNG CAO</span>',
  core: '<span class="qbadge core">QUAN TRỌNG</span>',
  ext: '<span class="qbadge ext">MỞ RỘNG</span>'
};

export function debounce(fn, ms) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/** Local calendar day. toISOString() would bucket by UTC and shift the day. */
export function localDay(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
