---
phase: 4
slug: auto-dispatch-full-fix-classes-deduplication
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-01
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts (implicit defaults) |
| **Quick run command** | `./node_modules/.bin/vitest run --reporter=dot --pool=forks` |
| **Full suite command** | `./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit` |
| **Estimated runtime** | ~30 seconds (full suite) |

---

## Sampling Rate

- **After every task commit:** Run `./node_modules/.bin/vitest run --reporter=dot` for the modified file region.
- **After every plan wave:** Run `./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit`.
- **Before `/gsd-verify-work`:** Full suite must be green.
- **Max feedback latency:** 30 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 04-01-T1 | 01 | 1 | DET-05/06/07 (key-build half) | T-04-04 | Zod allow-list rejects unknown enum + concurrencyKey min(1) | unit | `./node_modules/.bin/vitest run src/healer/dispatch-payload.test.ts src/shared/config.test.ts --reporter=dot` | partial (extend) | ⬜ pending |
| 04-01-T2 | 01 | 1 | DET-05/06/07 | T-04-01, T-04-04 | PAT in Octokit ctor only; classifier-free; SHA-1 collision | unit | `./node_modules/.bin/vitest run src/ingest/dispatch.test.ts --reporter=dot` | NEW | ⬜ pending |
| 04-01-T3 | 01 | 1 | DET-05/06/07 | T-04-01 | INPUT_* underscores (Pitfall 8); ref=default_branch | unit + lint | `./node_modules/.bin/vitest run src/ingest/index.test.ts src/ingest/summary-writer.test.ts && grep -c 'INPUT_ENABLE_AUTO_DISPATCH' action.yml` | partial (extend) | ⬜ pending |
| 04-02-T1 | 02 | 1 | FIX-07 | T-04-04 | VALID_CLASSES allow-list narrows agent JSON | unit | `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run src/healer/adapters/ src/healer/prompt-assembler.test.ts src/healer/pr-writer.test.ts --reporter=dot` | partial (extend) | ⬜ pending |
| 04-02-T2 | 02 | 1 | FIX-07 | T-04-04 | Module-scope static RegExp; no eval/new RegExp(input) | unit | `./node_modules/.bin/vitest run src/ingest/classifier.test.ts src/ingest/index.test.ts --reporter=dot && grep -c 'eval\\|new Function\\|new RegExp(' src/ingest/classifier.ts` | NEW | ⬜ pending |
| 04-02-T3 | 02 | 1 | FIX-07 | T-04-04 | Forbidden stanza in every template | snapshot | `./node_modules/.bin/vitest run src/healer/prompt-assembler.test.ts --reporter=dot && ls src/healer/prompts/{assertions,slow}-{no-trace,with-trace}.md` | NEW (4 templates) | ⬜ pending |
| 04-03-T1 | 03 | 2 | PRI-04 | T-04-03 | PAT in ctor only; head:`owner:branch` (Pitfall 3) | unit | `./node_modules/.bin/vitest run src/healer/pr-writer.test.ts --reporter=dot` | partial (extend) | ⬜ pending |
| 04-03-T2 | 03 | 2 | PRI-04 | T-04-03, T-04-04 | `is:issue` qualifier (Pitfall 4); quote-escape | unit | `./node_modules/.bin/vitest run src/healer/issue-writer.test.ts --reporter=dot` | partial (extend) | ⬜ pending |
| 04-04-T1 | 04 | 2 | DET-07 | T-04-02 | Pitfall A/B/C invariants; [skip-healer] sentinel | unit + integration | `./node_modules/.bin/vitest run src/shared/state-branch.test.ts src/shared/loop-guard.test.ts --reporter=dot && ./node_modules/.bin/tsc --noEmit` | partial (extend) | ⬜ pending |
| 04-04-T2 | 04 | 2 | DET-07 | T-04-02 | Defense-in-depth dual-gate; sticky cap | unit | `./node_modules/.bin/vitest run src/ingest/index.test.ts src/healer/index.test.ts src/ingest/dispatch.test.ts --reporter=dot` | partial (extend) | ⬜ pending |
| 04-04-T3 | 04 | 2 | DET-07 (WR-02/03/01) | T-04-04, T-04-05 | WR-01 negative grep; WR-02 honest skipped render | unit + lint | `./node_modules/.bin/vitest run src/healer/index.test.ts src/healer/pr-writer.test.ts --reporter=dot && ! grep -rn 'git config --global url.insteadOf' action.yml src/ .github/workflows/` | partial (extend) | ⬜ pending |
| 04-05-T1 | 05 | 3 | DET-07 (workflow-side) | T-04-04 | concurrency block exists; cancel-in-progress: false | static | `grep -n 'concurrency:' .github/workflows/e2e-heal-self.yml && grep -n 'concurrencyKey:' .github/workflows/e2e-heal-self.yml && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/e2e-heal-self.yml'))"` | MOD | ⬜ pending |
| 04-05-T2 | 05 | 3 | FIX-07 (e2e fixture) | T-04-04 | Red-guard fails as expected | playwright | `cd fixture && npx playwright test tests/broken-assertion.spec.ts --reporter=list 2>&1 \| grep -E 'Expected:\|expect\\(received\\)\|toHaveText'` | NEW | ⬜ pending |
| 04-05-T3 | 05 | 3 | DET-07 + FIX-07 (e2e) | T-04-02, T-04-04 | Manual UAT — concurrency queue + assertion-class PR + cap-hit issue | manual / e2e | `gh workflow run e2e-heal-self.yml ... && gh run list ...` | manual-only | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Each task that creates a new source file uses `tdd="true"` with `<behavior>` blocks listing test cases inline; no separate Wave 0 plan is needed. This matches the project's existing test-first discipline (see `prompt-assembler.test.ts`, `pr-writer.test.ts`, `state-branch.test.ts` — all alongside their source files).

Tests created during plan execution:
- `src/ingest/dispatch.test.ts` — NEW (Plan 01 Task 2)
- `src/ingest/classifier.test.ts` — NEW (Plan 02 Task 2)
- `src/healer/issue-writer.test.ts` — possibly NEW if absent (Plan 03 Task 2)
- `src/shared/loop-guard.test.ts` — possibly NEW if absent (Plan 04 Task 1)

All other test files exist; new test cases are appended.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `workflow_dispatch` fires from ingest on threshold breach | DET-05 | Requires GitHub Actions runtime + real PAT | Push fixture failures to `Sacharified/playwright-healer-test` with `enable_auto_dispatch: 'true'`; verify healer workflow run appears in Actions tab |
| Concurrency group queues simultaneous dispatch events | DET-07 SC #2 | Requires concurrent GH Actions runs | Plan 05 Task 3 Step C: `gh workflow run` × 2 in rapid succession; verify `gh run list` shows queued, not parallel |
| Assertion-class heal lands a PR with `fixClass: assertions` | FIX-07 SC #3 | Requires full e2e fixture + LLM provider | Plan 05 Task 3 Step B: dispatch against `broken-assertion.spec.ts`; verify PR title + diff shape + fixClass |
| End-to-end re-run of 03.1 demo with all gates re-engaged | success-criteria #1 | Requires full e2e fixture + LLM provider | Plan 05 Task 3 Step A: re-run `e2e-heal-self.yml` with `skip_post_fix_validation` removed; PR opens with diff-lint clean and post-fix validation honest |
| Cap-exceeded sticky issue after 3+ heal events | DET-07 (sticky cap) | Requires accumulated state-branch heal log | Plan 05 Task 3 Step D: trigger 4th dispatch for same test after Steps A-C; verify `cap-exceeded` issue opens, no new PR |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are explicit checkpoint:human-verify
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (Plan 05 Task 3 is the only manual gate; sandwiched between automated tasks)
- [x] Wave 0 covers all MISSING references (NEW test files declared inline via tdd="true")
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready
