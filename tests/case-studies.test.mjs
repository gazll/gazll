import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const publicRoot = path.join(root, 'public');
const manifest = JSON.parse(await readFile(path.join(publicRoot, 'data/case-studies/manifest.json'), 'utf8'));
const guides = JSON.parse(await readFile(path.join(publicRoot, 'data/case-studies/guides.json'), 'utf8'));

test('case-study manifest has stable, unique categories and article slugs', () => {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.categories.length, 4);
  assert.equal(manifest.articles.length, 11);

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

  for (const article of manifest.articles) {
    assert.match(article.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(categoryIds.includes(article.category), `${article.slug}: unknown category`);
    assert.match(article.source_url, /^https:\/\/engineering\.tiki\.vn\//,
      `${article.slug}: public source must stay on Tiki Engineering`);
    assert.match(article.body_file, /^data\/case-studies\/articles\/[a-z0-9-]+\.html$/);
    assert.ok(article.title && article.author && article.excerpt);
    assert.ok(Number.isInteger(article.read_minutes) && article.read_minutes > 0);
  }
});

test('every case study has a substantial, clearly separated editorial reading guide', () => {
  assert.equal(guides.version, 1);
  assert.deepEqual(Object.keys(guides.guides).sort(), manifest.articles.map(article => article.slug).sort());

  for (const article of manifest.articles) {
    const guide = guides.guides[article.slug];
    assert.ok(guide.title.length >= 40, `${article.slug}: guide needs a useful thesis`);
    for (const key of ['problem', 'core_idea', 'outcome']) {
      assert.ok(guide[key].length >= 120, `${article.slug}: ${key} is too thin`);
    }
    assert.equal(guide.takeaways.length, 5, `${article.slug}: expected five takeaways`);
    assert.equal(guide.review_lenses.length, 4, `${article.slug}: expected four design-review lenses`);
    assert.ok(guide.takeaways.every(item => item.length >= 80));
    assert.ok(guide.review_lenses.every(item => item.length >= 60));
  }
});

test('every case-study body and image is local, complete and accessible', async () => {
  let totalImages = 0;
  for (const article of manifest.articles) {
    const bodyPath = path.join(publicRoot, article.body_file);
    const body = await readFile(bodyPath, 'utf8');
    assert.doesNotMatch(body, /<script\b|\son[a-z]+\s*=/i, `${article.slug}: active HTML is not allowed`);
    assert.doesNotMatch(body, /<(?:img|source)\b[^>]+\bsrc(?:set)?="https?:\/\//i,
      `${article.slug}: body must not hotlink assets`);
    assert.doesNotMatch(body, /medium\.com/i,
      `${article.slug}: archived links should prefer Tiki Engineering over Medium`);

    const headings = [...body.matchAll(/<h[23]\s+id="([^"]+)"/g)].map(match => match[1]);
    assert.ok(headings.length >= 1, `${article.slug}: long-form TOC needs section headings`);
    assert.equal(new Set(headings).size, headings.length, `${article.slug}: heading ids must be unique`);

    const images = [...body.matchAll(/<img\s+([^>]+)>/g)].map(match => match[1]);
    assert.ok(images.length >= 1, `${article.slug}: article should preserve its figures`);
    totalImages += images.length;
    for (const attrs of images) {
      const src = /\bsrc="([^"]+)"/.exec(attrs)?.[1];
      const alt = /\balt="([^"]+)"/.exec(attrs)?.[1];
      assert.ok(src?.startsWith('assets/case-studies/'), `${article.slug}: image must be a local case-study asset`);
      assert.ok(alt?.trim(), `${article.slug}: image needs descriptive alt text`);
      assert.match(attrs, /\bwidth="\d+"/);
      assert.match(attrs, /\bheight="\d+"/);
      assert.match(attrs, /\bloading="lazy"/);
      await access(path.join(publicRoot, src));
    }
  }
  assert.equal(totalImages, 96, 'all figures from the eleven source articles should be preserved');
});

test('the panel exposes Experience while case studies remain outside Study Track data', async () => {
  const app = await readFile(path.join(publicRoot, 'app.js'), 'utf8');
  const topicManifest = await readFile(path.join(publicRoot, 'data/manifest.json'), 'utf8');

  assert.match(app, /\{ key: 'experience', label: 'Experience' \}/);
  assert.match(app, /id: 'case-studies', sec: 'experience'/);
  assert.match(app, /showView\(currentRouteState\.id, currentRouteState\.parts\)/,
    'hash subroutes should reach the case-study reader');
  const view = await readFile(path.join(publicRoot, 'views/case-studies.js'), 'utf8');
  assert.match(view, /renderGuide\(article, guide\)/);
  assert.match(view, /Editorial synthesis/);
  assert.doesNotMatch(topicManifest, /case-stud/i,
    'case studies must not change Study Track topics or its progress denominator');
});
