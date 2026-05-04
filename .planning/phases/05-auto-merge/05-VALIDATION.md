---
phase: 5
slug: auto-merge
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-02
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> See `05-RESEARCH.md` §"Validation Architecture" for surface-level test design.

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

- **After every task commit:** Run `./node_modules/.bin/vitest run --reporter=dot` for the modified test file region.
- **After every plan wave:** Run `./node_modules/.bin/vitest run && ./node_modules/.bin/tsc --noEmit`.
- **Before `/gsd-verify-work`:** Full suite must be green AND both D-11 manual gates green.
- **Max feedback latency:** 30 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 05-01-T1 | 01 | 1 | MRG-01, MRG-02 | T-05-01 | superRefine misconfig guard rejects empty allow-list when enableAutoMerge=true | unit | `./node_modules/.bin/vitest run src/shared/config.test.ts --reporter=dot && ./node_modules/.bin/tsc --noEmit` | partial (extend) | ⬜ pending |
| 05-01-T2 | 01 | 1 | MRG-01 | T-05-04 | snake_case → INPUT_UPPERCASE_SNAKE convention preserved (Phase 01.2) | static | `grep -n "enable_auto_merge:\|auto_merge_pass_rate:\|auto_merge_fix_classes:" action.yml && grep -c "INPUT_ENABLE_AUTO_MERGE\|INPUT_AUTO_MERGE_PASS_RATE\|INPUT_AUTO_MERGE_FIX_CLASSES" action.yml && python3 -c "import yaml; yaml.safe_load(open('action.yml'))"` | MOD | ⬜ pending |
| 05-01-T3 | 01 | 1 | MRG-02 | — | OpenHealerPrArgs widened with four required Phase-05 fields | type-check | `./node_modules/.bin/vitest run src/healer/pr-writer.test.ts --reporter=dot && ./node_modules/.bin/tsc --noEmit --pretty false 2>&1 \| grep -E "src/healer/pr-writer\.ts" \| grep -v "src/healer/pr-writer.test.ts" \| { grep -E "error" && exit 1 \|\| exit 0; }` | MOD (Plan 02 fixes index.ts) | ⬜ pending |
| 05-02-T1 | 02 | 2 | MRG-02 | T-05-02 | CONFIG_FILE_DENYLIST overlay + extractPatchedFiles + helpers; D-17 SSOT preserved | type-check | `./node_modules/.bin/tsc --noEmit 2>&1 \| grep -E "src/healer/pr-writer\.ts" \| grep -v "src/healer/pr-writer.test.ts" \| grep -v "src/healer/index.ts" \| { grep -E "error TS" && exit 1 \|\| exit 0; }` | MOD | ⬜ pending |
| 05-02-T2 | 02 | 2 | MRG-02 | T-05-02 | evaluateAutoMerge pure function; ~28 table-driven cases × 4 conditions; D-07 total=0 ineligible | unit | `./node_modules/.bin/vitest run src/healer/pr-writer.test.ts --reporter=dot && ./node_modules/.bin/tsc --noEmit` | MOD | ⬜ pending |
| 05-02-T3 | 02 | 2 | MRG-03, MRG-04 | T-05-03, T-05-06 | enableAutoMerge GraphQL wrapper with GraphqlResponseError + non-GraphQL soft-fail; renderAutoMergeBand markdown emission; squash-only without commitHeadline/Body so SKIP_SENTINEL preserved | unit | `./node_modules/.bin/vitest run src/healer/pr-writer.test.ts --reporter=dot && ./node_modules/.bin/tsc --noEmit` | MOD | ⬜ pending |
| 05-02-T4 | 02 | 2 | MRG-02, MRG-03, MRG-04 | T-05-05 | gate fires post-pulls.create only; D-08 dedup-bypass; pr.node_id undefined guard; band always renders on PR creation; index.ts threading via imported extractPatchedFiles | unit + integration | `./node_modules/.bin/vitest run src/healer/pr-writer.test.ts src/shared/config.test.ts --reporter=dot && ./node_modules/.bin/tsc --noEmit` | MOD | ⬜ pending |
| 05-03-T0 | 03 | 3 | — | — | README §Auto-merge prerequisites top-level anchor exists for D-05 link target | static | `grep -n "^## Auto-merge prerequisites$" README.md && grep -A 12 "^## Auto-merge prerequisites$" README.md \| grep -c "Allow auto-merge\|Allow squash merging\|Branch protection rule\|healer_token" \| { read n; [ "$n" -ge 4 ] && exit 0 \|\| exit 1; }` | NEW section | ⬜ pending |
| 05-03-T1 | 03 | 3 | MRG-01 + ROADMAP SC#1, SC#4 | T-05-07 | enable_auto_merge=false → no GraphQL call + band shows preview-mode outcome row | manual / e2e | `gh workflow run e2e-heal-self.yml ... && gh run view <id> --log \| grep -i "enablePullRequestAutoMerge"` should return 0 matches | manual-only | ⬜ pending |
| 05-03-T2 | 03 | 3 | MRG-02, MRG-03 + ROADMAP SC#2 | T-05-06 | enable=true on branch-protected fixture → mutation succeeds + PR auto-squashes + SKIP_SENTINEL preserved in squash commit body | manual / e2e | `gh pr view <pr-number> --json state` returns `{"state":"MERGED"}` AND `git log -1 --format=%B <squash-sha> \| grep skip-healer` | manual-only | ⬜ pending |
| 05-03-T3 | 03 | 3 | ROADMAP SC#3 | T-05-02 | out-of-test-dir blocking — Layer A unit (Test IN5 from Plan 02-T4) is canonical; live demo impractical without bypassing FIX-06 | unit-citation | `./node_modules/.bin/vitest run src/healer/pr-writer.test.ts -t "IN5"` | unit-only | ⬜ pending |
| 05-03-T4 | 03 | 3 | CONTEXT D-05 | T-05-03 | Soft-fail GraphQL error → core.warning + band reason renders + heal exit 0 | manual or unit-citation | live: deliberately disable branch protection then dispatch; OR cite `vitest run src/healer/pr-writer.test.ts -t "EF\|IN3"` | manual-or-unit | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Each task that creates a new source-file region uses inline `<behavior>` blocks listing test cases; no separate Wave 0 plan is needed. This matches the project's existing test-first discipline (`pr-writer.test.ts`, `validator.test.ts`, `config.test.ts` all alongside their source files).

Tests that may be NEW (planner to confirm during plan authoring):
- `src/healer/pr-writer.test.ts` — extend existing file with `evaluateAutoMerge`, `enableAutoMerge`, `renderAutoMergeBand` cases (likely partial extend, not new file)
- `src/shared/config.test.ts` — extend with the three new Zod fields and the auto-merge superRefine misconfig case (partial extend)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `enable_auto_merge: false` zero-behavior-change demo | MRG-01 + ROADMAP SC #1 | Requires GitHub Actions runtime + real PAT | Re-run Phase 03.1 e2e on `Sacharified/playwright-healer-test` with default config; verify PR opens, reasoning band renders `auto_merge: eligible \| enable_auto_merge=false (informational only)`, NO `enablePullRequestAutoMerge` GraphQL call in run log |
| `enable_auto_merge: true` happy-path demo | MRG-03 + ROADMAP SC #2 | Requires GitHub Actions runtime + branch-protection-configured fixture | Re-run Phase 03.1 e2e on a fixture branch with branch protection ON (Settings → Branches → Add rule → Require status checks); verify PR opens, mutation succeeds (`autoMergeRequest.enabledAt` populated in band), `fixture-ci.yml` passes, PR auto-squashes to `main` |
| Reasoning-band format stable across builds | MRG-04 + ROADMAP SC #4 | Requires real heal artifact for visual review | Inspect run summary on the two demo runs above; confirm markdown table renders correctly in GitHub Actions UI (no broken cells, condition rows match RESEARCH §Pattern 5 shape) |
| Out-of-test-dir blocking demo | ROADMAP SC #3 | Requires synthesized agent diff that escapes tests/ — hard to automate without LLM call | Manually craft a unified diff touching `src/foo.ts`, run gate harness against it (test-only entry point); verify reasoning band renders `scope: blocked by: files outside test directory (src/foo.ts)` AND `auto_merge: blocked` even with all other conditions matched. Planner may opt to make this automated by exposing a CLI test harness instead. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are explicit `checkpoint:human-verify` (Plan 03 Tasks 1-4 are checkpoint:human-verify; Plan 03 Task 0 has automated verify; all Plan 01 + Plan 02 tasks have automated verify)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (Wave 1: 3 auto, Wave 2: 4 auto, Wave 3: 1 auto + 4 checkpoint — checkpoints sandwiched after T0's auto verify)
- [x] Wave 0 covers all MISSING references (existing `pr-writer.test.ts` and `config.test.ts` extended inline; no NEW test files; `<behavior>` blocks in plans declare cases inline per project test-first discipline)
- [x] No watch-mode flags (all vitest invocations use `run --reporter=dot`)
- [x] Feedback latency < 30s (vitest run on a single test file ~5s; full suite ~30s)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready (2026-05-02)
