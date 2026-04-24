// src/index.ts
//
// playwright-healer — composite GitHub Action entry point.
//
// Startup ordering (D-07) is AUTHORITATIVE:
//   1. getInput() the three secret inputs
//   2. setSecret() each one — registers with runner mask BEFORE any log line
//   3. getInput() the non-secret inputs
//   4. Zod validation (fail-fast with field-naming error on invalid input)
//   5. switch-dispatch on mode: dry-run is self-contained; ingest/heal dynamically
//      import their stub modules (throw in Phase 1 per D-09)
//
// IMPORTANT: do NOT log anything — core.info, console.log, throw-with-input-values —
// before step 2 completes. Any log line before setSecret leaks the value into the
// Actions log.

import * as core from '@actions/core';
import { getInputSchema, type Config } from './shared/config.js';

async function main(): Promise<void> {
  // ── Phase A: SECRET MASKING (D-07 — must be first, before any log line) ──
  const anthropicApiKey = core.getInput('anthropic-api-key', { required: true });
  const healerToken     = core.getInput('healer-token',      { required: true });
  const githubToken     = core.getInput('github-token',      { required: true });

  core.setSecret(anthropicApiKey);
  core.setSecret(healerToken);
  core.setSecret(githubToken);

  // ── Phase B: INPUT COLLECTION ──
  const rawInputs = {
    mode:           core.getInput('mode',           { required: true }),
    setupCommand:   core.getInput('setup-command'),
    startCommand:   core.getInput('start-command'),
    testCommand:    core.getInput('test-command'),
    baseUrl:        core.getInput('base-url'),
    anthropicApiKey,
    healerToken,
    githubToken,
  };

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
      await m.run(config); // throws in Phase 1 per D-09
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
  const rows: Array<[string, string]> = [
    ['mode',          config.mode],
    ['setup-command', config.setupCommand || '(empty)'],
    ['start-command', config.startCommand || '(empty)'],
    ['test-command',  config.testCommand  || '(empty)'],
    ['base-url',      config.baseUrl      || '(empty)'],
    // Secrets intentionally omitted from dry-run output (defense in depth on top of setSecret masking).
    ['anthropic-api-key', '(set — redacted)'],
    ['healer-token',      '(set — redacted)'],
    ['github-token',      '(set — redacted)'],
  ];

  let md = '# playwright-healer — dry-run summary\n\n';
  md += '| Input | Value |\n| --- | --- |\n';
  for (const [k, v] of rows) {
    md += `| \`${k}\` | ${v} |\n`;
  }
  md += '\n_No side effects were performed. Exit code: 0._\n';

  await core.summary.addRaw(md).write();
}

main().catch((err) => {
  core.setFailed(err instanceof Error ? err.message : String(err));
});
