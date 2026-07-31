/* content.json, loaded once and shared by app.js and the views. */

export const Content = {
  days: [],
  micro: null,
  loaded: false,
  error: null,

  async load() {
    if (this.loaded) return this;
    const res = await fetch('content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    this.days = data.days || data;
    this.micro = data.micro || null;
    this.loaded = true;
    return this;
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
