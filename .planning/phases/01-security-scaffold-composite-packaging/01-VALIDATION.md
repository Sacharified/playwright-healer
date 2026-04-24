---
phase: 1
slug: security-scaffold-composite-packaging
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source of truth for acceptance signals: `01-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | GitHub Actions (CI workflows) + `tsc --noEmit` (type-check) |
| **Config file** | `.github/workflows/security-lint.yml`, `.github/workflows/phase1-self-test.yml`, `tsconfig.json` |
| **Quick run command** | `npx tsc --noEmit && bash scripts/security-lint.sh` (local mirror of CI) |
| **Full suite command** | `act push -W .github/workflows/security-lint.yml && act push -W .github/workflows/phase1-self-test.yml` (requires `act`; CI push is authoritative) |
| **Estimated runtime** | ~30s local quick / ~3min CI full |

Note: There is no unit-test framework in Phase 1 (no runtime logic beyond the dispatcher). Validation is CI-workflow-first — Jest/Vitest lands in Phase 2 when ingest logic ships. The dispatcher's fail-fast behavior is exercised by `phase1-self-test.yml` running the action in three scenarios (canary mask, invalid mode, missing key).

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit` (fast — ~5s) to catch type regressions in `src/shared/*.ts` and `src/index.ts`
- **After every plan wave:** Push to a feature branch and let `security-lint.yml` + `phase1-self-test.yml` run
- **Before `/gsd-verify-work`:** Both CI workflows must be green on the commit being verified
- **Max feedback latency:** ~3min (CI) / ~30s (local quick)

---

## Per-Task Verification Map

> Task IDs are assigned by the planner. This table is a shape preview — the planner fills rows as tasks crystallize. Every row must map to a concrete acceptance signal from RESEARCH.md §"Validation Architecture".

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 1 | PKG-01 | — | `runs.using: composite` + `npm ci --production` is step 1 | static | `yq -e '.runs.using == "composite"' action.yml && yq -e '.runs.steps[0].run | test("npm ci --production")' action.yml` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | PKG-02 | — | `package.json` uses npm + `package-lock.json` committed | static | `test -f package-lock.json && jq -e '.packageManager == null or (.packageManager \| startswith("npm"))' package.json` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | PKG-01 | — | No `dist/` bundle entrypoint | static | `! test -f dist/index.js` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | CFG-01 | — | 8 inputs declared in `action.yml` (mode, anthropic-api-key, healer-token, github-token, setup-command, start-command, test-command, base-url) | static | `for k in mode anthropic-api-key healer-token github-token setup-command start-command test-command base-url; do yq -e ".inputs.\"$k\"" action.yml >/dev/null; done` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | CFG-02, CFG-05 | T-1-07 | Zod schema enforces `mode ∈ {ingest, heal, dry-run}` + non-empty secrets; fails with field-name error | integration | `phase1-self-test.yml` job "invalid-mode" asserts exit 1 + error mentions `mode`; job "missing-api-key" asserts exit 1 + error mentions `anthropic-api-key` | ❌ W0 | ⬜ pending |
| 1-02-03 | 02 | 1 | CFG-05 | — | Dispatcher `src/index.ts` follows D-07 startup order (getInput → setSecret × 3 → Zod → switch) | static | `grep -n "core.setSecret" src/index.ts` must return 3 matches **before** the first `.parse(` match (line-order check in a helper script) | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 1 | SEC-06 | T-1-06 | `core.setSecret` masks all 3 secrets at startup | integration | `phase1-self-test.yml` two-job pattern: Job A runs action with `anthropic-api-key=test-canary-DO-NOT-USE-REAL-KEY`; Job B (needs A) fetches Job A log via `gh api` and greps — raw canary must NOT appear | ❌ W0 | ⬜ pending |
| 1-04-01 | 04 | 1 | — (foundation) | T-1-03 | `src/shared/security-contract.ts` exports `Object.freeze`'d `ALLOWED_TOOLS`, `ALLOWED_ORIGIN_TEMPLATE`, `FORBIDDEN_WORKFLOW_TRIGGERS` per D-11 | static | `grep -E "^export const (ALLOWED_TOOLS\|ALLOWED_ORIGIN_TEMPLATE\|FORBIDDEN_WORKFLOW_TRIGGERS)" src/shared/security-contract.ts` returns 3 lines; each is wrapped in `Object.freeze(` | ❌ W0 | ⬜ pending |
| 1-04-02 | 04 | 1 | — (foundation) | T-1-03 | `.planning/security-contract.snapshot.json` mirrors the TS values | static | Canonical compare: `node -e "import('./src/shared/security-contract.ts')"` vs JSON parse — values must match modulo key order | ❌ W0 | ⬜ pending |
| 1-05-01 | 05 | 2 | SEC-01 | T-1-01 | CI `security-lint.yml` parses every `actions/checkout` in workflows + `action.yml` and fails if any lacks `persist-credentials: false` | CI | workflow contains `yq`-based step that greps `uses: actions/checkout` and validates sibling `with.persist-credentials == false` | ❌ W0 | ⬜ pending |
| 1-05-02 | 05 | 2 | SEC-02 | T-1-02 | CI grep for `pull_request_target` returns zero matches outside `.planning/`, `CLAUDE.md`, `README.md` | CI | `git grep -l 'pull_request_target' -- ':(exclude).planning' ':(exclude)CLAUDE.md' ':(exclude)README.md'` returns empty | ❌ W0 | ⬜ pending |
| 1-05-03 | 05 | 2 | — (D-13) | T-1-05 | CI snapshot-diff check fails when `security-contract.ts` OR `security-contract.snapshot.json` changed without `Security-Contract-Change: reviewed-by=...` trailer in the commit | CI | Two-arm check: (A) on push, `git log -1 --format='%B'` parses trailer; (B) on PR, iterate `git log origin/main..HEAD --format='%B'` across commits touching the contract files | ❌ W0 | ⬜ pending |
| 1-05-04 | 05 | 2 | SEC-07 | T-1-04 | CI grep for outbound-HTTP clients (`fetch(`, `http.request(`, `https.request(`, `axios`, `got(`, `node-fetch`) in `src/**/*.ts` returns zero matches (Phase 1 has none) | CI | `! git grep -nE '(^|[^a-zA-Z_])(fetch\|axios\|got\|node-fetch)\\(\|https?\\.request\\(' -- 'src/**/*.ts'` | ❌ W0 | ⬜ pending |
| 1-06-01 | 06 | 2 | CFG-05 | — | `mode: dry-run` completes with exit 0 and writes redacted config dump to `$GITHUB_STEP_SUMMARY` with no secret values | integration | `phase1-self-test.yml` job "dry-run" asserts exit 0 AND downloads `$GITHUB_STEP_SUMMARY` artifact, grep confirms no canary and no `sk-` literals | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky · W0 = created in Wave 0*

---

## Wave 0 Requirements

Phase 1 has no pre-existing test infrastructure; Wave 0 creates the foundation:

- [ ] `.github/workflows/security-lint.yml` — stubs for SEC-01, SEC-02, SEC-07 + D-13 contract snapshot diff
- [ ] `.github/workflows/phase1-self-test.yml` — stubs for CFG-02/CFG-05 (invalid-mode + missing-key), SEC-06 (canary mask, two-job pattern), CFG-05 (dry-run success)
- [ ] `tsconfig.json` — enables `tsc --noEmit` as type-check CLI
- [ ] `src/shared/config.ts` — Zod schema stubs that the dispatcher imports
- [ ] `src/shared/security-contract.ts` + `.planning/security-contract.snapshot.json` — foundation constants for D-11/D-12

No test framework (Jest/Vitest) yet — Phase 2 introduces runtime logic that needs unit tests.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| None | — | — | — |

*All Phase 1 success criteria have automated verification. The CI workflows are the test suite.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (security-lint.yml, phase1-self-test.yml, security-contract.ts, config.ts, tsconfig.json)
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s (CI)
- [ ] `nyquist_compliant: true` set in frontmatter (after planner finalizes task IDs)

**Approval:** pending
