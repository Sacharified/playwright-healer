// src/ingest/summary-writer.ts
// DET-04 log-only: writes Detection table to GITHUB_STEP_SUMMARY via @actions/core.
// Does NOT dispatch any downstream workflow — Phase 04 will add that.

import * as core from '@actions/core';
import type { Detection } from '../shared/types.js';

export async function writeDetectionSummary(
  detections: Detection[],
): Promise<void> {
  if (detections.length === 0) {
    await core.summary
      .addHeading('playwright-healer — Ingest complete', 3)
      .addRaw('\nNo threshold breaches detected in this run.\n')
      .write();
    return;
  }

  let md = '## playwright-healer — Threshold Breaches (log-only)\n\n';
  md += `> Detection mode: **log-only** (Phase 04 enables auto-dispatch)\n\n`;
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

  md += `\n_No downstream workflow was dispatched (log-only). Enable auto-dispatch in Phase 04._\n`;

  await core.summary.addRaw(md).write();
}
