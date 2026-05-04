// src/healer/dispatch-payload.ts
// Zod schema for the workflow_dispatch payload.
// Phase 04 widening: cross-workflow contract is now 8 FLAT inputs.
//
// Breaking changes from Phase 03:
//   1. `fixClassHint` enum widened to include 'assertions' + 'slow'
//   2. `recentRunStats` nested object REMOVED — replaced by flat numeric fields
//   3. `concurrencyKey` is now REQUIRED (maintainer dispatches must compute it)
//   4. Flat numeric fields accept strings via z.coerce.number() — workflow_dispatch
//      inputs arrive as strings; z.coerce.number() handles "0.42" → 0.42.
//
// Per RESEARCH Pitfall 1, nesting (recentRunStats) added a parse-failure mode on
// the receive side — flat keeps the schema strict and predictable. 8 flat inputs
// << the 25-input GitHub cap.
//
// This schema is the cross-workflow contract — Plans 02 (FIX-07 classifier feeds
// fixClassHint), 03 (PRI-04 dedup reads concurrencyKey), 04 (heal-cap gate runs
// BEFORE fireDispatch), and 05 (e2e workflow declares matching inputs: block) all
// build on this schema.

import { z } from 'zod';

export const DispatchPayload = z.object({
  commitSha:      z.string().regex(/^[0-9a-f]{7,40}$/i, 'commitSha must be a hex SHA'),
  testFile:       z.string().min(1),
  testTitle:      z.string().min(1),
  // Phase 04 widening: all four v1 fix classes. Zod rejects any value outside this enum.
  fixClassHint:   z.enum(['selectors', 'waits', 'assertions', 'slow']),
  // FLAT numerics — replaces nested recentRunStats. Optional because manual maintainer
  // dispatches may omit them; ingest-side dispatch always populates all three.
  // z.coerce.number() handles string inputs from workflow_dispatch.
  flakeRate:      z.coerce.number().min(0).max(1).optional(),
  windowDays:     z.coerce.number().int().min(1).optional(),
  runCount:       z.coerce.number().int().min(0).optional(),
  // Required from Phase 04 forward (T-04-04: min(1) prevents empty-string injection
  // into the consumer's concurrency.group expression).
  concurrencyKey: z.string().min(1),
});

export type DispatchPayload = z.infer<typeof DispatchPayload>;
