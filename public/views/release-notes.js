/* Release notes — what content arrived, and when.

   Data-driven on purpose: entries live in data/release-notes.json so adding a
   note never touches app.js. Interface text is English like every other view;
   the entries describe study material rather than being study material, so
   they carry no item ids and no EN/VI companion. */
import { fetchJson } from '../lib/i18n.js';
import { renderMarkdown, escapeHtml } from '../lib/markdown.js';
import { Content } from '../lib/content.js';

const DATA_URL = 'data/release-notes.json';
const pad2 = n => String(n).padStart(2, '0');

/* Kinds carry a label and a colour class; an unknown kind still renders. */
const KIND = {
  topic: { label: 'Topic', cls: 'rn-k-topic' },
  content: { label: 'Content', cls: 'rn-k-content' },
  feature: { label: 'Feature', cls: 'rn-k-feature' }
};

let cache = null;

/** "2026-08-08" -> "8 Aug 2026", without pulling in a date library. */
function humanDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return escapeHtml(String(iso || ''));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return Number(m[3]) + ' ' + months[Number(m[2]) - 1] + ' ' + m[1];
}

/* A change may name a topic by its key. Resolve it to that topic's own label so
   the note keeps matching the material when a title is edited. Not a link: the
   track keeps its position in module state, so no topic has its own URL. */
function targetLabel(change) {
  const key = String(change.target || '');
  const topic = (Content.topics || []).find(t => t.key === key);
  if (!topic) return '';
  return '<span class="rn-target" data-topic-type="' + escapeHtml(topic.topic_type || '') + '">'
    + escapeHtml(pad2(topic.n) + ' · ' + (topic.label || key)) + '</span>';
}

function changeRow(change) {
  const kind = KIND[change.kind] || { label: change.kind || 'Change', cls: '' };
  const target = targetLabel(change);
  const count = Number(change.count) > 0
    ? '<span class="rn-count">+' + Number(change.count) + '</span>'
    : '';
  const where = change.section
    ? '<span class="rn-section">' + escapeHtml(change.section) + '</span>'
    : '';
  return '<li class="rn-change">'
    + '<div class="rn-cmeta">'
    + '<span class="rn-kind ' + kind.cls + '">' + escapeHtml(kind.label) + '</span>'
    + target + where + count
    + '</div>'
    // renderMarkdown, not escapeHtml: the notes use the same inline syntax as
    // the study material (bold, code, coloured spans).
    + '<div class="rn-text">' + renderMarkdown(String(change.text || '')) + '</div>'
    + '</li>';
}

function releaseBlock(release) {
  const added = Number(release.items_added) > 0
    ? '<span class="rn-added">' + Number(release.items_added) + ' new questions</span>'
    : '';
  return '<section class="rn-rel">'
    + '<header class="rn-relhead">'
    + '<time class="rn-date" datetime="' + escapeHtml(String(release.date || '')) + '">'
    + humanDate(release.date) + '</time>'
    + '<h3 class="rn-title">' + escapeHtml(String(release.title || '')) + '</h3>'
    + added
    + '</header>'
    + '<ul class="rn-changes">' + (release.changes || []).map(changeRow).join('') + '</ul>'
    + '</section>';
}

export function renderReleaseNotes() {
  return '<div class="page rn-page">'
    + '<h2>Release Notes</h2>'
    + '<p class="rn-intro">What was added to the study material, newest first — new topics and '
    + 'questions, rewritten answers, and changes to how the site works.</p>'
    + '<div class="rn-body" data-rn-body>'
    + '<p class="rn-loading">Loading…</p>'
    + '</div></div>';
}

export async function mountReleaseNotes(host) {
  const body = host.querySelector('[data-rn-body]');
  if (!body) return;
  try {
    // Topics may not be loaded yet when this view is the entry point; without
    // them targetLink has no label to resolve and would silently drop links.
    if (!Content.loaded) await Content.load(Content.lang);
    if (!cache) cache = await fetchJson(DATA_URL);
    const releases = cache.releases || [];
    body.innerHTML = releases.length
      ? releases.map(releaseBlock).join('')
      : '<p class="rn-empty">No release notes yet.</p>';
  } catch (e) {
    body.innerHTML = '<p class="rn-error">Release notes could not be loaded. '
      + 'Check your connection and reload.</p>';
  }
}
