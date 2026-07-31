/* data/manifest.json lists topics + the microservices entry and points at
   their content files; data/meta.json holds label/title/intro/tags for both
   languages. Per-topic *.en.json overlays are optional and partial: whatever
   they omit falls back to Vietnamese, so English can grow one item at a time
   without ever leaving a hole in the page. */

const LANG_KEY = 'gazl.contentLang';
const DEFAULT_LANG = 'en';
const LANGS = ['en', 'vi'];

const listeners = new Set();

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
  return res.json();
}

/** Absent file (no translation yet) is not fatal — it just means no English. */
async function fetchOptionalJson(path) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

/** Overlaying in place would destroy the source, so VI could never return. */
function cloneGroups(groups) {
  return (groups || []).map(s => ({ ...s, items: (s.items || []).map(it => ({ ...it })) }));
}

function applyMeta(target, metaEntry, lang) {
  if (!metaEntry) return;
  const vi = metaEntry.vi || {};
  const en = lang !== 'vi' ? metaEntry.en : null;
  const src = { ...vi, ...(en || {}) };
  for (const k of ['label', 'title', 'intro']) if (src[k]) target[k] = src[k];
  if (Array.isArray(src.tags) && src.tags.length) target.tags = [...src.tags];
}

/** groups = a day's `sections` or micro's `chapters` — same shape either way. */
function overlayGroups(groups, overlayGroupTitles, overlayItems) {
  groups.forEach((grp, i) => {
    const t = Array.isArray(overlayGroupTitles) ? overlayGroupTitles[i] : null;
    if (t) grp.title = t;
    for (const it of grp.items || []) {
      const oi = overlayItems && overlayItems[it.id];
      if (!oi) continue;
      if (oi.q) it.q = oi.q;
      if (oi.a) { it.a = oi.a; it.translated = true; }
    }
  });
}

function readLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (LANGS.includes(v)) return v;
  } catch (e) {}
  return DEFAULT_LANG;
}

export const Content = {
  days: [],
  micro: null,
  loaded: false,
  error: null,

  lang: readLang(),

  /** Manifest + meta + raw per-topic content, kept so switching language needs no refetch. */
  _manifest: null,
  _meta: null,
  _topicContent: null,
  _microContent: null,
  _enOverlaysTried: false,
  _topicEnOverlays: null,
  _microEnOverlay: null,

  async load() {
    if (this.loaded) return this;
    this._manifest = await fetchJson('data/manifest.json');
    this._meta = await fetchJson('data/meta.json');
    const topicRows = this._manifest.topics || [];
    const contents = await Promise.all(topicRows.map(row => fetchJson('data/' + row.file)));
    this._topicContent = new Map(topicRows.map((row, i) => [row.n, { row, content: contents[i] }]));
    this._microContent = await fetchJson('data/' + this._manifest.microservices.file);
    if (this.lang !== 'vi') await this._loadEnOverlays();
    this._apply();
    this.loaded = true;
    return this;
  },

  async _loadEnOverlays() {
    if (this._enOverlaysTried) return;
    this._enOverlaysTried = true;
    const topicRows = this._manifest.topics || [];
    const overlays = await Promise.all(topicRows.map(row => {
      const enFile = row.file.replace(/\.json$/, '.en.json');
      return fetchOptionalJson('data/' + enFile);
    }));
    this._topicEnOverlays = new Map(topicRows.map((row, i) => [row.n, overlays[i]]));
    const microEnFile = this._manifest.microservices.file.replace(/\.json$/, '.en.json');
    this._microEnOverlay = await fetchOptionalJson('data/' + microEnFile);
  },

  _apply() {
    const days = [];
    for (const [n, { row, content }] of this._topicContent) {
      const day = { n, group: row.group, tags: [...(content.tags || [])], sections: cloneGroups(content.sections) };
      applyMeta(day, this._meta.topics[String(n)], this.lang);
      if (this.lang !== 'vi' && this._topicEnOverlays) {
        const overlay = this._topicEnOverlays.get(n);
        if (overlay) overlayGroups(day.sections, overlay.sections, overlay.items);
      }
      days.push(day);
    }
    days.sort((a, b) => a.n - b.n);
    this.days = days;

    const micro = { tags: [...(this._microContent.tags || [])], chapters: cloneGroups(this._microContent.chapters) };
    applyMeta(micro, this._meta.microservices, this.lang);
    if (this.lang !== 'vi' && this._microEnOverlay) {
      overlayGroups(micro.chapters, this._microEnOverlay.chapters, this._microEnOverlay.items);
    }
    this.micro = micro;
  },

  isFallback(item) {
    return this.lang === 'en' && !item.translated;
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async setLang(lang) {
    if (!LANGS.includes(lang) || lang === this.lang) return;
    this.lang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    if (lang !== 'vi') await this._loadEnOverlays();
    this._apply();
    for (const fn of listeners) { try { fn(this); } catch (e) {} }
  },

  /** Track items only — the denominator of the progress ring. */
  get dayItemIds() {
    const s = new Set();
    for (const d of this.days) for (const sec of d.sections) for (const it of sec.items) s.add(it.id);
    return s;
  },

  get totalDayItems() {
    return this.days.reduce((s, d) => s + d.sections.reduce((a, sec) => a + sec.items.length, 0), 0);
  },

  dayCounts() {
    return this.days.map(d => ({
      n: d.n,
      label: d.label,
      group: d.group || '',
      ids: d.sections.flatMap(sec => sec.items.map(it => it.id))
    }));
  }
};
