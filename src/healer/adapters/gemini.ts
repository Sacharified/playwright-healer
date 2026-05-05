// src/healer/adapters/gemini.ts
//
// Phase 3 — Gemini adapter. Manual tool-use loop with budget enforcement.
//
// SECURITY-CRITICAL TWO INVARIANTS (CONTEXT D-03, rewritten 2026-04-27):
//   1. ALLOWED_ORIGINS scope: Playwright MCP is spawned with
//      --allowed-origins=${baseUrl};http://localhost:* via ALLOWED_ORIGIN_TEMPLATE
//      (SEC-03 / D-21). Defense-in-depth layer (b) per RESEARCH §Conflict #2.
//   2. ALLOWED_TOOLS audit invariant (D-03 supersedes any prior "translation"
//      framing): every tool returned by mcpClient.listTools() must map to a
//      glob in ALLOWED_TOOLS after applying the canonical 'mcp__playwright__'
//      prefix. Adapter THROWS before any generateContent call if the audit fails.
//      This is the SEC-04 enforcement point.
//
// Inline string literals of MCP tool names are banned (Phase 1 D-13). All
// references go through the ALLOWED_TOOLS import.
//
// Return contract (revised 2026-04-26 per checker BLOCKER #1): every successful
// resolve produces `{ proposal, stats }` where stats.usdSpent and stats.turnsUsed
// come DIRECTLY from the BudgetTracker. Hardcoding zeros is forbidden — Plan 12
// orchestrator threads stats.usdSpent into PRI-02 PR body and into the
// agent-budget-exhausted / validation-failed issue bodies.

import { GoogleGenAI, mcpToTool } from '@google/genai';
import type { Content, Part } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ALLOWED_TOOLS, ALLOWED_ORIGIN_TEMPLATE, MCP_PLAYWRIGHT_TOOL_PREFIX } from '../../shared/security-contract.js';
import { BudgetTracker, BudgetExhausted } from '../budget.js';
import type { Adapter, FixProposal, NoFixProposable, AgentRunStats } from '../adapter.js';

// FIX-07: Allow-list of all valid fixClass values (T-04-04 mitigation — LLM-controlled
// field validated via includes() guard before casting; rejects any value outside the four).
const VALID_CLASSES = ['selectors', 'waits', 'assertions', 'slow'] as const;
type FixClass = typeof VALID_CLASSES[number];
import type { ContextBundle } from '../types.js';

// Backoff schedule for 503 UNAVAILABLE retries on gemini-2.5-pro.
// Pro is heavily contended; a single 503 should not fail the whole heal.
// 3 retries (4 attempts total) ~ 30s max overhead before giving up.
const DEFAULT_RETRY_BACKOFF_MS = [2000, 8000, 20000] as const;

export interface GeminiAdapterOpts {
  apiKey: string;
  model: string;          // e.g., 'gemini-2.5-pro' (DEFAULT_MODELS.gemini)
  baseUrl: string;        // for ALLOWED_ORIGIN_TEMPLATE
  maxTurns: number;       // FIX-02 ceiling
  maxBudgetUsd: number;   // FIX-02 ceiling
  // Optional injection points for testing — production code uses defaults
  _GoogleGenAI?: typeof GoogleGenAI;
  _Client?: typeof Client;
  _StdioClientTransport?: typeof StdioClientTransport;
  _mcpToTool?: typeof mcpToTool;
  _retryBackoffMs?: readonly number[]; // tests pass [0,0,0] for instant retries
}

export function createGeminiAdapter(opts: GeminiAdapterOpts): Adapter {
  return {
    runAgent: (context, systemPrompt, _allowedTools) =>
      runAgentImpl(opts, context, systemPrompt),
  };
}

function globMatch(pattern: string, name: string): boolean {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(name);
}

// Detects Gemini's "high demand" 503 UNAVAILABLE response. The SDK exports
// ApiError with a numeric .status, but defensively also matches the JSON body
// surfaced via .message in case a different error wrapper is used.
function isRetriable503(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: unknown; message?: unknown };
  if (e.status === 503) return true;
  if (typeof e.message === 'string') {
    if (/"code"\s*:\s*503/.test(e.message)) return true;
    if (/"status"\s*:\s*"UNAVAILABLE"/.test(e.message)) return true;
  }
  return false;
}

async function callWithRetry<T>(
  fn: () => Promise<T>,
  backoffMs: readonly number[],
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRetriable503(err) || attempt >= backoffMs.length) throw err;
      const delay = backoffMs[attempt];
      console.warn(
        `Gemini 503 UNAVAILABLE — retrying in ${delay}ms (attempt ${attempt + 2}/${backoffMs.length + 1})`,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function runAgentImpl(
  opts: GeminiAdapterOpts,
  context: ContextBundle,
  systemPrompt: string,
): Promise<{ proposal: FixProposal | NoFixProposable; stats: AgentRunStats }> {
  const TransportCtor = opts._StdioClientTransport ?? StdioClientTransport;
  const ClientCtor = opts._Client ?? Client;
  const GoogleGenAICtor = opts._GoogleGenAI ?? GoogleGenAI;
  const mcpToToolFn = opts._mcpToTool ?? mcpToTool;

  // 1. Spawn Playwright MCP with --allowed-origins (SEC-03 / D-21)
  const allowedOrigins = ALLOWED_ORIGIN_TEMPLATE(opts.baseUrl).join(';');
  const transport = new TransportCtor({
    command: 'npx',
    args: [
      '@playwright/mcp@0.0.70',
      '--headless',
      `--allowed-origins=${allowedOrigins}`,
    ],
  });

  // 2. Connect MCP Client
  const mcpClient = new ClientCtor({ name: 'playwright-healer', version: '0.1.0' });
  await mcpClient.connect(transport);

  // Initialize budget tracker — declared OUTSIDE the try so the BudgetExhausted
  // thrown from assertCanProceed carries at-throw stats for the orchestrator.
  // Plan 12 catches BudgetExhausted and reads err.usdSpent / err.turnsUsed.
  const budget = new BudgetTracker({
    maxTurns: opts.maxTurns,
    maxBudgetUsd: opts.maxBudgetUsd,
  });

  const retryBackoffMs = opts._retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;

  try {
    // 3. AUDIT INVARIANT (SEC-04 / D-03 — supersedes any "translation" framing)
    // Every tool returned by listTools() must satisfy two conditions:
    //   (a) Its canonical form (mcp__playwright__<name>) is covered by a glob in ALLOWED_TOOLS.
    //   (b) Its raw name matches the Playwright MCP browser_* convention — this is the
    //       discriminant between genuine Playwright tools and rogue tools (e.g., filesystem_write)
    //       that would also satisfy the broader mcp__playwright__* glob after prefixing.
    // Both checks must pass. Throws BEFORE any generateContent call if either fails.
    const toolList = await mcpClient.listTools();
    for (const tool of toolList.tools) {
      const canonical = `mcp__playwright__${tool.name}`;
      const covered =
        ALLOWED_TOOLS.some((p) => globMatch(p, canonical)) &&
        tool.name.startsWith(MCP_PLAYWRIGHT_TOOL_PREFIX);
      if (!covered) {
        throw new Error(
          `Audit failed: MCP tool '${tool.name}' (canonical '${canonical}') is not covered by ALLOWED_TOOLS`,
        );
      }
    }

    // 4. Initialize Gemini client
    const ai = new GoogleGenAICtor({ apiKey: opts.apiKey });

    // 5. Build initial contents — context bundle only (systemPrompt goes to systemInstruction)
    const contextSummary = renderContextForAgent(context);
    const contents: Content[] = [{ role: 'user', parts: [{ text: contextSummary } as Part] }];

    // 6. Initialize MCP callable once — mcpToTool is a one-time setup per @google/genai docs.
    // Calling it inside the loop re-initializes transport side effects on every turn.
    const mcpCallable = mcpToToolFn(mcpClient);
    await mcpCallable.tool(); // one-time initialize side-effect (RESEARCH §Pattern 1)

    // 7. Manual tool-use loop (FIX-02)
    // BudgetTracker.assertCanProceed() is the pre-call gate.
    // BudgetTracker.recordUsage() accounts tokens after each successful response.
    while (true) {
      budget.assertCanProceed(); // pre-call gate — throws BudgetExhausted if over ceiling

      const response = await callWithRetry(
        () =>
          ai.models.generateContent({
            model: opts.model,
            contents,
            config: {
              systemInstruction: systemPrompt,            // system role — isolated from user content
              tools: [mcpCallable],
              automaticFunctionCalling: { disable: true },
            },
          }),
        retryBackoffMs,
      );

      budget.recordUsage(response.usageMetadata ?? {});

      const functionCalls = response.functionCalls;
      if (!functionCalls || functionCalls.length === 0) {
        // Final answer — parse FixProposal | NoFixProposable
        const proposal = parseFinalText(response.text ?? '');
        return {
          proposal,
          // stats sourced DIRECTLY from BudgetTracker — no hardcoded zeros (PRI-02)
          stats: { usdSpent: budget.usdSpent, turnsUsed: budget.turnsUsed },
        };
      }

      // Execute the tool calls via the MCP callable
      const responseParts = await mcpCallable.callTool(functionCalls);

      contents.push({
        role: 'model',
        parts: response.candidates?.[0]?.content?.parts ?? [],
      });
      contents.push({ role: 'user', parts: responseParts });
    }
  } finally {
    // Cleanup on all exit paths (success, BudgetExhausted, any error) — HEA-06
    try { await mcpClient.close(); } catch { /* ignore cleanup errors */ }
  }
}

function renderContextForAgent(context: ContextBundle): string {
  const importsBlock = Object.entries(context.firstHopImports)
    .map(([p, src]) => `### ${p}\n\n\`\`\`\n${src}\n\`\`\``)
    .join('\n\n');
  const tracePath = context.traceAttachmentPath
    ? `Trace zip: ${context.traceAttachmentPath}`
    : 'Trace zip: <missing — reproduce via Playwright MCP>';
  const recent = context.recentErrorMessages.length
    ? context.recentErrorMessages.join('\n')
    : '<none provided>';
  return [
    '## Failing test',
    `File: ${context.testFile}`,
    `Title: ${context.testTitle}`,
    '',
    '## Test source',
    '```',
    context.testFileSource,
    '```',
    '',
    importsBlock ? '## First-hop imports\n\n' + importsBlock : '',
    '',
    '## git blame',
    '```',
    context.gitBlame || '<unavailable>',
    '```',
    '',
    `## ${tracePath}`,
    '',
    '## Recent error messages',
    '```',
    recent,
    '```',
  ].join('\n');
}

function parseFinalText(text: string): FixProposal | NoFixProposable {
  // Strip Markdown code fences if present (e.g., ```json ... ```).
  const stripped = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    throw new Error(`Agent returned non-JSON final text: ${err}`);
  }
  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    'reason' in parsed &&
    typeof (parsed as Record<string, unknown>).reason === 'string' &&
    (parsed as Record<string, unknown>).reason === 'no-fix-proposable'
  ) {
    const p = parsed as Record<string, unknown>;
    return { reason: p.reason as string, evidence: String(p.evidence ?? '') };
  }
  if (parsed !== null && typeof parsed === 'object') {
    const p = parsed as Record<string, unknown>;
    if (
      typeof p.rootCause === 'string' &&
      typeof p.fixClass === 'string' &&
      VALID_CLASSES.includes(p.fixClass as FixClass) &&
      typeof p.diff === 'string' &&
      typeof p.rationale === 'string'
    ) {
      return {
        rootCause: p.rootCause,
        fixClass: p.fixClass as FixClass,
        diff: p.diff,
        rationale: p.rationale,
      };
    }
  }
  throw new Error('Agent JSON does not match FixProposal or NoFixProposable shape');
}

// Convenience: a default-named export that throws if anyone calls it directly without
// configuring opts. Production code should use createGeminiAdapter(opts).
export const geminiAdapter: Adapter = {
  async runAgent() {
    throw new Error(
      'geminiAdapter requires configuration — call createGeminiAdapter(opts) and pass the returned object to the orchestrator',
    );
  },
};

// Re-export BudgetExhausted for callers that catch it from this module.
export { BudgetExhausted };
