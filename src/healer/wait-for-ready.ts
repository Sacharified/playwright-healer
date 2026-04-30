// src/healer/wait-for-ready.ts
//
// CLI entry-point invoked by action.yml Step 5 after spawning start_command.
// Reads env vars, polls baseUrl via waitForReady (Plan 06), and on timeout files
// an `app-startup-timeout` issue (D-09 / HEA-03) before exiting 1.
//
// This file is deliberately tiny — composition only, no business logic.

import { waitForReady, AppStartupTimeout } from './app-supervisor.js';
import { openIssue } from './issue-writer.js';

interface Env {
  BASE_URL: string;
  STARTUP_TIMEOUT_SECONDS: string;
  HEALER_TOKEN: string;
  GH_OWNER: string;
  GH_REPO: string;
  TEST_TITLE: string;
  TRIGGERING_RUN_URL: string;
}

function readEnv(): Env {
  return {
    BASE_URL: process.env['BASE_URL'] ?? '',
    STARTUP_TIMEOUT_SECONDS: process.env['STARTUP_TIMEOUT_SECONDS'] ?? '120',
    HEALER_TOKEN: process.env['HEALER_TOKEN'] ?? '',
    GH_OWNER: process.env['GH_OWNER'] ?? '',
    GH_REPO: process.env['GH_REPO'] ?? '',
    TEST_TITLE: process.env['TEST_TITLE'] ?? '<unknown test>',
    TRIGGERING_RUN_URL: process.env['TRIGGERING_RUN_URL'] ?? '',
  };
}

export async function main(): Promise<number> {
  const env = readEnv();
  const timeoutMs = Number.parseInt(env.STARTUP_TIMEOUT_SECONDS, 10) * 1000;

  try {
    await waitForReady(env.BASE_URL, timeoutMs);
    return 0;
  } catch (err) {
    if (err instanceof AppStartupTimeout) {
      try {
        await openIssue({
          patToken: env.HEALER_TOKEN,
          owner: env.GH_OWNER,
          repo: env.GH_REPO,
          testTitle: env.TEST_TITLE,
          failureMode: 'app-startup-timeout',
          rootCause: `App at ${env.BASE_URL} did not respond within ${env.STARTUP_TIMEOUT_SECONDS}s of start_command spawn.`,
          reproSteps:
            'Check that start_command exits successfully and that base_url is correct. Verify no other process is occupying the port.',
          suggestedManualFix: `Run \`start_command\` manually and confirm the app reaches a non-5xx status on \`${env.BASE_URL}/\`. Increase startup_timeout_seconds if the app is genuinely slow to start.`,
          triggeringRunUrl: env.TRIGGERING_RUN_URL,
        });
      } catch (issueErr) {
        // If issue creation fails (e.g., GitHub API down), still exit 1 —
        // the action.yml step's non-zero exit is the gate that skips the heal step.
        // eslint-disable-next-line no-console
        console.error('Failed to file app-startup-timeout issue:', issueErr);
      }
      return 1;
    }
    // Unexpected error — fail loud
    // eslint-disable-next-line no-console
    console.error('wait-for-ready unexpected error:', err);
    return 2;
  }
}

// Run when invoked directly (not when imported by tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => process.exit(code));
}
