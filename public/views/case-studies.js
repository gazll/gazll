import { escapeHtml } from '../lib/markdown.js';

const MANIFEST_URL = 'data/case-studies/manifest.json';
let manifestPromise;
let mountToken = 0;

const sourceHref = url => /^https:\/\/engineering\.tiki\.vn\//.test(url || '')
  ? url
  : 'https://engineering.tiki.vn/';

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch(MANIFEST_URL).then(response => {
      if (!response.ok) throw new Error('Case-study manifest returned HTTP ' + response.status);
      return response.json();
    });
  }
  return manifestPromise;
}

function formatDate(value) {
  const date = new Date(value + 'T00:00:00Z');
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function renderCard(article, category) {
  return '<a class="cs-card" href="#/case-studies/' + encodeURIComponent(article.slug) + '">'
    + '<span class="cs-card-art" aria-hidden="true"><span></span><span></span><span></span></span>'
    + '<span class="cs-card-content">'
    + '<span class="cs-card-kicker">' + escapeHtml(article.company) + ' · ' + escapeHtml(article.language_label) + '</span>'
    + '<strong>' + escapeHtml(article.title) + '</strong>'
    + '<span class="cs-card-excerpt">' + escapeHtml(article.excerpt) + '</span>'
    + '<span class="cs-card-meta"><span>' + escapeHtml(category.label) + '</span><span>'
    + article.read_minutes + ' min read</span></span>'
    + '</span><span class="cs-card-arrow" aria-hidden="true">→</span></a>';
}

function renderLibrary(manifest) {
  const articles = manifest.articles || [];
  const categories = manifest.categories || [];
  const groups = categories.map(category => {
    const rows = articles.filter(article => article.category === category.id);
    if (!rows.length) return '';
    return '<section class="cs-category" aria-labelledby="cs-category-' + escapeHtml(category.id) + '">'
      + '<div class="cs-category-head"><div><p>Collection</p><h2 id="cs-category-' + escapeHtml(category.id) + '">'
      + escapeHtml(category.label) + '</h2><span>' + escapeHtml(category.description) + '</span></div>'
      + '<b>' + rows.length + '</b></div>'
      + '<div class="cs-card-grid">' + rows.map(article => renderCard(article, category)).join('') + '</div></section>';
  }).join('');

  return '<div class="cs-library">'
    + '<header class="cs-library-hero"><p class="cs-eyebrow">Experience · Production stories</p>'
    + '<h1>Engineering Case Studies</h1>'
    + '<p>Long-form accounts of real systems, the constraints behind them, and the trade-offs teams made in production.</p>'
    + '<div class="cs-library-stats"><span><b>' + articles.length + '</b> case ' + (articles.length === 1 ? 'study' : 'studies') + '</span>'
    + '<span><b>1</b> company</span><span>Original language</span></div></header>'
    + groups + '</div>';
}

function articleMeta(article) {
  const tags = (article.tags || []).map(tag => '<span>' + escapeHtml(tag) + '</span>').join('');
  return '<header class="cs-article-head">'
    + '<a class="cs-back" href="#/case-studies">← All case studies</a>'
    + '<p class="cs-eyebrow">' + escapeHtml(article.company) + ' · ' + escapeHtml(article.category_label) + '</p>'
    + '<h1>' + escapeHtml(article.title) + '</h1>'
    + '<p class="cs-deck">' + escapeHtml(article.excerpt) + '</p>'
    + '<div class="cs-byline"><span>By <b>' + escapeHtml(article.author) + '</b></span><span>'
    + formatDate(article.published_at) + '</span><span>' + article.read_minutes + ' min read</span>'
    + '<span class="cs-language">' + escapeHtml(article.language_label) + '</span></div>'
    + '<div class="cs-tags">' + tags + '</div>'
    + '<div class="cs-archive-note"><b>Historical case study</b><span>Architecture, technology choices and benchmark figures reflect the system and workload described at publication time.</span></div>'
    + '</header>';
}

function renderArticle(article, body) {
  const href = sourceHref(article.source_url);
  return '<div class="cs-article">' + articleMeta(article)
    + '<details class="cs-toc-mobile"><summary>On this page</summary><nav data-case-toc-mobile></nav></details>'
    + '<div class="cs-article-grid">'
    + '<article class="cs-article-body" data-case-body>' + body + '</article>'
    + '<aside class="cs-toc" aria-label="Article contents"><p>On this page</p><nav data-case-toc></nav>'
    + '<a href="' + href + '" target="_blank" rel="noopener noreferrer">Read at Tiki Engineering ↗</a></aside>'
    + '</div>'
    + '<footer class="cs-source"><span>Source</span><a href="' + href + '" target="_blank" rel="noopener noreferrer">'
    + escapeHtml(article.company) + ' — original article ↗</a></footer>'
    + '<dialog class="cs-lightbox" data-case-lightbox><button type="button" aria-label="Close image">×</button>'
    + '<figure><img alt=""><figcaption></figcaption></figure></dialog></div>';
}

function buildToc(root, slug) {
  const headings = [...root.querySelectorAll('[data-case-body] h2[id], [data-case-body] h3[id]')];
  const articleHash = '#/case-studies/' + encodeURIComponent(slug);
  const html = headings.map(heading => '<a class="' + (heading.tagName === 'H3' ? 'is-sub' : '')
    + '" href="' + articleHash + '" data-case-section="' + escapeHtml(heading.id) + '">'
    + escapeHtml(heading.textContent) + '</a>').join('');
  root.querySelectorAll('[data-case-toc], [data-case-toc-mobile]').forEach(nav => { nav.innerHTML = html; });
  root.querySelectorAll('[data-case-section]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      root.querySelector('#' + link.dataset.caseSection)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function wireLightbox(root) {
  const dialog = root.querySelector('[data-case-lightbox]');
  if (!dialog) return;
  const fullImage = dialog.querySelector('img');
  const caption = dialog.querySelector('figcaption');

  root.querySelectorAll('[data-zoom-image]').forEach(button => {
    button.addEventListener('click', () => {
      const image = button.querySelector('img');
      fullImage.src = image.currentSrc || image.src;
      fullImage.alt = image.alt;
      caption.textContent = button.closest('figure')?.querySelector('figcaption')?.textContent || image.alt;
      dialog.showModal();
    });
  });
  dialog.querySelector('button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
}

async function showArticle(root, manifest, slug, token) {
  const article = (manifest.articles || []).find(row => row.slug === slug);
  if (!article) {
    root.innerHTML = '<div class="cs-empty"><p class="cs-eyebrow">Case study not found</p>'
      + '<h1>That article is not in this collection.</h1><a href="#/case-studies">← Back to case studies</a></div>';
    document.title = 'Case study not found · Backend Engineering';
    return;
  }

  const response = await fetch(article.body_file);
  if (!response.ok) throw new Error('Article body returned HTTP ' + response.status);
  const body = await response.text();
  if (token !== mountToken) return;

  root.innerHTML = renderArticle(article, body);
  document.title = article.title + ' · Backend Engineering';
  buildToc(root, article.slug);
  wireLightbox(root);
}

export function renderCaseStudies() {
  return '<section class="cs-shell" data-case-root aria-live="polite">'
    + '<div class="cs-loading"><span></span><p>Loading case studies…</p></div></section>';
}

export async function mountCaseStudies(host, routeParts = []) {
  const token = ++mountToken;
  const root = host.querySelector('[data-case-root]');
  if (!root) return;

  try {
    const manifest = await loadManifest();
    if (token !== mountToken) return;
    const slug = routeParts[0] ? decodeURIComponent(routeParts[0]) : '';
    if (slug) await showArticle(root, manifest, slug, token);
    else root.innerHTML = renderLibrary(manifest);
  } catch (error) {
    if (token !== mountToken) return;
    root.innerHTML = '<div class="cs-empty"><p class="cs-eyebrow">Could not load this collection</p>'
      + '<h1>The case-study files are unavailable.</h1><p>' + escapeHtml(error?.message || String(error)) + '</p>'
      + '<a href="#/case-studies">Try again</a></div>';
  }
}
