/* Transport to the folder proxy.

   The endpoint is unauthenticated and sends Access-Control-Allow-Origin: *,
   so this page can call it from any origin including file:// and localhost.
   It forwards to Fshare's own v3 API and hard-codes limit=50 — sending our own
   ?limit is ignored, which is why one client page spans several upstream pages. */

import { PAGE_SIZE, S } from './state.js';
import { cacheGet, cacheSet, isBypassed } from './cache.js';

export const API = 'https://fshare.annnekkk.com/api/folder';

export const currentSort = () => S.sortValue;

const RETRIES = 3;

/* The upstream drops connections under load — an ECONNRESET showed up while
   benchmarking. Without a retry the crawl just counts the folder as failed and
   moves on, silently losing every file inside it, which is far worse than
   waiting a moment. Backoff is 400ms, then 800ms. */
export function apiFolder(linkcode, page, sort) {
  const url = API + '?linkcode=' + encodeURIComponent(linkcode) +
              '&sort=' + encodeURIComponent(sort || currentSort()) +
              '&page=' + (page || 1);

  const attempt = (n) =>
    fetch(url, { cache: 'no-store' }).then((res) => {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).catch((e) => {
      // A 4xx is a real answer; retrying it only wastes time.
      const permanent = /HTTP 4\d\d/.test(e.message);
      if (permanent || n >= RETRIES) throw e;
      return new Promise((r) => setTimeout(r, 400 * n)).then(() => attempt(n + 1));
    });

  return attempt(1);
}

/** Total page count is only exposed through the upstream _links.last URL. */
export function pagesOf(data, page, count) {
  const last = (data && data._links && data._links.last) || '';
  const m = last.match(/[?&]page=(\d+)/);
  if (m) return parseInt(m[1], 10);
  return count < PAGE_SIZE ? page : page + 1;
}

/** Counts how much of the last crawl was served without touching the network. */
export const fetchStats = { hits: 0, misses: 0 };
export const resetFetchStats = () => { fetchStats.hits = 0; fetchStats.misses = 0; };

/**
 * Every page of one folder, plus page-1 meta. Served from the persistent cache
 * when possible — the crawl is entirely network-bound, so this is what makes a
 * second visit instant rather than another minute of waiting.
 */
export function fetchAllPages(linkcode, sort, shouldStop, onPage) {
  const useSort = sort || currentSort();

  if (!isBypassed()) {
    const hit = cacheGet(linkcode, useSort);
    if (hit) {
      fetchStats.hits++;
      return Promise.resolve({
        items: hit.items,
        meta: { current: { name: hit.name, path: hit.path } },
        cached: true
      });
    }
  }
  fetchStats.misses++;

  /* Page count is only known after page 1 comes back, and a big folder can run
     to 130 of them. Reporting each one is the difference between "working" and
     "frozen" — this is the only place that knows how far along the fetch is. */
  const report = (page, total, count) => {
    if (onPage) onPage(page, total, count);
  };

  return apiFolder(linkcode, 1, useSort).then((d1) => {
    let items = (d1.items || []).slice();
    const tp = pagesOf(d1, 1, items.length);
    report(1, tp, items.length);

    let chain = Promise.resolve();
    for (let p = 2; p <= tp; p++) {
      const page = p;
      chain = chain.then(() => {
        if (shouldStop && shouldStop()) return;
        return apiFolder(linkcode, page, useSort).then((dp) => {
          items = items.concat(dp.items || []);
          report(page, tp, items.length);
        });
      });
    }

    return chain.then(() => {
      // Never cache a listing cut short by the user pressing Stop.
      if (!(shouldStop && shouldStop())) {
        const cur = d1.current || {};
        cacheSet(linkcode, useSort, items, cur.name || '', cur.path || '');
      }
      return { items, meta: d1, cached: false };
    });
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
