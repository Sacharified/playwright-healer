// src/ingest/summary-writer.ts
// DET-04: writes Detection table to GITHUB_STEP_SUMMARY via @actions/core.
// Phase 04: accepts enableAutoDispatch to surface live vs log-only dispatch mode.

import * as core from '@actions/core';
import type { Detection } from '../shared/types.js';
import type { GatedTest } from './threshold-evaluator.js';

export async function writeDetectionSummary(
  detections: Detection[],
  enableAutoDispatch: boolean = false,
  gated: GatedTest[] = [],
  minRunsForDetection: number = 10,
): Promise<void> {
  if (detections.length === 0) {
    let md = '### playwright-healer — Ingest complete\n\n';
    if (gated.length === 0) {
      md += 'No threshold breaches detected in this run.\n';
    } else {
      md += `No tests have crossed the flake-rate threshold yet — `;
      md += `${gated.length} ${gated.length === 1 ? 'test is' : 'tests are'} `;
      md += `accumulating runs toward the **${minRunsForDetection}-run** detection gate `;
      md += `(\`min_runs_for_detection\`).\n\n`;
      md += `<details><summary>Tests waiting for sample size (${gated.length})</summary>\n\n`;
      md += `| Test | Failures so far | Runs in window | Runs needed |\n`;
      md += `| --- | --- | --- | --- |\n`;
      for (const g of gated) {
        const needed = Math.max(0, minRunsForDetection - g.runCount);
        md += `| \`${g.testId}\` | ${g.failedCount} (${(g.flakeRate * 100).toFixed(0)}%) | ${g.runCount}/${minRunsForDetection} | ${needed} more |\n`;
      }
      md += `\n_Lower \`min_runs_for_detection\` to evaluate sooner (raises false-positive rate). `;
      md += `Set \`skip_deterministic_check: 'true'\` if you want the healer to attempt a fix on a 100%-failing test._\n`;
      md += `</details>\n`;
    }
    await core.summary.addRaw(md).write();
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

  if (gated.length > 0) {
    md += `\n<details><summary>${gated.length} additional ${gated.length === 1 ? 'test is' : 'tests are'} below the ${minRunsForDetection}-run detection gate</summary>\n\n`;
    md += `| Test | Failures so far | Runs in window | Runs needed |\n`;
    md += `| --- | --- | --- | --- |\n`;
    for (const g of gated) {
      const needed = Math.max(0, minRunsForDetection - g.runCount);
      md += `| \`${g.testId}\` | ${g.failedCount} (${(g.flakeRate * 100).toFixed(0)}%) | ${g.runCount}/${minRunsForDetection} | ${needed} more |\n`;
    }
    md += `\n</details>\n`;
  }

  await core.summary.addRaw(md).write();
}
