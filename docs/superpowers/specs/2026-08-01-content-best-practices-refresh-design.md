# Content Best-Practices Refresh Design

## Goal

Bring the 25-topic bilingual backend-engineering corpus up to current senior-level best practice while preserving every existing item ID, keeping English and Vietnamese structurally identical, and strengthening the editorial checks that prevent the same classes of drift from returning.

## Scope

The refresh has four layers:

1. Correct factual or currentness defects in Java/JVM, database, security, Kubernetes, OpenTelemetry, production-debugging, DDD, and microservice content.
2. Add missing high-value coverage for Spring Boot 4 / Framework 7, current security practices, REST lifecycle mechanics, query-plan stability, core algorithm patterns, and testable low-level design.
3. Establish canonical concept ownership and replace Topic 25's unvalidated `ch.xx` pointers with immutable item-ID cross-references.
4. Improve `audit-content.mjs` so freshness, evidence, and non-canonical references are visible without turning editorial judgement into a build-breaking rule.

## Content Model

- Existing `item_id` values never change.
- New items are appended at the end of their section with the next numeric ID.
- Every English edit has an equivalent Vietnamese edit in the companion `.vi.json` file.
- Public topic items keep exactly four keys: `id`, `q`, `a`, and `difficulty`.
- Review provenance lives in `public/data/content-reviews.json`, keyed by immutable item ID, rather than inside public items.
- Normative claims cite an authoritative standard or project source; heuristics state their assumptions; benchmark numbers include provenance or become qualitative examples.

## Runtime and Framework Baselines

- Java guidance targets JDK 25 LTS, with explicit historical notes for JDK 21-23 where behavior differs.
- JDK 24+ no longer treats `synchronized` as the normal virtual-thread pinning hazard; remaining pinning guidance uses JFR and native/FFM edge cases.
- `ScopedValue` is final in JDK 25. Structured Concurrency remains preview and examples use the JDK 25 factory/Joiner API.
- Spring coverage includes Spring Boot 4 and Spring Framework 7 while retaining migration context for Boot 3 applications.
- Security guidance treats RFC 9700 as normative and OAuth 2.1 as an Internet-Draft until it becomes an RFC.

## Topic Ownership

- Topic 8 owns message-queue mechanics.
- Topic 9 owns distributed transaction and financial correctness patterns.
- Topic 10 owns rate limiting and overload control.
- Topic 12 owns architecture-style decisions; Topic 24 owns deep DDD modelling.
- Topic 20 owns observability/SRE semantics.
- Topic 25 becomes a rapid incident-review sheet: concise explanations plus canonical links to the deep owner.

## Editorial Automation

`audit-content.mjs` remains advisory, but gains three observable behaviors:

- `--gaps` treats code, tables, and figures as explanatory evidence and ranks by visible prose rather than raw SVG/HTML size.
- `--stale` recognizes additional high-change ecosystems, including OAuth, OWASP, OpenTelemetry, Resilience4j, HikariCP, and async-profiler.
- `--refs` reports non-canonical chapter references such as `ch.03` so they cannot silently bypass target validation.

`content-reviews.json` records `reviewed_at`, `target_versions`, `claim_type`, and authoritative `sources` for the high-risk items changed in this refresh. The test suite validates that its keys point at real items and that its metadata is well formed.

## Verification

Each content batch must pass JSON parsing, `node tools/validate-content.mjs`, and `node tools/audit-content.mjs`. The final gate is:

```powershell
node tools/validate-content.mjs --stats
node tools/audit-content.mjs --stale --gaps --refs
$env:NODE_NO_WARNINGS='1'; node --experimental-vm-modules --test tests/*.test.mjs
```

Spot-checks compare English and Vietnamese wording for the highest-risk corrected items and visually inspect raw HTML/SVG structure.

