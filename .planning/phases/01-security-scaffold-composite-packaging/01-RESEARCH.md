# Phase 1: Security Scaffold + Composite Packaging - Research

**Researched:** 2026-04-24
**Domain:** Composite GitHub Action packaging + security design contract + CI lint infrastructure
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Packaging & Runtime**

- **D-01:** Composite GitHub Action. `action.yml` uses `runs.using: composite`. First step is `npm ci --production` in `${{ github.action_path }}`. No `ncc`/`esbuild`/`dist/` bundle.
- **D-02:** TypeScript runs at runtime via **`tsx`**, not `tsc` → `dist/`. Action entry point is effectively `npx tsx src/index.ts`. Rationale: removes `dist/` drift risk; TS source is the shipped artifact.
- **D-03:** `npm` as package manager. Not Bun, not pnpm.

**Mode Routing & Validation**

- **D-04:** Single TS dispatcher in `src/index.ts`. Reads `INPUT_MODE` env, validates via Zod, switches. No `if:` conditionals in `action.yml`.
- **D-05:** `mode: dry-run` = validate all inputs + merged config, print redacted config dump to `$GITHUB_STEP_SUMMARY`, exit 0. Permanent contract: exit-0 + no-side-effects.
- **D-06:** Invalid `mode` values exit 1 with Zod error naming the field. Covers SC#4.
- **D-07:** Startup ordering: `getInput(...)` → `core.setSecret(...)` on all three secrets → Zod validation → mode dispatch. Secrets registered with masker BEFORE any other log line; secrets NOT USED for any purpose until mode is validated and dispatch begins.

**Repository Scaffold**

- **D-08:** Full directory stubs from ARCHITECTURE.md layout:
  ```
  playwright-healer/
  ├── action.yml
  ├── package.json
  ├── package-lock.json
  ├── tsconfig.json
  └── src/
      ├── index.ts                      # mode dispatcher
      ├── ingest/index.ts               # stub — throw
      ├── healer/index.ts               # stub — throw
      └── shared/
          ├── config.ts                 # Zod schemas
          └── security-contract.ts      # locked security constants
  ```
- **D-09:** Stubs throw `Error('Not implemented until Phase N')`. Dispatcher only calls stubs for `mode: ingest` / `mode: heal`; `mode: dry-run` works end-to-end in Phase 1.
- **D-10:** `tsconfig.json`: `strict: true`, `target: ES2022`, `moduleResolution: bundler`, `noEmit: true`.

**Security Design Contract**

- **D-11:** Canonical source is `src/shared/security-contract.ts` — TypeScript module exporting `Object.freeze`'d constants (`ALLOWED_TOOLS`, `ALLOWED_ORIGIN_TEMPLATE`, `FORBIDDEN_WORKFLOW_TRIGGERS`).
- **D-12:** JSON snapshot `.planning/security-contract.snapshot.json` mirrors the constants. Written once in Phase 1.
- **D-13:** Commit changing `src/shared/security-contract.ts` OR `.planning/security-contract.snapshot.json` MUST include trailer `Security-Contract-Change: reviewed-by=<github-handle>`. Phase 3+ code must IMPORT from `security-contract.ts` — inline string literals banned.

**CI & Self-Test Infrastructure**

- **D-14:** `.github/workflows/security-lint.yml` on push/pull_request, four checks:
  1. Grep `pull_request_target` outside `.planning/`, `CLAUDE.md`, `README.md`
  2. Parse workflow files — fail if any `actions/checkout` step lacks `persist-credentials: false`
  3. Compare `.planning/security-contract.snapshot.json` vs TS values; fail unless commit has `Security-Contract-Change:` trailer
  4. SEC-07 phone-home check (D-16a)
- **D-15:** `.github/workflows/phase1-self-test.yml`:
  1. Run action with `mode: dry-run` and `anthropic-api-key: 'test-canary-DO-NOT-USE-REAL-KEY'` (literal inline value, not a repo secret)
  2. Download job log via `gh api`, grep for canary — fail if it appears
  3. Run with `mode: banana` — assert exit 1 and Zod error message contains `mode`
  4. Run with no api-key — assert exit 1 and missing-input error
- **D-16:** Full fixture-repo self-test deferred to Phase 6.
- **D-16a:** SEC-07 = static grep in `security-lint.yml` for `fetch(`, `http.request(`, `https.request(`, `axios`, `got(`, `node-fetch` in `src/**`. Phase 1: zero matches allowed. Phases 2/3 extend allowlist.

**Inputs & Secrets**

- **D-17:** Phase 1 required input: `mode` (`ingest|heal|dry-run`). User-command inputs (`setup-command`, `start-command`, `test-command`, `base-url`) declared in action.yml but not yet consumed.
- **D-18:** Secret inputs: `anthropic-api-key` (required), `healer-token` (required), `github-token` (defaults to `${{ github.token }}`). All three `getInput(..)`'d and fed into `core.setSecret()` as FIRST action inside `src/index.ts`.
- **D-19:** `healer-token` validated non-empty but NOT scope-validated in Phase 1.
- **D-20:** Node version pin via `actions/setup-node@<pinned-sha>`. Pin to commit SHA, not floating tag.

### Claude's Discretion

- Exact package.json dependency pin strategy (exact versions for direct deps; caret for utilities like zod)
- Exact Zod schema structure (as long as error messages name fields)
- Exact shape of redacted config-dump in dry-run summary (no secrets)
- Whether `tsconfig.json` uses `moduleResolution: bundler` vs `node16` (D-10 recommends bundler)
- Dispatcher style: switch / if-else / dynamic import
- Internal file paths inside `src/shared/` beyond `config.ts` and `security-contract.ts`
- CI workflow implementation details in `security-lint.yml` and `phase1-self-test.yml` — as long as checks listed in D-14 / D-15 are exercised

### Deferred Ideas (OUT OF SCOPE)

- Dependency pinning strategy detail (exact-version vs caret ranges)
- `healer-token` scope preflight (check PAT has workflow_dispatch/pull_request: write) — Phase 2/3
- Full fixture-repo self-test (PKG-04) — Phase 6
- MCP `--allowed-origins` runtime wiring — Phase 3 (SEC-03)
- `allowedTools` runtime wiring to agent loop — Phase 3 (SEC-04)
- `[skip-healer]` commit-message loop-guard — Phase 2/3 (SEC-05 / PRI-06)
- ESLint rule banning inline `allowedTools` literals outside security-contract.ts — downgraded to grep-based diff-lint

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PKG-01 | Composite GitHub Action (`runs.using: composite` in `action.yml`), not bundled JS | §Architecture Patterns — canonical `action.yml` shape with `runs.using: composite` |
| PKG-02 | `npm ci --production` runs as the first composite step | §Architecture Patterns — first step block; §Looks-Done-But-Isn't — `--production` deprecation note |
| CFG-01 | `action.yml` exposes inputs: `setup-command`, `start-command`, `test-command`, `base-url` | §Architecture Patterns — `action.yml` reference shape includes all four inputs (declared but unused in Phase 1) |
| CFG-02 | `action.yml` exposes secret inputs: `anthropic-api-key` (req), `healer-token` (req), `github-token` (default `${{ github.token }}`) | §Architecture Patterns — input surface table; §Startup Ordering — three `core.setSecret()` calls |
| CFG-05 | `action.yml` exposes `mode` = `ingest` \| `heal` \| `dry-run` | §Zod schema for mode — `z.enum(['ingest','heal','dry-run'])` |
| SEC-01 | Every `actions/checkout` sets `persist-credentials: false` | §CI Workflow Shapes — `yq`-based workflow parser; §Pitfall 5 reinforcement |
| SEC-02 | Neither ingest nor heal workflows define `pull_request_target` | §CI Workflow Shapes — `grep` with path exclusions; §Pitfall 3 reinforcement |
| SEC-06 | `core.setSecret` called on `anthropic-api-key`, `healer-token`, `github-token` at startup | §Startup Ordering (D-07); §Validation — SC#3 two-job self-test |
| SEC-07 | No phone-home HTTP calls; only `api.anthropic.com` and `api.github.com` allowed | §CI Workflow Shapes — HTTP-client grep in `security-lint.yml` (D-16a); Phase 1: zero matches |

</phase_requirements>

## Summary

Phase 1 is a **zero-runtime-behavior greenfield scaffold** that locks four architectural security controls and the composite-action packaging decision before any agent code is written. The phase has 20 pre-locked decisions (D-01 through D-20) in CONTEXT.md; research exists to turn those into *implementation-ready* file shapes and CI workflow patterns the planner can translate directly into tasks.

The deliverables are almost entirely static files (`action.yml`, `package.json`, `tsconfig.json`, two `src/shared/*.ts` modules, two stub files, one JSON snapshot, two workflow files). The only executable Phase 1 code is `src/index.ts` — a dispatcher that in practice only ever runs the `dry-run` branch (the ingest/heal branches are stubs that throw). Everything else is enforcement infrastructure: CI lint jobs that mechanically verify the four binding controls cannot be silently weakened in later phases.

**Primary recommendation:** Treat the `action.yml` + `package.json` + `security-lint.yml` + `phase1-self-test.yml` as the four canonical artifacts. Every other file in Phase 1 is derivable from them. Install `@anthropic-ai/claude-agent-sdk` and `@playwright/mcp` in `package.json` *during Phase 1* (even though no Phase 1 code imports them) so the self-test discharges the STATE.md blocker "Native SDK binary discovery unverified" for free. This is Claude's discretion per CONTEXT.md's deferred items list.

## Architectural Responsibility Map

Phase 1 is a single-tier packaging artifact — a GitHub Action runs inside GitHub's CI tier. There is no frontend/backend split. The "tiers" below are the GitHub Actions execution contexts.

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Input parsing + secret masking | GitHub Actions runner (Node via tsx) | — | `@actions/core` runs in the action's own Node process; secrets are registered with the runner's mask filter |
| Mode validation (Zod) | GitHub Actions runner (Node via tsx) | — | Same process as input parsing; fail-fast before any side effect |
| Security contract (ALLOWED_TOOLS etc.) | Source-code static constant | — | Not executed in Phase 1 — imported by Phase 3; frozen at build time |
| CI lint enforcement | GitHub Actions (separate workflow) | — | `security-lint.yml` runs on every push/PR; doesn't touch runtime code path |
| Self-test masking verification | Two GitHub Actions jobs (job A → job B) | — | Job A invokes the action; Job B fetches Job A's log post-hoc; log is not finalized until Job A exits |
| Snapshot canonicalization | Source-code static JSON | — | Diffed by CI; no runtime consumer in Phase 1 |

**Why this matters:** Phase 1 has no "application tier" yet. Every control is either a static constant, a CI gate, or a fail-fast check in a dispatcher that immediately exits. The planner should not invent runtime orchestration beyond what D-07 specifies.

## Standard Stack

### Core Runtime Dependencies (Phase 1)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@actions/core` | 3.0.1 | `getInput`, `setSecret`, `setFailed`, `summary.addRaw`, annotations | Official GitHub Actions toolkit. Mandatory for `core.setSecret()` per D-07/D-18. [VERIFIED: `npm view @actions/core version` 2026-04-24] |
| `zod` | ^4.0.0 | Input validation with field-naming errors (SC#4) | `@anthropic-ai/claude-agent-sdk` peer-requires `zod: ^4.0.0`. Current published: 4.3.6. [VERIFIED: `npm view @anthropic-ai/claude-agent-sdk peerDependencies` 2026-04-24 returned `{ zod: '^4.0.0' }` — this supersedes STACK.md's stated "^3.25.0 \|\| ^4.0.0" which is stale.] |
| `tsx` | ^4.21.0 | TypeScript execution at runtime (no tsc → dist/) | D-02 mandates `tsx` for runtime TS execution. tsx is esbuild-based, node-native ESM+CJS aware. [VERIFIED: `npm view tsx version` = 4.21.0 on 2026-04-24] |

### Optional but Recommended Runtime Deps (Phase 1, forward-looking)

Install these in Phase 1 `package.json` even though no Phase 1 code imports them. Rationale: the self-test workflow will exercise `npm ci --production` — running that install proves the native-binary SDK installs cleanly on `ubuntu-latest`, discharging the STATE.md blocker "Native SDK binary discovery unverified" for Phase 3 at zero extra cost.

| Library | Version | Purpose | Phase 1 Role |
|---------|---------|---------|--------------|
| `@anthropic-ai/claude-agent-sdk` | 0.2.119 | Agent SDK (used Phase 3) | Listed as dep so `npm ci --production` installs `@anthropic-ai/claude-agent-sdk-linux-x64` native binary — discharges blocker for free. [VERIFIED: npm 2026-04-24] |
| `@playwright/mcp` | 0.0.70 | Playwright MCP server (used Phase 3) | Same — proves npm can resolve the package in the composite step |
| `@actions/github` | 9.1.1 | Pre-auth Octokit (used Phase 2+) | Same rationale |

If the planner disagrees, the conservative alternative is to defer these to Phase 2/3. The trade-off is: Phase 1 self-test becomes vacuous (it only proves Node + tsx + zod install), and the SDK native-binary smoke test happens in Phase 3 where it has the highest cost-of-failure.

### Dev Dependencies (Phase 1)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `typescript` | ^5.9 (or ^6.0) | `tsc --noEmit` type-check in CI | D-10 mandates `noEmit: true`; tsc used only for type-checking, not compilation. Current published TS is 6.0.3 on 2026-04-24 but the Agent SDK was written against 5.x — either works since we're noEmit. **Recommendation: pin to `^5.9`** — lowest risk of type-library incompatibility. [VERIFIED: npm view 2026-04-24] |
| `@types/node` | matching Node 24 | Types for `process.env`, `fs`, etc. | Node 24 per CLAUDE.md; use `@types/node@24.x` if available, else latest |

### GitHub Action Dependencies (referenced by workflows, not installed via npm)

| Action | Version/SHA | Purpose | Pinning |
|--------|-------------|---------|---------|
| `actions/checkout` | `@v4` (as of CONTEXT D-20's era) — **recommend v5** or verify latest | Clone repo | **MUST be pinned to commit SHA at execution time** per D-20. Planner: run `gh api repos/actions/checkout/tags` during task execution to get current v5 SHA. Must set `persist-credentials: false` per SEC-01. |
| `actions/setup-node` | v6.4.0 current (`48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`) | Install Node 24 | **MUST be pinned to commit SHA.** CONTEXT.md D-20 writes `@v4` illustratively — the **decision** is "pin to SHA"; the **specific version** is Claude's discretion. Recommend v6.4.0 SHA above. [VERIFIED: GitHub releases page 2026-04-24 shows v6.4.0 as most recent]. Planner should re-verify with `gh api repos/actions/setup-node/git/refs/tags/v6.4.0` at execution time. |
| `gh` CLI | pre-installed | Used in self-test post-step to fetch job log | No pinning needed (runner-provided) |
| `yq` | pre-installed | Parse YAML for `persist-credentials` check | No pinning needed (pre-installed on `ubuntu-latest`) |

**Version verification commands (run during task execution):**
```bash
npm view @actions/core version
npm view zod version
npm view tsx version
npm view @anthropic-ai/claude-agent-sdk version peerDependencies
npm view @playwright/mcp version
gh api repos/actions/setup-node/git/refs/tags/v6.4.0 --jq .object.sha
gh api repos/actions/checkout/tags --jq '.[0].name, .[0].commit.sha'
```

### Installation

```bash
# Runtime
npm install --save \
  @actions/core@3.0.1 \
  zod@^4.0.0 \
  tsx@^4.21.0

# Forward-looking runtime (see §"Optional but Recommended" for rationale)
npm install --save \
  @anthropic-ai/claude-agent-sdk@0.2.119 \
  @playwright/mcp@0.0.70 \
  @actions/github@9.1.1

# Dev
npm install --save-dev \
  typescript@^5.9 \
  @types/node@^24

# Commit package-lock.json — required for `npm ci` determinism
```

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `tsx` | `ts-node` / `tsc` → `dist/` | `ts-node` has known ESM friction and slower cold start; `tsc` → `dist/` reintroduces `dist/` drift pitfall that D-02 explicitly avoids. **Do not switch without re-opening D-02.** |
| `npm ci --production` | `npm ci --omit=dev` | `--production` is deprecated in favor of `--omit=dev` but still works. CONTEXT D-01 and ROADMAP SC#1 specify the literal string `npm ci --production`. Honor the literal (it's grep-verifiable from SC#1). Flag `--omit=dev` migration in a future phase. |
| `zod 3.25.x` | `zod 4.3.6` | STACK.md says `^3.25.0 \|\| ^4.0.0`; the npm registry says the SDK peer-requires `^4.0.0` only. **Primary source wins — use zod 4.x.** |
| `Bun` | Bun replaces npm + tsx | CONTEXT D-03 locks `npm`. Not revisiting. |
| `ncc` / `esbuild` bundle → `dist/index.js` | — | CONTEXT D-01 explicitly forbids. |

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│ Consumer's workflow (or Phase 1 self-test)                            │
│   uses: ./ or uses: org/playwright-healer@vX                          │
│   with:                                                                │
│     mode: dry-run                                                      │
│     anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}               │
│     healer-token: ${{ secrets.HEALER_TOKEN }}                         │
│     github-token: ${{ github.token }}                                 │
└──────────────┬───────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ action.yml (composite)                                                 │
│  Step 1 (SETUP):    actions/setup-node@<sha> (Node 24)                │
│  Step 2 (INSTALL):  npm ci --production  (in ${{ github.action_path }})│
│  Step 3 (RUN):      npx tsx ${{ github.action_path }}/src/index.ts    │
│                     env: INPUT_MODE, INPUT_ANTHROPIC_API_KEY, ... (8) │
└──────────────┬───────────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ src/index.ts  (Node process, single entry)                             │
│                                                                         │
│   Phase A: SECRET MASKING (D-07: FIRST, before any log)                │
│     core.getInput('anthropic-api-key') → core.setSecret(v)             │
│     core.getInput('healer-token')      → core.setSecret(v)             │
│     core.getInput('github-token')      → core.setSecret(v)             │
│                                                                         │
│   Phase B: INPUT COLLECTION                                             │
│     Collect mode, setup-command, start-command, test-command, base-url │
│                                                                         │
│   Phase C: VALIDATION (Zod)                                             │
│     z.enum(['ingest','heal','dry-run']).safeParse(mode)                │
│     Invalid → core.setFailed(errorMessage) + process.exit(1)           │
│                                                                         │
│   Phase D: DISPATCH                                                     │
│     'dry-run' → printRedactedSummary() + exit 0  (self-contained)      │
│     'ingest'  → import('./ingest/index.ts').run()  → THROWS            │
│     'heal'    → import('./healer/index.ts').run()  → THROWS            │
└──────────────────────────────────────────────────────────────────────┘

Parallel to the above, the repo ships two CI workflows:

┌──────────────────────────────────────────────────────────────────────┐
│ .github/workflows/security-lint.yml   (on: push, pull_request)         │
│   Job 1: grep pull_request_target outside allowlist                   │
│   Job 2: yq-parse all workflow YAML; find checkout without            │
│          persist-credentials:false                                     │
│   Job 3: diff .planning/security-contract.snapshot.json vs TS values;  │
│          if changed, require Security-Contract-Change trailer         │
│   Job 4: grep src/**/*.ts for HTTP-client patterns (SEC-07)           │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ .github/workflows/phase1-self-test.yml  (on: push, pull_request)       │
│   Job A (self-test-masking):                                           │
│     Run ./ with mode=dry-run + canary API key                         │
│   Job B (verify-log-mask, needs: A, if: always()):                    │
│     gh api job-logs/<A's id> | ! grep 'test-canary-DO-NOT-USE-REAL-KEY'│
│   Job C (self-test-invalid-mode):                                      │
│     Run ./ with mode=banana → assert exit 1 + Zod error has 'mode'    │
│   Job D (self-test-missing-key):                                       │
│     Run ./ without anthropic-api-key → assert exit 1 + field name      │
└──────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
playwright-healer/
├── action.yml                                    # composite action
├── package.json                                  # npm dependencies
├── package-lock.json                             # committed for npm ci
├── tsconfig.json                                 # strict, noEmit, bundler
├── .gitignore                                    # node_modules, *.log
├── src/
│   ├── index.ts                                  # dispatcher (D-04/D-07)
│   ├── ingest/
│   │   └── index.ts                              # stub — throw (D-09)
│   ├── healer/
│   │   └── index.ts                              # stub — throw (D-09)
│   └── shared/
│       ├── config.ts                             # Zod schemas (D-08)
│       └── security-contract.ts                  # frozen constants (D-11)
├── .github/
│   └── workflows/
│       ├── security-lint.yml                     # D-14 (4 checks)
│       └── phase1-self-test.yml                  # D-15 (4 self-tests)
└── .planning/
    └── security-contract.snapshot.json           # JSON mirror (D-12)
```

### Pattern 1: Composite `action.yml` with Explicit `env:` Block

**What:** Composite actions do NOT auto-populate `INPUT_*` env vars inside their run steps. Each composite step must declare `env:` mapping `inputs.*` → `INPUT_*` explicitly, or `@actions/core` `getInput('mode')` returns empty string.

**When to use:** Always, for every composite step that invokes Node code using `@actions/core`.

**Why this is load-bearing:** Without the `env:` block, every Zod validation fails because every input appears empty. The self-test workflow would report: "mode must be one of ingest|heal|dry-run; got '' " — and the planner would spend hours debugging a trivially-fixed gotcha. This is the single most common composite-action mistake.

**Canonical shape:**

```yaml
# action.yml
name: 'playwright-healer'
description: 'Auto-heal flaky Playwright tests via Claude Agent SDK + Playwright MCP'
author: 'playwright-healer contributors'

inputs:
  mode:
    description: 'Run mode: ingest | heal | dry-run'
    required: true
  anthropic-api-key:
    description: 'Anthropic API key for Claude Agent SDK'
    required: true
  healer-token:
    description: 'PAT or GitHub App token required for PR creation and workflow_dispatch'
    required: true
  github-token:
    description: 'GitHub token; defaults to the built-in action token'
    required: false
    default: ${{ github.token }}
  setup-command:
    description: 'Command to set up the application under test (healer mode)'
    required: false
    default: ''
  start-command:
    description: 'Command to start the application under test (healer mode)'
    required: false
    default: ''
  test-command:
    description: 'Command to run Playwright tests'
    required: false
    default: ''
  base-url:
    description: 'Base URL of the application under test'
    required: false
    default: ''

runs:
  using: composite
  steps:
    - name: Install action dependencies
      shell: bash
      working-directory: ${{ github.action_path }}
      run: npm ci --production

    - name: Set up Node
      uses: actions/setup-node@<pinned-sha>    # see §Standard Stack
      with:
        node-version: '24'

    - name: Run playwright-healer
      shell: bash
      working-directory: ${{ github.action_path }}
      env:
        INPUT_MODE: ${{ inputs.mode }}
        INPUT_ANTHROPIC_API_KEY: ${{ inputs.anthropic-api-key }}
        INPUT_HEALER_TOKEN: ${{ inputs.healer-token }}
        INPUT_GITHUB_TOKEN: ${{ inputs.github-token }}
        INPUT_SETUP_COMMAND: ${{ inputs.setup-command }}
        INPUT_START_COMMAND: ${{ inputs.start-command }}
        INPUT_TEST_COMMAND: ${{ inputs.test-command }}
        INPUT_BASE_URL: ${{ inputs.base-url }}
      run: npx tsx src/index.ts
```

Open decision for planner: whether install-and-run collapse into a single step (saves ~1s cold start) or split into two (more debuggable). D-14's success criterion "npm ci --production as the first step" argues for splitting.

Note the **ordering** of the composite steps: `npm ci --production` FIRST per SC#1, then setup-node, then the actual run. `actions/setup-node` is NOT strictly required if `ubuntu-latest` already ships Node 24 by the time this phase runs (GitHub-mandated default from 2026-06-02); include it for determinism and for the composite to work on runners before that cutover.

### Pattern 2: Startup Ordering in `src/index.ts` (D-07)

**What:** Secrets registered with `core.setSecret()` BEFORE any log line, then Zod validation, then dispatch. This resolves the apparent conflict: "register before anything is logged" and "don't use secrets until mode is valid" are both true under this order.

**When to use:** Always — this is D-07, locked.

**Canonical shape (reference; planner produces the task):**

```typescript
// src/index.ts
import * as core from '@actions/core';
import { z } from 'zod';
import { getInputSchema } from './shared/config.js';

async function main(): Promise<void> {
  // ── Phase A: SECRET MASKING (must be first, before any log) ──
  const anthropicApiKey = core.getInput('anthropic-api-key', { required: true });
  const healerToken     = core.getInput('healer-token',      { required: true });
  const githubToken     = core.getInput('github-token',      { required: true });

  core.setSecret(anthropicApiKey);
  core.setSecret(healerToken);
  core.setSecret(githubToken);

  // ── Phase B: INPUT COLLECTION ──
  const rawInputs = {
    mode:           core.getInput('mode',           { required: true }),
    setupCommand:   core.getInput('setup-command'),
    startCommand:   core.getInput('start-command'),
    testCommand:    core.getInput('test-command'),
    baseUrl:        core.getInput('base-url'),
    anthropicApiKey,
    healerToken,
    githubToken,
  };

  // ── Phase C: VALIDATION (Zod; fail-fast) ──
  const parsed = getInputSchema().safeParse(rawInputs);
  if (!parsed.success) {
    // Zod error formatting — must name the failing field (SC#4)
    const msg = parsed.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    core.setFailed(`Invalid inputs: ${msg}`);
    return; // process exits with code 1 via setFailed
  }
  const config = parsed.data;

  // ── Phase D: DISPATCH ──
  switch (config.mode) {
    case 'dry-run':
      await runDryRun(config);  // self-contained in Phase 1
      return;
    case 'ingest': {
      const m = await import('./ingest/index.js');
      await m.run(config);     // throws in Phase 1 per D-09
      return;
    }
    case 'heal': {
      const m = await import('./healer/index.js');
      await m.run(config);     // throws in Phase 1 per D-09
      return;
    }
  }
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
```

**Dry-run summary (D-05):** write to `$GITHUB_STEP_SUMMARY` via `core.summary.addRaw(...).write()`. Must enumerate every input field with its value — except the three secret inputs, which render as `***` (or omit entirely). Since the three secrets are already registered with `core.setSecret`, even if the implementer accidentally logs them the runner mask replaces them with `***` — defense-in-depth.

### Pattern 3: `src/shared/security-contract.ts` — Frozen Constants (D-11)

```typescript
// src/shared/security-contract.ts
//
// SECURITY DESIGN CONTRACT — DO NOT MODIFY WITHOUT:
//   1. A commit message trailer:  Security-Contract-Change: reviewed-by=<github-handle>
//   2. A matching update to .planning/security-contract.snapshot.json
//
// Downstream phases (2+) MUST import these constants. Inline string literals
// for allowedTools, allowed origins, or forbidden triggers are banned and
// will be caught by the security-lint grep check in CI.

export const ALLOWED_TOOLS = Object.freeze([
  'mcp__playwright__*',
  'Read',
  'Grep',
  'Glob',
] as const);

export const ALLOWED_ORIGIN_TEMPLATE = (baseUrl: string): readonly string[] =>
  Object.freeze([baseUrl, 'http://localhost:*']);

export const FORBIDDEN_WORKFLOW_TRIGGERS = Object.freeze([
  'pull_request_target',
] as const);
```

**Note on the `ALLOWED_ORIGIN_TEMPLATE` function:** it cannot be `Object.freeze`'d as a whole (it's a function). The function returns a frozen array. This is sufficient because the immutability guarantee is on the *returned* value, not the function identity.

### Pattern 4: `.planning/security-contract.snapshot.json` (D-12)

```json
{
  "allowedTools": [
    "mcp__playwright__*",
    "Read",
    "Grep",
    "Glob"
  ],
  "allowedOriginTemplate": ["<baseUrl>", "http://localhost:*"],
  "forbiddenWorkflowTriggers": [
    "pull_request_target"
  ]
}
```

**Canonicalization recipe (for CI diff stability):** Write the file with exactly this formatter:
```javascript
// Sorted keys at every level, 2-space indent, trailing newline.
const json = JSON.stringify(obj, Object.keys(obj).sort(), 2) + '\n';
```
Make this explicit in the planner's task definition so CI diffs don't false-positive on formatter-induced whitespace differences.

### Pattern 5: `src/shared/config.ts` — Zod Schema (D-08, D-06)

```typescript
import { z } from 'zod';

const ModeEnum = z.enum(['ingest', 'heal', 'dry-run'])
  .describe('mode must be one of: ingest, heal, dry-run');

// Factory form: lets tests override defaults without module-level state
export function getInputSchema() {
  return z.object({
    mode:            ModeEnum,
    setupCommand:    z.string().default(''),
    startCommand:    z.string().default(''),
    testCommand:     z.string().default(''),
    baseUrl:         z.string().default(''),
    anthropicApiKey: z.string().min(1, { message: 'anthropic-api-key is required and must be non-empty' }),
    healerToken:     z.string().min(1, { message: 'healer-token is required and must be non-empty' }),
    githubToken:     z.string().min(1, { message: 'github-token is required and must be non-empty' }),
  });
}

export type Config = z.infer<ReturnType<typeof getInputSchema>>;
```

**Why field names matter:** SC#4 requires the error for invalid `mode` to name the field. Zod's default `issue.path.join('.')` produces `mode`, `anthropicApiKey`, etc. — use *those* names verbatim in the error string (they're the field names used internally; for user-facing error messages, planner may map back to kebab-case `mode` / `anthropic-api-key`). Either is acceptable as long as the offending field is unambiguously named.

### Pattern 6: Stubs (D-09)

```typescript
// src/ingest/index.ts
import type { Config } from '../shared/config.js';

export async function run(_config: Config): Promise<never> {
  throw new Error('ingest mode not implemented until Phase 2');
}
```

```typescript
// src/healer/index.ts
import type { Config } from '../shared/config.js';

export async function run(_config: Config): Promise<never> {
  throw new Error('heal mode not implemented until Phase 3');
}
```

The `: Promise<never>` signature makes it clear to readers and to the type system that these never return normally.

### Pattern 7: `tsconfig.json` (D-10)

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

`allowImportingTsExtensions: false` keeps import paths portable across tsx and (hypothetical) tsc compilation. `isolatedModules` ensures tsx can compile each file independently (it does in practice, but this enforces it as a type-check-time invariant).

### Pattern 8: `package.json` Shape

```json
{
  "name": "playwright-healer",
  "version": "0.0.0",
  "private": true,
  "description": "Auto-heal flaky Playwright tests in GitHub Actions via Claude Agent SDK + Playwright MCP",
  "type": "module",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "echo 'no tests in Phase 1 (see .github/workflows/phase1-self-test.yml)'"
  },
  "dependencies": {
    "@actions/core": "3.0.1",
    "@actions/github": "9.1.1",
    "@anthropic-ai/claude-agent-sdk": "0.2.119",
    "@playwright/mcp": "0.0.70",
    "tsx": "^4.21.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^24",
    "typescript": "^5.9"
  }
}
```

`"type": "module"` — ESM-first. Matches `tsconfig.json` `module: ES2022`. The forward-looking SDK + MCP + `@actions/github` installs are Claude's discretion per CONTEXT; planner may drop to only Phase 1-used packages if the advisor or execution surfaces a blocker.

### Anti-Patterns to Avoid

- **Collapsing `install` and `run` into one composite step with a chained shell command.** Breaks the SC#1 `npm ci --production` "first step" verification — SC#1 says `cat action.yml` should show `npm ci --production` as the first step, which is easier to grep-verify when it's a discrete step.
- **Omitting the `env:` block on the composite run step.** See Pattern 1 — input reading silently fails.
- **Using `console.log()` or `core.info()` before `core.setSecret()` is called on all three secrets.** D-07 is specific: secrets registered FIRST.
- **Storing the canary API key as a repo secret in the self-test workflow.** The canary is public-domain test data, not a secret. Per D-15, it MUST be inlined as a literal YAML string so anyone cloning the repo can run CI without secret configuration. If it's in `secrets.*`, contributors' CI runs silently fail with missing-secret errors.
- **Reading the commit message via `git log -1 --format='%B'` in a `pull_request` context.** In `pull_request` workflows, `HEAD` is a merge commit, not the change under review. Use the PR commit range (see Pattern 9 below).

### Pattern 9: Security Contract Trailer Check (D-13)

**Problem:** On `push` triggers, `git log -1 --format='%B'` works. On `pull_request` triggers, `HEAD` is a synthetic merge commit (the last commit of the merge); its message is "Merge abc into def" — the actual change commit is earlier.

**Solution:** Check the commit range between the PR base and HEAD. Require the trailer on AT LEAST ONE commit that modifies either `src/shared/security-contract.ts` or `.planning/security-contract.snapshot.json`.

```bash
# .github/workflows/security-lint.yml — contract-trailer-check step
set -euo pipefail

# Determine the base: use merge-base with PR target, fall back to HEAD~1 on push
if [ "${{ github.event_name }}" = "pull_request" ]; then
  BASE="origin/${{ github.base_ref }}"
  git fetch --no-tags origin "${{ github.base_ref }}:${BASE}"
  RANGE="${BASE}...HEAD"
else
  # push trigger — inspect HEAD only (latest commit)
  RANGE="HEAD~1..HEAD"
fi

# Has the snapshot or contract source been modified in any commit in range?
CHANGED=$(git log "$RANGE" --name-only --pretty=format: \
  -- src/shared/security-contract.ts .planning/security-contract.snapshot.json \
  | grep -cv '^$' || true)

if [ "$CHANGED" -gt 0 ]; then
  # Require trailer on AT LEAST ONE commit in the range that touches these paths
  TRAILER_COUNT=$(git log "$RANGE" --format='%B' \
    -- src/shared/security-contract.ts .planning/security-contract.snapshot.json \
    | grep -c '^Security-Contract-Change: reviewed-by=' || true)

  if [ "$TRAILER_COUNT" -eq 0 ]; then
    echo "::error::Security contract changed but no commit has the 'Security-Contract-Change: reviewed-by=<handle>' trailer"
    exit 1
  fi
fi
```

Note the `|| true` idiom with `grep -c`: grep exits 1 when no matches — without `|| true`, `set -e` terminates the script. This is a common shell lint pitfall.

### Pattern 10: `persist-credentials: false` Enforcement (SEC-01, D-14 check 2)

**Problem:** Grepping for `persist-credentials: false` has false negatives on multi-line YAML or unusual key ordering.

**Solution:** Use `yq` (pre-installed on `ubuntu-latest`) to parse YAML semantically.

```bash
# Find every actions/checkout usage in action.yml + all workflows, verify persist-credentials: false
set -euo pipefail

FAIL=0
FILES=$(find action.yml .github/workflows -name '*.yml' -o -name '*.yaml' 2>/dev/null)

for f in $FILES; do
  # Extract all checkout usages; check each has with.persist-credentials == false
  MATCHES=$(yq eval -o=json '
    .. | select(tag == "!!map") | select(has("uses")) |
    select(.uses | test("^actions/checkout(@|$)")) |
    { "file": "'"$f"'", "persist": (.with."persist-credentials" // "MISSING") }
  ' "$f" 2>/dev/null || true)

  if [ -n "$MATCHES" ]; then
    # Any checkout step without persist-credentials: false fails
    while IFS= read -r line; do
      P=$(echo "$line" | yq eval '.persist' -)
      if [ "$P" != "false" ]; then
        echo "::error file=$f::actions/checkout step without persist-credentials: false (got: $P)"
        FAIL=1
      fi
    done <<< "$MATCHES"
  fi
done

exit $FAIL
```

In Phase 1 there are no planned `actions/checkout` usages (the self-test doesn't need to check out the repo — it `uses: ./` which is an implicit local action reference, no explicit checkout). But the check must still run against any future workflow file. Include the check as a future-proofing gate.

### Pattern 11: `pull_request_target` Grep (SEC-02, D-14 check 1)

```bash
# Grep the repo for the literal string; exclude allowed documentation paths
set -euo pipefail

MATCHES=$(git grep -l 'pull_request_target' -- \
  ':(exclude).planning/' \
  ':(exclude)CLAUDE.md' \
  ':(exclude)README.md' \
  || true)

if [ -n "$MATCHES" ]; then
  echo "::error::pull_request_target found in non-allowlisted files:"
  echo "$MATCHES" | sed 's/^/  /'
  exit 1
fi
```

The `:(exclude)` pathspec is git's native exclusion syntax — more reliable than post-grep filtering.

### Pattern 12: SEC-07 Phone-Home Static Grep (D-16a)

```bash
# In Phase 1: zero HTTP client usage in src/**/*.ts
set -euo pipefail

PATTERNS='fetch\(|http\.request\(|https\.request\(|axios|got\(|node-fetch|undici'
MATCHES=$(git grep -nE "$PATTERNS" -- 'src/**/*.ts' || true)

if [ -n "$MATCHES" ]; then
  echo "::error::SEC-07 violation: HTTP client usage found in src/ (Phase 1 allowlist is empty)"
  echo "$MATCHES"
  exit 1
fi
```

Phase 2/3 will extend this to allow `@actions/github` (Octokit) and the Claude Agent SDK — but those are imports, not raw HTTP calls, so the grep above still works without modification as long as the allowlist is "literal HTTP client patterns."

### Pattern 13: Self-Test Masking Verification (D-15, SC#3) — Two-Job Pattern

**Critical:** The Actions log for a running job is not finalized until the job exits. A post-step within the same job cannot reliably grep its own log. You need two jobs, with the second waiting on the first.

```yaml
# .github/workflows/phase1-self-test.yml
name: Phase 1 Self-Test
on: [push, pull_request]

permissions:
  contents: read
  actions: read          # needed by Job B to call gh api on Job A's log

jobs:

  self-test-masking:
    name: Self-test — mask canary secret
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<pinned-sha>
        with:
          persist-credentials: false

      - name: Invoke action with dry-run and canary API key
        uses: ./
        with:
          mode: dry-run
          anthropic-api-key: 'test-canary-DO-NOT-USE-REAL-KEY'
          healer-token: 'test-canary-healer-token'
          github-token: ${{ github.token }}

  verify-log-mask:
    name: Verify canary was masked in previous job log
    runs-on: ubuntu-latest
    needs: self-test-masking
    if: always()
    steps:
      - name: Fetch job log and assert canary is absent
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          JOB_ID=$(gh api \
            "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/jobs" \
            --jq '.jobs[] | select(.name=="Self-test — mask canary secret") | .id')
          if [ -z "$JOB_ID" ]; then
            echo "::error::Could not find job id for self-test-masking"
            exit 1
          fi
          gh api "repos/${GITHUB_REPOSITORY}/actions/jobs/${JOB_ID}/logs" > job.log
          if grep -q 'test-canary-DO-NOT-USE-REAL-KEY' job.log; then
            echo "::error::Canary appeared in the log — masking failed"
            exit 1
          fi
          echo "OK: canary was masked"

  self-test-invalid-mode:
    name: Self-test — invalid mode fails with Zod error
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<pinned-sha>
        with:
          persist-credentials: false
      - name: Invoke with mode=banana (expected to fail)
        id: run
        continue-on-error: true
        uses: ./
        with:
          mode: banana
          anthropic-api-key: 'test-canary-DO-NOT-USE-REAL-KEY'
          healer-token: 'test-canary-healer-token'
          github-token: ${{ github.token }}
      - name: Assert the step failed
        run: |
          if [ "${{ steps.run.outcome }}" != "failure" ]; then
            echo "::error::Expected failure for mode=banana, got ${{ steps.run.outcome }}"
            exit 1
          fi

  self-test-missing-api-key:
    name: Self-test — missing api key fails cleanly
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<pinned-sha>
        with:
          persist-credentials: false
      - name: Invoke without anthropic-api-key
        id: run
        continue-on-error: true
        uses: ./
        with:
          mode: dry-run
          anthropic-api-key: ''
          healer-token: 'test-canary-healer-token'
          github-token: ${{ github.token }}
      - name: Assert failure
        run: |
          if [ "${{ steps.run.outcome }}" != "failure" ]; then
            echo "::error::Expected failure for empty anthropic-api-key"
            exit 1
          fi
```

**Why `continue-on-error: true` + `steps.run.outcome` check:** The action invocation is expected to fail (non-zero exit). `continue-on-error: true` prevents the whole job from aborting; then we check `steps.run.outcome == 'failure'` to assert the expected failure occurred.

**Asserting the error message contains "mode":** The step's own stdout can't easily be captured into an output variable from a `uses:` step. The practical approach is to also grep the job log (Job B pattern again) for the literal word `mode` in the error string. Alternatively, invoke `src/index.ts` directly from a `run:` step after `npm ci`, so stdout/stderr are capturable — this bypasses the `uses: ./` pattern but gives full output access. Planner's choice.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Input parsing + secret masking | Manual `process.env.INPUT_MODE` + regex redaction | `@actions/core` `getInput`, `setSecret` | `setSecret` registers with the runner's mask filter — no regex can match it post-hoc; `getInput` handles missing/empty properly |
| Input validation | if/else + typeof checks + manual error formatting | `zod` schemas with `.describe()` | Zod gives field-path in every error message (SC#4 requirement); exhaustive validation free; type inference as bonus |
| TypeScript runtime execution | Compile with `tsc`, commit `dist/`, run Node on JS | `tsx` at runtime | D-02 locked; `dist/` drift is an explicit pitfall (listed in PITFALLS.md tech-debt table) |
| YAML parsing for the `persist-credentials` check | `grep persist-credentials` + regex | `yq` (pre-installed) | Grep false-negatives on multi-line YAML; `yq` resolves YAML references and anchors correctly |
| Git commit range on PR context | `git log -1 HEAD` | `git log origin/<base>...HEAD` | HEAD on `pull_request` is a synthetic merge commit, not the change |
| Job log retrieval | `cat /home/runner/_diag/*.log` | `gh api .../actions/jobs/<id>/logs` | The in-workspace log is partial and unreliable; the API returns the finalized log after job exit |
| Atomic JSON snapshot formatting | `JSON.stringify(obj)` with default args | `JSON.stringify(obj, Object.keys(obj).sort(), 2) + '\n'` | CI diffs become stable across contributors' formatters; without sorted keys, key-order drift creates phantom diffs |

**Key insight:** Phase 1 is entirely scaffolding — every "what should I do?" has a standard answer. The planner should not invent novel approaches; every pattern in this research is verifiable against an npm package, a `gh` CLI command, or a well-documented Git operation.

## Common Pitfalls

### Pitfall 1: Composite Action `INPUT_*` env vars are not auto-populated

**What goes wrong:** Composite steps do NOT inherit the magic env-var shape that standalone Node actions get. `core.getInput('mode')` returns `""` because `INPUT_MODE` is unset. Every Zod validation fails. Debugging takes hours.

**Why it happens:** Widely misdocumented. The GitHub Actions runtime auto-populates `INPUT_*` env vars only for `runs.using: node20`/`node24` actions. For composite actions, you populate them yourself in each step's `env:` block.

**How to avoid:** Pattern 1 above. Every composite step that invokes Node code with `@actions/core` MUST declare `env:` mapping all 8 inputs.

**Warning signs:** Every Zod error says "mode must be one of..., got '' "; `healer-token is required and must be non-empty` even though the workflow supplies it.

### Pitfall 2 (SEC-01 — from PITFALLS.md Pitfall 5): `actions/checkout` credential leak

**What goes wrong:** `actions/checkout` default `persist-credentials: true` stores the GitHub token in `.git/config` in the workspace. When Phase 3's agent loop runs in that workspace with any filesystem-read tool, it can read the token.

**Why it happens:** The default makes `git push` work without re-authentication, so most workflows don't think about it.

**How to avoid (Phase 1):** Add the CI check in Pattern 10. In Phase 1 there are no planned checkout uses (self-test uses `uses: ./` which doesn't require explicit checkout of the action repo's code — GitHub Actions handles that). But the lint must catch any future violation.

**Warning signs:** A PR adds `- uses: actions/checkout@...` without a following `with: persist-credentials: false` — security-lint must fail.

### Pitfall 3 (SEC-02 — from PITFALLS.md Pitfall 3): `pull_request_target` trigger

**What goes wrong:** A workflow uses `on: pull_request_target` to access secrets on fork PRs. The fork's untrusted code gets executed in a context with full secret access. Real CVEs (GHSA-89qq-hgvp-x37m, CVSS 9.3) confirm active exploitation.

**How to avoid (Phase 1):** Grep check in Pattern 11. Excludes allowlisted documentation files (the string legitimately appears in prose in `.planning/`, `CLAUDE.md`, `README.md` as a warning).

**Warning signs:** Any workflow YAML contains `pull_request_target` outside allowlisted paths — security-lint must fail.

### Pitfall 4 (Phase 1 scope only locks the template): MCP `--allowed-origins`

**What goes wrong (at runtime in Phase 3):** Agent browses to attacker-controlled origins via the MCP `browser_navigate` tool.

**Phase 1 scope:** Only lock the TEMPLATE constant `ALLOWED_ORIGIN_TEMPLATE` in `security-contract.ts`. Phase 3 imports it and passes it to the MCP server config. Phase 1 does NOT wire runtime origin enforcement.

**How to avoid in Phase 1:** Don't wire the template to any runtime behavior. The constant exists to lock the shape — Phase 3 consumers cannot silently change it without the CI trailer gate firing.

### Pitfall 5 (SEC-07 phone-home): Silent HTTP client introduction

**What goes wrong:** A developer in Phase 2 adds `import fetch from 'node-fetch'` for a convenience feature. It silently phones home. Review catches nothing because it's a normal-looking import.

**How to avoid:** Pattern 12 — static grep in `security-lint.yml`. Phase 1 allowlist is EMPTY (no HTTP clients anywhere in src/). Phase 2/3 extend the allowlist as they legitimately introduce Octokit and Agent SDK usage — but those are imports of libraries that the grep pattern doesn't match (we grep for `fetch(`, `http.request(`, etc., not for `import` statements). Extending the allowlist will require adding a targeted exemption in the grep script, which itself becomes a reviewable change.

### Pitfall 6 (from PITFALLS.md Pitfall 10): Floating-tag supply-chain risk

**What goes wrong:** `actions/setup-node@v4` resolves to whatever the maintainer re-tags — a compromised version propagates instantly.

**How to avoid:** D-20 requires pinning to commit SHA. See §Standard Stack for the current v6.4.0 SHA. The planner MUST re-verify the SHA at execution time with `gh api repos/actions/setup-node/git/refs/tags/v6.4.0 --jq .object.sha` because GitHub can and does retag.

**Warning signs:** Any workflow line matches `/uses: actions\/[^@]+@v\d+$/` (v-tag instead of SHA). Consider adding a pre-commit hook or an additional security-lint check for this in a future phase.

### Pitfall 7: `dist/` drift re-introduction

**What goes wrong:** An eager contributor adds a build step ("just in case we need it later"), commits a `dist/` folder, and suddenly the action has two source-of-truth paths for its runtime.

**How to avoid:** `.gitignore` includes `dist/`. `package.json` has no `build` script. `tsconfig.json` has `noEmit: true`. If anything in Phase 2+ suggests introducing a bundle, FLAG — this is a locked architectural decision (D-01/D-02).

**Warning signs:** A PR adds `"build": "tsc"` or `"build": "ncc ..."` to `package.json`; a PR commits files under `dist/`.

### Pitfall 8: Canary stored as secret instead of inline literal

**What goes wrong:** The self-test workflow uses `${{ secrets.TEST_API_KEY }}`. A fresh fork has no such secret, so the self-test workflow silently fails on every contributor's first push.

**How to avoid:** D-15 already resolves this — the canary is a public literal string. Reinforce in the task: the value `test-canary-DO-NOT-USE-REAL-KEY` MUST be inline YAML, not `secrets.*`.

### Pitfall 9: In-job log grep race

**What goes wrong:** A post-step in the same job greps its own job log. The log API returns incomplete data because the job hasn't exited. Spurious pass/fail.

**How to avoid:** Pattern 13 — two jobs, second `needs:` the first, `if: always()`.

## Runtime State Inventory

**Not applicable.** Phase 1 is greenfield (STATE.md confirms zero prior code). There is no stored data, no live service config, no OS-registered state, no secrets (except the masking registration for env vars handed in at runtime), and no build artifacts to inventory.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 24 | tsx runtime execution | ✓ on `ubuntu-latest` after 2026-06-02; recommend `actions/setup-node@<sha>` step for determinism | 24.x | Use `actions/setup-node` — no fallback needed |
| npm | `npm ci --production` | ✓ (ships with Node) | bundled | — |
| `gh` CLI | Job log retrieval in self-test; version SHA lookup | ✓ pre-installed on `ubuntu-latest` | latest | — |
| `yq` | YAML parsing in `security-lint.yml` | ✓ pre-installed on `ubuntu-latest` | 4.x | If not present, fall back to `python -c "import yaml; ..."` — but yq is standard |
| `git` | `git grep`, `git log` | ✓ always available | — | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

Phase 1 runs entirely on `ubuntu-latest` defaults. No custom runner, no external services.

## Validation Architecture

Test framework is **GitHub Actions workflows** — specifically `.github/workflows/security-lint.yml` and `.github/workflows/phase1-self-test.yml`. There is no per-package test framework in Phase 1 because there is almost no runtime code to test (the dispatcher is ~40 lines; the dry-run branch prints a summary; the ingest/heal branches throw). The enforcement gates ARE the tests.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | GitHub Actions workflows (push + pull_request) |
| Config files | `.github/workflows/security-lint.yml`, `.github/workflows/phase1-self-test.yml` |
| Quick run command | `gh workflow run security-lint.yml` + `gh workflow run phase1-self-test.yml` (manual trigger); or just `git push` |
| Full suite command | Same — all Phase 1 validation is the CI workflows themselves |
| Local typecheck | `npm run typecheck` (tsc --noEmit); verifies src/ compiles strictly |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command / File | File Exists? |
|--------|----------|-----------|--------------------------|-------------|
| PKG-01 | `runs.using: composite` present | static grep | `grep -E '^[[:space:]]*using:[[:space:]]*composite' action.yml` (in CI) | ❌ Wave 0 — action.yml |
| PKG-02 | `npm ci --production` is first composite step | static grep + YAML parse | `yq eval '.runs.steps[0].run' action.yml \| grep -F 'npm ci --production'` | ❌ Wave 0 — action.yml |
| CFG-01 | Four user-command inputs declared | YAML parse | `yq eval '.inputs \| keys' action.yml` includes all four | ❌ Wave 0 — action.yml |
| CFG-02 | Three secret inputs declared with correct defaults | YAML parse | `yq eval '.inputs."anthropic-api-key".required' action.yml == true`, etc. | ❌ Wave 0 — action.yml |
| CFG-05 | `mode` input declared (enum enforcement is runtime) | YAML parse + Zod test | Workflow: `self-test-invalid-mode` asserts exit 1 on `mode: banana` | ❌ Wave 0 — phase1-self-test.yml |
| SEC-01 | Every checkout has `persist-credentials: false` | yq parse | `security-lint.yml` Pattern 10 | ❌ Wave 0 — security-lint.yml |
| SEC-02 | No `pull_request_target` outside allowlist | git grep | `security-lint.yml` Pattern 11 | ❌ Wave 0 — security-lint.yml |
| SEC-06 | Canary secret masked in job log | runtime self-test (two-job) | `phase1-self-test.yml` jobs `self-test-masking` + `verify-log-mask` | ❌ Wave 0 — phase1-self-test.yml |
| SEC-07 | No HTTP client usage in src/ | git grep | `security-lint.yml` Pattern 12 | ❌ Wave 0 — security-lint.yml |

### Success Criteria → Observable Signal Map

| SC | Observable Signal | Validation Mechanism | In-Repo? | Exact Check |
|----|-------------------|----------------------|----------|-------------|
| SC#1: `runs.using: composite` with `npm ci --production` first; no `dist/index.js` | Static file contents | CI + local grep | ✓ | `yq eval '.runs.using' action.yml == 'composite'`; `yq eval '.runs.steps[0].run' action.yml \| grep -F 'npm ci --production'`; `[ ! -e dist/index.js ]` |
| SC#2: Every checkout has `persist-credentials: false`; zero `pull_request_target` | Static file contents | `security-lint.yml` | ✓ | Pattern 10 + Pattern 11 |
| SC#3: Invalid `anthropic-api-key` value masked in log | Runtime (post-hoc log scrape) | `phase1-self-test.yml` two-job pattern | ✓ | Pattern 13 |
| SC#4: `mode` accepts `ingest`/`heal`/`dry-run`; fails fast with descriptive error otherwise | Runtime (exit code + error text) | `phase1-self-test.yml` `self-test-invalid-mode` + `self-test-missing-api-key` | ✓ | Step `continue-on-error: true` + `steps.X.outcome == 'failure'` |

All four success criteria are verifiable IN-REPO. No consumer repo needed. This matches CONTEXT D-15/D-16.

### Negative Tests

These test that the enforcement actually catches violations — not just that it passes on good code.

| Negative Test | How to Execute | Expected Outcome |
|---------------|----------------|------------------|
| Modify `src/shared/security-contract.ts` without the trailer → CI must fail | Create a scratch branch `test/contract-no-trailer`, change the file, push; or embed a self-testing job that creates a temp commit-with-bad-trailer | `security-lint.yml` check 3 returns exit 1 |
| Add `pull_request_target` to a workflow → CI must fail | Manual mutation test (write + revert) before Phase 1 sign-off; hard to automate without committing the bad string | `security-lint.yml` check 1 returns exit 1 |
| Add `actions/checkout` without `persist-credentials: false` → CI must fail | Same manual pattern — scratch branch | `security-lint.yml` check 2 returns exit 1 |
| Add `fetch(` call in `src/ingest/index.ts` → CI must fail | Same manual pattern | `security-lint.yml` check 4 returns exit 1 |
| Commit a `dist/index.js` file → no enforcement in Phase 1 | (see "Looks Done But Isn't" — flag for future phase: add a `[ ! -e dist/ ]` check in security-lint) | Currently passes silently — future work |

**Recommendation:** Create ONE dedicated workflow (`mutation-test.yml`) that runs ONLY on manual `workflow_dispatch` — performs the four mutations in a temp branch, runs `security-lint.yml` against each, and asserts each fails. Run before Phase 1 sign-off. This gives the planner a grep-verifiable gate for negative behavior without committing bad strings to main.

### Sampling Rate

- **Per task commit:** `npm run typecheck` locally + `gh workflow run security-lint.yml` after push
- **Per wave merge:** Full CI green on `security-lint.yml` + `phase1-self-test.yml`
- **Phase gate:** Both workflows green on main; `mutation-test.yml` manually triggered and green; SC#1–SC#4 verified by `/gsd-verify-work`

### Wave 0 Gaps

All of Phase 1 is Wave 0 — nothing exists yet. These are the files to create before any other task can start:

- [ ] `action.yml` — composite scaffold with 8 inputs and 3-step run block (PKG-01, PKG-02, CFG-01, CFG-02, CFG-05)
- [ ] `package.json` + `package-lock.json` — dependencies, engines, scripts
- [ ] `tsconfig.json` — strict, noEmit, bundler
- [ ] `.gitignore` — node_modules, dist, *.log
- [ ] `src/shared/security-contract.ts` — frozen constants (D-11)
- [ ] `src/shared/config.ts` — Zod schemas (D-08)
- [ ] `src/index.ts` — dispatcher with D-07 ordering
- [ ] `src/ingest/index.ts` — stub throwing (D-09)
- [ ] `src/healer/index.ts` — stub throwing (D-09)
- [ ] `.planning/security-contract.snapshot.json` — JSON mirror (D-12)
- [ ] `.github/workflows/security-lint.yml` — 4 lint checks (D-14)
- [ ] `.github/workflows/phase1-self-test.yml` — 4 self-tests with two-job masking pattern (D-15)
- [ ] (Optional) `.github/workflows/mutation-test.yml` — manual negative-test harness

No framework install needed — tsc for typecheck is the only local validation, and it's a devDep install via `npm i -D typescript`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies to Phase 1 | Standard Control |
|---------------|---------------------|-----------------|
| V1 Architecture | yes | Composite packaging decision; threat model reinforces `pull_request_target` ban |
| V2 Authentication | partially | `healer-token` + `github-token` validated as present; scope checks deferred per D-19 |
| V3 Session Management | no | No sessions in Phase 1 |
| V4 Access Control | yes | `ALLOWED_TOOLS` constant defines agent's access surface (Phase 3 consumer); `FORBIDDEN_WORKFLOW_TRIGGERS` defines trigger-level access |
| V5 Input Validation | yes | Zod schema in `src/shared/config.ts`; fail-fast on invalid mode (SC#4) |
| V6 Cryptography | no | No crypto operations in Phase 1 |
| V7 Error Handling | yes | `core.setFailed` + structured Zod error messages; secrets masked before any error line can leak them (D-07) |
| V8 Data Protection | yes | `core.setSecret()` registration for three secrets at startup (SEC-06) |
| V9 Communication | partially | No outbound HTTP in Phase 1 (SEC-07); enforced by static grep |
| V10 Malicious Code | yes | Supply-chain hygiene via pinned SHAs (D-20); no dynamic code loading |
| V11 Business Logic | no | No business logic in Phase 1 |
| V12 File & Resources | no | No file operations in Phase 1 (config dump is write-only to `$GITHUB_STEP_SUMMARY`) |
| V13 API & Web Services | no | No API surface in Phase 1 (Phase 2+ concern) |
| V14 Configuration | yes | All config via action inputs + env vars; no .env files; no hard-coded secrets |

### Known Threat Patterns for composite-action Stack

| Pattern | STRIDE | Standard Mitigation (Phase 1 implementation) |
|---------|--------|----------------------------------------------|
| Secret leak via log line | Information disclosure | `core.setSecret` before any log; D-07 startup ordering; two-job masking self-test (SC#3) |
| Fork PR secret exfiltration | Elevation of privilege | Ban `pull_request_target` via `security-lint.yml` (SEC-02) |
| Token leak via persisted git config | Information disclosure | `yq`-based workflow lint enforces `persist-credentials: false` (SEC-01) |
| Silent HTTP exfiltration ("phone home") | Information disclosure | Static grep in `security-lint.yml`; Phase 1 allowlist empty (SEC-07) |
| Floating-tag supply-chain compromise | Tampering | Pin all GitHub Actions to commit SHA (D-20); re-verify during planning |
| Silent contract weakening in later phases | Tampering | Commit-trailer CI gate on `security-contract.ts` (D-13); snapshot-diff check (D-14 #3) |
| Prompt injection via canary echo | Information disclosure (by inversion) | Self-test proves masking works by INCLUDING canary and verifying its ABSENCE from log (SC#3) |

### Security Non-Negotiables (from CLAUDE.md, reinforced)

These are load-bearing:

- `persist-credentials: false` on all checkout steps
- No `pull_request_target` trigger ever
- `ALLOWED_TOOLS` explicit as `["mcp__playwright__*", "Read", "Grep", "Glob"]` — never `Bash`/`Write`/`Edit` (Phase 1 defines the constant; Phase 3 consumes it)
- `--allowed-origins` scoped to `base-url` + localhost (Phase 1 defines the template; Phase 3 wires it)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `actions/setup-node@v6.4.0` SHA is `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` | §Standard Stack | Low — planner re-verifies with `gh api` at execution; the SHA may have been re-published (unlikely for an immutable commit SHA but possible if the tag was moved) |
| A2 | `actions/checkout`'s current stable major is v5 (not verified above — only setup-node was verified for the latest tag) | §Standard Stack | Low — planner re-verifies with `gh api repos/actions/checkout/tags` at execution time |
| A3 | `ubuntu-latest` runners in April 2026 ship Node 24 or ship an older version needing explicit setup-node | §Architecture Patterns Pattern 1 | Low — recommending `actions/setup-node` step explicitly, so this is determinism insurance regardless |
| A4 | `yq` is pre-installed on `ubuntu-latest` runners in 2026 | §Pattern 10 | Low — yq has been pre-installed for several years. Verifiable with `command -v yq` in a quick test step |

All version numbers in §Standard Stack are `[VERIFIED: npm registry 2026-04-24]` except where tagged otherwise. No significant `[ASSUMED]` claims affect the Phase 1 plan.

## Open Questions

1. **Whether `npx tsx src/index.ts` goes in `action.yml` as a single step, or install and run split into distinct steps**
   - What we know: SC#1 states "`npm ci --production` as the first step" — implies at least two steps (install + run) so the first-step text is grep-verifiable.
   - What's unclear: Whether to also add a `setup-node` step between install and run for Node 24 determinism.
   - Recommendation: **Three steps — `setup-node`, `npm ci --production`, `npx tsx src/index.ts`**. But SC#1 says "first step." Either (a) put `setup-node` LAST and `npm ci` first (weird), or (b) interpret SC#1 as "first of the meaningful steps" — the planner should flag this to the discuss phase if there's doubt. My recommendation: `npm ci --production` as step 1, `setup-node` as step 2, `npx tsx` as step 3. Node 24 will become ubuntu-latest default on 2026-06-02 so `setup-node` is redundant shortly — but ordering safeguards the cutover window.

2. **Whether the SEC-07 HTTP-client grep allowlist lives inline in the workflow or in a separate file**
   - What we know: Phase 1's allowlist is empty. Phase 2/3 will need to extend it.
   - What's unclear: Single source of truth for the allowlist.
   - Recommendation: **Inline in the workflow for Phase 1; promote to a separate `.github/sec-allowlist.txt` file when Phase 2 first needs to extend it.** Don't prematurely create a file for an empty list.

3. **Whether the security-lint snapshot-diff job tolerates formatting differences**
   - What we know: JSON has semantic equality that differs from byte equality.
   - What's unclear: How to serialize TS constants for diff.
   - Recommendation: **Use the canonical formatter from Pattern 4** (`JSON.stringify(obj, Object.keys(obj).sort(), 2) + '\n'`). CI reads `.planning/security-contract.snapshot.json`, reads the TS constants via `tsx` + a small helper script, serializes both with the canonical formatter, and `diff`s the resulting strings. No semantic-equality heuristic needed.

4. **Whether the Phase 1 self-test workflow runs on every push or only on security-sensitive paths**
   - What we know: Phase 1 is small enough that full-workflow-every-push is affordable.
   - What's unclear: Whether path-filter micro-optimization is worth the complexity.
   - Recommendation: **Run both workflows on every push and every pull_request for Phase 1**. The workflows are fast (no browser, no API calls, ~30s total). Path filters can be added later if CI cost becomes a concern.

5. **Whether `package-lock.json` should be generated with `npm install` or `npm ci`-replay from a seed**
   - What we know: `npm ci --production` requires `package-lock.json` to exist and match `package.json`.
   - What's unclear: Nothing material — standard workflow is `npm install` once locally, commit the lockfile, then `npm ci` in CI.
   - Recommendation: **Run `npm install` once when creating `package.json`; commit both `package.json` and `package-lock.json`. Subsequent dep changes go through `npm install <pkg> --save`.** Standard practice.

6. **(Bonus) Should the planner consume `@anthropic-ai/claude-agent-sdk` + `@playwright/mcp` in Phase 1's `package.json`, or defer to Phase 3?**
   - What we know: STATE.md lists "Native SDK binary discovery unverified" as a Phase 1 blocker. If the SDK is in `package.json`, the self-test's `npm ci --production` call discharges this blocker at zero marginal cost.
   - What's unclear: Whether early inclusion violates a YAGNI principle.
   - Recommendation: **Include them in Phase 1**. The cost is ~30MB of disk space during self-test and zero code imports. The benefit is a smoke test that Phase 3 would otherwise need to redo. This is CONTEXT.md Claude's discretion.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bundled JS action via `ncc` | Composite action with `npm ci --production` at runtime | ncc #1297 closed WONTFIX for Node 24 (confirmed 2025) | Mandatory for any action consuming `@anthropic-ai/claude-agent-sdk` |
| `npm ci --production` | `npm ci --omit=dev` | `--production` deprecated but functional | Honor literal `--production` per CONTEXT D-01 and ROADMAP SC#1; migrate in a later phase |
| zod `^3.25.0 \|\| ^4.0.0` peer range (STACK.md) | zod `^4.0.0` peer only (confirmed 2026-04-24) | SDK 0.2.119 dropped zod 3.x peer | Phase 1 uses zod 4.x; no v3 code path needed |
| `actions/setup-node@v4` (CONTEXT D-20 example) | `actions/setup-node@v6.4.0` (current as of 2026-04-24) | v5 and v6 released since CONTEXT was written | D-20's **decision** (pin-to-SHA) is locked; the **specific major version** is Claude's discretion |
| Node 20 GitHub Actions runtime | Node 24 GitHub Actions runtime | 2026-06-02 (GitHub-mandated) | Must target Node 24 per CLAUDE.md |

**Deprecated / outdated:**
- `ncc` for this action: PERMANENTLY; closed as WONTFIX for Node 24
- `dist/index.js` entrypoint pattern: not applicable to composite actions

## Sources

### Primary (HIGH confidence)
- `npm view @anthropic-ai/claude-agent-sdk version peerDependencies` (2026-04-24) — SDK version 0.2.119, peer `zod: ^4.0.0`
- `npm view @playwright/mcp version` (2026-04-24) — 0.0.70
- `npm view @actions/core version` (2026-04-24) — 3.0.1
- `npm view tsx version` (2026-04-24) — 4.21.0
- `npm view zod version` (2026-04-24) — 4.3.6
- `npm view typescript version` (2026-04-24) — 6.0.3
- [actions/setup-node GitHub releases](https://github.com/actions/setup-node/tags) (2026-04-24) — v6.4.0 current, SHA `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e`
- `.planning/research/STACK.md` — composite action pattern, `action.yml` shape rationale
- `.planning/research/ARCHITECTURE.md` — directory layout (D-08 scaffold)
- `.planning/research/PITFALLS.md` — 10 HIGH-severity pitfalls (Pitfalls 3, 5, 10 directly relevant to Phase 1)
- `.planning/research/SUMMARY.md` — executive summary
- `CLAUDE.md` — project architectural facts and security non-negotiables
- [GitHub Docs: composite actions](https://docs.github.com/actions/creating-actions/creating-a-composite-action) — composite step shape, `runs.using: composite`, need for explicit `env:` block
- [anthropics/claude-code-action action.yml](https://github.com/anthropics/claude-code-action/blob/main/action.yml) — reference composite action pattern
- [`@actions/core` setSecret docs](https://github.com/actions/toolkit/tree/main/packages/core#setting-a-secret) — masking registration semantics
- [Zod v4 docs](https://zod.dev/) — `z.enum`, `.safeParse`, `issues[].path`

### Secondary (MEDIUM confidence)
- [vercel/ncc issue #1297](https://github.com/vercel/ncc/issues/1297) — closed as not planned for Node 24
- [yossarian.net: actions/checkout credential leak](https://yossarian.net/til/post/actions-checkout-can-leak-github-credentials/) — `persist-credentials` default behavior
- [pgai Security Advisory GHSA-89qq-hgvp-x37m](https://github.com/timescale/pgai/security/advisories/GHSA-89qq-hgvp-x37m) — `pull_request_target` CVSS 9.3 CVE
- [GitHub Actions Node 20 deprecation](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/) — Node 24 mandated 2026-06-02

### Tertiary (LOW confidence — requires validation during execution)
- Exact pinned SHA for `actions/checkout` current major (not verified above) — planner re-verifies via `gh api`
- `yq` version on `ubuntu-latest` runners in April 2026 — tertiary but widely available; if missing, fallback is `python -c "import yaml; ..."`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified against npm registry on 2026-04-24
- Architecture patterns: HIGH — every pattern is derived from CONTEXT.md locked decisions and referenced against GitHub Actions / @actions/core / Zod official docs
- Pitfalls: HIGH — copied from PITFALLS.md which has multiple-source verification
- CI workflow shapes: HIGH — `yq`, `gh api`, and `git grep` are all standard-tooling patterns
- Security domain: HIGH — ASVS mapping is conservative; threat patterns cross-reference PITFALLS.md

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days; versions may drift — especially `actions/setup-node` SHA if GitHub re-tags)

---

*Phase 1 research complete. Handoff to planner.*
