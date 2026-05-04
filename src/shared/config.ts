import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import fs from 'fs';
import * as core from '@actions/core';

const ModeEnum = z.enum(['ingest', 'heal', 'dry-run'])
  .describe('mode must be one of: ingest, heal, dry-run');

const ProviderEnum = z.enum(['anthropic', 'gemini', 'github', 'ollama'])
  .describe('provider must be one of: anthropic, gemini, github, ollama');

export type Provider = z.infer<typeof ProviderEnum>;

export const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: 'claude-sonnet-4-6',
  gemini:    'gemini-2.5-pro',
  // GitHub Models — OpenAI-compatible inference endpoint. Free tier available
  // for development. gpt-4.1 (the full model, not -mini) is the default because
  // -mini got hunk-header arithmetic wrong on real heals, producing patches
  // that `git apply` rejected. The full gpt-4.1 stays inside the same free tier.
  github:    'openai/gpt-4.1',
  ollama:    'llama3.1',
};

// Default OpenAI-compatible endpoints per provider. Adapters that don't take
// a configurable base URL (current: anthropic / gemini — SDK-managed; ollama —
// localhost) are absent from this map.
export const DEFAULT_ENDPOINTS: Partial<Record<Provider, string>> = {
  github: 'https://models.github.ai/inference',
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
    healerToken:     z.string().min(1, { message: 'healer_token is required and must be non-empty' }),
    githubToken:     z.string().min(1, { message: 'github_token is required and must be non-empty' }),
    provider:        ProviderEnum.default('anthropic'),
    model:           z.string().default(''),
    apiEndpoint:     z.string().default(''),

    // ── CFG-03: Ingest + threshold inputs ─────────────────────────────────────
    reportPath:             z.string().default('test-results/results.json'),
    flakeRateThreshold:     z.coerce.number()
                              .refine((v) => !isNaN(v), {
                                message: 'flake_rate_threshold must be a valid number (e.g. 0.2)',
                              })
                              .min(0).max(1).default(0.2),
    flakeWindowDays:        z.coerce.number()
                              .refine((v) => !isNaN(v), {
                                message: 'flake_window_days must be a valid integer',
                              })
                              .int().min(1).default(7),
    slowRegressionPct:      z.coerce.number()
                              .refine((v) => !isNaN(v), {
                                message: 'slow_regression_pct must be a valid number (e.g. 1.5)',
                              })
                              .min(1).default(1.5),
    minRunsForDetection:    z.coerce.number()
                              .refine((v) => !isNaN(v), {
                                message: 'min_runs_for_detection must be a valid integer >= 1',
                              })
                              .int().min(1).default(10),
    rerunCount:             z.coerce.number()
                              .refine((v) => !isNaN(v), { message: 'rerun_count must be a valid integer' })
                              .int().min(1).default(10),
    rerunPassRate:          z.coerce.number()
                              .refine((v) => !isNaN(v), { message: 'rerun_pass_rate must be a valid number (e.g. 0.9)' })
                              .min(0).max(1).default(0.9),
    maxBudgetUsd:           z.coerce.number()
                              .refine((v) => !isNaN(v), { message: 'max_budget_usd must be a valid number (e.g. 2.00)' })
                              .min(0).default(2.0),
    maxTurns:               z.coerce.number()
                              .refine((v) => !isNaN(v), { message: 'max_turns must be a valid integer' })
                              .int().min(1).default(30),
    retentionDays:          z.coerce.number()
                              .refine((v) => !isNaN(v), { message: 'retention_days must be a valid integer (0 = GC disabled)' })
                              .int().min(0).default(90),
    maxHealsPerTestPerWeek: z.coerce.number()
                              .refine((v) => !isNaN(v), { message: 'max_heals_per_test_per_week must be a valid integer' })
                              .int().min(0).default(3),
    stateBranchName:        z.string().default('playwright-healer-state'),

    // ── CFG-04: Per-fix-class toggles (Phase 3 ships selectors+waits; assertions+slow toggle-only) ──
    // Note: z.coerce.boolean() does NOT work for env strings — Boolean('false') === true.
    // Using transform: v !== 'false' so 'false' → false, 'true'/'1'/anything-else → true.
    // .default(true) — each toggle defaults to true when the INPUT_* env var is absent.
    enableSelectorFixes:  z.string().default('true').transform(v => v !== 'false'),
    enableWaitFixes:      z.string().default('true').transform(v => v !== 'false'),
    enableAssertionFixes: z.string().default('true').transform(v => v !== 'false'),
    enableSlowFixes:      z.string().default('true').transform(v => v !== 'false'),

    // ── HEA-02 (D-15): App-supervisor readiness probe ceiling ──
    // z.preprocess converts empty string ("") to undefined so .default(120) kicks in.
    // Non-empty strings flow through z.coerce.number() — "banana" → NaN → refine fails.
    startupTimeoutSeconds: z.preprocess(
                              (v) => (v === '' ? undefined : v),
                              z.coerce.number()
                                .refine((v) => !isNaN(v), { message: 'startup_timeout_seconds must be a valid integer' })
                                .int().min(1).default(120)
                            ),

    // ── Phase 03.1 demo-mode skip flags (default false — production behavior unchanged) ──
    // Same z.string() pattern as CFG-04 but inverted default: these flags DEFAULT OFF.
    // .default('false').transform(v => v === 'true') → absent or 'false' → false; 'true' → true.
    skipDeterministicCheck: z.string().default('false').transform(v => v === 'true'),
    skipPostFixValidation:  z.string().default('false').transform(v => v === 'true'),
    skipDiffLint:           z.string().default('false').transform(v => v === 'true'),

    // ── Phase 04: Auto-dispatch opt-in (CONTEXT D-01: default OFF, safe-default per MRG-01) ──
    // Same z.string() transform pattern as the demo-mode skip flags above (default 'false').
    // DO NOT use .default('true').transform(v => v !== 'false') — that is the CFG-04 pattern
    // (default ON). D-01 locks enable_auto_dispatch to default-OFF.
    enableAutoDispatch: z.string().default('false').transform(v => v === 'true'),
    // ── Phase 04: Workflow file name for dispatch (RESEARCH §"Open Questions §2 RESOLVED") ──
    // Configurable so multi-workflow consumers (per-environment heal workflows) can override.
    // Default matches REQUIREMENTS DET-05 phrasing.
    healerWorkflowFile: z.string().min(1).default('playwright-healer.yml'),

    // ── Phase 05: Auto-merge opt-in (CONTEXT D-01: default OFF, safe-default per MRG-01) ──
    // Same z.string() transform pattern as enableAutoDispatch above. NEVER use
    // .default('true') — D-01 locks default-OFF.
    enableAutoMerge: z.string().default('false').transform(v => v === 'true'),
    // MRG-02: 1.0 (10/10) is the strict default (different from rerun_pass_rate=0.9).
    // Consumers can lower (e.g. 0.95) at their own risk.
    autoMergePassRate: z.coerce.number()
                          .refine((v) => !isNaN(v), {
                            message: 'auto_merge_pass_rate must be a valid number 0..1 (e.g. 1.0)',
                          })
                          .min(0).max(1).default(1.0),
    // MRG-02 + CONTEXT D-01: comma-string passthrough. Default 'selectors' is conservative
    // (the only fix class with live demo evidence as of Phase 03.1).
    // Split-to-array happens at the gate call site (Plan 02), NOT in the schema —
    // keeps the schema producing a stable string type and lets the gate use string[] directly.
    autoMergeFixClasses: z.string().default('selectors'),
  }).superRefine((v, ctx) => {
    if (v.provider !== 'ollama' && v.apiKey.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['apiKey'],
        message: 'api_key is required and must be non-empty unless provider is ollama',
      });
    }
    // Phase 05 — defensive: enable_auto_merge=true with empty class list is a misconfig
    // that would silently disable auto-merge. Fail closed at parse time so consumers
    // see the issue before any heal runs.
    if (v.enableAutoMerge) {
      const classes = v.autoMergeFixClasses
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (classes.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['autoMergeFixClasses'],
          message:
            'auto_merge_fix_classes must contain at least one class when enable_auto_merge=true (e.g., "selectors")',
        });
      }
    }
  });
}

export type Config = z.infer<ReturnType<typeof getInputSchema>>;

// ── CFG-06: YAML config loader ─────────────────────────────────────────────

export function loadYamlConfig(workspacePath: string): Record<string, unknown> {
  const configPath = `${workspacePath}/.github/playwright-healer.yml`;
  if (!fs.existsSync(configPath)) return {};
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = parseYaml(raw, { maxAliasCount: 100 });
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, unknown>;
  } catch (err) {
    core.warning(
      `CFG-06: .github/playwright-healer.yml could not be parsed as YAML: ${err}. Using defaults.`
    );
    return {};
  }
}

// ── CFG-07: Config merger — action inputs win over YAML values when non-empty ─

export function mergeConfigs(
  actionInputs: Record<string, string>,
  yamlConfig: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...yamlConfig };
  for (const [key, value] of Object.entries(actionInputs)) {
    if (value !== '') {
      merged[key] = value;
    }
  }
  return merged;
}
