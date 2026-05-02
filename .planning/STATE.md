---
gsd_state_version: 1.0
milestone: v0.1.0
milestone_name: milestone
status: verifying
stopped_at: "Completed 04-05-PLAN.md automated tasks (Tasks 1-2); checkpoint:human-verify Task 3 pending maintainer UAT"
last_updated: "2026-05-02T00:00:49.655Z"
last_activity: 2026-05-02
progress:
  total_phases: 10
  completed_phases: 7
  total_plans: 38
  completed_plans: 40
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-29)

**Core value:** A flaky Playwright test should result in a reviewable PR (or a structured issue) without a human reading logs.
**Current focus:** Phase 03.1 — first-heal-end-to-end-demo

## Current Position

Phase: 4
Plan: 5 of 5
Status: Phase complete — ready for verification
Last activity: 2026-05-02

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**

- Total plans completed: 12
- Average duration: —
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 02 | 7 | - | - |
| 01.2 | 1 | - | - |
| 01.3 | 1 | - | - |
| 03.1 | 3 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 8m | 2 tasks | 4 files |
| Phase 01-security-scaffold-composite-packaging P02 | 8m | 2 tasks | 3 files |
| Phase 01-security-scaffold-composite-packaging P03 | ~15m | 2 tasks | 3 files |
| Phase 01-security-scaffold-composite-packaging P04 | 12min | 2 tasks | 2 files |
| Phase 01-security-scaffold-composite-packaging P05 | 4m | 2 tasks | 2 files |
| Phase 01-security-scaffold-composite-packaging P06 | 5m | 1 tasks | 1 files |
| Phase 01.2 P01 | 3min | 3 tasks | 2 files |
| Phase 01.3 P01 | 15min | 4 tasks | 5 files |
| Phase 04-auto-dispatch-full-fix-classes-deduplication P02 | 8 | 3 tasks | 17 files |
| Phase 04-auto-dispatch-full-fix-classes-deduplication P04 | ~35m | 3 tasks | 15 files |
| Phase 04 P04 | ~50m | 3 tasks | 17 files |
| Phase 04-auto-dispatch-full-fix-classes-deduplication P05 | ~20m (automated tasks only; UAT pending) | 3 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Initialization: Composite action packaging confirmed (no ncc/esbuild — Agent SDK native binary breaks with bundlers; ncc drops Node 24 support June 2, 2026)
- Initialization: PAT (`healer-token`) required for PR creation — GITHUB_TOKEN cannot trigger CI on bot-opened PRs
- Initialization: Security scaffolding (4 pitfalls) must land in Phase 1 before any agent code is written — architectural constraint from research
- Zod ^4.0.0 (not stale ^3.25.0): npm registry verified 2026-04-24 that claude-agent-sdk peer-requires ^4.0.0 only; resolved as 4.3.6
- @actions/core pinned exactly at 3.0.1 (no caret) per PKG supply-chain mitigation
- SDK native binary claude-agent-sdk-darwin-arm64 resolved on macOS dev; linux-x64 to be verified in Plan 06 on ubuntu-latest
- Arrays in security-contract.ts sorted alphabetically (Glob, Grep, Read, mcp__playwright__*) — advisor reconciliation resolving PATTERNS §4 vs CONTEXT D-11 ordering inconsistency
- Snapshot generated via recursive canonical() node helper (not JSON.stringify second-arg key filter) — safe for nested structures
- z.string().min(1, { message }) object form used for Zod 4 (not Zod 3 positional shorthand)
- D-07 startup order implemented verbatim — setSecret × 3 precede safeParse (awk verified at lines 28 < 43)
- Zod issue.path.join('.') produces camelCase (anthropicApiKey not anthropic-api-key) — Plan 06 assertions must match camelCase
- @actions/core v3 getInput maps hyphens to hyphens in env var name (INPUT_ANTHROPIC-API-KEY not INPUT_ANTHROPIC_API_KEY)
- INPUT_* env keys use hyphens (INPUT_ANTHROPIC-API-KEY) not underscores — @actions/core v3 preserves hyphens; RESEARCH Pattern 1 was stale; 01-03-SUMMARY empirical finding is authoritative
- actions/setup-node SHA 48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e re-verified at execution via gh api — matches RESEARCH.md exactly, tag not moved
- actions/checkout@v6.0.2 SHA de0fac2e4500dabe0009e67214ff5f5447ce83dd confirmed via gh api at execution — matches RESEARCH.md snapshot exactly (tag not moved)
- src/shared/security-contract.ts added to Check 1 :(exclude) pathspec in security-lint.yml — file legitimately contains pull_request_target as FORBIDDEN_WORKFLOW_TRIGGERS constant; Rule 1 auto-fix
- security-lint.yml uses single job (6 steps) over 4 jobs — checks are fast; plan endorses this pattern
- TWO-JOB pattern mandatory for Scenario 1 — in-job log grep races log API finalization; Job B needs: A + if: always() is the only reliable approach (Pitfall 9 / Pattern 13)
- Canary inline literal test-canary-DO-NOT-USE-REAL-KEY not secrets.* — fresh fork has no secrets; storing as secret silently breaks every contributor's first push (Pitfall 8)
- Scenario 4 hard-fails on empty GITHUB_STEP_SUMMARY — runDryRun writes summary unconditionally; empty file is a helper regression indicator, not a benign environment quirk
- Phase 01.2 P01: ./node_modules/.bin/tsx (path-resolved) replaces npx tsx at action.yml Steps 5 + 6 — empirical local gate exit_code=0; live ubuntu-latest verification pending push
- Regression-test job self-test-hyphenated-input-env added to phase1-self-test.yml as isolated Scenario 6 — does not invoke 'uses: ./' to avoid Zod superRefine noise; failure points directly at the spawn line
- SC#2 option (a) design bug discovered: echo ::add-mask::CANARY in run: block leaks literal in runner command-echo before masking takes effect; verify-log-mask Job B fails; user decision required on fix approach
- SC#1 fixed: composite-action output bridge (core.setOutput dryRunSummary + action.yml outputs.dry-run-summary) works end-to-end; Scenarios 4+5 green on ubuntu-latest
- SC#2 recovered via Option C: filter ::add-mask:: lines from verify-log-mask grep; preserves Phase 01-06 TWO-JOB pattern; live CI run 25022284855 all 7 jobs green
- Phase 01.3 complete: TEST-01 satisfied; phase1-self-test.yml end-to-end green on fresh ubuntu-latest with no repo secrets (SC#3 invariant established)
- Phase 03.1 demo landing: subpath-checkout fallback (CONTEXT D-04 option B) was the working cross-repo private action access mechanism; the GitHub Settings UI access_level toggle did not propagate to runtime resolver despite user confirmation (account-level setting may differ from API endpoint exposure)
- Phase 03.1 demo: gemini-2.5-flash chosen for free-tier compatibility (CLAUDE.md default gemini-2.5-pro is NOT free-tier eligible — limit:0); flash produced higher-quality fix than literal #correct-id (used getByRole accessible-name selector)
- Phase 03.1 demo: total Gemini API cost $0.0382 USD for one successful flash call; first end-to-end heal demonstration of the project's core value proposition
- Phase 03.1 fix-applier scope-leak: prior `git apply --3way + git add -A` swept untracked files (.healer/, package-lock.json) into commit; replaced with atomic `git apply --3way --index` so only patched files are staged
- Phase 03.1 fix-applier push: original `git push -u origin <branch>` rejected on re-dispatch (deterministic branch name reuse); --force-with-lease rejected with stale-info on shallow clones; final answer is plain --force given the playwright-healer/* namespace is bot-exclusive
- Phase 03.1 Rule 3 auto-fix: src/index.ts was missing `core.getInput()` calls for the three skip-* flags (Plan 01 added schema fields, Plan 02 added action.yml inputs + env vars, but src/index.ts wire-through was missed); fixed in commit 10c8949
- FIX-07 cascade order: adapter.ts FIRST, parseFinalText adapters follow — TypeScript enforces this at compile time
- classifyFixClass uses static module-scope regex literals only — input never reaches RegExp constructor (T-04-04 mitigation)
- CFG-04 disable emits core.warning (not silent skip) — surfaces operator-actionable signal in step summary
- Phase 04 Plan 04: IssueOpts widened to include testFile + stateWorktreePath — enables full testFile::testTitle cap key for issue-opened heal events, matching pr-opened path (no cap undercount)
- Phase 04 Plan 04: appendHealEvent NOT abstracted from appendRecord — deliberate duplication for independent auditability per Pitfall 7 guidance
- Phase 04 Plan 04: countHealsForTest uses synchronous fs I/O — walks ≤ flakeWindowDays files (<1KB each); async complexity not justified
- Phase 04 Plan 04: Guard 3 bootstrap failure non-fatal — blocking all heals on state-branch error worse than single cap-bypass
- Phase 04 Plan 04: security-lint Check 5 excludes itself via --exclude=security-lint.yml to avoid self-referential false positive from grep command string
- Worktree leak fix: Step 1.5 merged into outer try-block so outer finally always runs removeWorktree on all exit paths including cap-hit return
- concurrencyKey default sentinel in e2e-heal-self.yml: required:true with constant default 'manual-broken-selector-default' — satisfies DET-07 schema while keeping manual hand-dispatch workable
- cancel-in-progress: false in concurrency block — queue not cancel (CONTEXT D-03: preserve both runs' detection evidence if they raced)
- skip_post_fix_validation commented out not deleted — one-line revert path for demo rollback; Phase 04 re-engages validation gate

### Pending Todos

None yet.

### Blockers/Concerns

- **Phase 1 gate:** Native SDK binary discovery (`npm ci --production` installing `@anthropic-ai/claude-agent-sdk-linux-x64` on ubuntu-latest) is unverified — must smoke-test before agent code is written
- **Phase 3 gate:** Agent system prompt structure for four-stage CI remediation loop has no established template — budget iteration time
- **Phase 03 SC-1/SC-3 env-var blocker — RESOLVED 2026-04-27:** Live ubuntu-latest run confirmed `./node_modules/.bin/tsx` preserves hyphenated INPUT_*. Scenario 6 green; Scenario 1 Job A green; Scenario 4 dispatcher writes summary correctly (visible in UI). 03-HUMAN-UAT.md G-01 marked resolved.
- **Phase 01.3 RESOLVED 2026-04-27:** All three pre-existing test-design bugs fixed. SC#1 (composite-action output bridge for Scenarios 4+5), SC#2 (Option C filter on verify-log-mask grep — preserves TWO-JOB pattern), SC#3 (regression job + scenarios 2/3/6), SC#4 (single production-code line) all GREEN on run 25022284855. TEST-01 marked Complete in REQUIREMENTS.md.

### Roadmap Evolution

- Phase 01.2 inserted after Phase 01: Fix npx tsx env-var stripping in composite action runtime (URGENT) — discovered during SC-1 live verification on 2026-04-27. action.yml Step 6 invokes the agent via `npx tsx src/index.ts`; the npx → tsx → node spawn chain drops env vars whose names contain hyphens (every `INPUT_*` for kebab-cased inputs), so `core.getInput('healer-token')` throws on every real CI invocation. Pre-existing — `phase1-self-test.yml` has been failing with this symptom since 2026-04-25; unit tests miss it because they mock `@actions/core` directly.

## Deferred Items

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| v2 | Trace-aware analysis (TRC-01/02/03) | Deferred | Initialization |
| v2 | Batch healing (PAT-01/02/03) | Deferred | Initialization |
| v2 | Cross-run pattern detection | Deferred | Initialization |
| v2 | Cost dashboard / webhook notifications (OBS-01/02) | Deferred | Initialization |
| v2 | Non-GitHub CI support (EXT-01) | Deferred | Initialization |

## Session Continuity

Last session: 2026-05-02T00:00:49.653Z
Stopped at: Completed 04-05-PLAN.md automated tasks (Tasks 1-2); checkpoint:human-verify Task 3 pending maintainer UAT
Resume file: None

**Planned Phase:** 04 (auto-dispatch-full-fix-classes-deduplication) — 5 plans — 2026-05-01T18:12:08.757Z
