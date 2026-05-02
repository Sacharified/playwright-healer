import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPullsCreate = vi.fn();
const mockPullsList = vi.fn();
const mockIssuesCreateComment = vi.fn();
const mockGraphql = vi.fn(); // Task 3: graphql mock for enableAutoMerge tests

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () {
    return {
      rest: {
        pulls: { create: mockPullsCreate, list: mockPullsList },
        issues: { create: vi.fn(), createComment: mockIssuesCreateComment },
      },
      graphql: mockGraphql, // Task 3: expose graphql on the mock instance
    };
  }),
}));

vi.mock('@actions/core', () => ({
  summary: {
    addRaw: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined),
  },
  warning: vi.fn(),
}));

import { openHealerPr, renderPrBody, evaluateAutoMerge, enableAutoMerge, renderAutoMergeBand, type AutoMergeDecision } from './pr-writer.js';
import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';
import { GraphqlResponseError } from '@octokit/graphql';

const mkArgs = (over: any = {}) => ({
  patToken: 'pat-secret-12345',
  owner: 'octocat',
  repo: 'repo',
  testTitle: 'completes purchase flow',
  testFile: 'tests/checkout.spec.ts',
  defaultBranch: 'main',
  branch: 'playwright-healer/foo-bar-abc1234',
  rootCause: 'Selector #wrong-id does not match button',
  fixClass: 'selectors' as const,
  rationale: 'getByRole is more stable',
  validation: {
    passed: 9,
    total: 10,
    passRate: 0.9,
    perRun: [{ status: 'passed' as const, durationMs: 100 }],
  },
  costUsd: 0.1234,
  triggeringRunUrl: 'https://github.com/octocat/repo/actions/runs/123',
  traceLink: null as string | null,
  // Plan 01 additions — defaults make legacy tests pass unchanged:
  enableAutoMerge: false,
  autoMergePassRate: 1.0,
  autoMergeFixClasses: ['selectors'],
  patchedFiles: ['tests/checkout.spec.ts'],
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no existing PR (dedup returns empty)
  mockPullsList.mockResolvedValue({ data: [] });
  mockPullsCreate.mockResolvedValue({ data: { html_url: 'https://github.com/octocat/repo/pull/42', node_id: 'PR_kwabc123' } });
  mockIssuesCreateComment.mockResolvedValue({});
  // mockGraphql has no default implementation — each test sets its own mock
});

describe('pr-writer — PRI-01 (title + branch)', () => {
  it('uses the locked title format', async () => {
    await openHealerPr(mkArgs());
    expect(mockPullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '[playwright-healer] Fix flaky completes purchase flow',
        head: 'playwright-healer/foo-bar-abc1234',
        base: 'main',
      }),
    );
  });
});

describe('pr-writer — PRI-02 / VAL-05 (body content)', () => {
  it('body contains required PRI-02 elements', () => {
    const body = renderPrBody(mkArgs());
    expect(body).toMatch(/Root cause/);
    expect(body).toMatch(/Selector #wrong-id/);
    expect(body).toMatch(/Fix class:.*selectors/);
    expect(body).toMatch(/90%/); // pass rate
    expect(body).toMatch(/9\/10/);
    expect(body).toMatch(/\$0\.1234/);
    expect(body).toMatch(/Triggering run/);
    expect(body).toMatch(/Signed-off: playwright-healer-bot/);
  });

  it('includes trace link when traceLink is set', () => {
    const body = renderPrBody(mkArgs({ traceLink: 'https://example.com/trace.zip' }));
    expect(body).toMatch(/Playwright trace/);
  });

  it('omits trace link when traceLink is null', () => {
    const body = renderPrBody(mkArgs({ traceLink: null }));
    expect(body).not.toMatch(/Playwright trace/);
  });
});

describe('pr-writer — PRI-06 / SC-5 (sentinel in body)', () => {
  it('body ends with [skip-healer] sentinel', () => {
    const body = renderPrBody(mkArgs());
    expect(body).toMatch(/\[skip-healer\]/);
  });

  it('does not inline-literal the sentinel — sources from loop-guard.ts', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/healer/pr-writer.ts', 'utf8');
    expect(src).toMatch(/import.*SKIP_SENTINEL.*loop-guard/);
  });
});

describe('pr-writer — T-3-PIT-01 (PAT auth, NOT GITHUB_TOKEN)', () => {
  it('constructs Octokit with the patToken', async () => {
    await openHealerPr(mkArgs());
    expect(vi.mocked(Octokit)).toHaveBeenCalledWith({ auth: 'pat-secret-12345' });
  });

  it('does NOT import from @actions/github (would force GITHUB_TOKEN path)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/healer/pr-writer.ts', 'utf8');
    expect(src).not.toMatch(/from\s+['"]@actions\/github['"]/);
  });
});

describe('pr-writer — T-3-PRI-PI (no secrets in body)', () => {
  it('body does not interpolate the patToken', () => {
    const body = renderPrBody(mkArgs({ patToken: 'should-not-appear-in-body' }));
    expect(body).not.toMatch(/should-not-appear-in-body/);
  });
});

describe('pr-writer — D-11 step summary parity', () => {
  it('returns the PR URL', async () => {
    const url = await openHealerPr(mkArgs());
    expect(url).toBe('https://github.com/octocat/repo/pull/42');
  });
});

// PRI-04 dedup tests

describe('pr-writer — PRI-04 dedup (Test 1: no existing PR)', () => {
  it('calls pulls.create when no existing PR exists', async () => {
    mockPullsList.mockResolvedValue({ data: [] });
    await openHealerPr(mkArgs());
    expect(mockPullsCreate).toHaveBeenCalledTimes(1);
    expect(mockIssuesCreateComment).not.toHaveBeenCalled();
  });

  it('returns the new PR URL when no existing PR exists', async () => {
    mockPullsList.mockResolvedValue({ data: [] });
    const url = await openHealerPr(mkArgs());
    expect(url).toBe('https://github.com/octocat/repo/pull/42');
  });
});

describe('pr-writer — PRI-04 dedup (Test 2: existing open PR for same branch)', () => {
  it('does NOT call pulls.create when existing open PR found', async () => {
    mockPullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/octocat/repo/pull/42' }],
    });
    await openHealerPr(mkArgs());
    expect(mockPullsCreate).not.toHaveBeenCalled();
  });

  it('calls issues.createComment with the existing PR number', async () => {
    mockPullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/octocat/repo/pull/42' }],
    });
    await openHealerPr(mkArgs());
    expect(mockIssuesCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 42 }),
    );
  });

  it('returns the existing PR URL on dedup hit', async () => {
    mockPullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/octocat/repo/pull/42' }],
    });
    const url = await openHealerPr(mkArgs());
    expect(url).toBe('https://github.com/octocat/repo/pull/42');
  });
});

describe('pr-writer — PRI-04 dedup (Test 3: head filter format — Pitfall 3)', () => {
  it('uses owner:branch format in the head filter', async () => {
    await openHealerPr(mkArgs());
    expect(mockPullsList).toHaveBeenCalledWith(
      expect.objectContaining({
        head: 'octocat:playwright-healer/foo-bar-abc1234',
      }),
    );
  });
});

describe('pr-writer — PRI-04 dedup (Test 4: closed PR state filter)', () => {
  it('queries only open PRs (state: open)', async () => {
    await openHealerPr(mkArgs());
    expect(mockPullsList).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'open',
      }),
    );
  });
});

describe('pr-writer — PRI-04 dedup (Test 5: dedup query failure falls through)', () => {
  it('proceeds to create when pulls.list throws', async () => {
    mockPullsList.mockRejectedValue(new Error('network error'));
    const url = await openHealerPr(mkArgs());
    expect(url).toBe('https://github.com/octocat/repo/pull/42');
    expect(mockPullsCreate).toHaveBeenCalledTimes(1);
  });

  it('logs a warning when dedup query fails', async () => {
    mockPullsList.mockRejectedValue(new Error('rate limit exceeded'));
    await openHealerPr(mkArgs());
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
      expect.stringContaining('PRI-04: dedup query failed'),
    );
  });
});

describe('pr-writer — PRI-04 dedup (Test 6: step summary heading)', () => {
  it('summary contains ## Healer PR updated (dedup) on dedup hit', async () => {
    mockPullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/octocat/repo/pull/42' }],
    });
    await openHealerPr(mkArgs());
    expect(vi.mocked(core.summary.addRaw)).toHaveBeenCalledWith(
      expect.stringContaining('## Healer PR updated (dedup)'),
    );
  });

  it('summary contains ## Healer PR opened on no-match', async () => {
    mockPullsList.mockResolvedValue({ data: [] });
    await openHealerPr(mkArgs());
    expect(vi.mocked(core.summary.addRaw)).toHaveBeenCalledWith(
      expect.stringContaining('## Healer PR opened'),
    );
  });
});

describe('pr-writer — PRI-04 dedup (Test 7: comment body includes new evidence)', () => {
  it('comment body contains Re-trigger evidence header', async () => {
    mockPullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/octocat/repo/pull/42' }],
    });
    await openHealerPr(mkArgs());
    const commentCall = mockIssuesCreateComment.mock.calls[0][0];
    expect(commentCall.body).toContain('Re-trigger evidence');
  });

  it('comment body contains rootCause from new heal', async () => {
    mockPullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/octocat/repo/pull/42' }],
    });
    await openHealerPr(mkArgs({ rootCause: 'New root cause for re-trigger' }));
    const commentCall = mockIssuesCreateComment.mock.calls[0][0];
    expect(commentCall.body).toContain('New root cause for re-trigger');
  });

  it('comment body contains fixClass from new heal', async () => {
    mockPullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/octocat/repo/pull/42' }],
    });
    await openHealerPr(mkArgs({ fixClass: 'assertions' as const }));
    const commentCall = mockIssuesCreateComment.mock.calls[0][0];
    expect(commentCall.body).toContain('assertions');
  });

  it('comment body contains validation pass-rate from new heal', async () => {
    mockPullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/octocat/repo/pull/42' }],
    });
    await openHealerPr(mkArgs({ validation: { passed: 8, total: 10, passRate: 0.8, perRun: [{ status: 'passed' as const, durationMs: 100 }] } }));
    const commentCall = mockIssuesCreateComment.mock.calls[0][0];
    expect(commentCall.body).toContain('80%');
  });
});

// ── WR-02: renderPrBody total===0 special-case ───────────────────────────────

describe('pr-writer — WR-02 (Test 3: sentinel passRate=0 total=0 renders skipped)', () => {
  it('renders "skipped (post-fix validation disabled)" when total === 0', () => {
    const body = renderPrBody(mkArgs({
      validation: { passed: 0, total: 0, passRate: 0, perRun: [] },
    }));
    expect(body).toMatch(/skipped \(post-fix validation disabled\)/);
    // Must NOT render "100%" or "0/0" which misled reviewers
    expect(body).not.toMatch(/100%/);
    expect(body).not.toMatch(/0\/0/);
  });

  it('still renders the cost line when validation is skipped', () => {
    const body = renderPrBody(mkArgs({
      validation: { passed: 0, total: 0, passRate: 0, perRun: [] },
      costUsd: 0.0123,
    }));
    expect(body).toMatch(/\$0\.0123/);
  });
});

describe('pr-writer — WR-02 (Test 4: backwards compat for non-zero total)', () => {
  it('renders pass rate percentage when total > 0', () => {
    const body = renderPrBody(mkArgs({
      validation: { passed: 9, total: 10, passRate: 0.9, perRun: [{ status: 'passed' as const, durationMs: 100 }] },
    }));
    expect(body).toMatch(/90%/);
    expect(body).toMatch(/9\/10/);
    // Must NOT show the skipped message
    expect(body).not.toMatch(/skipped \(post-fix validation disabled\)/);
  });
});

// ── Phase 05: evaluateAutoMerge() pure function tests ───────────────────────

const mkEvalArgs = (over: Partial<Parameters<typeof evaluateAutoMerge>[0]> = {}) => ({
  validation: { passed: 10, total: 10, passRate: 1.0, perRun: [] },
  autoMergePassRate: 1.0,
  fixClass: 'selectors' as const,
  autoMergeFixClasses: ['selectors'],
  patchedFiles: ['tests/foo.spec.ts'],
  ...over,
});

describe('pr-writer — Phase 05 evaluateAutoMerge — pass_rate condition (D-07)', () => {
  it('PR1: validation skipped (total=0) → pass_rate blocked, eligible=false', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({
      validation: { passed: 0, total: 0, passRate: 0, perRun: [] },
    }));
    expect(decision.eligible).toBe(false);
    const cond = decision.conditions.find(c => c.condition === 'pass_rate')!;
    expect(cond.result).toBe('blocked');
    expect(cond.reason).toContain('validation skipped (demo mode)');
    expect(decision.conditions.length).toBe(4);
  });

  it('PR2: passRate above threshold → matched, reason contains count and threshold', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({
      validation: { passed: 10, total: 10, passRate: 1.0, perRun: [] },
      autoMergePassRate: 1.0,
    }));
    const cond = decision.conditions.find(c => c.condition === 'pass_rate')!;
    expect(cond.result).toBe('matched');
    expect(cond.reason).toContain('10/10');
    expect(decision.conditions.length).toBe(4);
  });

  it('PR3: passRate equal to threshold → matched', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({
      validation: { passed: 19, total: 20, passRate: 0.95, perRun: [] },
      autoMergePassRate: 0.95,
    }));
    const cond = decision.conditions.find(c => c.condition === 'pass_rate')!;
    expect(cond.result).toBe('matched');
    expect(decision.conditions.length).toBe(4);
  });

  it('PR4: passRate below threshold → blocked, reason contains percentages', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({
      validation: { passed: 9, total: 10, passRate: 0.9, perRun: [] },
      autoMergePassRate: 1.0,
    }));
    const cond = decision.conditions.find(c => c.condition === 'pass_rate')!;
    expect(cond.result).toBe('blocked');
    expect(cond.reason).toContain('90%');
    expect(cond.reason).toContain('100%');
    expect(decision.conditions.length).toBe(4);
  });

  it('PR5: passRate 9/10 vs strict 1.0 → blocked', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({
      validation: { passed: 9, total: 10, passRate: 0.9, perRun: [] },
      autoMergePassRate: 1.0,
    }));
    const cond = decision.conditions.find(c => c.condition === 'pass_rate')!;
    expect(cond.result).toBe('blocked');
    expect(decision.eligible).toBe(false);
    expect(decision.conditions.length).toBe(4);
  });
});

describe('pr-writer — Phase 05 evaluateAutoMerge — fix_class condition (MRG-02)', () => {
  it('FC1: selectors in default allow-list → matched', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ fixClass: 'selectors', autoMergeFixClasses: ['selectors'] }));
    const cond = decision.conditions.find(c => c.condition === 'fix_class')!;
    expect(cond.result).toBe('matched');
    expect(decision.conditions.length).toBe(4);
  });

  it('FC2: waits not in default allow-list → blocked, reason contains waits and selectors', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ fixClass: 'waits', autoMergeFixClasses: ['selectors'] }));
    const cond = decision.conditions.find(c => c.condition === 'fix_class')!;
    expect(cond.result).toBe('blocked');
    expect(cond.reason).toContain('waits');
    expect(cond.reason).toContain('selectors');
    expect(decision.conditions.length).toBe(4);
  });

  it('FC3: extended allow-list [selectors, waits], fixClass=waits → matched', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ fixClass: 'waits', autoMergeFixClasses: ['selectors', 'waits'] }));
    const cond = decision.conditions.find(c => c.condition === 'fix_class')!;
    expect(cond.result).toBe('matched');
    expect(decision.conditions.length).toBe(4);
  });

  it('FC4: extended allow-list with all classes, fixClass=slow → matched', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({
      fixClass: 'slow',
      autoMergeFixClasses: ['selectors', 'waits', 'assertions', 'slow'],
    }));
    const cond = decision.conditions.find(c => c.condition === 'fix_class')!;
    expect(cond.result).toBe('matched');
    expect(decision.conditions.length).toBe(4);
  });

  it('FC5: empty allow-list → blocked (defensive)', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ fixClass: 'selectors', autoMergeFixClasses: [] }));
    const cond = decision.conditions.find(c => c.condition === 'fix_class')!;
    expect(cond.result).toBe('blocked');
    expect(decision.eligible).toBe(false);
    expect(decision.conditions.length).toBe(4);
  });
});

describe('pr-writer — Phase 05 evaluateAutoMerge — scope condition (D-02 / TEST_PATH_ALLOWLIST re-use)', () => {
  it('SC1: tests/ file → matched', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['tests/foo.spec.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'scope')!;
    expect(cond.result).toBe('matched');
    expect(decision.conditions.length).toBe(4);
  });

  it('SC2: e2e/ file → matched', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['e2e/foo.spec.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'scope')!;
    expect(cond.result).toBe('matched');
    expect(decision.conditions.length).toBe(4);
  });

  it('SC3: playwright/ file → matched', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['playwright/foo.spec.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'scope')!;
    expect(cond.result).toBe('matched');
    expect(decision.conditions.length).toBe(4);
  });

  it('SC4: monorepo nested tests/ path → matched', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['packages/x/tests/foo.spec.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'scope')!;
    expect(cond.result).toBe('matched');
    expect(decision.conditions.length).toBe(4);
  });

  it('SC5: src/ file → blocked, reason names the offending path', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['src/foo.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'scope')!;
    expect(cond.result).toBe('blocked');
    expect(cond.reason).toContain('src/foo.ts');
    expect(decision.eligible).toBe(false);
    expect(decision.conditions.length).toBe(4);
  });

  it('SC6: mixed paths — first non-test path wins in reason', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['tests/a.ts', 'src/b.ts', 'src/c.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'scope')!;
    expect(cond.result).toBe('blocked');
    expect(cond.reason).toContain('src/b.ts');
    expect(cond.reason).not.toContain('src/c.ts');
    expect(decision.conditions.length).toBe(4);
  });

  it('SC7: empty patchedFiles → matched (vacuous)', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: [] }));
    const cond = decision.conditions.find(c => c.condition === 'scope')!;
    expect(cond.result).toBe('matched');
    expect(decision.conditions.length).toBe(4);
  });
});

describe('pr-writer — Phase 05 evaluateAutoMerge — config_files condition (D-03 / CONFIG_FILE_DENYLIST)', () => {
  it('CF1: root playwright.config.ts → blocked', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['playwright.config.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'config_files')!;
    expect(cond.result).toBe('blocked');
    expect(cond.reason).toContain('playwright.config.ts');
    expect(decision.conditions.length).toBe(4);
  });

  it('CF2: subdir playwright.config.ts → blocked', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['e2e/playwright.config.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'config_files')!;
    expect(cond.result).toBe('blocked');
    expect(decision.conditions.length).toBe(4);
  });

  it('CF3: root vitest.config.ts → blocked', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['vitest.config.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'config_files')!;
    expect(cond.result).toBe('blocked');
    expect(cond.reason).toContain('vitest.config.ts');
    expect(decision.conditions.length).toBe(4);
  });

  it('CF4: config file in tests/ subdir → blocked by config_files condition', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['tests/utils.config.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'config_files')!;
    expect(cond.result).toBe('blocked');
    expect(decision.conditions.length).toBe(4);
  });

  it('CF5: normal test file → config_files matched, reason no config', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['tests/foo.spec.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'config_files')!;
    expect(cond.result).toBe('matched');
    expect(cond.reason).toContain('no config files patched');
    expect(decision.conditions.length).toBe(4);
  });

  it('CF6: tests/config.ts (not .config.<ext> pattern) → matched (false-positive guard)', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['tests/config.ts'] }));
    const cond = decision.conditions.find(c => c.condition === 'config_files')!;
    expect(cond.result).toBe('matched');
    expect(decision.conditions.length).toBe(4);
  });

  it('CF7: .mjs and .cjs extensions → blocked', () => {
    const d1 = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['playwright.config.mjs'] }));
    expect(d1.conditions.find(c => c.condition === 'config_files')!.result).toBe('blocked');
    const d2 = evaluateAutoMerge(mkEvalArgs({ patchedFiles: ['playwright.config.cjs'] }));
    expect(d2.conditions.find(c => c.condition === 'config_files')!.result).toBe('blocked');
    expect(d1.conditions.length).toBe(4);
    expect(d2.conditions.length).toBe(4);
  });
});

describe('pr-writer — Phase 05 evaluateAutoMerge — eligible aggregation', () => {
  it('EA1: all conditions matched → eligible=true', () => {
    const decision = evaluateAutoMerge(mkEvalArgs());
    expect(decision.eligible).toBe(true);
    expect(decision.conditions.every(c => c.result === 'matched')).toBe(true);
    expect(decision.conditions.length).toBe(4);
  });

  it('EA2: one blocked (fix_class) → eligible=false', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({ fixClass: 'waits', autoMergeFixClasses: ['selectors'] }));
    expect(decision.eligible).toBe(false);
    expect(decision.conditions.length).toBe(4);
  });

  it('EA3: multiple blocked → eligible=false, both show blocked', () => {
    const decision = evaluateAutoMerge(mkEvalArgs({
      fixClass: 'waits',
      autoMergeFixClasses: ['selectors'],
      patchedFiles: ['src/foo.ts'],
    }));
    expect(decision.eligible).toBe(false);
    expect(decision.conditions.find(c => c.condition === 'fix_class')!.result).toBe('blocked');
    expect(decision.conditions.find(c => c.condition === 'scope')!.result).toBe('blocked');
    expect(decision.conditions.length).toBe(4);
  });

  it('EA4: conditions array always has length 4', () => {
    const cases = [
      mkEvalArgs(),
      mkEvalArgs({ validation: { passed: 0, total: 0, passRate: 0, perRun: [] } }),
      mkEvalArgs({ patchedFiles: ['src/app.ts'] }),
      mkEvalArgs({ patchedFiles: ['playwright.config.ts'] }),
    ];
    for (const args of cases) {
      expect(evaluateAutoMerge(args).conditions.length).toBe(4);
    }
  });
});

// ── Phase 05: enableAutoMerge() and renderAutoMergeBand() tests ──────────────

/** Helper to build a GraphqlResponseError for soft-fail tests */
const mkGraphqlError = (errors: Array<{ message: string; type: string }>) =>
  new GraphqlResponseError(
    { method: 'POST', url: '/graphql', headers: {}, query: '...', variables: {} } as any,
    {} as any,
    {
      data: null,
      errors: errors.map((e) => ({
        ...e,
        path: [],
        extensions: {},
        locations: [{ line: 1, column: 1 }],
      })),
    } as any,
  );

describe('pr-writer — Phase 05 enableAutoMerge — happy path (MRG-03)', () => {
  it('EA1: mutation called with correct variables, returns enabledAt', async () => {
    mockGraphql.mockResolvedValueOnce({
      enablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { enabledAt: '2026-05-02T10:00:00Z', mergeMethod: 'SQUASH' } },
      },
    });
    const octokit = new Octokit({ auth: 'test' });
    const result = await enableAutoMerge(octokit, 'PR_kwabc');
    expect(mockGraphql).toHaveBeenCalledTimes(1);
    const [mutationStr, variables] = mockGraphql.mock.calls[0];
    expect(mutationStr).toContain('enablePullRequestAutoMerge');
    expect(variables).toEqual({ pullRequestId: 'PR_kwabc', mergeMethod: 'SQUASH' });
    expect(result.enabledAt).toBe('2026-05-02T10:00:00Z');
    expect(result.errorMessage).toBeUndefined();
  });

  it('EA2: variables do NOT contain commitHeadline, commitBody, expectedHeadOid, authorEmail (T-05-06)', async () => {
    mockGraphql.mockResolvedValueOnce({
      enablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { enabledAt: '2026-05-02T10:00:00Z', mergeMethod: 'SQUASH' } },
      },
    });
    const octokit = new Octokit({ auth: 'test' });
    await enableAutoMerge(octokit, 'PR_kwabc');
    const [, variables] = mockGraphql.mock.calls[0];
    expect(variables).not.toHaveProperty('commitHeadline');
    expect(variables).not.toHaveProperty('commitBody');
    expect(variables).not.toHaveProperty('expectedHeadOid');
    expect(variables).not.toHaveProperty('authorEmail');
    expect(variables).not.toHaveProperty('clientMutationId');
  });
});

describe('pr-writer — Phase 05 enableAutoMerge — soft-fail GraphqlResponseError (D-05)', () => {
  it('EF1: branch protection error → returns errorMessage, does not throw', async () => {
    mockGraphql.mockRejectedValueOnce(mkGraphqlError([{ message: 'Branch is not protected', type: 'PROTECTED_BRANCH' }]));
    const octokit = new Octokit({ auth: 'test' });
    const result = await enableAutoMerge(octokit, 'PR_kwabc');
    expect(result.errorMessage).toBe('Branch is not protected');
    expect(result.enabledAt).toBeUndefined();
  });

  it('EF2: multiple error messages joined with semicolon', async () => {
    mockGraphql.mockRejectedValueOnce(mkGraphqlError([
      { message: 'Branch is not protected', type: 'PROTECTED_BRANCH' },
      { message: 'Auto-merge not enabled', type: 'AUTO_MERGE_NOT_ENABLED' },
    ]));
    const octokit = new Octokit({ auth: 'test' });
    const result = await enableAutoMerge(octokit, 'PR_kwabc');
    expect(result.errorMessage).toBe('Branch is not protected; Auto-merge not enabled');
  });

  it('EF3: empty errors array → falls back to err.message', async () => {
    const err = mkGraphqlError([]);
    // GraphqlResponseError with no errors[] — err.message falls back
    mockGraphql.mockRejectedValueOnce(err);
    const octokit = new Octokit({ auth: 'test' });
    const result = await enableAutoMerge(octokit, 'PR_kwabc');
    expect(result.errorMessage).toBeDefined();
    expect(typeof result.errorMessage).toBe('string');
  });
});

describe('pr-writer — Phase 05 enableAutoMerge — soft-fail non-GraphQL errors', () => {
  it('EF4: network error → errorMessage includes Auto-merge enable failed and error text', async () => {
    mockGraphql.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const octokit = new Octokit({ auth: 'test' });
    const result = await enableAutoMerge(octokit, 'PR_kwabc');
    expect(result.errorMessage).toContain('Auto-merge enable failed:');
    expect(result.errorMessage).toContain('ECONNREFUSED');
  });

  it('EF5: TypeError → errorMessage includes the error text', async () => {
    mockGraphql.mockRejectedValueOnce(new TypeError('Cannot read properties of undefined'));
    const octokit = new Octokit({ auth: 'test' });
    const result = await enableAutoMerge(octokit, 'PR_kwabc');
    expect(result.errorMessage).toContain('Auto-merge enable failed:');
    expect(result.errorMessage).toContain('Cannot read properties of undefined');
  });
});

describe('pr-writer — Phase 05 renderAutoMergeBand — preview mode (enable=false)', () => {
  const allMatched: AutoMergeDecision = {
    eligible: true,
    conditions: [
      { condition: 'pass_rate', result: 'matched', reason: '10/10 passed (≥ 1)' },
      { condition: 'fix_class', result: 'matched', reason: 'selectors in allow-list (selectors)' },
      { condition: 'scope', result: 'matched', reason: 'all patched files in tests/, e2e/, or playwright/' },
      { condition: 'config_files', result: 'matched', reason: 'no config files patched' },
    ],
  };
  const oneBlocked: AutoMergeDecision = {
    eligible: false,
    conditions: [
      { condition: 'pass_rate', result: 'matched', reason: '10/10 passed (≥ 1)' },
      { condition: 'fix_class', result: 'blocked', reason: 'waits not in allow-list (selectors)' },
      { condition: 'scope', result: 'matched', reason: 'all patched files in tests/, e2e/, or playwright/' },
      { condition: 'config_files', result: 'matched', reason: 'no config files patched' },
    ],
  };

  it('RB1: eligible but not enabled → outcome row contains enable_auto_merge=false (informational only)', () => {
    const band = renderAutoMergeBand(allMatched, false, null);
    const outcomeRow = band.find(l => l.includes('auto_merge'));
    expect(outcomeRow).toMatch(/\| auto_merge \| eligible \| enable_auto_merge=false/);
  });

  it('RB2: ineligible → outcome row reads blocked + enable_auto_merge=false (informational only)', () => {
    const band = renderAutoMergeBand(oneBlocked, false, null);
    const outcomeRow = band.find(l => l.includes('auto_merge'));
    expect(outcomeRow).toMatch(/\| auto_merge \| blocked \| enable_auto_merge=false \(informational only\)/);
  });
});

describe('pr-writer — Phase 05 renderAutoMergeBand — live mode (enable=true)', () => {
  const allMatched: AutoMergeDecision = {
    eligible: true,
    conditions: [
      { condition: 'pass_rate', result: 'matched', reason: '10/10 passed (≥ 1)' },
      { condition: 'fix_class', result: 'matched', reason: 'selectors in allow-list (selectors)' },
      { condition: 'scope', result: 'matched', reason: 'all patched files in tests/, e2e/, or playwright/' },
      { condition: 'config_files', result: 'matched', reason: 'no config files patched' },
    ],
  };
  const oneBlocked: AutoMergeDecision = {
    eligible: false,
    conditions: [
      { condition: 'pass_rate', result: 'matched', reason: '10/10 passed (≥ 1)' },
      { condition: 'fix_class', result: 'blocked', reason: 'waits not in allow-list (selectors)' },
      { condition: 'scope', result: 'matched', reason: 'all patched files in tests/, e2e/, or playwright/' },
      { condition: 'config_files', result: 'matched', reason: 'no config files patched' },
    ],
  };

  it('RB3: ineligible blocks early → outcome row one or more conditions failed', () => {
    const band = renderAutoMergeBand(oneBlocked, true, null);
    const outcomeRow = band.find(l => l.includes('auto_merge'));
    expect(outcomeRow).toContain('one or more conditions failed');
  });

  it('RB4: mutation error → outcome row contains error msg and see README', () => {
    const band = renderAutoMergeBand(allMatched, true, { errorMessage: 'Branch is not protected' });
    const outcomeRow = band.find(l => l.includes('auto_merge'));
    expect(outcomeRow).toContain('Branch is not protected');
    expect(outcomeRow).toContain('see README §auto-merge-prerequisites');
  });

  it('RB5: success → outcome row contains enabled, mutation succeeded, ISO timestamp', () => {
    const band = renderAutoMergeBand(allMatched, true, { enabledAt: '2026-05-02T10:00:00Z' });
    const outcomeRow = band.find(l => l.includes('auto_merge'));
    expect(outcomeRow).toContain('enabled');
    expect(outcomeRow).toContain('mutation succeeded');
    expect(outcomeRow).toContain('2026-05-02T10:00:00Z');
  });
});

describe('pr-writer — Phase 05 renderAutoMergeBand — table structure', () => {
  const allMatched: AutoMergeDecision = {
    eligible: true,
    conditions: [
      { condition: 'pass_rate', result: 'matched', reason: '10/10 passed (≥ 1)' },
      { condition: 'fix_class', result: 'matched', reason: 'selectors in allow-list (selectors)' },
      { condition: 'scope', result: 'matched', reason: 'all patched files in tests/, e2e/, or playwright/' },
      { condition: 'config_files', result: 'matched', reason: 'no config files patched' },
    ],
  };

  it('RB6: band structure — heading, header, separator, 4 condition rows, 1 outcome row, total ≥7 elements', () => {
    const band = renderAutoMergeBand(allMatched, false, null);
    expect(band[0]).toBe('## Auto-merge decision');
    expect(band).toContain('| Condition | Result | Reason |');
    expect(band).toContain('| --- | --- | --- |');
    // 4 condition rows
    const conditionRows = band.filter(l => /\| (pass_rate|fix_class|scope|config_files) \|/.test(l));
    expect(conditionRows.length).toBe(4);
    // verify order
    expect(conditionRows[0]).toContain('pass_rate');
    expect(conditionRows[1]).toContain('fix_class');
    expect(conditionRows[2]).toContain('scope');
    expect(conditionRows[3]).toContain('config_files');
    // outcome row
    const outcomeRow = band.find(l => l.includes('auto_merge'));
    expect(outcomeRow).toBeDefined();
    expect(band.length).toBeGreaterThanOrEqual(7);
  });

  it('RB7: every condition row contains exactly two " | " separators (well-formed markdown)', () => {
    const band = renderAutoMergeBand(allMatched, false, null);
    const conditionRows = band.filter(l => /\| (pass_rate|fix_class|scope|config_files) \|/.test(l));
    for (const row of conditionRows) {
      // Remove leading/trailing pipes, count interior " | " separators
      const interior = row.replace(/^\| | \|$/g, '');
      const separatorCount = (interior.match(/ \| /g) ?? []).length;
      expect(separatorCount).toBe(2);
    }
  });
});

// ── Phase 05: openHealerPr integration tests (Task 4) ───────────────────────

describe('pr-writer — Phase 05 openHealerPr integration — gate fires post-create only', () => {
  it('IN1: eligible + enable=false → mockGraphql NEVER called, band renders with informational-only', async () => {
    await openHealerPr(mkArgs({
      enableAutoMerge: false,
      patchedFiles: ['tests/foo.spec.ts'],
      validation: { passed: 10, total: 10, passRate: 1.0, perRun: [] },
      autoMergeFixClasses: ['selectors'],
      fixClass: 'selectors' as const,
    }));
    expect(mockGraphql).not.toHaveBeenCalled();
    const summaryCall = vi.mocked(core.summary.addRaw).mock.calls[0][0] as string;
    expect(summaryCall).toContain('## Auto-merge decision');
    expect(summaryCall).toContain('enable_auto_merge=false (informational only)');
  });

  it('IN2: eligible + enable=true + mutation succeeds → graphql called with node_id + SQUASH, summary shows mutation succeeded', async () => {
    mockGraphql.mockResolvedValueOnce({
      enablePullRequestAutoMerge: {
        pullRequest: { autoMergeRequest: { enabledAt: '2026-05-02T10:00:00Z', mergeMethod: 'SQUASH' } },
      },
    });
    await openHealerPr(mkArgs({
      enableAutoMerge: true,
      patchedFiles: ['tests/foo.spec.ts'],
      validation: { passed: 10, total: 10, passRate: 1.0, perRun: [] },
      autoMergeFixClasses: ['selectors'],
      fixClass: 'selectors' as const,
    }));
    expect(mockGraphql).toHaveBeenCalledTimes(1);
    const [, variables] = mockGraphql.mock.calls[0];
    expect(variables).toEqual({ pullRequestId: 'PR_kwabc123', mergeMethod: 'SQUASH' });
    const summaryCall = vi.mocked(core.summary.addRaw).mock.calls[0][0] as string;
    expect(summaryCall).toContain('mutation succeeded at 2026-05-02T10:00:00Z');
  });

  it('IN3: eligible + enable=true + mutation fails → core.warning + PR url returned + summary shows error', async () => {
    mockGraphql.mockRejectedValueOnce(
      mkGraphqlError([{ message: 'Branch is not protected', type: 'PROTECTED_BRANCH' }]),
    );
    const url = await openHealerPr(mkArgs({
      enableAutoMerge: true,
      patchedFiles: ['tests/foo.spec.ts'],
      validation: { passed: 10, total: 10, passRate: 1.0, perRun: [] },
      autoMergeFixClasses: ['selectors'],
      fixClass: 'selectors' as const,
    }));
    expect(url).toBe('https://github.com/octocat/repo/pull/42');
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
      expect.stringContaining('Branch is not protected'),
    );
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
      expect.stringContaining('see README §auto-merge-prerequisites'),
    );
    const summaryCall = vi.mocked(core.summary.addRaw).mock.calls[0][0] as string;
    expect(summaryCall).toContain('Branch is not protected');
  });

  it('IN4: ineligible fix_class blocked → graphql NEVER called even with enable=true', async () => {
    await openHealerPr(mkArgs({
      enableAutoMerge: true,
      fixClass: 'waits' as const,
      autoMergeFixClasses: ['selectors'],
      patchedFiles: ['tests/foo.spec.ts'],
      validation: { passed: 10, total: 10, passRate: 1.0, perRun: [] },
    }));
    expect(mockGraphql).not.toHaveBeenCalled();
    const summaryCall = vi.mocked(core.summary.addRaw).mock.calls[0][0] as string;
    expect(summaryCall).toContain('one or more conditions failed');
    expect(summaryCall).toContain('waits not in allow-list');
  });

  it('IN5: ineligible scope blocked → graphql NEVER called', async () => {
    await openHealerPr(mkArgs({
      enableAutoMerge: true,
      patchedFiles: ['src/foo.ts', 'tests/bar.spec.ts'],
      validation: { passed: 10, total: 10, passRate: 1.0, perRun: [] },
    }));
    expect(mockGraphql).not.toHaveBeenCalled();
    const summaryCall = vi.mocked(core.summary.addRaw).mock.calls[0][0] as string;
    expect(summaryCall).toContain('files outside test directory (src/foo.ts)');
  });

  it('IN6: ineligible config_files blocked → graphql NEVER called', async () => {
    await openHealerPr(mkArgs({
      enableAutoMerge: true,
      patchedFiles: ['playwright.config.ts'],
      validation: { passed: 10, total: 10, passRate: 1.0, perRun: [] },
    }));
    expect(mockGraphql).not.toHaveBeenCalled();
    const summaryCall = vi.mocked(core.summary.addRaw).mock.calls[0][0] as string;
    expect(summaryCall).toContain('configuration file change (playwright.config.ts)');
  });

  it('IN7: D-07 validation skipped (total=0) → graphql NEVER called', async () => {
    await openHealerPr(mkArgs({
      enableAutoMerge: true,
      validation: { passed: 0, total: 0, passRate: 0, perRun: [] },
      patchedFiles: ['tests/foo.spec.ts'],
    }));
    expect(mockGraphql).not.toHaveBeenCalled();
    const summaryCall = vi.mocked(core.summary.addRaw).mock.calls[0][0] as string;
    expect(summaryCall).toContain('validation skipped (demo mode)');
  });

  it('IN8: D-08 dedup branch bypasses gate entirely → graphql NEVER called, summary has dedup heading NOT auto-merge decision', async () => {
    mockPullsList.mockResolvedValue({
      data: [{ number: 42, html_url: 'https://github.com/octocat/repo/pull/42' }],
    });
    await openHealerPr(mkArgs({
      enableAutoMerge: true,
      patchedFiles: ['tests/foo.spec.ts'],
      validation: { passed: 10, total: 10, passRate: 1.0, perRun: [] },
    }));
    expect(mockPullsCreate).not.toHaveBeenCalled();
    expect(mockGraphql).not.toHaveBeenCalled();
    const summaryCall = vi.mocked(core.summary.addRaw).mock.calls[0][0] as string;
    expect(summaryCall).toContain('Healer PR updated (dedup)');
    expect(summaryCall).not.toContain('## Auto-merge decision');
  });

  it('IN9: pr.node_id missing → graphql NEVER called, core.warning with node_id message, PR url returned', async () => {
    mockPullsCreate.mockResolvedValueOnce({ data: { html_url: 'https://github.com/octocat/repo/pull/42', number: 42 } });
    const url = await openHealerPr(mkArgs({
      enableAutoMerge: true,
      patchedFiles: ['tests/foo.spec.ts'],
      validation: { passed: 10, total: 10, passRate: 1.0, perRun: [] },
    }));
    expect(url).toBe('https://github.com/octocat/repo/pull/42');
    expect(mockGraphql).not.toHaveBeenCalled();
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
      expect.stringContaining('node_id missing'),
    );
    const summaryCall = vi.mocked(core.summary.addRaw).mock.calls[0][0] as string;
    expect(summaryCall).toContain('PR creation succeeded but node_id missing');
  });
});
