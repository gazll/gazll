/* "Gazl Try" view — interview journal, editable in place.
   Own rows (Google Sheet) and the repo's seed entries render in one list;
   only own rows get Sửa/Xoá, seed entries get "lưu vào nhật ký" instead. */
import { Interviews } from '../lib/interviews.js';
import { Auth } from '../lib/auth.js';
import { escapeHtml as esc, renderUser, inlineUser } from '../lib/markdown.js';
import { chevSVG } from '../lib/ui.js';

const RESULT = { pending: 'Đang chờ', passed: 'Qua vòng', offer: 'Có offer', failed: 'Trượt' };

export function renderInterviews() {
  return '<div id="ivRoot" class="iv-root"><div class="page"><p class="intro">Đang tải…</p></div></div>';
}

export function mountInterviews(host) {
  const root = host.querySelector('#ivRoot');
  if (!root) return;

  const repaint = () => paint(root, repaint);
  Interviews.load().then(repaint);

  // Signing in or out while on this view switches the data source.
  const off = Auth.onChange(() => {
    if (!root.isConnected) { off(); return; }
    Interviews.load().then(repaint);
  });
}

/* ---------------------------------------------------------------------
   Render
--------------------------------------------------------------------- */

function paint(root, repaint) {
  const cos = Interviews.companies;
  const totalQ = cos.reduce((s, c) => s + (c.questions || []).length, 0);
  const editable = Interviews.editable;
  const nOwn = Interviews.ownCompanies.length;
  const nSeed = Interviews.seedCompanies.length;

  let html = '<section class="hero"><div class="hero-head"><div>'
    + '<h2>Gazl Try — Nhật ký phỏng vấn</h2>'
    + '<p class="intro">Công ty đã phỏng vấn · câu hỏi họ hỏi · cách mình trả lời.</p>'
    + '</div></div></section>';

  if (Interviews.error) {
    html += '<div class="warn"><b>Không đọc được từ backend:</b> ' + esc(Interviews.error)
      + ' — đang hiện dữ liệu mẫu từ <code>interviews.json</code>.</div>';
  }

  const breakdown = editable && nSeed
    ? ' (' + nOwn + ' của mình · ' + nSeed + ' mẫu)'
    : '';

  html += '<div class="toolbar">'
    + '<span class="sectioncount">' + cos.length + ' công ty' + breakdown + ' · ' + totalQ + ' câu hỏi'
    + (editable ? '' : ' · <span class="ro">chỉ xem</span>') + '</span>'
    // .tb-actions, not .legend: .legend is display:none below 760px.
    + '<div class="tb-actions">'
    + (editable
      ? '<button class="btn-primary" id="ivAdd">+ Thêm công ty</button>'
      : '<span class="hint">' + (Auth.enabled
        ? 'Đăng nhập Google để thêm/sửa và lưu lên Google Sheet.'
        : 'Chưa cấu hình backend — xem README để bật lưu trữ.') + '</span>')
    + '</div></div>';

  if (!cos.length) {
    html += '<div class="page"><p>' + (editable
      ? 'Chưa có công ty nào. Bấm <b>+ Thêm công ty</b> để bắt đầu.'
      : 'Chưa có dữ liệu.') + '</p></div>';
  }

  for (const c of cos) html += companyCard(c, editable);
  if (editable && nSeed) {
    html += '<p class="foot-note">Mục <b>Mẫu</b> đến từ <code>interviews.json</code> trong repo — ai cũng thấy '
      + 'và không sửa được. Bấm <b>Lưu vào nhật ký</b> để chép sang nhật ký riêng của bạn rồi sửa thoải mái.</p>';
  }
  html += formDialog();

  root.innerHTML = html;
  wire(root, repaint);
}

function companyCard(c, editable) {
  const res = c.result
    ? '<span class="result result-' + esc(c.result) + '">' + (RESULT[c.result] || esc(c.result)) + '</span>'
    : '';
  const meta = [c.role, c.date].filter(Boolean).map(esc).join(' · ');
  const stack = (c.stack || []).map(t => '<span class="tag">' + esc(t) + '</span>').join('');

  // Seed rows live in the repo, not the Sheet: importing is the only write.
  const seedBadge = c.own ? '' : '<span class="seed-badge">Mẫu</span>';
  let actions = '';
  if (editable && c.own) {
    actions = '<div class="co-actions">'
      + '<button class="btn-ghost sm" data-edit="' + esc(c.id) + '">Sửa</button>'
      + '<button class="btn-ghost sm danger" data-del="' + esc(c.id) + '">Xoá</button></div>';
  } else if (editable) {
    actions = '<div class="co-actions">'
      + '<button class="btn-ghost sm" data-import="' + esc(c.id) + '">Lưu vào nhật ký</button></div>';
  }

  const qs = (c.questions || []).map((it, idx) => {
    const round = it.round ? '<span class="qround">' + esc(it.round) + '</span>' : '';
    const note = it.note ? '<div class="takeaway"><b>Ghi chú:</b> ' + inlineUser(it.note) + '</div>' : '';
    return '<div class="qcard"><button class="qhead" aria-expanded="false">'
      + '<span class="qid">Q' + (idx + 1) + '</span>'
      + '<span class="qtext">' + inlineUser(it.q) + '</span>'
      + '<span class="qmeta">' + round + chevSVG + '</span></button>'
      + '<div class="qbody"><div class="qbody-inner"><div class="answer"><div>'
      + '<div class="ans-label">Mình trả lời</div>' + renderUser(it.a) + note
      + '</div></div></div></div></div>';
  }).join('');

  return '<div class="company' + (c.own ? '' : ' is-seed') + '">'
    + '<div class="company-head"><h3>' + esc(c.name) + '</h3>'
    + seedBadge + res + actions + '</div>'
    + (meta ? '<div class="company-meta">' + meta + '</div>' : '')
    + (stack ? '<div class="tags">' + stack + '</div>' : '')
    + (qs || '<p class="intro empty-q">Chưa có câu hỏi nào.</p>')
    + '</div>';
}

/* Add/edit form. <dialog> gives the overlay, focus trap and Esc for free. */

function formDialog() {
  return '<dialog class="modal" id="ivDialog">'
    + '<form id="ivForm" class="modal-form">'
    + '<h3 id="ivTitle">Thêm công ty</h3>'
    + '<input type="hidden" name="id">'
    + '<div class="fgrid">'
    + field('name', 'Tên công ty *', 'text', 'VD: Grab', true)
    + field('role', 'Vị trí', 'text', 'VD: Senior Backend Engineer')
    + field('date', 'Thời gian', 'text', 'VD: 2026-06')
    + '<label class="f"><span>Kết quả</span><select name="result">'
    + Object.entries(RESULT).map(([k, v]) => '<option value="' + k + '">' + v + '</option>').join('')
    + '</select></label>'
    + '</div>'
    + field('stack', 'Stack (cách nhau bởi dấu phẩy)', 'text', 'Java, Spring Boot, PostgreSQL')
    + '<div class="qeditor">'
    + '<div class="qeditor-head"><span>Câu hỏi</span>'
    + '<button type="button" class="btn-ghost sm" id="ivAddQ">+ Thêm câu hỏi</button></div>'
    + '<div id="ivQList"></div>'
    + '</div>'
    + '<p class="form-err" id="ivErr" hidden></p>'
    + '<div class="modal-actions">'
    + '<button type="button" class="btn-ghost" id="ivCancel">Huỷ</button>'
    + '<button type="submit" class="btn-primary" id="ivSave">Lưu</button>'
    + '</div></form></dialog>';
}

function field(name, label, type, placeholder, required) {
  return '<label class="f"><span>' + label + '</span>'
    + '<input type="' + type + '" name="' + name + '" placeholder="' + esc(placeholder || '') + '"'
    + (required ? ' required' : '') + '></label>';
}

/** One question block; the answer and note fields accept markdown. */
function questionRow(q = {}, idx = 0) {
  return '<div class="qrow" data-qrow>'
    + '<div class="qrow-head"><span class="qid">Q' + (idx + 1) + '</span>'
    + '<input type="text" data-f="round" placeholder="Vòng (VD: Vòng 1 · Technical)" value="' + esc(q.round || '') + '">'
    + '<button type="button" class="btn-ghost sm danger" data-rmq aria-label="Xoá câu hỏi">✕</button></div>'
    + '<textarea data-f="q" rows="2" placeholder="Câu hỏi họ hỏi *">' + esc(q.q || '') + '</textarea>'
    + '<textarea data-f="a" rows="4" placeholder="Mình trả lời (dùng được **đậm**, `code`, danh sách -)">' + esc(q.a || '') + '</textarea>'
    + '<textarea data-f="note" rows="2" placeholder="Ghi chú / rút ra được gì">' + esc(q.note || '') + '</textarea>'
    + '</div>';
}

/* ---------------------------------------------------------------------
   Wiring
--------------------------------------------------------------------- */

function wire(root, repaint) {
  root.querySelectorAll('.company .qcard').forEach(card => {
    const head = card.querySelector('.qhead');
    head.addEventListener('click', () => {
      const open = card.classList.toggle('open');
      head.setAttribute('aria-expanded', open);
    });
  });

  const dlg = root.querySelector('#ivDialog');
  const form = root.querySelector('#ivForm');
  const qlist = root.querySelector('#ivQList');
  const errEl = root.querySelector('#ivErr');
  if (!dlg || !form) return;

  const renumber = () => {
    qlist.querySelectorAll('[data-qrow]').forEach((r, i) => {
      r.querySelector('.qid').textContent = 'Q' + (i + 1);
    });
  };
  const addQ = (q) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = questionRow(q, qlist.children.length);
    qlist.appendChild(wrap.firstElementChild);
    renumber();
  };

  const open = (company) => {
    form.reset();
    errEl.hidden = true;
    root.querySelector('#ivTitle').textContent = company ? 'Sửa công ty' : 'Thêm công ty';
    form.id.value = company?.id || '';
    form.name.value = company?.name || '';
    form.role.value = company?.role || '';
    form.date.value = company?.date || '';
    form.result.value = company?.result || 'pending';
    form.stack.value = (company?.stack || []).join(', ');
    qlist.innerHTML = '';
    (company?.questions || []).forEach(q => addQ(q));
    if (!qlist.children.length) addQ();
    dlg.showModal();
  };

  root.querySelector('#ivAdd')?.addEventListener('click', () => open(null));
  root.querySelectorAll('[data-edit]').forEach(b =>
    b.addEventListener('click', () => open(Interviews.find(b.dataset.edit))));

  root.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async () => {
    const c = Interviews.find(b.dataset.del);
    if (!c || !confirm('Xoá "' + c.name + '" và toàn bộ câu hỏi của nó?')) return;
    b.disabled = true;
    try { await Interviews.remove(c.id); repaint(); }
    catch (e) { alert('Xoá không được: ' + (e.message || e)); b.disabled = false; }
  }));

  root.querySelectorAll('[data-import]').forEach(b => b.addEventListener('click', async () => {
    const c = Interviews.find(b.dataset.import);
    if (!c) return;
    b.disabled = true;
    b.textContent = 'Đang lưu…';
    try {
      await Interviews.importSeed(c.id);
      repaint();          // the copy is now an own row; the seed card drops out
    } catch (e) {
      alert('Lưu không được: ' + (e.message || e));
      b.disabled = false;
      b.textContent = 'Lưu vào nhật ký';
    }
  }));

  root.querySelector('#ivAddQ').addEventListener('click', () => addQ());
  qlist.addEventListener('click', e => {
    if (!e.target.closest('[data-rmq]')) return;
    e.target.closest('[data-qrow]').remove();
    renumber();
  });

  root.querySelector('#ivCancel').addEventListener('click', () => dlg.close());

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const save = root.querySelector('#ivSave');

    const questions = [...qlist.querySelectorAll('[data-qrow]')].map(r => {
      const get = f => r.querySelector('[data-f="' + f + '"]').value.trim();
      return { round: get('round'), q: get('q'), a: get('a'), note: get('note') };
    }).filter(q => q.q);        // drop empty blocks so the Sheet stays clean

    const company = {
      id: form.id.value || undefined,
      name: form.name.value.trim(),
      role: form.role.value.trim(),
      date: form.date.value.trim(),
      result: form.result.value,
      stack: form.stack.value.split(',').map(s => s.trim()).filter(Boolean),
      questions
    };

    save.disabled = true;
    save.textContent = 'Đang lưu…';
    try {
      await Interviews.save(company);
      dlg.close();
      repaint();
    } catch (err) {
      errEl.textContent = err.message || String(err);
      errEl.hidden = false;
    } finally {
      save.disabled = false;
      save.textContent = 'Lưu';
    }
  });
}
