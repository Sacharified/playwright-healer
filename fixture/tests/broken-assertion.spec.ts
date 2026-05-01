// fixture/tests/broken-assertion.spec.ts
//
// Phase 04 FIX-07 fixture: assertion-class bug. The submit button's selector
// resolves correctly (the button text "Submit" and the `#message` selector both
// match the fixture HTML). The test asserts the WRONG rendered text — the
// fixture renders `'Submitted!'` (WITH bang per fixture/index.html:13), and
// this spec asserts `'Submission complete'` instead.
//
// Expected agent classification: `assertions` (errorSignature contains
// `expect(received).toHaveText` plus `Expected: "Submission complete"` /
// `Received: "Submitted!"`).
// Expected fix: change the literal to `'Submitted!'` to match actual rendered
// state. The diff-lint pass does NOT classify this as weakening — the assertion
// stays equally specific (literal-match), it just corrects the wrong value.

import { test, expect } from '@playwright/test';

test('clicks submit button and sees assertion confirmation', async ({ page }) => {
  // BASE_URL is set by the e2e-heal-self.yml workflow; default for local dev
  await page.goto(process.env.BASE_URL ?? 'http://localhost:8080');

  // Selector RESOLVES correctly — button has text "Submit" per fixture/index.html:9.
  // This is NOT a selector bug.
  await page.getByRole('button', { name: 'Submit' }).click();

  // ASSERTION BUG: actual rendered text per fixture/index.html:13 is "Submitted!"
  // (with bang). This spec asserts "Submission complete" — wrong literal.
  // The healer should fix this by correcting the literal to 'Submitted!',
  // NOT by weakening to .toContainText() or removing the assertion.
  await expect(page.locator('#message')).toHaveText('Submission complete');
});
