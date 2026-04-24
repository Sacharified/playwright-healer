# Roadmap: playwright-healer

## Overview

playwright-healer ships as a composite GitHub Action that transforms Playwright test failures into reviewable PRs or structured issues without human log-reading. The build order is security-first: the four architecturally-binding pitfalls land in Phase 1 before any agent code is written. Phase 2 validates the git-as-DB state branch at zero API cost. Phase 3 wires the full healer pipeline manually, including issue fallback for all failure paths. Phase 4 adds automatic dispatch and the remaining fix classes. Phase 5 adds opt-in auto-merge. Phase 6 ships documentation and the version release.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Security Scaffold + Composite Packaging** - Establish the composite action structure with all four architecturally-binding security controls in place before any agent code is written
- [ ] **Phase 1.1: Multi-Provider Input Surface** (INSERTED) - Generalize the Anthropic-specific input surface to support Anthropic, Gemini, and Ollama via a `provider` input; drop `required: true` on `api-key` with per-provider Zod `superRefine` enforcement; adapters land in Phase 3
- [ ] **Phase 2: Ingest + State Branch + Log-Only Detection** - Build and validate the git-as-DB observability layer at zero API cost; consuming repos can adopt and see their stats
- [ ] **Phase 3: Manual Healer (Selectors + Waits + Issue Fallback)** - Wire the full healer pipeline triggered via manual `workflow_dispatch`; agent loop, fix applier, validator, PR path, and issue fallback for all failure modes
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
- [ ] 01-05-PLAN.md — CI enforcement: .github/workflows/security-lint.yml with 4 D-14 checks (SEC-01, SEC-02, SEC-07)
- [ ] 01-06-PLAN.md — CI self-test: .github/workflows/phase1-self-test.yml with 5 jobs including TWO-JOB canary-mask pattern (SEC-06, CFG-02, CFG-05)

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
- [ ] 01.1-01-PLAN.md — Input surface rename + provider/model/api-endpoint addition + Zod superRefine + self-test rename + Ollama scenario + docs

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
**Plans**: TBD

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
**Plans**: TBD

### Phase 4: Auto-Dispatch + Full Fix Classes + Deduplication
**Goal**: The threshold evaluator fires live `workflow_dispatch` events when tests breach thresholds; the healer handles all four fix classes (selectors, waits, assertions, slow-test optimizations); repeat triggers for the same test update the existing open PR or issue rather than creating duplicates
**Depends on**: Phase 3
**Requirements**: DET-05, DET-06, DET-07, FIX-07, PRI-04
**Success Criteria** (what must be TRUE):
  1. In a fixture repo where a test exceeds the flake threshold, the ingest step automatically fires a `workflow_dispatch` to the healer workflow using the `healer-token` PAT — verified by checking the triggered workflow run in the GitHub Actions tab
  2. Two simultaneous dispatch events for the same test (same test file + title key) produce only one queued healer run, not two parallel runs
  3. A fixture test whose root cause is a slow assertion (not a selector or timing issue) triggers an assertions fix or slow-test optimization fix from the agent rather than "no fix proposable"
  4. Triggering the healer a second time for a test that already has an open healer PR or issue results in a comment added to the existing item, not a duplicate PR or issue created
**Plans**: TBD

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
| 1. Security Scaffold + Composite Packaging | 4/6 | In progress | - |
| 2. Ingest + State Branch + Log-Only Detection | 0/TBD | Not started | - |
| 3. Manual Healer (Selectors + Waits + Issue Fallback) | 0/TBD | Not started | - |
| 4. Auto-Dispatch + Full Fix Classes + Deduplication | 0/TBD | Not started | - |
| 5. Auto-Merge | 0/TBD | Not started | - |
| 6. Documentation + Release | 0/TBD | Not started | - |
