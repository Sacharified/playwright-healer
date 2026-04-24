# Phase 1: Security Scaffold + Composite Packaging - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 01-security-scaffold-composite-packaging
**Areas discussed:** Mode routing mechanism, Scaffold depth, Design contract surface, Self-test + CI lint scope

---

## Mode routing mechanism

### Q: How should the `mode` input dispatch to ingest vs heal vs dry-run logic?

| Option | Description | Selected |
|--------|-------------|----------|
| TS dispatcher (Recommended) | One composite step runs `node src/index.ts` which reads INPUT_MODE, validates via Zod, switches. Testable in Vitest, single entrypoint, mode validation lives in TS. | ✓ |
| Composite `if:` conditionals | action.yml has N steps each gated by `if: inputs.mode == 'ingest'`. Mode branches visible in YAML but mode validation must happen in pre-step; harder to unit-test. | |
| Hybrid (pre-step validator + if:) | TS pre-step validates mode; downstream composite steps use `if:` conditionals. Validation centralized; routing in YAML. | |

**User's choice:** TS dispatcher
**Notes:** Removes duplication — the fail-fast validation and the routing share one TypeScript code path.

### Q: What does `mode: dry-run` actually DO in Phase 1 (no ingest/heal logic exists yet)?

| Option | Description | Selected |
|--------|-------------|----------|
| Config dump + exit 0 (Recommended) | Validate all inputs + config, print merged config (secrets redacted) to step summary, exit 0. Becomes the permanent dry-run contract. | ✓ |
| Log 'not implemented' + exit 0 | Accept the mode so SC#4 passes; log a stub message; exit 0. Semantics deferred. | |
| Log 'not implemented' + exit 1 | Treat dry-run as unsupported and fail. Contradicts SC#4 which requires all three modes to be accepted. | |

**User's choice:** Config dump + exit 0
**Notes:** Gives consumers a way to verify their config without running anything — useful at adoption time. Sets a contract for dry-run that future phases can extend (add more inspection output) but never weaken.

---

## Scaffold depth

### Q: How much of the repo structure does Phase 1 materialize?

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal + shared only (Recommended) | action.yml, package.json, tsconfig.json, src/index.ts (dispatcher), src/shared/config.ts (Zod), src/shared/security-contract.ts. No ingest/ or healer/. | |
| Full directory stubs | Matches ARCHITECTURE.md: src/ingest/, src/healer/, src/shared/ with empty index.ts stubs. Structure visible early; empty files invite drift. | ✓ |

**User's choice:** Full directory stubs
**Notes:** User accepted the trade-off — prefers the whole skeleton visible from day one even though stubs are dead code until their phases. Stubs will throw `Not implemented until Phase N` at runtime so dispatcher misrouting fails loud.

### Q: How does the composite action run TypeScript on the runner?

| Option | Description | Selected |
|--------|-------------|----------|
| tsx at runtime (Recommended) | `npx tsx src/index.ts`. No build step. Matches Anthropic pattern. ~100ms startup cost. | ✓ |
| tsc build on publish (committed dist/) | `tsc` → dist/; action runs `node dist/index.js`. Faster cold start but dist/ drift risk (flagged in PITFALLS.md). | |
| Node with --experimental-strip-types | Node 24 native TS stripping. Still experimental-flagged in Node 24; narrower adoption. | |

**User's choice:** tsx at runtime
**Notes:** Eliminates dist/ drift — one of the tech-debt patterns called out in PITFALLS.md. TS source becomes the shipped artifact.

---

## Design contract surface

### Q: Where does the locked security contract (allowedTools list, allowed-origins template, forbidden triggers) physically live?

| Option | Description | Selected |
|--------|-------------|----------|
| TS constants + JSON snapshot (Recommended) | Canonical: src/shared/security-contract.ts exports frozen constants. Snapshot test writes to .planning/security-contract.snapshot.json; CI diffs on every push. Phase 3+ imports from TS. | ✓ |
| SECURITY.md locked section | Contract lives as prose + fenced blocks in SECURITY.md. Human-readable; no compile-time link; drift possible. | |
| TS constants only (no snapshot) | Just src/shared/security-contract.ts. Phase 3 imports it. Simpler; relies on code review. | |

**User's choice:** TS constants + JSON snapshot
**Notes:** Provides both compile-time enforcement (TS import) and change-detection gate (CI snapshot diff). Worth the small additional wiring.

### Q: What stops Phase 3 (or any later phase) from silently expanding the allowlist?

| Option | Description | Selected |
|--------|-------------|----------|
| Diff-lint CI check (Recommended) | CI greps diffs touching security-contract.ts; requires commit trailer `Security-Contract-Change: reviewed-by=<name>`. Missing trailer fails check. | ✓ |
| Snapshot test failure | Vitest snapshot fails until explicitly regenerated via `vitest -u`. Forces intentionality. | |
| Import-only from constants (no inline literals) | Phase 3 agent wiring MUST import from security-contract.ts; inline string literals banned via eslint rule. | |

**User's choice:** Diff-lint CI check
**Notes:** Question was offered as multi-select but user selected one. Diff-lint is the primary gate; snapshot JSON in D-12 already acts as a second implicit gate (any TS edit that doesn't also update the snapshot fails the compare step). The inline-literal ban is captured in D-13 as an implementation detail of the diff-lint (grep for literals outside security-contract.ts) rather than a separate ESLint rule — simpler.

---

## Self-test + CI lint scope

### Q: How much self-test infra lands in Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Security lint only (Recommended) | security-lint.yml: grep for pull_request_target, verify persist-credentials:false, snapshot compare. Manual verification of masking + mode fail-fast via `act`. | |
| Security lint + minimal action self-test | Security lint PLUS phase1-self-test.yml runs action with dry-run + fake canary key; asserts canary not in log + invalid mode exits 1. Closes SC#3 + SC#4 automated verification gap now. | ✓ |
| Defer all to Phase 6 | No .github/workflows/ in Phase 1. Manual verification. Risk: architectural phase gated on manual checks. | |

**User's choice:** Security lint + minimal action self-test
**Notes:** User explicitly accepted scope bleed into Phase 6's territory (PKG-04 is the full fixture-repo self-test; Phase 1 gets action-surface-only self-test). The trade-off favors automated regression guarding of the architecturally-binding controls.

### Q: How do we verify SC#3 (invalid API key masked in log) before Phase 1 is marked done?

| Option | Description | Selected |
|--------|-------------|----------|
| Automated in self-test workflow (Recommended) | Workflow runs action with canary key `test-canary-DO-NOT-USE-REAL-KEY`; post-step greps log via `gh api`; fails if raw canary appears. | ✓ |
| Manual before merge | Maintainer runs action locally with canary; visually confirms; documents in VERIFICATION.md. One-shot; no regression guard. | |

**User's choice:** Automated in self-test workflow
**Notes:** Turns a one-time verification into a permanent regression gate — any future refactor that accidentally removes `core.setSecret` fails CI.

---

## Claude's Discretion

Areas where user deferred to Claude's judgement during planning:
- Exact dependency pin strategy (exact versions for direct deps, caret ranges for utilities where peer ranges demand flexibility)
- Exact Zod schema structure (as long as error messages name fields)
- Shape of the redacted dry-run config dump (table vs list; must not include secrets)
- Internal file paths inside src/shared/ beyond the two named files
- Implementation details of the two CI workflows (as long as the listed checks are exercised)

## Deferred Ideas

- Dependency pinning strategy — noted as possible follow-up gray area; user chose not to explore
- healer-token scope preflight — deferred to Phase 2/3 when token is first used
- Full fixture-repo self-test (PKG-04) — mapped to Phase 6
- MCP `--allowed-origins` runtime wiring (SEC-03) — mapped to Phase 3
- `allowedTools` runtime wiring (SEC-04) — mapped to Phase 3
- `[skip-healer]` commit-message loop-guard (SEC-05, PRI-06) — mapped to Phase 2/3
- ESLint rule for inline-literal ban — downgraded to grep-based diff-lint for Phase 1; can revisit if grep proves brittle
