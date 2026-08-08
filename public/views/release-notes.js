/* Release notes — what content arrived, and when.

   Data-driven on purpose: entries live in data/release-notes.json so adding a
   note never touches app.js.

   The notes describe study material, so they follow the material's language:
   each release and change carries `en` and `vi` blocks in one file, resolved
   by the header switch exactly like meta.json. Chrome around them — the menu
   label, the heading, the kind chips — stays English per CLAUDE.md. Entries
   are not study items: no ids, no difficulty, no effect on the progress ring. */
import { fetchJson, localizedRecord } from '../lib/i18n.js';
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

/* "2026-08-08" -> "8 Aug 2026" / "08/08/2026". Formatted by hand rather than
   with toLocaleDateString, whose output depends on the browser's locale rather
   than on the language the reader picked here. */
function humanDate(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return escapeHtml(String(iso || ''));
  if (lang === 'vi') return m[3] + '/' + m[2] + '/' + m[1];
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

function changeRow(change, lang) {
  const kind = KIND[change.kind] || { label: change.kind || 'Change', cls: '' };
  // localizedRecord falls back to the other language rather than rendering an
  // empty row, so a note added in one language only still shows up.
  const local = localizedRecord(change, lang);
  const target = targetLabel(change);
  const count = Number(change.count) > 0
    ? '<span class="rn-count">+' + Number(change.count) + '</span>'
    : '';
  const where = local.section
    ? '<span class="rn-section">' + escapeHtml(local.section) + '</span>'
    : '';
  return '<li class="rn-change">'
    + '<div class="rn-cmeta">'
    + '<span class="rn-kind ' + kind.cls + '">' + escapeHtml(kind.label) + '</span>'
    + target + where + count
    + '</div>'
    // renderMarkdown, not escapeHtml: the notes use the same inline syntax as
    // the study material (bold, code, coloured spans).
    + '<div class="rn-text">' + renderMarkdown(String(local.text || '')) + '</div>'
    + '</li>';
}

/* One release inside a day. The date is on the day heading, not here — several
   releases can share a date and repeating it just pushed the titles apart. */
function releaseBlock(release, lang) {
  const local = localizedRecord(release, lang);
  const added = Number(release.items_added) > 0
    ? '<span class="rn-added">' + Number(release.items_added) + ' new questions</span>'
    : '';
  const title = String(local.title || '').trim();
  return '<section class="rn-rel">'
    + (title || added
      ? '<header class="rn-relhead">'
        + (title ? '<h4 class="rn-title">' + escapeHtml(title) + '</h4>' : '')
        + added + '</header>'
      : '')
    + '<ul class="rn-changes">'
    + (release.changes || []).map(c => changeRow(c, lang)).join('')
    + '</ul>'
    + '</section>';
}

/* Releases sharing a date, newest date first. The data file stays one entry per
   release — appending is what people actually do — and the grouping happens
   here, so a second release on a day never repeats its date. */
export function groupByDate(releases) {
  const days = new Map();
  for (const r of releases || []) {
    const key = String(r.date || '');
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(r);
  }
  return [...days.entries()].map(([date, items]) => ({
    date,
    releases: items,
    // Totals roll up so the day heading answers "what landed" on its own.
    items_added: items.reduce((n, r) => n + (Number(r.items_added) || 0), 0),
    changeCount: items.reduce((n, r) => n + (r.changes || []).length, 0)
  }));
}

function dayBlock(day, lang) {
  const many = day.releases.length > 1;
  const added = day.items_added > 0
    ? '<span class="rn-added">' + day.items_added + ' new questions</span>'
    : '';
  // With one release the title carries the day, so the roll-up would be noise.
  const summary = many
    ? '<span class="rn-daymeta">' + day.releases.length + ' releases · '
      + day.changeCount + ' change' + (day.changeCount === 1 ? '' : 's') + '</span>'
    : '';
  return '<section class="rn-day">'
    + '<header class="rn-dayhead">'
    + '<time class="rn-date" datetime="' + escapeHtml(day.date) + '">'
    + humanDate(day.date, lang) + '</time>'
    + summary + (many ? added : '')
    + '</header>'
    + day.releases.map(r => releaseBlock(r, lang)).join('')
    + '</section>';
}

export function renderReleaseNotes() {
  return '<div class="page rn-page">'
    + '<h2>Release Notes</h2>'
    + '<p class="rn-intro">What was added to the study material, newest first — new topics and '
    + 'questions, rewritten answers, and changes to how the site works. '
    + 'These notes follow the <b>EN/VI</b> switch in the header.</p>'
    + '<div class="rn-body" data-rn-body>'
    + '<p class="rn-loading">Loading…</p>'
    + '</div></div>';
}

export async function mountReleaseNotes(host) {
  const body = host.querySelector('[data-rn-body]');
  if (!body) return;
  try {
    // Topics may not be loaded yet when this view is the entry point; without
    // them targetLabel has no label to resolve and would drop the topic badge.
    if (!Content.loaded) await Content.load(Content.lang);
    if (!cache) cache = await fetchJson(DATA_URL);
    const lang = Content.lang;
    const days = groupByDate(cache.releases || []);
    body.innerHTML = days.length
      ? days.map(d => dayBlock(d, lang)).join('')
      : '<p class="rn-empty">No release notes yet.</p>';
  } catch (e) {
    body.innerHTML = '<p class="rn-error">Release notes could not be loaded. '
      + 'Check your connection and reload.</p>';
  }
}
