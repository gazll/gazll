# Content Best-Practices Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh all 25 topics to current senior-backend best practice and add repeatable editorial checks for freshness, evidence, provenance, and canonical references.

**Architecture:** Existing topic JSON remains the bilingual source of truth with immutable item IDs. High-risk review metadata is stored in a sidecar keyed by item ID, while the advisory audit CLI exposes freshness, evidence, and reference-quality reports. Content changes are grouped by correctness, freshness, coverage, and deduplication so every batch is independently valid.

**Tech Stack:** Node.js ESM, built-in `node:test`, JSON topic data, Markdown/HTML callouts, PowerShell verification commands.

## Global Constraints

- Work directly on `main` because the user explicitly declined an isolated worktree.
- Do not create subagents.
- Never change an existing `item_id`; append new items only at the end of a section.
- Keep every English/Vietnamese pair structurally identical and preserve the exact four-key item schema.
- Preserve `[[x:...]]`, callout, HTML/SVG, entity, and canonical cross-reference syntax.
- Use authoritative primary sources for normative and version-sensitive claims.
- Target JDK 25 LTS; label JDK 21-23 historical behavior explicitly.
- Run the structural validator after every content batch and the complete test suite at the final gate.

---

### Task 1: Add failing behavioral tests for the editorial audit and review sidecar

**Files:**
- Create: `tests/content.audit.test.mjs`
- Modify: `tests/content.i18n.test.mjs`
- Test: `tests/content.audit.test.mjs`

**Interfaces:**
- Consumes: CLI commands `node tools/audit-content.mjs --gaps|--stale|--refs` and topic files from `public/data/topics`.
- Produces: tests requiring evidence-aware gap output, expanded freshness detection, non-canonical-reference reporting, and valid `public/data/content-reviews.json` metadata.

- [ ] **Step 1: Write failing CLI behavior tests**

Use `spawnSync(process.execPath, [auditPath, flag], { encoding: 'utf8' })`. Assert that `--gaps` excludes the table/SVG-heavy HTTP lifecycle item, `--stale` includes the OAuth and async-profiler items, and `--refs` reports `ch.xx` references.

- [ ] **Step 2: Write the failing sidecar-contract test**

Load `public/data/content-reviews.json`, build the real set of bilingual item IDs, and assert for every metadata entry: the ID exists, `reviewed_at` matches `YYYY-MM-DD`, `target_versions` is a non-empty string array, `claim_type` is one of `normative|heuristic|example`, and every source is HTTPS.

- [ ] **Step 3: Run tests and verify RED**

Run: `$env:NODE_NO_WARNINGS='1'; node --test tests/content.audit.test.mjs tests/content.i18n.test.mjs`

Expected: failures because `--gaps` is code-only, `--stale` misses the extra ecosystems, `--refs` has no report, and the sidecar does not exist.

### Task 2: Implement audit behaviors and review provenance

**Files:**
- Modify: `tools/audit-content.mjs`
- Create: `public/data/content-reviews.json`
- Modify: `docs/content-playbook.md`
- Test: `tests/content.audit.test.mjs`, `tests/content.i18n.test.mjs`

**Interfaces:**
- Consumes: topic answers and immutable item IDs.
- Produces: `hasEvidence(answer)`, visible-prose ranking, expanded version/product markers, `--refs` advisory output, and well-formed high-risk review metadata.

- [ ] **Step 1: Implement minimal GREEN behavior**

Treat `<pre>`, `<table`, and `<figure` as evidence; use stripped prose length for gap ranking. Extend freshness matching to OAuth, OAuth 2.1, OWASP, OpenTelemetry/OTel, Resilience4j, HikariCP, and async-profiler with optional versions. Report every `ch.\d+` match under `--refs` with item ID and count.

- [ ] **Step 2: Add sidecar records for changed high-risk items**

Record the official OpenJDK, Oracle, Spring, IETF/RFC, OWASP, Kubernetes, OpenTelemetry, Resilience4j, HikariCP, Kafka, MongoDB, MySQL, and async-profiler sources used by the refresh.

- [ ] **Step 3: Update the playbook**

Document claim types, benchmark provenance, review metadata, the expanded audit flags, event-driven freshness triggers, canonical topic ownership, and compilable-versus-illustrative snippet labelling. Correct the OAuth wording to reference RFC 9700 and OAuth 2.1's draft status.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `$env:NODE_NO_WARNINGS='1'; node --test tests/content.audit.test.mjs tests/content.i18n.test.mjs`

Expected: all Task 1 tests pass.

### Task 3: Correct Java/JVM content across Topics 1, 2, 15, 23, and 25

**Files:**
- Modify: `public/data/topics/01-java-core-jvm.json`
- Modify: `public/data/topics/01-java-core-jvm.vi.json`
- Modify: `public/data/topics/02-java-8-25-java-vs-go.json`
- Modify: `public/data/topics/02-java-8-25-java-vs-go.vi.json`
- Modify: `public/data/topics/15-network-i-o-models.json`
- Modify: `public/data/topics/15-network-i-o-models.vi.json`
- Modify: `public/data/topics/23-java-concurrency-coding.json`
- Modify: `public/data/topics/23-java-concurrency-coding.vi.json`
- Modify: `public/data/topics/25-microservice.json`
- Modify: `public/data/topics/25-microservice.vi.json`

**Interfaces:**
- Consumes: JDK 25 baseline and official OpenJDK JEP semantics.
- Produces: version-scoped pinning guidance, current Structured Concurrency examples, final ScopedValue status, accurate AQS/GC explanations, exhaustive Java switch code, and provenance-safe Java/Go comparisons.

- [ ] **Step 1: Correct Topic 1 mechanics**

Separate ZGC colored pointers from Shenandoah forwarding pointers; scope monitor pinning to JDK 21-23; replace removed `jdk.tracePinnedThreads` advice with JFR for JDK 24+; remove the claim that all lock types use AQS; replace removed `ShutdownOnFailure/Success` classes with JDK 25 Joiner concepts.

- [ ] **Step 2: Correct Topic 2 code and benchmark claims**

Add the missing non-positive `Refund` switch branch. Label support periods as vendor-specific. Replace universal Java/Go multipliers and cost numbers with a measurement framework and clearly labelled example dimensions.

- [ ] **Step 3: Correct Topics 15, 23, and 25**

Apply the same JDK 21-23 versus 24+ distinction. Use `StructuredTaskScope.open(Joiner.allSuccessfulOrThrow())`-style JDK 25 preview code, mark `ScopedValue` final in 25, and remove the obsolete pinned-thread property.

- [ ] **Step 4: Validate the Java batch**

Run: `node tools/validate-content.mjs`

Expected: `content OK` with no EN/VI structural drift in `node tools/audit-content.mjs`.

### Task 4: Correct database, security, Kubernetes, observability, debugging, DDD, and microservice semantics

**Files:**
- Modify bilingual topic pairs: `07`, `13`, `14`, `20`, `21`, `24`, and `25` under `public/data/topics/`.

**Interfaces:**
- Consumes: official MongoDB/MySQL, RFC/IETF/OWASP, Kubernetes, OpenTelemetry, async-profiler, Resilience4j, HikariCP, Kafka, and JDK collection documentation.
- Produces: workload-driven DB comparisons, current OAuth/security guidance, contextual operational heuristics, consistent OTel messaging traces, current profiler commands, semantic event boundaries, and corrected resilience/pool/messaging claims.

- [ ] **Step 1: Rewrite Topic 7 comparisons**

Replace cost/speed winner framing with workload criteria; explain MongoDB read preference separately from read concern and state that default `local` is not linearizable; introduce MySQL 8.4 as the LTS line while retaining 8.0 production context.

- [ ] **Step 2: Refresh Topic 13 security**

Treat RFC 9700 as normative and OAuth 2.1 as draft; cover sender-constrained tokens, rotation/reuse detection, BFF/browser storage, JWT validation failure modes, OWASP Top 10:2025, API Security Top 10:2023, passkeys/workload identity, and supply-chain controls.

- [ ] **Step 3: Rewrite Topic 14 absolutes**

Remove ZGC from scale-to-zero guidance; make database ownership, language choice, AIOps, mTLS, dependency probes, and `preStop` delays contextual decisions with explicit failure modes.

- [ ] **Step 4: Correct Topics 20, 21, and 24**

Make span links the messaging default with a single-message parent-child exception; cap tail-sampling policies rather than retaining unlimited failures; update async-profiler commands to `asprof`; separate domain/integration event semantics from transport and present thin notifications versus event-carried state as a trade-off.

- [ ] **Step 5: Correct Topic 25 details**

Separate ThreadPoolBulkhead from TimeLimiter, explain retry/breaker ordering semantics, distinguish HikariCP `keepaliveTime`/`maxLifetime`/`leakDetectionThreshold`, rename exactly-once as scope-bound, correct cumulative map-removal complexity, remove universal prepared-statement and wrapper advice, and label warmup/TPS values as measured examples only.

- [ ] **Step 6: Validate the semantic batch**

Run: `node tools/validate-content.mjs`

Expected: `content OK`; run `node tools/audit-content.mjs` and expect no parity drift.

### Task 5: Add current framework and missing high-value coverage

**Files:**
- Modify bilingual topic pairs: `03`, `05`, `11`, `17`, `18`, `19`, and `22` under `public/data/topics/`.

**Interfaces:**
- Consumes: existing section ordering and immutable ID convention.
- Produces: appended bilingual items for Spring 4-generation migration, consistent system-design case analysis, REST pagination/caching/rate-limit contracts, plan-cache regressions, missing DSA patterns, and testable LLD.

- [ ] **Step 1: Append Spring current-generation coverage**

Add `03-spring-boot-deep-build.auto-configuration-build.q11` covering Boot 4 / Framework 7, Jakarta EE 11, JSpecify, Jackson 3, Java 25 support, modularization, migration testing, and the Java 17 baseline.

- [ ] **Step 2: Version database examples and normalize case-study rubric**

Retain MySQL 8.0 examples but label 8.4 LTS behavior where relevant. Give Topic 11 overview cases the same concise sequence: requirements, estimates, API/data model, critical path, scaling, failure recovery, and observability.

- [ ] **Step 3: Append REST and query-plan items**

Add `17-rest-api-design.contracts-errors-lifecycle.q5` for cursor pagination plus HTTP caching/ETag and `q6` for standardized rate-limit response fields. Add `18-query-optimization.measure-first-reading-the-execution-plan.q5` for parameter-sensitive plans, generic/custom plans, bind peeking/parameter sniffing, and mitigations.

- [ ] **Step 4: Append DSA pattern coverage**

Add sequential items after Topic 19's existing final item covering dynamic programming, backtracking, monotonic stack/deque, intervals/sweep line, trees/BST/trie, and bit manipulation. Each item includes recognition cues, invariant/template, complexity, and a representative problem.

- [ ] **Step 5: Append testable LLD coverage**

Add `22-low-level-design-ood.patterns-in-interview-code.q5` covering invariants, executable examples, property/concurrency tests, clock/randomness injection, and failure cases.

- [ ] **Step 6: Validate the coverage batch**

Run: `node tools/validate-content.mjs --stats`

Expected: item count increases equally in EN/VI, IDs remain ordered, and all structural checks pass.

### Task 6: Canonicalize Topic 25 and finish the editorial model

**Files:**
- Modify: `public/data/topics/25-microservice.json`
- Modify: `public/data/topics/25-microservice.vi.json`
- Modify: `docs/content-playbook.md`
- Modify: `public/data/content-reviews.json`

**Interfaces:**
- Consumes: canonical owner IDs from Topics 8, 9, 10, 12, 20, and 24.
- Produces: zero `ch.xx` references, validated canonical references, and a clearly stated rapid-review role for Topic 25.

- [ ] **Step 1: Replace all `ch.xx` references**

Map every internal chapter pointer to an existing immutable item ID. Where a sentence needs more than one owner, use multiple canonical references rather than an unvalidated chapter alias.

- [ ] **Step 2: Keep Topic 25 concise by design**

Expand only unique incident material; link deep explanations to their canonical owners. Do not inflate the ten short items solely to clear the `<800` statistic.

- [ ] **Step 3: Run reference and parity audits**

Run: `node tools/audit-content.mjs --refs`

Expected: zero non-canonical chapter references and no EN/VI drift.

### Task 7: Final verification and review handoff

**Files:**
- Verify all modified files; do not add unrelated changes.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: a fully validated bilingual corpus and an evidence-backed handoff for user review.

- [ ] **Step 1: Run complete structural/editorial verification**

Run: `node tools/validate-content.mjs --stats`

Run: `node tools/audit-content.mjs --stale --gaps --refs`

- [ ] **Step 2: Run the complete test suite**

Run: `$env:NODE_NO_WARNINGS='1'; node --experimental-vm-modules --test tests/*.test.mjs`

Expected: all tests pass with zero failures.

- [ ] **Step 3: Review the diff and spot-check content**

Run: `git diff --check`, `git status --short`, and targeted searches for `tracePinnedThreads`, `ShutdownOnFailure`, `ch.\d+`, `OAuth 2.1.*required`, `hard timeout`, and `O\(log n\)`.

Expected: no whitespace errors, no obsolete assertions, no non-canonical chapter references, and only in-scope files changed.

