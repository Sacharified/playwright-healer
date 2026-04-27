// src/healer/adapters/anthropic.ts
// Stub per CONTEXT D-01. Phase 3 ships Gemini only; the Anthropic adapter
// becomes a later inserted phase or part of Phase 4 expansion.
// Throws on call so accidental routing fails loud (matches Phase 1 D-09 pattern).

import type { Adapter } from '../adapter.js';

export const anthropicAdapter: Adapter = {
  async runAgent() {
    throw new Error('anthropic adapter not implemented in Phase 3');
  },
};
