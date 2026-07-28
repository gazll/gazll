/* Transport to the folder proxy.

   The endpoint is unauthenticated and sends Access-Control-Allow-Origin: *,
   so this page can call it from any origin including file:// and localhost.
   It forwards to Fshare's own v3 API and hard-codes limit=50 — sending our own
   ?limit is ignored, which is why one client page spans several upstream pages. */

import { PAGE_SIZE, S } from './state.js';

export const API = 'https://fshare.annnekkk.com/api/folder';

export const currentSort = () => S.sortValue;

export function apiFolder(linkcode, page, sort) {
  const url = API + '?linkcode=' + encodeURIComponent(linkcode) +
              '&sort=' + encodeURIComponent(sort || currentSort()) +
              '&page=' + (page || 1);
  return fetch(url).then((res) => {
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  });
}

/** Total page count is only exposed through the upstream _links.last URL. */
export function pagesOf(data, page, count) {
  const last = (data && data._links && data._links.last) || '';
  const m = last.match(/[?&]page=(\d+)/);
  if (m) return parseInt(m[1], 10);
  return count < PAGE_SIZE ? page : page + 1;
}

/** Pull every page of one folder and return the flat item list plus page-1 meta. */
export function fetchAllPages(linkcode, sort, shouldStop) {
  return apiFolder(linkcode, 1, sort).then((d1) => {
    let items = (d1.items || []).slice();
    const tp = pagesOf(d1, 1, items.length);

    let chain = Promise.resolve();
    for (let p = 2; p <= tp; p++) {
      const page = p;
      chain = chain.then(() => {
        if (shouldStop && shouldStop()) return;
        return apiFolder(linkcode, page, sort).then((dp) => {
          items = items.concat(dp.items || []);
        });
      });
    }
    return chain.then(() => ({ items, meta: d1 }));
  });
}

/* ---------- link parsing ---------- */

export function extractLinkcode(s) {
  s = (s || '').trim();
  let m = s.match(/fshare\.vn\/folder\/([A-Za-z0-9]{4,})/i);              if (m) return m[1];
  m = s.match(/fshare\.vn(?:%2F)+folder(?:%2F)+([A-Za-z0-9]{4,})/i);      if (m) return m[1];
  m = s.match(/#([A-Za-z0-9]{4,})/);                                      if (m) return m[1];
  if (/^[A-Za-z0-9]{4,}$/.test(s)) return s;
  return null;
}

/** Pull every distinct folder code out of arbitrary pasted text. */
export function extractAllLinkcodes(text) {
  const out = [], seen = Object.create(null);
  const push = (c) => { if (c && !seen[c]) { seen[c] = true; out.push(c); } };

  const re = /fshare\.vn(?:%2F|\/)+folder(?:%2F|\/)+([A-Za-z0-9]{4,})/gi;
  let m;
  while ((m = re.exec(text))) push(m[1]);

  // Bare codes on their own, for lists that hold no full URLs. The 8-char floor
  // keeps ordinary words out; a /file/ URL never reaches here because its code
  // is preceded by "file", not "folder".
  String(text).split(/[\s,;]+/).forEach((tok) => {
    tok = tok.trim();
    if (/^[A-Za-z0-9]{8,}$/.test(tok)) push(tok);
  });
  return out;
}
