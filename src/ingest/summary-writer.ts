// src/ingest/summary-writer.ts
// DET-04: writes Detection table to GITHUB_STEP_SUMMARY via @actions/core.
// Phase 04: accepts enableAutoDispatch to surface live vs log-only dispatch mode.

import * as core from '@actions/core';
import type { Detection } from '../shared/types.js';

export async function writeDetectionSummary(
  detections: Detection[],
  enableAutoDispatch: boolean = false,
): Promise<void> {
  if (detections.length === 0) {
    await core.summary
      .addHeading('playwright-healer — Ingest complete', 3)
      .addRaw('\nNo threshold breaches detected in this run.\n')
      .write();
    return;
  }

  const modeLabel = enableAutoDispatch
    ? `Detection mode: **live** — auto-dispatch enabled`
    : `Detection mode: **log-only** — set \`enable_auto_dispatch: 'true'\` to enable healing`;

  let md = '## playwright-healer — Threshold Breaches\n\n';
  md += `> ${modeLabel}\n\n`;
  md += `| Test | Reason | Value | Threshold | Runs in Window |\n`;
  md += `| --- | --- | --- | --- | --- |\n`;

  for (const d of detections) {
    const valueStr =
      d.reason === 'flake-rate'
        ? `${(d.value * 100).toFixed(1)}%`
        : `${d.value.toFixed(2)}x`;
    const thresholdStr =
      d.reason === 'flake-rate'
        ? `${(d.threshold * 100).toFixed(1)}%`
        : `${d.threshold.toFixed(2)}x`;
    md += `| \`${d.testId}\` | ${d.reason} | ${valueStr} | ${thresholdStr} | ${d.runCount} |\n`;

    core.warning(
      `playwright-healer: ${d.reason} threshold breached for "${d.testId}" ` +
        `(${valueStr} >= ${thresholdStr} over ${d.runCount} runs in ${d.windowDays} days)`,
      { file: d.filePath },
    );
  }

  if (enableAutoDispatch) {
    md += `\n_Auto-dispatch enabled. See "Heal dispatched" entries below for fired heals._\n`;
  } else {
    md += `\n_No downstream workflow was dispatched (log-only)._\n`;
  }

  await core.summary.addRaw(md).write();
}
