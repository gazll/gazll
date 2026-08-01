/* Stats view — streak, heatmap and per-day track progress.
   Sourced from study_log (one row per item per day) plus Store.reviewed.
   Signed out there is only today's data, and the view says so. */
import { Store } from '../lib/store.js';
import { Auth } from '../lib/auth.js';
import { Content } from '../lib/content.js';
import { escapeHtml as esc } from '../lib/markdown.js';
import { localDay } from '../lib/ui.js';

const WEEKS = 26;                  // half a year: wide enough, still fits mobile
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function renderStats() {
  return '<div id="stRoot"><div class="page"><p class="intro">Loading…</p></div></div>';
}

export function mountStats(host) {
  const root = host.querySelector('#stRoot');
  if (!root) return;

  const load = () => Store.fetchStudyLog().then(log => { if (root.isConnected) paint(root, log); });
  load();

  const off = Auth.onChange(() => { if (!root.isConnected) { off(); return; } load(); });
}

function paint(root, log) {
  const byDay = new Map();
  for (const r of log) {
    if (!r.opened_at) continue;
    const d = new Date(r.opened_at);
    if (isNaN(d)) continue;
    const key = localDay(d);
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }

  const streak = streaks([...byDay.keys()]);
  const reviewed = Store.reviewed;
  const topicIds = Content.topicItemIds;
  const trackDone = [...reviewed].filter(id => topicIds.has(id)).length;
  const total = Content.totalTopicItems;

  let html = '<section class="hero"><div class="hero-head"><div>'
    + '<h2>Study statistics</h2>'
    + '<p class="intro">Opening an item for the first time on a given day writes one row — that is what every chart below is built from.</p>'
    + '</div></div></section>';

  if (!Auth.session) {
    html += '<div class="warn"><b>Not signed in:</b> you are only seeing today, from this device. '
      + 'Sign in with Google to keep the full history and read it back.</div>';
  }

  html += '<div class="stat-row">'
    + tile('Reviewed', trackDone + ' / ' + total, total ? Math.round(trackDone / total * 100) + '% of the track' : '')
    + tile('Active days', byDay.size, byDay.size ? 'all time' : 'none yet')
    + tile('Current streak', streak.current, streak.current ? 'days in a row' : 'start one today')
    + tile('Longest streak', streak.longest, 'days in a row')
    + '</div>';

  html += heatmap(byDay);
  html += perDay(reviewed);

  root.innerHTML = html;
}

function tile(label, value, sub) {
  return '<div class="stat-tile"><div class="stat-label">' + esc(label) + '</div>'
    + '<div class="stat-value">' + esc(String(value)) + '</div>'
    + '<div class="stat-sub">' + esc(sub || '') + '</div></div>';
}

/* ---------- streak ---------- */

/**
 * `current` still counts if today is empty but yesterday was not — otherwise
 * the streak would read as broken every morning before you start.
 */
function streaks(dayKeys) {
  if (!dayKeys.length) return { current: 0, longest: 0 };
  const days = [...new Set(dayKeys)].sort();
  const set = new Set(days);

  let longest = 1, run = 1;
  for (let i = 1; i < days.length; i++) {
    run = daysApart(days[i - 1], days[i]) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }

  const today = localDay();
  const yesterday = localDay(new Date(Date.now() - 86400000));
  let cursor = set.has(today) ? today : (set.has(yesterday) ? yesterday : null);
  let current = 0;
  while (cursor && set.has(cursor)) {
    current++;
    cursor = localDay(new Date(new Date(cursor + 'T12:00:00').getTime() - 86400000));
  }
  return { current, longest };
}

function daysApart(a, b) {
  // Noon, so DST transitions cannot shift the day count.
  const ms = new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00');
  return Math.round(ms / 86400000);
}

/* ---------- heatmap ---------- */

function heatmap(byDay) {
  const today = new Date();
  // Align the grid to whole weeks ending this Saturday.
  const end = new Date(today);
  end.setDate(end.getDate() - end.getDay() + 6);
  const start = new Date(end);
  start.setDate(start.getDate() - (WEEKS * 7 - 1));

  const max = Math.max(1, ...byDay.values());
  const cols = [];
  const monthLabels = [];
  let cursor = new Date(start);

  for (let w = 0; w < WEEKS; w++) {
    let cells = '';
    let labelForWeek = '';
    for (let d = 0; d < 7; d++) {
      const key = localDay(cursor);
      const n = byDay.get(key) || 0;
      const future = cursor > today;
      const lvl = future ? 'f' : level(n, max);
      const title = future ? '' : key + ' · ' + n + (n === 1 ? ' item' : ' items');
      cells += '<span class="hm-cell lvl-' + lvl + '"'
        + (title ? ' title="' + title + '"' : '') + '></span>';
      if (cursor.getDate() <= 7 && d === 0) labelForWeek = MONTHS[cursor.getMonth()];
      cursor.setDate(cursor.getDate() + 1);
    }
    cols.push('<div class="hm-col">' + cells + '</div>');
    monthLabels.push('<span class="hm-mlabel">' + labelForWeek + '</span>');
  }

  return '<div class="toolbar"><span class="sectioncount">Activity, last ' + WEEKS + ' weeks</span>'
    + '<div class="hm-legend"><span>less</span>'
    + [0, 1, 2, 3, 4].map(l => '<span class="hm-cell lvl-' + l + '"></span>').join('')
    + '<span>more</span></div></div>'
    + '<div class="heatmap-wrap"><div class="heatmap">'
    + '<div class="hm-months">' + monthLabels.join('') + '</div>'
    + '<div class="hm-grid">' + cols.join('') + '</div>'
    + '</div></div>';
}

function level(n, max) {
  if (!n) return 0;
  const r = n / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

/* ---------- per-topic track progress ---------- */

function perDay(reviewed) {
  const rows = Content.topicCounts().map(t => {
    const done = t.ids.filter(id => reviewed.has(id)).length;
    const pct = t.ids.length ? Math.round(done / t.ids.length * 100) : 0;
    return '<a class="pd-row" href="#/track" data-day="' + t.n + '" data-topic-type="' + esc(t.topic_type) + '">'
      + '<span class="pd-n">' + String(t.n).padStart(2, '0') + '</span>'
      + '<span class="pd-label">' + esc(t.label) + '</span>'
      + '<span class="pd-bar"><span class="pd-fill" style="width:' + pct + '%"></span></span>'
      + '<span class="pd-num">' + done + '/' + t.ids.length + '</span></a>';
  }).join('');

  return '<div class="toolbar"><span class="sectioncount">Progress by topic</span></div>'
    + '<div class="perday">' + rows + '</div>';
}
