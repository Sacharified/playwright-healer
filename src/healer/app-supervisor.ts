// src/healer/app-supervisor.ts
//
// Readiness probe (HEA-02 / D-15) + PID-file path constant (HEA-03 / HEA-06 / D-12).
//
// Note: this file does NOT spawn the start-command. Per CONTEXT D-14 + Architectural
// Responsibility Map, the long-running app process is spawned by action.yml composite
// Step 4 ("Spawn start-command (background) + wait for ready"), which writes the
// PID to PID_FILE_PATH. This TypeScript file:
//   1. Provides the probe loop that the action.yml step's `npx tsx` invocation runs
//   2. Defines the PID_FILE_PATH constant — single source of truth shared with the
//      Plan 14 post-step pkill (D-12 outer cleanup)
//   3. Exposes a stop() helper that reads the PID file and signals the process —
//      called by Plan 13 orchestrator's try/finally (D-12 inner cleanup, HEA-06)

import { existsSync, readFileSync } from 'node:fs';

export const PID_FILE_PATH = '/tmp/playwright-healer-app-pid';

export class AppStartupTimeout extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AppStartupTimeout';
  }
}

/**
 * Poll baseUrl until an HTTP response with status < 500 is received, or until
 * timeoutMs elapses. Per D-15:
 *   - method: GET, no body parsing
 *   - redirect set to manual so 302/401 count as "up"
 *   - per-attempt timeout: 2s (so a hung connection doesn't consume the full budget)
 *   - cadence: 1s between attempts
 *   - failure: ECONNREFUSED / AbortError / ENOTFOUND → keep polling
 *
 * Throws AppStartupTimeout on timeout — caller should route to issue-fallback
 * with failureMode = 'app-startup-timeout' (D-09).
 */
export async function waitForReady(baseUrl: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(2000),
      });
      if (response.status < 500) return;
      // 5xx: server up but degraded — keep polling.
    } catch {
      // ECONNREFUSED / AbortError / ENOTFOUND / DNS — not yet ready.
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new AppStartupTimeout(
    `App at ${baseUrl} did not become ready within ${timeoutMs / 1000}s`,
  );
}

/**
 * Read the PID file written by action.yml Step 4. Returns null if absent or unreadable.
 * Used by Plan 13 orchestrator's try/finally to signal SIGTERM (HEA-06 inner cleanup).
 */
export function readPidFile(): number | null {
  try {
    if (!existsSync(PID_FILE_PATH)) return null;
    const txt = readFileSync(PID_FILE_PATH, 'utf8').trim();
    const pid = Number.parseInt(txt, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Inner cleanup helper (HEA-06 / D-12 layer 1): graceful SIGTERM.
 * Plan 13 orchestrator calls this in its try/finally. The Plan 14 post-step
 * does the SIGKILL fallback via `kill $(cat /tmp/playwright-healer-app-pid)`.
 */
export function stop(): void {
  const pid = readPidFile();
  if (pid === null) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // process may have already exited — fine
  }
}
