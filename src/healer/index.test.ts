import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Config } from '../shared/config.js';

// vi.hoisted ensures these are initialized before vi.mock factories run (hoisting semantics).
const {
  mockBundleContext,
  mockValidate,
  mockApplyFix,
  mockOpenPr,
  mockOpenIssue,
  mockLintDiff,
  mockAssemblePrompt,
  mockSupervisorStop,
  mockRunAgent,
  mockCreateGeminiAdapter,
  mockCreateGithubAdapter,
} = vi.hoisted(() => {
  const mockRunAgent = vi.fn();
  const mockCreateGeminiAdapter = vi.fn().mockReturnValue({ runAgent: mockRunAgent });
  const mockCreateGithubAdapter = vi.fn().mockReturnValue({ runAgent: mockRunAgent });
  return {
    mockBundleContext: vi.fn(),
    mockValidate: vi.fn(),
    mockApplyFix: vi.fn(),
    mockOpenPr: vi.fn(),
    mockOpenIssue: vi.fn(),
    mockLintDiff: vi.fn(),
    mockAssemblePrompt: vi.fn(),
    mockSupervisorStop: vi.fn(),
    mockRunAgent,
    mockCreateGeminiAdapter,
    mockCreateGithubAdapter,
  };
});

vi.mock('./context-bundler.js', () => ({ bundleContext: mockBundleContext }));
vi.mock('./validator.js', () => ({ validate: mockValidate }));
vi.mock('./fix-applier.js', () => ({ applyFix: mockApplyFix, DiffApplyFailure: class extends Error {} }));
vi.mock('./pr-writer.js', () => ({ openHealerPr: mockOpenPr, renderPrBody: vi.fn() }));
vi.mock('./issue-writer.js', () => ({ openIssue: mockOpenIssue, renderIssueBody: vi.fn() }));
vi.mock('./diff-lint.js', () => ({ lintDiff: mockLintDiff }));
vi.mock('./prompt-assembler.js', () => ({ assemblePrompt: mockAssemblePrompt }));
vi.mock('./app-supervisor.js', () => ({
  stop: mockSupervisorStop,
  PID_FILE_PATH: '/tmp/playwright-healer-app-pid',
  AppStartupTimeout: class extends Error {},
  waitForReady: vi.fn(),
  readPidFile: vi.fn(),
}));
vi.mock('./adapters/gemini.js', () => ({ createGeminiAdapter: mockCreateGeminiAdapter }));
vi.mock('./adapters/github.js', () => ({ createGithubAdapter: mockCreateGithubAdapter }));
vi.mock('./adapters/anthropic.js', () => ({
  anthropicAdapter: { runAgent: vi.fn().mockRejectedValue(new Error('anthropic adapter not implemented in Phase 3')) },
}));
vi.mock('./adapters/ollama.js', () => ({
  ollamaAdapter: { runAgent: vi.fn().mockRejectedValue(new Error('ollama adapter not implemented in Phase 3')) },
}));

let mockSetFailed = vi.fn();
vi.mock('@actions/core', () => ({
  setFailed: (msg: string) => mockSetFailed(msg),
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  summary: { addRaw: vi.fn().mockReturnThis(), write: vi.fn().mockResolvedValue(undefined) },
}));

let mockPayload: any = {};
vi.mock('@actions/github', () => ({
  context: {
    get payload() { return mockPayload; },
    repo: { owner: 'acme', repo: 'repo' },
    runId: 123,
    serverUrl: 'https://github.com',
  },
}));

import { run } from './index.js';
import { BudgetExhausted } from './budget.js';
import * as core from '@actions/core';

const baseConfig: Config = {
  mode: 'heal',
  setupCommand: '', startCommand: '', testCommand: '', baseUrl: 'http://localhost:3000',
  apiKey: 'test', healerToken: 'pat', githubToken: 'gh',
  provider: 'gemini', model: '', apiEndpoint: '',
  reportPath: 'r', flakeRateThreshold: 0.2, flakeWindowDays: 7, slowRegressionPct: 1.5,
  rerunCount: 10, rerunPassRate: 0.9, maxBudgetUsd: 2.0, maxTurns: 30,
  retentionDays: 90, maxHealsPerTestPerWeek: 3, stateBranchName: 'playwright-healer-state',
  enableSelectorFixes: true, enableWaitFixes: true, enableAssertionFixes: true, enableSlowFixes: true,
  startupTimeoutSeconds: 120,
  // Phase 03.1 demo-mode skip flags — all false by default (production behavior unchanged)
  skipDeterministicCheck: false,
  skipPostFixValidation: false,
  skipDiffLint: false,
} as Config;

const validPayload = {
  commitSha: 'abc1234',
  testFile: 'tests/checkout.spec.ts',
  testTitle: 'completes purchase',
  fixClassHint: 'selectors',
  concurrencyKey: 'tests/checkout.spec.ts::completes purchase',
};

const validFixProposal = {
  rootCause: 'Selector wrong',
  fixClass: 'selectors' as const,
  diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n',
  rationale: 'getByRole is more stable',
};

// Helper: adapter return shape per revised contract (`{ proposal, stats }`).
function adapterResult(proposal: any, stats = { usdSpent: 0.42, turnsUsed: 5 }) {
  return { proposal, stats };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSetFailed = vi.fn();
  mockPayload = { inputs: validPayload };
  mockBundleContext.mockResolvedValue({
    testFile: validPayload.testFile, testTitle: validPayload.testTitle,
    testFileSource: '', firstHopImports: {}, gitBlame: '',
    traceAttachmentPath: null, recentErrorMessages: [],
  });
  mockAssemblePrompt.mockReturnValue('system prompt');
  mockLintDiff.mockReturnValue([]);
  mockApplyFix.mockResolvedValue({ branch: 'playwright-healer/X-abc1234', commitSha: 'deadbeef' });
  mockOpenPr.mockResolvedValue('https://github.com/acme/repo/pull/1');
  mockOpenIssue.mockResolvedValue('https://github.com/acme/repo/issues/1');
  // Re-apply mockReturnValue since clearAllMocks clears implementations
  mockCreateGeminiAdapter.mockReturnValue({ runAgent: mockRunAgent });
  mockCreateGithubAdapter.mockReturnValue({ runAgent: mockRunAgent });
});

describe('run() — D-09 routing tree', () => {
  it('Step 1: invalid dispatch payload calls core.setFailed and returns', async () => {
    mockPayload = { inputs: { commitSha: 'not-hex' } };
    await run(baseConfig);
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringMatching(/Invalid dispatch payload/));
    expect(mockOpenIssue).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it('PRI-05: deterministic 0/N routes to deterministic-failure issue, adapter not called', async () => {
    mockValidate.mockResolvedValueOnce({ passed: 0, total: 10, passRate: 0, perRun: [] });
    await run(baseConfig);
    expect(mockOpenIssue).toHaveBeenCalledWith(expect.objectContaining({
      failureMode: 'deterministic-failure',
    }));
    expect(mockRunAgent).not.toHaveBeenCalled();
    expect(mockApplyFix).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it('FIX-02: BudgetExhausted from adapter routes to agent-budget-exhausted issue with at-throw stats', async () => {
    mockValidate.mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] });
    const err = new BudgetExhausted('test budget exhausted', { usdSpent: 0.5, turnsUsed: 10 });
    mockRunAgent.mockRejectedValueOnce(err);
    await run(baseConfig);
    expect(mockOpenIssue).toHaveBeenCalledWith(expect.objectContaining({
      failureMode: 'agent-budget-exhausted',
    }));
    // PRI-02 data path: issue body MUST mention the spend before the throw
    const issueArgs = mockOpenIssue.mock.calls[0][0];
    expect(issueArgs.rootCause).toMatch(/\$0\.5000/);
    expect(issueArgs.rootCause).toMatch(/10 turn/);
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it('FIX-08: NoFixProposable routes to no-fix-proposable issue, body includes stats', async () => {
    mockValidate.mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] });
    mockRunAgent.mockResolvedValueOnce(adapterResult({ reason: 'no-fix-proposable', evidence: 'tried 9 selectors' }, { usdSpent: 0.30, turnsUsed: 8 }));
    await run(baseConfig);
    expect(mockOpenIssue).toHaveBeenCalledWith(expect.objectContaining({
      failureMode: 'no-fix-proposable',
    }));
    const issueArgs = mockOpenIssue.mock.calls[0][0];
    expect(issueArgs.suggestedManualFix).toMatch(/\$0\.3000/);
    expect(issueArgs.suggestedManualFix).toMatch(/8 turn/);
    expect(mockApplyFix).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it('FIX-06: diff-lint findings route to diff-lint-blocked issue, body includes stats', async () => {
    mockValidate.mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] });
    mockRunAgent.mockResolvedValueOnce(adapterResult(validFixProposal, { usdSpent: 0.55, turnsUsed: 12 }));
    mockLintDiff.mockReturnValueOnce([{ pattern: 'waitForTimeout', filePath: 'tests/x.spec.ts', hunkLine: 1, excerpt: '+ await page.waitForTimeout(3000);' }]);
    await run(baseConfig);
    expect(mockOpenIssue).toHaveBeenCalledWith(expect.objectContaining({
      failureMode: 'diff-lint-blocked',
    }));
    const issueArgs = mockOpenIssue.mock.calls[0][0];
    expect(issueArgs.suggestedManualFix).toMatch(/\$0\.5500/);
    expect(mockApplyFix).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it('VAL-03: pass rate below threshold routes to validation-failed issue, body includes stats', async () => {
    // First validate (sanity) returns mid; second (post-fix) returns below threshold.
    mockValidate
      .mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] })
      .mockResolvedValueOnce({ passed: 6, total: 10, passRate: 0.6, perRun: [] });
    mockRunAgent.mockResolvedValueOnce(adapterResult(validFixProposal, { usdSpent: 0.77, turnsUsed: 15 }));
    await run(baseConfig);
    expect(mockOpenIssue).toHaveBeenCalledWith(expect.objectContaining({
      failureMode: 'validation-failed',
    }));
    const issueArgs = mockOpenIssue.mock.calls[0][0];
    expect(issueArgs.rootCause).toMatch(/\$0\.7700/);
    expect(issueArgs.suggestedManualFix).toMatch(/15 turn/);
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it('Happy path: opens a PR with costUsd from stats.usdSpent (PRI-02)', async () => {
    mockValidate
      .mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] })
      .mockResolvedValueOnce({ passed: 10, total: 10, passRate: 1.0, perRun: [] });
    mockRunAgent.mockResolvedValueOnce(adapterResult(validFixProposal, { usdSpent: 0.42, turnsUsed: 5 }));
    await run(baseConfig);
    expect(mockOpenPr).toHaveBeenCalledWith(expect.objectContaining({
      costUsd: 0.42, // PRI-02: REAL cost data, not 0
    }));
    expect(mockOpenIssue).not.toHaveBeenCalled();
  });

  it('PRI-02 regression guard: costUsd is never hardcoded 0 when stats.usdSpent > 0', async () => {
    mockValidate
      .mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] })
      .mockResolvedValueOnce({ passed: 10, total: 10, passRate: 1.0, perRun: [] });
    mockRunAgent.mockResolvedValueOnce(adapterResult(validFixProposal, { usdSpent: 1.234, turnsUsed: 7 }));
    await run(baseConfig);
    const prArgs = mockOpenPr.mock.calls[0][0];
    expect(prArgs.costUsd).not.toBe(0);
    expect(prArgs.costUsd).toBeCloseTo(1.234, 3);
  });
});

describe('run() — HEA-06 inner cleanup', () => {
  it('calls supervisorStop on success', async () => {
    mockValidate
      .mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] })
      .mockResolvedValueOnce({ passed: 10, total: 10, passRate: 1.0, perRun: [] });
    mockRunAgent.mockResolvedValueOnce(adapterResult(validFixProposal));
    await run(baseConfig);
    expect(mockSupervisorStop).toHaveBeenCalled();
  });

  it('calls supervisorStop when adapter throws unexpectedly', async () => {
    mockValidate.mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] });
    mockRunAgent.mockRejectedValueOnce(new Error('network meltdown'));
    await run(baseConfig);  // run() no longer throws — outer catch handles it
    expect(mockSupervisorStop).toHaveBeenCalled();
    expect(mockSetFailed).toHaveBeenCalledWith('network meltdown');
  });
});

describe('run() — provider switch (D-01)', () => {
  it('config.provider=anthropic → stub error routes to no-fix-proposable issue (HI-03)', async () => {
    mockValidate.mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] });
    await run({ ...baseConfig, provider: 'anthropic' });  // no longer throws
    expect(mockOpenIssue).toHaveBeenCalledWith(expect.objectContaining({
      failureMode: 'no-fix-proposable',
    }));
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringMatching(/anthropic adapter not implemented/));
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it('config.provider=ollama → stub error routes to no-fix-proposable issue (HI-03)', async () => {
    mockValidate.mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] });
    await run({ ...baseConfig, provider: 'ollama' });  // no longer throws
    expect(mockOpenIssue).toHaveBeenCalledWith(expect.objectContaining({
      failureMode: 'no-fix-proposable',
    }));
    expect(mockSetFailed).toHaveBeenCalledWith(expect.stringMatching(/ollama adapter not implemented/));
  });

  it('config.provider=gemini → createGeminiAdapter is called with config values', async () => {
    mockValidate
      .mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] })
      .mockResolvedValueOnce({ passed: 10, total: 10, passRate: 1.0, perRun: [] });
    mockRunAgent.mockResolvedValueOnce(adapterResult(validFixProposal));
    await run(baseConfig);
    expect(mockCreateGeminiAdapter).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'test', maxTurns: 30, maxBudgetUsd: 2.0, baseUrl: 'http://localhost:3000',
    }));
  });

  it('config.provider=github → createGithubAdapter is called with config values + default endpoint', async () => {
    mockValidate
      .mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] })
      .mockResolvedValueOnce({ passed: 10, total: 10, passRate: 1.0, perRun: [] });
    mockRunAgent.mockResolvedValueOnce(adapterResult(validFixProposal));
    await run({ ...baseConfig, provider: 'github' });
    expect(mockCreateGithubAdapter).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'test',
      maxTurns: 30,
      baseUrl: 'http://localhost:3000',
      endpoint: 'https://models.github.ai/inference',
      model: 'openai/gpt-4.1',
    }));
  });

  it('config.provider=github → custom api_endpoint and model override defaults', async () => {
    mockValidate
      .mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] })
      .mockResolvedValueOnce({ passed: 10, total: 10, passRate: 1.0, perRun: [] });
    mockRunAgent.mockResolvedValueOnce(adapterResult(validFixProposal));
    await run({
      ...baseConfig,
      provider: 'github',
      model: 'openai/gpt-4o-mini',
      apiEndpoint: 'https://models.example.test/inference',
    });
    expect(mockCreateGithubAdapter).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/gpt-4o-mini',
      endpoint: 'https://models.example.test/inference',
    }));
  });
});

describe('run() — HI-01 cwd threading', () => {
  it('passes GITHUB_WORKSPACE as cwd to both validate() call sites', async () => {
    const originalWs = process.env['GITHUB_WORKSPACE'];
    process.env['GITHUB_WORKSPACE'] = '/consumer/workspace';
    try {
      mockValidate
        .mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] })
        .mockResolvedValueOnce({ passed: 10, total: 10, passRate: 1.0, perRun: [] });
      mockRunAgent.mockResolvedValueOnce(adapterResult(validFixProposal));
      await run(baseConfig);
      // Both validate() calls (Step 4 sanity and Step 10 post-fix) should receive cwd
      expect(mockValidate).toHaveBeenCalledTimes(2);
      expect(mockValidate.mock.calls[0][3]).toBe('/consumer/workspace');
      expect(mockValidate.mock.calls[1][3]).toBe('/consumer/workspace');
    } finally {
      if (originalWs === undefined) {
        delete process.env['GITHUB_WORKSPACE'];
      } else {
        process.env['GITHUB_WORKSPACE'] = originalWs;
      }
    }
  });
});

describe('run() — HI-03 outer catch D-09 routing', () => {
  it('routes bundleContext error to no-fix-proposable issue and calls core.setFailed', async () => {
    mockBundleContext.mockRejectedValueOnce(new Error('Path outside workspace: /etc/passwd'));
    await run(baseConfig);  // must NOT throw
    expect(mockOpenIssue).toHaveBeenCalledWith(expect.objectContaining({
      failureMode: 'no-fix-proposable',
      rootCause: expect.stringMatching(/Unexpected pipeline error:.*Path outside workspace/),
    }));
    expect(mockSetFailed).toHaveBeenCalledWith('Path outside workspace: /etc/passwd');
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it('calls supervisorStop even when outer catch fires (finally still runs)', async () => {
    mockBundleContext.mockRejectedValueOnce(new Error('boom'));
    await run(baseConfig);
    expect(mockSupervisorStop).toHaveBeenCalled();
  });
});

describe('run() — Phase 03.1 demo-mode skip flags (HEA-04 / HEA-05)', () => {
  it('skipDeterministicCheck=true: gate bypassed when passRate=0, adapter called', async () => {
    // Sanity rerun returns passRate=0 (always-failing fixture); skip flag prevents
    // the deterministic-failure issue from being filed and lets the run proceed to Gemini.
    mockValidate.mockResolvedValueOnce({ passed: 0, total: 3, passRate: 0, perRun: [] });
    mockRunAgent.mockResolvedValue({
      proposal: { diff: 'diff', rootCause: 'r', rationale: 'r', fixClass: 'selectors' },
      stats: { usdSpent: 0.01, turnsUsed: 1 },
    });
    mockApplyFix.mockResolvedValue({ branch: 'healer/fix-branch' });
    mockValidate.mockResolvedValue({ passed: 3, total: 3, passRate: 1, perRun: [] });
    await run({ ...baseConfig, skipDeterministicCheck: true });
    expect(mockOpenIssue).not.toHaveBeenCalledWith(
      expect.objectContaining({ failureMode: 'deterministic-failure' }),
    );
    expect(mockRunAgent).toHaveBeenCalled();
  });

  it('skipDiffLint=true: diff-lint findings ignored, fix applied', async () => {
    mockValidate.mockResolvedValueOnce({ passed: 3, total: 3, passRate: 1, perRun: [] });
    mockRunAgent.mockResolvedValue({
      proposal: { diff: 'diff', rootCause: 'r', rationale: 'r', fixClass: 'selectors' },
      stats: { usdSpent: 0.01, turnsUsed: 1 },
    });
    mockLintDiff.mockReturnValue([{ pattern: 'waitForTimeout', line: 1 }]);
    mockApplyFix.mockResolvedValue({ branch: 'healer/fix-branch' });
    mockValidate.mockResolvedValueOnce({ passed: 3, total: 3, passRate: 1, perRun: [] });
    await run({ ...baseConfig, skipDiffLint: true });
    expect(mockOpenIssue).not.toHaveBeenCalledWith(
      expect.objectContaining({ failureMode: 'diff-lint-blocked' }),
    );
    expect(mockApplyFix).toHaveBeenCalled();
  });

  it('skipPostFixValidation=true: validate called only once (sanity), PR opened', async () => {
    mockValidate.mockResolvedValueOnce({ passed: 3, total: 3, passRate: 1, perRun: [] });
    mockRunAgent.mockResolvedValue({
      proposal: { diff: 'diff', rootCause: 'r', rationale: 'r', fixClass: 'selectors' },
      stats: { usdSpent: 0.01, turnsUsed: 1 },
    });
    mockApplyFix.mockResolvedValue({ branch: 'healer/fix-branch' });
    // Note: no second mockResolvedValue for validate — it MUST not be called twice.
    await run({ ...baseConfig, skipPostFixValidation: true });
    expect(mockValidate).toHaveBeenCalledTimes(1);
    expect(mockOpenPr).toHaveBeenCalled();
  });

  // CRITICAL — B-1 regression guard:
  // When post-fix validation is skipped, openHealerPr must still receive a fully-formed
  // ValidationResult (with perRun: []), NOT undefined or a partial object. pr-writer.ts
  // does `args.validation.perRun.map(...)` and crashes if perRun is undefined.
  it('skipPostFixValidation=true: openHealerPr receives a sentinel ValidationResult with perRun: []', async () => {
    mockValidate.mockResolvedValueOnce({ passed: 3, total: 3, passRate: 1, perRun: [] });
    mockRunAgent.mockResolvedValue({
      proposal: { diff: 'diff', rootCause: 'r', rationale: 'r', fixClass: 'selectors' },
      stats: { usdSpent: 0.01, turnsUsed: 1 },
    });
    mockApplyFix.mockResolvedValue({ branch: 'healer/fix-branch' });
    await run({ ...baseConfig, skipPostFixValidation: true });
    expect(mockOpenPr).toHaveBeenCalledWith(
      expect.objectContaining({
        validation: expect.objectContaining({
          perRun: expect.any(Array),
          passed: expect.any(Number),
          total: expect.any(Number),
          passRate: expect.any(Number),
        }),
      }),
    );
    // perRun must be an array (length 0 is OK), never undefined.
    const call = mockOpenPr.mock.calls[0][0];
    expect(Array.isArray(call.validation.perRun)).toBe(true);
  });
});

describe('run() — FIX-07 LLM override observability (RESEARCH §FIX-07 Architecture line 446)', () => {
  it('logs Agent overrode fixClassHint when agent returns a different fixClass than hinted', async () => {
    // Dispatch payload hinted 'selectors'; agent returns 'assertions'
    mockPayload = {
      inputs: {
        ...validPayload,
        fixClassHint: 'selectors',
      },
    };
    mockValidate
      .mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] })
      .mockResolvedValueOnce({ passed: 10, total: 10, passRate: 1.0, perRun: [] });
    mockRunAgent.mockResolvedValueOnce(adapterResult({
      rootCause: 'Assertion wrong',
      fixClass: 'assertions',
      diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-x\n+y\n',
      rationale: 'correct expected value',
    }));
    await run(baseConfig);
    expect(core.info).toHaveBeenCalledWith(
      expect.stringMatching(/Agent overrode fixClassHint: hinted=selectors, chose=assertions/),
    );
  });

  it('does NOT log override message when agent fixClass matches fixClassHint', async () => {
    // Dispatch payload hinted 'selectors'; agent returns 'selectors' — no override
    mockPayload = {
      inputs: {
        ...validPayload,
        fixClassHint: 'selectors',
      },
    };
    mockValidate
      .mockResolvedValueOnce({ passed: 5, total: 10, passRate: 0.5, perRun: [] })
      .mockResolvedValueOnce({ passed: 10, total: 10, passRate: 1.0, perRun: [] });
    mockRunAgent.mockResolvedValueOnce(adapterResult(validFixProposal));
    await run(baseConfig);
    const overrideCallMade = (core.info as ReturnType<typeof vi.fn>).mock.calls.some(
      (args: unknown[]) => typeof args[0] === 'string' && args[0].includes('Agent overrode fixClassHint'),
    );
    expect(overrideCallMade).toBe(false);
  });
});
