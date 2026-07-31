/* Interview journal data layer.

   Two lists, always shown merged: the reader's own rows from the Google Sheet
   (writable, signed in only) and the repo's interviews.json (read-only, always
   available). Signed out that leaves only the seed; signed in the seed stays
   visible underneath as reference, so shared entries do not vanish the moment
   someone logs in. The seed is also the fallback when the backend is down.

   `own` is what tells the two apart everywhere else — only own rows can be
   edited or deleted, because only they exist in the Sheet. */
import { call } from './api.js';
import { Auth } from './auth.js';

export const Interviews = {
  companies: [],
  /** 'seed' = interviews.json only | 'remote' = Sheet rows + seed. */
  source: 'seed',
  loading: false,
  error: null,

  /** True when the Sheet is reachable, i.e. own rows can be written. */
  get editable() { return this.source === 'remote'; },

  get ownCompanies() { return this.companies.filter(c => c.own); },
  get seedCompanies() { return this.companies.filter(c => !c.own); },

  async load() {
    this.loading = true;
    this.error = null;
    const token = Auth.token;
    const seed = await loadSeed();

    if (!token) {
      this.companies = seed;
      this.source = 'seed';
      this.loading = false;
      return;
    }

    try {
      const data = await call('interviews.list', {}, token);
      const own = (data.companies || []).map(c => ({ ...c, own: true }));
      this.companies = own.concat(unclaimed(seed, own));
      this.source = 'remote';
    } catch (e) {
      this.error = e.message || String(e);
      this.companies = seed;
      this.source = 'seed';
    }
    this.loading = false;
  },

  /** Copy a seed company into the reader's own Sheet rows. */
  async importSeed(id) {
    const c = this.find(id);
    if (!c) throw new Error('Không tìm thấy công ty này.');
    if (c.own) throw new Error('Công ty này đã nằm trong nhật ký của bạn.');
    return this.save({
      name: c.name,
      role: c.role,
      date: c.date,
      result: c.result,
      stack: c.stack || [],
      // Drop every id: these become new rows, not an edit of the seed.
      questions: (c.questions || []).map(q => ({ round: q.round, q: q.q, a: q.a, note: q.note }))
    });
  },

  /** No id = create. The backend replaces the whole question set. */
  async save(company) {
    const token = requireToken();
    const { id } = await call('interviews.save', { company }, token);
    await this.load();
    return id;
  },

  async remove(id) {
    const token = requireToken();
    await call('interviews.delete', { id }, token);
    await this.load();
  },

  find(id) { return this.companies.find(c => String(c.id) === String(id)) || null; }
};

function requireToken() {
  const token = Auth.token;
  if (!token) {
    throw new Error(Auth.session
      ? 'Phiên đăng nhập đã hết hạn — đăng nhập lại rồi thử lại.'
      : 'Cần đăng nhập Google để lưu nhật ký phỏng vấn.');
  }
  return token;
}

/* Sheet ids are UUIDs, so the 'seed-' prefix can never collide with one —
   which is what lets both lists share a single id space in the view. */
async function loadSeed() {
  try {
    const res = await fetch('interviews.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.companies || []).map((c, i) => ({ ...c, id: 'seed-' + i, own: false }));
  } catch (e) {
    return [];
  }
}

const norm = s => String(s || '').trim().toLowerCase();

/** Seed entries the reader has not already imported, matched on company name. */
function unclaimed(seed, own) {
  const taken = new Set(own.map(c => norm(c.name)));
  return seed.filter(c => !taken.has(norm(c.name)));
}
