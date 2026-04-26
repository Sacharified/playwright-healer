---
phase: 3
slug: manual-healer-selectors-waits-issue-fallback
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-27
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Sourced from `03-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.5 (existing — Phase 02-00 installed) |
| **Config file** | None at repo root yet — same harness reused |
| **Quick run command** | `npx vitest run src/healer/<file>.test.ts` |
| **Full suite command** | `npm test` (= `vitest run`) |
| **Estimated runtime** | < 60s for healer subtree; full suite < 90s |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/healer/<changed-file>.test.ts` (target the modified file's test sibling)
- **After every plan wave:** Run `npm test` (full vitest suite)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds for per-task; 90 seconds for per-wave

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-XX-NN | TBD | 0 | CFG-04 | — | Per-fix-class toggles parse + default to true | unit | `npx vitest run src/shared/config.test.ts` | ❌ W0 (extend) | ⬜ |
| 3-XX-NN | TBD | TBD | HEA-02 | — | Probe: 200/302/401 → ready, 500/ECONNREFUSED → poll, deadline → throw `AppStartupTimeout` | unit | `npx vitest run src/healer/app-supervisor.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | HEA-03 | — | Startup timeout exits cleanly, files startup-timeout issue, post-step pkill clears PID | component | `npx vitest run src/healer/app-supervisor.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | HEA-04 | — | Context-bundler reads test source + first-hop imports + git blame + null trace | component | `npx vitest run src/healer/context-bundler.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | HEA-05 | — | Trace-free prompt variant instructs live repro via Playwright MCP | unit | `npx vitest run src/healer/prompt-assembler.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | HEA-06 | — | TS try/finally calls `appSupervisor.stop()` + `mcpClient.close()`; post-step `pkill` runs `if: always()` | component | `npx vitest run src/healer/index.test.ts` + `node tools/check-action-yml.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | FIX-01 | — | Heal entry-point reachable via `mode: heal`; replaces Phase 1 stub | component | `npx vitest run src/healer/index.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | FIX-02 | T-3-FIX-02 | Adapter aborts pre-call when `usdSpent >= maxBudgetUsd`; aborts when `turn >= maxTurns` | unit | `npx vitest run src/healer/budget.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | FIX-03 | — | Selectors prompt forbids `:nth-child`, positional XPath; waits prompt forbids `waitForTimeout` | unit | `npx vitest run src/healer/prompt-assembler.test.ts` (snapshot) | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | FIX-04 | — | Adapter returns `FixProposal` for valid JSON; `NoFixProposable` for sentinel; throws on unparseable | unit | `npx vitest run src/healer/adapters/gemini.test.ts` (mock `@google/genai`) | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | FIX-05 | T-3-FIX-05 | Fix-applier rebases onto `origin/<default>` then applies diff; commit msg includes `[skip-healer]` | component | `npx vitest run src/healer/fix-applier.test.ts` (bare-repo helper) | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | FIX-06 | T-3-FIX-06 | Diff-lint flags `waitForTimeout`, `:nth-child(`, `xpath=`, weakened assertion, out-of-test-dir path; clean diff → empty | unit | `npx vitest run src/healer/diff-lint.test.ts` (positive + negative per pattern) | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | FIX-08 | — | NoFixProposable from adapter routes to `no-fix-proposable` issue | component | `npx vitest run src/healer/index.test.ts` (Octokit mocked) | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | VAL-01 | — | Validator runs `npx playwright test --grep <escaped> --retries=0 --workers=1` | unit | `npx vitest run src/healer/validator.test.ts` (mock `@actions/exec`; assert argv) | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | VAL-02 | — | Validator runs N reruns sequentially (N = `rerun-count`) | component | `npx vitest run src/healer/validator.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | VAL-03 | — | Validator gates on `pass_rate >= rerun-pass-rate`; below → routes to validation-failed issue | component | `npx vitest run src/healer/validator.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | VAL-04 | — | Validator does NOT restart app between reruns (documented limitation) | unit | `npx vitest run src/healer/validator.test.ts` (assert no `appSupervisor.restart`) | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | VAL-05 | — | Validation summary appears in PR body and `$GITHUB_STEP_SUMMARY` | component | `npx vitest run src/healer/pr-writer.test.ts` (capture body arg) | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | PRI-01 | — | PR title `[playwright-healer] Fix flaky <test title>`; branch `playwright-healer/<test-slug>-<short-sha>` | unit | `npx vitest run src/healer/pr-writer.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | PRI-02 | — | PR body contains root cause, fix class, validation pass-rate, cost spent, links, signed-off footer | unit | `npx vitest run src/healer/pr-writer.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | PRI-03 | — | Issue title `[playwright-healer] <test title> is unhealable`; body has `## Failure mode` with one of six tokens | unit | `npx vitest run src/healer/issue-writer.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | PRI-05 | — | Pre-fix sanity rerun on UNMODIFIED code: 0/N → `deterministic-failure` issue, no adapter call | component | `npx vitest run src/healer/index.test.ts` (mock validator → 0/N; assert `adapter.runAgent` not called) | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | PRI-06 | — | Every bot commit message contains `[skip-healer]` (loop-guard sentinel) | unit | `npx vitest run src/healer/fix-applier.test.ts` + `pr-writer.test.ts` | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | SEC-03 | T-3-SEC-03 | MCP spawned with `--allowed-origins=${baseUrl};http://localhost:*` from `ALLOWED_ORIGIN_TEMPLATE` | unit | `npx vitest run src/healer/adapters/gemini.test.ts` (mock `StdioClientTransport`; assert constructor args) | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | SEC-04 | T-3-SEC-04 | Audit invariant: gemini adapter rejects MCP server with a tool name not covered by `ALLOWED_TOOLS` | unit | `npx vitest run src/healer/adapters/gemini.test.ts` (mock `mcpClient.listTools()` returning rogue name; assert throws) | ❌ W0 | ⬜ |
| 3-XX-NN | TBD | TBD | CFG-04 | — | New CFG inputs: `setup-command`, `start-command`, `startup-timeout-seconds`, `rerun-count`, `rerun-pass-rate` parse + Zod-validate | unit | `npx vitest run src/shared/config.test.ts` (extend) | ❌ W0 | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> Task IDs (`3-XX-NN`) are placeholders — gsd-planner will assign real IDs when plans are drafted. The mapping above is per-requirement; multiple tasks may share a row (e.g., FIX-05 spans diff-apply + rebase + commit-message tasks).

---

## Wave 0 Requirements

All test files below are NEW (Phase 02-00 covered ingest only; no healer test infra exists):

- [ ] `src/healer/app-supervisor.test.ts` — HEA-02, HEA-03
- [ ] `src/healer/budget.test.ts` — FIX-02
- [ ] `src/healer/context-bundler.test.ts` — HEA-04
- [ ] `src/healer/diff-lint.test.ts` — FIX-06
- [ ] `src/healer/fix-applier.test.ts` — FIX-05, PRI-06
- [ ] `src/healer/validator.test.ts` — VAL-01..VAL-04
- [ ] `src/healer/pr-writer.test.ts` — PRI-01, PRI-02, VAL-05
- [ ] `src/healer/issue-writer.test.ts` — PRI-03, D-09, D-10
- [ ] `src/healer/index.test.ts` — D-09 routing tree, PRI-05, FIX-01, HEA-06, FIX-08
- [ ] `src/healer/adapters/gemini.test.ts` — FIX-04, SEC-03, SEC-04, FIX-02
- [ ] `src/healer/adapters/anthropic.test.ts` — D-01 stub error message
- [ ] `src/healer/adapters/ollama.test.ts` — D-01 stub error message
- [ ] `src/healer/prompt-assembler.test.ts` — D-05/D-06/D-07/D-08 determinism, FIX-03, HEA-05
- [ ] `src/shared/config.test.ts` — extend with CFG-04 toggles + new inputs
- [ ] `tests/fixtures/playwright-rerun-passed.json` — Playwright JSON reporter sample (1 pass)
- [ ] `tests/fixtures/playwright-rerun-failed.json` — Playwright JSON reporter sample (1 fail)
- [ ] `tests/fixtures/playwright-rerun-mixed.json` — 9/10 pass mixed sample
- [ ] `tests/fixtures/unified-diff-clean.patch` — diff-lint passes
- [ ] `tests/fixtures/unified-diff-with-waitForTimeout.patch` — diff-lint blocks
- [ ] `tests/fixtures/unified-diff-with-nth-child.patch` — diff-lint blocks
- [ ] `tests/fixtures/unified-diff-with-weakened-assertion.patch` — diff-lint blocks
- [ ] `tests/fixtures/unified-diff-out-of-testdir.patch` — diff-lint blocks (path allowlist)

**Mock strategy:**
- `@google/genai` — vitest mock returning queued `GenerateContentResponse` objects (text + functionCalls + usageMetadata).
- `@modelcontextprotocol/sdk` `Client` — mock with `listTools()` and `callTool()` returning fixture data.
- `@actions/exec` — vitest mock; capture argv; return canned exit codes/stdout.
- `@octokit/rest` — vitest mock; capture method args.
- **Real fs + real bare repos** for git ops (reuse Phase 02-00 helpers from `tests/state-branch.helpers.ts`).
- **NOT mocked:** Playwright browsers (E2E deferred to Phase 6).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real Gemini API round-trip producing a valid `FixProposal` | FIX-04 | Costs API quota; non-deterministic LLM output | Deferred to Phase 6 PKG-04 self-test (`npm run self-test:gemini`) |
| CI checks actually fire on bot-opened PR (Pitfall 1 mitigation in production) | PRI-01 success criterion #1 | Requires real GitHub Actions environment + PAT | Phase 6 self-test in fixture repo |
| End-to-end: broken `#wrong-id` selector → validated PR | ROADMAP SC #1 | Same as above | Phase 6 self-test |
| End-to-end: `waitForTimeout` agent proposal → diff-lint blocks → issue | ROADMAP SC #2 | Same as above | Phase 6 self-test |
| Fixture app startup timeout → issue, no zombie processes | ROADMAP SC #3 | Real runner process behavior | Phase 6 self-test (asserts via `pgrep` post-cleanup) |

> Phase 3 vitest stops at component level. The above behaviors have unit/component proxies (via mocks) — manual rows here are about *production correctness* not regression risk.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (15 new test files + 8 fixtures)
- [ ] No watch-mode flags (Vitest invoked with `run` not `watch`)
- [ ] Feedback latency < 60s per-task, < 90s per-wave
- [ ] `nyquist_compliant: true` set in frontmatter (after planner wires task IDs)

**Approval:** pending
