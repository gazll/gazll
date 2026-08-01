/* Closed-set identifiers shared across data/ and the UI. A typo in a raw
   string like "algorith" or "hrad" fails silently — nothing reads these
   values against a fixed set except tools/validate-content.mjs, so app.js
   and views/* should read the `key` off these arrays/maps rather than
   re-typing the literal.

   `label` is what the UI shows — English only, per CLAUDE.md's "interface
   is always English" rule. `vi` is kept for reference/documentation only;
   nothing in this codebase renders it (topic_type/difficulty are UI chrome,
   not study content, so they don't follow the content VI/EN switch). */

/** A topic's subject-matter category. Drives the filter bar, the stepper
    chip accent colour (`[data-topic-type="…"]` in styles.css), and the hero
    accent. `microservice` covers the standalone Microservices track, which
    is a topic like any other rather than a separate concept. */
export const TOPIC_TYPES = [
  { key: 'core', label: 'Core', vi: 'Cốt lõi' },
  { key: 'data', label: 'Data', vi: 'Dữ liệu' },
  { key: 'design', label: 'Design', vi: 'Thiết kế' },
  { key: 'platform', label: 'Platform', vi: 'Nền tảng' },
  { key: 'algorithm', label: 'Algorithm', vi: 'Thuật toán' },
  { key: 'microservice', label: 'Microservice', vi: 'Vi dịch vụ' }
];
export const TOPIC_TYPE_LABEL = Object.fromEntries(TOPIC_TYPES.map(t => [t.key, t.label]));

/** An item's difficulty. Drives the CORE/ADVANCED/EXTRA badge
    (`BADGE` in lib/ui.js) and the `.difficulty-*` card accent in
    styles.css. Renamed from the old `lvl` field to avoid reading like a
    second "type" next to topic_type. Keys match their label in lowercase
    (`core`/`advanced`/`extra`) — the old `hard`/`ext` keys read as a
    different taxonomy than the badge actually shown. */
export const DIFFICULTIES = [
  { key: 'core', label: 'CORE', vi: 'Cốt lõi' },
  { key: 'advanced', label: 'ADVANCED', vi: 'Nâng cao' },
  { key: 'extra', label: 'EXTRA', vi: 'Mở rộng' }
];
export const DIFFICULTY_LABEL = Object.fromEntries(DIFFICULTIES.map(d => [d.key, d.label]));
