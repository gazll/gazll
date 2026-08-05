import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const publicRoot = path.join(root, 'public');
const dataRoot = path.join(publicRoot, 'data');
const manifest = JSON.parse(await readFile(path.join(dataRoot, 'case-studies/manifest.json'), 'utf8'));
const meta = JSON.parse(await readFile(path.join(dataRoot, 'case-studies/meta.json'), 'utf8'));
const contentFiles = new Map();

for (const article of manifest.articles) {
  for (const lang of ['en', 'vi']) {
    const file = article.file.replace(/\.json$/, lang === 'vi' ? '.vi.json' : '.json');
    contentFiles.set('data/' + file, JSON.parse(await readFile(path.join(dataRoot, file), 'utf8')));
  }
}

const pairFor = article => ({
  en: contentFiles.get('data/' + article.file),
  vi: contentFiles.get('data/' + article.file.replace(/\.json$/, '.vi.json'))
});

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesBelow(fullPath) : [fullPath];
  }))).flat();
}

test('case studies use stable Topic-style numbering and separate localized metadata', () => {
  assert.equal(manifest.version, 2);
  assert.equal(meta.version, 1);
  assert.equal(manifest.categories.length, 4);
  assert.equal(manifest.articles.length, 11);
  assert.deepEqual(manifest.articles.map(article => article.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

  const categoryIds = manifest.categories.map(category => category.id);
  const slugs = manifest.articles.map(article => article.slug);
  assert.equal(new Set(categoryIds).size, categoryIds.length);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.deepEqual(Object.fromEntries(categoryIds.map(id => [id,
    manifest.articles.filter(article => article.category === id).length])), {
    'systems-architecture': 4,
    'data-ml-experimentation': 3,
    'mobile-developer-productivity': 2,
    'engineering-evolution': 2
  });

  assert.deepEqual(Object.keys(meta.categories).sort(), [...categoryIds].sort());
  assert.ok(meta.library.en.title && meta.library.vi.title);
  for (const category of manifest.categories) {
    assert.ok(meta.categories[category.id].en.label);
    assert.ok(meta.categories[category.id].vi.label);
  }

  for (const article of manifest.articles) {
    const key = String(article.n).padStart(2, '0') + '-' + article.slug;
    assert.equal(article.file, 'case-studies/' + key + '.json');
    assert.equal(meta.articles[String(article.n)].key, key);
    assert.match(article.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(categoryIds.includes(article.category), `${article.slug}: unknown category`);
    assert.match(article.source_url, /^https:\/\/engineering\.tiki\.vn\//,
      `${article.slug}: public source must stay on Tiki Engineering`);
    assert.ok(['en', 'vi'].includes(article.original_language));
    assert.ok(article.author && article.company);
    assert.ok(Number.isInteger(article.read_minutes) && article.read_minutes > 0);
    for (const lang of ['en', 'vi']) {
      const localized = meta.articles[String(article.n)][lang];
      assert.ok(localized.title && localized.excerpt, `${key}: incomplete ${lang} metadata`);
      assert.ok(Array.isArray(localized.tags) && localized.tags.length > 0);
    }
  }
});

test('every numbered case JSON has a complete EN/VI body and editorial guide', () => {
  for (const article of manifest.articles) {
    const key = meta.articles[String(article.n)].key;
    const pair = pairFor(article);
    assert.equal(pair.en.body_file, `data/case-studies/articles/${key}.html`);
    assert.equal(pair.vi.body_file, `data/case-studies/articles/${key}.vi.html`);

    for (const [lang, content] of Object.entries(pair)) {
      assert.deepEqual(Object.keys(content).sort(), ['body_file', 'guide']);
      const guide = content.guide;
      assert.ok(guide.title.length >= 40, `${key}: ${lang} guide needs a useful thesis`);
      for (const field of ['problem', 'core_idea', 'outcome']) {
        assert.ok(guide[field].length >= 120, `${key}: ${lang} ${field} is too thin`);
      }
      assert.equal(guide.takeaways.length, 5, `${key}: ${lang} needs five takeaways`);
      assert.equal(guide.review_lenses.length, 4, `${key}: ${lang} needs four review lenses`);
      assert.ok(guide.takeaways.every(item => item.length >= 80));
      assert.ok(guide.review_lenses.every(item => item.length >= 60));
    }
  }
});

test('paired long-form bodies preserve structure, code and all local figures', async () => {
  const referencedAssets = new Set();
  let englishImages = 0;
  let vietnameseImages = 0;

  for (const article of manifest.articles) {
    const key = meta.articles[String(article.n)].key;
    const pair = pairFor(article);
    const bodies = {};
    for (const [lang, content] of Object.entries(pair)) {
      const body = await readFile(path.join(publicRoot, content.body_file), 'utf8');
      bodies[lang] = body;
      assert.ok(body.length >= 4_000, `${key}: ${lang} body is unexpectedly short`);
      assert.doesNotMatch(body, /<script\b|\son[a-z]+\s*=/i, `${key}: active HTML is not allowed`);
      assert.doesNotMatch(body, /<(?:img|source)\b[^>]+\bsrc(?:set)?="https?:\/\//i,
        `${key}: body must not hotlink assets`);
      assert.doesNotMatch(body, /medium\.com|__GAZLSEG/i,
        `${key}: body contains a publisher mirror or translation artifact`);

      const headings = [...body.matchAll(/<h[23][^>]*\sid="([^"]+)"/g)].map(match => match[1]);
      assert.ok(headings.length >= 1, `${key}: long-form TOC needs section headings`);
      assert.equal(new Set(headings).size, headings.length, `${key}: heading ids must be unique`);

      const images = [...body.matchAll(/<img\s+([^>]+)>/g)].map(match => match[1]);
      assert.ok(images.length >= 1, `${key}: article should preserve its figures`);
      if (lang === 'en') englishImages += images.length;
      else vietnameseImages += images.length;
      for (const attrs of images) {
        const src = /\bsrc="([^"]+)"/.exec(attrs)?.[1];
        const alt = /\balt="([^"]+)"/.exec(attrs)?.[1];
        assert.ok(src?.startsWith(`assets/case-studies/${key}/`), `${key}: image folder must match its number`);
        assert.ok(alt?.trim(), `${key}: ${lang} image needs descriptive alt text`);
        assert.match(attrs, /\bwidth="\d+"/);
        assert.match(attrs, /\bheight="\d+"/);
        assert.match(attrs, /\bloading="lazy"/);
        referencedAssets.add(src);
        await access(path.join(publicRoot, src));
      }
    }

    const ids = body => [...body.matchAll(/<h[23][^>]*\sid="([^"]+)"/g)].map(match => match[1]);
    const sources = body => [...body.matchAll(/<img\s+[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
    const codeBlocks = body => [...body.matchAll(/<pre\b[\s\S]*?<\/pre>/g)].map(match => match[0]);
    assert.deepEqual(ids(bodies.vi), ids(bodies.en), `${key}: translated TOC structure drifted`);
    assert.deepEqual(sources(bodies.vi), sources(bodies.en), `${key}: translated figures drifted`);
    assert.deepEqual(codeBlocks(bodies.vi), codeBlocks(bodies.en), `${key}: code blocks must never be translated`);
  }

  assert.equal(englishImages, 96, 'English should preserve all source figures');
  assert.equal(vietnameseImages, 96, 'Vietnamese should preserve all source figures');
  const physicalAssets = (await filesBelow(path.join(publicRoot, 'assets/case-studies')))
    .map(file => path.relative(publicRoot, file).split(path.sep).join('/'));
  assert.equal(physicalAssets.length, 96);
  assert.deepEqual([...physicalAssets].sort(), [...referencedAssets].sort(), 'there should be no orphaned figures');
});

test('the shared bilingual loader switches case-study JSON in memory and caches article bodies', async () => {
  const fetched = [];
  globalThis.fetch = async url => {
    fetched.push(url);
    if (url === 'data/case-studies/manifest.json') return { ok: true, json: async () => structuredClone(manifest) };
    if (url === 'data/case-studies/meta.json') return { ok: true, json: async () => structuredClone(meta) };
    if (contentFiles.has(url)) return { ok: true, json: async () => structuredClone(contentFiles.get(url)) };
    if (/^data\/case-studies\/articles\//.test(url)) {
      return { ok: true, text: async () => readFile(path.join(publicRoot, url), 'utf8') };
    }
    return { ok: false, status: 404 };
  };

  const moduleUrl = pathToFileURL(path.join(publicRoot, 'lib/case-studies.js')).href + '?t=' + Math.random();
  const { CaseStudies } = await import(moduleUrl);
  await CaseStudies.load('en');
  assert.equal(CaseStudies.articles.length, 11);
  assert.equal(CaseStudies.articles[0].title, meta.articles['1'].en.title);
  assert.equal(CaseStudies.articles[0].body_file, pairFor(manifest.articles[0]).en.body_file);
  assert.equal(CaseStudies.articles[2].is_translation, true);

  const eagerFetches = fetched.length;
  await CaseStudies.load('vi');
  assert.equal(fetched.length, eagerFetches, 'both localized JSON sources should already be in memory');
  assert.equal(CaseStudies.articles[0].title, meta.articles['1'].vi.title);
  assert.equal(CaseStudies.articles[0].body_file, pairFor(manifest.articles[0]).vi.body_file);
  assert.equal(CaseStudies.articles[0].is_translation, true);
  assert.equal(CaseStudies.articles[2].is_translation, false);

  const article = CaseStudies.articles[0];
  await CaseStudies.body(article);
  const afterBody = fetched.length;
  await CaseStudies.body(article);
  assert.equal(fetched.length, afterBody, 'an opened localized body should be cached');
  delete globalThis.fetch;
});

test('Experience exposes the global language switch while remaining outside Study Track', async () => {
  const app = await readFile(path.join(publicRoot, 'app.js'), 'utf8');
  const styles = await readFile(path.join(publicRoot, 'styles.css'), 'utf8');
  const topicManifest = await readFile(path.join(dataRoot, 'manifest.json'), 'utf8');
  const view = await readFile(path.join(publicRoot, 'views/case-studies.js'), 'utf8');

  assert.match(app, /\{ key: 'experience', label: 'Experience' \}/);
  assert.match(app, /id: 'case-studies', sec: 'experience'/);
  assert.match(app, /showView\(currentRouteState\.id, currentRouteState\.parts\)/,
    'hash subroutes should reach the case-study reader');
  assert.match(view, /CaseStudies\.load\(Content\.lang\)/);
  assert.match(view, /renderGuide\(guide\)/);
  assert.doesNotMatch(styles, /view-case-studies\s+\.hdr-lang\s*\{\s*display:\s*none/,
    'Case Studies must expose the same header language switch as Topics');
  assert.doesNotMatch(topicManifest, /case-stud/i,
    'case studies must not change Study Track topics or its progress denominator');
});
