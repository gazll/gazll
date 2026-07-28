/* Filter query parsing and matching.

   A query is space-separated terms that must all hold:
     .mkv      extension is exactly mkv
     >500mb    larger than   (<2gb, >1.5gb; a bare number means MB)
     -sample   name must NOT contain "sample"
     anything  name contains it, case-insensitive                         */

import { S } from './state.js';
import { isFolder, extOf } from './util.js';

export const SIZE_UNITS = { b: 1, kb: 1024, mb: 1048576, gb: 1073741824, tb: 1099511627776 };

export function parseSizeToken(t) {
  const m = String(t).match(/^([<>])(\d+(?:[.,]\d+)?)(b|kb|mb|gb|tb)?$/);
  if (!m) return null;
  return { op: m[1], bytes: parseFloat(m[2].replace(',', '.')) * SIZE_UNITS[m[3] || 'mb'] };
}

export function matchesFilter(item, terms) {
  const name = String(item.name || '').toLowerCase();
  const ext = extOf(item.name);
  const size = item.size || 0;

  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    if (!t) continue;

    if (t.charAt(0) === '.') {
      if (ext !== t.slice(1)) return false;
      continue;
    }
    const sz = parseSizeToken(t);
    if (sz) {
      if (sz.op === '>' && !(size > sz.bytes)) return false;
      if (sz.op === '<' && !(size < sz.bytes)) return false;
      continue;
    }
    if (t.charAt(0) === '-' && t.length > 1) {
      if (name.indexOf(t.slice(1)) !== -1) return false;
      continue;
    }
    if (name.indexOf(t) === -1) return false;
  }
  return true;
}

export function filterTerms() {
  return S.filterText.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Every file in the tree cache, flattened and de-duplicated. */
export function allLoadedFiles() {
  const out = [], seen = Object.create(null);
  S.nodes.forEach((n) => {
    if (!n.loaded) return;
    n.items.forEach((it) => {
      if (isFolder(it) || seen[it.linkcode]) return;
      seen[it.linkcode] = true;
      out.push(it);
    });
  });
  return out;
}

export function filteredFiles() {
  const terms = filterTerms();
  if (!terms.length) return [];
  return allLoadedFiles().filter((it) => matchesFilter(it, terms));
}

/** Extension histogram of everything loaded, for the quick-pick chips. */
export function extCounts() {
  const map = Object.create(null);
  allLoadedFiles().forEach((it) => {
    const e = extOf(it.name);
    if (e) map[e] = (map[e] || 0) + 1;
  });
  return Object.keys(map)
    .sort((a, b) => map[b] - map[a])
    .slice(0, 8)
    .map((e) => ({ ext: e, n: map[e] }));
}
