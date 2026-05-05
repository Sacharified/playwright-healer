// src/healer/index.ts
//
// Phase 3 heal pipeline orchestrator (CONTEXT D-13 single-process design).
// Eleven numbered steps. Six failure modes route to issue-fallback per D-09;
// success path opens a PR via the healer_token PAT (D-20 / SC-1).
//
// HEA-06 inner cleanup: try/finally calls appSupervisor.stop() on every exit.
// Outer cleanup is action.yml post-step (Plan 14, D-12 layer 2).
//
// app-startup-timeout (D-09 row 1) is handled by action.yml Step 4 directly,
// NOT by this orchestrator — by the time run() executes, the app is up.
//
// Cost pass-through (revised 2026-04-26 per checker BLOCKER #1): the adapter
// returns `{ proposal, stats: { usdSpent, turnsUsed } }`. The orchestrator
// threads stats.usdSpent into openHealerPr({ costUsd }) for PRI-02, and into
// agent-budget-exhausted / validation-failed issue bodies so maintainers see
// real heal economics. NO hardcoded zero anywhere.

import * as core from '@actions/core';
import * as github from '@actions/github';
import * as path from 'node:path';
import type { Config } from '../shared/config.js';
import { DEFAULT_MODELS, DEFAULT_ENDPOINTS } from '../shared/config.js';
import { ALLOWED_TOOLS } from '../shared/security-contract.js';
import { DispatchPayload } from './dispatch-payload.js';
import type { Adapter, FixProposal, NoFixProposable, AgentRunStats } from './adapter.js';
import type { FailureMode } from './types.js';
import { lintDiff } from './diff-lint.js';
import { assemblePrompt } from './prompt-assembler.js';
import { BudgetExhausted } from './budget.js';
import { stop as supervisorStop } from './app-supervisor.js';
import { bundleContext } from './context-bundler.js';
import { validate } from './validator.js';
import type { ValidationResult } from './validator.js';
import { applyFix } from './fix-applier.js';
import { createGithubAdapter } from './adapters/github.js';
import { createOpenrouterAdapter } from './adapters/openrouter.js';
import { ollamaAdapter } from './adapters/ollama.js';
import { openHealerPr, extractPatchedFiles } from './pr-writer.js';
import { openIssue } from './issue-writer.js';
import { shouldSkipHeal } from '../shared/loop-guard.js';
import { appendHealEvent, bootstrapOrGetWorktree, removeWorktree } from '../shared/state-branch.js';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function formatStatsLine(stats: AgentRunStats): string {
  return `Agent stats: spent $${stats.usdSpent.toFixed(4)} across ${stats.turnsUsed} turn(s).`;
}

function selectAdapter(config: Config): Adapter {
  switch (config.provider) {
    case 'openrouter':
      return createOpenrouterAdapter({
        apiKey: config.apiKey,
        model: config.model.length > 0 ? config.model : DEFAULT_MODELS.openrouter,
        endpoint: config.apiEndpoint.length > 0 ? config.apiEndpoint : (DEFAULT_ENDPOINTS.openrouter ?? ''),
        baseUrl: config.baseUrl,
        maxTurns: config.maxTurns,
        maxBudgetUsd: config.maxBudgetUsd,
      });
    case 'github':
      return createGithubAdapter({
        apiKey: config.apiKey,
        model: config.model.length > 0 ? config.model : DEFAULT_MODELS.github,
        endpoint: config.apiEndpoint.length > 0 ? config.apiEndpoint : (DEFAULT_ENDPOINTS.github ?? ''),
        baseUrl: config.baseUrl,
        maxTurns: config.maxTurns,
      });
    case 'ollama':
      return ollamaAdapter;    // throws on call (Phase 3 stub)
  }
}

interface IssueOpts {
  config: Config;
  owner: string;
  repo: string;
  testFile: string;
  testTitle: string;
  triggeringRunUrl: string;
  failureMode: FailureMode;
  rootCause: string;
  reproSteps: string;
  suggestedManualFix: string;
  stateWorktreePath: string | null;
}

async function fileIssue(opts: IssueOpts): Promise<void> {
  const issueUrl = await openIssue({
    patToken: opts.config.healerToken,
    owner: opts.owner,
    repo: opts.repo,
    testTitle: opts.testTitle,
    failureMode: opts.failureMode,
    rootCause: opts.rootCause,
    reproSteps: opts.reproSteps,
    suggestedManualFix: opts.suggestedManualFix,
    triggeringRunUrl: opts.triggeringRunUrl,
  });

  // Phase 04 — heal-event write site #2 (Pitfall 7).
  // For the cap-exceeded branch (Step 1.5), the caller writes its OWN
  // appendHealEvent with outcome: 'cap-reached' after this call.
  // For all other failureMode tokens, write outcome: 'issue-opened' here.
  if (opts.stateWorktreePath && opts.failureMode !== 'cap-exceeded') {
    try {
      await appendHealEvent(
        {
          schemaVersion: 1,
          timestamp: new Date().toISOString(),
          testId: `${opts.testFile}::${opts.testTitle}`,
          outcome: 'issue-opened',
          dispatchRunId: process.env.GITHUB_RUN_ID ?? 'local',
          issueUrl,
        },
        opts.stateWorktreePath,
      );
    } catch (err) {
      core.warning(`Phase 04: heal-event write failed (analytics-only loss): ${String(err)}`);
    }
  }
}

export async function run(config: Config): Promise<void> {
  // ── Step 1: Validate dispatch payload (D-18 / Zod) ─────────────────────
  const inputs = (github.context.payload as { inputs?: unknown }).inputs ?? {};
  const parsed = DispatchPayload.safeParse(inputs);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    core.setFailed(`Invalid dispatch payload: ${msg}`);
    return;
  }
  const payload = parsed.data;

  const owner = github.context.repo.owner;
  const repo = github.context.repo.repo;
  const triggeringRunUrl =
    `${github.context.serverUrl ?? 'https://github.com'}/${owner}/${repo}/actions/runs/${github.context.runId}`;
  // workspace = consumer's repo root. cwd = workspace + working_directory
  // (default ''). Healer file ops (bundleContext, validator, fix-applier)
  // all run from cwd, so monorepos with the app under e.g. `frontend/` can
  // set working_directory: 'frontend' and have test paths like
  // `pokedex.spec.ts` resolve correctly. State branch ops still use the
  // workspace root (state branch is repo-wide, not subdir-scoped).
  const workspace = process.env['GITHUB_WORKSPACE'] ?? process.cwd();
  const cwd = path.resolve(workspace, config.workingDirectory);
  // Default branch detection: action.yml passes it via env if available; fallback to 'main'.
  const defaultBranch = process.env['HEALER_DEFAULT_BRANCH'] ?? 'main';

  // ── Step 1.5: SEC-05 Guard 3 — per-test heal cap (Phase 04, NEW per RESEARCH Pitfall 6) ─
  // Bootstraps the state-branch worktree once; threaded through to Step 11
  // and the cap-hit fileIssue branch. Removed in the outer finally block.
  const remoteUrl =
    `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/` +
    `${process.env.GITHUB_REPOSITORY ?? ''}.git`;
  let stateWorktreePath: string | null = null;

  try {
    // Inner try/catch: bootstrap failure is non-fatal. If bootstrap fails,
    // stateWorktreePath stays null and the pipeline continues without the
    // Guard 3 backstop (D-04 ingest pre-check is the cheap layer).
    try {
      // State branch ops use workspace root, not the working_directory subdir —
      // the state branch is repo-wide. Other ops in this file use `cwd`.
      stateWorktreePath = await bootstrapOrGetWorktree(remoteUrl, workspace);
      const testId = `${payload.testFile}::${payload.testTitle}`;
      const guard3 = shouldSkipHeal(testId, config, stateWorktreePath);
      if (guard3.skip) {
        await fileIssue({
          config, owner, repo,
          testFile: payload.testFile,
          testTitle: payload.testTitle,
          stateWorktreePath,
          triggeringRunUrl,
          failureMode: 'cap-exceeded',
          rootCause: `SEC-05 Guard 3: per-test heal cap reached (${guard3.count} >= ${config.maxHealsPerTestPerWeek}). Manual review required.`,
          reproSteps: 'Inspect prior heal artifacts for this test in the state branch heal log (runs/YYYY/MM/DD-heals.ndjson).',
          suggestedManualFix: 'A human must approve the next heal attempt by clearing the prior heal events on the state branch OR raising max_heals_per_test_per_week in workflow inputs.',
        });
        await appendHealEvent(
          {
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            testId,
            outcome: 'cap-reached',
            dispatchRunId: process.env.GITHUB_RUN_ID ?? 'local',
          },
          stateWorktreePath,
        );
        return;  // outer finally WILL run — stateWorktreePath cleanup is guaranteed
      }
    } catch (err) {
      core.warning(
        `Phase 04 Guard 3: state-branch bootstrap failed (${String(err)}). Proceeding without backstop cap check.`,
      );
    }

    // ── Step 2: Select provider adapter (D-01 / D-02) ────────────────────
    const adapter = selectAdapter(config);

    // ── Step 3: Bundle context (HEA-04 / HEA-05) ─────────────────────────
    const context = await bundleContext({
      testFile: payload.testFile,
      testTitle: payload.testTitle,
      cwd,
      traceAttachmentPath: undefined, // Phase 3 manual dispatch does not provide a trace path
      recentErrorMessages: [],
    });

    // ── Step 4: PRI-05 sanity rerun (deterministic-failure detection) ────
    // WR-03 fix: validate() is expensive; skip it entirely when the deterministic
    // check is disabled (demo mode). Was: validate ran unconditionally, then the
    // result was checked behind the skip gate.
    if (!config.skipDeterministicCheck) {
      const sanity = await validate(payload.testFile, payload.testTitle, config.rerunCount, cwd);
      if (sanity.passRate === 0) {
        await fileIssue({
          config, owner, repo,
          testFile: payload.testFile,
          testTitle: payload.testTitle,
          stateWorktreePath,
          triggeringRunUrl,
          failureMode: 'deterministic-failure',
          rootCause: `Test failed 0/${config.rerunCount} times on UNMODIFIED code — likely an application bug or a deterministic regression, not a flake.`,
          reproSteps: `Run \`npx playwright test ${payload.testFile} --grep "${payload.testTitle}" --retries=0\` against the dispatch SHA.`,
          suggestedManualFix: 'Inspect the failing assertion and recent application changes. The healer does NOT auto-fix deterministic failures — silently fixing a real regression is the highest-trust risk per project policy.',
        });
        return;
      }
    }

    // ── Step 5: Assemble prompt (D-05 / D-06 / D-07 / D-08) ─────────────
    const systemPrompt = assemblePrompt({
      fixClassHint: payload.fixClassHint,
      traceAttachmentPath: context.traceAttachmentPath,
      testTitle: payload.testTitle,
      testFile: payload.testFile,
      baseUrl: config.baseUrl,
    });

    // ── Step 6: Run adapter (FIX-01 / FIX-02 / FIX-04) ──────────────────
    // Revised 2026-04-26: adapter returns `{ proposal, stats }`. Stats are
    // threaded into PR body (Step 11) and into issue bodies for the FIX-08 /
    // VAL-03 routes so PRI-02 cost data is visible in every healer artifact.
    let proposal!: FixProposal | NoFixProposable;
    let stats!: AgentRunStats;
    try {
      const result = await adapter.runAgent(context, systemPrompt, ALLOWED_TOOLS);
      proposal = result.proposal;
      stats = result.stats;
    } catch (err) {
      if (err instanceof BudgetExhausted) {
        // BudgetExhausted carries the at-throw stats (Plan 05). Read them so
        // the agent-budget-exhausted issue body shows real cost data.
        const burnUsd = err.usdSpent;
        const burnTurns = err.turnsUsed;
        await fileIssue({
          config, owner, repo,
          testFile: payload.testFile,
          testTitle: payload.testTitle,
          stateWorktreePath,
          triggeringRunUrl,
          failureMode: 'agent-budget-exhausted',
          rootCause: `Agent exceeded budget ceiling: ${err.message}. Spent $${burnUsd.toFixed(4)} across ${burnTurns} turn(s) before exhaustion.`,
          reproSteps: 'Increase max_budget_usd or max_turns in workflow inputs and re-dispatch.',
          suggestedManualFix: `If recurring, inspect the agent transcript in the run log for tool-loop patterns; consider tightening the fix-class hint. Burn rate before exhaustion: $${burnUsd.toFixed(4)} / ${burnTurns} turn(s).`,
        });
        return;
      }
      throw err;
    }

    // ── Step 7: NoFixProposable routes to issue (FIX-08) ────────────────
    if ('reason' in proposal) {
      await fileIssue({
        config, owner, repo,
        testFile: payload.testFile,
        testTitle: payload.testTitle,
        stateWorktreePath,
        triggeringRunUrl,
        failureMode: 'no-fix-proposable',
        rootCause: `Agent could not propose a fix: ${proposal.reason}`,
        reproSteps: proposal.evidence,
        suggestedManualFix: `Manually inspect the test and consider whether it requires a different fix class than the hint suggested. ${formatStatsLine(stats)}`,
      });
      return;
    }

    // ── Phase 04 FIX-07 observability: log when the agent overrides the dispatch hint.
    // The agent has authority — it observes the failure live (or via trace) and may
    // reclassify based on evidence the classifier didn't have. The hint is advisory.
    if (proposal.fixClass !== payload.fixClassHint) {
      core.info(
        `Agent overrode fixClassHint: hinted=${payload.fixClassHint}, chose=${proposal.fixClass}`,
      );
    }

    // ── Step 8: Diff-lint (FIX-06) ──────────────────────────────────────
    const findings = lintDiff(proposal.diff);
    if (!config.skipDiffLint && findings.length > 0) {
      await fileIssue({
        config, owner, repo,
        testFile: payload.testFile,
        testTitle: payload.testTitle,
        stateWorktreePath,
        triggeringRunUrl,
        failureMode: 'diff-lint-blocked',
        rootCause: `Agent proposed a fix that triggered ${findings.length} diff-lint finding(s): ${findings.map((f) => f.pattern).join(', ')}`,
        reproSteps: 'Diff was rejected before application. Agent rationale: ' + proposal.rationale,
        suggestedManualFix: `The forbidden patterns are: waitForTimeout, :nth-child, positional XPath, weakened assertions, files outside test directory. Re-dispatch may yield a different fix; consider adjusting the fix-class hint. ${formatStatsLine(stats)}`,
      });
      return;
    }

    // ── Step 9: Apply diff (FIX-05 / PRI-06) ────────────────────────────
    const shortSha = payload.commitSha.slice(0, 7);
    const testSlug = slugify(payload.testTitle);
    const { branch } = await applyFix({
      diff: proposal.diff,
      defaultBranch,
      testSlug,
      shortSha,
      cwd,
      token: config.healerToken,
      botEmail: config.botEmail,
      botName: config.botName,
    });

    // ── Step 10: Validate the fix (VAL-01 / VAL-02 / VAL-03) ────────────
    let validation: ValidationResult;
    if (config.skipPostFixValidation) {
      // Demo mode (D-02): fixture-ci.yml on the PR is the truth, not local validator.
      // WR-02 fix: passRate stays at 0; total: 0 signals "skipped" to renderPrBody.
      // Was: passRate: 1 caused the PR body to render "100%" against zero reruns,
      // which read as a hard-passed validation when the validator was actually skipped.
      // perRun MUST be [] (not undefined) because pr-writer.ts maps over it.
      validation = { passed: 0, total: 0, passRate: 0, perRun: [] };
    } else {
      validation = await validate(payload.testFile, payload.testTitle, config.rerunCount, cwd);
      if (validation.passRate < config.rerunPassRate) {
        await fileIssue({
          config, owner, repo,
          testFile: payload.testFile,
          testTitle: payload.testTitle,
          stateWorktreePath,
          triggeringRunUrl,
          failureMode: 'validation-failed',
          rootCause: `Fix validation pass rate ${(validation.passRate * 100).toFixed(0)}% (< required ${(config.rerunPassRate * 100).toFixed(0)}%). ${formatStatsLine(stats)}`,
          reproSteps: `Validator ran ${validation.total} reruns at retries=0; ${validation.passed} passed.`,
          suggestedManualFix: `The proposed fix is unstable. Inspect the agent rationale: ${proposal.rationale}. ${formatStatsLine(stats)}`,
        });
        return;
      }
    }

    // ── Step 11: Open the PR (PRI-01 / PRI-02 / SC-1) ───────────────────
    // costUsd: stats.usdSpent — REAL data per PRI-02 (revised 2026-04-26).
    // Phase 05: auto-merge gate fields threaded from config + diff.
    const autoMergeFixClasses = config.autoMergeFixClasses
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const patchedFiles = extractPatchedFiles(proposal.diff);

    const prUrl = await openHealerPr({
      patToken: config.healerToken,
      owner,
      repo,
      testTitle: payload.testTitle,
      testFile: payload.testFile,
      defaultBranch,
      branch,
      rootCause: proposal.rootCause,
      fixClass: proposal.fixClass,
      rationale: proposal.rationale,
      validation,
      costUsd: stats.usdSpent,
      triggeringRunUrl,
      traceLink: null,
      // Phase 05:
      enableAutoMerge: config.enableAutoMerge,
      autoMergePassRate: config.autoMergePassRate,
      autoMergeFixClasses,
      patchedFiles,
    });

    // Phase 04 — heal-event write site #1 (Pitfall 7): PR opened successfully.
    if (stateWorktreePath) {
      try {
        await appendHealEvent(
          {
            schemaVersion: 1,
            timestamp: new Date().toISOString(),
            testId: `${payload.testFile}::${payload.testTitle}`,
            outcome: 'pr-opened',
            dispatchRunId: process.env.GITHUB_RUN_ID ?? 'local',
            prUrl,
          },
          stateWorktreePath,
        );
      } catch (err) {
        core.warning(`Phase 04: heal-event write failed (analytics-only loss): ${String(err)}`);
      }
    }
  } catch (err) {
    // BudgetExhausted is caught at Step 6 (inner catch) and handled there.
    // Any other error reaching here is an unexpected pipeline failure.
    // Per D-09 "no silent failures": file a GitHub issue so the consumer
    // has a GitHub artifact to act on (no human should read action logs).
    // 'no-fix-proposable' is the closest available D-09 token for unexpected errors
    // (D-09 locks six tokens; an 'unexpected-error' seventh is not in the list).
    const msg = err instanceof Error ? err.message : String(err);
    core.error(`Unexpected healer pipeline error: ${msg}`);
    try {
      await fileIssue({
        config,
        owner,
        repo,
        testFile: payload.testFile,
        testTitle: payload.testTitle,
        stateWorktreePath,
        triggeringRunUrl,
        failureMode: 'no-fix-proposable',
        rootCause: `Unexpected pipeline error: ${msg.slice(0, 2000)}`,
        reproSteps: 'Check the action run log for the full stack trace.',
        suggestedManualFix:
          'Inspect the error message above and file a bug against playwright-healer if it is reproducible.',
      });
    } catch (issueErr) {
      // If issue filing itself fails, log and continue — core.setFailed below is the gate.
      core.warning(`Failed to file pipeline-error issue: ${issueErr instanceof Error ? issueErr.message : String(issueErr)}`);
    }
    core.setFailed(msg);
  } finally {
    // ── HEA-06 inner cleanup (D-12 layer 1) ─────────────────────────────
    try { supervisorStop(); } catch { /* swallow — outer pkill is the safety net */ }
    if (stateWorktreePath) {
      await removeWorktree(stateWorktreePath).catch((e: unknown) =>
        core.warning(`State worktree cleanup failed: ${String(e)}`),
      );
    }
  }
}
