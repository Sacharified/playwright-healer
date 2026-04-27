// src/healer/budget.ts
//
// FIX-02 enforcement: pre-call gate that aborts before generateContent if either
// the maxTurns or maxBudgetUsd ceiling would be crossed. Used by the Gemini
// adapter (Plan 10). Pricing constants live here so they're not inlined elsewhere
// (RESEARCH §Don't Hand-Roll: keep pricing in one place).
//
// Pricing source: Gemini 2.5 Pro (≤200K context), 2026-04:
//   $1.25 / 1M input tokens
//   $10.00 / 1M output tokens (candidatesTokenCount + thoughtsTokenCount)
// thoughtsTokenCount is billed at the output rate per Google's pricing docs.
//
// Revised 2026-04-26 per checker BLOCKER #1: BudgetExhausted carries the
// at-throw `usdSpent` and `turnsUsed` snapshot so the orchestrator (Plan 12)
// can render real cost data into the agent-budget-exhausted issue body.

export const GEMINI_PRICE_INPUT_PER_M = 1.25;
export const GEMINI_PRICE_OUTPUT_PER_M = 10.0;

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

export interface UsageMetadataLike {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
}

export class BudgetTracker {
  private _usdSpent = 0;
  private _turnsUsed = 0;
  private readonly maxTurns: number;
  private readonly maxBudgetUsd: number;

  constructor(opts: { maxTurns: number; maxBudgetUsd: number }) {
    this.maxTurns = opts.maxTurns;
    this.maxBudgetUsd = opts.maxBudgetUsd;
  }

  /**
   * Pre-call gate (FIX-02): throws BudgetExhausted BEFORE the next API call
   * if either ceiling is reached. Call this at the top of each loop iteration
   * before invoking generateContent. The thrown BudgetExhausted carries the
   * at-throw stats snapshot for orchestrator-side issue-body rendering.
   */
  assertCanProceed(): void {
    if (this._usdSpent >= this.maxBudgetUsd) {
      throw new BudgetExhausted(
        `USD budget exhausted: $${this._usdSpent.toFixed(4)} / $${this.maxBudgetUsd.toFixed(2)}`,
        { usdSpent: this._usdSpent, turnsUsed: this._turnsUsed },
      );
    }
    if (this._turnsUsed >= this.maxTurns) {
      throw new BudgetExhausted(
        `Max turns reached: ${this._turnsUsed} / ${this.maxTurns}`,
        { usdSpent: this._usdSpent, turnsUsed: this._turnsUsed },
      );
    }
  }

  /**
   * Account this turn's usage and increment the turn counter.
   * Missing fields are treated as 0.
   * thoughtsTokenCount is billed at the output rate (RESEARCH line 419).
   */
  recordUsage(u: UsageMetadataLike): void {
    const inputTokens = u.promptTokenCount ?? 0;
    const outputTokens = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
    this._usdSpent +=
      (inputTokens * GEMINI_PRICE_INPUT_PER_M + outputTokens * GEMINI_PRICE_OUTPUT_PER_M) / 1_000_000;
    this._turnsUsed += 1;
  }

  get usdSpent(): number { return this._usdSpent; }
  get turnsUsed(): number { return this._turnsUsed; }
}
