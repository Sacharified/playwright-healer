// tests/unit/action-yml-structure.test.ts
//
// Phase 01.3 SC#1: structural assertions on action.yml — these are the
// integration-side guard against the silent-failure mode where the inner step
// id and the outputs.<key>.value expression drift apart, producing an empty
// composite-action output and the SAME failure shape as the original bug
// (Scenarios 4+5 fail with "missing provider row").
//
// This test does NOT mock anything — it parses the live action.yml.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

const ACTION_YML_PATH = resolve(__dirname, '../../action.yml');

interface ActionYml {
  name: string;
  inputs: Record<string, unknown>;
  outputs?: Record<string, { description: string; value: string }>;
  runs: {
    using: string;
    steps: Array<{
      name?: string;
      id?: string;
      run?: string;
      uses?: string;
    }>;
  };
}

function loadActionYml(): ActionYml {
  const raw = readFileSync(ACTION_YML_PATH, 'utf8');
  return parseYaml(raw) as ActionYml;
}

describe('action.yml structure (Phase 01.3 SC#1 bridge)', () => {
  it('parses cleanly via the yaml library', () => {
    expect(() => loadActionYml()).not.toThrow();
  });

  it('declares a top-level outputs.dry_run_summary block', () => {
    const yml = loadActionYml();
    expect(yml.outputs).toBeDefined();
    expect(yml.outputs!['dry_run_summary']).toBeDefined();
    expect(yml.outputs!['dry_run_summary'].description).toBeTypeOf('string');
    expect(yml.outputs!['dry_run_summary'].value).toBeTypeOf('string');
  });

  it('outputs.dry_run_summary.description contains the diagnostic-only disclaimer (T-02 mitigation)', () => {
    const yml = loadActionYml();
    const desc = yml.outputs!['dry_run_summary'].description;
    expect(desc.toLowerCase()).toContain('diagnostic');
    expect(desc.toLowerCase()).toContain('not stable across versions');
  });

  it('outputs.dry_run_summary.value references steps.run-playwright-healer.outputs.dryRunSummary verbatim', () => {
    const yml = loadActionYml();
    const value = yml.outputs!['dry_run_summary'].value;
    expect(value.trim()).toBe('${{ steps.run-playwright-healer.outputs.dryRunSummary }}');
  });

  it('runs.steps contains a step with id: run-playwright-healer (matching the value expression slug)', () => {
    const yml = loadActionYml();
    const ids = yml.runs.steps.map((s) => s.id).filter(Boolean);
    expect(ids).toContain('run-playwright-healer');
  });

  it('Step 6 (id: run-playwright-healer) has name "Run playwright-healer" and runs the path-resolved tsx spawn', () => {
    const yml = loadActionYml();
    const step6 = yml.runs.steps.find((s) => s.id === 'run-playwright-healer');
    expect(step6).toBeDefined();
    expect(step6!.name).toBe('Run playwright-healer');
    expect(step6!.run).toContain('./node_modules/.bin/tsx src/index.ts');
  });

  it('the slug in outputs.dry_run_summary.value matches the id on Step 6 (RESEARCH Pitfall 2 guard)', () => {
    const yml = loadActionYml();
    // Extract slug from the value expression.
    const value = yml.outputs!['dry_run_summary'].value;
    const match = value.match(/steps\.([a-zA-Z0-9-]+)\.outputs\./);
    expect(match).not.toBeNull();
    const slugInValue = match![1];
    // Ensure that exact slug exists as an id on a step.
    const ids = yml.runs.steps.map((s) => s.id).filter(Boolean);
    expect(ids).toContain(slugInValue);
  });

  // Wiring guard: every input that's plumbed via an INPUT_* env mapping
  // (i.e., `INPUT_FOO: ${{ inputs.foo }}` in the run step's env block) MUST
  // be read by core.getInput() in src/index.ts. The Phase 04/05 inputs
  // (enable_auto_dispatch, healer_workflow_file, enable_auto_merge, …)
  // shipped with the env mapping but no getInput call — the schema's
  // `.default('false')` masked the omission and consumers saw
  // "Detection mode: log-only" no matter what they configured.
  //
  // Inputs consumed directly by composite-action steps (e.g. `commit_sha`
  // in the heal-mode checkout `with: ref:`) don't need a getInput call;
  // they're filtered out by checking the action.yml text for `${{ inputs.X }}`
  // outside the env block.
  it('every input wired through INPUT_* env mapping is read via core.getInput() in src/index.ts', () => {
    const ymlRaw = readFileSync(ACTION_YML_PATH, 'utf8');
    const indexSrc = readFileSync(
      resolve(__dirname, '../../src/index.ts'),
      'utf8',
    );

    // Pull out every "INPUT_FOO: ${{ inputs.foo }}" mapping from action.yml.
    const envMappingRegex = /INPUT_[A-Z0-9_]+:\s*\$\{\{\s*inputs\.([a-z0-9_]+)\s*\}\}/g;
    const envMappedInputs = new Set<string>();
    for (const m of ymlRaw.matchAll(envMappingRegex)) {
      envMappedInputs.add(m[1]);
    }
    expect(envMappedInputs.size).toBeGreaterThan(0); // sanity: regex actually matched

    const missing = [...envMappedInputs].filter((name) => {
      const single = `core.getInput('${name}'`;
      const double = `core.getInput("${name}"`;
      return !indexSrc.includes(single) && !indexSrc.includes(double);
    });

    expect(
      missing,
      `inputs with INPUT_* env mapping in action.yml but no core.getInput call in src/index.ts: ${missing.join(', ')}`,
    ).toEqual([]);
  });
});
