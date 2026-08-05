import { fetchJson, loadBilingualJsonRows, localizedRecord } from './i18n.js';

const MANIFEST_URL = 'data/case-studies/manifest.json';
const META_URL = 'data/case-studies/meta.json';
const bodyCache = new Map();

async function fetchBody(path) {
  if (!bodyCache.has(path)) {
    bodyCache.set(path, fetch(path, { cache: 'no-cache' }).then(response => {
      if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + path);
      return response.text();
    }).catch(error => {
      bodyCache.delete(path);
      throw error;
    }));
  }
  return bodyCache.get(path);
}

export const CaseStudies = {
  articles: [],
  categories: [],
  library: {},
  loaded: false,
  lang: 'en',
  _loadPromise: null,
  _manifest: null,
  _meta: null,
  _pairs: null,

  async load(lang = 'en') {
    if (!this._loadPromise) {
      this._loadPromise = (async () => {
        const [manifest, meta] = await Promise.all([fetchJson(MANIFEST_URL), fetchJson(META_URL)]);
        this._manifest = manifest;
        this._meta = meta;
        this._pairs = await loadBilingualJsonRows(manifest.articles || []);
        this.loaded = true;
      })().catch(error => {
        this._loadPromise = null;
        throw error;
      });
    }
    await this._loadPromise;
    this.apply(lang);
    return this;
  },

  apply(lang = 'en') {
    this.lang = lang;
    this.library = { ...localizedRecord(this._meta?.library, lang) };
    this.categories = (this._manifest?.categories || []).map(row => ({
      ...row,
      ...localizedRecord(this._meta?.categories?.[row.id], lang)
    }));
    const categoryById = new Map(this.categories.map(category => [category.id, category]));

    this.articles = [...(this._pairs || new Map()).values()].map(pair => {
      const content = lang === 'vi' && pair.vi ? pair.vi : pair.en;
      const metadata = localizedRecord(this._meta?.articles?.[String(pair.row.n)], lang);
      return {
        ...pair.row,
        ...content,
        ...metadata,
        tags: [...(metadata.tags || [])],
        category_label: categoryById.get(pair.row.category)?.label || pair.row.category,
        language: lang,
        is_translation: pair.row.original_language !== lang
      };
    }).sort((a, b) => a.n - b.n);
  },

  body(article) {
    return fetchBody(article.body_file);
  }
};
