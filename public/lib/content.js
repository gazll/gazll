/* data/manifest.json lists every topic (including the Microservices track,
   topic_type "microservice") and points at its content file; data/meta.json
   holds label/title/intro/tags for both languages, keyed by the language
   they actually hold. Each topic's base file (data/topics/NN-slug.json) is
   English by default; the Vietnamese original always exists at the same
   path with a `.vi.json` suffix and is the complete, ground-truth content.
   An item's `translated` flag says whether its text in that file is
   authentically written in that file's language — the EN base carries the
   Vietnamese text verbatim (translated: false) until someone actually
   translates it, so English can be filled in one item at a time without
   ever leaving a hole in the page. */

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

/** Whether at least one item in `sections` is authentically written in the
    requested language — drives whether the header switch can offer it. */
function hasRealTranslation(sections) {
  return (sections || []).some(s => (s.items || []).some(it => it.translated));
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

    this._apply();
    this.loaded = true;
    return this;
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
        sections,
        hasEn: hasRealTranslation(en.sections),
        hasVi: true // the .vi.json companion is always the complete source
      };
      applyMeta(topic, this._meta.topics[String(n)], this.lang);
      topics.push(topic);
    }
    topics.sort((a, b) => a.n - b.n);
    this.topics = topics;
  },

  /** True when the item's text is not authentically written in the current
      language — i.e. still showing the other language's content verbatim. */
  isFallback(item) {
    return !item.translated;
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
