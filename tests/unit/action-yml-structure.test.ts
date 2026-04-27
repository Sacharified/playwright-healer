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

  it('declares a top-level outputs.dry-run-summary block', () => {
    const yml = loadActionYml();
    expect(yml.outputs).toBeDefined();
    expect(yml.outputs!['dry-run-summary']).toBeDefined();
    expect(yml.outputs!['dry-run-summary'].description).toBeTypeOf('string');
    expect(yml.outputs!['dry-run-summary'].value).toBeTypeOf('string');
  });

  it('outputs.dry-run-summary.description contains the diagnostic-only disclaimer (T-02 mitigation)', () => {
    const yml = loadActionYml();
    const desc = yml.outputs!['dry-run-summary'].description;
    expect(desc.toLowerCase()).toContain('diagnostic');
    expect(desc.toLowerCase()).toContain('not stable across versions');
  });

  it('outputs.dry-run-summary.value references steps.run-playwright-healer.outputs.dryRunSummary verbatim', () => {
    const yml = loadActionYml();
    const value = yml.outputs!['dry-run-summary'].value;
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

  it('the slug in outputs.dry-run-summary.value matches the id on Step 6 (RESEARCH Pitfall 2 guard)', () => {
    const yml = loadActionYml();
    // Extract slug from the value expression.
    const value = yml.outputs!['dry-run-summary'].value;
    const match = value.match(/steps\.([a-zA-Z0-9-]+)\.outputs\./);
    expect(match).not.toBeNull();
    const slugInValue = match![1];
    // Ensure that exact slug exists as an id on a step.
    const ids = yml.runs.steps.map((s) => s.id).filter(Boolean);
    expect(ids).toContain(slugInValue);
  });
});
