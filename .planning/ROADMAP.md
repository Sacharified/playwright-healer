# Roadmap: playwright-healer

## Overview

playwright-healer ships as a composite GitHub Action that transforms Playwright test failures into reviewable PRs or structured issues without human log-reading. The build order is security-first: the four architecturally-binding pitfalls land in Phase 1 before any agent code is written. Phase 2 validates the git-as-DB state branch at zero API cost. Phase 3 wires the full healer pipeline manually, including issue fallback for all failure paths. Phase 4 adds automatic dispatch and the remaining fix classes. Phase 5 adds opt-in auto-merge. Phase 6 ships documentation and the version release.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Security Scaffold + Composite Packaging** (complete 2026-04-25) - Establish the composite action structure with all four architecturally-binding security controls in place before any agent code is written. UAT items resolved equivalently by Phase 1.1 CI run.
- [x] **Phase 1.1: Multi-Provider Input Surface** (INSERTED, complete 2026-04-25) - Generalize the Anthropic-specific input surface to support Anthropic, Gemini, and Ollama via a `provider` input; drop `required: true` on `api-key` with per-provider Zod `superRefine` enforcement; adapters land in Phase 3
- [x] **Phase 1.2: Fix npx tsx env-var stripping in composite action runtime** (INSERTED, complete 2026-04-27) - Replace `npx tsx` with path-resolved `./node_modules/.bin/tsx` at action.yml Steps 5 and 6 to preserve hyphenated `INPUT_*` env vars on ubuntu-latest; add dedicated `self-test-hyphenated-input-env` regression-test job in phase1-self-test.yml; unblocks Phase 03 SC-1/SC-3 live verification
- [x] **Phase 1.3: Fix pre-existing phase1-self-test.yml test-design bugs** (INSERTED, complete 2026-04-27) - Three test-design bugs unmasked by Phase 01.2 (action now runs end-to-end so latent assertion bugs surface): (1) Scenarios 4+5 assume `$GITHUB_STEP_SUMMARY` is job-wide but it is per-step, so the bash assertion reads a different (empty) summary file than the dispatcher wrote to; (2) Scenario 1 Job B (`verify-log-mask`) checks Job A's `gh api .../logs` for raw canary, but the runner emits `with: api-key: <canary>` (line 150) and `INPUT_API-KEY: <canary>` (line 205) in the step header BEFORE the action body's `core.setSecret()` runs — TWO-JOB pattern is structurally unable to mask literal `with:` values. Pre-existing since Phase 01-06 / 01.1, never actually green on real CI (the env-var-stripping bug masked them by failing Job A early). NOT in Phase 01.2 scope.
- [x] **Phase 2: Ingest + State Branch + Log-Only Detection** (complete 2026-04-25) - Build and validate the git-as-DB observability layer at zero API cost; consuming repos can adopt and see their stats
- [x] **Phase 3: Manual Healer (Selectors + Waits + Issue Fallback)** (complete 2026-04-29) - Full healer pipeline triggered via manual `workflow_dispatch`; agent loop, fix applier, validator, PR path, and issue fallback. 13 plans + 2 gap-closure plans (03-14, 03-15) all shipped; HUMAN-UAT Tests 1+2 PASS (SC-1 PR creation; IN-01 SIGTERM propagation via Scenario 7 run 25110355292)
- [x] **Phase 3.1: First Heal — End-to-End Demo** (INSERTED 2026-04-29, complete 2026-04-29) - Phase 03 shipped infrastructure but never exercised the heal pipeline against a real LLM in real CI. Demonstrated end-to-end: PR [#1](https://github.com/Sacharified/playwright-healer-test/pull/1) opened with a Gemini-2.5-Flash-generated selector fix; fixture-ci.yml conclusion `success`; total Gemini cost $0.0382 USD. Six Phase-04 hardening items surfaced (clean-true subpath collision, free-tier model default, fix-applier scope leak, fix-applier no-force push, --3way fetch-depth warning, --force-with-lease stale-info on shallow clones).
- [ ] **Phase 4: Auto-Dispatch + Full Fix Classes + Deduplication** - Enable automatic threshold-triggered dispatch, add assertions and slow-test fix classes, and deduplicate PRs/issues for repeat triggers
- [ ] **Phase 5: Auto-Merge** - Add opt-in auto-merge for high-confidence fixes that pass all trust-chain gates
- [ ] **Phase 6: Documentation + Release** - Ship consumer documentation, example workflows, self-test CI, and the first immutable version tag

## Phase Details

### Phase 1: Security Scaffold + Composite Packaging
**Goal**: The action's `action.yml` composite scaffold exists with the four architecturally-binding security controls locked in — `persist-credentials: false`, no `pull_request_target` trigger, scoped MCP tool list committed as the design contract, and secret masking — so no future phase can accidentally introduce these vulnerabilities
**Depends on**: Nothing (first phase)
**Requirements**: PKG-01, PKG-02, CFG-01, CFG-02, CFG-05, SEC-01, SEC-02, SEC-06, SEC-07
**Success Criteria** (what must be TRUE):
  1. Running `cat action.yml` on a cloned copy of the repo shows `runs.using: composite` with `npm ci --production` as the first step; no `dist/index.js` entrypoint exists
  2. Every `actions/checkout` step in any workflow file in `.github/workflows/` includes `persist-credentials: false`; searching the repo for `pull_request_target` returns zero results
  3. A workflow run that provides an invalid `api-key` still masks the value in the Actions log — the raw secret never appears (renamed from `anthropic-api-key` in Phase 1.1)
  4. The `mode` input accepts `ingest`, `heal`, and `dry-run` values and the action fails fast with a descriptive error for any other value
**Plans**: 6 plans
- [x] 01-01-PLAN.md — Package scaffold: package.json + package-lock.json + tsconfig.json + .gitignore (PKG-01, PKG-02)
- [x] 01-02-PLAN.md — Shared modules: src/shared/security-contract.ts + config.ts + security-contract.snapshot.json (CFG-05 foundation)
- [x] 01-03-PLAN.md — Dispatcher + stubs: src/index.ts (D-07 startup order) + src/ingest/index.ts + src/healer/index.ts (SEC-06, CFG-05)
- [x] 01-04-PLAN.md — Composite manifest: action.yml with 8 inputs, SHA-pinned setup-node, INPUT_* env block (PKG-01, PKG-02, CFG-01, CFG-02)
- [x] 01-05-PLAN.md — CI enforcement: .github/workflows/security-lint.yml with 4 D-14 checks (SEC-01, SEC-02, SEC-07)
- [x] 01-06-PLAN.md — CI self-test: .github/workflows/phase1-self-test.yml with 5 jobs including TWO-JOB canary-mask pattern (SEC-06, CFG-02, CFG-05)

### Phase 01.2: Fix npx tsx env-var stripping in composite action runtime (INSERTED)

**Goal:** action.yml's runtime spawn shape preserves hyphenated `INPUT_*` env vars end-to-end so every kebab-cased input reaches `@actions/core.getInput` intact, and `phase1-self-test.yml` has a dedicated regression-test job asserting this invariant — restoring real-CI viability of the composite action and unblocking Phase 03 SC-1/SC-3 live verification (per `03-HUMAN-UAT.md` G-01).
**Requirements**: G-01-PHASE-01.2 (re-satisfies Phase 01 PKG-01, PKG-02, CFG-02 in real CI)
**Depends on:** Phase 01
**Plans:** 1/1 plans complete

Plans:
- [x] 01.2-01-PLAN.md — Empirical gate + action.yml two-site fix + dedicated regression job in phase1-self-test.yml (complete 2026-04-27; see 01.2-01-SUMMARY.md)

### Phase 01.3: Fix pre-existing phase1-self-test.yml test-design bugs (INSERTED)

**Goal:** `phase1-self-test.yml` actually validates what its scenarios claim to validate on a real ubuntu-latest runner — every scenario's assertion mechanism matches GitHub Actions' actual semantics. Concretely: (a) Scenarios 4 + 5's redacted-summary checks read the dispatcher's actual output rather than an unrelated empty per-step `$GITHUB_STEP_SUMMARY` file, and (b) Scenario 1's canary-mask assertion either pre-registers the canary with the runner masker before the step header is emitted, or moves to a mechanism that does not depend on masking literal `with:` values that the runner emits before any action code runs.
**Requirements**: TEST-01 (new) — phase1-self-test.yml end-to-end green on a fresh ubuntu-latest run with no pre-existing test-design bugs.
**Depends on:** Phase 01.2
**Success Criteria** (what must be TRUE):
  1. **Scenarios 4 + 5 dry-run summary assertions** verify the dispatcher's redacted markdown table without depending on the (per-step) `$GITHUB_STEP_SUMMARY` env var bridging from the action invocation step into the assertion step. Likely shape: dispatcher exposes the rendered markdown via `core.setOutput('dryRunSummary', md)` (or writes to a known artifact path), and the assertion step reads `${{ steps.run.outputs.dryRunSummary }}` (or downloads the artifact). Canary, marker, provider row, api-endpoint row, and `(empty — allowed for ollama)` cell all assertable from the same source. No reliance on `[ -s "$GITHUB_STEP_SUMMARY" ]` for cross-step assertions.
  2. **Scenario 1 canary-mask test** fails when (and only when) the canary actually leaks past the runner masker. The current TWO-JOB pattern relies on `core.setSecret()` masking literal `with: api-key:` values that the runner emits in the step header BEFORE any action code runs — structurally impossible. Either: (a) add a setup step in Job A that runs `echo "::add-mask::<canary>"` before `uses: ./` (clearly verifies runner masker only, not `core.setSecret`), or (b) drop the literal canary in `with:` in favour of an action-emitted canary printed AFTER setSecret (verifies the dispatcher's masking contract). Pick one and document the trade-off.
  3. All six scenarios green on a single ubuntu-latest run on a clean fork (no repo secrets required, in line with Pitfall 8 / D-08 from Phase 01.1). The new `self-test-hyphenated-input-env` regression job (Phase 01.2) remains green and untouched. Phase 1's TWO-JOB pattern preference (Pitfall 9 / Pattern 13) is honoured.
  4. The change is purely test/test-helper-side. `src/index.ts` may grow a `core.setOutput('dryRunSummary', md)` call in `runDryRun` (no behaviour change for production users; output is opt-in to consume), but otherwise no production-code behaviour changes. No new threat surface (`HEALER_TEST_MODE` style flags or test-only branches are explicitly out of scope to avoid runtime/test divergence).
**Plans**: 1 plan

Plans:
- [x] 01.3-01-PLAN.md — runDryRun setOutput + action.yml outputs.dry-run-summary + Scenario 1 ::add-mask:: + Scenarios 4/5 env-indirection + 2 new vitest tests + live-CI gate (TEST-01)

### Phase 1.1: Multi-Provider Input Surface (INSERTED)
**Goal**: The action's input surface is provider-agnostic — the same `api-key` input is consumed by Anthropic, Gemini, and Ollama adapters (adapters land in Phase 3). Empty `api-key` is allowed when `provider=ollama` so users can point at a local Ollama instance without auth.
**Depends on**: Phase 1
**Requirements**: CFG-02 (amended), CFG-05 (amended), SEC-06 (amended)
**Success Criteria** (what must be TRUE):
  1. `action.yml` declares inputs `api-key` (not `anthropic-api-key`), `provider` (enum: anthropic | gemini | ollama, default anthropic), `model` (optional; empty string → provider default), `api-endpoint` (optional; empty string → provider default). `INPUT_API-KEY` / `INPUT_PROVIDER` / `INPUT_MODEL` / `INPUT_API-ENDPOINT` env mappings use the hyphen convention required by `@actions/core` v3.
  2. Invoking the action with `provider: ollama` + empty `api-key` + `mode: dry-run` exits 0 and the dry-run summary shows `| \`provider\` | ollama |` and `| \`api-key\` | (empty — allowed for ollama) |`.
  3. Invoking the action with `provider: anthropic` + empty `api-key` fails with a Zod error on path `apiKey` whose message does NOT echo any secret value (CFG-05 masking-safe).
  4. `.github/workflows/phase1-self-test.yml` runs 5 scenarios — the existing 4 renamed + a new `self-test-ollama-empty-key` — and all pass on ubuntu-latest + Node 24.
**Plans**: 1 plan
- [x] 01.1-01-PLAN.md — Input surface rename + provider/model/api-endpoint addition + Zod superRefine + self-test rename + Ollama scenario + docs (complete 2026-04-25; see 01.1-SUMMARY.md)

### Phase 2: Ingest + State Branch + Log-Only Detection
**Goal**: Consuming repos can drop the ingest step into their existing Playwright CI workflow, and after each run a stats record appears on the `playwright-healer-state` branch; when tests cross thresholds the action logs detections to the step summary without dispatching anything
**Depends on**: Phase 1
**Requirements**: CFG-03, CFG-06, CFG-07, ING-01, ING-02, ING-03, ING-04, STA-01, STA-02, STA-03, STA-04, STA-05, DET-01, DET-02, DET-03, DET-04, SEC-05
**Success Criteria** (what must be TRUE):
  1. On first use in a fixture repo, the ingest step creates the `playwright-healer-state` orphan branch; on the second run it appends a new NDJSON line rather than overwriting; the branch is visible with `git log --oneline origin/playwright-healer-state`
  2. Two concurrent ingest steps running in parallel (simulated by a concurrent-write integration test) both land their records on the state branch without either record being lost
  3. A fixture Playwright report with a test that has a 40% failure rate over the rolling window produces a "threshold breached" annotation in the step summary but fires no `workflow_dispatch` event
  4. Providing an invalid `flake-rate-threshold: "banana"` in `.github/playwright-healer.yml` causes the action to fail with a Zod validation error message naming the invalid field, not a JavaScript crash
  5. A commit made by `playwright-healer-bot` causes the ingest step to exit early with an informational message before doing any state-branch work
**Plans**: 7 plans
- [x] 02-00-PLAN.md — Test infrastructure: vitest setup, bare-repo + fixture helpers, package.json deps (Wave 0)
- [x] 02-01-PLAN.md — Config schema extension: CFG-03 threshold fields + yaml loader/merger (CFG-03, CFG-06, CFG-07)
- [x] 02-02-PLAN.md — Types + loop guard + report parser: shared types, SEC-05 guards, Playwright JSON parsing (ING-01..04, SEC-05)
- [x] 02-03-PLAN.md — State branch git protocol: orphan bootstrap, force-with-lease retry, GC, integration tests (STA-01..05)
- [x] 02-04-PLAN.md — Threshold evaluator + step summary writer: pure function, log-only DET-04 (DET-01..04)
- [x] 02-05-PLAN.md — Ingest pipeline wire-up: src/ingest/index.ts end-to-end orchestration
- [x] 02-06-PLAN.md — Phase closure: requirements checklist, ROADMAP + CLAUDE.md update

### Phase 3: Manual Healer (Selectors + Waits + Issue Fallback)
**Goal**: A maintainer can manually trigger the healer workflow with a fixture dispatch payload targeting a known-broken selector or timing issue; the action reproduces the failure, proposes a fix, validates it with N reruns using `retries: 0`, opens a PR using the PAT token so CI actually fires, and routes all failure paths (startup timeout, deterministic failure, diff-lint block, no fix proposable) to structured GitHub issues
**Depends on**: Phase 2
**Requirements**: CFG-04, SEC-03, SEC-04, HEA-01, HEA-02, HEA-03, HEA-04, HEA-05, HEA-06, FIX-01, FIX-02, FIX-03, FIX-04, FIX-05, FIX-06, FIX-08, VAL-01, VAL-02, VAL-03, VAL-04, VAL-05, PRI-01, PRI-02, PRI-03, PRI-05, PRI-06
**Success Criteria** (what must be TRUE):
  1. An intentionally broken selector in a fixture test (`page.locator('#wrong-id')` where the element is `#correct-id`) produces a validated PR titled `[playwright-healer] Fix flaky <test title>` with CI checks actually running on it (not vacuous "all checks passed" from GITHUB_TOKEN)
  2. A diff proposed by the agent that contains `waitForTimeout` or `:nth-child(` is blocked by the diff-lint pass — the healer files a structured GitHub issue titled `[playwright-healer] <test title> is unhealable` rather than opening a PR with the anti-pattern fix
  3. When the fixture app fails to start within `startup-timeout-seconds`, the healer exits cleanly and files a structured issue rather than running the agent loop; no zombie processes remain on the runner
  4. Running the healer against a test that fails deterministically (0/N reruns pass on unmodified code) routes to issue-fallback with a "probable application bug" classification, not a PR
  5. Every bot commit on a healer PR branch contains `[skip-healer]` in the commit message
**Plans**: 13 plans
- [ ] 03-01-PLAN.md — Foundations: deps + config CFG-04 toggles + startupTimeoutSeconds (CFG-04)
- [ ] 03-02-PLAN.md — Type contracts: types.ts + adapter.ts + dispatch-payload.ts + tests (FIX-04)
- [ ] 03-03-PLAN.md — Forbidden patterns + diff-lint + 5 patch fixtures (FIX-03, FIX-06)
- [ ] 03-04-PLAN.md — 7 prompt templates + prompt-assembler + tests (FIX-03, HEA-05)
- [ ] 03-05-PLAN.md — BudgetTracker + stub adapters (FIX-01, FIX-02)
- [ ] 03-06-PLAN.md — App-supervisor readiness probe + PID file constant (HEA-02, HEA-03, HEA-06)
- [ ] 03-07-PLAN.md — Context bundler with first-hop imports + path safety (HEA-04, HEA-05)
- [ ] 03-08-PLAN.md — Validator (--retries=0 / --workers=1 / N reruns) + Playwright JSON fixtures (VAL-01..04)
- [ ] 03-09-PLAN.md — Fix-applier rebase + diff apply + [skip-healer] commit (FIX-05, PRI-06)
- [ ] 03-10-PLAN.md — Gemini adapter: manual loop + audit invariant + budget gate (FIX-01, FIX-02, FIX-04, SEC-03, SEC-04)
- [ ] 03-11-PLAN.md — PR-writer (PAT auth) + issue-writer (six failure-mode tokens) (PRI-01..03, PRI-06, VAL-05)
- [ ] 03-12-PLAN.md — Heal orchestrator: 11-step pipeline + D-09 routing tree (HEA-01, HEA-06, FIX-08, PRI-05)
- [ ] 03-13-PLAN.md — action.yml two-step app supervisor + post-cleanup + wait-for-ready CLI (HEA-01, HEA-02, HEA-03, HEA-06)

### Phase 3.1: First Heal — End-to-End Demo (INSERTED)
**Goal**: A `workflow_dispatch` of `sc1-healer.yml` on `Sacharified/playwright-healer-test` produces a PR titled `[playwright-healer] Fix flaky <test title>` whose diff, when applied, makes `fixture/tests/broken-selector.spec.ts` pass. The PR's own `fixture-ci.yml` workflow run completes with conclusion `success`. This is the project's first end-to-end demonstration of its core value proposition.
**Depends on**: Phase 3
**Requirements**: (no new REQ-IDs — all infrastructure inherited from Phase 03)
**Success Criteria** (single, narrow):
  1. PR appears on `Sacharified/playwright-healer-test` titled `[playwright-healer] Fix flaky <test title>` with a non-empty diff that changes `#wrong-id` → `#correct-id` in `fixture/tests/broken-selector.spec.ts`
  2. The PR's `fixture-ci.yml` workflow run reaches conclusion `success` (real Playwright execution against the patched test passes)
**Plans**: 3 plans

Plans:
- [x] 03.1-01-PLAN.md — Action code changes: three skip flags in config.ts + orchestrator gates + baseUrl interpolation (CRACK-1/D-02/D-03/CRACK-4)
- [x] 03.1-02-PLAN.md — action.yml infra: git credentials step (CRACK-2) + Playwright browser install (CRACK-3) + three new skip inputs
- [x] 03.1-03-PLAN.md — Fixture workflow update (D-04/D-06/D-07) + GitHub Settings toggle + dispatch iteration until success (complete 2026-04-29; 8 iterations; PR #1 + fixture-ci.yml success; $0.0382 USD; see 03.1-03-SUMMARY.md)
**Context**: see `03.1-CONTEXT.md` for locked decisions (D-01..D-08), open questions for researcher (Q-01..Q-03), and out-of-scope/deferred items

### Phase 4: Auto-Dispatch + Full Fix Classes + Deduplication
**Goal**: The threshold evaluator fires live `workflow_dispatch` events when tests breach thresholds; the healer handles all four fix classes (selectors, waits, assertions, slow-test optimizations); repeat triggers for the same test update the existing open PR or issue rather than creating duplicates
**Depends on**: Phase 3
**Requirements**: DET-05, DET-06, DET-07, FIX-07, PRI-04
**Success Criteria** (what must be TRUE):
  1. In a fixture repo where a test exceeds the flake threshold, the ingest step automatically fires a `workflow_dispatch` to the healer workflow using the `healer-token` PAT — verified by checking the triggered workflow run in the GitHub Actions tab
  2. Two simultaneous dispatch events for the same test (same test file + title key) produce only one queued healer run, not two parallel runs
  3. A fixture test whose root cause is a slow assertion (not a selector or timing issue) triggers an assertions fix or slow-test optimization fix from the agent rather than "no fix proposable"
  4. Triggering the healer a second time for a test that already has an open healer PR or issue results in a comment added to the existing item, not a duplicate PR or issue created
**Plans**: 5 plans
- [x] 04-01-PLAN.md — Type widening + ingest dispatch wiring (DET-05, DET-06, DET-07 key-build half) — Wave 1
- [x] 04-02-PLAN.md — FIX-07 type cascade + classifier + 4 new prompt templates (FIX-07) — Wave 2 (depends on 01)
- [x] 04-03-PLAN.md — PRI-04 dedup queries (PRI-04) — Wave 3 (depends on 02 — pr-writer.ts cascade)
- [x] 04-04-PLAN.md — Heal-cap (D-04) + healer-side SEC-05 Guard 3 + heal-event NDJSON + WR-02/WR-03 fixes + WR-01 verify (DET-07) — Wave 4 (depends on 01, 02, 03)
- [x] 04-05-PLAN.md — E2E verification: concurrency block + assertion fixture + full-gates re-run + manual UAT (DET-07, FIX-07) — Wave 5 (depends on 01, 02, 03, 04) — Step A passed (run 25240708504); Steps B/C/D deferred to 04-05-HUMAN-UAT.md

### Phase 5: Auto-Merge
**Goal**: Repos that opt in to auto-merge see eligible healer PRs (selectors fix class, 10/10 validation pass rate, CI green, test-directory-only diff) automatically merged via GitHub's merge queue without human action
**Depends on**: Phase 4
**Requirements**: MRG-01, MRG-02, MRG-03, MRG-04
**Success Criteria** (what must be TRUE):
  1. With `enable-auto-merge: false` (the default), a healer PR that meets all other merge criteria remains open waiting for human review — the action never calls the merge API
  2. With `enable-auto-merge: true`, a healer PR for a selector fix that passes 10/10 reruns and has CI green is merged automatically; the run summary explains which conditions matched
  3. A healer PR that touches a file outside the configured test directory is blocked from auto-merge and the run summary states "blocked by: files outside test directory" even if all other conditions pass
  4. Auto-merge decisions are written to the step summary with the full reasoning band showing each condition and whether it matched or blocked
**Plans**: TBD

### Phase 6: Documentation + Release
**Goal**: A new consumer can adopt playwright-healer in one PR by copying example workflows from the README; the repo has an immutable version tag, a self-test CI workflow, and a SECURITY.md; all prior work is packaged for public consumption
**Depends on**: Phase 5
**Requirements**: PKG-03, PKG-04, PKG-05, DOC-01, DOC-02, DOC-03, DOC-04, DOC-05
**Success Criteria** (what must be TRUE):
  1. Following the README's copy-paste example workflow, a consumer with an existing Playwright repo adopts the action in one PR under 15 minutes — without reading any code beyond the README
  2. The README sequence diagram correctly describes the two-workflow architecture (ingest on every CI push, healer dispatched separately) and documents why `GITHUB_TOKEN` alone is insufficient for PR creation
  3. Pushing to main in the playwright-healer repo triggers a self-test CI workflow that exercises the action against a fixture Playwright repo on `ubuntu-latest` and passes
  4. The repo has at least one immutable version tag (`v0.1.0`) that consumers can pin in `uses:`, and the tag points to a commit where `npm ci --production` correctly installs the Claude Agent SDK native binary on `ubuntu-latest`
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Security Scaffold + Composite Packaging | 6/6 | Complete | 2026-04-25 |
| 1.1 Multi-Provider Input Surface | 1/1 | Complete | 2026-04-25 |
| 1.2 Fix npx tsx env-var stripping | 1/1 | Complete | 2026-04-27 |
| 1.3 Fix phase1-self-test.yml test-design bugs | 1/1 | Complete | 2026-04-27 |
| 2. Ingest + State Branch + Log-Only Detection | 7/7 | Complete | 2026-04-25 |
| 3. Manual Healer (Selectors + Waits + Issue Fallback) | 15/15 | Complete | 2026-04-29 |
| 3.1 First Heal — End-to-End Demo (INSERTED) | 3/3 | Complete | 2026-04-29 |
| 4. Auto-Dispatch + Full Fix Classes + Deduplication | 3/5 | In progress | - |
| 5. Auto-Merge | 0/TBD | Not started | - |
| 6. Documentation + Release | 0/TBD | Not started | - |
