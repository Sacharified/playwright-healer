import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @actions/github and @actions/core before importing loop-guard
vi.mock('@actions/github', () => ({
  context: { payload: {} },
}));

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

import { shouldSkipIngest, BOT_EMAIL, SKIP_SENTINEL } from '../../src/shared/loop-guard.js';
import * as github from '@actions/github';

function setPayload(payload: unknown): void {
  // Reassign the context property on the mocked module
  Object.defineProperty(github, 'context', {
    value: { payload },
    writable: true,
    configurable: true,
  });
}

describe('shouldSkipIngest() — SEC-05 loop guard', () => {
  beforeEach(() => {
    setPayload({});
    vi.clearAllMocks();
  });

  it('exports BOT_EMAIL constant', () => {
    expect(BOT_EMAIL).toBe('playwright-healer-bot@users.noreply.github.com');
  });

  it('exports SKIP_SENTINEL constant', () => {
    expect(SKIP_SENTINEL).toBe('[skip-healer]');
  });

  it('Guard 0: returns true on fork PR (pull_request.head.repo.fork === true)', () => {
    setPayload({ pull_request: { head: { repo: { fork: true } } } });
    expect(shouldSkipIngest()).toBe(true);
  });

  it('Guard 0: returns false on non-fork PR (pull_request.head.repo.fork === false)', () => {
    setPayload({ pull_request: { head: { repo: { fork: false } } } });
    expect(shouldSkipIngest()).toBe(false);
  });

  it('Guard 1: returns true when head_commit author email is the bot email', () => {
    setPayload({
      head_commit: {
        author: { email: 'playwright-healer-bot@users.noreply.github.com' },
        message: 'chore: update stats',
      },
    });
    expect(shouldSkipIngest()).toBe(true);
  });

  it('Guard 1: returns false when head_commit author email is a non-bot email', () => {
    setPayload({
      head_commit: {
        author: { email: 'developer@example.com' },
        message: 'fix: auth bug',
      },
    });
    expect(shouldSkipIngest()).toBe(false);
  });

  it('Guard 2: returns true when commit message contains [skip-healer] sentinel', () => {
    setPayload({
      head_commit: {
        author: { email: 'developer@example.com' },
        message: 'fix: auth [skip-healer]',
      },
    });
    expect(shouldSkipIngest()).toBe(true);
  });

  it('Guard 2: returns false when commit message does not contain sentinel', () => {
    setPayload({
      head_commit: {
        author: { email: 'developer@example.com' },
        message: 'fix: auth bug without sentinel',
      },
    });
    expect(shouldSkipIngest()).toBe(false);
  });

  it('Non-push event: does not crash when head_commit is undefined (workflow_call event)', () => {
    setPayload({
      // No head_commit — simulates workflow_call or pull_request events
    });
    expect(() => shouldSkipIngest()).not.toThrow();
    expect(shouldSkipIngest()).toBe(false);
  });

  it('All guards clear: returns false when fork=false, non-bot email, no sentinel', () => {
    setPayload({
      pull_request: { head: { repo: { fork: false } } },
      head_commit: {
        author: { email: 'developer@example.com' },
        message: 'feat: add new feature',
      },
    });
    expect(shouldSkipIngest()).toBe(false);
  });
});
