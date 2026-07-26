/* Offline-first store for progress, notes and the study log.

   Why offline-first: an Apps Script round-trip costs 1-2s. Waiting on that
   after every click would be unusable, so localStorage is the write target
   and the network is a background detail.

   Writes land in localStorage immediately, get queued (also in localStorage),
   and go up as one batched `push` after a debounce. Losing the network,
   closing the tab or an expired token all leave the queue intact, so there
   is no path that loses data.

   Data is bucketed per user ('anon' for signed-out) so two people sharing a
   machine never see each other's progress. */
import { call } from './api.js';
import { Auth } from './auth.js';

const LEGACY_PROGRESS_KEY = 'javadoc.progress.v1';   // pre-sync versions of this app
const FLUSH_DELAY = 2000;

const lsGet = (k, fallback) => {
  try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
};
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
const today = () => new Date().toISOString().slice(0, 10);

const syncListeners = new Set();

export const Store = {
  /** Set<itemId> of reviewed items. */
  reviewed: new Set(),
  /** { [itemId]: { body, at } } — `at` resolves conflicts against remote. */
  notes: {},
  /**
   * 'offline'  no backend configured
   * 'local'    backend configured but signed out
   * 'syncing'  sending
   * 'synced'   queue empty
   * 'stale'    data waiting, token expired -> needs sign-in
   * 'error'    send failed, will retry
   */
  status: 'local',
  lastError: null,

  bucket: 'anon',
  queue: [],
  loggedToday: new Set(),

  _timer: null,
  _inflight: null,
  _pending: false,

  onSync(fn) { syncListeners.add(fn); return () => syncListeners.delete(fn); },
  _emit() { for (const fn of syncListeners) { try { fn(this); } catch (e) {} } },

  /* ---------- local ---------- */

  key(kind) { return 'gazl.' + kind + '.' + this.bucket; },

  loadLocal() {
    this.reviewed = new Set(lsGet(this.key('progress'), []));
    this.notes = lsGet(this.key('notes'), {}) || {};
    this.queue = lsGet(this.key('queue'), []) || [];

    const log = lsGet(this.key('logday'), null);
    this.loggedToday = new Set(log && log.day === today() ? log.ids : []);

    // Adopt progress from before sync existed. Old key is left in place.
    if (this.bucket === 'anon') {
      const legacy = lsGet(LEGACY_PROGRESS_KEY, null);
      if (Array.isArray(legacy) && legacy.length) {
        let added = false;
        for (const id of legacy) if (!this.reviewed.has(id)) { this.reviewed.add(id); added = true; }
        if (added) this._persist('progress');
      }
    }
  },

  _persist(kind) {
    if (kind === 'progress') lsSet(this.key('progress'), [...this.reviewed]);
    if (kind === 'notes') lsSet(this.key('notes'), this.notes);
    if (kind === 'queue') lsSet(this.key('queue'), this.queue);
    if (kind === 'logday') lsSet(this.key('logday'), { day: today(), ids: [...this.loggedToday] });
  },

  /* ---------- writes ---------- */

  /** True only the first time, so the caller knows to update the UI. */
  markReviewed(id) {
    this.logOpen(id);
    if (this.reviewed.has(id)) return false;
    this.reviewed.add(id);
    this._persist('progress');
    this._enqueue({ t: 'progress', id, at: new Date().toISOString() });
    return true;
  },

  getNote(id) { return (this.notes[id] && this.notes[id].body) || ''; },

  setNote(id, body) {
    const clean = String(body || '');
    if (this.getNote(id) === clean) return;
    const at = new Date().toISOString();
    this.notes[id] = { body: clean, at };
    this._persist('notes');
    this._enqueue({ t: 'note', id, body: clean, at });
  },

  /** One row per item per day — enough for the heatmap, cheap to store. */
  logOpen(id) {
    if (this.loggedToday.has(id)) return;
    this.loggedToday.add(id);
    this._persist('logday');
    this._enqueue({ t: 'log', id, at: new Date().toISOString() });
  },

  /* ---------- queue and flush ---------- */

  _enqueue(op) {
    if (!Auth.enabled || !Auth.session) return;   // signed out: nothing to sync
    this.queue.push(op);
    this._persist('queue');
    this.status = 'syncing';
    this._emit();
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), FLUSH_DELAY);
  },

  /**
   * Resolves only once the queue really went out, which the
   * `visibilitychange` handler depends on.
   *
   * Strictly one request in flight: two parallel pushes would each slice the
   * queue by their own batch length and drop the other's ops. Anything
   * enqueued mid-flight is picked up by the loop.
   */
  flush() {
    clearTimeout(this._timer);
    if (this._inflight) { this._pending = true; return this._inflight; }

    this._inflight = (async () => {
      try {
        let rounds = 0;
        do {
          this._pending = false;
          await this._flushOnce();
          // 'syncing' here means the send worked but more is queued.
        } while (this.queue.length && this.status === 'syncing' && ++rounds < 20);
      } finally {
        this._inflight = null;
        this._pending = false;
      }
    })();
    return this._inflight;
  },

  /** One batched `push`. Failed ops stay queued — never dropped. */
  async _flushOnce() {
    if (!this.queue.length || !Auth.enabled) return;

    const token = Auth.token;
    if (!token) {
      this.status = Auth.session ? 'stale' : 'local';
      this._emit();
      return;
    }

    // Snapshot what we send; ops added while in flight stay in the queue.
    const batch = this.queue.slice();
    const payload = { progress: [], notes: [], log: [] };
    const noteByItem = new Map();
    for (const op of batch) {
      if (op.t === 'progress') payload.progress.push({ item_id: op.id, reviewed_at: op.at });
      else if (op.t === 'note') noteByItem.set(op.id, { item_id: op.id, body: op.body, updated_at: op.at });
      else if (op.t === 'log') payload.log.push({ item_id: op.id, opened_at: op.at });
    }
    payload.notes = [...noteByItem.values()];   // only the last edit per item matters

    this.status = 'syncing';
    this._emit();
    try {
      await call('push', payload, token);
      this.queue = this.queue.slice(batch.length);
      this._persist('queue');
      this.status = this.queue.length ? 'syncing' : 'synced';
      this.lastError = null;
    } catch (e) {
      this.status = e.authExpired ? 'stale' : 'error';
      this.lastError = e.message || String(e);
    } finally {
      this._emit();
    }
  },

  /* ---------- sign-in / sign-out ---------- */

  attachAuth() {
    this.bucket = Auth.session ? Auth.session.sub : 'anon';
    this.loadLocal();
    if (!Auth.enabled) this.status = 'offline';

    Auth.onChange(async () => {
      const next = Auth.session ? Auth.session.sub : 'anon';

      if (next !== this.bucket) {
        // Signing in from a guest session: carry that work into the account.
        const carry = this.bucket === 'anon' && next !== 'anon'
          ? { reviewed: new Set(this.reviewed), notes: { ...this.notes } }
          : null;

        this.bucket = next;
        this.loadLocal();

        if (carry) {
          for (const id of carry.reviewed) this.reviewed.add(id);
          for (const [id, n] of Object.entries(carry.notes)) {
            const cur = this.notes[id];
            if (!cur || (n.at || '') > (cur.at || '')) this.notes[id] = n;
          }
          this._persist('progress');
          this._persist('notes');
        }

        if (!Auth.session) { this.status = 'local'; this._emit(); return; }
        await this.pullAndMerge({ pushLocal: true });
        return;
      }

      // Same user, fresh token: send whatever was waiting on it.
      if (Auth.token && this.queue.length) this.flush();
      else if (Auth.expired && this.queue.length) { this.status = 'stale'; this._emit(); }
    });

    // Last chance to send before the tab goes away.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
    });

    if (Auth.session) this.pullAndMerge({ pushLocal: true });
  },

  /** Merge remote into local, then queue whatever remote is missing. */
  async pullAndMerge({ pushLocal = false } = {}) {
    const token = Auth.token;
    if (!token) { this.status = Auth.session ? 'stale' : 'local'; this._emit(); return; }

    this.status = 'syncing';
    this._emit();

    let data;
    try {
      data = await call('pull', {}, token);
    } catch (e) {
      this.status = e.authExpired ? 'stale' : 'error';
      this.lastError = e.message || String(e);
      this._emit();
      return;
    }

    Auth.applyProfile(data.profile);

    const remoteIds = new Set((data.progress || []).map(r => r.item_id));
    const localOnly = [...this.reviewed].filter(id => !remoteIds.has(id));
    for (const id of remoteIds) this.reviewed.add(id);

    // Notes are last-write-wins on timestamp; progress is a plain union.
    const pushNoteIds = [];
    const remoteNoteIds = new Set();
    for (const r of data.notes || []) {
      remoteNoteIds.add(r.item_id);
      const cur = this.notes[r.item_id];
      if (!cur || (r.updated_at || '') >= (cur.at || '')) this.notes[r.item_id] = { body: r.body, at: r.updated_at };
      else pushNoteIds.push(r.item_id);
    }
    for (const id of Object.keys(this.notes)) {
      if (!remoteNoteIds.has(id) && this.notes[id].body) pushNoteIds.push(id);
    }

    this._persist('progress');
    this._persist('notes');

    if (pushLocal && (localOnly.length || pushNoteIds.length)) {
      const at = new Date().toISOString();
      for (const id of localOnly) this.queue.push({ t: 'progress', id, at });
      for (const id of pushNoteIds) this.queue.push({ t: 'note', id, body: this.notes[id].body, at: this.notes[id].at });
      this._persist('queue');
    }

    this.status = this.queue.length ? 'syncing' : 'synced';
    this.lastError = null;
    this._emit();
    if (this.queue.length) await this.flush();
  },

  /* ---------- reads for the stats view ---------- */

  /** Signed out, only today's local activity exists. */
  async fetchStudyLog() {
    const token = Auth.token;
    if (!token) {
      const at = new Date().toISOString();
      return [...this.loggedToday].map(id => ({ item_id: id, opened_at: at }));
    }
    try {
      const data = await call('studyLog', {}, token);
      return data.log || [];
    } catch (e) {
      return [];
    }
  }
};
