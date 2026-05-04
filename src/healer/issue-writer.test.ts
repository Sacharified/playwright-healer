import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockIssuesCreate = vi.fn();
const mockIssuesCreateComment = vi.fn();
const mockSearchIssues = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () {
    return {
      rest: {
        issues: { create: mockIssuesCreate, createComment: mockIssuesCreateComment },
        search: { issuesAndPullRequests: mockSearchIssues },
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

import { openIssue, renderIssueBody } from './issue-writer.js';
import { Octokit } from '@octokit/rest';
import * as core from '@actions/core';
import type { FailureMode } from './types.js';

const SIX_TOKENS: FailureMode[] = [
  'app-startup-timeout',
  'agent-budget-exhausted',
  'no-fix-proposable',
  'diff-lint-blocked',
  'validation-failed',
  'deterministic-failure',
];

const mkArgs = (mode: FailureMode = 'no-fix-proposable', over: any = {}) => ({
  patToken: 'pat-secret',
  owner: 'acme',
  repo: 'repo',
  testTitle: 'completes purchase',
  failureMode: mode,
  rootCause: 'Could not identify a stable selector',
  reproSteps: 'Run `npx playwright test tests/checkout.spec.ts`',
  suggestedManualFix: 'Add data-testid to the Buy button',
  triggeringRunUrl: 'https://github.com/acme/repo/actions/runs/123',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no existing issue (dedup returns empty)
  mockSearchIssues.mockResolvedValue({ data: { items: [] } });
  mockIssuesCreate.mockResolvedValue({ data: { html_url: 'https://github.com/acme/repo/issues/42' } });
  mockIssuesCreateComment.mockResolvedValue({});
});

describe('issue-writer — PRI-03 / D-10 (title)', () => {
  it('uses the locked title format', async () => {
    await openIssue(mkArgs());
    expect(mockIssuesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '[playwright-healer] completes purchase is unhealable',
      }),
    );
  });
});

describe('issue-writer — D-09 / D-10 (failure mode tokens)', () => {
  for (const mode of SIX_TOKENS) {
    it(`renders body opening with token \`${mode}\``, () => {
      const body = renderIssueBody(mkArgs(mode));
      expect(body).toMatch(/^## Failure mode\n\n`/);
      expect(body).toMatch(new RegExp('`' + mode + '`'));
    });
  }
});

describe('issue-writer — PRI-03 (body required content)', () => {
  it('contains Root cause, Reproduction, Suggested manual fix sections', () => {
    const body = renderIssueBody(mkArgs());
    expect(body).toMatch(/## Root cause/);
    expect(body).toMatch(/## Reproduction/);
    expect(body).toMatch(/## Suggested manual fix/);
    expect(body).toMatch(/Could not identify/);
    expect(body).toMatch(/Run `npx playwright/);
    expect(body).toMatch(/data-testid/);
    expect(body).toMatch(/Triggering run/);
  });
});

describe('issue-writer — PAT auth (D-20)', () => {
  it('constructs Octokit with the patToken', async () => {
    await openIssue(mkArgs());
    expect(vi.mocked(Octokit)).toHaveBeenCalledWith({ auth: 'pat-secret' });
  });

  it('does not import from @actions/github', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/healer/issue-writer.ts', 'utf8');
    expect(src).not.toMatch(/from\s+['"]@actions\/github['"]/);
  });
});

describe('issue-writer — D-11 step summary parity + return', () => {
  it('returns the issue URL', async () => {
    const url = await openIssue(mkArgs());
    expect(url).toBe('https://github.com/acme/repo/issues/42');
  });
});

describe('issue-writer — T-3-PRI-PI (no secrets in body)', () => {
  it('body does not interpolate the patToken', () => {
    const body = renderIssueBody(mkArgs('no-fix-proposable', { patToken: 'should-not-appear' }));
    expect(body).not.toMatch(/should-not-appear/);
  });
});

// PRI-04 dedup tests

describe('issue-writer — PRI-04 dedup (Test 1: no existing issue)', () => {
  it('calls issues.create when no existing issue exists', async () => {
    mockSearchIssues.mockResolvedValue({ data: { items: [] } });
    await openIssue(mkArgs());
    expect(mockIssuesCreate).toHaveBeenCalledTimes(1);
    expect(mockIssuesCreateComment).not.toHaveBeenCalled();
  });

  it('returns the new issue URL when no existing issue exists', async () => {
    mockSearchIssues.mockResolvedValue({ data: { items: [] } });
    const url = await openIssue(mkArgs());
    expect(url).toBe('https://github.com/acme/repo/issues/42');
  });
});

describe('issue-writer — PRI-04 dedup (Test 2: existing open issue)', () => {
  it('does NOT call issues.create when existing open issue found', async () => {
    mockSearchIssues.mockResolvedValue({
      data: { items: [{ number: 7, html_url: 'https://github.com/acme/repo/issues/7' }] },
    });
    await openIssue(mkArgs());
    expect(mockIssuesCreate).not.toHaveBeenCalled();
  });

  it('calls issues.createComment with the existing issue number', async () => {
    mockSearchIssues.mockResolvedValue({
      data: { items: [{ number: 7, html_url: 'https://github.com/acme/repo/issues/7' }] },
    });
    await openIssue(mkArgs('validation-failed', { rootCause: 'new root cause' }));
    expect(mockIssuesCreateComment).toHaveBeenCalledWith(
      expect.objectContaining({ issue_number: 7 }),
    );
  });

  it('returns the existing issue URL on dedup hit', async () => {
    mockSearchIssues.mockResolvedValue({
      data: { items: [{ number: 7, html_url: 'https://github.com/acme/repo/issues/7' }] },
    });
    const url = await openIssue(mkArgs());
    expect(url).toBe('https://github.com/acme/repo/issues/7');
  });
});

describe('issue-writer — PRI-04 dedup (Test 3: is:issue qualifier — Pitfall 4)', () => {
  it('search query contains is:issue is:open', async () => {
    await openIssue(mkArgs());
    const searchCall = mockSearchIssues.mock.calls[0][0];
    expect(searchCall.q).toContain('is:issue is:open');
  });
});

describe('issue-writer — PRI-04 dedup (Test 4: title-pattern anchoring)', () => {
  it('search query contains the testTitle in quotes', async () => {
    await openIssue(mkArgs('no-fix-proposable', { testTitle: 'my special test' }));
    const searchCall = mockSearchIssues.mock.calls[0][0];
    expect(searchCall.q).toContain('"my special test"');
  });
});

describe('issue-writer — PRI-04 dedup (Test 4b: failureMode body anchoring)', () => {
  it('search query contains in:body with the failureMode', async () => {
    await openIssue(mkArgs('validation-failed'));
    const searchCall = mockSearchIssues.mock.calls[0][0];
    expect(searchCall.q).toContain('in:body "validation-failed"');
  });

  it('different failureModes produce different queries (no collision)', async () => {
    await openIssue(mkArgs('agent-budget-exhausted'));
    const searchCall = mockSearchIssues.mock.calls[0][0];
    expect(searchCall.q).toContain('in:body "agent-budget-exhausted"');
    expect(searchCall.q).not.toContain('validation-failed');
  });
});

describe('issue-writer — PRI-04 dedup (Test 5: dedup query failure falls through)', () => {
  it('proceeds to create when search throws', async () => {
    mockSearchIssues.mockRejectedValue(new Error('network error'));
    const url = await openIssue(mkArgs());
    expect(url).toBe('https://github.com/acme/repo/issues/42');
    expect(mockIssuesCreate).toHaveBeenCalledTimes(1);
  });

  it('logs a warning when dedup query fails', async () => {
    mockSearchIssues.mockRejectedValue(new Error('rate limit exceeded'));
    await openIssue(mkArgs('diff-lint-blocked'));
    expect(vi.mocked(core.warning)).toHaveBeenCalledWith(
      expect.stringContaining('PRI-04: issue dedup query failed'),
    );
  });
});

describe('issue-writer — PRI-04 dedup (Test 6: step summary heading)', () => {
  it('summary contains ## Healer issue updated (dedup) on dedup hit', async () => {
    mockSearchIssues.mockResolvedValue({
      data: { items: [{ number: 7, html_url: 'https://github.com/acme/repo/issues/7' }] },
    });
    await openIssue(mkArgs());
    expect(vi.mocked(core.summary.addRaw)).toHaveBeenCalledWith(
      expect.stringContaining('## Healer issue updated (dedup)'),
    );
  });

  it('summary contains ## Healer issue opened on no-match', async () => {
    mockSearchIssues.mockResolvedValue({ data: { items: [] } });
    await openIssue(mkArgs());
    expect(vi.mocked(core.summary.addRaw)).toHaveBeenCalledWith(
      expect.stringContaining('## Healer issue opened'),
    );
  });
});

describe('issue-writer — PRI-04 dedup (Test 7: closed issues not picked up)', () => {
  it('search query contains is:open to exclude closed issues', async () => {
    await openIssue(mkArgs());
    const searchCall = mockSearchIssues.mock.calls[0][0];
    expect(searchCall.q).toContain('is:open');
  });
});
