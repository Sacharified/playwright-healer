import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPullsCreate = vi.fn();
const mockPullsList = vi.fn();
const mockIssuesCreateComment = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () {
    return {
      rest: {
        pulls: { create: mockPullsCreate, list: mockPullsList },
        issues: { create: vi.fn(), createComment: mockIssuesCreateComment },
      },
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

import { openHealerPr, renderPrBody } from './pr-writer.js';
import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';

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
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no existing PR (dedup returns empty)
  mockPullsList.mockResolvedValue({ data: [] });
  mockPullsCreate.mockResolvedValue({ data: { html_url: 'https://github.com/octocat/repo/pull/42' } });
  mockIssuesCreateComment.mockResolvedValue({});
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
