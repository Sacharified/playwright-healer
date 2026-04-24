import { z } from 'zod';

const ModeEnum = z.enum(['ingest', 'heal', 'dry-run'])
  .describe('mode must be one of: ingest, heal, dry-run');

const ProviderEnum = z.enum(['anthropic', 'gemini', 'ollama'])
  .describe('provider must be one of: anthropic, gemini, ollama');

export type Provider = z.infer<typeof ProviderEnum>;

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-sonnet-4-6',
  gemini:    'gemini-2.5-pro',
  ollama:    'llama3.1',
};

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
    apiKey:          z.string().default(''),
    healerToken:     z.string().min(1, { message: 'healer-token is required and must be non-empty' }),
    githubToken:     z.string().min(1, { message: 'github-token is required and must be non-empty' }),
    provider:        ProviderEnum.default('anthropic'),
    model:           z.string().default(''),
    apiEndpoint:     z.string().default(''),
  }).superRefine((v, ctx) => {
    if (v.provider !== 'ollama' && v.apiKey.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiKey'],
        message: 'api-key is required and must be non-empty unless provider is ollama',
      });
    }
  });
}

export type Config = z.infer<ReturnType<typeof getInputSchema>>;
