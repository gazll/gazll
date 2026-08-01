# CLAUDE.md

## Project

Study site for backend engineering interview prep. No framework, no build
step, no package.json — vanilla ES modules served straight to the browser.
`public/` is published to GitHub Pages by GitHub Actions.

**Two language layers, and they are not the same thing.**

1. **The interface is always English and does not switch.** Every string in
   `index.html`, `app.js`, `lib/` and `views/`: menus, buttons, headings,
   badges, placeholders, `alert`/`confirm`, `aria-label`s, and the
   `DEEP DIVE · SENIOR` tag in `lib/markdown.js`. There is no UI string table
   and there should not be one. (`lib/api.js` matches Vietnamese *and* English
   in its `authExpired` regex — `apps-script/Code.gs` answers in Vietnamese.)

2. **The study material has an `EN`/`VI` switch in the header**, right of the
   progress ring. It was in the nav panel first and nobody could find it.
   English is the default language and each topic's base file; the complete
   Vietnamese original always exists alongside it as a `.vi.json` companion
   — see "The VI/EN language split".

Code comments are English, and they answer **why**, not what: the code already
says what it does. Keep them short.

## Layout

```
public/
  index.html         shell; loads app.js as <script type="module">
  app.js             entry: hash router, topic track view (all 25 topics, including Microservices)
  config.js          GITIGNORED. Generated at deploy time from repo variables
  config.example.js  template to copy for local dev
  lib/
    constants.js     TOPIC_TYPES, DIFFICULTIES — the closed-set identifiers, label source
    markdown.js      renderMarkdown + renderUser (escaping variant)
    ui.js            chevSVG, BADGE, FALLBACK_BADGE, debounce, localDay
    content.js       loads data/manifest.json + meta.json + per-topic files; owns the language
    api.js           transport to Apps Script
    auth.js          Google Identity Services + header avatar/state machine
    store.js         offline-first progress, notes, study log
    interviews.js    interview journal data layer
  views/
    interviews.js    interview journal CRUD (<dialog>)
    stats.js         streak + heatmap + per-topic progress
    admin.js         all-user overview (admin role only)
  data/
    manifest.json       ordered list of every topic (n, topic_type, file) — 25 rows, Microservices is n=25
    meta.json            label/title/intro/tags/key/topic_type per topic, VI + EN in one file
    topics/NN-slug.json     English base, one file per topic (324 items total across 25 files)
    topics/NN-slug.vi.json  the complete Vietnamese original, same shape, every item translated:true
    interviews.json     seed entries, merged under everyone's own Sheet rows
apps-script/Code.gs  the entire backend (Google Sheet as database)
tests/               security · interviews.merge · auth.state · content.i18n
tools/               validate-content.mjs
secret/              GITIGNORED. Personal setup notes and credentials
```

## Things that break easily

- **`lib/markdown.js` — the `SENT` sentinel.** It is
  `String.fromCharCode(0xE000)` on purpose. U+E000 is invisible in an editor,
  and if it degrades to an empty string the regex wraps **every number** in
  `<code>`. Do not "tidy" that line into a literal.

- **`item_id` is one flat key space, and it is a slug, not a number.**
  Format: `{topic-key}.{section-slug}.q{n}` — e.g.
  `01-java-core-jvm.memory-execution-model.q1`. `topic-key` is the topic's
  filename stem (matches `manifest.json`'s `file` and `meta.json`'s `key`);
  `section-slug` is generated once from the section's English title and
  reused for its `.vi.json` counterpart, so an item's id never changes with
  language. `progress`/`notes`/`study_log` in the Sheet key on this string
  verbatim (`item_id` is untyped there — see `Code.gs`'s `keyOf`), so an id
  is a **stored key**: renaming a topic's file, or re-slugifying a section
  title, orphans every row already in the Sheet for that topic.

- **The progress ring counts every topic, Microservices included.**
  `Content.topicItemIds` / `Content.totalTopicItems` cover all 25 topics —
  there is no separate "track" vs "standalone" split anymore. The
  denominator is derived, never hardcoded.

- **Every topic needs a `topic_type`.** One of `core` · `data` · `design` ·
  `platform` · `algorithm` · `microservice`, defined once in
  `lib/constants.js` (`TOPIC_TYPES`) and read from there everywhere —
  `app.js`'s filter bar/stepper chip, `views/stats.js`, and
  `validate-content.mjs`'s validation set all import it rather than
  re-typing the list. The colours are the `[data-topic-type="…"]`
  custom-property blocks in `styles.css`. A topic with an unknown
  `topic_type` renders with no accent colour and drops out of the filter
  bar. Every item needs a `difficulty` the same way (`core` · `hard` · `ext`,
  `DIFFICULTIES` in `lib/constants.js`) — it drives the ESSENTIAL/ADVANCED/EXTRA
  badge. `lib/constants.js`'s `label` is UI chrome (always English, per the
  "interface is always English" rule above); its `vi` field is reference
  only and nothing renders it.

- **Raw HTML blocks in a topic's `data/topics/NN-slug.json` end at the first
  blank line.** `renderMarkdown` collects lines starting with `<` until a
  blank one, so a blank line inside a `<pre>` or `<table>` truncates it and
  dumps the rest as literal text. Use a comment-only line as a separator
  instead.

- **`renderMarkdown` never escapes, so `<` must be written `&lt;` everywhere
  in `data/topics/*.json`** — including inside inline code spans. `` `jcmd <pid>` ``
  emits a real `<pid>` element that the browser swallows, and the reader sees
  `jcmd  Thread.print`. Only `<` followed by a space survives as text. (The
  interview journal is the opposite: `renderUser` escapes first, so write a
  plain `<` there and never an entity.)

- **The interview journal merges two sources; `own` separates them.** Sheet
  rows carry `own: true`, `interviews.json` entries `own: false` and an id of
  `seed-N` (Sheet ids are UUIDs, so they cannot collide). Only own rows may be
  edited or deleted — a seed row has no Sheet row behind it, so `Sửa`/`Xoá`
  would fail. `importSeed()` copies one across, stripping every id so the
  backend creates new rows rather than editing. Seed entries whose name
  matches an own row are dropped, which is what makes import look in-place.

- **SVG `<marker>` ids must be unique across the whole file.** Every open
  card shares one DOM, so `url(#ar6)` resolves to whichever diagram rendered
  first — two diagrams reusing an id silently borrow each other's arrowheads.
  Name them after the item (`ar6_165`) rather than sequentially.

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

- **Adding a menu is one entry in `VIEWS`.** `sec` picks the nav-panel section
  (`technical` · `tool` · `about`). An entry with `href` is an external
  destination: it renders as a new-tab link and `currentViewId()` refuses to
  route to it, so a hash matching its id falls back to the track. That is how
  sibling apps under `public/` (e.g. `fshare-tool/`) join the menu.

- **The nav panel is `inert` while closed.** Without it the off-screen links
  stay in the tab order — the drawer is moved by `transform`, not `display`.
  `close()` blurs first, because focus inside a subtree that then becomes
  inert is not moved out on its own.

- **One shell width: `--shell` (+ `--gutter`).** `.top-inner`, `.tb-inner` and
  `main` all read it, which is the only reason they line up. The topic
  dropdown is positioned against `.tb-inner`, *not* `.topicbar` — the bar is
  full-bleed, so anchoring there parks the panel on the window edge while the
  rest of the page stays centred.

- **`header.top` is a stacking context** (`position:sticky` + `z-index:50`),
  so anything inside it is trapped below 50 no matter its own `z-index`. That
  is why `.topic-scrim` is `z-index:40`: at 60 it covered the very dropdown it
  was supposed to sit behind.

- **Collapsing the header keeps the topic bar.** Only its second line and the
  step buttons shrink. Collapsing is for reading, and jumping topics is what
  you do while reading.

- **A silent sign-in attempt must always end.** `Auth.connecting` is only true
  while an attempt is genuinely in flight; `SILENT_MS` and the
  `prompt()` notification each end it, and the resting state afterwards is
  `stale` — a still badge plus a real sign-in button. Do not reintroduce
  "has a hint and no token ⇒ connecting": FedCM suppressing the prompt is
  routine, and that spelling left the header spinner running forever with no
  way in. `Auth.state` is the single value the UI switches on.
  `tests/auth.state.test.mjs` pins all of it.

## The VI/EN language split

English is the **default and base** language; Vietnamese is the **complete,
ground-truth** content that always exists alongside it. `Content.load()`
fetches both eagerly (`manifest.json`, `meta.json`, every topic's base file,
and every topic's `.vi.json` companion) so switching language in the header
never needs a refetch.

- **Per-item `translated` flag** — every item in every file carries
  `translated: true|false`. It means "this item's text is authentically
  written in this file's language," not "this item has been looked at."
  A `.vi.json` file is the real, complete Vietnamese original, so every one
  of its items is `translated: true` by construction. A topic's base
  (English) file starts with the Vietnamese text copied in verbatim and
  `translated: false`, until someone actually translates that item — then
  only that item flips to `true` and gets real English text.
  ```json
  { "sections": [{ "title": "…", "items": [
    { "id": "01-java-core-jvm.memory-execution-model.q1", "difficulty": "core", "q": "…", "a": "…", "translated": false }
  ] }] }
  ```
- **Metadata** — `meta.json`'s `topics["N"].vi` / `.en` blocks, key name
  always matching the language of its value:
  ```json
  { "topics": { "1": { "topic_type": "core", "key": "01-java-core-jvm",
                        "vi": { "label": "…", "title": "…", "intro": "…", "tags": ["…"] },
                        "en": { "label": "…", "title": "…", "intro": "…", "tags": ["…"] } } } }
  ```
  `key` is the topic's filename stem (without `.json`) — the id-reference
  the file names are built from, kept here so lookups don't need to parse
  paths, and the prefix every item id in that topic starts with.
- **`Content.isFallback(item)`** is just `!item.translated` — true whenever
  the text on screen isn't authentically written in the language currently
  selected. Today that only ever fires in EN (0/324 items are really
  translated yet), which renders the Vietnamese text with a `VI` badge
  (`FALLBACK_BADGE`) so the reader knows why it switched language mid-page.
- **Per-topic `hasEn`/`hasVi`** (on `Content.topics[i]`) says whether that
  topic has *any* `translated: true` item in that language. `.vi.json`
  makes `hasVi` always true; `hasEn` is false until a topic gets its first
  real translation. The header's `EN`/`VI` switch
  (`wireLangSwitch`/`paintLangSwitch` in `app.js`) disables the button for a
  language the current topic doesn't have — there is nothing to switch to.
- **`_apply()` must keep cloning the source.** Overlaying in place would
  overwrite one language's strings with the other's, and switching back
  would then show the wrong text.
- **Content is validated, not trusted.** `validate-content.mjs` fails if a
  topic's `.vi.json` is missing, has a mismatched section count, references
  an item id that doesn't exist, or isn't `translated: true` throughout — and
  fails if `meta.json`'s `key` or `topic_type` doesn't match the manifest.
- Current state: all 25 topics have English metadata (`meta.json`); no item
  has a real English translation yet (`translated: false` everywhere in the
  base files) — the EN button is effectively disabled site-wide until that
  changes one item at a time.

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

What `localStorage` *does* hold is `gazl.profile` — the **profile hint**:
`{sub, email, name, picture}` and nothing else. It exists so a returning
reader sees their own avatar on first paint while `auto_select` fetches a real
token; `readHint()` rebuilds the object field by field, so a `token`/`role`
planted there is dropped rather than trusted. Never widen it: `role` still
comes from the backend and `user_id` still comes from the verified `sub`.
Three tests in `tests/security.test.mjs` pin this.

## Before pushing

```bash
# structure of the data/ tree + translation progress, and a content report
node tools/validate-content.mjs --stats

# same check the CI runs
for f in $(find public -name '*.js'); do node --input-type=module --check < "$f" || echo "FAIL $f"; done

# auth/authorization/row-isolation/error-disclosure, the seed-vs-own merge
# rules, the sign-in state machine, and the VI/EN language split
NODE_NO_WARNINGS=1 node --experimental-vm-modules --test tests/*.test.mjs

# CI also refuses any console.* under public/ or apps-script/
grep -RInE 'console\.(log|info|warn|error|debug)|Logger\.log' public apps-script

# run it (python may not be on PATH — `npx serve public` works too)
cd public && python -m http.server 8080
```

Editing `apps-script/Code.gs` requires Deploy → Manage deployments → New
version, otherwise the Web App keeps serving the old code.
