import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  retries: 0,
  workers: 1,
  reporter: [['list'], ['json', { outputFile: 'playwright-report.json' }]],
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:8080',
    headless: true,
  },
});
