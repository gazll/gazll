/* data/manifest.json lists every topic (including the Microservices track,
   topic_type "microservice") and points at its content file; data/meta.json
   holds label/title/intro/tags for both complete language sources. Each
   topic's base file (data/topics/NN-slug.json) is English by default, and
   the complete Vietnamese source exists at the same path with a `.vi.json`
   suffix. Both sources load eagerly, so switching languages never needs a
   refetch. */

const LANG_KEY = 'gazl.contentLang';
const DEFAULT_LANG = 'en';
const LANGS = ['en', 'vi'];

const listeners = new Set();

async function fetchJson(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + path);
  return res.json();
}

/** The .vi.json companion always exists for every topic — this is only
    optional in the sense that a broken/missing file degrades instead of
    throwing, not because translation is sparse (VI is always complete). */
async function fetchOptionalJson(path) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

function cloneSections(sections) {
  return (sections || []).map(s => ({ ...s, items: (s.items || []).map(it => ({ ...it })) }));
}

function applyMeta(target, metaEntry, lang) {
  if (!metaEntry) return;
  const src = metaEntry[lang] || metaEntry.en || metaEntry.vi || {};
  const fallback = metaEntry.en || metaEntry.vi || {};
  for (const k of ['label', 'title', 'intro']) target[k] = src[k] || fallback[k];
  const tags = (Array.isArray(src.tags) && src.tags.length) ? src.tags : fallback.tags;
  if (Array.isArray(tags)) target.tags = [...tags];
}

function readLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (LANGS.includes(v)) return v;
  } catch (e) {}
  return DEFAULT_LANG;
}

export const Content = {
  topics: [],
  loaded: false,
  error: null,

  lang: readLang(),

  /** Manifest + meta + both language files, kept so switching language needs no refetch. */
  _manifest: null,
  _meta: null,
  _en: null,
  _vi: null,
  _itemPairs: null,   // id -> {en:{q,a}, vi:{q,a}|null}, for the per-item language toggle

  async load() {
    if (this.loaded) return this;
    this._manifest = await fetchJson('data/manifest.json');
    this._meta = await fetchJson('data/meta.json');
    const rows = this._manifest.topics || [];

    const [enContents, viContents] = await Promise.all([
      Promise.all(rows.map(row => fetchJson('data/' + row.file))),
      Promise.all(rows.map(row => fetchOptionalJson('data/' + row.file.replace(/\.json$/, '.vi.json'))))
    ]);

    this._en = new Map(rows.map((row, i) => [row.n, { row, content: enContents[i] }]));
    this._vi = new Map(rows.map((row, i) => [row.n, viContents[i]]));
    this._buildItemPairs();

    this._apply();
    this.loaded = true;
    return this;
  },

  /** Built once from the raw per-language sources — independent of the
      currently active `lang`, so a per-item toggle can show "the other
      language" for one card without touching the site-wide switch. Matched
      by section/item position rather than a global id scan: the VI/EN
      contract guarantees the same section and item order, and matching that
      way survives an id that (in a mid-edit file) briefly doesn't match. */
  _buildItemPairs() {
    const pairs = new Map();
    for (const [n, { content: en }] of this._en) {
      const vi = this._vi.get(n);
      (en.sections || []).forEach((sec, si) => {
        (sec.items || []).forEach((it, ii) => {
          const viIt = vi?.sections?.[si]?.items?.[ii];
          pairs.set(it.id, { en: { q: it.q, a: it.a }, vi: viIt ? { q: viIt.q, a: viIt.a } : null });
        });
      });
    }
    this._itemPairs = pairs;
  },

  /** {en, vi} text for one item id, or null if the id is unknown. `vi` is
      null when that item has no Vietnamese companion. */
  itemPair(id) {
    return this._itemPairs ? (this._itemPairs.get(id) || null) : null;
  },

  _apply() {
    const topics = [];
    for (const [n, { row, content: en }] of this._en) {
      const vi = this._vi.get(n);
      const sections = cloneSections(this.lang === 'vi' && vi ? vi.sections : en.sections);
      const topic = {
        n,
        topic_type: row.topic_type,
        tags: [...(en.tags || [])],
        sections
      };
      applyMeta(topic, this._meta.topics[String(n)], this.lang);
      topics.push(topic);
    }
    topics.sort((a, b) => a.n - b.n);
    this.topics = topics;
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async setLang(lang) {
    if (!LANGS.includes(lang) || lang === this.lang) return;
    this.lang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    this._apply();
    for (const fn of listeners) { try { fn(this); } catch (e) {} }
  },

  /** All items across every topic — the denominator of the progress ring. */
  get topicItemIds() {
    const s = new Set();
    for (const t of this.topics) for (const sec of t.sections) for (const it of sec.items) s.add(it.id);
    return s;
  },

  get totalTopicItems() {
    return this.topics.reduce((s, t) => s + t.sections.reduce((a, sec) => a + sec.items.length, 0), 0);
  },

  topicCounts() {
    return this.topics.map(t => ({
      n: t.n,
      label: t.label,
      topic_type: t.topic_type || '',
      ids: t.sections.flatMap(sec => sec.items.map(it => it.id))
    }));
  }
};
