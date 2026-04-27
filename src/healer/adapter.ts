// src/healer/adapter.ts
// Provider-agnostic adapter contract (CONTEXT D-02). Each provider implementation
// (gemini, anthropic, ollama) under src/healer/adapters/ satisfies this interface.
// The healer orchestrator consumes ONLY this typed surface — no provider-specific
// imports leak into src/healer/index.ts.
//
// Return type revised 2026-04-26 per checker BLOCKER #1: { proposal, stats }
// instead of just the union. Mandatory so PRI-02 PR body cost-spent line and the
// `agent-budget-exhausted` / `validation-failed` issue bodies surface real heal
// economics. The `stats` field is populated from BudgetTracker (Plan 05) inside
// each adapter implementation.

import type { ContextBundle } from './types.js';

export interface FixProposal {
  rootCause: string;
  fixClass: 'selectors' | 'waits';
  diff: string;
  rationale: string;
}

export interface NoFixProposable {
  reason: string;
  evidence: string;
}

/**
 * Execution statistics surfaced by every Adapter.runAgent call.
 *
 * Required so the orchestrator (Plan 12) can thread real heal cost into:
 *   - PR body PRI-02 "Cost spent" line (the headline economics line on every healer PR)
 *   - `agent-budget-exhausted` issue body (maintainers see how much was burned before timeout)
 *   - `validation-failed` issue body (maintainers see fix cost even when validation fails)
 *
 * Numbers come from each adapter's BudgetTracker (Plan 05). Adapters MUST
 * populate both fields on EVERY return path (success, NoFixProposable). On
 * thrown BudgetExhausted, the adapter does not return — Plan 10 / Plan 12
 * surface the at-throw stats via the BudgetExhausted error properties (see
 * Plan 05 / Plan 10 — BudgetExhausted carries `usdSpent` + `turnsUsed`).
 */
export interface AgentRunStats {
  usdSpent: number;     // accumulated cost in USD across all turns
  turnsUsed: number;    // count of generateContent calls made
}

export interface Adapter {
  runAgent(
    context: ContextBundle,
    systemPrompt: string,
    allowedTools: readonly string[],
  ): Promise<{ proposal: FixProposal | NoFixProposable; stats: AgentRunStats }>;
}
