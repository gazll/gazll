import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const publicRoot = path.join(root, 'public');
const manifest = JSON.parse(await readFile(path.join(publicRoot, 'data/case-studies/manifest.json'), 'utf8'));

test('case-study manifest has stable, unique categories and article slugs', () => {
  assert.equal(manifest.version, 1);
  assert.ok(manifest.categories.length >= 4);
  assert.ok(manifest.articles.length >= 1);

  const categoryIds = manifest.categories.map(category => category.id);
  const slugs = manifest.articles.map(article => article.slug);
  assert.equal(new Set(categoryIds).size, categoryIds.length);
  assert.equal(new Set(slugs).size, slugs.length);

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

test('every case-study body and image is local, complete and accessible', async () => {
  for (const article of manifest.articles) {
    const bodyPath = path.join(publicRoot, article.body_file);
    const body = await readFile(bodyPath, 'utf8');
    assert.doesNotMatch(body, /<script\b|\son[a-z]+\s*=/i, `${article.slug}: active HTML is not allowed`);
    assert.doesNotMatch(body, /https?:\/\//i, `${article.slug}: body must not hotlink assets`);

    const headings = [...body.matchAll(/<h[23]\s+id="([^"]+)"/g)].map(match => match[1]);
    assert.ok(headings.length >= 6, `${article.slug}: long-form TOC needs section headings`);
    assert.equal(new Set(headings).size, headings.length, `${article.slug}: heading ids must be unique`);

    const images = [...body.matchAll(/<img\s+([^>]+)>/g)].map(match => match[1]);
    assert.ok(images.length >= 1, `${article.slug}: article should preserve its figures`);
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
});

test('the panel exposes Experience while case studies remain outside Study Track data', async () => {
  const app = await readFile(path.join(publicRoot, 'app.js'), 'utf8');
  const topicManifest = await readFile(path.join(publicRoot, 'data/manifest.json'), 'utf8');

  assert.match(app, /\{ key: 'experience', label: 'Experience' \}/);
  assert.match(app, /id: 'case-studies', sec: 'experience'/);
  assert.match(app, /showView\(currentRouteState\.id, currentRouteState\.parts\)/,
    'hash subroutes should reach the case-study reader');
  assert.doesNotMatch(topicManifest, /case-stud/i,
    'case studies must not change Study Track topics or its progress denominator');
});
