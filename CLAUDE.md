# CLAUDE.md

## Project

Vietnamese-language study site for backend engineering interview prep. No
framework, no build step, no package.json — vanilla ES modules served straight
to the browser. `public/` is published to GitHub Pages by GitHub Actions.

UI strings are Vietnamese and stay that way. Code comments are English.

## Layout

```
public/
  index.html         shell; loads app.js as <script type="module">
  app.js             entry: hash router, topic track view, Microservices view
  config.js          GITIGNORED. Generated at deploy time from repo variables
  config.example.js  template to copy for local dev
  lib/
    markdown.js      renderMarkdown + renderUser (escaping variant)
    ui.js            chevSVG, BADGE, debounce, localDay
    content.js       loads content.json once, shared by all views
    api.js           transport to Apps Script
    auth.js          Google Identity Services + header chip
    store.js         offline-first progress, notes, study log
    interviews.js    interview journal data layer
  views/
    interviews.js    interview journal CRUD (<dialog>)
    stats.js         streak + heatmap + per-topic progress
    admin.js         all-user overview (admin role only)
  content.json       234 track items + 42 microservices items
  interviews.json    seed entries, merged under everyone's own Sheet rows
apps-script/Code.gs  the entire backend (Google Sheet as database)
secret/              GITIGNORED. Personal setup notes and credentials
```

## Things that break easily

- **`lib/markdown.js` — the `SENT` sentinel.** It is
  `String.fromCharCode(0xE000)` on purpose. U+E000 is invisible in an editor,
  and if it degrades to an empty string the regex wraps **every number** in
  `<code>`. Do not "tidy" that line into a literal.

- **`item_id` is one flat key space.** Track items are `1.1`–`19.8`,
  microservices items are `M1.1`–`M10.6`. They do not collide, which is why
  `progress` and `notes` can share a single id column.

  A topic's `n` and its items' id prefix are **stored keys**, not display
  order. Renumbering a topic orphans every `progress` and `notes` row already
  in the Sheet — append new topics at the end instead.

- **The progress ring counts track items only.** `Store.reviewed` also holds
  microservices items, so `updateProgress()` intersects with
  `Content.dayItemIds` first — otherwise it exceeds the track denominator and
  renders past 100%. The denominator is derived, never hardcoded.

- **Every topic needs a `group`.** One of `core` · `data` · `design` ·
  `platform` · `algorithm`. It drives the stepper chip, the filter bar
  (`buildGroupBar`) and the hero accent; the colours are the
  `[data-group="…"]` custom-property blocks in `styles.css`. A topic with an
  unknown group renders with no accent colour and drops out of the filter bar.

- **Raw HTML blocks in `content.json` end at the first blank line.**
  `renderMarkdown` collects lines starting with `<` until a blank one, so a
  blank line inside a `<pre>` or `<table>` truncates it and dumps the rest as
  literal text. Use a comment-only line as a separator instead.

- **The interview journal merges two sources; `own` separates them.** Sheet
  rows carry `own: true`, `interviews.json` entries `own: false` and an id of
  `seed-N` (Sheet ids are UUIDs, so they cannot collide). Only own rows may be
  edited or deleted — a seed row has no Sheet row behind it, so `Sửa`/`Xoá`
  would fail. `importSeed()` copies one across, stripping every id so the
  backend creates new rows rather than editing. Seed entries whose name
  matches an own row are dropped, which is what makes import look in-place.

- **Syntax-highlight classes are scoped to `pre code`.** `.k .s .c .n .r .f`
  are one letter long and collide with UI classes — `.f` is also the interview
  modal's form-field class (`display:flex;flex-direction:column`), which put
  every highlighted function name on its own line until both sides were
  scoped. Keep new palette rules under `pre code`.

- **`Store.flush()` must stay serialized.** Two parallel pushes each slice the
  queue by their own `batch.length` and drop the other's ops. `_inflight` +
  `_pending` keep exactly one in flight, and `flush()` resolves only after the
  data really went out — the `visibilitychange` handler relies on that.

- **`api.js` must send `Content-Type: text/plain`.** Apps Script cannot answer
  a preflight OPTIONS. `application/json`, or an `Authorization` header, makes
  the request CORS non-simple and it fails. Hence idToken travels in the body.

- **`.legend` is `display:none` below 760px.** Real buttons belong in
  `.tb-actions`.

## Security model

There is no RLS. `Code.gs` is the only thing enforcing access:

1. Every action passes `requireUser()` before touching a Sheet.
2. `verifyIdToken()` checks `aud === CLIENT_ID`. Without it, a Google ID token
   minted for another app impersonates any user here.
3. `user_id` always comes from the verified token's `sub`, never the client.

Hiding the Admin menu is cosmetic — `admin.overview` checks the role itself.

Neither `GOOGLE_CLIENT_ID` nor `SCRIPT_URL` is a secret: the browser needs
both, so they are readable in the deployed page source. Keeping them in repo
variables only avoids GitHub scraping. This flow uses no client secret at all.

The Google ID token is a credential. It stays in JavaScript memory only:
never persist it to `localStorage`/`sessionStorage`, include it in an error, or
write it to any browser/server log. The Sheet itself must keep **General
access: Restricted** and must not be shared with app users; they access only
their own rows through the verified Apps Script API.

## Before pushing

```bash
# same check the CI runs
for f in $(find public -name '*.js'); do node --input-type=module --check < "$f" || echo "FAIL $f"; done

# auth, authorization, row-isolation and error-disclosure regressions,
# plus the seed/own merge rules of the interview journal
NODE_NO_WARNINGS=1 node --experimental-vm-modules --test \
  tests/security.test.mjs tests/interviews.merge.test.mjs

# run it
cd public && python -m http.server 8080
```

Editing `apps-script/Code.gs` requires Deploy → Manage deployments → New
version, otherwise the Web App keeps serving the old code.
