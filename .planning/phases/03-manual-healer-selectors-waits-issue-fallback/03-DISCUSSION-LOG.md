# Phase 3: Manual Healer (Selectors + Waits + Issue Fallback) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-26
**Phase:** 03-manual-healer-selectors-waits-issue-fallback
**Areas discussed:** Provider adapter scope, Agent system prompt architecture, Failure routing decision tree, Fix-applier execution model

---

## Gray-Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Provider adapter scope | Which adapter(s) ship working in P3 — Gemini-only, Gemini+Anthropic, all three, or Anthropic-only | ✓ |
| Agent system prompt architecture | Monolithic vs layered; trace-aware/trace-free variants; per-fix-class scoping | ✓ |
| Failure routing decision tree | When to file PR vs issue across six failure conditions; cleanup mechanics | ✓ |
| Fix-applier execution model | Single Node process vs multi-step composite; app-supervisor mechanics; diff-lint placement | ✓ |

**User selection:** All four areas discussed.

---

## Provider Adapter Scope

### Q1: Which adapter(s) ship in P3?

| Option | Description | Selected |
|--------|-------------|----------|
| Gemini-only (P3) → others later (Recommended) | Phase 3 ships ONLY Gemini adapter. Anthropic + Ollama stubs throw 'not implemented'. | ✓ |
| Gemini + Anthropic (P3) → Ollama later | Two adapters; Ollama stub. | |
| All three in P3 | Full multi-provider including Ollama MCP bridge. | |
| Anthropic-only (P3) → multi-provider later | Treat Phase 1.1 as input-surface-only. | |

**User's choice:** Gemini-only (P3) → others later.
**Notes:** Aligns with CLAUDE.md "Gemini-first" guidance; smallest blast radius; validates adapter contract before duplicating across providers.

### Q2: How is the per-provider adapter contract structured?

| Option | Description | Selected |
|--------|-------------|----------|
| Thin interface (Recommended) | Small `Adapter` interface with `runAgent(...)`; per-provider impls under `src/healer/adapters/`. | ✓ |
| Provider-aware healer with switch | Healer/index.ts switches on provider; couples downstream pipeline to provider details. | |
| Plugin-style with dynamic import | Adapters dynamically imported by name. | |

**User's choice:** Thin interface.
**Notes:** Keeps `src/healer/index.ts` provider-agnostic; matches Phase 1's clean separation patterns.

---

## Agent System Prompt Architecture

### Q1: How is the system prompt structured?

| Option | Description | Selected |
|--------|-------------|----------|
| Layered prompt (Recommended) | 4 sections: role+guardrails / fix-class instructions / output format / termination rules. | ✓ |
| Single monolithic prompt | One big inline prompt. | |
| Layered + dynamic per fix class | Fully separate prompts per class chosen at runtime. | |

**User's choice:** Layered prompt.
**Notes:** Auditability per section; mitigates PITFALLS recovery-table warning about monolithic prompts.

### Q2: Trace-aware vs trace-free variants (HEA-05)?

| Option | Description | Selected |
|--------|-------------|----------|
| Two variants of the layered prompt (Recommended) | Two versions of fix-class section only; other sections shared. | ✓ |
| Single prompt with conditional content | One prompt with placeholder. | |
| Fully separate prompt files | Two complete prompt files. | |

**User's choice:** Two variants of the layered prompt.
**Notes:** Selection happens at prompt-assembly time based on `traceAttachmentPath !== null`.

### Q3: How does `fixClassHint` interact with the agent prompt?

| Option | Description | Selected |
|--------|-------------|----------|
| Hint guides one class at a time (Recommended) | Prompt assembled with ONLY hinted class; no drift. | ✓ |
| Hint is advisory; agent decides | Both classes in prompt; agent picks. | |
| No hint — agent diagnoses class first | Two-pass: classify, then fix. Higher token cost. | |

**User's choice:** Hint guides one class at a time.
**Notes:** Tight scope, predictable behavior. If agent can't fix in hinted class → no-fix-proposable → issue fallback.

---

## Failure Routing Decision Tree

### Q1: Default route for non-PR exits?

| Option | Description | Selected |
|--------|-------------|----------|
| Always issue, never silent (Recommended) | Every non-PR exit produces a structured issue. | ✓ |
| Issue only for unhealable; silent for infra failures | Skip issue for app-startup-timeout, budget exhausted. | |
| Always issue + step summary | Always issue + detailed step summary for every run. | |

**User's choice:** Always issue, never silent.
**Notes:** PROJECT.md core value is "no human reading logs" — silent failure is the worst-trust outcome. Step summary parity captured separately as D-11.

### Q2: How to distinguish failure modes in issues?

| Option | Description | Selected |
|--------|-------------|----------|
| Single title format + body section (Recommended) | PRI-03 title format + body `## Failure mode` section with one of six tokens. | ✓ |
| Per-mode title prefix | Different title per mode. | |
| Single title + GitHub labels | Auto-applied labels per mode. | |

**User's choice:** Single title format + body section.
**Notes:** Title stability allows PRI-04 dedup (Phase 4) to match against existing issues by test ID.

### Q3: Process cleanup on every exit path (HEA-06)?

| Option | Description | Selected |
|--------|-------------|----------|
| try/finally in TS + post composite step (Recommended) | Defense-in-depth: graceful TS shutdown + pkill safety net. | ✓ |
| TS try/finally only | In-process only; risk of leaks on Node crash. | |
| Post composite step only | Aggressive pkill; no graceful path. | |

**User's choice:** try/finally in TS + post composite step.
**Notes:** PID file at `/tmp/playwright-healer-app-pid` enables precise pkill targeting without false positives.

---

## Fix-Applier Execution Model

### Q1: How is the heal pipeline structured across composite steps?

| Option | Description | Selected |
|--------|-------------|----------|
| Single Node process (Recommended) | One step runs `tsx src/index.ts`; entire pipeline in TS. | ✓ |
| Multi-step composite (split by stage) | Separate steps for agent / apply / validate / PR. | |
| Hybrid: agent step + finalize step | Two TS steps with disk-handoff diff. | |

**User's choice:** Single Node process.
**Notes:** Exception: app-supervisor `start-command` runs as a SEPARATE composite step BEFORE heal step (composite steps can't share background process lifecycles).

### Q2: How does app-supervisor verify readiness (HEA-02)?

| Option | Description | Selected |
|--------|-------------|----------|
| Background spawn + HTTP polling (Recommended) | Pre-step spawns start-command in bg, polls base-url every 1s, accepts status < 500. | ✓ |
| Inline (inside heal step) | spawn inside Node; risk of process leak on Node exit. | |
| Sidecar service container | Docker `services:`; doesn't fit "point at start-command" contract. | |

**User's choice:** Background spawn + HTTP polling.
**Notes:** PID written to `/tmp/playwright-healer-app-pid` for cleanup. 1s cadence, 120s default ceiling, status < 500 (handles redirects/auth).

### Q3: Where does diff-lint (FIX-06) live?

| Option | Description | Selected |
|--------|-------------|----------|
| Inside heal step, before validator (Recommended) | Pure TS in `src/healer/diff-lint.ts`; if blocked, skip validator → issue. | ✓ |
| Separate composite step | Standalone grep-step. | |
| Both (TS + redundant CI grep) | Belt-and-suspenders. | |

**User's choice:** Inside heal step, before validator.
**Notes:** Forbidden patterns sourced from a single TS constant (`src/healer/forbidden-patterns.ts`) shared with system prompt assembly — defense-in-depth without divergence.

---

## Claude's Discretion

Areas captured in CONTEXT.md as Claude's discretion:
- Exact PR body markdown structure (PRI-02 required content present, layout open)
- Exact issue body templates per failure mode
- `simple-git` vs `@actions/exec` for rebase + diff-apply
- Internal `src/healer/` file paths beyond the documented modules
- Plan decomposition (gsd-planner's call)

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` section:
- Anthropic + Ollama working adapters (stubs only in P3)
- Ollama MCP↔function-calling bridge
- Two-pass classify-then-fix agent flow
- PR/issue deduplication (Phase 4 PRI-04)
- GitHub labels for failure modes
- Sidecar service container
- Confidence band in PR body (v2 / TRC-03)
- Per-rerun fresh app instance (v1 limitation, VAL-04)
- Auto-merge (Phase 5)
- Fixture-repo end-to-end test (Phase 6 PKG-04)
