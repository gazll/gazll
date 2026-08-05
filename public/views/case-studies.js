import { escapeHtml } from '../lib/markdown.js';
import { Content } from '../lib/content.js';
import { CaseStudies } from '../lib/case-studies.js';

let mountToken = 0;
const TOC_STATE_KEY = 'gazl.caseTocCollapsed';

const COPY = {
  en: {
    collection: 'Collection', cases: count => count === 1 ? 'case study' : 'case studies', company: 'company',
    availableLanguage: 'English · Vietnamese', minuteRead: 'min read', number: 'No.',
    allCases: 'All case studies', historical: 'Historical case study',
    historicalNote: 'Architecture, technology choices and benchmark figures reflect the system and workload described at publication time.',
    original: 'English original', translation: 'English translation', guideEyebrow: 'Reading guide · Editorial synthesis',
    problem: 'Problem', coreIdea: 'Core idea', outcome: 'Reported outcome', takeaways: 'Key takeaways',
    review: 'Design review lens', guideNote: 'The guide above is editorial synthesis; the preserved Tiki Engineering article continues below.',
    toc: 'On this page', contents: 'Article contents', hideToc: 'Hide contents', showToc: 'Show contents',
    readSource: 'Read at Tiki Engineering', source: 'Source',
    originalArticle: 'original article', closeImage: 'Close image', notFound: 'Case study not found',
    missing: 'That article is not in this collection.', back: 'Back to case studies', loading: 'Loading case studies…',
    unavailable: 'Could not load this collection', unavailableTitle: 'The case-study files are unavailable.', retry: 'Try again',
    locale: 'en'
  },
  vi: {
    collection: 'Bộ sưu tập', cases: () => 'case study', company: 'công ty',
    availableLanguage: 'Tiếng Việt · Tiếng Anh', minuteRead: 'phút đọc', number: 'Số',
    allCases: 'Tất cả case study', historical: 'Case study theo thời điểm',
    historicalNote: 'Kiến trúc, lựa chọn công nghệ và số liệu benchmark phản ánh hệ thống cùng tải thực tế tại thời điểm bài viết được xuất bản.',
    original: 'Bản gốc tiếng Việt', translation: 'Bản dịch tiếng Việt', guideEyebrow: 'Gợi ý đọc · Tổng hợp biên tập',
    problem: 'Bài toán', coreIdea: 'Ý tưởng cốt lõi', outcome: 'Kết quả trong bài', takeaways: 'Điểm nên ghi nhớ',
    review: 'Góc review thiết kế', guideNote: 'Phần trên là tổng hợp biên tập để hỗ trợ đọc; bài viết Tiki Engineering được bảo toàn bên dưới.',
    toc: 'Trong bài này', contents: 'Mục lục bài viết', hideToc: 'Ẩn mục lục', showToc: 'Hiện mục lục',
    readSource: 'Đọc tại Tiki Engineering', source: 'Nguồn',
    originalArticle: 'bài viết gốc', closeImage: 'Đóng ảnh', notFound: 'Không tìm thấy case study',
    missing: 'Bài viết này không có trong bộ sưu tập.', back: 'Quay lại Case Studies', loading: 'Đang tải case study…',
    unavailable: 'Không thể tải bộ sưu tập', unavailableTitle: 'Các file case study hiện không khả dụng.', retry: 'Thử lại',
    locale: 'vi-VN'
  }
};

const text = () => COPY[Content.lang] || COPY.en;
const numberLabel = article => String(article.n).padStart(2, '0');
const languageLabel = article => article.is_translation ? text().translation : text().original;

const sourceHref = url => /^https:\/\/engineering\.tiki\.vn\//.test(url || '')
  ? url
  : 'https://engineering.tiki.vn/';

function formatDate(value) {
  const date = new Date(value + 'T00:00:00Z');
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(text().locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function renderCard(article, category) {
  const coverFit = article.cover_fit === 'contain' ? ' contain' : '';
  return '<a class="cs-card" href="#/case-studies/' + encodeURIComponent(article.slug) + '">'
    + '<span class="cs-card-art' + coverFit + '" aria-hidden="true"><img src="'
    + escapeHtml(article.cover_image) + '" alt="" loading="lazy" decoding="async"></span>'
    + '<span class="cs-card-content">'
    + '<span class="cs-card-kicker">' + text().number + ' ' + numberLabel(article) + ' · '
    + escapeHtml(article.company) + ' · ' + escapeHtml(languageLabel(article)) + '</span>'
    + '<strong>' + escapeHtml(article.title) + '</strong>'
    + '<span class="cs-card-excerpt">' + escapeHtml(article.excerpt) + '</span>'
    + '<span class="cs-card-meta"><span>' + escapeHtml(category.label) + '</span><span>'
    + article.read_minutes + ' ' + text().minuteRead + '</span></span>'
    + '</span><span class="cs-card-arrow" aria-hidden="true">→</span></a>';
}

function renderLibrary(collection) {
  const articles = collection.articles || [];
  const categories = collection.categories || [];
  const groups = categories.map(category => {
    const rows = articles.filter(article => article.category === category.id);
    if (!rows.length) return '';
    return '<section class="cs-category" aria-labelledby="cs-category-' + escapeHtml(category.id) + '">'
      + '<div class="cs-category-head"><div><p>' + text().collection + '</p><h2 id="cs-category-' + escapeHtml(category.id) + '">'
      + escapeHtml(category.label) + '</h2><span>' + escapeHtml(category.description) + '</span></div>'
      + '<b>' + rows.length + '</b></div>'
      + '<div class="cs-card-grid">' + rows.map(article => renderCard(article, category)).join('') + '</div></section>';
  }).join('');

  return '<div class="cs-library">'
    + '<header class="cs-library-hero"><p class="cs-eyebrow">' + escapeHtml(collection.library.eyebrow) + '</p>'
    + '<h1>' + escapeHtml(collection.library.title) + '</h1>'
    + '<p>' + escapeHtml(collection.library.intro) + '</p>'
    + '<div class="cs-library-stats"><span><b>' + articles.length + '</b> ' + text().cases(articles.length) + '</span>'
    + '<span><b>1</b> ' + text().company + '</span><span>' + text().availableLanguage + '</span></div></header>'
    + groups + '</div>';
}

function articleMeta(article) {
  const tags = (article.tags || []).map(tag => '<span>' + escapeHtml(tag) + '</span>').join('');
  const href = sourceHref(article.source_url);
  return '<header class="cs-article-head">'
    + '<a class="cs-back" href="#/case-studies">← ' + text().allCases + '</a>'
    + '<p class="cs-eyebrow">' + text().number + ' ' + numberLabel(article) + ' · '
    + escapeHtml(article.company) + ' · ' + escapeHtml(article.category_label) + '</p>'
    + '<h1>' + escapeHtml(article.title) + '</h1>'
    + '<p class="cs-deck">' + escapeHtml(article.excerpt) + '</p>'
    + '<div class="cs-byline"><span>' + formatDate(article.published_at) + '</span>'
    + '<a class="cs-origin" href="' + href + '" target="_blank" rel="noopener noreferrer">'
    + escapeHtml(article.company) + ' ↗</a>'
    + '<span class="cs-language">' + escapeHtml(languageLabel(article)) + '</span></div>'
    + '<div class="cs-tags">' + tags + '</div>'
    + '<div class="cs-archive-note"><b>' + text().historical + '</b><span>' + text().historicalNote + '</span></div>'
    + '</header>';
}

function renderGuide(guide) {
  if (!guide) return '';
  const takeaways = (guide.takeaways || []).map(item => '<li>' + escapeHtml(item) + '</li>').join('');
  const reviewLenses = (guide.review_lenses || []).map(item => '<li>' + escapeHtml(item) + '</li>').join('');
  return '<section class="cs-guide" aria-labelledby="cs-guide-title">'
    + '<header><p>' + text().guideEyebrow + '</p>'
    + '<h2 id="cs-guide-title">' + escapeHtml(guide.title) + '</h2></header>'
    + '<div class="cs-guide-brief">'
    + '<article><b>' + text().problem + '</b><p>' + escapeHtml(guide.problem) + '</p></article>'
    + '<article><b>' + text().coreIdea + '</b><p>' + escapeHtml(guide.core_idea) + '</p></article>'
    + '<article><b>' + text().outcome + '</b><p>' + escapeHtml(guide.outcome) + '</p></article>'
    + '</div><div class="cs-guide-depth">'
    + '<article><h3>' + text().takeaways + '</h3><ul>' + takeaways + '</ul></article>'
    + '<article><h3>' + text().review + '</h3><ul>' + reviewLenses + '</ul></article>'
    + '</div><p class="cs-guide-note">' + text().guideNote + ' ↓</p></section>';
}

function renderArticle(article, body, guide) {
  const href = sourceHref(article.source_url);
  return '<div class="cs-article">' + articleMeta(article)
    + renderGuide(guide)
    + '<details class="cs-toc-mobile"><summary>' + text().toc + '</summary><nav data-case-toc-mobile></nav></details>'
    + '<div class="cs-article-grid">'
    + '<aside class="cs-toc" data-case-toc-panel aria-label="' + text().contents + '">'
    + '<div class="cs-toc-head"><p>' + text().toc + '</p>'
    + '<button type="button" data-case-toc-toggle aria-expanded="true" aria-controls="cs-toc-content" aria-label="'
    + text().hideToc + '" title="' + text().hideToc + '"><span aria-hidden="true">‹</span></button></div>'
    + '<div class="cs-toc-content" id="cs-toc-content" data-case-toc-content><nav data-case-toc></nav>'
    + '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + text().readSource + ' ↗</a></div></aside>'
    + '<article class="cs-article-body" data-case-body>' + body + '</article>'
    + '</div>'
    + '<footer class="cs-source"><span>' + text().source + '</span><a href="' + href + '" target="_blank" rel="noopener noreferrer">'
    + escapeHtml(article.company) + ' — ' + text().originalArticle + ' ↗</a></footer>'
    + '<dialog class="cs-lightbox" data-case-lightbox><button type="button" aria-label="' + text().closeImage + '">×</button>'
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

function readTocState() {
  try { return localStorage.getItem(TOC_STATE_KEY) === '1'; } catch (e) { return false; }
}

function wireTocToggle(root) {
  const grid = root.querySelector('.cs-article-grid');
  const panel = root.querySelector('[data-case-toc-panel]');
  const content = root.querySelector('[data-case-toc-content]');
  const button = root.querySelector('[data-case-toc-toggle]');
  if (!grid || !panel || !content || !button) return;

  const apply = collapsed => {
    grid.classList.toggle('is-toc-collapsed', collapsed);
    panel.classList.toggle('is-collapsed', collapsed);
    content.hidden = collapsed;
    button.setAttribute('aria-expanded', String(!collapsed));
    button.setAttribute('aria-label', collapsed ? text().showToc : text().hideToc);
    button.title = collapsed ? text().showToc : text().hideToc;
    button.querySelector('span').textContent = collapsed ? '›' : '‹';
  };

  apply(readTocState());
  button.addEventListener('click', () => {
    const collapsed = !panel.classList.contains('is-collapsed');
    try { localStorage.setItem(TOC_STATE_KEY, collapsed ? '1' : '0'); } catch (e) {}
    apply(collapsed);
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

async function showArticle(root, collection, slug, token) {
  const article = (collection.articles || []).find(row => row.slug === slug);
  if (!article) {
    root.innerHTML = '<div class="cs-empty"><p class="cs-eyebrow">' + text().notFound + '</p>'
      + '<h1>' + text().missing + '</h1><a href="#/case-studies">← ' + text().back + '</a></div>';
    document.title = text().notFound + ' · Backend Engineering';
    return;
  }

  const body = await collection.body(article);
  if (token !== mountToken) return;

  root.innerHTML = renderArticle(article, body, article.guide);
  document.title = article.title + ' · Backend Engineering';
  buildToc(root, article.slug);
  wireTocToggle(root);
  wireLightbox(root);
}

export function renderCaseStudies() {
  return '<section class="cs-shell" data-case-root aria-live="polite">'
    + '<div class="cs-loading"><span></span><p>' + text().loading + '</p></div></section>';
}

export async function mountCaseStudies(host, routeParts = []) {
  const token = ++mountToken;
  const root = host.querySelector('[data-case-root]');
  if (!root) return;

  try {
    const collection = await CaseStudies.load(Content.lang);
    if (token !== mountToken) return;
    const slug = routeParts[0] ? decodeURIComponent(routeParts[0]) : '';
    if (slug) await showArticle(root, collection, slug, token);
    else root.innerHTML = renderLibrary(collection);
  } catch (error) {
    if (token !== mountToken) return;
    root.innerHTML = '<div class="cs-empty"><p class="cs-eyebrow">' + text().unavailable + '</p>'
      + '<h1>' + text().unavailableTitle + '</h1><p>' + escapeHtml(error?.message || String(error)) + '</p>'
      + '<a href="#/case-studies">' + text().retry + '</a></div>';
  }
}
