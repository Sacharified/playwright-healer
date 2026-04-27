import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockIssuesCreate = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(function () {
    return {
      pulls: { create: vi.fn() },
      issues: { create: mockIssuesCreate },
    };
  }),
}));

vi.mock('@actions/core', () => ({
  summary: {
    addRaw: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined),
  },
}));

import { openIssue, renderIssueBody } from './issue-writer.js';
import { Octokit } from '@octokit/rest';
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
  mockIssuesCreate.mockResolvedValue({ data: { html_url: 'https://github.com/acme/repo/issues/42' } });
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
