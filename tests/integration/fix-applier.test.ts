// tests/integration/fix-applier.test.ts
//
// Integration tests for fix-applier using the bare-repo helper.
// Validates: FIX-05 (rebase semantics), PRI-06 (SKIP_SENTINEL in every commit),
// SC-5 (loop guard not triggered by bot commits), T-3-FIX-05 (no upstream corruption).
//
// Real git operations — no mocks. Uses a local bare repo via file:// URL.
// Runs in forks pool (vitest.config.ts) to prevent git child-process state leakage.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { makeBareRepo, type BareRepoContext } from '../_helpers/bare-repo.js';
import { applyFix, DiffApplyFailure } from '../../src/healer/fix-applier.js';

let ctx: BareRepoContext;

beforeEach(() => {
  ctx = makeBareRepo();
  // Seed primaryWs1 with a tests/ file and push to origin/main so applyFix can fetch it.
  const ws = ctx.primaryWs1;
  fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(ws, 'tests/checkout.spec.ts'),
    `test('completes purchase flow', async ({ page }) => {\n  await page.locator('#wrong-id').click();\n});\n`,
  );
  execSync('git add -A && git commit -m "seed test"', { cwd: ws, shell: '/bin/bash' });
  execSync('git branch -M main && git push -u origin main', { cwd: ws, shell: '/bin/bash' });
});

afterEach(() => {
  ctx.cleanup();
});

// A valid unified diff that fixes the selector in checkout.spec.ts
const validDiff = `diff --git a/tests/checkout.spec.ts b/tests/checkout.spec.ts
--- a/tests/checkout.spec.ts
+++ b/tests/checkout.spec.ts
@@ -1,3 +1,3 @@
-test('completes purchase flow', async ({ page }) => {
-  await page.locator('#wrong-id').click();
+test('completes purchase flow', async ({ page }) => {
+  await page.getByRole('button', { name: 'Buy now' }).click();
 });
`;

describe('applyFix — FIX-05 / PRI-06 / SC-5', () => {
  it('creates the playwright-healer branch and pushes to origin', async () => {
    const result = await applyFix({
      diff: validDiff,
      defaultBranch: 'main',
      testSlug: 'completes-purchase-flow',
      shortSha: 'abc1234',
      cwd: ctx.primaryWs1,
      token: '',
    });
    expect(result.branch).toBe('playwright-healer/completes-purchase-flow-abc1234');
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);

    // Verify branch exists in the bare remote
    const branches = execSync('git branch', { cwd: ctx.remoteDir }).toString();
    expect(branches).toContain('playwright-healer/completes-purchase-flow-abc1234');
  });

  it('commit message contains [skip-healer] (PRI-06 / SC-5)', async () => {
    const result = await applyFix({
      diff: validDiff,
      defaultBranch: 'main',
      testSlug: 'completes-purchase-flow',
      shortSha: 'abc1234',
      cwd: ctx.primaryWs1,
      token: '',
    });
    const msg = execSync(`git log -1 --format=%B ${result.commitSha}`, { cwd: ctx.primaryWs1 }).toString();
    expect(msg).toContain('[skip-healer]');
  });

  it('commit author email is playwright-healer-bot email', async () => {
    const result = await applyFix({
      diff: validDiff,
      defaultBranch: 'main',
      testSlug: 'X',
      shortSha: 'abc1234',
      cwd: ctx.primaryWs1,
      token: '',
    });
    const author = execSync(
      `git log -1 --format=%ae ${result.commitSha}`,
      { cwd: ctx.primaryWs1 },
    ).toString().trim();
    expect(author).toBe('playwright-healer-bot@users.noreply.github.com');
  });

  it('commit author name is playwright-healer-bot', async () => {
    const result = await applyFix({
      diff: validDiff,
      defaultBranch: 'main',
      testSlug: 'X',
      shortSha: 'abc1234',
      cwd: ctx.primaryWs1,
      token: '',
    });
    const authorName = execSync(
      `git log -1 --format=%an ${result.commitSha}`,
      { cwd: ctx.primaryWs1 },
    ).toString().trim();
    expect(authorName).toBe('playwright-healer-bot');
  });

  it('main branch is unchanged after applyFix (T-3-FIX-05 — no upstream corruption)', async () => {
    const mainShaBefore = execSync('git rev-parse main', { cwd: ctx.remoteDir }).toString().trim();
    await applyFix({
      diff: validDiff,
      defaultBranch: 'main',
      testSlug: 'X',
      shortSha: 'abc1234',
      cwd: ctx.primaryWs1,
      token: '',
    });
    const mainShaAfter = execSync('git rev-parse main', { cwd: ctx.remoteDir }).toString().trim();
    expect(mainShaAfter).toBe(mainShaBefore);
  });

  it('throws DiffApplyFailure on a malformed diff', async () => {
    const garbage = 'not a diff at all\nrandom text';
    await expect(applyFix({
      diff: garbage,
      defaultBranch: 'main',
      testSlug: 'X',
      shortSha: 'abc1234',
      cwd: ctx.primaryWs1,
      token: '',
    })).rejects.toThrow(DiffApplyFailure);
  });

  it('the patched file contains the fixed selector on the new branch', async () => {
    await applyFix({
      diff: validDiff,
      defaultBranch: 'main',
      testSlug: 'X',
      shortSha: 'abc1234',
      cwd: ctx.primaryWs1,
      token: '',
    });
    // After applyFix, workspace is on the new branch with the fixed content
    const content = fs.readFileSync(path.join(ctx.primaryWs1, 'tests/checkout.spec.ts'), 'utf8');
    expect(content).toContain('getByRole');
    expect(content).not.toContain('#wrong-id');
  });
});
