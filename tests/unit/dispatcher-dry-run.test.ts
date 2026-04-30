// tests/unit/dispatcher-dry-run.test.ts
//
// Phase 01.3 SC#1: assert runDryRun publishes the rendered redacted markdown to
// the composite-action output via core.setOutput('dryRunSummary', md). This is
// the TS-side half of the Scenarios 4+5 fix — the action.yml outputs.dry_run_summary
// declaration is verified independently in tests/unit/action-yml-structure.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock of @actions/core. dispatcher-dry-run runs `await core.summary.addRaw(md).write();
// core.setOutput(...);` so we need write() to resolve and setOutput() to be a recordable spy.
const setOutputMock = vi.fn();
const writeMock = vi.fn().mockResolvedValue(undefined);
const summaryAddRawMock = vi.fn().mockReturnValue({ write: writeMock });
const setSecretMock = vi.fn();
const setFailedMock = vi.fn();
const getInputMock = vi.fn();

vi.mock('@actions/core', () => ({
  setOutput: setOutputMock,
  setSecret: setSecretMock,
  setFailed: setFailedMock,
  getInput: getInputMock,
  summary: { addRaw: summaryAddRawMock },
}));

// Mock yaml-config loader so runDryRun's parent main() doesn't blow up reading from cwd.
vi.mock('../../src/shared/config.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/shared/config.js')>();
  return {
    ...real,
    loadYamlConfig: vi.fn().mockReturnValue({}),
  };
});

beforeEach(() => {
  setOutputMock.mockClear();
  writeMock.mockClear();
  summaryAddRawMock.mockClear();
  setSecretMock.mockClear();
  setFailedMock.mockClear();
  getInputMock.mockReset();
});

/**
 * Helper that drives the dispatcher's main() through the dry-run branch by
 * scripting getInput() return values for each call site in src/index.ts.
 * Order matters — the dispatcher calls getInput in a fixed sequence.
 */
function scriptInputs(overrides: Record<string, string> = {}): void {
  const defaults: Record<string, string> = {
    'api_key':                          'test-canary-DO-NOT-USE-REAL-KEY',
    'healer_token':                     'test-healer-token',
    'github_token':                     'test-github-token',
    'mode':                             'dry-run',
    'setup_command':                    '',
    'start_command':                    '',
    'test_command':                     '',
    'base_url':                         '',
    'provider':                         'anthropic',
    'model':                            '',
    'api_endpoint':                     '',
    'report_path':                      'test-results/results.json',
    'flake_rate_threshold':             '0.2',
    'flake_window_days':                '7',
    'slow_regression_pct':              '1.5',
    'rerun_count':                      '10',
    'rerun_pass_rate':                  '0.9',
    'max_budget_usd':                   '2.00',
    'max_turns':                        '30',
    'retention_days':                   '90',
    'max_heals_per_test_per_week':      '3',
    'enable_selector_fixes':            'true',
    'enable_wait_fixes':                'true',
    'enable_assertion_fixes':           'true',
    'enable_slow_fixes':                'true',
    'startup_timeout_seconds':          '120',
  };
  const map = { ...defaults, ...overrides };
  getInputMock.mockImplementation((name: string) => map[name] ?? '');
}

describe('runDryRun: SC#1 composite-action output', () => {
  it('calls core.setOutput exactly once with key dryRunSummary (anthropic + canary key)', async () => {
    scriptInputs({});
    // Re-import the module fresh so the mocked @actions/core is in effect.
    vi.resetModules();
    await import('../../src/index.js');
    // index.ts top-level invokes main(); allow the microtask queue to drain.
    await vi.waitFor(() => expect(setOutputMock).toHaveBeenCalled());

    expect(setOutputMock).toHaveBeenCalledTimes(1);
    expect(setOutputMock.mock.calls[0][0]).toBe('dryRunSummary');
  });

  it('publishes the same markdown to the output and to core.summary.addRaw (single source of truth)', async () => {
    scriptInputs({});
    vi.resetModules();
    await import('../../src/index.js');
    await vi.waitFor(() => expect(setOutputMock).toHaveBeenCalled());

    expect(setOutputMock.mock.calls[0][0]).toBe('dryRunSummary');
    const summaryArg = summaryAddRawMock.mock.calls[0]?.[0];
    const outputArg = setOutputMock.mock.calls[0]?.[1];
    expect(summaryArg).toBeTypeOf('string');
    expect(outputArg).toBe(summaryArg); // byte-identical
  });

  it('the published markdown contains all 5 anchors required by phase1-self-test Scenarios 4+5 (anthropic case)', async () => {
    scriptInputs({});
    vi.resetModules();
    await import('../../src/index.js');
    await vi.waitFor(() => expect(setOutputMock).toHaveBeenCalled());

    expect(setOutputMock.mock.calls[0][0]).toBe('dryRunSummary');
    const md = setOutputMock.mock.calls[0][1] as string;
    expect(md).toContain('# playwright-healer — dry-run summary');
    expect(md).toContain('| `provider` | anthropic |');
    expect(md).toContain('| `api_endpoint` | (default) |');
    expect(md).toContain('| `api_key` | (set — redacted) |');
    expect(md).not.toContain('test-canary-DO-NOT-USE-REAL-KEY');
  });

  it('the published markdown contains the ollama-exception cell when provider=ollama + empty api_key (Scenario 5 case)', async () => {
    scriptInputs({
      'provider': 'ollama',
      'api_key': '',
      'api_endpoint': 'http://localhost:11434',
    });
    vi.resetModules();
    await import('../../src/index.js');
    await vi.waitFor(() => expect(setOutputMock).toHaveBeenCalled());

    expect(setOutputMock.mock.calls[0][0]).toBe('dryRunSummary');
    const md = setOutputMock.mock.calls[0][1] as string;
    expect(md).toContain('| `provider` | ollama |');
    expect(md).toContain('| `api_endpoint` | http://localhost:11434 |');
    expect(md).toContain('(empty — allowed for ollama)');
  });

  it('addRaw → write → setOutput call order is preserved', async () => {
    scriptInputs({});
    vi.resetModules();
    await import('../../src/index.js');
    await vi.waitFor(() => expect(setOutputMock).toHaveBeenCalled());

    expect(setOutputMock.mock.calls[0][0]).toBe('dryRunSummary');
    const addRawOrder = summaryAddRawMock.mock.invocationCallOrder[0];
    const writeOrder = writeMock.mock.invocationCallOrder[0];
    const setOutputOrder = setOutputMock.mock.invocationCallOrder[0];
    expect(addRawOrder).toBeLessThan(writeOrder);
    expect(writeOrder).toBeLessThan(setOutputOrder);
  });
});
