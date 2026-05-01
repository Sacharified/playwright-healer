# Phase 4: Auto-Dispatch + Full Fix Classes + Deduplication - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-01
**Phase:** 04-auto-dispatch-full-fix-classes-deduplication
**Areas discussed:** Auto-dispatch enablement

**Areas presented but NOT selected:** Dedup PR/issue update behavior; New fix classes structure (FIX-07); Hardening backlog routing (3 warnings + 6 PROJECT.md notes from Phase 03.1)

---

## Auto-dispatch enablement

### Q1: Default posture for consumer adoption of Phase 04?

| Option | Description | Selected |
|--------|-------------|----------|
| Opt-in via flag (Recommended) | Default `enable-auto-dispatch: false`; consumers explicitly flip it on after watching log-only summary. Matches MRG-01 safe-default philosophy. | ✓ |
| On by default once thresholds breach | DET-05 fires automatically; consumer must set `dispatch-mode: log-only` to suppress. Faster to value, higher blast radius on misconfigured thresholds. | |
| Staged: log-only → warn → live | Action emits `::warning::` after N would-have-dispatched runs; never auto-flips itself. Best UX, more code. | |

**User's choice:** Opt-in via flag (Recommended)
**Notes:** Confirms the safety posture mirrors MRG-01 (auto-merge opt-in by default). The log-only DET-04 step from Phase 02 stays as the v0 default; Phase 04 adds a sibling enable flag rather than altering DET-04's behavior.

---

### Q2: How should auto-dispatch be expressed at the action.yml input surface?

| Option | Description | Selected |
|--------|-------------|----------|
| New boolean input (Recommended) | Add `enable-auto-dispatch: 'false'` alongside existing `mode` enum. Ingest mode reads it. Keeps mode semantics stable, makes toggle obvious in YAML. | ✓ |
| Extend `mode` enum to ingest-live | Add `ingest-live` to mode enum so consumers write `mode: ingest-live`. One fewer input but conflates "what step does" with "how it behaves on threshold breach". | |
| Repurpose `mode: heal` | Same step ingests AND fires dispatch. Simpler YAML but breaks two-workflow architecture (PROJECT.md key decision). | |

**User's choice:** New boolean input (Recommended)
**Notes:** Preserves the two-workflow architecture and the `mode: ingest | heal | dry-run` enum that Phase 01 locked in. New input follows the 03.1 skip-flag pattern (`z.string().default('false').transform(v => v === 'true')`).

---

### Q3: GitHub Actions concurrency-group key for DET-07?

| Option | Description | Selected |
|--------|-------------|----------|
| {repo, test-file, test-title} (Recommended) | Group: `playwright-healer-${{ repo }}-${{ test_file }}-${{ test_title }}`. Matches DET-07 phrasing. Risk: long titles need slugging. | ✓ |
| Just {test-file} | Coarser; serializes unrelated tests in same spec. Probably overkill. | |
| {repo, test-id-hash} | Hash {file + title} into fixed-width slug. Robust but harder to debug. | |

**User's choice:** {repo, test-file, test-title} (Recommended)
**Notes:** Matches REQUIREMENTS DET-07 phrasing exactly. Researcher to validate GitHub's concurrency-group-name length cap and decide whether long test titles force a hash fallback path.

---

### Q4: Auto-dispatch interaction with SEC-05 `max-heals-per-test-per-week`?

| Option | Description | Selected |
|--------|-------------|----------|
| Check at dispatch time (Recommended) | Ingest queries state branch for prior heal count BEFORE firing dispatch. Saves a workflow run when cap is hit. Healer keeps existing SEC-05 check as defense-in-depth. | ✓ |
| Only check inside healer | Always dispatch; healer's existing SEC-05 check exits early. Simpler ingest, wastes a workflow run per cap-hit dispatch. | |
| Check both, with hard cap escalation | Both checks + escalate to "human review required" issue when cap hit. Adds alerting surface. | |

**User's choice:** Check at dispatch time (Recommended)
**Notes:** Defense-in-depth pattern is established (SEC-05 already runs at the loop-guard layer). D-04 extends it by adding the cheap pre-dispatch check, keeping the existing healer-side check as backstop.

---

## Continue or Wrap

**Q5: Continue with another area or write CONTEXT.md?**

| Option | Selected |
|--------|----------|
| Write CONTEXT.md now | ✓ |
| Discuss dedup PR/issue update | |
| Discuss new fix classes structure | |
| Discuss hardening backlog routing | |

**User's choice:** Write CONTEXT.md now
**Notes:** Three remaining areas are routed to "Claude's Discretion" in CONTEXT.md with explicit guidance for researcher/planner — they have latitude but must surface their picks in RESEARCH.md / PLAN.md so they're reviewable.

---

## Claude's Discretion

The user explicitly chose to defer these to downstream agents:
- **PRI-04 dedup update behavior** — comment-only vs force-update vs hybrid. REQUIREMENTS PRI-04 leans toward comment-only.
- **FIX-07 prompt structure** — unified system prompt vs class-specific templates. Class-picker (heuristic vs LLM-decides).
- **CFG-04 default-on policy** — REQUIREMENTS says default-true for all four; researcher to confirm post-03.1.
- **Hardening backlog routing** — Default: WR-01 (security) ships in Phase 04; WR-02/WR-03 ship alongside post-fix-validation re-engagement; six PROJECT.md notes triaged in PLAN.md.

## Deferred Ideas

(See CONTEXT.md `<deferred>` section — replay/cache mode, demo recording, public-repo move, Anthropic adapter exercise on full classes, cross-shard dedup, PR auto-rebase on stale healer branches.)
