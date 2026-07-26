'use strict';

/* Entry point. The 16-day track and the Microservices view render here;
   shared pieces live in lib/ and the larger views in views/.

   Adding a menu = adding one entry to VIEWS below. */
import { renderMarkdown, escapeHtml } from './lib/markdown.js';
import { chevSVG, BADGE, debounce } from './lib/ui.js';
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

const panel = document.getElementById('panel');
const stepper = document.getElementById('stepper');
const dots = document.getElementById('dots');

/* ---------- Views / navigation ---------- */
const GUIDE_MD = [
  'Đây là một site **all-in-one**. Thanh điều hướng trên cùng chuyển giữa các *view*; lộ trình 16 ngày chỉ là view đầu tiên. Mỗi view có URL riêng (vd `#/guide`) nên chia sẻ/bookmark được.',
  '',
  ':::tip Thêm một menu mới',
  'Mở `app.js`, thêm một phần tử vào mảng `VIEWS` — không cần sửa chỗ khác.',
  ':::',
  '',
  'Ba kiểu view:',
  '',
  '- View Markdown: `{ id: "snippets", label: "Snippets", md: "...markdown..." }`',
  '- View HTML tự do: `{ id: "tools", label: "Tools", render: () => "&lt;div&gt;...&lt;/div&gt;" }`',
  '- View chỉ hiện với một số user: thêm `when: () => Auth.isAdmin`',
  '',
  ':::deep Lưu trữ',
  'Tiến độ, ghi chú và nhật ký phỏng vấn được lưu vào `localStorage` ngay lập tức, rồi đồng bộ lên **Google Sheet** qua Apps Script khi đã đăng nhập Google. Mất mạng hay đóng tab giữa lúc đang lưu cũng không mất dữ liệu — hàng chờ nằm trong `localStorage` và được gửi lại ở lần mở sau.',
  '',
  'Nội dung sách nằm ở `content.json` (JSON + Markdown). Cú pháp: **đậm**, *nghiêng*, `code`, danh sách `-`, và ba khối callout `:::tip Nhãn`, `:::warn Nhãn`, `:::deep`.',
  '',
  'Nhúng được raw HTML (sơ đồ SVG, bảng) ngay trong Markdown. Cập nhật nội dung: sửa `content.json` rồi `git push` — GitHub Actions tự deploy.',
  ':::'
].join('\n');

const VIEWS = [
  { id: 'track', label: 'Lộ trình 16 ngày' },
  { id: 'gazl', label: 'Gazl Try', render: renderInterviews, mount: mountInterviews },
  { id: 'micro', label: 'Microservices', render: renderMicro, mount: wireMicro },
  { id: 'stats', label: 'Thống kê', render: renderStats, mount: mountStats },
  { id: 'admin', label: 'Admin', render: renderAdmin, mount: mountAdmin, when: () => Auth.isAdmin },
  { id: 'guide', label: 'Hướng dẫn', md: GUIDE_MD }
];

/* ---------- personal notes, appended to every question card ---------- */

function noteBox(id) {
  const val = Store.getNote(id);
  return '<div class="notebox' + (val ? ' has-note' : '') + '">'
    + '<div class="note-head"><span class="note-label">Ghi chú của mình</span>'
    + '<span class="note-state" data-note-state="' + id + '"></span></div>'
    + '<textarea class="note-input" data-note="' + id + '" rows="3" '
    + 'placeholder="Tự viết lại câu trả lời bằng lời của mình — chỗ này mới là phần luyện thật.">'
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
        state.textContent = 'đã lưu';
        setTimeout(() => { if (state.textContent === 'đã lưu') state.textContent = ''; }, 1600);
      }
    }, 600);

    ta.addEventListener('input', () => {
      if (state) state.textContent = 'đang gõ…';
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
    return '<div class="page"><p>Chưa có dữ liệu. Thêm khoá <code>micro</code> vào <code>content.json</code> '
      + '(<code>{ title, intro, tags, chapters:[{ title, items:[{id,lvl,q,a}] }] }</code>).</p></div>';
  }
  const count = m.chapters.reduce((s, c) => s + ((c.items || []).length), 0);
  let html = '<section class="hero"><div class="hero-head"><div>'
    + '<h2>' + m.title + '</h2>'
    + '<p class="intro">' + m.intro + '</p>'
    + '<div class="tags">' + (m.tags || []).map(t => '<span class="tag">' + t + '</span>').join('') + '</div>'
    + '</div></div></section>'
    + '<div class="toolbar"><span class="sectioncount">' + count + ' mục · ' + m.chapters.length + ' chương</span>'
    + '<div class="legend"><span class="lg-core">QUAN TRỌNG</span><span class="lg-hard">NÂNG CAO</span><span class="lg-ext">MỞ RỘNG</span></div>'
    + '<div class="tb-actions"><button class="btn-ghost" id="microToggleAll">Mở tất cả</button></div></div>';

  html += m.chapters.map((ch, ci) => {
    const items = (ch.items || []).map(it => qcard(it)).join('');
    const isOpen = ci === 0; // first chapter starts open
    return '<div class="chapter' + (isOpen ? ' open' : '') + '">'
      + '<button class="chapter-head" aria-expanded="' + isOpen + '">'
      + '<span class="chapter-title">' + ch.title + '</span>'
      + '<span class="chapter-meta">' + (ch.items || []).length + ' mục' + chevSVG + '</span>'
      + '</button>'
      + '<div class="chapter-body"><div class="chapter-body-inner">' + items + '</div></div></div>';
  }).join('');
  return html;
}

/** Shared by the track view and the Microservices view. */
function qcard(it) {
  const badge = BADGE[it.lvl] || '';
  const lvlClass = it.lvl ? (' lvl-' + it.lvl) : '';
  const done = Store.reviewed.has(it.id) ? ' done' : '';
  return '<div class="qcard' + lvlClass + done + '" data-qid="' + it.id + '">'
    + '<button class="qhead" aria-expanded="false">'
    + '<span class="qid">' + it.id + '</span>'
    + '<span class="qtext">' + it.q + '</span>'
    + '<span class="qmeta">' + badge + chevSVG + '</span></button>'
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
  if (btn) btn.textContent = allOpen ? 'Đóng tất cả' : 'Mở tất cả';
}

/* ---------------------------------------------------------------------
   Navigation
--------------------------------------------------------------------- */

function visibleViews() { return VIEWS.filter(v => !v.when || v.when()); }

function buildNav() {
  const active = currentViewId();
  document.getElementById('mainnav').innerHTML = visibleViews().map(v =>
    '<a class="navlink" data-view="' + v.id + '" href="#/' + v.id + '"'
    + ' aria-current="' + (v.id === active) + '">' + v.label + '</a>').join('');
}

function wireNavToggle() {
  const toggle = document.getElementById('navToggle');
  const header = document.querySelector('header.top');
  if (!toggle || !header) return;
  const close = () => { header.classList.remove('nav-open'); toggle.setAttribute('aria-expanded', 'false'); };
  toggle.addEventListener('click', e => {
    e.stopPropagation();
    const open = header.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', open);
  });
  document.getElementById('mainnav').addEventListener('click', e => {
    if (e.target.closest('.navlink')) close();
  });
  document.addEventListener('click', e => {
    if (header.classList.contains('nav-open') && !e.target.closest('header.top')) close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
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
    const label = on ? 'Mở rộng header' : 'Thu gọn header';
    btn.setAttribute('aria-label', label);
    btn.title = label + ' (phím H)';
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
  let last = window.scrollY;
  const apply = () => {
    const y = Math.max(0, window.scrollY);
    header.classList.toggle('condensed', y > 24);
    if (header.classList.contains('nav-open') || y <= 160) header.classList.remove('hidden');
    else if (y > last + 4) header.classList.add('hidden');
    else if (y < last - 4) header.classList.remove('hidden');
    last = y;
  };
  window.addEventListener('scroll', apply, { passive: true });
  apply();
}

function isTrackActive() { return document.body.classList.contains('view-track'); }
function currentViewId() {
  const id = location.hash.replace(/^#\/?/, '');
  return VIEWS.some(v => v.id === id) ? id : 'track';
}
function route() { showView(currentViewId()); }

function showView(id) {
  document.body.className = 'view-' + id;
  document.querySelectorAll('#mainnav .navlink').forEach(a => a.setAttribute('aria-current', a.dataset.view === id));
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

/* ---------- 16-day track view ---------- */

function buildStepper() {
  stepper.innerHTML = DAYS.map((d, i) =>
    '<button class="step" data-i="' + i + '" aria-current="' + (i === current) + '">'
    + '<span class="sidx">DAY ' + String(d.n).padStart(2, '0') + '</span>'
    + '<span class="slabel">' + d.label + '</span></button>').join('');
  stepper.querySelectorAll('.step').forEach(b => b.addEventListener('click', () => goTo(parseInt(b.dataset.i))));
  dots.innerHTML = DAYS.map((_, i) => '<span class="pdot' + (i === current ? ' on' : '') + '"></span>').join('');
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
    + '<div class="daynum"><small>NGÀY</small>' + d.n + '</div>'
    + '<div><h2>' + d.title + '</h2><p class="intro">' + d.intro + '</p>'
    + '<div class="tags">' + d.tags.map(t => '<span class="tag">' + t + '</span>').join('') + '</div></div>'
    + '</div></section>'
    + '<div class="toolbar">'
    + '<span class="sectioncount">' + dayQcount + ' mục · ' + d.sections.length + ' nhóm chủ đề</span>'
    + '<div class="legend"><span class="lg-core">QUAN TRỌNG</span><span class="lg-hard">NÂNG CAO</span><span class="lg-ext">MỞ RỘNG</span></div>'
    + '<div class="tb-actions"><button class="btn-ghost" id="toggleAll">Mở tất cả</button></div>'
    + '</div>' + sectionsHTML;

  wireQcards(panel, updateProgress);

  const toggleAll = document.getElementById('toggleAll');
  toggleAll.addEventListener('click', () => {
    const cards = [...panel.querySelectorAll('.qcard')];
    const anyClosed = cards.some(c => !c.classList.contains('open'));
    cards.forEach(c => {
      c.classList.toggle('open', anyClosed);
      c.querySelector('.qhead').setAttribute('aria-expanded', anyClosed);
      if (anyClosed && Store.markReviewed(c.dataset.qid)) c.classList.add('done');
    });
    updateProgress(); syncToggleAllLabel();
  });
  syncToggleAllLabel();

  document.getElementById('curDay').textContent = d.n;
  document.getElementById('prevBtn').disabled = current === 0;
  const nextBtn = document.getElementById('nextBtn');
  nextBtn.disabled = current === DAYS.length - 1;
  nextBtn.textContent = current === DAYS.length - 1 ? 'Hoàn tất ✓' : 'Ngày tiếp →';
}

function syncToggleAllLabel() {
  const cards = [...panel.querySelectorAll('.qcard')];
  const allOpen = cards.length && cards.every(c => c.classList.contains('open'));
  const btn = document.getElementById('toggleAll');
  if (btn) btn.textContent = allOpen ? 'Đóng tất cả' : 'Mở tất cả';
}

/**
 * Track items only. Store.reviewed also holds Microservices items, and
 * counting those would push the ring past 100% of its 210 denominator.
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
  stepper.querySelectorAll('.step').forEach((b, idx) => b.setAttribute('aria-current', idx === current));
  dots.querySelectorAll('.pdot').forEach((dt, idx) => dt.classList.toggle('on', idx === current));
  renderDay();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const active = stepper.querySelector('[aria-current="true"]');
  if (active) active.scrollIntoView({ inline: 'center', block: 'nearest' });
}

/* ---------- sync status indicator ---------- */

const SYNC_TEXT = {
  offline: ['Chỉ lưu máy này', 'Chưa cấu hình backend — xem README để bật đồng bộ.'],
  local: ['Chưa đăng nhập', 'Tiến độ đang lưu trên máy này. Đăng nhập để đồng bộ lên Google Sheet.'],
  syncing: ['Đang lưu…', 'Đang gửi thay đổi lên Google Sheet.'],
  synced: ['Đã đồng bộ', 'Mọi thay đổi đã lưu lên Google Sheet.'],
  stale: ['Chờ đăng nhập lại', 'Phiên hết hạn. Dữ liệu vẫn an toàn trên máy và sẽ tự gửi sau khi đăng nhập lại.'],
  error: ['Lưu lỗi — sẽ thử lại', 'Không gửi được lên Sheet. Dữ liệu vẫn nằm trong máy, sẽ thử lại.']
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
}

/* ---------- startup ---------- */

async function init() {
  try {
    await Content.load();
    DAYS = Content.days;
    MICRO = Content.micro;
  } catch (e) {
    panel.innerHTML = '<section class="hero"><div style="padding:8px 4px">'
      + '<h2>Không tải được dữ liệu</h2>'
      + '<p class="intro">Trang đọc <code>content.json</code> qua <code>fetch</code> nên cần chạy trên một web server (HTTP), '
      + 'không mở trực tiếp bằng <code>file://</code>.</p>'
      + '<p class="intro">Xem cục bộ: mở terminal trong thư mục <code>public/</code> rồi chạy '
      + '<code>python -m http.server 8080</code> và truy cập <code>http://localhost:8080</code>.</p>'
      + '<p class="intro" style="color:var(--clay)">Chi tiết lỗi: ' + (e && e.message ? e.message : e) + '</p>'
      + '</div></section>';
    return;
  }

  dayItemIds = Content.dayItemIds;
  totalQ = Content.totalDayItems;
  document.getElementById('totDay').textContent = DAYS.length;

  // Must precede the first render: qcard() reads reviewed state and notes.
  Store.attachAuth();

  buildStepper();
  renderDay();
  updateProgress();

  buildNav();
  wireNavToggle();
  wireHeader();
  mountAuthUI(document.getElementById('authbar'));
  mountSyncState(document.getElementById('syncState'));

  window.addEventListener('hashchange', route);
  route();

  document.getElementById('prevBtn').addEventListener('click', () => goTo(current - 1));
  document.getElementById('nextBtn').addEventListener('click', () => goTo(current + 1));
  document.addEventListener('keydown', e => {
    if (e.target.closest('button')) return;
    // Arrow keys belong to the note field while it has focus.
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    if (!isTrackActive()) return;
    if (e.key === 'ArrowRight') goTo(current + 1);
    if (e.key === 'ArrowLeft') goTo(current - 1);
  });

  // Signing in reveals the Admin menu and brings in merged Sheet data, so
  // the current view has to be repainted.
  let lastUid = Auth.session?.sub || null;
  Auth.onChange(() => {
    buildNav();
    const uid = Auth.session?.sub || null;
    if (uid !== lastUid) { lastUid = uid; refreshCurrentView(); }
  });
  Store.onSync(() => { if (isTrackActive()) updateProgress(); });

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
  if (isTrackActive()) { renderDay(); updateProgress(); }
  else route();
}

init();
