# Phase 1: Security Scaffold + Composite Packaging — Pattern Map

**Mapped:** 2026-04-24
**Files analyzed:** 11 new files
**Analogs found:** 0 in-repo / 11 — this is a greenfield repo (see §"Greenfield Note")
**External canonical analogs:** 11 / 11 (all sourced from RESEARCH.md §"Architecture Patterns")

## Greenfield Note

This is the first phase of a greenfield repository. `ls /Users/sacha/dev/playwright-healer/` at pattern-mapping time shows only `.git/`, `.planning/`, and `CLAUDE.md`. There is NO `src/`, NO `.github/workflows/`, NO `package.json`, and NO prior implementation to copy from.

**It is expected and correct that "closest in-repo analog" is empty for every new file.** Per agent instructions, this file uses the RESEARCH.md reference implementations as the authoritative pattern source and does not fabricate in-repo analogs. External canonical analogs referenced:

- **`anthropics/claude-code-action`** (composite-action shape; confirms runtime-install + TS-source-execution pattern; referenced from CONTEXT.md §"Established Patterns" and CLAUDE.md §"Key architectural facts")
- **GitHub Actions docs** for composite `env:` block gotcha (Pitfall 1 / Pattern 1)
- **Zod 4.x docs** for `z.enum()` + `safeParse()` + `issue.path` error-formatting
- **`@actions/core` docs** for `getInput` / `setSecret` / `summary` / `setFailed` contract
- **`tsx` docs** for Node 24 runtime ESM execution without `tsc` → `dist/`

The executor consumes RESEARCH.md §"Architecture Patterns" Patterns 1–13 as the ground truth — this file cross-references each new file to the numbered pattern and highlights the non-obvious gotchas.

---

## File Classification

| New File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `action.yml` | composite-action manifest | declarative (YAML → runner) | RESEARCH Pattern 1 (based on `anthropics/claude-code-action`) | exact (external) |
| `package.json` | npm manifest | declarative | RESEARCH Pattern 8 | exact (external) |
| `package-lock.json` | npm lock file (generated) | declarative | produced by `npm install` — no template | generated |
| `tsconfig.json` | TS compiler config | declarative | RESEARCH Pattern 7 | exact (external) |
| `src/index.ts` | TS entry point / mode dispatcher | request-response (env in → exit code + `$GITHUB_STEP_SUMMARY` out) | RESEARCH Pattern 2 | exact (external) |
| `src/ingest/index.ts` | stub module | throws — no data flow | RESEARCH Pattern 6 | exact (external) |
| `src/healer/index.ts` | stub module | throws — no data flow | RESEARCH Pattern 6 | exact (external) |
| `src/shared/config.ts` | shared config (Zod schemas) | validation transform | RESEARCH Pattern 5 | exact (external) |
| `src/shared/security-contract.ts` | frozen security constants | module export (read-only) | RESEARCH Pattern 3 | exact (external) |
| `.planning/security-contract.snapshot.json` | JSON mirror of the contract | declarative (CI diff target) | RESEARCH Pattern 4 | exact (external) |
| `.github/workflows/security-lint.yml` | CI lint workflow | event-driven (push/PR) | RESEARCH Patterns 9, 10, 11, 12 | exact (external) |
| `.github/workflows/phase1-self-test.yml` | CI self-test workflow | event-driven (push/PR) | RESEARCH Pattern 13 | exact (external) |

---

## Pattern Assignments

### `action.yml` (composite-action manifest, declarative)

**Analog:** RESEARCH.md §"Pattern 1: Composite `action.yml` with Explicit `env:` Block" (lines 314–391). External canonical: `anthropics/claude-code-action/action.yml`.

**Reference shape** — copy verbatim modulo the pinned SHA:

```yaml
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
      uses: actions/setup-node@<pinned-sha>    # re-verify at execution via: gh api repos/actions/setup-node/git/refs/tags/v6.4.0 --jq .object.sha
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

**Critical non-obvious patterns the executor MUST follow:**

1. **Explicit `env:` block is load-bearing (Pitfall 1).** Composite actions do NOT auto-populate `INPUT_*` env vars — `@actions/core.getInput('mode')` returns `''` without the `env:` mapping. All 8 inputs MUST be mapped explicitly on the `Run playwright-healer` step. Skipping this produces a silent "every Zod validation fails with empty string" failure that burns hours to diagnose.
2. **`npm ci --production` MUST be the literal first step** (not collapsed into a chained shell command) per ROADMAP SC#1 — verification is `cat action.yml` + grep for that exact string as step-1 `run:`.
3. **Pin `actions/setup-node` to a commit SHA** (D-20), not `@v4` / `@v6`. Re-verify the SHA at execution time with `gh api repos/actions/setup-node/git/refs/tags/v6.4.0 --jq .object.sha`. Current v6.4.0 SHA from RESEARCH.md: `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` — treat as a pointer; verify before committing.
4. **`working-directory: ${{ github.action_path }}`** on BOTH the `npm ci` step AND the `npx tsx` step — without this, the commands run in the consumer's workspace root and fail to find `package.json` / `src/index.ts`.

**What NOT to do:**
- No `runs.using: node20` / `node24` — must be `composite` (PKG-01).
- No `ncc` / `esbuild` / `dist/index.js` — D-01 locked; pitfall 7 in RESEARCH.
- No `pull_request_target` anywhere.
- No collapsing install + run into a single shell-chained step.

---

### `package.json` (npm manifest, declarative)

**Analog:** RESEARCH.md §"Pattern 8" (lines 594–625) + §"Installation" (lines 184–205).

**Reference shape:**

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

**Critical non-obvious patterns:**

1. **`"type": "module"`** — ESM-first. Required for tsx + ES2022 target consistency. Dynamic `import('./ingest/index.js')` in dispatcher depends on this.
2. **`zod: ^4.0.0`** (NOT `^3.25.0`). RESEARCH verified at 2026-04-24: `@anthropic-ai/claude-agent-sdk` peer-requires `zod: ^4.0.0`. STACK.md's stated `^3.25.0 || ^4.0.0` is stale; the npm primary source wins.
3. **Exact pin for runtime deps, caret for `zod` + `tsx`** per CONTEXT deferred section default.
4. **Forward-looking installs** (`@anthropic-ai/claude-agent-sdk`, `@playwright/mcp`, `@actions/github`) are intentional: Phase 1 self-test exercises `npm ci --production`, which proves the native-binary SDK installs on `ubuntu-latest` — discharges STATE.md blocker "Native SDK binary discovery unverified" at zero extra cost.
5. **No `build` script.** Adding one would re-introduce `dist/` drift (pitfall 7). D-02 locks `noEmit: true`.
6. **`"test"` is a placeholder** — Phase 1 validation is the CI workflows themselves, not a test framework.

**What NOT to do:**
- No `"main"` / `"bin"` fields — tsx runs src directly; not an installable package.
- No `@actions/core` caret range — pin exact (3.0.1).
- No `dist/` referenced anywhere.

---

### `package-lock.json` (lock file, declarative)

Generated by `npm install`. Committed per D-03 + RESEARCH.md §Installation "Commit package-lock.json — required for `npm ci` determinism". No manual template.

**Executor note:** Run `npm install` (not `npm ci` initially; `npm ci` requires an existing lock file) inside the repo after writing `package.json`, then commit the generated `package-lock.json`.

---

### `tsconfig.json` (TS compiler config, declarative)

**Analog:** RESEARCH.md §"Pattern 7" (lines 569–592).

**Reference shape:**

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

**Critical non-obvious patterns:**

1. **`noEmit: true`** (D-10) — tsc is used ONLY for type-checking in CI (`npm run typecheck`). tsx is what actually executes TS at runtime. This is what makes D-02 "no `dist/`" enforceable.
2. **`moduleResolution: bundler`** per D-10 — matches tsx behavior; avoids `.js` extension gymnastics in imports.
3. **`allowImportingTsExtensions: false`** — keeps imports portable (`import from './shared/config.js'` form works under both tsx and tsc).
4. **`isolatedModules: true`** — ensures tsx can compile each file independently (enforces it as a type-check invariant).
5. **`exclude: ["node_modules", "dist"]`** — `dist` is listed defensively even though it should never exist.

**What NOT to do:**
- Do not add an `"outDir"` — would signal intent to emit.
- Do not set `module: CommonJS` — package.json is `"type": "module"`.
- Do not target older than ES2022 — Node 24 supports everything.

---

### `src/index.ts` (TS entry / mode dispatcher, request-response)

**Analog:** RESEARCH.md §"Pattern 2: Startup Ordering in `src/index.ts`" (lines 393–464).

**Reference shape** — the canonical D-07 startup order:

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
    const msg = parsed.error.issues
      .map(i => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    core.setFailed(`Invalid inputs: ${msg}`);
    return;
  }
  const config = parsed.data;

  // ── Phase D: DISPATCH ──
  switch (config.mode) {
    case 'dry-run':
      await runDryRun(config);
      return;
    case 'ingest': {
      const m = await import('./ingest/index.js');
      await m.run(config);
      return;
    }
    case 'heal': {
      const m = await import('./healer/index.js');
      await m.run(config);
      return;
    }
  }
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
```

**Critical non-obvious patterns:**

1. **Startup order is AUTHORITATIVE (D-07).** The sequence is: `getInput` three secrets → `setSecret` three secrets → `getInput` everything else → Zod validate → dispatch. Breaking this order (e.g., `core.info('starting')` before `setSecret`) leaks secrets into the log.
2. **Secret `getInput` happens BEFORE `setSecret`** — correct. `setSecret(v)` registers the value `v` (already retrieved) with the runner's mask filter; calling `setSecret` on an un-retrieved input would be nonsensical.
3. **`core.setFailed(msg)` + `return`** — NOT `process.exit(1)`. `setFailed` sets the exit code to 1 AND records the failure in the step's status; `process.exit` bypasses cleanup handlers.
4. **Zod error formatting MUST name the field** (SC#4). `issue.path.join('.')` yields `mode`, `anthropicApiKey` — sufficient. For kebab-case user-facing names, planner may map back; either acceptable.
5. **Dynamic `import('./ingest/index.js')`** (not static import) — keeps the stubs from being evaluated during `dry-run` and ensures the dispatcher contract is truly switch-based. The `.js` extension (not `.ts`) is required because TS resolves paths for the emitted/bundler target, not the source file.
6. **Dry-run summary (D-05):** write to `$GITHUB_STEP_SUMMARY` via `core.summary.addRaw(...).write()`. Redact the three secrets as `***` or omit. Even if accidentally logged, runner mask replaces them — defense-in-depth.

**What NOT to do:**
- No logging before `setSecret` — any `core.info`, `console.log`, or even a thrown error message with the values before masking = secret leak.
- No API calls / git operations / dispatches before Zod validation passes — D-07 is explicit.
- No `process.exit(1)` — use `setFailed` and return.
- No inline string literal for `allowedTools` here or anywhere outside `security-contract.ts`.

---

### `src/ingest/index.ts` & `src/healer/index.ts` (stubs, no data flow)

**Analog:** RESEARCH.md §"Pattern 6: Stubs" (lines 547–567).

**Reference shape:**

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

**Critical non-obvious patterns:**

1. **`Promise<never>`** return type — documents that these never return normally. Type system catches any accidental `return` statement added later.
2. **`_config: Config`** (underscore prefix) — signals unused parameter; satisfies strict TypeScript while preserving the Phase 2/3 dispatcher signature.
3. **Error message names the phase** — loud failure mode per D-09; matches the dispatcher routing contract.
4. **`import type { Config }`** — type-only import avoids runtime dep on config.ts resolver; consistent across both stubs.

**What NOT to do:**
- Do not return anything — throw only.
- Do not silently succeed (no `return;` with no throw).
- Do not reference any Phase 2/3 packages (no Octokit, no SDK) — stubs must be trivially resolvable.

---

### `src/shared/config.ts` (Zod schema, validation transform)

**Analog:** RESEARCH.md §"Pattern 5" (lines 520–545).

**Reference shape:**

```typescript
import { z } from 'zod';

const ModeEnum = z.enum(['ingest', 'heal', 'dry-run'])
  .describe('mode must be one of: ingest, heal, dry-run');

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

**Critical non-obvious patterns:**

1. **Factory function `getInputSchema()`** (not a module-level const) — lets tests override defaults without shared module state; matches the D-19 "presence-only in Phase 1, scope checks deferred" contract because the schema stays pure.
2. **`z.string().min(1, { message: ... })` for required secrets** — bare `z.string()` accepts empty strings; `.min(1)` catches empty-secret cases per SC#4.
3. **Non-secret optional inputs use `.default('')`** — CFG-01 declares them but Phase 1 doesn't consume them; default empty prevents validation failure when caller omits.
4. **`z.infer<ReturnType<typeof getInputSchema>>`** — exports the inferred type for downstream modules (ingest/heal/dispatcher).
5. **Error path names MUST appear in error strings** — rely on `issue.path.join('.')` in the dispatcher, not on Zod's default `toString()`.

**What NOT to do:**
- Do not split the schema into multiple files in Phase 1 (CONTEXT §"Claude's Discretion" allows it but KISS for Phase 1).
- Do not use Zod's `z.string().email()` / URL validators on `base-url` — D-17 says inputs are declared but not consumed in Phase 1.
- Do not inline the schema in `src/index.ts` — must be importable by Phase 2/3.

---

### `src/shared/security-contract.ts` (frozen security constants, module export)

**Analog:** RESEARCH.md §"Pattern 3" (lines 466–494).

**Reference shape:**

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

**Critical non-obvious patterns:**

1. **Header comment is part of the contract** — the two-step change protocol (trailer + snapshot) MUST be in the file as a reader-facing warning.
2. **`Object.freeze(...) as const`** — dual layering: `as const` gives TypeScript readonly narrowed literal types; `Object.freeze` provides runtime immutability. Both are required for defense-in-depth.
3. **`ALLOWED_ORIGIN_TEMPLATE` is a function, not an array** — because it depends on runtime `baseUrl`. The FUNCTION cannot be `Object.freeze`'d usefully, but the RETURNED ARRAY is frozen. That's sufficient because the immutability guarantee is on consumed values.
4. **Exact values MUST match snapshot.json** — any drift between TS and JSON causes CI failure unless the `Security-Contract-Change:` trailer is present.
5. **This file MUST NOT import anything** — constants only; any import increases attack surface and complicates the diff-lint.

**What NOT to do:**
- Do not inline these values anywhere else in `src/**` — the security-lint grep will fail (D-13).
- Do not use mutable arrays / objects.
- Do not compute values at module load (no `process.env` reads, no string concatenation of hostnames).
- Do not export a class / factory — static constants only, one function for the origin template.

---

### `.planning/security-contract.snapshot.json` (JSON mirror, declarative)

**Analog:** RESEARCH.md §"Pattern 4" (lines 496–518).

**Reference shape:**

```json
{
  "allowedOriginTemplate": ["<baseUrl>", "http://localhost:*"],
  "allowedTools": [
    "Glob",
    "Grep",
    "Read",
    "mcp__playwright__*"
  ],
  "forbiddenWorkflowTriggers": [
    "pull_request_target"
  ]
}
```

Note keys sorted alphabetically at top level per canonicalization recipe.

**Critical non-obvious patterns:**

1. **Canonicalization recipe (MANDATORY for stable CI diffs):**
   ```javascript
   JSON.stringify(obj, Object.keys(obj).sort(), 2) + '\n'
   ```
   Sorted keys, 2-space indent, trailing newline. Without this recipe, different contributors' JSON formatters produce phantom diffs.
2. **Array order for `allowedTools`** — RESEARCH Pattern 3 shows `['mcp__playwright__*', 'Read', 'Grep', 'Glob']`; the snapshot shows sorted-alphabetical form in Pattern 4. The CI check MUST normalize both sides (sort arrays before compare) OR both files MUST use the same order. **Executor decision needed in planning phase.** Safest: sort arrays in BOTH the TS contract AND the snapshot (CI check compares as-is then).
3. **`<baseUrl>` literal placeholder** — the snapshot stores the placeholder string, not a resolved URL. The CI check must compare against `ALLOWED_ORIGIN_TEMPLATE('<baseUrl>')` output (or a comparable marker) — NOT against a real runtime value.
4. **Committed exactly once in Phase 1, immutable thereafter** without the trailer.

**What NOT to do:**
- Do not format with Prettier / editor auto-format — use the explicit `JSON.stringify(..., sort, 2) + '\n'` recipe.
- Do not omit the trailing newline (POSIX convention; git diff-friendly).
- Do not store actual URLs for `ALLOWED_ORIGIN_TEMPLATE` — the placeholder `<baseUrl>` signals "parameterized."

---

### `.github/workflows/security-lint.yml` (CI lint workflow, event-driven)

**Analog:** RESEARCH.md §"Pattern 9" (trailer check, lines 635–673), §"Pattern 10" (persist-credentials, lines 675–711), §"Pattern 11" (pull_request_target grep, lines 713–732), §"Pattern 12" (phone-home static grep, lines 734–750).

**Structure:** four jobs (or four steps under one job), each implementing one D-14 check.

**Reference shape for each check:**

**Check 1 — `pull_request_target` grep (Pattern 11):**
```bash
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

**Check 2 — `persist-credentials: false` (Pattern 10):**
```bash
set -euo pipefail
FAIL=0
FILES=$(find action.yml .github/workflows -name '*.yml' -o -name '*.yaml' 2>/dev/null)
for f in $FILES; do
  MATCHES=$(yq eval -o=json '
    .. | select(tag == "!!map") | select(has("uses")) |
    select(.uses | test("^actions/checkout(@|$)")) |
    { "file": "'"$f"'", "persist": (.with."persist-credentials" // "MISSING") }
  ' "$f" 2>/dev/null || true)
  if [ -n "$MATCHES" ]; then
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

**Check 3 — security-contract trailer (Pattern 9):**
```bash
set -euo pipefail
if [ "${{ github.event_name }}" = "pull_request" ]; then
  BASE="origin/${{ github.base_ref }}"
  git fetch --no-tags origin "${{ github.base_ref }}:${BASE}"
  RANGE="${BASE}...HEAD"
else
  RANGE="HEAD~1..HEAD"
fi
CHANGED=$(git log "$RANGE" --name-only --pretty=format: \
  -- src/shared/security-contract.ts .planning/security-contract.snapshot.json \
  | grep -cv '^$' || true)
if [ "$CHANGED" -gt 0 ]; then
  TRAILER_COUNT=$(git log "$RANGE" --format='%B' \
    -- src/shared/security-contract.ts .planning/security-contract.snapshot.json \
    | grep -c '^Security-Contract-Change: reviewed-by=' || true)
  if [ "$TRAILER_COUNT" -eq 0 ]; then
    echo "::error::Security contract changed but no commit has the 'Security-Contract-Change: reviewed-by=<handle>' trailer"
    exit 1
  fi
fi
```
Plus a TS-vs-JSON diff step: read the snapshot, read/evaluate the TS constants (via `npx tsx`), diff — fail on mismatch if no trailer.

**Check 4 — SEC-07 phone-home grep (Pattern 12):**
```bash
set -euo pipefail
PATTERNS='fetch\(|http\.request\(|https\.request\(|axios|got\(|node-fetch|undici'
MATCHES=$(git grep -nE "$PATTERNS" -- 'src/**/*.ts' || true)
if [ -n "$MATCHES" ]; then
  echo "::error::SEC-07 violation: HTTP client usage found in src/ (Phase 1 allowlist is empty)"
  echo "$MATCHES"
  exit 1
fi
```

**Workflow shell skeleton:**
```yaml
name: Security Lint
on: [push, pull_request]

permissions:
  contents: read

jobs:
  security-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<pinned-sha>
        with:
          persist-credentials: false
          fetch-depth: 0        # needed for git log ranges in check 3
      # ... four steps, one per check
```

**Critical non-obvious patterns:**

1. **`fetch-depth: 0`** on the checkout step — the trailer check needs the full git history for `git log RANGE`.
2. **`|| true` after `grep -c`** — grep exits 1 on zero matches; `set -e` would kill the script. This idiom is used in Patterns 9, 11, 12.
3. **`:(exclude)` pathspec** (Pattern 11) — git-native exclusion; more reliable than post-grep filtering.
4. **`yq` (NOT `grep`) for YAML parsing** — grep false-negatives on multi-line YAML or unusual key ordering (RESEARCH "Don't Hand-Roll" row 4).
5. **`persist-credentials: false`** on THIS workflow's own checkout — the lint would otherwise fail itself (recursion amusing).
6. **Re-verify `actions/checkout` SHA** at execution time (Pitfall 6).
7. **Checkout step must use `with: persist-credentials: false`** — enforced by the check itself (dogfood).

**What NOT to do:**
- Do not use grep for YAML parsing of the persist-credentials check.
- Do not use `git log -1` for the trailer check on PR context (synthetic merge commit).
- Do not run the workflow without `fetch-depth: 0`.
- Do not add `pull_request_target` to the triggers (grep would catch it, but so would the spirit of the phase).

---

### `.github/workflows/phase1-self-test.yml` (CI self-test, event-driven)

**Analog:** RESEARCH.md §"Pattern 13: Self-Test Masking Verification — Two-Job Pattern" (lines 752–857).

**Structure:** four jobs. `self-test-masking` (Job A) runs the action with the canary; `verify-log-mask` (Job B, `needs: A`, `if: always()`) fetches Job A's log via `gh api` after it exits and asserts the canary is absent. `self-test-invalid-mode` (Job C) asserts `mode: banana` fails. `self-test-missing-api-key` (Job D) asserts empty API key fails.

**Reference shape** — see RESEARCH Pattern 13 lines 758–853 verbatim. Key shell snippet for Job B:

```yaml
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
```

**Critical non-obvious patterns:**

1. **TWO-JOB pattern is mandatory (Pitfall 9).** A post-step in the same job cannot reliably grep its own log — the log API returns incomplete data until the job exits. `needs:` + `if: always()` is the only reliable way.
2. **Canary is INLINE literal, NOT `secrets.*`** (Pitfall 8) — `anthropic-api-key: 'test-canary-DO-NOT-USE-REAL-KEY'`. A fresh fork has no such secret; storing as `secrets.*` silently breaks every contributor's first push.
3. **`continue-on-error: true` + `steps.run.outcome == 'failure'`** pattern (Pattern 13 lines 816–853) for assert-fail tests — otherwise the failing action aborts the whole job.
4. **`permissions: actions: read`** (line 763) — required for `gh api` to call `actions/jobs/<id>/logs`.
5. **Job name MUST match the `--jq 'select(.name==…)'` selector exactly**, including en-dash (`—`) if used. Copy verbatim or simplify both sides.
6. **`persist-credentials: false`** on every `actions/checkout` step in this workflow (SEC-01 + D-14 check 2 dogfood).
7. **`uses: ./`** — local action reference; implicitly uses the checked-out repo's `action.yml`. No separate `@ref` needed.
8. **`healer-token: 'test-canary-healer-token'`** — same canary principle; any non-empty string passes the presence check but names itself as a test value.

**What NOT to do:**
- Do not store the canary as a repo secret (Pitfall 8).
- Do not grep the log from within the same job as the run (Pitfall 9).
- Do not use `pull_request_target` as a trigger.
- Do not skip `persist-credentials: false` on the checkout steps (SEC-01 + security-lint will catch it).
- Do not attempt to capture the action's stdout to an output variable from a `uses:` step — it's not natively supported; use the two-job log-grep pattern or a `run:` invocation of `src/index.ts` directly (planner's choice per RESEARCH line 857).

---

## Shared Patterns

Cross-cutting conventions that apply to multiple files.

### Shared Pattern A: `persist-credentials: false` on every checkout

**Source:** RESEARCH Pattern 10 + CLAUDE.md §"Security non-negotiables."
**Apply to:** `phase1-self-test.yml` (3 checkout steps: self-test-masking, self-test-invalid-mode, self-test-missing-api-key), `security-lint.yml` (1 checkout step). Not applied in `action.yml` because it has no `actions/checkout` usage (consumer's workflow checks out their repo; `uses: ./` doesn't require it).

```yaml
- uses: actions/checkout@<pinned-sha>
  with:
    persist-credentials: false
    fetch-depth: 0   # add on security-lint.yml for git log RANGE operations
```

### Shared Pattern B: Commit SHA pinning for third-party actions

**Source:** D-20 + RESEARCH.md Standard Stack §"GitHub Action Dependencies" + Pitfall 6.
**Apply to:** `actions/checkout` and `actions/setup-node` in every workflow file AND `action.yml`.

```yaml
- uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e    # v6.4.0 — re-verify at execution
  with:
    node-version: '24'
```

**Verification commands (run in planning / execution):**
```bash
gh api repos/actions/setup-node/git/refs/tags/v6.4.0 --jq .object.sha
gh api repos/actions/checkout/tags --jq '.[0].name, .[0].commit.sha'
```

### Shared Pattern C: No `pull_request_target` triggers

**Source:** SEC-02 + D-14 check 1 + Pitfall 3.
**Apply to:** Every workflow file in `.github/workflows/*.yml`.

Triggers must be `on: [push, pull_request]` or `on: workflow_dispatch` (Phase 2+). Never `pull_request_target`. The security-lint grep enforces this.

### Shared Pattern D: Import security constants, never inline

**Source:** D-13 + RESEARCH.md §Pattern 3 header comment.
**Apply to:** Any Phase 2+ file that would reference `allowedTools`, `allowed origins`, or forbidden triggers. In Phase 1, only `security-contract.ts` contains these literals; Phase 2/3 code MUST import — `const tools = ALLOWED_TOOLS` (not `const tools = ['mcp__playwright__*', ...]`).

Enforced by a grep in `security-lint.yml` (D-13) — Phase 1 CI should fail if any `src/**` file except `security-contract.ts` contains the literal string `'mcp__playwright__*'` or the tuple pattern.

### Shared Pattern E: No HTTP clients in `src/**`

**Source:** SEC-07 + D-16a + RESEARCH Pattern 12.
**Apply to:** Every file in `src/**` in Phase 1.

Forbidden patterns (grep-matched): `fetch(`, `http.request(`, `https.request(`, `axios`, `got(`, `node-fetch`, `undici`. Phase 1 allowlist is EMPTY. If any Phase 1 file surfaces one of these patterns, planner must reject — the grep will fire on CI.

Note: `import` statements do NOT match the grep; Phase 2/3 can import `@actions/github` / the Agent SDK without tripping the check. The grep specifically matches call-site usages.

### Shared Pattern F: `startup ordering before any log line`

**Source:** D-07 + RESEARCH Pattern 2.
**Apply to:** `src/index.ts` and any Phase 2/3 entry points.

Order: `getInput` secrets → `setSecret` all three → `getInput` everything else → validate → dispatch. No `core.info`, `console.log`, or `throw` with input values before `setSecret`.

### Shared Pattern G: `||  true` after `grep -c` / `grep -l` in shell

**Source:** RESEARCH Pattern 9 line 673 + Pattern 11 + Pattern 12.
**Apply to:** Every shell-script step in both workflows that uses `grep` under `set -euo pipefail`.

grep exits 1 when no matches → `set -e` kills the script. `|| true` neutralizes the exit code while preserving the stdout for downstream logic.

### Shared Pattern H: Canonical JSON formatter recipe

**Source:** RESEARCH Pattern 4 + "Don't Hand-Roll" row 7.
**Apply to:** Any JSON file the CI diffs (i.e., `security-contract.snapshot.json`).

```javascript
JSON.stringify(obj, Object.keys(obj).sort(), 2) + '\n'
```

Sorted keys, 2-space indent, trailing newline. Prevents phantom diffs from editor auto-formatters.

---

## No Analog Found

All 11 files have external canonical analogs in RESEARCH.md §"Architecture Patterns" (Patterns 1–13). None require a fallback to "no analog." The single generated file (`package-lock.json`) is produced mechanically by `npm install` and does not require a template.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| *(none — all files mapped to a RESEARCH pattern)* | | | |

---

## Cross-cuts to Phase 1 Success Criteria

For planner convenience — which pattern satisfies which ROADMAP §Phase 1 success criterion:

| SC# | Success Criterion | Patterns to Apply |
|-----|-------------------|-------------------|
| SC#1 | `cat action.yml` shows `runs.using: composite` + `npm ci --production` as first step | `action.yml` pattern; anti-pattern "no collapsing steps" |
| SC#2 | No `pull_request_target` anywhere; every `actions/checkout` has `persist-credentials: false` | Shared Patterns A + C; security-lint checks 1 + 2 |
| SC#3 | Self-test masking verified (canary absent from log) | Pattern 13 two-job pattern in `phase1-self-test.yml` |
| SC#4 | Invalid `mode` exits 1 with Zod error naming field | Pattern 5 schema + Pattern 2 error-formatting + `phase1-self-test.yml` Job C |

---

## Metadata

**Analog search scope:** `/Users/sacha/dev/playwright-healer/` root (`ls` confirms only `.planning/`, `.git/`, `CLAUDE.md`). No `src/`, no `.github/workflows/`, no `package.json`. Greenfield confirmed.
**Files scanned:** 2 source-of-truth docs (CONTEXT.md + RESEARCH.md), ~1,400 lines combined.
**In-repo analogs found:** 0 (expected; greenfield).
**External canonical analogs used:** `anthropics/claude-code-action` (composite shape), GitHub Actions docs (composite `env:`), Zod 4.x docs (`z.enum` + `safeParse`), `@actions/core` docs (`getInput`/`setSecret`/`summary`), `tsx` docs, `yq` docs.
**Pattern extraction date:** 2026-04-24.

## PATTERN MAPPING COMPLETE

**Phase:** 1 - Security Scaffold + Composite Packaging
**Files classified:** 11 new files (action.yml, package.json, package-lock.json, tsconfig.json, 5 src/ TS files, snapshot JSON, 2 workflow YAMLs)
**Analogs found:** 11 external canonical / 11 — greenfield repo has no in-repo analogs (documented explicitly)

### Coverage
- Files with exact external analog (RESEARCH Pattern): 10
- Files mechanically generated (no template): 1 (`package-lock.json`)
- Files with no analog: 0

### Key Patterns Identified
- Pattern 1 `action.yml` — composite with explicit `env:` block; install before run; SHA-pinned setup-node; no `ncc`/`dist`. The `env:` block is load-bearing and the single most common composite-action mistake (Pitfall 1).
- Pattern 2 `src/index.ts` — D-07 startup order: register secrets with `setSecret` BEFORE any log line, then validate with Zod, then dispatch via dynamic import. Use `setFailed` not `process.exit`.
- Pattern 3 `security-contract.ts` — `Object.freeze` + `as const` dual-layer immutability; header comment documents the trailer + snapshot protocol; Phase 2/3 MUST import (no inline literals).
- Pattern 4 snapshot JSON — canonical formatter `JSON.stringify(obj, Object.keys(obj).sort(), 2) + '\n'` for stable CI diffs.
- Pattern 13 self-test two-job log-grep — a post-step cannot reliably grep its own job's log; requires `needs:` + `if: always()` across two jobs. Canary is inline literal, never `secrets.*`.
- Shared cross-cuts: `persist-credentials: false` on every checkout; SHA-pin all third-party actions; no `pull_request_target`; no HTTP clients in `src/`; `|| true` after `grep -c` under `set -euo pipefail`.

### File Created
`/Users/sacha/dev/playwright-healer/.planning/phases/01-security-scaffold-composite-packaging/01-PATTERNS.md`

### Ready for Planning
Pattern mapping complete. Planner can now reference RESEARCH Patterns 1–13 (via this file's per-file mapping) in PLAN.md files. The shared patterns (A–H) apply across all workflow + TS files and should be flagged in each plan's cross-cutting section.
