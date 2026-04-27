import { describe, it, expect } from 'vitest';
import { anthropicAdapter } from './anthropic.js';

describe('anthropicAdapter — stub (CONTEXT D-01)', () => {
  it('throws "not implemented in Phase 3" when runAgent is called', async () => {
    await expect(
      anthropicAdapter.runAgent({} as any, '', [] as readonly string[]),
    ).rejects.toThrow('anthropic adapter not implemented in Phase 3');
  });

  it('satisfies the Adapter interface (typecheck only)', () => {
    // If this file compiles, anthropicAdapter satisfies the Adapter interface.
    expect(typeof anthropicAdapter.runAgent).toBe('function');
  });
});
