// src/index.ts
//
// playwright-healer — composite GitHub Action entry point.
//
// Startup ordering (D-07) is AUTHORITATIVE:
//   1. getInput() the three secret inputs (api_key may be empty for Ollama
//      localhost — core.setSecret('') is a documented no-op, so we call it
//      unconditionally to preserve the "setSecret × 3 before any log line"
//      invariant with zero branching)
//   2. setSecret() each one — registers with runner mask BEFORE any log line
//   3. getInput() the non-secret inputs (mode, provider, model, api_endpoint, …)
//   4. Load + merge YAML overrides (CFG-06/CFG-07) BEFORE Zod sees rawInputs
//      so SC#4 (banana threshold in YAML) surfaces as a Zod field error
//   5. Zod validation (fail-fast with field-naming error on invalid input;
//      per-provider api_key requirement enforced via superRefine)
//   6. switch-dispatch on mode: dry-run is self-contained; ingest/heal dynamically
//      import their stub modules
//
// IMPORTANT: do NOT log anything — core.info, console.log, throw-with-input-values —
// before step 2 completes. Any log line before setSecret leaks the value into the
// Actions log.

import * as core from '@actions/core';
import {
  getInputSchema,
  DEFAULT_MODELS,
  loadYamlConfig,
  mergeConfigs,
  type Config,
} from './shared/config.js';

function camelize(kebab: string): string {
  return kebab.replace(/-(.)/g, (_, c: string) => c.toUpperCase());
}

async function main(): Promise<void> {
  // ── Phase A: SECRET MASKING (D-07 — must be first, before any log line) ──
  const apiKey      = core.getInput('api_key');
  const healerToken = core.getInput('healer_token', { required: true });
  const githubToken = core.getInput('github_token', { required: true });

  core.setSecret(apiKey);
  core.setSecret(healerToken);
  core.setSecret(githubToken);

  // ── Phase B: INPUT COLLECTION ──
  const actionInputs: Record<string, string> = {
    mode:           core.getInput('mode',           { required: true }),
    setupCommand:   core.getInput('setup_command'),
    startCommand:   core.getInput('start_command'),
    testCommand:    core.getInput('test_command'),
    baseUrl:        core.getInput('base_url'),
    apiKey,
    healerToken,
    githubToken,
    provider:       core.getInput('provider'),
    model:          core.getInput('model'),
    apiEndpoint:    core.getInput('api_endpoint'),
    // ── CFG-03: Phase 02 threshold inputs ─────────────────────────────────
    reportPath:              core.getInput('report_path'),
    flakeRateThreshold:      core.getInput('flake_rate_threshold'),
    flakeWindowDays:         core.getInput('flake_window_days'),
    slowRegressionPct:       core.getInput('slow_regression_pct'),
    rerunCount:              core.getInput('rerun_count'),
    rerunPassRate:           core.getInput('rerun_pass_rate'),
    maxBudgetUsd:            core.getInput('max_budget_usd'),
    maxTurns:                core.getInput('max_turns'),
    retentionDays:           core.getInput('retention_days'),
    maxHealsPerTestPerWeek:  core.getInput('max_heals_per_test_per_week'),
    // ── CFG-04: Per-fix-class toggles + startup timeout (Phase 3) ─────────
    enableSelectorFixes:    core.getInput('enable_selector_fixes'),
    enableWaitFixes:        core.getInput('enable_wait_fixes'),
    enableAssertionFixes:   core.getInput('enable_assertion_fixes'),
    enableSlowFixes:        core.getInput('enable_slow_fixes'),
    startupTimeoutSeconds:  core.getInput('startup_timeout_seconds'),
    // ── Phase 03.1 demo-mode skip flags (Plan 01 added schema; this wires inputs) ──
    skipDeterministicCheck: core.getInput('skip_deterministic_check'),
    skipPostFixValidation:  core.getInput('skip_post_fix_validation'),
    skipDiffLint:           core.getInput('skip_diff_lint'),
  };

  // ── Phase B': YAML MERGE (CFG-06/CFG-07; load-bearing for SC#4) ─────────
  // YAML keys are kebab-case (`flake-rate-threshold`), but the schema expects
  // camelCase. Translate yaml keys before merging so an invalid yaml value
  // reaches Zod under the correct field path and errors with a named field.
  const workspacePath = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const yamlRaw = loadYamlConfig(workspacePath);
  const yamlAsCamel: Record<string, unknown> = Object.fromEntries(
    Object.entries(yamlRaw).map(([k, v]) => [camelize(k), v]),
  );
  const rawInputs = mergeConfigs(actionInputs, yamlAsCamel);

  // ── Phase C: VALIDATION (Zod; fail-fast; field-naming error per SC#4) ──
  const parsed = getInputSchema().safeParse(rawInputs);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    core.setFailed(`Invalid inputs: ${msg}`);
    return; // setFailed sets exit code 1; use return, never process dot exit
  }
  const config: Config = parsed.data;

  // ── Phase D: DISPATCH ──
  switch (config.mode) {
    case 'dry-run':
      await runDryRun(config);
      return;
    case 'ingest': {
      const m = await import('./ingest/index.js');
      await m.run(config);
      return;
    }
    case 'heal': {
      const m = await import('./healer/index.js');
      await m.run(config); // throws in Phase 1 per D-09
      return;
    }
  }
}

/**
 * Dry-run: write a redacted config summary to $GITHUB_STEP_SUMMARY and exit 0.
 * Per D-05, the three secrets are NEVER emitted (omitted rather than replaced
 * with ***, because the runner mask would replace them anyway — belt and
 * suspenders). This is the permanent dry-run contract: exit 0 + no side effects.
 */
async function runDryRun(config: Config): Promise<void> {
  const apiKeyCell = config.apiKey.length > 0
    ? '(set — redacted)'
    : (config.provider === 'ollama' ? '(empty — allowed for ollama)' : '(empty)');
  const modelCell = config.model.length > 0
    ? config.model
    : `(default: ${DEFAULT_MODELS[config.provider]})`;
  const apiEndpointCell = config.apiEndpoint.length > 0
    ? config.apiEndpoint
    : '(default)';

  const rows: Array<[string, string]> = [
    ['mode',          config.mode],
    ['provider',      config.provider],
    ['model',         modelCell],
    ['api_endpoint',  apiEndpointCell],
    ['setup_command', config.setupCommand || '(empty)'],
    ['start_command', config.startCommand || '(empty)'],
    ['test_command',  config.testCommand  || '(empty)'],
    ['base_url',      config.baseUrl      || '(empty)'],
    // Secrets intentionally omitted from dry-run output (defense in depth on top of setSecret masking).
    ['api_key',      apiKeyCell],
    ['healer_token', '(set — redacted)'],
    ['github_token', '(set — redacted)'],
  ];

  let md = '# playwright-healer — dry-run summary\n\n';
  md += '| Input | Value |\n| --- | --- |\n';
  for (const [k, v] of rows) {
    md += `| \`${k}\` | ${v} |\n`;
  }
  md += '\n_No side effects were performed. Exit code: 0._\n';

  await core.summary.addRaw(md).write();
  core.setOutput('dryRunSummary', md);
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
