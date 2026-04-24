# Stack Research

**Domain:** Reusable GitHub Action — Claude Agent SDK + Playwright MCP + GitHub API
**Researched:** 2026-04-24
**Confidence:** HIGH (versions verified against npm registry and official docs)

---

## Critical Architecture Decision: Composite Action, Not Bundled JS Action

**PROJECT.md states "bundled via ncc into dist/index.js". This recommendation overrides that decision.**

The `@anthropic-ai/claude-agent-sdk` cannot be bundled with ncc, esbuild, or any standard bundler due to how it discovers its native Claude Code binary. Since v0.2.113 the SDK spawns a **platform-specific native Claude Code binary** (via optional dependencies like `@anthropic-ai/claude-agent-sdk-linux-x64`) rather than bundled JS. The SDK locates this binary via `import.meta.url`-based path resolution at runtime. When bundled, this resolution points into a virtual filesystem path where the binary does not exist. The official Anthropic `claude-code-action` confirms this: it is a **composite action** that installs Bun, runs `bun install --production`, and executes TypeScript source directly — no bundling.

**Package as a composite action.** Rationale:
- Matches Anthropic's own production pattern for `claude-code-action`
- Avoids ncc/esbuild path-resolution failure with native binaries  
- Node 24 migration (forced June 2, 2026) further destabilises the ncc path: vercel/ncc issue #1297 was **closed as not planned** for Node 24 support
- Composite actions can run `npm ci` once per job with caching; cold-start cost is acceptable

The composite approach means the action's `action.yml` runs shell steps, not a single `main: dist/index.js`. Each logical concern (stats collector, threshold detector, healer agent) can be a separate step in the composite action, sharing the installed node_modules.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| **@anthropic-ai/claude-agent-sdk** | 0.2.119 | Agent loop: tool use, MCP orchestration, session management | Official Anthropic SDK; the only TypeScript SDK with native MCP connection support, session resumption, hooks, and budget caps; powers `claude-code-action` in production. Requires `node >=18.0.0`. |
| **@playwright/mcp** | 0.0.70 | Browser automation tools for the agent (navigate, click, snapshot, trace) | First-party Microsoft Playwright MCP; exact same tool surface Claude Code uses for browser tasks; maintained in sync with `@playwright/test` releases. Do not use third-party alternatives. |
| **@actions/core** | 3.0.1 | Read action inputs, set outputs, mask secrets, emit annotations | Official GitHub Actions toolkit; handles `getInput`, `setFailed`, `exportVariable`, secret masking — required for any GitHub Action. |
| **@actions/github** | 9.1.1 | Pre-configured Octokit client scoped to the running workflow | `getOctokit(token)` returns an authenticated REST client with repo/issue/PR context pre-loaded; simpler than instantiating Octokit directly for `GITHUB_TOKEN` path. |
| **@actions/exec** | 3.0.0 | Spawn Playwright test re-runs, capture exit code and stdout | Provides `exec()` and `getExecOutput()` — captures stdout/stderr to string without intermediate files, handles Windows/Unix command quoting; needed to programmatically run `npx playwright test --grep`. |
| **@octokit/rest** | 22.0.1 | Full REST client for PAT-authenticated operations | Needed when a PAT is provided (e.g. to dispatch workflow from a workflow, or write to `.github/workflows/`); `@actions/github` auto-reads `GITHUB_TOKEN` only. Use `@octokit/rest` with explicit `auth: token` for the optional PAT input path. |
| **@playwright/test** | 1.59.1 | Parse JSON reports; provide `TestResult` TypeScript types | The consuming repo already has this installed; playwright-healer imports `@playwright/test/reporter` types for type-safe report parsing. Pin to same major version family as consuming repo's Playwright. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| **@actions/glob** | 0.7.0 | Find report JSON files by pattern | Action input accepts a glob for report paths (e.g. `test-results/*.json`); use instead of manual `fs.readdir` |
| **zod** | 3.25.x or 4.x | Validate Playwright JSON report schema at runtime | Report schema is undocumented — validate before trusting; catches schema drift between Playwright versions. `@anthropic-ai/sdk` peer-requires `zod ^3.25.0 || ^4.0.0`. |
| **@modelcontextprotocol/sdk** | 1.29.0 | MCP protocol types (auto-installed by claude-agent-sdk) | Transitive dep; do not manage directly, but useful for type imports when writing SDK-mode MCP servers. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| **TypeScript** | 5.x | Type checking across action source | `strict: true`; target `ES2022`; use `moduleResolution: bundler` (or `node16`) for compatibility with both ESM and CJS deps |
| **Vitest** | 4.1.5 | Unit and integration tests | Preferred over Jest in 2026: native ESM, faster HMR, compatible with the mixed CJS/ESM environment of this action. Run with `--pool=forks` for action integration tests. |
| **nektos/act** | latest | Local GitHub Actions execution | Validates composite action steps and `action.yml` inputs/outputs before push; run `act -j healer` for end-to-end local testing |
| **Bun** | 1.x (optional) | Package manager + TS runner (matches `claude-code-action` pattern) | Optional: action can run with Node + npm, but Bun is faster for `bun install` in composite steps and removes the need for a separate TypeScript compilation step in CI. Choose one; don't mix. |

---

## Installation

```bash
# Action runtime dependencies
npm install @anthropic-ai/claude-agent-sdk @playwright/mcp \
  @actions/core @actions/github @actions/exec @actions/glob \
  @octokit/rest @playwright/test zod

# Dev dependencies
npm install -D typescript vitest @types/node

# In consuming workflow (not the action package itself):
# npx playwright install chromium --with-deps
```

### Required Step in `action.yml` Composite Steps

```yaml
steps:
  - name: Install action dependencies
    run: npm ci --production
    working-directory: ${{ github.action_path }}
```

Browser binaries are NOT shipped with `@playwright/mcp` — the consuming workflow must install Playwright:

```yaml
  - name: Install Playwright Chromium
    run: npx playwright install chromium --with-deps
```

---

## Model Recommendations

**Default: `claude-sonnet-4-6`**
- Best cost/quality balance for the diagnostic + patch loop
- Sufficient reasoning depth for selector analysis, timing issue detection, assertion review
- Keeps per-run cost well under the $1 target on defaults
- Specify as: `options: { model: "claude-sonnet-4-6" }`

**Escalation (opt-in via action input): `claude-opus-4-7`**
- Use when Sonnet fails validation re-runs N consecutive times
- More powerful for deeply nested async timing bugs
- **Requires SDK ≥ v0.2.111** (from changelog — older versions error on `thinking.type.enabled`)
- Specify as: `options: { model: "claude-opus-4-7" }`

**Not recommended: `claude-haiku-4-5`**
- Insufficient reasoning depth for root-cause analysis of Playwright failures
- Acceptable only for a classification-only pre-check step (classify failure type before routing to healer), not for the healing loop itself

---

## Key Integration Patterns

### Claude Agent SDK — MCP Wiring (Playwright)

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: systemPrompt,
  options: {
    model: "claude-sonnet-4-6",
    maxTurns: 20,           // Bound the loop
    maxBudgetUsd: 0.50,     // Hard cost cap per healing run
    permissionMode: "bypassPermissions",  // Non-interactive CI env
    allowDangerouslySkipPermissions: true,
    allowedTools: ["Read", "Edit", "Bash"],
    mcpServers: {
      playwright: {
        command: "npx",
        args: ["@playwright/mcp@0.0.70", "--headless"],  // Pin version; headless for CI
        env: { DISPLAY: "" }
      }
    },
    env: {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY!
    }
  }
})) {
  // handle SDKMessage stream
}
```

Key options:
- `maxBudgetUsd`: Hard cap in USD; SDK enforces this before exceeding cost. Essential for cost control in CI.
- `maxTurns`: Prevents runaway loops when agent cannot converge on a fix.
- `permissionMode: "bypassPermissions"`: Required for non-interactive CI — no approval prompts.
- `allowDangerouslySkipPermissions: true`: Required alongside `bypassPermissions`.

### GitHub API — Token Architecture

```typescript
import * as github from "@actions/github";
import { Octokit } from "@octokit/rest";

// GITHUB_TOKEN path (most consumers)
const octokit = github.getOctokit(core.getInput("github-token"));

// PAT path (when workflow_dispatch or workflow file writes are needed)
const pat = core.getInput("healer-token");
const privilegedOctokit = pat
  ? new Octokit({ auth: pat })
  : octokit; // fallback; warn that dispatch may not trigger downstream CI
```

**Minimum token scopes:**
- `contents: write` — push to `playwright-healer-state` branch, write fix commits
- `pull-requests: write` — open PRs
- `issues: write` — open structured issues
- `actions: write` — `workflow_dispatch` to trigger healer workflow

**Known `GITHUB_TOKEN` limitations (document in action README):**
1. Cannot modify files under `.github/workflows/` — if a healing fix ever touches a workflow file, it will fail. The healer should skip files matching `.github/workflows/**` in its allowed edit scope.
2. Workflows triggered via `workflow_dispatch` **by `GITHUB_TOKEN` do not themselves trigger downstream workflows** (PRs opened this way won't auto-run CI). Consumers who care about this must supply a PAT or GitHub App token via the `healer-token` input.

### Playwright Test Re-Run

```typescript
import * as exec from "@actions/exec";

async function rerunTest(testFile: string, grepPattern: string, repeatEach: number): Promise<{ passed: number; total: number }> {
  const { exitCode, stdout } = await exec.getExecOutput(
    "npx",
    [
      "playwright", "test",
      testFile,
      `--grep=${grepPattern}`,
      `--repeat-each=${repeatEach}`,
      "--reporter=json",
      `--output=${tmpReportPath}`
    ],
    { ignoreReturnCode: true }
  );
  // Parse tmpReportPath JSON for pass/fail counts
  const report: JSONReport = JSON.parse(fs.readFileSync(tmpReportPath, "utf8"));
  return countResults(report);
}
```

### Playwright JSON Report Parsing

The JSON reporter produces an object with this shape (from `@playwright/test/reporter` internal types):

```typescript
interface JSONReport {
  config: { rootDir: string; projects: Array<{ name: string; id: string }> };
  suites: JSONReportSuite[];
  errors: TestError[];
  stats: {
    startTime: string; // ISO 8601
    duration: number;  // ms
    expected: number; skipped: number; unexpected: number; flaky: number;
  };
}

interface JSONReportSuite {
  title: string;
  file: string;
  line: number;
  column: number;
  specs: JSONReportSpec[];
  suites?: JSONReportSuite[];  // nested describes
}

interface JSONReportSpec {
  title: string;
  ok: boolean;
  tags: string[];
  tests: JSONReportTest[];
  id: string;
  file: string; line: number; column: number;
}

interface JSONReportTest {
  timeout: number;
  annotations: Array<{ type: string; description?: string }>;
  expectedStatus: "passed" | "failed" | "skipped" | "timedOut";
  projectId: string;
  projectName: string;
  results: JSONReportTestResult[];
  status: "expected" | "unexpected" | "flaky" | "skipped";
}

interface JSONReportTestResult {
  workerIndex: number;
  parallelIndex: number;
  status: "passed" | "failed" | "timedOut" | "skipped" | "interrupted";
  duration: number;    // ms
  error?: TestError;
  errors: TestError[];
  stdout: Array<{ text?: string; buffer?: string }>;
  stderr: Array<{ text?: string; buffer?: string }>;
  retry: number;       // 0 = first run, 1 = first retry, etc.
  startTime: string;   // ISO 8601
  attachments: Array<{
    name: string;      // "trace", "screenshot", "video", etc.
    contentType: string;
    path?: string;
    body?: string;     // base64 for inline content
  }>;
  steps: JSONReportTestStep[];
}
```

No official published TypeScript schema exists. Import `@playwright/test/reporter` types or define the above locally and validate with Zod at runtime to catch schema drift between Playwright major versions.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Composite action (composite `runs.using`) | Pure JS action (`runs.using: node24`) | If claude-agent-sdk ever supports a pure-JS mode without native binary dependency; not today |
| Rollup or esbuild (if bundling ever needed) | `@vercel/ncc` | Never for Node 24: ncc issue #1297 closed as won't fix for Node 24 support |
| `@anthropic-ai/claude-agent-sdk` | `@anthropic-ai/sdk` (client SDK) | Use the client SDK only if you want to implement the tool loop manually; Agent SDK handles this automatically and is the correct choice for this use case |
| `@playwright/mcp` (Microsoft first-party) | `executeautomation/mcp-playwright` | Third-party Playwright MCP; different tool names, diverges from first-party; avoid |
| Vitest | Jest | Jest is the official template default but Vitest is faster, better ESM support, and is the 2026 community default for new TS projects |
| `@octokit/rest` for PAT path | `@octokit/action` | `@octokit/action` auto-reads token from workflow env; less flexible for dual-token design |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@vercel/ncc` | Issue #1297 closed as "not planned" for Node 24; GitHub forces node24 runtime June 2, 2026; claude-agent-sdk native binary breaks path resolution in bundlers | Composite action with `npm ci --production` at runtime (matches Anthropic's own pattern) |
| `Python Agent SDK` | PROJECT.md constraint: Python runtime requires Docker; loses the fast cold-start of JS actions | `@anthropic-ai/claude-agent-sdk` (TypeScript) |
| `cloudflare/playwright-mcp` | Cloudflare fork; designed for Cloudflare Browser Rendering workers, not standard runner environments | `@playwright/mcp` (Microsoft first-party) |
| `executeautomation/mcp-playwright` | Third-party community MCP; different tool naming, no guarantee of parity with Playwright releases | `@playwright/mcp` (Microsoft first-party) |
| Docker action packaging | Slower cold start (~30–60s image pull), more complex versioning, unnecessary given composite works | Composite action with shell steps |
| Claude 3.x models (Haiku, Sonnet, Opus) | Retired naming scheme; do not use `claude-3-*` model strings | `claude-sonnet-4-6` (default), `claude-opus-4-7` (escalation) |
| Direct `@anthropic-ai/sdk` `messages.create()` for agent loop | Requires implementing the entire tool-use loop manually; the Agent SDK already does this | `query()` from `@anthropic-ai/claude-agent-sdk` |

---

## Stack Patterns by Variant

**Stats collection step (runs in main workflow, not healer):**
- Use `@actions/exec` to read the JSON report path from input
- No Claude SDK needed
- Use `@actions/github` to push state JSON to dedicated branch via Octokit tree API
- Model: none

**Healer agent step (runs in dispatched companion workflow):**
- Use `@anthropic-ai/claude-agent-sdk` query() with `mcpServers: { playwright: ... }`
- `maxBudgetUsd: 0.50` default, exposed as action input
- `maxTurns: 20` default, exposed as action input
- `model: "claude-sonnet-4-6"` default; override via `healer-model` input

**Fix validation step:**
- Use `@actions/exec` to run `npx playwright test --grep=... --repeat-each=N --reporter=json`
- Parse JSON output with the schema above
- Require ≥80% pass rate (configurable) before opening PR

**PR/issue creation:**
- `@actions/github` `getOctokit()` for GITHUB_TOKEN operations
- `@octokit/rest` for PAT operations (e.g., `workflow_dispatch`)
- Use `octokit.rest.pulls.create()` and `octokit.rest.issues.create()` directly — no plugin needed

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@anthropic-ai/claude-agent-sdk@0.2.119` | `node >=18.0.0` | Requires `>=18`; tested on 20 and 22; node24 viable since SDK doesn't bundle but spawns binary |
| `claude-opus-4-7` model | `@anthropic-ai/claude-agent-sdk >=0.2.111` | Older SDK versions error on `thinking.type.enabled`; use 0.2.119 |
| `@playwright/mcp@0.0.70` | `playwright 1.60.0-alpha` | MCP pins alpha playwright internally; this is expected, not a mistake — the MCP and Playwright release together |
| `@actions/core@3.0.1` | All GitHub Actions runners | Node 20 and Node 24 runners both supported |
| `@octokit/rest@22.0.1` | `node >=18` | Pure ESM; works in both Node 20 and 24 |
| Composite action `runs.using: composite` | All GitHub-hosted runners | Not affected by Node runtime deprecations — each step uses whatever runtime it specifies |

---

## action.yml Structure (Composite)

```yaml
name: 'playwright-healer'
description: 'Detects and auto-heals flaky/slow Playwright tests via Claude Agent'
author: 'your-org'

inputs:
  report-path:
    description: 'Glob for Playwright JSON report(s)'
    required: true
  anthropic-api-key:
    description: 'Anthropic API key'
    required: true
  github-token:
    description: 'GitHub token (contents, pull-requests, issues, actions write)'
    required: false
    default: ${{ github.token }}
  healer-token:
    description: 'Optional PAT for cross-workflow dispatch and workflow file writes'
    required: false
  healer-model:
    description: 'Claude model for healing loop'
    required: false
    default: 'claude-sonnet-4-6'
  max-budget-usd:
    description: 'Max USD per healing run'
    required: false
    default: '0.50'
  flake-threshold:
    description: 'Flake rate % to trigger healing'
    required: false
    default: '20'

runs:
  using: composite
  steps:
    - name: Install action dependencies
      shell: bash
      run: npm ci --production
      working-directory: ${{ github.action_path }}
    
    - name: Install Playwright Chromium
      shell: bash
      run: npx playwright install chromium --with-deps
    
    - name: Run playwright-healer
      shell: bash
      run: node ${{ github.action_path }}/src/index.js
      env:
        ANTHROPIC_API_KEY: ${{ inputs.anthropic-api-key }}
        GITHUB_TOKEN: ${{ inputs.github-token }}
        HEALER_TOKEN: ${{ inputs.healer-token }}
        REPORT_PATH: ${{ inputs.report-path }}
        HEALER_MODEL: ${{ inputs.healer-model }}
        MAX_BUDGET_USD: ${{ inputs.max-budget-usd }}
        FLAKE_THRESHOLD: ${{ inputs.flake-threshold }}
```

Note: No `main:` field — composite actions use `steps`. Each shell step can reference scripts built with TypeScript compiled to JS (via `tsc` or `esbuild`, output to `src/*.js` or `dist/*.js`). The TypeScript compilation happens at build time and the output is committed; only `node_modules` is installed at runtime via `npm ci`.

---

## Open Question: Native Binary on GitHub-Hosted Runners

**Status: UNVERIFIED — Phase 1 smoke test required.**

The SDK's native binary is installed as an optional dependency (`@anthropic-ai/claude-agent-sdk-linux-x64` etc.). When `npm ci --production` runs in the composite action step, npm will install the correct platform-specific optional dependency for the runner OS (linux-x64 on `ubuntu-latest`). This should work without `pathToClaudeCodeExecutable`.

**Verify in Phase 1 scaffolding:** Run a minimal query() call in a test composite action on `ubuntu-latest` without `pathToClaudeCodeExecutable`. If the native binary isn't found, set:
```typescript
options: {
  pathToClaudeCodeExecutable: path.join(
    process.env.GITHUB_ACTION_PATH!,
    "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude"
  )
}
```

---

## Sources

- `npm view @anthropic-ai/claude-agent-sdk` — version 0.2.119, engines `node >=18.0.0`
- `npm view @playwright/mcp` — version 0.0.70, deps `playwright 1.60.0-alpha`
- `npm view @actions/core @actions/github @actions/exec` — versions 3.0.1, 9.1.1, 3.0.0
- `npm view @octokit/rest` — version 22.0.1
- [Agent SDK Overview](https://code.claude.com/docs/en/agent-sdk/overview) — query() API, MCP wiring, model options, Node 18+ requirement; HIGH confidence
- [Agent SDK TypeScript Reference](https://code.claude.com/docs/en/agent-sdk/typescript) — full Options interface including `maxBudgetUsd`, `permissionMode`, `mcpServers`; HIGH confidence
- [claude-code-action action.yml](https://github.com/anthropics/claude-code-action/blob/main/action.yml) — composite action pattern confirmed, Bun install, no bundling; HIGH confidence
- [claude-agent-sdk-typescript issue #150](https://github.com/anthropics/claude-agent-sdk-typescript/issues/150) — bundling breaks native binary path resolution; HIGH confidence
- [vercel/ncc issue #1297](https://github.com/vercel/ncc/issues/1297) — closed as not planned for Node 24; HIGH confidence
- [GitHub Actions Node 20 deprecation](https://github.blog/changelog/2025-09-19-deprecation-of-node-20-on-github-actions-runners/) — node24 forced June 2, 2026; HIGH confidence
- [playwright-mcp GitHub README](https://github.com/microsoft/playwright-mcp) — full tool list, stdio/HTTP modes, `--headless` flag; HIGH confidence
- [Playwright TestResult API](https://playwright.dev/docs/api/class-testresult) — attachments, duration, errors, retry, status fields; HIGH confidence
- [GitHub Actions typescript-action template](https://github.com/actions/typescript-action) — Rollup + Jest (official template uses Rollup, not ncc); MEDIUM confidence (Rollup, not the recommended choice here since we're composite)

---

*Stack research for: playwright-healer GitHub Action*
*Researched: 2026-04-24*
