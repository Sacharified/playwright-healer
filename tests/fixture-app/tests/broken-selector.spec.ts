import { test, expect } from '@playwright/test';

// Deliberately broken: #wrong-id does not exist in tests/fixture-app/index.html
// (the real button id is #correct-id). The healer is expected to fix this
// via either a literal id swap or a more semantic locator (getByRole).
//
// This file MUST stay broken on main. If a heal PR is merged that fixes it,
// re-running the E2E requires reverting this file to its broken form first.
test('clicks submit button and sees confirmation', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Submit' }).click();
  await expect(page.locator('#message')).toHaveText('Submitted!');
});
