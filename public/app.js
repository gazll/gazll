'use strict';

/* ---------- Markdown renderer (dependency-free, tuned to this book's subset) ----------
   Supports: paragraphs, **bold**, *italic*, `code`, "- "/"1." lists,
   ::: deep | tip | warn ::: callouts, and raw HTML blocks (SVG diagrams / tables / pre). */
function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  let i = 0, html = '';
  const SENT = ''; // private-use sentinel for protected code spans

  function inlineMd(t) {
    const codes = [];
    t = t.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return SENT + (codes.length - 1) + SENT; });
    t = t.replace(/\[\[([rgob]):([^\]]+)\]\]/g, '<span class="hl-$1">$2</span>');  // colored keyword
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    t = t.replace(new RegExp(SENT + '(\\d+)' + SENT, 'g'), (_, n) => '<code>' + codes[+n] + '</code>');
    return t;
  }
  const isSpecial = l => { const s = l.trim(); return s.startsWith(':::') || s.startsWith('<') || /^([-*]|\d+\.)\s+/.test(s); };

  while (i < lines.length) {
    if (!lines[i].trim()) { i++; continue; }
    const trimmed = lines[i].trim();

    // ::: callout container
    const cm = /^:::(deep|tip|warn)\s*(.*)$/.exec(trimmed);
    if (cm) {
      i++;
      const inner = [];
      while (i < lines.length && lines[i].trim() !== ':::') { inner.push(lines[i]); i++; }
      i++; // skip closing :::
      const label = cm[2].trim();
      if (cm[1] === 'deep') {
        html += "<div class='deep'><span class='deep-tag'>&#9656; ĐÀO SÂU · SENIOR</span>" + renderMarkdown(inner.join('\n')) + '</div>';
      } else {
        const cls = cm[1] === 'warn' ? 'warn' : 'takeaway';
        html += '<div class="' + cls + '">' + (label ? '<b>' + label + ':</b> ' : '') + inlineMd(inner.join(' ').trim()) + '</div>';
      }
      continue;
    }

    // raw HTML block (figure/svg/table/pre/...) — collect until blank line
    if (trimmed.startsWith('<')) {
      const buf = [];
      while (i < lines.length && lines[i].trim()) { buf.push(lines[i]); i++; }
      html += buf.join('\n');
      continue;
    }

    // list
    if (/^([-*]|\d+\.)\s+/.test(trimmed)) {
      const ordered = /^\d+\.\s+/.test(trimmed);
      const items = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i++; }
      const tag = ordered ? 'ol' : 'ul';
      html += '<' + tag + '>' + items.map(t => '<li>' + inlineMd(t) + '</li>').join('') + '</' + tag + '>';
      continue;
    }

    // paragraph
    const buf = [];
    while (i < lines.length && lines[i].trim() && !isSpecial(lines[i])) { buf.push(lines[i].trim()); i++; }
    html += '<p>' + inlineMd(buf.join(' ')) + '</p>';
  }
  return html;
}

/* ---------- Progress store (localStorage now; sync-ready for Supabase in Phase B) ---------- */
const Store = {
  KEY: 'javadoc.progress.v1',
  reviewed: new Set(),
  load() {
    try { this.reviewed = new Set(JSON.parse(localStorage.getItem(this.KEY) || '[]')); }
    catch (e) { this.reviewed = new Set(); }
  },
  persist() { try { localStorage.setItem(this.KEY, JSON.stringify([...this.reviewed])); } catch (e) {} },
  markReviewed(id) {
    if (this.reviewed.has(id)) return false;
    this.reviewed.add(id);
    this.persist();
    if (this.onChange) this.onChange(id);   // Phase B: push upsert to Supabase here
    return true;
  }
};

/* ---------- App ---------- */
let DAYS = [];
let INTERVIEWS = { companies: [] };
let MICRO = null;
let current = 0;
let totalQ = 0;
const panel = document.getElementById('panel');
const stepper = document.getElementById('stepper');
const dots = document.getElementById('dots');
const chevSVG = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>';
const BADGE = { hard: '<span class="qbadge hard">NÂNG CAO</span>', core: '<span class="qbadge core">QUAN TRỌNG</span>', ext: '<span class="qbadge ext">MỞ RỘNG</span>' };

/* ---------- Views / navigation (all-in-one: thêm menu = thêm 1 mục vào VIEWS) ---------- */
const GUIDE_MD = [
  'Đây là một site **all-in-one**. Thanh điều hướng trên cùng chuyển giữa các *view*; lộ trình 16 ngày chỉ là view đầu tiên. Mỗi view có URL riêng (vd `#/guide`) nên chia sẻ/bookmark được.',
  '',
  ':::tip Thêm một menu mới',
  'Mở `app.js`, thêm một phần tử vào mảng `VIEWS` — không cần sửa chỗ khác.',
  ':::',
  '',
  'Hai kiểu view:',
  '',
  '- View Markdown: `{ id: "snippets", label: "Snippets", md: "...markdown..." }`',
  '- View HTML tự do: `{ id: "tools", label: "Tools", render: () => "&lt;div&gt;...&lt;/div&gt;" }`',
  '',
  ':::deep',
  'Nội dung sách nằm ở `content.json` (JSON + Markdown). Cú pháp: **đậm**, *nghiêng*, `code`, danh sách `-`, và ba khối callout `:::tip Nhãn`, `:::warn Nhãn`, `:::deep`.',
  '',
  'Nhúng được raw HTML (sơ đồ SVG, bảng) ngay trong Markdown. Cập nhật nội dung: sửa `content.json` rồi `git push` — GitLab CI tự deploy.',
  ':::'
].join('\n');

const VIEWS = [
  { id: 'track', label: 'Lộ trình 16 ngày' },                          // view có sẵn: stepper + 210 mục
  { id: 'gazl', label: 'Gazl Try', render: renderInterviews, mount: wireCollapsibles }, // nhật ký phỏng vấn
  { id: 'micro', label: 'Microservices', render: renderMicro, mount: wireMicro }, // 10 chương microservices at scale (từ content.json → micro)
  { id: 'guide', label: 'Hướng dẫn', md: GUIDE_MD },                   // view Markdown mẫu — copy để thêm menu mới
];

/* ---- View "Gazl Try": nhật ký phỏng vấn (đọc từ interviews.json) ---- */
function escapeHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function renderUser(md) { return renderMarkdown(escapeHtml(md)); }           // markdown từ dữ liệu người dùng (an toàn HTML)
function inlineUser(md) { return renderUser(md).replace(/^<p>([\s\S]*?)<\/p>\s*$/, '$1'); }
const RESULT = { pending: 'Đang chờ', passed: 'Qua vòng', offer: 'Có offer', failed: 'Trượt' };

function renderInterviews() {
  const cos = (INTERVIEWS && INTERVIEWS.companies) || [];
  const totalQ = cos.reduce((s, c) => s + ((c.questions || []).length), 0);
  let html = '<section class="hero"><div class="hero-head"><div>' +
    '<h2>Gazl Try — Nhật ký phỏng vấn</h2>' +
    '<p class="intro">Công ty đã phỏng vấn · câu hỏi họ hỏi · cách mình trả lời. Cập nhật trong <code>interviews.json</code>.</p>' +
    '</div></div></section>';

  if (!cos.length) {
    return html + '<div class="page"><p>Chưa có dữ liệu. Thêm công ty vào <code>interviews.json</code> theo mẫu:</p>' +
      '<pre><code>{ "companies": [ { "name": "...", "role": "...", "date": "2026-06",\n  "result": "pending", "stack": ["Java"],\n  "questions": [ { "round": "Vòng 1", "q": "...", "a": "...", "note": "..." } ] } ] }</code></pre></div>';
  }

  html += '<div class="toolbar"><span class="sectioncount">' + cos.length + ' công ty · ' + totalQ + ' câu hỏi</span></div>';
  for (const c of cos) {
    const res = c.result ? '<span class="result result-' + escapeHtml(c.result) + '">' + (RESULT[c.result] || escapeHtml(c.result)) + '</span>' : '';
    const meta = [c.role, c.date].filter(Boolean).map(escapeHtml).join(' · ');
    const stack = (c.stack || []).map(t => '<span class="tag">' + escapeHtml(t) + '</span>').join('');
    const qs = (c.questions || []).map((it, idx) => {
      const round = it.round ? '<span class="qround">' + escapeHtml(it.round) + '</span>' : '';
      const note = it.note ? '<div class="takeaway"><b>Ghi chú:</b> ' + inlineUser(it.note) + '</div>' : '';
      return '<div class="qcard"><button class="qhead" aria-expanded="false">' +
        '<span class="qid">Q' + (idx + 1) + '</span>' +
        '<span class="qtext">' + inlineUser(it.q) + '</span>' +
        '<span class="qmeta">' + round + chevSVG + '</span></button>' +
        '<div class="qbody"><div class="qbody-inner"><div class="answer"><div>' +
        '<div class="ans-label">Mình trả lời</div>' + renderUser(it.a) + note +
        '</div></div></div></div></div>';
    }).join('');
    html += '<div class="company"><div class="company-head"><h3>' + escapeHtml(c.name) + '</h3>' + res + '</div>' +
      (meta ? '<div class="company-meta">' + meta + '</div>' : '') +
      (stack ? '<div class="tags">' + stack + '</div>' : '') +
      qs + '</div>';
  }
  return html;
}

function wireCollapsibles(root) {
  (root || document).querySelectorAll('.qcard').forEach(card => {
    const head = card.querySelector('.qhead');
    head.addEventListener('click', () => {
      const open = card.classList.toggle('open');
      head.setAttribute('aria-expanded', open);
    });
  });
}

/* ---- View "Microservices": 10 chương chương-collapse, đọc từ MICRO (content.json → micro) ---- */
function renderMicro() {
  const m = MICRO;
  if (!m || !m.chapters) {
    return '<div class="page"><p>Chưa có dữ liệu. Thêm khóa <code>micro</code> vào <code>content.json</code> ' +
      '(<code>{ title, intro, tags, chapters:[{ title, items:[{id,lvl,q,a}] }] }</code>).</p></div>';
  }
  const totalQ = m.chapters.reduce((s, c) => s + ((c.items || []).length), 0);
  let html = '<section class="hero"><div class="hero-head"><div>' +
    '<h2>' + m.title + '</h2>' +
    '<p class="intro">' + m.intro + '</p>' +
    '<div class="tags">' + (m.tags || []).map(t => '<span class="tag">' + t + '</span>').join('') + '</div>' +
    '</div></div></section>' +
    '<div class="toolbar"><span class="sectioncount">' + totalQ + ' mục · ' + m.chapters.length + ' chương</span>' +
    '<div class="legend"><span class="lg-core">QUAN TRỌNG</span><span class="lg-hard">NÂNG CAO</span><span class="lg-ext">MỞ RỘNG</span>' +
    '<button class="btn-ghost" id="microToggleAll">Mở tất cả</button></div></div>';

  html += m.chapters.map((ch, ci) => {
    const items = (ch.items || []).map(it => {
      const badge = BADGE[it.lvl] || '';
      const lvlClass = it.lvl ? (' lvl-' + it.lvl) : '';
      return '<div class="qcard' + lvlClass + '" data-qid="' + it.id + '">' +
        '<button class="qhead" aria-expanded="false">' +
        '<span class="qid">' + it.id + '</span>' +
        '<span class="qtext">' + it.q + '</span>' +
        '<span class="qmeta">' + badge + chevSVG + '</span></button>' +
        '<div class="qbody"><div class="qbody-inner"><div class="answer"><div>' + renderMarkdown(it.a) + '</div></div></div></div></div>';
    }).join('');
    const isOpen = ci === 0; // chương đầu mở sẵn
    return '<div class="chapter' + (isOpen ? ' open' : '') + '">' +
      '<button class="chapter-head" aria-expanded="' + isOpen + '">' +
      '<span class="chapter-title">' + ch.title + '</span>' +
      '<span class="chapter-meta">' + (ch.items || []).length + ' mục' + chevSVG + '</span>' +
      '</button>' +
      '<div class="chapter-body"><div class="chapter-body-inner">' + items + '</div></div></div>';
  }).join('');
  return html;
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
  wireCollapsibles(r); // câu hỏi bên trong vẫn collapse như cũ
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

function buildNav() {
  document.getElementById('mainnav').innerHTML = VIEWS.map(v =>
    '<a class="navlink" data-view="' + v.id + '" href="#/' + v.id + '">' + v.label + '</a>').join('');
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
  // đóng menu khi chọn một mục
  document.getElementById('mainnav').addEventListener('click', e => {
    if (e.target.closest('.navlink')) close();
  });
  // đóng menu khi chạm ra ngoài header
  document.addEventListener('click', e => {
    if (header.classList.contains('nav-open') && !e.target.closest('header.top')) close();
  });
  // đóng menu với phím Esc
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
/* ---- Header: nút thu gọn (nhớ lựa chọn) + tự ẩn khi cuộn xuống ---- */
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

  // headroom: cuộn xuống thì giấu, cuộn lên thì hiện lại
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
function route() {
  const id = location.hash.replace(/^#\/?/, '') || 'track';
  showView(VIEWS.some(v => v.id === id) ? id : 'track');
}
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

function buildStepper() {
  stepper.innerHTML = DAYS.map((d, i) =>
    '<button class="step" data-i="' + i + '" aria-current="' + (i === current) + '">' +
    '<span class="sidx">DAY ' + String(d.n).padStart(2, '0') + '</span>' +
    '<span class="slabel">' + d.label + '</span></button>').join('');
  stepper.querySelectorAll('.step').forEach(b => b.addEventListener('click', () => goTo(parseInt(b.dataset.i))));
  dots.innerHTML = DAYS.map((_, i) => '<span class="pdot' + (i === current ? ' on' : '') + '"></span>').join('');
}

function renderDay() {
  const d = DAYS[current];
  const sectionsHTML = d.sections.map(sec => {
    const items = sec.items.map(it => {
      const badge = BADGE[it.lvl] || '';
      const lvlClass = it.lvl ? (' lvl-' + it.lvl) : '';
      const done = Store.reviewed.has(it.id) ? ' done' : '';
      return '<div class="qcard' + lvlClass + done + '" data-qid="' + it.id + '">' +
        '<button class="qhead" aria-expanded="false">' +
        '<span class="qid">' + it.id + '</span>' +
        '<span class="qtext">' + it.q + '</span>' +
        '<span class="qmeta">' + badge + chevSVG + '</span></button>' +
        '<div class="qbody"><div class="qbody-inner"><div class="answer"><div>' + renderMarkdown(it.a) + '</div></div></div></div></div>';
    }).join('');
    return '<div class="section-h">' + sec.title + '<span class="sline"></span></div>' + items;
  }).join('');
  const dayQcount = d.sections.reduce((a, s) => a + s.items.length, 0);

  panel.innerHTML =
    '<section class="hero"><div class="hero-head">' +
    '<div class="daynum"><small>NGÀY</small>' + d.n + '</div>' +
    '<div><h2>' + d.title + '</h2><p class="intro">' + d.intro + '</p>' +
    '<div class="tags">' + d.tags.map(t => '<span class="tag">' + t + '</span>').join('') + '</div></div>' +
    '</div></section>' +
    '<div class="toolbar">' +
    '<span class="sectioncount">' + dayQcount + ' mục · ' + d.sections.length + ' nhóm chủ đề</span>' +
    '<div class="legend"><span class="lg-core">QUAN TRỌNG</span><span class="lg-hard">NÂNG CAO</span><span class="lg-ext">MỞ RỘNG</span>' +
    '<button class="btn-ghost" id="toggleAll">Mở tất cả</button></div>' +
    '</div>' + sectionsHTML;

  panel.querySelectorAll('.qcard').forEach(card => {
    const head = card.querySelector('.qhead');
    head.addEventListener('click', () => {
      const open = card.classList.toggle('open');
      head.setAttribute('aria-expanded', open);
      if (open && Store.markReviewed(card.dataset.qid)) { card.classList.add('done'); updateProgress(); }
      syncToggleAllLabel();
    });
  });
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
function updateProgress() {
  document.getElementById('reviewedCount').textContent = Store.reviewed.size;
  document.getElementById('totalCount').textContent = totalQ;
  document.getElementById('ring').style.setProperty('--p', totalQ ? Math.round(Store.reviewed.size / totalQ * 100) : 0);
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

async function init() {
  try {
    const res = await fetch('content.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    DAYS = data.days || data;
    MICRO = data.micro || null;
  } catch (e) {
    panel.innerHTML = '<section class="hero"><div style="padding:8px 4px">' +
      '<h2>Không tải được dữ liệu</h2>' +
      '<p class="intro">Trang đọc <code>content.json</code> qua <code>fetch</code> nên cần chạy trên một web server (HTTP), ' +
      'không mở trực tiếp bằng <code>file://</code>.</p>' +
      '<p class="intro">Xem cục bộ: mở terminal trong thư mục <code>public/</code> rồi chạy ' +
      '<code>python -m http.server 8080</code> và truy cập <code>http://localhost:8080</code>. ' +
      'Trên GitLab Pages (HTTPS) thì chạy bình thường.</p>' +
      '<p class="intro" style="color:var(--clay)">Chi tiết lỗi: ' + (e && e.message ? e.message : e) + '</p>' +
      '</div></section>';
    return;
  }

  // optional: nhật ký phỏng vấn (view "Gazl Try") — không có cũng không sao
  try {
    const r = await fetch('interviews.json', { cache: 'no-cache' });
    if (r.ok) INTERVIEWS = await r.json();
  } catch (e) { /* để trống, view sẽ hiện hướng dẫn thêm dữ liệu */ }

  Store.load();
  totalQ = DAYS.reduce((s, d) => s + d.sections.reduce((a, sec) => a + sec.items.length, 0), 0);
  document.getElementById('totDay').textContent = DAYS.length;

  buildStepper();
  renderDay();
  updateProgress();

  buildNav();
  wireNavToggle();
  wireHeader();
  window.addEventListener('hashchange', route);
  route();

  document.getElementById('prevBtn').addEventListener('click', () => goTo(current - 1));
  document.getElementById('nextBtn').addEventListener('click', () => goTo(current + 1));
  document.addEventListener('keydown', e => {
    if (e.target.closest('button')) return;
    if (!isTrackActive()) return;
    if (e.key === 'ArrowRight') goTo(current + 1);
    if (e.key === 'ArrowLeft') goTo(current - 1);
  });
}

init();
