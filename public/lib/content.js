/* data/manifest.json lists every topic (including the Microservices track,
   topic_type "microservice") and points at its content file; data/meta.json
   holds label/title/intro/tags for both complete language sources. Each
   topic's base file (data/topics/NN-slug.json) is English by default, and
   the complete Vietnamese source exists at the same path with a `.vi.json`
   suffix. Both sources load eagerly, so switching languages never needs a
   refetch. */

import {
  CONTENT_LANGS,
  fetchJson,
  loadBilingualJsonRows,
  localizedRecord,
  readContentLanguage,
  writeContentLanguage
} from './i18n.js';

const listeners = new Set();

function cloneSections(sections) {
  return (sections || []).map(s => ({ ...s, items: (s.items || []).map(it => ({ ...it })) }));
}

function applyMeta(target, metaEntry, lang) {
  if (!metaEntry) return;
  const src = localizedRecord(metaEntry, lang);
  const fallback = metaEntry.en || metaEntry.vi || {};
  for (const k of ['label', 'title', 'intro']) target[k] = src[k] || fallback[k];
  const tags = (Array.isArray(src.tags) && src.tags.length) ? src.tags : fallback.tags;
  if (Array.isArray(tags)) target.tags = [...tags];
}

export const Content = {
  topics: [],
  loaded: false,
  error: null,

  lang: readContentLanguage(),

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

    const pairs = await loadBilingualJsonRows(rows);
    this._en = new Map([...pairs].map(([n, pair]) => [n, { row: pair.row, content: pair.en }]));
    this._vi = new Map([...pairs].map(([n, pair]) => [n, pair.vi]));
    this._buildItemPairs();

    this._apply();
    this.loaded = true;
    return this;
  },

  /** id -> {en, vi} text, matched by position so a per-item toggle can show the other language. */
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

  /** {en, vi} text for one item id, or null; `vi` is null with no companion. */
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
        // The filename stem, and the prefix of every item id in this topic —
        // the stable handle other views use to name a topic.
        key: this._meta.topics[String(n)]?.key || '',
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
    if (!CONTENT_LANGS.includes(lang) || lang === this.lang) return;
    this.lang = lang;
    writeContentLanguage(lang);
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
