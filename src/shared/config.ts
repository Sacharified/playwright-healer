import { z } from 'zod';

const ModeEnum = z.enum(['ingest', 'heal', 'dry-run'])
  .describe('mode must be one of: ingest, heal, dry-run');

// Factory form: lets tests override defaults without module-level state.
// This is deliberate — matches the D-19 "presence-only in Phase 1, scope checks deferred"
// contract because the schema stays pure.
export function getInputSchema() {
  return z.object({
    mode:            ModeEnum,
    setupCommand:    z.string().default(''),
    startCommand:    z.string().default(''),
    testCommand:     z.string().default(''),
    baseUrl:         z.string().default(''),
    anthropicApiKey: z.string().min(1, { message: 'anthropic-api-key is required and must be non-empty' }),
    healerToken:     z.string().min(1, { message: 'healer-token is required and must be non-empty' }),
    githubToken:     z.string().min(1, { message: 'github-token is required and must be non-empty' }),
  });
}

export type Config = z.infer<ReturnType<typeof getInputSchema>>;
