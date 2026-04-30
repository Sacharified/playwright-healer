import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockWaitForReady, mockOpenIssue } = vi.hoisted(() => ({
  mockWaitForReady: vi.fn(),
  mockOpenIssue: vi.fn(),
}));

vi.mock('./app-supervisor.js', () => ({
  waitForReady: mockWaitForReady,
  AppStartupTimeout: class extends Error {
    constructor(m: string) {
      super(m);
      this.name = 'AppStartupTimeout';
    }
  },
  PID_FILE_PATH: '/tmp/playwright-healer-app-pid',
  readPidFile: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('./issue-writer.js', () => ({ openIssue: mockOpenIssue }));

import { main } from './wait-for-ready.js';
import { AppStartupTimeout } from './app-supervisor.js';

const ENV = {
  BASE_URL: 'http://localhost:3000',
  STARTUP_TIMEOUT_SECONDS: '60',
  HEALER_TOKEN: 'pat',
  GH_OWNER: 'acme',
  GH_REPO: 'repo',
  TEST_TITLE: 'completes purchase',
  TRIGGERING_RUN_URL: 'https://github.com/acme/repo/actions/runs/123',
};

beforeEach(() => {
  vi.clearAllMocks();
  for (const [k, v] of Object.entries(ENV)) {
    process.env[k] = v;
  }
  mockOpenIssue.mockResolvedValue('https://github.com/acme/repo/issues/1');
});

describe('wait-for-ready CLI — HEA-03', () => {
  it('returns exit code 0 when waitForReady resolves', async () => {
    mockWaitForReady.mockResolvedValueOnce(undefined);
    const code = await main();
    expect(code).toBe(0);
    expect(mockOpenIssue).not.toHaveBeenCalled();
  });

  it('returns exit code 1 and files app-startup-timeout issue on AppStartupTimeout', async () => {
    mockWaitForReady.mockRejectedValueOnce(new AppStartupTimeout('timeout!'));
    const code = await main();
    expect(code).toBe(1);
    expect(mockOpenIssue).toHaveBeenCalledWith(expect.objectContaining({
      failureMode: 'app-startup-timeout',
      patToken: 'pat',
      owner: 'acme',
      repo: 'repo',
      testTitle: 'completes purchase',
    }));
  });

  it('still exits 1 if issue creation itself fails (heal step skip is the safety net)', async () => {
    mockWaitForReady.mockRejectedValueOnce(new AppStartupTimeout('timeout!'));
    mockOpenIssue.mockRejectedValueOnce(new Error('GitHub API down'));
    const code = await main();
    expect(code).toBe(1);
  });

  it('returns exit code 2 on unexpected error (probe bug — fail loud)', async () => {
    mockWaitForReady.mockRejectedValueOnce(new Error('weird internal'));
    const code = await main();
    expect(code).toBe(2);
    expect(mockOpenIssue).not.toHaveBeenCalled();
  });

  it('parses STARTUP_TIMEOUT_SECONDS as seconds → ms', async () => {
    process.env.STARTUP_TIMEOUT_SECONDS = '5';
    mockWaitForReady.mockResolvedValueOnce(undefined);
    await main();
    expect(mockWaitForReady).toHaveBeenCalledWith('http://localhost:3000', 5000);
  });

  it('issue body suggests manual remediation steps', async () => {
    mockWaitForReady.mockRejectedValueOnce(new AppStartupTimeout('t'));
    await main();
    const args = mockOpenIssue.mock.calls[0][0];
    expect(args.rootCause).toMatch(/did not respond/);
    expect(args.suggestedManualFix).toMatch(/start_command/);
  });
});
