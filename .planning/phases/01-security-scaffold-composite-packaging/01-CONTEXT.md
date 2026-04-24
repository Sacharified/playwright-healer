# Phase 1: Security Scaffold + Composite Packaging - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

Lock the four architecturally-binding security controls and the composite-action packaging skeleton before any agent code exists.

**What Phase 1 delivers:**
- A composite `action.yml` with `runs.using: composite` and `npm ci --production` as its first step (PKG-01, PKG-02)
- A single `mode` input accepting `ingest` | `heal` | `dry-run` with Zod fail-fast validation (CFG-01, CFG-02, CFG-05)
- `persist-credentials: false` enforced on every `actions/checkout` step in this repo (SEC-01)
- Zero `pull_request_target` triggers anywhere in this repo (SEC-02)
- `core.setSecret` masking at startup for `anthropic-api-key`, `healer-token`, `github-token` (SEC-06)
- No telemetry / phone-home paths (SEC-07)
- The locked security design contract — `allowedTools`, `--allowed-origins` template, forbidden triggers — committed as immutable constants that Phase 3 cannot silently weaken
- CI gates that mechanically enforce the four controls going forward

**What Phase 1 does NOT deliver:**
- Any ingest logic (Phase 2)
- Any healer / agent wiring (Phase 3) — the `ALLOWED_TOOLS` constant is defined now but imported/used in Phase 3
- MCP `--allowed-origins` runtime wiring (Phase 3)
- The consumer's `.github/workflows/playwright-healer.yml` example file (Phase 6)
- Release tagging or full fixture-repo self-test (Phase 6 / PKG-03, PKG-04)

</domain>

<decisions>
## Implementation Decisions

### Packaging & Runtime

- **D-01:** Composite GitHub Action. `action.yml` uses `runs.using: composite`. First step is `npm ci --production` in `${{ github.action_path }}`. No `ncc`/`esbuild`/`dist/` bundle — pre-locked by research; confirms Anthropic's `claude-code-action` pattern.
- **D-02:** TypeScript runs at runtime via **`tsx`**, not `tsc` → `dist/`. Action entry point is effectively `npx tsx src/index.ts`. Rationale: removes `dist/` drift risk (listed in PITFALLS.md as tech-debt pattern); no separate compile step in CI; TS source is the shipped artifact.
- **D-03:** `npm` as package manager (locked by PKG-02 + PROJECT.md constraint). Not Bun, not pnpm.

### Mode Routing & Validation

- **D-04:** **Single TS dispatcher** in `src/index.ts`. Reads `INPUT_MODE` env, validates via Zod, switches to ingest/heal/dry-run. Pre-step for mode validation is the same step — no `if:` conditionals in `action.yml` gate per-mode logic.
- **D-05:** `mode: dry-run` in Phase 1 = **validate all inputs + merged config, print redacted config dump to `$GITHUB_STEP_SUMMARY`, exit 0**. Becomes the permanent `dry-run` contract — future phases add inspection output but never change the exit-0 + no-side-effects guarantee.
- **D-06:** Invalid `mode` values exit 1 with a Zod error message naming the field (`mode` must be one of `ingest`, `heal`, `dry-run`; got `banana`). Covers SC#4.
- **D-07:** Mode validation runs **before** any other work (including secret reads). Fail-fast on invalid config; never touch secrets for an invalid run.

### Repository Scaffold

- **D-08:** **Full directory stubs** from the ARCHITECTURE.md layout materialize in Phase 1:
  ```
  playwright-healer/
  ├── action.yml
  ├── package.json
  ├── package-lock.json
  ├── tsconfig.json
  └── src/
      ├── index.ts                      # mode dispatcher
      ├── ingest/
      │   └── index.ts                  # stub — throw `Not implemented (Phase 2)`
      ├── healer/
      │   └── index.ts                  # stub — throw `Not implemented (Phase 3)`
      └── shared/
          ├── config.ts                 # Zod schemas for inputs + mode
          └── security-contract.ts      # locked security constants
  ```
- **D-09:** Stubs throw `Error('Not implemented until Phase N')` so a runtime invocation fails loud if the dispatcher routes wrong. Dispatcher only calls stubs for `mode: ingest` / `mode: heal`; `mode: dry-run` is self-contained and works end-to-end in Phase 1.
- **D-10:** `tsconfig.json`: `strict: true`, `target: ES2022`, `moduleResolution: bundler` (matches STACK.md recommendation), `noEmit: true` (tsx executes source; tsc used only for type-check in CI).

### Security Design Contract

- **D-11:** Canonical source is **`src/shared/security-contract.ts`** — a TypeScript module exporting `Object.freeze`'d constants:
  ```ts
  export const ALLOWED_TOOLS = Object.freeze([
    'mcp__playwright__*',
    'Read',
    'Grep',
    'Glob',
  ] as const);

  export const ALLOWED_ORIGIN_TEMPLATE = (baseUrl: string) =>
    [baseUrl, 'http://localhost:*'] as const;

  export const FORBIDDEN_WORKFLOW_TRIGGERS = Object.freeze([
    'pull_request_target',
  ] as const);
  ```
- **D-12:** A **JSON snapshot** `.planning/security-contract.snapshot.json` mirrors the constants. Written once in Phase 1 (committed). CI diffs the snapshot against the TS values on every push; mismatch fails the check.
- **D-13:** Enforcement of intentional change is a **diff-lint CI check**: any commit that modifies `src/shared/security-contract.ts` OR `.planning/security-contract.snapshot.json` must include a trailer `Security-Contract-Change: reviewed-by=<github-handle>` in the commit message. Absent trailer = CI failure. Phase 3+ code must **import** from `security-contract.ts` — inline string literals for `allowedTools` or origins are banned (enforced by the diff-lint's grep for literal patterns in `src/**` outside `security-contract.ts`).

### CI & Self-Test Infrastructure

- **D-14:** Phase 1 ships **`.github/workflows/security-lint.yml`** on push/pull_request:
  1. Grep this repo for the literal string `pull_request_target` — fail if any match exists outside `.planning/`, `CLAUDE.md`, `README.md` (these can legitimately reference the string in prose).
  2. Parse every `.github/workflows/*.yml` + `action.yml` — fail if any `actions/checkout` step lacks `persist-credentials: false`.
  3. Compare `.planning/security-contract.snapshot.json` against values imported from `src/shared/security-contract.ts`; fail on mismatch unless the latest commit has the `Security-Contract-Change:` trailer.
- **D-15:** Phase 1 also ships **`.github/workflows/phase1-self-test.yml`** — minimal action invocation self-test:
  1. Runs the action with `mode: dry-run` and `anthropic-api-key: ${{ secrets.CANARY_KEY }}` (a canary value set to `test-canary-DO-NOT-USE-REAL-KEY` via repo secret).
  2. Downloads the job log via `gh api` in a post step and greps for the canary — fails if the raw string appears (proves `core.setSecret` masked it).
  3. Runs the action with `mode: banana` — asserts exit code 1 and the Zod error message contains `mode`.
  4. Runs the action with no api-key input — asserts exit code 1 and error mentions the missing required input.
- **D-16:** Full fixture-repo self-test (PKG-04) remains in Phase 6 — Phase 1's self-test is action-surface only, not a full ingest/heal round-trip.

### Inputs & Secrets (action.yml)

- **D-17:** Required inputs defined in Phase 1 (SC-visible in Phase 1 verification): `mode` (string, required, validated to `ingest|heal|dry-run`). User-command inputs (`setup-command`, `start-command`, `test-command`, `base-url`) are **declared** in action.yml per CFG-01 but are not yet consumed (ingest/heal stubs don't read them).
- **D-18:** Secret inputs declared in action.yml: `anthropic-api-key` (required), `healer-token` (required), `github-token` (defaults to `${{ github.token }}`). All three fed into `core.setSecret()` as the **first action** inside `src/index.ts` — before any other log line, before Zod validation that might echo input names.
- **D-19:** `healer-token` presence is validated (not empty string) but **not validated for scope** in Phase 1 — scope checks are lazy, happening when the token is first used (Phase 2 for dispatch, Phase 3 for PR creation). Phase 1 only requires the input exists.
- **D-20:** Node version pin — action.yml sets up Node 24 via `actions/setup-node@<pinned-sha>`. Pin to commit SHA, not `@v4` (PITFALLS.md `@v1` floating-tag warning; also SEC hygiene).

### Claude's Discretion

Areas where Claude can decide during planning/execution without further user input:
- Exact package.json dependency pin strategy (exact versions expected; Zod 3.x range per SDK peer requirement per STACK.md)
- Exact Zod schema structure for the input schema (as long as error messages name fields)
- Exact shape of the redacted config-dump in `dry-run` mode summary (table vs list, but must not include any secret values)
- Whether `tsconfig.json` uses `moduleResolution: bundler` vs `node16` (D-10 recommends bundler)
- Whether the dispatcher uses a `switch` statement, if/else, or dynamic import — implementation detail
- Internal file paths inside `src/shared/` beyond `config.ts` and `security-contract.ts` (e.g., splitting Zod schemas across multiple files)
- CI workflow implementation details in `security-lint.yml` and `phase1-self-test.yml` — as long as the checks listed in D-14 / D-15 are exercised

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level (locked)
- `CLAUDE.md` — Project-wide key architectural facts and security non-negotiables. Section "Key architectural facts" is binding.
- `.planning/PROJECT.md` — Core value, Key Decisions table (especially rows on composite packaging, PAT requirement, Phase 0/1 security scaffolding).
- `.planning/REQUIREMENTS.md` — Phase 1 covers: PKG-01, PKG-02, CFG-01, CFG-02, CFG-05, SEC-01, SEC-02, SEC-06, SEC-07. Read all 9 in full before planning.
- `.planning/ROADMAP.md` §"Phase 1: Security Scaffold + Composite Packaging" — 4 success criteria are the verification gates.

### Research (informs implementation)
- `.planning/research/SUMMARY.md` — Executive summary of all research.
- `.planning/research/STACK.md` §"Critical Architecture Decision" and §"Recommended Stack" — composite action rationale, tsx/Node 24, dependency versions.
- `.planning/research/PITFALLS.md` §Pitfall 3 (`pull_request_target`), §Pitfall 5 (`persist-credentials` leak), §Pitfall 10 (supply chain via CI config) — the three non-negotiables this phase closes. Also §"Security Mistakes" table.
- `.planning/research/ARCHITECTURE.md` §"System Overview" and §"Recommended Project Structure" — the full directory layout D-08 materializes.

### Out-of-band references (none yet)
- No external ADRs / SPECs exist for this project. No user-referenced docs surfaced during discussion.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

**None.** This is a greenfield repo. Phase 1 establishes the scaffold; there is no prior code to reuse.

### Established Patterns

None inside this repo. External patterns to follow:
- **`anthropics/claude-code-action`** — the reference composite-action pattern from Anthropic. Uses composite action + runtime install + TS source execution. Worth reading their `action.yml` during planning to confirm step shapes.
- **Playwright MCP docs on allowed-origins** — referenced in `.planning/research/PITFALLS.md` Pitfall 4.

### Integration Points

Phase 1's outputs that Phase 2+ consume:
- `src/shared/config.ts` — Zod schemas. Phase 2 extends with ingest-specific config (thresholds, windows).
- `src/shared/security-contract.ts` — imported by Phase 3 agent wiring.
- `src/index.ts` dispatcher — Phase 2 fills `src/ingest/index.ts`; Phase 3 fills `src/healer/index.ts`. The dispatcher contract must stay stable (accept mode env, switch, exit code is authoritative).
- `action.yml` input surface — declared in Phase 1; Phase 2+ consume without renaming.

</code_context>

<specifics>
## Specific Ideas

- **Canary secret for self-test masking check:** the string `test-canary-DO-NOT-USE-REAL-KEY` is the chosen canary value. Specific enough that any false negative in the grep would be surprising.
- **Node 24 is mandatory** (not just permitted) — GitHub-mandated default from 2026-06-02 per CLAUDE.md. Do not target Node 20.
- **Commit-trailer format for security-contract changes:** `Security-Contract-Change: reviewed-by=<github-handle>`. Exact key name is locked so CI grep is trivial.

</specifics>

<deferred>
## Deferred Ideas

- **Dependency pinning strategy** (exact-version vs caret ranges) — raised as a possible follow-up gray area; left to planning. Default: exact versions for direct deps, caret for well-maintained utilities like `zod` where SDK peer-range demands flexibility.
- **healer-token scope preflight** (check PAT has `workflow_dispatch` / `pull_request: write` before first use) — deferred. Phase 1 only validates token is non-empty; scope validation is a Phase 2/3 concern when the token is actually used.
- **Full fixture-repo self-test** (PKG-04) — deferred to Phase 6 per REQUIREMENTS.md traceability.
- **MCP `--allowed-origins` runtime wiring** — SEC-03 is mapped to Phase 3 in traceability table. Phase 1 only locks the template.
- **`allowedTools` runtime wiring to agent loop** — SEC-04 is mapped to Phase 3. Phase 1 only locks the constant.
- **`[skip-healer]` commit-message loop-guard** — SEC-05 / PRI-06 mapped to Phase 2/3.
- **ESLint rule banning inline `allowedTools` literals outside security-contract.ts** — listed as one option for enforcement; downgraded in D-13 to grep-based diff-lint (simpler; no ESLint toolchain in Phase 1 scope). Can revisit in later phase if diff-lint proves brittle.

</deferred>

---

*Phase: 01-security-scaffold-composite-packaging*
*Context gathered: 2026-04-24*
