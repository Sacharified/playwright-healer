import { describe, it, expect } from 'vitest';
import { ollamaAdapter } from './ollama.js';

describe('ollamaAdapter — stub (CONTEXT D-01)', () => {
  it('throws "not implemented in Phase 3" when runAgent is called', async () => {
    await expect(
      ollamaAdapter.runAgent({} as any, '', [] as readonly string[]),
    ).rejects.toThrow('ollama adapter not implemented in Phase 3');
  });

  it('satisfies the Adapter interface (typecheck only)', () => {
    // If this file compiles, ollamaAdapter satisfies the Adapter interface.
    expect(typeof ollamaAdapter.runAgent).toBe('function');
  });
});
