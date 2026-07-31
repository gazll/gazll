'use strict';

/* Entry point. The topic track and the Microservices view render here;
   shared pieces live in lib/ and the larger views in views/.

   Adding a menu = adding one entry to VIEWS below.

   UI strings stay English even when the material is Vietnamese — see
   CLAUDE.md. The VI/EN toggle switches content only. */
import { renderMarkdown, escapeHtml } from './lib/markdown.js';
import { chevSVG, BADGE, FALLBACK_BADGE, debounce } from './lib/ui.js';
import { Content } from './lib/content.js';
import { Store } from './lib/store.js';
import { Auth, mountAuthUI } from './lib/auth.js';
import { renderInterviews, mountInterviews } from './views/interviews.js';
import { renderStats, mountStats } from './views/stats.js';
import { renderAdmin, mountAdmin } from './views/admin.js';

let DAYS = [];
let MICRO = null;
let current = 0;
let totalQ = 0;
let dayItemIds = new Set();
let groupFilter = 'all';
let topicQuery = '';

/* Topic groups. Order here is the order of the filter bar; `key` matches the
   `group` field of every topic in content.json. */
const GROUPS = [
  { key: 'core', label: 'Core' },
  { key: 'data', label: 'Data' },
  { key: 'design', label: 'Design' },
  { key: 'platform', label: 'Platform' },
  { key: 'algorithm', label: 'Algorithm' }
];
const GROUP_LABEL = Object.fromEntries(GROUPS.map(g => [g.key, g.label]));

const panel = document.getElementById('panel');
const dots = document.getElementById('dots');

/* ---------- Views / navigation ---------- */
const GUIDE_MD = [
  'This is an **all-in-one** site. The ☰ button opens the **navigation panel**, grouped into `Technical` (study & practice), `Tools` (standalone utilities) and `Other`. Every view has its own URL (e.g. `#/guide`), so any of them can be shared or bookmarked.',
  '',
  ':::tip Adding a menu entry',
  'Open `app.js` and push one object into the `VIEWS` array — nothing else needs touching. The `sec` field decides which section of the panel it lands in.',
  ':::',
  '',
  'Four kinds of entry:',
  '',
  '- Markdown view: `{ id: "snippets", sec: "about", label: "Snippets", md: "..." }`',
  '- Free-form HTML view: `{ id: "x", sec: "technical", render: () => "&lt;div&gt;...&lt;/div&gt;" }`',
  '- **Link to another tool**: `{ id: "abc", sec: "tool", label: "ABC", href: "abc-tool/" }` — an entry with `href` opens in a new tab and the router skips it, so adding a sibling app costs one line',
  '- View limited to some users: add `when: () => Auth.isAdmin`',
  '',
  ':::deep Storage and languages',
  'Progress, notes and the interview journal are written to `localStorage` immediately, then synced to a **Google Sheet** through Apps Script once you are signed in with Google. Losing the network or closing the tab mid-save costs nothing — the queue lives in `localStorage` and is resent on the next visit.',
  '',
  'The study material lives in `content.json` (JSON + Markdown). Supported syntax: **bold**, *italic*, `code`, `-` lists, and three callout blocks — `:::tip Label`, `:::warn Label`, `:::deep`.',
  '',
  'The interface is always English. The **material** has an `EN`/`VI` switch in the header. Vietnamese is the source of truth in `content.json`; `content.en.json` is a partial overlay keyed by topic number and item id, so English can be filled in one item at a time. Anything not translated yet falls back to Vietnamese and is tagged `VI` on the card.',
  '',
  'Every topic carries a `group` field (`core` · `data` · `design` · `platform` · `algorithm`) — that is what drives the filter chips in the topic picker.',
  '',
  'Raw HTML (SVG diagrams, tables) can be embedded straight into the Markdown. To update content: edit `content.json`, then `git push` — GitHub Actions deploys it.',
  ':::'
].join('\n');

/* Nav panel sections, in display order. `key` matches the `sec` of a view. */
const NAV_SECTIONS = [
  { key: 'technical', label: 'Technical' },
  { key: 'tool', label: 'Tools' },
  { key: 'about', label: 'Other' }
];

/* One entry per menu row.

   An entry with `href` is an external destination (another app under
   public/, or any URL) — it renders as a link and is never routed to.
   Everything else is an in-page view: `md`, or `render` (+ optional `mount`).
   `when` hides the row; `desc` is the second line in the panel. */
const VIEWS = [
  { id: 'track', sec: 'technical', label: 'Study Track', desc: 'Topic-based learning path', icon: 'track' },
  { id: 'gazl', sec: 'technical', label: 'Gazl Try', desc: 'Companies interviewed', icon: 'journal',
    render: renderInterviews, mount: mountInterviews },
  { id: 'micro', sec: 'technical', label: 'Microservices', desc: 'Standalone mastery track', icon: 'micro',
    render: renderMicro, mount: wireMicro },
  { id: 'stats', sec: 'technical', label: 'Stats', desc: 'Streak, heatmap, progress', icon: 'stats',
    render: renderStats, mount: mountStats },
  { id: 'admin', sec: 'technical', label: 'Admin', desc: 'All-user overview', icon: 'admin',
    render: renderAdmin, mount: mountAdmin, when: () => Auth.isAdmin },

  { id: 'fshare', sec: 'tool', label: 'Fshare Bulk Copy', desc: 'Collect download links in bulk',
    icon: 'tool', href: 'fshare-tool/' },

  { id: 'guide', sec: 'about', label: 'Guide', desc: 'Site structure & syntax', icon: 'guide',
    md: GUIDE_MD }
];

/* Inline so the panel needs no network and no icon font. */
const ICONS = {
  track: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  journal: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h5"/>',
  micro: '<circle cx="12" cy="12" r="2.6"/><circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="M6.7 7.4 10 10.4M17.3 7.4 14 10.4M6.7 16.6 10 13.6M17.3 16.6 14 13.6"/>',
  stats: '<path d="M5 19V10M12 19V5M19 19v-6"/>',
  admin: '<path d="M12 3l7 3v5c0 4.2-2.8 7.6-7 10-4.2-2.4-7-5.8-7-10V6z"/>',
  tool: '<path d="M14.5 3.5a5 5 0 0 0-6.1 6.7L3.5 15v5.5H9l4.8-4.9a5 5 0 0 0 6.7-6.1L17 12l-2.5-.5L14 9z"/>',
  guide: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.2 3.1c-.6.3-.8.7-.8 1.4"/><path d="M12 17h.01"/>'
};
const iconSVG = name => '<svg class="nv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"'
  + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + (ICONS[name] || ICONS.guide) + '</svg>';

/* ---------- personal notes, appended to every question card ---------- */

function noteBox(id) {
  const val = Store.getNote(id);
  return '<div class="notebox' + (val ? ' has-note' : '') + '">'
    + '<div class="note-head"><span class="note-label">My notes</span>'
    + '<span class="note-state" data-note-state="' + id + '"></span></div>'
    + '<textarea class="note-input" data-note="' + id + '" rows="3" '
    + 'placeholder="Write the answer back in your own words — this is the part that actually trains you.">'
    + escapeHtml(val) + '</textarea></div>';
}

function wireNotes(root) {
  (root || document).querySelectorAll('.note-input').forEach(ta => {
    const id = ta.dataset.note;
    const state = (root || document).querySelector('[data-note-state="' + id + '"]');

    // Local save after 600ms idle; getting it to the Sheet is Store's job.
    const save = debounce(() => {
      Store.setNote(id, ta.value);
      ta.closest('.notebox').classList.toggle('has-note', Boolean(ta.value.trim()));
      if (state) {
        state.textContent = 'saved';
        setTimeout(() => { if (state.textContent === 'saved') state.textContent = ''; }, 1600);
      }
    }, 600);

    ta.addEventListener('input', () => {
      if (state) state.textContent = 'typing…';
      save();
    });
    // Leaving the field saves now, without waiting out the debounce.
    ta.addEventListener('blur', () => Store.setNote(id, ta.value));
  });
}

/* ---------------------------------------------------------------------
   View "Microservices"
--------------------------------------------------------------------- */

function renderMicro() {
  const m = MICRO;
  if (!m || !m.chapters) {
    return '<div class="page"><p>No data yet. Add a <code>micro</code> key to <code>content.json</code> '
      + '(<code>{ title, intro, tags, chapters:[{ title, items:[{id,lvl,q,a}] }] }</code>).</p></div>';
  }
  const count = m.chapters.reduce((s, c) => s + ((c.items || []).length), 0);
  let html = '<section class="hero"><div class="hero-head"><div>'
    + '<h2>' + m.title + '</h2>'
    + '<p class="intro">' + m.intro + '</p>'
    + '<div class="tags">' + (m.tags || []).map(t => '<span class="tag">' + t + '</span>').join('') + '</div>'
    + '</div></div></section>'
    + '<div class="toolbar"><span class="sectioncount">' + count + ' items · ' + m.chapters.length + ' chapters</span>'
    + '<div class="legend"><span class="lg-core">ESSENTIAL</span><span class="lg-hard">ADVANCED</span><span class="lg-ext">EXTRA</span></div>'
    + '<div class="tb-actions"><button class="btn-ghost" id="microToggleAll">Expand all</button></div></div>';

  html += m.chapters.map((ch, ci) => {
    const items = (ch.items || []).map(it => qcard(it)).join('');
    const isOpen = ci === 0; // first chapter starts open
    return '<div class="chapter' + (isOpen ? ' open' : '') + '">'
      + '<button class="chapter-head" aria-expanded="' + isOpen + '">'
      + '<span class="chapter-title">' + ch.title + '</span>'
      + '<span class="chapter-meta">' + (ch.items || []).length + ' items' + chevSVG + '</span>'
      + '</button>'
      + '<div class="chapter-body"><div class="chapter-body-inner">' + items + '</div></div></div>';
  }).join('');
  return html;
}

/** Shared by the track view and the Microservices view. */
function qcard(it) {
  const badge = BADGE[it.lvl] || '';
  // Silent language switches read as a bug; the badge says why.
  const fallback = Content.isFallback(it) ? FALLBACK_BADGE : '';
  const lvlClass = it.lvl ? (' lvl-' + it.lvl) : '';
  const done = Store.reviewed.has(it.id) ? ' done' : '';
  return '<div class="qcard' + lvlClass + done + '" data-qid="' + it.id + '">'
    + '<button class="qhead" aria-expanded="false">'
    + '<span class="qid">' + it.id + '</span>'
    + '<span class="qtext">' + it.q + '</span>'
    + '<span class="qmeta">' + fallback + badge + chevSVG + '</span></button>'
    + '<div class="qbody"><div class="qbody-inner"><div class="answer"><div>'
    + renderMarkdown(it.a) + noteBox(it.id)
    + '</div></div></div></div></div>';
}

/** Collapse toggling; first open is what marks an item reviewed. */
function wireQcards(root, onMark) {
  (root || document).querySelectorAll('.qcard').forEach(card => {
    const head = card.querySelector('.qhead');
    head.addEventListener('click', () => {
      const open = card.classList.toggle('open');
      head.setAttribute('aria-expanded', open);
      if (open) {
        Store.logOpen(card.dataset.qid);
        if (Store.markReviewed(card.dataset.qid)) card.classList.add('done');
        if (onMark) onMark();
      }
    });
  });
  wireNotes(root);
}

function wireMicro(root) {
  const r = root || document;
  r.querySelectorAll('.chapter-head').forEach(head => {
    head.addEventListener('click', () => {
      const chapter = head.closest('.chapter');
      const open = chapter.classList.toggle('open');
      head.setAttribute('aria-expanded', open);
      syncMicroToggleLabel(r);
    });
  });
  wireQcards(r, updateProgress);
  const btn = r.querySelector('#microToggleAll');
  if (btn) btn.addEventListener('click', () => {
    const chapters = [...r.querySelectorAll('.chapter')];
    const anyClosed = chapters.some(c => !c.classList.contains('open'));
    chapters.forEach(c => {
      c.classList.toggle('open', anyClosed);
      c.querySelector('.chapter-head').setAttribute('aria-expanded', anyClosed);
    });
    syncMicroToggleLabel(r);
  });
  syncMicroToggleLabel(r);
}

function syncMicroToggleLabel(root) {
  const r = root || document;
  const chapters = [...r.querySelectorAll('.chapter')];
  const allOpen = chapters.length && chapters.every(c => c.classList.contains('open'));
  const btn = r.querySelector('#microToggleAll');
  if (btn) btn.textContent = allOpen ? 'Collapse all' : 'Expand all';
}

/* ---------------------------------------------------------------------
   Navigation
--------------------------------------------------------------------- */

function visibleViews() { return VIEWS.filter(v => !v.when || v.when()); }
/** Views the hash router can actually show — external links are not routable. */
function routableViews() { return visibleViews().filter(v => !v.href); }

function buildNav() {
  const active = currentViewId();
  const nav = document.getElementById('mainnav');
  if (!nav) return;

  const row = v => {
    const external = Boolean(v.href);
    const attrs = external
      ? 'href="' + v.href + '" target="_blank" rel="noopener noreferrer"'
      : 'href="#/' + v.id + '" aria-current="' + (v.id === active) + '"';
    return '<a class="navlink' + (external ? ' is-external' : '') + '" data-view="' + v.id + '" ' + attrs + '>'
      + iconSVG(v.icon)
      + '<span class="nv-text"><span class="nv-label">' + v.label + '</span>'
      + (v.desc ? '<span class="nv-desc">' + v.desc + '</span>' : '') + '</span>'
      + (external ? '<span class="nv-ext" aria-hidden="true">↗</span>' : '')
      + '</a>';
  };

  const shown = visibleViews();
  nav.innerHTML = NAV_SECTIONS.map(sec => {
    const items = shown.filter(v => v.sec === sec.key);
    if (!items.length) return '';
    return '<div class="nv-sec"><h3 class="nv-sectitle">' + sec.label + '</h3>'
      + items.map(row).join('') + '</div>';
  }).join('');
}

/* The panel is a focus-trapped drawer: it takes over the tab order while open
   and hands focus back to the toggle on close, so keyboard users are not
   dropped at the top of the document. */
function wireNavPanel() {
  const toggle = document.getElementById('navToggle');
  const panelEl = document.getElementById('navPanel');
  const scrim = document.getElementById('navScrim');
  const nav = document.getElementById('mainnav');
  if (!toggle || !panelEl || !scrim || !nav) return;

  const isOpen = () => document.body.classList.contains('nav-open');

  const open = () => {
    document.body.classList.add('nav-open');
    toggle.setAttribute('aria-expanded', 'true');
    panelEl.removeAttribute('inert');
    (panelEl.querySelector('.navlink[aria-current="true"]') || panelEl.querySelector('.navlink'))?.focus();
  };
  const close = ({ refocus = true } = {}) => {
    if (!isOpen()) return;
    // Blur before `inert`: a focused element inside an inert subtree keeps focus.
    if (panelEl.contains(document.activeElement)) document.activeElement.blur();
    document.body.classList.remove('nav-open');
    toggle.setAttribute('aria-expanded', 'false');
    panelEl.setAttribute('inert', '');
    if (refocus) toggle.focus();
  };

  panelEl.setAttribute('inert', '');
  toggle.addEventListener('click', e => { e.stopPropagation(); isOpen() ? close() : open(); });
  scrim.addEventListener('click', () => close());
  document.getElementById('navClose')?.addEventListener('click', () => close());

  // Follow the link first, then close — closing on an external link would
  // otherwise blur the anchor before the browser opens the new tab.
  nav.addEventListener('click', e => {
    if (e.target.closest('.navlink')) close({ refocus: false });
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isOpen()) { close(); return; }
    if (e.key !== 'Tab' || !isOpen()) return;
    const f = [...panelEl.querySelectorAll('a[href], button:not([disabled]), input')].filter(el => el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/* ---------- content language switch ---------- */

function wireLangSwitch() {
  const box = document.querySelector('.langswitch');
  if (!box) return;

  const paint = () => box.querySelectorAll('button').forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.lang === Content.lang));
  });

  box.addEventListener('click', async e => {
    const b = e.target.closest('button[data-lang]');
    if (!b || b.dataset.lang === Content.lang) return;
    box.classList.add('busy');   // setLang may fetch the overlay
    await Content.setLang(b.dataset.lang);
    box.classList.remove('busy');
  });

  Content.onChange(paint);
  paint();
}

/* ---- Header: collapse toggle (remembered) + hide-on-scroll-down ---- */
function wireHeader() {
  const header = document.querySelector('header.top');
  const btn = document.getElementById('hdrToggle');
  if (!header || !btn) return;
  const KEY = 'javadoc.header.collapsed';

  const setCollapsed = on => {
    header.classList.toggle('collapsed', on);
    btn.setAttribute('aria-expanded', String(!on));
    const label = on ? 'Expand header' : 'Collapse header';
    btn.setAttribute('aria-label', label);
    btn.title = label + ' (H)';
  };
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  setCollapsed(saved === '1');
  const toggle = () => {
    const on = !header.classList.contains('collapsed');
    setCollapsed(on);
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
  };
  btn.addEventListener('click', e => { e.stopPropagation(); toggle(); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'h' && e.key !== 'H') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, [contenteditable]')) return;
    toggle();
  });

  // Headroom: hide going down, reveal going up.
  //
  // The threshold is measured from where the current direction STARTED, not
  // from the previous event. Comparing against the previous event means a few
  // px of momentum wobble flips the class every frame, and each flip restarts
  // the .26s transform transition — that is the juddering.
  const FLIP_PX = 14;    // must travel this far one way before the state flips
  const TOP_ZONE = 160;  // always visible near the top

  let lastY = Math.max(0, window.scrollY);
  let anchorY = lastY;   // scroll position where the current direction began
  let dir = 0;           // 1 down, -1 up
  let queued = false;

  const apply = () => {
    queued = false;
    const y = Math.max(0, window.scrollY);

    const d = y > lastY ? 1 : y < lastY ? -1 : dir;
    if (d !== dir) { dir = d; anchorY = lastY; }   // turned around: re-anchor
    lastY = y;

    // `nav-open` lives on <body>; reading it off the header always said false.
    if (document.body.classList.contains('topic-open')
      || document.body.classList.contains('nav-open') || y <= TOP_ZONE) {
      header.classList.remove('hidden');
      return;
    }
    if (dir === 1 && y - anchorY > FLIP_PX) header.classList.add('hidden');
    else if (dir === -1 && anchorY - y > FLIP_PX) header.classList.remove('hidden');
  };

  // Coalesce to one update per frame; scroll can fire far more often than that.
  window.addEventListener('scroll', () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(apply);
  }, { passive: true });
  apply();
}

function isTrackActive() { return document.body.classList.contains('view-track'); }
function currentViewId() {
  const id = location.hash.replace(/^#\/?/, '');
  return routableViews().some(v => v.id === id) ? id : 'track';
}
function route() { showView(currentViewId()); }

function showView(id) {
  // Swap only the view-* class; `nav-open` and anything else stays put.
  document.body.classList.forEach(c => { if (c.startsWith('view-')) document.body.classList.remove(c); });
  document.body.classList.add('view-' + id);
  if (id !== 'track') closeTopicMenu();

  document.querySelectorAll('#mainnav .navlink:not(.is-external)')
    .forEach(a => a.setAttribute('aria-current', a.dataset.view === id));

  const v0 = VIEWS.find(x => x.id === id);
  const crumb = document.getElementById('viewCrumb');
  if (crumb && v0) crumb.textContent = v0.label;
  const track = document.getElementById('view-track');
  const host = document.getElementById('view-host');
  if (id === 'track') {
    track.hidden = false; host.hidden = true;
  } else {
    track.hidden = true; host.hidden = false;
    const v = VIEWS.find(x => x.id === id);
    if (v && v.md) host.innerHTML = '<div class="page">' + renderMarkdown(v.md) + '</div>';
    else if (v && v.render) host.innerHTML = v.render();
    else host.innerHTML = '';
    if (v && v.mount) v.mount(host);
  }
  window.scrollTo({ top: 0 });
}

/* ---------------------------------------------------------------------
   Topic picker

   Replaced a horizontally scrolling strip of 24 buttons: the topic you
   wanted was usually off-screen, and the strip fought the page scroll.
--------------------------------------------------------------------- */

const pick = {};

function cacheTopicEls() {
  pick.btn = document.getElementById('topicPick');
  pick.menu = document.getElementById('topicMenu');
  pick.list = document.getElementById('topicList');
  pick.search = document.getElementById('topicSearch');
  pick.scrim = document.getElementById('topicScrim');
  pick.empty = document.getElementById('tmEmpty');
  pick.num = document.getElementById('tpNum');
  pick.label = document.getElementById('tpLabel');
  pick.sub = document.getElementById('tpSub');
}

const pad2 = n => String(n).padStart(2, '0');

function topicProgress(d) {
  const ids = d.sections.flatMap(s => s.items.map(it => it.id));
  let done = 0;
  for (const id of ids) if (Store.reviewed.has(id)) done++;
  return { done, total: ids.length };
}

function topicMatches(d) {
  if (groupFilter !== 'all' && d.group !== groupFilter) return false;
  if (!topicQuery) return true;
  const hay = [pad2(d.n), d.label, d.title, (d.tags || []).join(' '), GROUP_LABEL[d.group] || '']
    .join(' ').toLowerCase();
  return hay.includes(topicQuery);
}

function buildTopicList() {
  let shown = 0;
  pick.list.innerHTML = DAYS.map((d, i) => {
    const { done, total } = topicProgress(d);
    const pct = total ? Math.round(done / total * 100) : 0;
    const hit = topicMatches(d);
    if (hit) shown++;
    return '<button class="tm-row" role="option" data-i="' + i + '" data-group="' + d.group + '"'
      + ' aria-selected="' + (i === current) + '"' + (hit ? '' : ' hidden') + '>'
      + '<span class="tm-n">' + pad2(d.n) + '</span>'
      + '<span class="tm-main">'
      + '<span class="tm-label">' + escapeHtml(d.label) + '</span>'
      + '<span class="tm-meta">' + (GROUP_LABEL[d.group] || d.group) + ' · ' + total + ' items</span>'
      + '</span>'
      + '<span class="tm-prog" title="' + done + ' of ' + total + ' reviewed">'
      + '<span class="tm-bar" style="--p:' + pct + '"></span>'
      + '<span class="tm-pct">' + done + '/' + total + '</span>'
      + '</span></button>';
  }).join('');

  pick.empty.hidden = shown > 0;
  pick.list.querySelectorAll('.tm-row').forEach(b => {
    b.addEventListener('click', () => { goTo(parseInt(b.dataset.i, 10)); closeTopicMenu(); });
  });
}

function paintTopicButton() {
  const d = DAYS[current];
  if (!d || !pick.btn) return;
  const { done, total } = topicProgress(d);
  pick.num.textContent = pad2(d.n);
  pick.btn.dataset.group = d.group;
  pick.num.dataset.group = d.group;
  pick.label.textContent = d.label;
  pick.sub.textContent = (GROUP_LABEL[d.group] || d.group) + ' · ' + done + '/' + total + ' reviewed';
  document.getElementById('tbCur').textContent = current + 1;
  document.getElementById('prevTopic').disabled = current === 0;
  document.getElementById('nextTopic').disabled = current === DAYS.length - 1;
}

function openTopicMenu() {
  if (!pick.menu) return;
  buildTopicList();
  pick.menu.hidden = false;
  document.body.classList.add('topic-open');
  pick.btn.setAttribute('aria-expanded', 'true');
  const cur = pick.list.querySelector('[aria-selected="true"]');
  if (cur) cur.scrollIntoView({ block: 'nearest' });
  // On a phone the keyboard would cover the list you came here to read.
  if (window.matchMedia('(min-width: 761px)').matches) pick.search.focus();
}

function closeTopicMenu() {
  if (!pick.menu || pick.menu.hidden) return;
  if (pick.menu.contains(document.activeElement)) pick.btn.focus();
  pick.menu.hidden = true;
  document.body.classList.remove('topic-open');
  pick.btn.setAttribute('aria-expanded', 'false');
}

function isTopicMenuOpen() { return pick.menu && !pick.menu.hidden; }

function wireTopicPicker() {
  cacheTopicEls();
  if (!pick.btn) return;

  pick.btn.addEventListener('click', e => {
    e.stopPropagation();
    isTopicMenuOpen() ? closeTopicMenu() : openTopicMenu();
  });
  pick.scrim.addEventListener('click', () => closeTopicMenu());
  document.addEventListener('click', e => {
    if (isTopicMenuOpen() && !pick.menu.contains(e.target) && !pick.btn.contains(e.target)) closeTopicMenu();
  });

  pick.search.addEventListener('input', () => {
    topicQuery = pick.search.value.trim().toLowerCase();
    buildTopicList();
  });

  pick.menu.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.stopPropagation(); closeTopicMenu(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = [...pick.list.querySelectorAll('.tm-row:not([hidden])')];
    if (!rows.length) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown'
      ? (at < 0 ? 0 : Math.min(at + 1, rows.length - 1))
      : (at <= 0 ? 0 : at - 1);
    rows[next].focus();
  });

  document.getElementById('prevTopic').addEventListener('click', () => goTo(current - 1));
  document.getElementById('nextTopic').addEventListener('click', () => goTo(current + 1));

  buildGroupBar();
  paintTopicButton();
  dots.innerHTML = DAYS.map((_, i) => '<span class="pdot' + (i === current ? ' on' : '') + '"></span>').join('');
}

/* ---------- topic track view ---------- */

/* Filtering only hides rows: DAYS and every index stay whole, so `current`,
   the dots and the pager keep counting across the full track. */
function buildGroupBar() {
  const bar = document.getElementById('groupbar');
  if (!bar) return;
  const counts = DAYS.reduce((m, d) => (m[d.group] = (m[d.group] || 0) + 1, m), {});
  const chip = (key, label, n) =>
    '<button class="gchip" data-g="' + key + '" data-group="' + key + '" '
    + 'aria-pressed="' + (groupFilter === key) + '">' + label
    + '<span class="gcount">' + n + '</span></button>';

  bar.innerHTML = chip('all', 'All', DAYS.length)
    + GROUPS.filter(g => counts[g.key]).map(g => chip(g.key, g.label, counts[g.key])).join('');

  bar.querySelectorAll('.gchip').forEach(b => b.addEventListener('click', () => {
    groupFilter = groupFilter === b.dataset.g ? 'all' : b.dataset.g;
    buildGroupBar();
    buildTopicList();
  }));
}

function renderDay() {
  const d = DAYS[current];
  const sectionsHTML = d.sections.map(sec =>
    '<div class="section-h">' + sec.title + '<span class="sline"></span></div>'
    + sec.items.map(it => qcard(it)).join('')
  ).join('');
  const dayQcount = d.sections.reduce((a, s) => a + s.items.length, 0);

  panel.innerHTML =
    '<section class="hero"><div class="hero-head">'
    + '<div class="daynum" data-group="' + d.group + '"><small>'
    + (GROUP_LABEL[d.group] || d.group).toUpperCase() + '</small>' + d.n + '</div>'
    + '<div><h2>' + d.title + '</h2><p class="intro">' + d.intro + '</p>'
    + '<div class="tags">' + d.tags.map(t => '<span class="tag">' + t + '</span>').join('') + '</div></div>'
    + '</div></section>'
    + '<div class="toolbar">'
    + '<span class="sectioncount">' + dayQcount + ' items · ' + d.sections.length + ' sections</span>'
    + '<div class="legend"><span class="lg-core">ESSENTIAL</span><span class="lg-hard">ADVANCED</span><span class="lg-ext">EXTRA</span></div>'
    + '<div class="tb-actions"><button class="btn-ghost" id="toggleAll">Expand all</button></div>'
    + '</div>' + sectionsHTML;

  wireQcards(panel, () => { updateProgress(); paintTopicButton(); });

  const toggleAll = document.getElementById('toggleAll');
  toggleAll.addEventListener('click', () => {
    const cards = [...panel.querySelectorAll('.qcard')];
    const anyClosed = cards.some(c => !c.classList.contains('open'));
    cards.forEach(c => {
      c.classList.toggle('open', anyClosed);
      c.querySelector('.qhead').setAttribute('aria-expanded', anyClosed);
      if (anyClosed && Store.markReviewed(c.dataset.qid)) c.classList.add('done');
    });
    updateProgress(); paintTopicButton(); syncToggleAllLabel();
  });
  syncToggleAllLabel();

  document.getElementById('curDay').textContent = current + 1;
  document.getElementById('prevBtn').disabled = current === 0;
  const nextBtn = document.getElementById('nextBtn');
  nextBtn.disabled = current === DAYS.length - 1;
  nextBtn.textContent = current === DAYS.length - 1 ? 'Finished ✓' : 'Next topic →';
}

function syncToggleAllLabel() {
  const cards = [...panel.querySelectorAll('.qcard')];
  const allOpen = cards.length && cards.every(c => c.classList.contains('open'));
  const btn = document.getElementById('toggleAll');
  if (btn) btn.textContent = allOpen ? 'Collapse all' : 'Expand all';
}

/**
 * Track items only. Store.reviewed also holds Microservices items, and
 * counting those would push the ring past 100% of the track denominator.
 */
function updateProgress() {
  let done = 0;
  for (const id of Store.reviewed) if (dayItemIds.has(id)) done++;
  document.getElementById('reviewedCount').textContent = done;
  document.getElementById('totalCount').textContent = totalQ;
  document.getElementById('ring').style.setProperty('--p', totalQ ? Math.round(done / totalQ * 100) : 0);
}

function goTo(i) {
  if (i < 0 || i >= DAYS.length) return;
  current = i;
  dots.querySelectorAll('.pdot').forEach((dt, idx) => dt.classList.toggle('on', idx === current));
  renderDay();
  paintTopicButton();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- sync status indicator ---------- */

const SYNC_TEXT = {
  offline: ['On this device only', 'No backend configured — see the README to turn on sync.'],
  local: ['Not signed in', 'Progress is kept on this device. Sign in to sync it to Google Sheets.'],
  syncing: ['Saving…', 'Sending changes to Google Sheets.'],
  synced: ['Synced', 'Everything has been saved to Google Sheets.'],
  stale: ['Sign in again', 'The session ended. Your data is safe on this device and will be sent once you sign back in.'],
  error: ['Save failed — will retry', 'Could not reach the Sheet. Your data is still on this device and will be retried.']
};

function mountSyncState(el) {
  if (!el) return;
  const paint = () => {
    const [label, hint] = SYNC_TEXT[Store.status] || SYNC_TEXT.local;
    const pending = Store.queue.length;
    el.className = 'syncstate s-' + Store.status;
    el.textContent = label + (pending ? ' (' + pending + ')' : '');
    el.title = (Store.lastError ? Store.lastError + ' — ' : '') + hint;
  };
  paint();
  Store.onSync(paint);
  Auth.onChange(paint);

  // Click to retry now rather than waiting for the debounce, and to surface
  // the failure reason — a title tooltip is unreachable on touch devices.
  el.addEventListener('click', () => {
    if (Store.lastError) {
      alert('Last sync error:\n\n' + Store.lastError
        + '\n\nYour data is still safe on this device (' + Store.queue.length + ' change(s) pending).');
    }
    Store.flush();
  });
}

/* ---------- startup ---------- */

async function init() {
  try {
    await Content.load();
    DAYS = Content.days;
    MICRO = Content.micro;
  } catch (e) {
    panel.innerHTML = '<section class="hero"><div style="padding:8px 4px">'
      + '<h2>Could not load the content</h2>'
      + '<p class="intro">The page reads <code>content.json</code> over <code>fetch</code>, so it has to run on '
      + 'a web server (HTTP) — opening the file directly with <code>file://</code> will not work.</p>'
      + '<p class="intro">To view it locally: open a terminal in <code>public/</code>, run '
      + '<code>python -m http.server 8080</code> and go to <code>http://localhost:8080</code>.</p>'
      + '<p class="intro" style="color:var(--clay)">Error detail: ' + (e && e.message ? e.message : e) + '</p>'
      + '</div></section>';
    return;
  }

  dayItemIds = Content.dayItemIds;
  totalQ = Content.totalDayItems;
  document.getElementById('totDay').textContent = DAYS.length;
  document.getElementById('tbTot').textContent = DAYS.length;

  // Must precede the first render: qcard() reads reviewed state and notes.
  Store.attachAuth();

  wireTopicPicker();
  renderDay();
  updateProgress();

  buildNav();
  wireNavPanel();
  wireLangSwitch();
  wireHeader();
  mountAuthUI(document.getElementById('authbar'));
  mountSyncState(document.getElementById('syncState'));

  window.addEventListener('hashchange', route);
  route();

  document.getElementById('prevBtn').addEventListener('click', () => goTo(current - 1));
  document.getElementById('nextBtn').addEventListener('click', () => goTo(current + 1));
  document.addEventListener('keydown', e => {
    if (e.target.closest('button')) return;
    // Arrow keys belong to the note field, and to the topic menu while open.
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    if (isTopicMenuOpen() || !isTrackActive()) return;
    if (e.key === 'ArrowRight') goTo(current + 1);
    if (e.key === 'ArrowLeft') goTo(current - 1);
  });

  Content.onChange(() => {
    DAYS = Content.days;
    MICRO = Content.micro;
    buildGroupBar();
    paintTopicButton();
    if (isTopicMenuOpen()) buildTopicList();
    refreshCurrentView();
  });

  // Signing in reveals the Admin menu and brings in merged Sheet data, so
  // the current view has to be repainted.
  let lastUid = Auth.session?.sub || null;
  Auth.onChange(() => {
    buildNav();
    const uid = Auth.session?.sub || null;
    if (uid !== lastUid) { lastUid = uid; refreshCurrentView(); }
  });
  Store.onSync(() => { if (isTrackActive()) { updateProgress(); paintTopicButton(); } });

  // One repaint once the first merge from the Sheet completes.
  let merged = false;
  Store.onSync(() => {
    if (merged || Store.status !== 'synced') return;
    merged = true;
    refreshCurrentView();
  });

  await Auth.init();
}

/** Repaints the open view so new data shows (checkmarks, note contents). */
function refreshCurrentView() {
  if (isTrackActive()) { renderDay(); updateProgress(); paintTopicButton(); }
  else route();
}

init();
