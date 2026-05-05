import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { normalizeDiff, DiffNormalizationFailure } from './diff-normalizer.js';

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), 'diff-normalizer-test-'));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function writeSource(relPath: string, content: string): void {
  const full = path.join(cwd, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
}

const TEST_FILE = `import { test, expect } from '@playwright/test';

test.use({ baseURL: process.env.BASE_URL });

test.describe.configure({ retries: 2 });

test.describe('checkout flow', () => {

  // helper context
  test('clicks submit button and sees confirmation', async ({ page }) => {
    await page.goto('/');
    await page.locator('#wrong-id').click();
    await expect(page.locator('#message')).toHaveText('Submitted!');
  });

});
`;

const TEST_FILE_PATH = 'tests/fixture-app/tests/broken-selector.spec.ts';

describe('normalizeDiff — fix mode 1: placeholder hunk header (gpt-4.1)', () => {
  it('rewrites `@@ ... @@` to a header with computed start line + counts', () => {
    writeSource(TEST_FILE_PATH, TEST_FILE);

    const raw = `--- a/${TEST_FILE_PATH}
+++ b/${TEST_FILE_PATH}
@@ ... @@
-  test('clicks submit button and sees confirmation', async ({ page }) => {
-    await page.goto('/');
-    await page.locator('#wrong-id').click();
-    await expect(page.locator('#message')).toHaveText('Submitted!');
-  });
+  test('clicks submit button and sees confirmation', async ({ page }) => {
+    await page.goto('/');
+    await page.getByRole('button', { name: 'Submit' }).click();
+    await expect(page.locator('#message')).toHaveText('Submitted!');
+  });
`;

    const out = normalizeDiff(raw, cwd);
    // First `-` line is line 10 in the source (1-indexed).
    expect(out).toMatch(/^@@ -10,5 \+10,5 @@$/m);
    expect(out).not.toContain('@@ ... @@');
    // diff --git header is synthesized.
    expect(out).toMatch(/^diff --git a\/tests\/fixture-app\/tests\/broken-selector\.spec\.ts b\/tests\/fixture-app\/tests\/broken-selector\.spec\.ts$/m);
  });
});

describe('normalizeDiff — fix mode 2: miscounted hunk header (gpt-4.1-mini)', () => {
  it('overrides the wrong N/K counts with the actual line counts', () => {
    writeSource(TEST_FILE_PATH, TEST_FILE);

    const raw = `diff --git a/${TEST_FILE_PATH} b/${TEST_FILE_PATH}
--- a/${TEST_FILE_PATH}
+++ b/${TEST_FILE_PATH}
@@ -10,7 +10,11 @@
-  test('clicks submit button and sees confirmation', async ({ page }) => {
-    await page.goto('/');
-    await page.locator('#wrong-id').click();
-    await expect(page.locator('#message')).toHaveText('Submitted!');
-  });
+  test('clicks submit button and sees confirmation', async ({ page }) => {
+    await page.goto('/');
+    await page.getByRole('button', { name: 'Submit' }).click();
+    await expect(page.locator('#message')).toHaveText('Submitted!');
+  });
`;

    const out = normalizeDiff(raw, cwd);
    expect(out).toMatch(/^@@ -10,5 \+10,5 @@$/m);
    expect(out).not.toContain('-10,7');
    expect(out).not.toContain('+10,11');
  });
});

describe('normalizeDiff — happy path', () => {
  it('passes through an already-correct diff (idempotent on canonical input)', () => {
    writeSource(TEST_FILE_PATH, TEST_FILE);

    const raw = `diff --git a/${TEST_FILE_PATH} b/${TEST_FILE_PATH}
--- a/${TEST_FILE_PATH}
+++ b/${TEST_FILE_PATH}
@@ -10,5 +10,5 @@
-  test('clicks submit button and sees confirmation', async ({ page }) => {
-    await page.goto('/');
-    await page.locator('#wrong-id').click();
-    await expect(page.locator('#message')).toHaveText('Submitted!');
-  });
+  test('clicks submit button and sees confirmation', async ({ page }) => {
+    await page.goto('/');
+    await page.getByRole('button', { name: 'Submit' }).click();
+    await expect(page.locator('#message')).toHaveText('Submitted!');
+  });
`;

    const out = normalizeDiff(raw, cwd);
    expect(out).toMatch(/^@@ -10,5 \+10,5 @@$/m);
    // Should produce exactly one diff --git line (no duplication).
    expect(out.match(/^diff --git/gm)).toHaveLength(1);
  });

  it('preserves context lines correctly in counts', () => {
    writeSource(TEST_FILE_PATH, TEST_FILE);

    const raw = `--- a/${TEST_FILE_PATH}
+++ b/${TEST_FILE_PATH}
@@ -9,6 +9,6 @@
   // helper context
-  test('clicks submit button and sees confirmation', async ({ page }) => {
+  test('clicks submit button and sees confirmation', async ({ page }) => {
     await page.goto('/');
-    await page.locator('#wrong-id').click();
+    await page.getByRole('button', { name: 'Submit' }).click();
     await expect(page.locator('#message')).toHaveText('Submitted!');
`;
    const out = normalizeDiff(raw, cwd);
    // 1 ctx + 1 minus + 1 ctx + 1 minus + 1 ctx = 4 old lines (count `-` + ` `)
    // 1 ctx + 1 plus + 1 ctx + 1 plus + 1 ctx = 4 new lines (count `+` + ` `)
    // The first context line `  // helper context` is line 9 in source.
    expect(out).toMatch(/^@@ -9,5 \+9,5 @@$/m);
  });
});

describe('normalizeDiff — empty-context-blank rewrite (Gemini regression)', () => {
  it('rewrites empty body lines to space-prefixed and counts them as context', () => {
    // Reproduces the Gemini failure mode: agent emits a diff where blank
    // context lines are truly empty (`""`) instead of space-prefixed (`" "`).
    // Without the fix, normalized header counts under-report and `git apply
    // --3way` silently no-ops the patch.
    const sourceWithBlanks = `import { test, expect } from '@playwright/test';

test('renders heading', async ({ page }) => {
    await page.goto("/pokedex", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("heading", { level: 1, name: "incorrect heading" }),
    ).toBeVisible();

    // Subtitle confirms SSR pulled the dataset.
});
`;
    writeSource('e2e/pokedex.spec.ts', sourceWithBlanks);

    // Note the `""` blank lines below — this is what Gemini actually emits.
    const raw = `diff --git a/e2e/pokedex.spec.ts b/e2e/pokedex.spec.ts
--- a/e2e/pokedex.spec.ts
+++ b/e2e/pokedex.spec.ts
@@ -3,7 +3,7 @@
     await page.goto("/pokedex", { waitUntil: "domcontentloaded" });

    await expect(
-      page.getByRole("heading", { level: 1, name: "incorrect heading" }),
+      page.getByRole("heading", { level: 1, name: "Pokédex" }),
    ).toBeVisible();

    // Subtitle confirms SSR pulled the dataset.
`;

    const out = normalizeDiff(raw, cwd);
    // Header must reflect ALL 7 context-or-removed lines, not just the 5 with
    // explicit prefixes. Same for the new side.
    expect(out).toMatch(/^@@ -\d+,7 \+\d+,7 @@$/m);
    // Output body must not contain any truly-empty lines between the header
    // and the next file marker. Every body line is either '-', '+', or ' '-
    // prefixed.
    const lines = out.split('\n');
    const hunkStart = lines.findIndex((l) => l.startsWith('@@'));
    const bodyLines = lines.slice(hunkStart + 1).filter((l) => l.length > 0 || /* will not include */ false);
    // After hunk header, the body must contain at least one literal " " line
    // (the rewritten blank).
    const blanksRewritten = lines.slice(hunkStart + 1, hunkStart + 9).filter((l) => l === ' ').length;
    expect(blanksRewritten).toBeGreaterThanOrEqual(2);
    // And NO truly-empty body lines exist before the trailing newline.
    const emptyBody = lines.slice(hunkStart + 1, lines.length - 1).filter((l) => l === '').length;
    expect(emptyBody).toBe(0);
    // Sanity: bodyLines is non-empty (silences unused-var lint without changing the assertion above).
    expect(bodyLines.length).toBeGreaterThan(0);
  });
});

describe('normalizeDiff — failure modes', () => {
  it('throws when input has no file headers', () => {
    expect(() => normalizeDiff('this is just prose, no diff content', cwd))
      .toThrow(DiffNormalizationFailure);
  });

  it('throws when --- is followed by something other than +++', () => {
    const raw = `--- a/x
some prose
@@ ... @@
-old
+new
`;
    expect(() => normalizeDiff(raw, cwd)).toThrow(/Expected '\+\+\+/);
  });

  it('throws when hunk anchor cannot be found in source', () => {
    writeSource(TEST_FILE_PATH, TEST_FILE);

    const raw = `--- a/${TEST_FILE_PATH}
+++ b/${TEST_FILE_PATH}
@@ ... @@
-this line does not exist anywhere in the source file
+replacement line
`;
    expect(() => normalizeDiff(raw, cwd)).toThrow(/Could not locate hunk anchor/);
  });
});

describe('normalizeDiff — fuzzy anchor matching', () => {
  it('falls back to trimmed-line matching when whitespace drifts', () => {
    // Source has tab indentation; diff has space indentation.
    writeSource('a.spec.ts', "test('x', () => {\n\tconst y = 1;\n});\n");

    const raw = `--- a/a.spec.ts
+++ b/a.spec.ts
@@ ... @@
-  const y = 1;
+  const y = 2;
`;
    const out = normalizeDiff(raw, cwd);
    // Source line 2 has the matching `const y = 1;` after trim.
    expect(out).toMatch(/^@@ -2,1 \+2,1 @@$/m);
  });
});

describe('normalizeDiff — multi-hunk offset accounting', () => {
  it('shifts new-side start by accumulated +/- delta', () => {
    const src = [
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
      "line 6",
      "line 7",
      "line 8",
      "line 9",
      "line 10",
      "",
    ].join('\n');
    writeSource('m.txt', src);

    // First hunk replaces 1 line with 3 lines at line 2 (delta +2).
    // Second hunk replaces 1 line with 1 line at line 8 — new-side should be 8 + 2 = 10.
    const raw = `--- a/m.txt
+++ b/m.txt
@@ ... @@
-line 2
+line 2 a
+line 2 b
+line 2 c
@@ ... @@
-line 8
+line 8 changed
`;
    const out = normalizeDiff(raw, cwd);
    expect(out).toMatch(/^@@ -2,1 \+2,3 @@$/m);
    expect(out).toMatch(/^@@ -8,1 \+10,1 @@$/m);
  });
});
