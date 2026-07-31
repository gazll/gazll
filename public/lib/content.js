/* content.json, loaded once and shared by app.js and the views.

   content.en.json is a partial overlay, not a second copy: whatever it
   omits falls back to Vietnamese, so English can grow one item at a time
   without ever leaving a hole in the page. */

const LANG_KEY = 'gazl.contentLang';
const DEFAULT_LANG = 'en';
const LANGS = ['en', 'vi'];

const listeners = new Set();

/** Overlaying in place would destroy the source, so VI could never return. */
function cloneDays(days) {
  return days.map(d => ({
    ...d,
    tags: [...(d.tags || [])],
    sections: (d.sections || []).map(s => ({ ...s, items: (s.items || []).map(it => ({ ...it })) }))
  }));
}

function overlayDays(days, over) {
  if (!over) return days;
  for (const d of days) {
    const o = over[String(d.n)];
    if (!o) continue;
    for (const k of ['label', 'title', 'intro']) if (o[k]) d[k] = o[k];
    if (Array.isArray(o.tags) && o.tags.length) d.tags = [...o.tags];
    (d.sections || []).forEach((sec, i) => {
      const t = Array.isArray(o.sections) ? o.sections[i] : null;
      if (t) sec.title = t;
      for (const it of sec.items || []) {
        const oi = o.items && o.items[it.id];
        if (!oi) continue;
        if (oi.q) it.q = oi.q;
        if (oi.a) { it.a = oi.a; it.translated = true; }
      }
    });
  }
  return days;
}

function overlayMicro(micro, over) {
  if (!micro || !over) return micro;
  const m = { ...micro, tags: [...(micro.tags || [])], chapters: (micro.chapters || []).map(c => ({ ...c, items: (c.items || []).map(it => ({ ...it })) })) };
  for (const k of ['title', 'intro']) if (over[k]) m[k] = over[k];
  if (Array.isArray(over.tags) && over.tags.length) m.tags = [...over.tags];
  m.chapters.forEach((ch, i) => {
    const t = Array.isArray(over.chapters) ? over.chapters[i] : null;
    if (t) ch.title = t;
    for (const it of ch.items || []) {
      const oi = over.items && over.items[it.id];
      if (!oi) continue;
      if (oi.q) it.q = oi.q;
      if (oi.a) { it.a = oi.a; it.translated = true; }
    }
  });
  return m;
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
  overlay: null,
  overlayTried: false,

  /** Kept so switching language needs no refetch. */
  _base: null,

  async load() {
    if (this.loaded) return this;
    const res = await fetch('content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    this._base = { days: data.days || data, micro: data.micro || null };
    if (this.lang !== 'vi') await this._loadOverlay();
    this._apply();
    this.loaded = true;
    return this;
  },

  /** Absent or broken overlay is not fatal — it just means no English. */
  async _loadOverlay() {
    if (this.overlayTried) return;
    this.overlayTried = true;
    try {
      const res = await fetch('content.en.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      this.overlay = await res.json();
    } catch (e) {
      this.overlay = null;
    }
  },

  _apply() {
    const days = cloneDays(this._base.days);
    if (this.lang === 'vi' || !this.overlay) {
      this.days = days;
      this.micro = this._base.micro;
    } else {
      this.days = overlayDays(days, this.overlay.days);
      this.micro = overlayMicro(this._base.micro, this.overlay.micro);
    }
  },

  isFallback(item) {
    return this.lang === 'en' && !item.translated;
  },

  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  async setLang(lang) {
    if (!LANGS.includes(lang) || lang === this.lang) return;
    this.lang = lang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    if (lang !== 'vi') await this._loadOverlay();
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
