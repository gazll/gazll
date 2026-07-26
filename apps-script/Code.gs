/**
 * gazl backend — Google Sheet as the database, Apps Script as the API.
 *
 * SECURITY MODEL. Deployed as "Execute as: Me" + "Who has access: Anyone",
 * so anyone on the internet can POST here. There is no RLS — this file is
 * the only thing enforcing access. Three rules that must never be relaxed:
 *
 *   1. Every action goes through requireUser() before touching a Sheet.
 *   2. requireUser() checks the token's `aud` equals our CLIENT_ID. Skip it
 *      and a valid Google ID token minted for ANOTHER app impersonates
 *      any user here.
 *   3. user_id always comes from the verified token's `sub`, never from
 *      anything the client sent.
 *
 * SETUP: set CLIENT_ID, run setup() once, then Deploy -> New deployment ->
 * Web app (Execute as: Me, Who has access: Anyone).
 * Editing this file needs Deploy -> Manage deployments -> New version,
 * otherwise the Web App keeps serving the old code.
 */

/** Must match GOOGLE_CLIENT_ID in the frontend config. */
var CLIENT_ID = 'PASTE_YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com';

/** Empty = any Google account may sign in, each with private data.
 *  Add emails to lock the backend to just those people. */
var ALLOWED_EMAILS = [];

/** Abuse guard: a single request may not write more rows than this. */
var MAX_ROWS_PER_PUSH = 2000;

/* ------------------------------------------------------------------ */
/* Sheet definitions                                                   */
/* ------------------------------------------------------------------ */

var SHEETS = {
  profiles:            ['user_id', 'email', 'name', 'picture', 'role', 'created_at', 'last_seen_at'],
  progress:            ['user_id', 'item_id', 'reviewed_at'],
  notes:               ['user_id', 'item_id', 'body', 'updated_at'],
  study_log:           ['user_id', 'item_id', 'opened_at'],
  interviews:          ['id', 'user_id', 'name', 'role', 'happened_on', 'result', 'stack', 'sort_order', 'created_at', 'updated_at'],
  interview_questions: ['id', 'interview_id', 'user_id', 'round', 'q', 'a', 'note', 'sort_order']
};

/** Run once by hand (Run -> setup) to create the six sheets. */
function setup() {
  for (var name in SHEETS) table(name);
  SpreadsheetApp.getActiveSpreadsheet().toast('Đã tạo/kiểm tra đủ 6 sheet.', 'gazl', 5);
}

/* ------------------------------------------------------------------ */
/* HTTP entry points                                                   */
/* ------------------------------------------------------------------ */

/** Liveness check only — returns no data. */
function doGet() {
  return json({ ok: true, service: 'gazl', time: new Date().toISOString() });
}

/**
 * The whole API. The client sends Content-Type text/plain to keep the
 * request CORS-simple, because Apps Script cannot answer preflight OPTIONS.
 * That is also why idToken travels in the body: an Authorization header
 * would trigger a preflight.
 */
function doPost(e) {
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var action = String(req.action || '');
    var payload = req.payload || {};

    var user = requireUser(req.idToken);       // always first
    var handler = ACTIONS[action];
    if (!handler) return json({ ok: false, error: 'Action không hợp lệ: ' + action });

    return json({ ok: true, data: handler(user, payload) });
  } catch (err) {
    return json({ ok: false, error: (err && err.message) || String(err) });
  }
}

/**
 * ContentService cannot set an HTTP status, so every response is 200 and the
 * outcome lives in the body as { ok, data } / { ok, error }. api.js reads
 * that `ok` flag.
 */
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

/** Verified identity { sub, email, name, picture, role }, or throws. */
function requireUser(idToken) {
  if (!idToken) throw new Error('Thiếu idToken — cần đăng nhập.');
  if (CLIENT_ID.indexOf('PASTE_YOUR') === 0) throw new Error('Backend chưa cấu hình CLIENT_ID.');

  var identity = verifyIdToken(idToken);

  if (ALLOWED_EMAILS.length && ALLOWED_EMAILS.indexOf(identity.email) === -1) {
    throw new Error('Không được phép: email này chưa nằm trong ALLOWED_EMAILS.');
  }
  return upsertProfile(identity);
}

function verifyIdToken(idToken) {
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));

  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  // Reject junk before spending UrlFetch quota: this URL is public, so a bot
  // could otherwise burn one quota unit per garbage request. Unsigned data,
  // so it filters only — tokeninfo below is what actually verifies.
  var peek = peekJwt(idToken);
  if (!peek) throw new Error('Token không đúng định dạng.');
  if (peek.aud !== CLIENT_ID) throw new Error('Token phát cho app khác (aud không khớp).');
  if (!(Number(peek.exp) > Math.floor(Date.now() / 1000))) throw new Error('Token đã hết hạn.');

  var res = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true });

  if (res.getResponseCode() !== 200) throw new Error('Token không hợp lệ hoặc đã hết hạn.');
  var info = JSON.parse(res.getContentText());

  // Dropping any of these four opens the door to impersonation.
  if (info.aud !== CLIENT_ID) throw new Error('Token phát cho app khác (aud không khớp).');
  if (info.iss !== 'accounts.google.com' && info.iss !== 'https://accounts.google.com') {
    throw new Error('Token không do Google phát (iss không khớp).');
  }
  var secondsLeft = Number(info.exp) - Math.floor(Date.now() / 1000);
  if (!(secondsLeft > 0)) throw new Error('Token đã hết hạn.');
  if (String(info.email_verified) !== 'true') throw new Error('Email chưa được Google xác minh.');

  var identity = {
    sub: info.sub,
    email: String(info.email || '').toLowerCase(),
    name: info.name || '',
    picture: info.picture || ''
  };
  cache.put(key, JSON.stringify(identity), Math.min(secondsLeft, 21600)); // 6h is the hard cap
  return identity;
}

/** Unverified JWT payload, for the cheap pre-check only. Null if unparsable. */
function peekJwt(token) {
  var parts = String(token).split('.');
  if (parts.length !== 3) return null;
  try {
    var b64 = parts[1];
    while (b64.length % 4) b64 += '=';           // JWT strips padding
    var bytes = Utilities.base64DecodeWebSafe(b64);
    return JSON.parse(Utilities.newBlob(bytes).getDataAsString('UTF-8'));
  } catch (err) {
    return null;
  }
}

/** Upserts the profiles row; returns identity with `role` from the Sheet. */
function upsertProfile(identity) {
  var t = table('profiles');
  var rows = t.read();
  var now = new Date().toISOString();

  for (var i = 0; i < rows.length; i++) {
    if (rows[i].user_id === identity.sub) {
      t.update(rows[i]._row, {
        email: identity.email,
        name: identity.name || rows[i].name,
        picture: identity.picture || rows[i].picture,
        last_seen_at: now
      });
      identity.role = rows[i].role || 'user';
      return identity;
    }
  }

  t.appendAll([{
    user_id: identity.sub, email: identity.email, name: identity.name,
    picture: identity.picture, role: 'user', created_at: now, last_seen_at: now
  }]);
  identity.role = 'user';
  return identity;
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

var ACTIONS = {

  /** Everything the client needs to merge against its localStorage copy. */
  'pull': function (user) {
    return {
      profile: { email: user.email, name: user.name, picture: user.picture, role: user.role },
      progress: mine(table('progress').read(), user).map(function (r) {
        return { item_id: r.item_id, reviewed_at: iso(r.reviewed_at) };
      }),
      notes: mine(table('notes').read(), user).map(function (r) {
        return { item_id: r.item_id, body: r.body, updated_at: iso(r.updated_at) };
      })
    };
  },

  /** Batched write. Idempotent per item_id, so a retry cannot duplicate. */
  'push': function (user, p) {
    var progress = asArray(p.progress), notes = asArray(p.notes), log = asArray(p.log);
    if (progress.length + notes.length + log.length > MAX_ROWS_PER_PUSH) {
      throw new Error('Request quá lớn (giới hạn ' + MAX_ROWS_PER_PUSH + ' dòng).');
    }

    return withLock(function () {
      var counts = { progress: 0, notes: 0, log: 0 };

      if (progress.length) {
        counts.progress = upsertByKey(table('progress'), user, progress, ['item_id'], function (r) {
          return { user_id: user.sub, item_id: String(r.item_id), reviewed_at: iso(r.reviewed_at) || nowIso() };
        });
      }
      if (notes.length) {
        counts.notes = upsertByKey(table('notes'), user, notes, ['item_id'], function (r) {
          return { user_id: user.sub, item_id: String(r.item_id), body: String(r.body || ''), updated_at: iso(r.updated_at) || nowIso() };
        });
      }
      if (log.length) {
        // Append-only: one row per open is the point, so never upsert.
        counts.log = log.length;
        table('study_log').appendAll(log.map(function (r) {
          return { user_id: user.sub, item_id: String(r.item_id), opened_at: iso(r.opened_at) || nowIso() };
        }));
      }
      return counts;
    });
  },

  /** Feeds the streak and heatmap in the stats view. */
  'studyLog': function (user) {
    return {
      log: mine(table('study_log').read(), user).map(function (r) {
        return { item_id: r.item_id, opened_at: iso(r.opened_at) };
      })
    };
  },

  /** Companies with their questions nested, so the view needs one call. */
  'interviews.list': function (user) {
    var qs = mine(table('interview_questions').read(), user);
    var byInterview = {};
    qs.sort(bySort).forEach(function (q) {
      (byInterview[q.interview_id] = byInterview[q.interview_id] || []).push({
        id: q.id, round: q.round, q: q.q, a: q.a, note: q.note
      });
    });

    return {
      companies: mine(table('interviews').read(), user).sort(bySort).map(function (r) {
        return {
          id: r.id, name: r.name, role: r.role, date: r.happened_on, result: r.result || 'pending',
          stack: String(r.stack || '').split(',').map(trim).filter(Boolean),
          sort_order: Number(r.sort_order) || 0,
          questions: byInterview[r.id] || []
        };
      })
    };
  },

  /** One company plus all its questions in a single round-trip. */
  'interviews.save': function (user, p) {
    var c = p.company || {};
    if (!String(c.name || '').trim()) throw new Error('Tên công ty không được để trống.');
    var questions = asArray(c.questions);
    if (questions.length > 200) throw new Error('Tối đa 200 câu hỏi cho một công ty.');

    return withLock(function () {
      var t = table('interviews');
      var rows = mine(t.read(), user);
      var existing = c.id ? findBy(rows, 'id', c.id) : null;
      var id = existing ? existing.id : uuid();

      var fields = {
        id: id, user_id: user.sub,
        name: String(c.name).trim(),
        role: String(c.role || ''),
        happened_on: String(c.date || ''),
        result: ['pending', 'passed', 'offer', 'failed'].indexOf(c.result) >= 0 ? c.result : 'pending',
        stack: asArray(c.stack).map(trim).filter(Boolean).join(', '),
        sort_order: Number(c.sort_order) || 0,
        updated_at: nowIso()
      };

      if (existing) t.update(existing._row, fields);
      else t.appendAll([extend(fields, { created_at: nowIso() })]);

      // Replace rather than diff: keeps row order identical to the UI.
      var qt = table('interview_questions');
      qt.deleteWhere(function (r) { return r.user_id === user.sub && r.interview_id === id; });
      if (questions.length) {
        qt.appendAll(questions.map(function (q, i) {
          return {
            id: q.id || uuid(), interview_id: id, user_id: user.sub,
            round: String(q.round || ''), q: String(q.q || ''),
            a: String(q.a || ''), note: String(q.note || ''), sort_order: i
          };
        }));
      }
      return { id: id };
    });
  },

  'interviews.delete': function (user, p) {
    var id = String(p.id || '');
    if (!id) throw new Error('Thiếu id.');
    return withLock(function () {
      var n = table('interviews').deleteWhere(function (r) { return r.user_id === user.sub && r.id === id; });
      table('interview_questions').deleteWhere(function (r) { return r.user_id === user.sub && r.interview_id === id; });
      return { deleted: n };
    });
  },

  /** Admin-only; hiding the menu client-side is cosmetic, this is the gate. */
  'admin.overview': function (user) {
    if (user.role !== 'admin') throw new Error('Không được phép: cần quyền admin.');

    var count = function (rows, pred) {
      var m = {};
      rows.forEach(function (r) {
        if (pred && !pred(r)) return;
        m[r.user_id] = (m[r.user_id] || 0) + 1;
      });
      return m;
    };
    var progress = count(table('progress').read());
    var notes = count(table('notes').read(), function (r) { return String(r.body || '').length > 0; });
    var interviews = count(table('interviews').read());
    var logRows = table('study_log').read();
    var opens = count(logRows);

    var lastSeen = {}, days = {};
    logRows.forEach(function (r) {
      var at = iso(r.opened_at);
      if (!at) return;
      if (!lastSeen[r.user_id] || at > lastSeen[r.user_id]) lastSeen[r.user_id] = at;
      (days[r.user_id] = days[r.user_id] || {})[at.slice(0, 10)] = 1;
    });

    return {
      users: table('profiles').read().map(function (p) {
        return {
          user_id: p.user_id, email: p.email, name: p.name, picture: p.picture,
          role: p.role || 'user',
          created_at: iso(p.created_at), last_seen_at: iso(p.last_seen_at),
          reviewed_count: progress[p.user_id] || 0,
          note_count: notes[p.user_id] || 0,
          interview_count: interviews[p.user_id] || 0,
          open_count: opens[p.user_id] || 0,
          active_days: Object.keys(days[p.user_id] || {}).length,
          last_activity: lastSeen[p.user_id] || ''
        };
      }).sort(function (a, b) { return (b.last_activity || '').localeCompare(a.last_activity || ''); })
    };
  }
};

/* ------------------------------------------------------------------ */
/* Sheet-as-table helper                                               */
/* ------------------------------------------------------------------ */

/**
 * Table-shaped wrapper over a sheet. Everything reads and writes in one
 * batch: each Spreadsheet API call is a round-trip, and per-cell access is
 * what makes Apps Script slow.
 */
function table(name) {
  var headers = SHEETS[name];
  if (!headers) throw new Error('Sheet chưa khai báo: ' + name);

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // Plain text for timestamps: otherwise Sheets parses the ISO string into
    // a Date, hands back an object, and the note merge compares wrong.
    headers.forEach(function (h, i) {
      if (/_at$/.test(h)) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  }

  var api = {
    sheet: sh,
    headers: headers,

    /** Rows as objects; _row is the real sheet row, needed by update(). */
    read: function () {
      var last = sh.getLastRow();
      if (last < 2) return [];
      var values = sh.getRange(2, 1, last - 1, headers.length).getValues();
      var out = [];
      for (var i = 0; i < values.length; i++) {
        if (String(values[i][0] || '') === '') continue;      // blank row
        var o = { _row: i + 2 };
        for (var c = 0; c < headers.length; c++) o[headers[c]] = values[i][c];
        out.push(o);
      }
      return out;
    },

    /** Partial update: only headers present in `fields` are touched. */
    update: function (row, fields) {
      var cur = sh.getRange(row, 1, 1, headers.length).getValues()[0];
      for (var c = 0; c < headers.length; c++) {
        if (Object.prototype.hasOwnProperty.call(fields, headers[c])) cur[c] = fields[headers[c]];
      }
      sh.getRange(row, 1, 1, headers.length).setValues([cur]);
    },

    /** Many rows in a single setValues. */
    appendAll: function (objs) {
      if (!objs || !objs.length) return 0;
      var block = objs.map(function (o) {
        return headers.map(function (h) { return o[h] === undefined || o[h] === null ? '' : o[h]; });
      });
      sh.getRange(sh.getLastRow() + 1, 1, block.length, headers.length).setValues(block);
      return block.length;
    },

    /** Deletes bottom-up, otherwise each removal shifts the rows below. */
    deleteWhere: function (pred) {
      var rows = api.read().filter(pred).map(function (r) { return r._row; });
      rows.sort(function (a, b) { return b - a; });
      rows.forEach(function (r) { sh.deleteRow(r); });
      return rows.length;
    }
  };
  return api;
}

/** Existing rows updated in place, new ones batched into one append. */
function upsertByKey(t, user, incoming, keyFields, mapRow) {
  var existing = {};
  mine(t.read(), user).forEach(function (r) { existing[keyOf(r, keyFields)] = r; });

  var toAppend = [], seen = {}, n = 0;
  incoming.forEach(function (raw) {
    var row = mapRow(raw);
    var k = keyOf(row, keyFields);
    if (!k || seen[k]) return;                 // duplicate in batch: keep the first
    seen[k] = 1;
    n++;
    if (existing[k]) t.update(existing[k]._row, row);
    else toAppend.push(row);
  });
  t.appendAll(toAppend);
  return n;
}

/** '|' is safe as a separator: item_ids look like '1.1' / 'M1.1'. */
function keyOf(row, fields) {
  return fields.map(function (f) { return String(row[f] == null ? '' : row[f]); }).join('|');
}

/** Every read must pass through here — this is the ownership boundary. */
function mine(rows, user) {
  return rows.filter(function (r) { return String(r.user_id) === String(user.sub); });
}

function findBy(rows, field, val) {
  for (var i = 0; i < rows.length; i++) if (String(rows[i][field]) === String(val)) return rows[i];
  return null;
}

/** Concurrent requests would otherwise clobber each other's rows. */
function withLock(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('Server đang bận, thử lại sau.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

function asArray(v) { return Array.isArray(v) ? v : []; }
function trim(s) { return String(s == null ? '' : s).trim(); }
function nowIso() { return new Date().toISOString(); }
function extend(a, b) { for (var k in b) a[k] = b[k]; return a; }
function bySort(a, b) { return (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0); }
function uuid() { return Utilities.getUuid(); }

/** Sheets may hand back a Date; the client compares these as strings. */
function iso(v) {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
