/* Admin view — activity across all users.

   The nav link is hidden for non-admins, but that is cosmetic only: the real
   gate is in Apps Script, where 'admin.overview' checks the role itself. So
   typing #/admin directly gets you nothing.

   To promote someone: Google Sheet -> `profiles` -> set `role` to admin. */
import { Auth } from '../lib/auth.js';
import { call } from '../lib/api.js';
import { Content } from '../lib/content.js';
import { escapeHtml as esc } from '../lib/markdown.js';

export function renderAdmin() {
  return '<div id="adRoot"><div class="page"><p class="intro">Loading…</p></div></div>';
}

export function mountAdmin(host) {
  const root = host.querySelector('#adRoot');
  if (!root) return;

  const load = async () => {
    if (!Auth.token) return paintMsg(root, Auth.session
      ? 'Your session ended — sign in again to view this page.'
      : 'This page needs an admin account.');
    try {
      const data = await call('admin.overview', {}, Auth.token);
      if (root.isConnected) paint(root, data.users || []);
    } catch (e) {
      if (root.isConnected) paintMsg(root, e.message || String(e));
    }
  };
  load();

  const off = Auth.onChange(() => { if (!root.isConnected) { off(); return; } load(); });
}

function paintMsg(root, msg) {
  root.innerHTML = '<section class="hero"><div class="hero-head"><div><h2>Admin</h2></div></div></section>'
    + '<div class="warn">' + esc(msg) + '</div>';
}

function paint(root, users) {
  const total = Content.totalTopicItems;
  const sum = (f) => users.reduce((s, u) => s + (Number(u[f]) || 0), 0);

  let html = '<section class="hero"><div class="hero-head"><div>'
    + '<h2>Admin — all-user overview</h2>'
    + '<p class="intro">Read straight from the Google Sheet. To change access for a user, edit the '
    + '<code>role</code> column in the <code>profiles</code> sheet.</p>'
    + '</div></div></section>';

  html += '<div class="stat-row">'
    + tile('Users', users.length)
    + tile('Admin', users.filter(u => u.role === 'admin').length)
    + tile('Items reviewed', sum('reviewed_count'))
    + tile('Notes written', sum('note_count'))
    + '</div>';

  if (!users.length) {
    root.innerHTML = html + '<div class="page"><p>Nobody has signed in yet.</p></div>';
    return;
  }

  const rows = users.map(u => {
    const pct = total ? Math.min(100, Math.round(u.reviewed_count / total * 100)) : 0;
    const av = u.picture
      ? '<img class="avatar sm" src="' + esc(u.picture) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="avatar sm avatar-fallback">' + esc((u.name || u.email || '?').slice(0, 1).toUpperCase()) + '</span>';

    return '<tr>'
      + '<td class="ad-user">' + av + '<div><b>' + esc(u.name || '—') + '</b>'
      + '<span class="ad-email">' + esc(u.email || '') + '</span></div>'
      + (u.role === 'admin' ? '<span class="rolebadge">ADMIN</span>' : '') + '</td>'
      + '<td><span class="pd-bar sm"><span class="pd-fill" style="width:' + pct + '%"></span></span>'
      + '<span class="ad-num">' + u.reviewed_count + '/' + total + '</span></td>'
      + '<td class="num">' + u.note_count + '</td>'
      + '<td class="num">' + u.interview_count + '</td>'
      + '<td class="num">' + u.active_days + '</td>'
      + '<td class="ad-when">' + esc(fmtWhen(u.last_activity || u.last_seen_at)) + '</td>'
      + '</tr>';
  }).join('');

  html += '<div class="tablewrap"><table class="adtable">'
    + '<thead><tr><th>User</th><th>Track progress</th><th class="num">Notes</th>'
    + '<th class="num">Interviews</th><th class="num">Active days</th><th>Last activity</th></tr></thead>'
    + '<tbody>' + rows + '</tbody></table></div>';

  root.innerHTML = html;
}

function tile(label, value) {
  return '<div class="stat-tile"><div class="stat-label">' + esc(label) + '</div>'
    + '<div class="stat-value">' + esc(String(value)) + '</div><div class="stat-sub"></div></div>';
}

function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return '—';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
  if (mins < 1440) { const h = Math.round(mins / 60); return h + (h === 1 ? ' hour ago' : ' hours ago'); }
  const days = Math.round(mins / 1440);
  if (days < 30) return days + (days === 1 ? ' day ago' : ' days ago');
  return d.toLocaleDateString('en-GB');
}
