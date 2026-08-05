export const CONTENT_LANG_KEY = 'gazl.contentLang';
export const DEFAULT_CONTENT_LANG = 'en';
export const CONTENT_LANGS = Object.freeze(['en', 'vi']);

export function readContentLanguage() {
  try {
    const value = localStorage.getItem(CONTENT_LANG_KEY);
    if (CONTENT_LANGS.includes(value)) return value;
  } catch (e) {}
  return DEFAULT_CONTENT_LANG;
}

export function writeContentLanguage(lang) {
  try { localStorage.setItem(CONTENT_LANG_KEY, lang); } catch (e) {}
}

export async function fetchJson(path) {
  const response = await fetch(path, { cache: 'no-cache' });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' ' + path);
  return response.json();
}

/** Optional companions degrade to the English source if a localized file is unavailable. */
export async function fetchOptionalJson(path) {
  try {
    const response = await fetch(path, { cache: 'no-cache' });
    if (!response.ok) return null;
    return await response.json();
  } catch (e) {
    return null;
  }
}

/** Insert a language code before the final extension: article.json -> article.vi.json. */
export function companionPath(path, lang = 'vi') {
  return path.replace(/(\.[^./]+)$/, '.' + lang + '$1');
}

/** Eagerly load base English JSON and its localized companion for numbered manifest rows. */
export async function loadBilingualJsonRows(rows, prefix = 'data/') {
  const [english, vietnamese] = await Promise.all([
    Promise.all(rows.map(row => fetchJson(prefix + row.file))),
    Promise.all(rows.map(row => fetchOptionalJson(companionPath(prefix + row.file))))
  ]);

  return new Map(rows.map((row, index) => [row.n, {
    row,
    en: english[index],
    vi: vietnamese[index]
  }]));
}

export function localizedRecord(entry, lang) {
  if (!entry) return {};
  return entry[lang] || entry.en || entry.vi || {};
}
