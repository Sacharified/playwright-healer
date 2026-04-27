import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockPullsCreate = vi.fn();

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    pulls: { create: mockPullsCreate },
    issues: { create: vi.fn() },
  })),
}));

vi.mock('@actions/core', () => ({
  summary: {
    addRaw: vi.fn().mockReturnThis(),
    write: vi.fn().mockResolvedValue(undefined),
  },
}));

import { openHealerPr, renderPrBody } from './pr-writer.js';
import { Octokit } from '@octokit/rest';

const mkArgs = (over: any = {}) => ({
  patToken: 'pat-secret-12345',
  owner: 'acme',
  repo: 'repo',
  testTitle: 'completes purchase flow',
  testFile: 'tests/checkout.spec.ts',
  defaultBranch: 'main',
  branch: 'playwright-healer/completes-purchase-flow-abc1234',
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
  triggeringRunUrl: 'https://github.com/acme/repo/actions/runs/123',
  traceLink: null as string | null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockPullsCreate.mockResolvedValue({ data: { html_url: 'https://github.com/acme/repo/pull/42' } });
});

describe('pr-writer — PRI-01 (title + branch)', () => {
  it('uses the locked title format', async () => {
    await openHealerPr(mkArgs());
    expect(mockPullsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '[playwright-healer] Fix flaky completes purchase flow',
        head: 'playwright-healer/completes-purchase-flow-abc1234',
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
    expect(url).toBe('https://github.com/acme/repo/pull/42');
  });
});
