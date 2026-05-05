// src/healer/budget.ts
//
// FIX-02 budget-exhaustion error type. Adapters track turns and USD cost
// inline (no shared tracker class) and throw this when either ceiling is
// crossed. The orchestrator (Plan 12) reads usdSpent / turnsUsed off the
// thrown error to render real heal economics into the agent-budget-exhausted
// issue body.
//
// Phase 01.4: BudgetTracker class and Gemini-specific pricing constants
// (GEMINI_PRICE_INPUT_PER_M, GEMINI_PRICE_OUTPUT_PER_M) were removed when the
// Gemini adapter was deleted. OpenRouter exposes per-call USD via usage.cost
// directly, so per-token pricing tables are no longer needed in the source.

export class BudgetExhausted extends Error {
  readonly usdSpent: number;
  readonly turnsUsed: number;
  constructor(message: string, stats: { usdSpent: number; turnsUsed: number }) {
    super(message);
    this.name = 'BudgetExhausted';
    this.usdSpent = stats.usdSpent;
    this.turnsUsed = stats.turnsUsed;
  }
}
