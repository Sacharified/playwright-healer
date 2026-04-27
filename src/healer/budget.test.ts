import { describe, it, expect } from 'vitest';
import {
  BudgetTracker, BudgetExhausted,
  GEMINI_PRICE_INPUT_PER_M, GEMINI_PRICE_OUTPUT_PER_M,
} from './budget.js';

describe('BudgetTracker — FIX-02', () => {
  it('starts at $0 spent and 0 turns used', () => {
    const b = new BudgetTracker({ maxTurns: 30, maxBudgetUsd: 2.0 });
    expect(b.usdSpent).toBe(0);
    expect(b.turnsUsed).toBe(0);
  });

  it('assertCanProceed() does not throw with empty budget', () => {
    const b = new BudgetTracker({ maxTurns: 30, maxBudgetUsd: 2.0 });
    expect(() => b.assertCanProceed()).not.toThrow();
  });

  it('records input tokens at $1.25/M', () => {
    const b = new BudgetTracker({ maxTurns: 30, maxBudgetUsd: 100 });
    b.recordUsage({ promptTokenCount: 1_000_000 });
    expect(b.usdSpent).toBeCloseTo(GEMINI_PRICE_INPUT_PER_M, 6);
  });

  it('records output tokens at $10/M and counts thoughtsTokenCount as output', () => {
    const b = new BudgetTracker({ maxTurns: 30, maxBudgetUsd: 100 });
    b.recordUsage({ candidatesTokenCount: 500_000, thoughtsTokenCount: 500_000 });
    expect(b.usdSpent).toBeCloseTo(GEMINI_PRICE_OUTPUT_PER_M, 6);
  });

  it('increments turnsUsed by 1 per recordUsage call', () => {
    const b = new BudgetTracker({ maxTurns: 30, maxBudgetUsd: 100 });
    b.recordUsage({});
    b.recordUsage({});
    b.recordUsage({});
    expect(b.turnsUsed).toBe(3);
  });

  it('handles missing usage fields as zero', () => {
    const b = new BudgetTracker({ maxTurns: 30, maxBudgetUsd: 2 });
    expect(() => b.recordUsage({})).not.toThrow();
    expect(b.usdSpent).toBe(0);
    expect(b.turnsUsed).toBe(1);
  });

  it('assertCanProceed() throws BudgetExhausted when usdSpent >= maxBudgetUsd', () => {
    const b = new BudgetTracker({ maxTurns: 30, maxBudgetUsd: 1.0 });
    b.recordUsage({ promptTokenCount: 1_000_000 }); // adds $1.25
    expect(() => b.assertCanProceed()).toThrow(BudgetExhausted);
    expect(() => b.assertCanProceed()).toThrow(/USD budget exhausted/);
  });

  it('assertCanProceed() throws BudgetExhausted when turnsUsed >= maxTurns', () => {
    const b = new BudgetTracker({ maxTurns: 2, maxBudgetUsd: 100 });
    b.recordUsage({});
    b.recordUsage({});
    expect(() => b.assertCanProceed()).toThrow(BudgetExhausted);
    expect(() => b.assertCanProceed()).toThrow(/Max turns reached/);
  });

  it('BudgetExhausted is instanceof Error (so generic catch blocks work)', () => {
    const b = new BudgetTracker({ maxTurns: 1, maxBudgetUsd: 100 });
    b.recordUsage({});
    try {
      b.assertCanProceed();
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toBeInstanceOf(BudgetExhausted);
    }
  });

  it('BudgetExhausted carries usdSpent + turnsUsed snapshot (revised 2026-04-26 per checker BLOCKER #1)', () => {
    const b = new BudgetTracker({ maxTurns: 30, maxBudgetUsd: 1.0 });
    b.recordUsage({ promptTokenCount: 1_000_000 }); // $1.25 — over the $1.00 cap
    try {
      b.assertCanProceed();
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(BudgetExhausted);
      const err = e as BudgetExhausted;
      expect(err.usdSpent).toBeCloseTo(1.25, 4);
      expect(err.turnsUsed).toBe(1);
    }
  });

  it('BudgetExhausted (turn-cap path) carries usdSpent + turnsUsed snapshot', () => {
    const b = new BudgetTracker({ maxTurns: 2, maxBudgetUsd: 100 });
    b.recordUsage({ promptTokenCount: 100_000 }); // some real cost
    b.recordUsage({ promptTokenCount: 100_000 });
    try {
      b.assertCanProceed();
      expect.fail('should have thrown');
    } catch (e) {
      const err = e as BudgetExhausted;
      expect(err.turnsUsed).toBe(2);
      expect(err.usdSpent).toBeGreaterThan(0);
    }
  });

  it('exports the pricing constants for the Gemini adapter to consume', () => {
    expect(GEMINI_PRICE_INPUT_PER_M).toBe(1.25);
    expect(GEMINI_PRICE_OUTPUT_PER_M).toBe(10.0);
  });
});
