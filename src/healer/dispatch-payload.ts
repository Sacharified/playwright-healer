// src/healer/dispatch-payload.ts
// Zod schema for the workflow_dispatch payload (CONTEXT D-18 / RESEARCH §C).
// Phase 3: maintainer-typed manual dispatch. Phase 4: programmatic dispatch from
// threshold-evaluator. Schema is the contract between the two — keep field names
// stable.
//
// `recentRunStats` is optional in P3 because the manual dispatcher may omit it.
// Phase 4 will always populate it from a Detection record.

import { z } from 'zod';

export const DispatchPayload = z.object({
  commitSha:    z.string().regex(/^[0-9a-f]{7,40}$/i, 'commitSha must be a hex SHA'),
  testFile:     z.string().min(1),
  testTitle:    z.string().min(1),
  fixClassHint: z.enum(['selectors', 'waits']),
  recentRunStats: z.object({
    flakeRate:  z.number().min(0).max(1),
    windowDays: z.number().int().min(1),
    runCount:   z.number().int().min(0),
  }).optional(),
});

export type DispatchPayload = z.infer<typeof DispatchPayload>;
