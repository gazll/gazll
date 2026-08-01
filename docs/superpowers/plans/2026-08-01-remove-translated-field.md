# Remove `translated` Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the now-constant item-level `translated` field and every obsolete runtime, UI, validation, test, and documentation dependency on partial translation.

**Architecture:** Treat each base English topic file and its `.vi.json` companion as a complete language source. Preserve eager bilingual loading, language persistence, metadata fallback, and missing-Vietnamese degradation; remove only per-item translation-state logic and its derived UI state.

**Tech Stack:** Static JSON content, browser ES modules, Node.js built-in test runner, PowerShell, `tools/validate-content.mjs`.

## Global Constraints

- Preserve all staged translation work already present in the worktree.
- Do not modify any item value except deleting its `translated` property.
- Do not change item order, IDs, difficulty, questions, answers, markup, entities, cross-references, metadata, manifest entries, or language file names.
- Keep the EN/VI switch, eager loading, stored language preference, metadata fallback, and missing `.vi.json` fallback to English.
- Use `apply_patch` for file edits.
- Do not create a git commit because the user has not authorized commits.

---

### Task 1: Define the field-free bilingual contract with failing tests

**Files:**
- Modify: `tests/content.i18n.test.mjs`

**Interfaces:**
- Consumes: `Content.load()`, `Content.setLang(lang)`, `TOPIC_FILES`, and `TOPIC_VI_FILES`.
- Produces: regression coverage for four-key items, source switching, source immutability, base/VI ID parity, and removal of legacy runtime APIs.

- [ ] **Step 1: Rewrite the test module description**

Describe base `.json` files as complete English sources and `.vi.json` files as complete Vietnamese companions. Remove all documentation of sparse translation, fallback badges, and availability derived from item flags.

- [ ] **Step 2: Remove obsolete partial-translation fixtures and tests**

Delete `topicWithoutEnglishTranslations` and the tests for an untranslated item, a translated item, `hasEn:false`, and `hasEn:true`. Remove every `Content.isFallback` assertion.

- [ ] **Step 3: Add the field-free schema test**

Add a test equivalent to:

```js
test('every bilingual item uses the final four-key schema', () => {
  for (const files of [TOPIC_FILES, TOPIC_VI_FILES]) {
    for (const [file, content] of files) {
      for (const section of content.sections) {
        for (const item of section.items) {
          assert.deepEqual(Object.keys(item).sort(), ['a', 'difficulty', 'id', 'q'], `${file}: ${item.id}`);
          assert.equal(Object.hasOwn(item, 'translated'), false, `${file}: ${item.id}`);
        }
      }
    }
  }
});
```

- [ ] **Step 4: Strengthen language switching and parity tests**

When switching to Vietnamese, assert the selected item's `q` and `a` equal the `.vi.json` companion. Switch back to English without refetching and assert `q` and `a` equal the base file. For every manifest row, compare the ordered base and companion item-ID arrays. Assert loaded topics do not own `hasEn` or `hasVi`, and `Content.isFallback` is `undefined`.

- [ ] **Step 5: Run the focused test and verify RED**

Run:

```powershell
$env:NODE_NO_WARNINGS='1'
node --experimental-vm-modules --test tests/content.i18n.test.mjs
```

Expected: FAIL because topic items still contain `translated`, loaded topics still expose `hasEn`/`hasVi`, and `Content.isFallback` still exists.

---

### Task 2: Remove the persisted field and update structural validation

**Files:**
- Modify: `public/data/topics/01-java-core-jvm.json` through `public/data/topics/25-microservice.json`
- Modify: all matching `public/data/topics/*.vi.json` companions
- Modify: `tools/validate-content.mjs`

**Interfaces:**
- Consumes: the four-key schema asserted by Task 1.
- Produces: 648 field-free items and validator enforcement for both languages.

- [ ] **Step 1: Remove only JSON property lines**

Delete every exact line matching the JSON property form below from the 50 topic files, without globally replacing the natural-language word “translated” inside answers:

```json
"translated": true,
```

Before applying the generated patch, assert there are exactly 648 matching property lines and zero `translated:false` values.

- [ ] **Step 2: Update the base-item schema check**

Change the expected sorted item keys in `tools/validate-content.mjs` from five fields to:

```js
'["a","difficulty","id","q"]'
```

Remove the Boolean type check for `it.translated`.

- [ ] **Step 3: Validate companion schemas and ordered parity**

For each `.vi.json` section, compare its item count with the matching base section, require each companion item to use the same four-key schema, and require `viItem.id === baseItem.id` at the same section/item index. Retain the existing missing-companion and section-count diagnostics.

- [ ] **Step 4: Remove translation-progress validation and reporting**

Remove flag-specific comments, `enTopics`, `enItems`, the `.vi.json translated:true` requirement, counting loops, and the `English translation — ...` output. Keep all metadata-language, content-structure, markup, SVG, entity, and cross-reference validation.

- [ ] **Step 5: Run validator and the focused schema test**

Run:

```powershell
node tools/validate-content.mjs --stats
$env:NODE_NO_WARNINGS='1'
node --experimental-vm-modules --test tests/content.i18n.test.mjs
```

Expected: validator reports `content OK`; schema/parity assertions pass, while legacy runtime API assertions remain red until Task 3.

---

### Task 3: Remove obsolete runtime and fallback UI state

**Files:**
- Modify: `public/lib/content.js`
- Modify: `public/app.js`
- Modify: `public/lib/ui.js`
- Modify: `public/styles.css`
- Test: `tests/content.i18n.test.mjs`

**Interfaces:**
- Consumes: complete English and Vietnamese topic trees without per-item translation state.
- Produces: language selection based only on `Content.lang`, with both buttons always available.

- [ ] **Step 1: Simplify `Content`**

Rewrite the module header to describe two complete language sources. Remove `hasRealTranslation`, the `hasEn`/`hasVi` properties created in `_apply()`, and `Content.isFallback`. Preserve `fetchOptionalJson`, `applyMeta`, cloning, eager loading, `_apply()`, `setLang()`, and all progress/topic helpers.

- [ ] **Step 2: Remove fallback badge rendering**

In `public/app.js`, remove `FALLBACK_BADGE` from the import, delete the `fallback` calculation in `qcard`, and render only the difficulty badge in `qmeta`. In `public/lib/ui.js`, delete the `FALLBACK_BADGE` export.

- [ ] **Step 3: Make the language switch unconditional**

Delete `activeLangAvailability`. Reduce `paintLangSwitch()` to updating `aria-pressed` from `Content.lang`; remove button disabling, unavailable titles, and the `b.disabled` click guard.

- [ ] **Step 4: Remove fallback-only CSS**

Delete the `.qbadge.vi` rule and its mobile `.qmeta .qbadge.vi` override. Preserve all generic and difficulty badge styles.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```powershell
$env:NODE_NO_WARNINGS='1'
node --experimental-vm-modules --test tests/content.i18n.test.mjs
```

Expected: every i18n test passes, including missing-Vietnamese degradation and source immutability.

---

### Task 4: Update user and maintainer documentation

**Files:**
- Modify: `public/app.js`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: final bilingual runtime model from Task 3.
- Produces: documentation that contains no obsolete field, badge, availability, or progress instructions.

- [ ] **Step 1: Rewrite the in-app guide**

State that every base topic file is complete English, every `.vi.json` companion is complete Vietnamese, both are loaded up front, and the header switch selects between them. Remove partial-translation and disabled-button language.

- [ ] **Step 2: Rewrite the content architecture section**

In `CLAUDE.md`, remove `FALLBACK_BADGE` from the module map and replace the sparse-translation section with the complete bilingual data contract. Update the validator description so it reports structural/content statistics rather than translation progress.

- [ ] **Step 3: Scan for obsolete references**

Run:

```powershell
rg -n --glob '!docs/superpowers/**' -e '"translated"\s*:' -e '\.translated\b' -e '\bhasEn\b' -e '\bhasVi\b' -e '\bisFallback\b' -e 'FALLBACK_BADGE' -e 'qbadge\.vi' public tools tests CLAUDE.md
```

Expected: no matches. Natural prose using the ordinary English word “translated” may remain inside lesson answers.

---

### Task 5: Final verification and review

**Files:**
- Verify all files changed by Tasks 1–4

**Interfaces:**
- Consumes: completed field removal.
- Produces: evidence that content and runtime behavior remain valid.

- [ ] **Step 1: Verify exact data preservation**

Parse all 50 topic files and confirm 648 items remain, split 324 base and 324 VI. Read each pre-removal version from the git index with `git show :public/data/topics/<file>` (the index already contains the completed translations), recursively omit only `translated` from that snapshot, and require deep equality with the worktree file.

- [ ] **Step 2: Run content validation**

```powershell
node tools/validate-content.mjs --stats
```

Expected: `content OK — 25 topics, 324 items, 28 SVG markers` and no translation-progress line.

- [ ] **Step 3: Run the complete test suite**

```powershell
$env:NODE_NO_WARNINGS='1'
node --experimental-vm-modules --test tests/*.test.mjs
```

Expected: all tests pass with zero failures.

- [ ] **Step 4: Run repository hygiene checks**

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; existing staged translations remain preserved and the field-removal changes are visible without any commit.
