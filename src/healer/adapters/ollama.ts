// src/healer/adapters/ollama.ts
// Stub per CONTEXT D-01. Phase 3 ships Gemini only; the Ollama adapter
// becomes a later inserted phase or part of Phase 4 expansion.
// Throws on call so accidental routing fails loud (matches Phase 1 D-09 pattern).

import type { Adapter } from '../adapter.js';

export const ollamaAdapter: Adapter = {
  async runAgent() {
    throw new Error('ollama adapter not implemented in Phase 3');
  },
};
