/* "Gazl Try" view — interview journal, editable in place.
   Own rows (Google Sheet) and the repo's seed entries render in one list;
   only own rows get Edit/Delete, seed entries get "Save to my journal" instead. */
import { Interviews } from '../lib/interviews.js';
import { Auth } from '../lib/auth.js';
import { escapeHtml as esc, renderUser, inlineUser } from '../lib/markdown.js';
import { chevSVG } from '../lib/ui.js';

const RESULT = { pending: 'Pending', passed: 'Passed', offer: 'Offer', failed: 'Rejected' };

export function renderInterviews() {
  return '<div id="ivRoot" class="iv-root"><div class="page"><p class="intro">Loading…</p></div></div>';
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
    + '<h2>Gazl Try — interview journal</h2>'
    + '<p class="intro">Companies interviewed · what they asked · how I answered.</p>'
    + '</div></div></section>';

  if (Interviews.error) {
    html += '<div class="warn"><b>Could not read from the backend:</b> ' + esc(Interviews.error)
      + ' — showing the sample entries from <code>interviews.json</code> instead.</div>';
  }

  const breakdown = editable && nSeed
    ? ' (' + nOwn + ' mine · ' + nSeed + ' samples)'
    : '';

  html += '<div class="toolbar">'
    + '<span class="sectioncount">' + cos.length + (cos.length === 1 ? ' company' : ' companies') + breakdown
    + ' · ' + totalQ + (totalQ === 1 ? ' question' : ' questions')
    + (editable ? '' : ' · <span class="ro">read-only</span>') + '</span>'
    // .tb-actions, not .legend: .legend is display:none below 760px.
    + '<div class="tb-actions">'
    + (editable
      ? '<button class="btn-primary" id="ivAdd">+ Add company</button>'
      : '<span class="hint">' + (Auth.enabled
        ? 'Sign in with Google to add or edit entries and save them to your Sheet.'
        : 'No backend configured — see the README to turn on storage.') + '</span>')
    + '</div></div>';

  if (!cos.length) {
    html += '<div class="page"><p>' + (editable
      ? 'No companies yet. Hit <b>+ Add company</b> to start.'
      : 'Nothing here yet.') + '</p></div>';
  }

  for (const c of cos) html += companyCard(c, editable);
  if (editable && nSeed) {
    html += '<p class="foot-note">Entries marked <b>Sample</b> come from <code>interviews.json</code> in the repo — '
      + 'everyone sees them and nobody can edit them. Hit <b>Save to my journal</b> to copy one into your own '
      + 'journal, where it is yours to edit.</p>';
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
  const seedBadge = c.own ? '' : '<span class="seed-badge">Sample</span>';
  let actions = '';
  if (editable && c.own) {
    actions = '<div class="co-actions">'
      + '<button class="btn-ghost sm" data-edit="' + esc(c.id) + '">Edit</button>'
      + '<button class="btn-ghost sm danger" data-del="' + esc(c.id) + '">Delete</button></div>';
  } else if (editable) {
    actions = '<div class="co-actions">'
      + '<button class="btn-ghost sm" data-import="' + esc(c.id) + '">Save to my journal</button></div>';
  }

  const qs = (c.questions || []).map((it, idx) => {
    const round = it.round ? '<span class="qround">' + esc(it.round) + '</span>' : '';
    const note = it.note ? '<div class="takeaway"><b>Takeaway:</b> ' + inlineUser(it.note) + '</div>' : '';
    return '<div class="qcard"><button class="qhead" aria-expanded="false">'
      + '<span class="qid">Q' + (idx + 1) + '</span>'
      + '<span class="qtext">' + inlineUser(it.q) + '</span>'
      + '<span class="qmeta">' + round + chevSVG + '</span></button>'
      + '<div class="qbody"><div class="qbody-inner"><div class="answer"><div>'
      + '<div class="ans-label">How I answered</div>' + renderUser(it.a) + note
      + '</div></div></div></div></div>';
  }).join('');

  return '<div class="company' + (c.own ? '' : ' is-seed') + '">'
    + '<div class="company-head"><h3>' + esc(c.name) + '</h3>'
    + seedBadge + res + actions + '</div>'
    + (meta ? '<div class="company-meta">' + meta + '</div>' : '')
    + (stack ? '<div class="tags">' + stack + '</div>' : '')
    + (qs || '<p class="intro empty-q">No questions recorded yet.</p>')
    + '</div>';
}

/* Add/edit form. <dialog> gives the overlay, focus trap and Esc for free. */

function formDialog() {
  return '<dialog class="modal" id="ivDialog">'
    + '<form id="ivForm" class="modal-form">'
    + '<h3 id="ivTitle">Add company</h3>'
    + '<input type="hidden" name="id">'
    + '<div class="fgrid">'
    + field('name', 'Company name *', 'text', 'e.g. Grab', true)
    + field('role', 'Role', 'text', 'e.g. Senior Backend Engineer')
    + field('date', 'When', 'text', 'e.g. 2026-06')
    + '<label class="f"><span>Result</span><select name="result">'
    + Object.entries(RESULT).map(([k, v]) => '<option value="' + k + '">' + v + '</option>').join('')
    + '</select></label>'
    + '</div>'
    + field('stack', 'Stack (comma separated)', 'text', 'Java, Spring Boot, PostgreSQL')
    + '<div class="qeditor">'
    + '<div class="qeditor-head"><span>Questions</span>'
    + '<button type="button" class="btn-ghost sm" id="ivAddQ">+ Add question</button></div>'
    + '<div id="ivQList"></div>'
    + '</div>'
    + '<p class="form-err" id="ivErr" hidden></p>'
    + '<div class="modal-actions">'
    + '<button type="button" class="btn-ghost" id="ivCancel">Cancel</button>'
    + '<button type="submit" class="btn-primary" id="ivSave">Save</button>'
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
    + '<input type="text" data-f="round" placeholder="Round (e.g. Round 1 · Technical)" value="' + esc(q.round || '') + '">'
    + '<button type="button" class="btn-ghost sm danger" data-rmq aria-label="Remove question">✕</button></div>'
    + '<textarea data-f="q" rows="2" placeholder="What they asked *">' + esc(q.q || '') + '</textarea>'
    + '<textarea data-f="a" rows="4" placeholder="How I answered (**bold**, `code` and - lists work here)">' + esc(q.a || '') + '</textarea>'
    + '<textarea data-f="note" rows="2" placeholder="Takeaway / what to do differently">' + esc(q.note || '') + '</textarea>'
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
    root.querySelector('#ivTitle').textContent = company ? 'Edit company' : 'Add company';
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
    if (!c || !confirm('Delete "' + c.name + '" and every question under it?')) return;
    b.disabled = true;
    try { await Interviews.remove(c.id); repaint(); }
    catch (e) { alert('Could not delete: ' + (e.message || e)); b.disabled = false; }
  }));

  root.querySelectorAll('[data-import]').forEach(b => b.addEventListener('click', async () => {
    const c = Interviews.find(b.dataset.import);
    if (!c) return;
    b.disabled = true;
    b.textContent = 'Saving…';
    try {
      await Interviews.importSeed(c.id);
      repaint();          // the copy is now an own row; the seed card drops out
    } catch (e) {
      alert('Could not save: ' + (e.message || e));
      b.disabled = false;
      b.textContent = 'Save to my journal';
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
    save.textContent = 'Saving…';
    try {
      await Interviews.save(company);
      dlg.close();
      repaint();
    } catch (err) {
      errEl.textContent = err.message || String(err);
      errEl.hidden = false;
    } finally {
      save.disabled = false;
      save.textContent = 'Save';
    }
  });
}
