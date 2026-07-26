/* Interview journal data layer.

   Signed in -> Google Sheet, read/write. Signed out -> interviews.json from
   the repo, read-only. The fallback means guests still see content and the
   view never goes blank if the backend is down. */
import { call } from './api.js';
import { Auth } from './auth.js';

export const Interviews = {
  companies: [],
  /** 'seed' = interviews.json (read-only) | 'remote' = Sheet (writable). */
  source: 'seed',
  loading: false,
  error: null,

  get editable() { return this.source === 'remote'; },

  async load() {
    this.loading = true;
    this.error = null;
    const token = Auth.token;

    if (!token) {
      this.companies = await loadSeed();
      this.source = 'seed';
      this.loading = false;
      return;
    }

    try {
      const data = await call('interviews.list', {}, token);
      this.companies = data.companies || [];
      this.source = 'remote';
    } catch (e) {
      this.error = e.message || String(e);
      this.companies = await loadSeed();
      this.source = 'seed';
    }
    this.loading = false;
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

async function loadSeed() {
  try {
    const res = await fetch('interviews.json', { cache: 'no-cache' });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.companies || []).map((c, i) => ({ ...c, id: c.id || 'seed-' + i }));
  } catch (e) {
    return [];
  }
}
