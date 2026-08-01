# Remove `translated` Field Design

**Status:** Approved on 2026-08-01

## Context

The bilingual content migration is complete: all 324 English items and all 324 Vietnamese companion items currently carry `translated: true`. The field now records no useful state. Its remaining consumers only support the obsolete partial-translation experience: per-item Vietnamese fallback badges, per-topic language availability, disabled language buttons, and translation-progress validation.

## Decision

Remove the item-level `translated` field and the entire partial-translation mechanism. English and Vietnamese are complete peer sources selected at the topic-file level. The EN/VI switch remains available for every topic.

## Data Contract

Every item in all 25 base English files and all 25 `.vi.json` companion files will contain exactly these keys:

```json
{
  "id": "topic.section.q1",
  "difficulty": "core",
  "q": "Question text",
  "a": "Answer text"
}
```

No topic-level `translated` property exists or will be introduced. The existing item order, IDs, difficulty, questions, answers, sections, markup, entities, and cross-references must remain byte-for-byte unchanged apart from removing the field lines.

## Runtime Behavior

- Keep eager loading of both base English files and optional Vietnamese companions.
- Keep the stored language preference and language re-application behavior.
- Keep metadata fallback between `meta.json` language entries.
- Keep graceful degradation to the English base when a `.vi.json` companion is missing or cannot be loaded.
- Remove `hasRealTranslation`, per-topic `hasEn`/`hasVi`, and `Content.isFallback`.
- Remove the per-item `VI` fallback badge and its styling.
- Keep both EN and VI buttons enabled; the switch only reflects the active language.

## Validation

The content validator will require exactly `a`, `difficulty`, `id`, and `q` on items in both base and Vietnamese files. It will retain structural, ID, difficulty, markup, HTML/SVG, entity, and cross-reference checks, plus base/companion section and item parity. Translation-progress counters and flag-specific diagnostics will be removed.

## Tests

Tests will first define the field-free contract and fail against the current implementation. They will then verify:

- every base and `.vi.json` item has the four-key schema and no `translated` property;
- English is the default source and Vietnamese switching selects the companion source;
- both language trees are loaded up front, switching causes no refetch, and neither source is mutated;
- a missing Vietnamese companion still degrades to English;
- base and companion items retain matching IDs;
- removed runtime APIs and fallback UI behavior are no longer expected.

## Documentation

Update the in-app guide and `CLAUDE.md` to describe two complete language sources. Remove instructions and examples for partial translation, `translated`, fallback badges, `hasEn`/`hasVi`, and translation-progress output.

## Non-goals

- Do not change translated question or answer text.
- Do not change `meta.json`, `manifest.json`, language codes, file naming, or the EN/VI switch.
- Do not remove graceful handling of a missing `.vi.json` file.
- Do not refactor unrelated UI or content-loading code.

## Success Criteria

- No JSON item contains a `translated` key.
- No production, test, validator, or documentation code references the removed field or its obsolete derived APIs.
- `node tools/validate-content.mjs --stats` reports content OK without translation-progress output.
- `node --experimental-vm-modules --test tests/*.test.mjs` passes completely.
- `git diff --check` is clean.
