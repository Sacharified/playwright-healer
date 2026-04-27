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
import { ALLOWED_TOOLS, ALLOWED_ORIGIN_TEMPLATE } from '../../shared/security-contract.js';
import { BudgetTracker, BudgetExhausted } from '../budget.js';
import type { Adapter, FixProposal, NoFixProposable, AgentRunStats } from '../adapter.js';
import type { ContextBundle } from '../types.js';

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

  try {
    // 3. AUDIT INVARIANT (SEC-04 / D-03 — supersedes any "translation" framing)
    // Every tool returned by listTools() must map to a glob in ALLOWED_TOOLS
    // after applying the canonical mcp__playwright__ prefix. Throws BEFORE
    // any generateContent call if any tool is uncovered.
    const toolList = await mcpClient.listTools();
    for (const tool of toolList.tools) {
      const canonical = `mcp__playwright__${tool.name}`;
      const covered = ALLOWED_TOOLS.some((p) => globMatch(p, canonical));
      if (!covered) {
        throw new Error(
          `Audit failed: MCP tool '${tool.name}' (canonical '${canonical}') is not covered by ALLOWED_TOOLS`,
        );
      }
    }

    // 4. Initialize Gemini client
    const ai = new GoogleGenAICtor({ apiKey: opts.apiKey });

    // 5. Build initial contents — system prompt + user-side context bundle
    const contextSummary = renderContextForAgent(context);
    const initialUserText = `${systemPrompt}\n\n---\n\n${contextSummary}`;

    const contents: Content[] = [{ role: 'user', parts: [{ text: initialUserText } as Part] }];

    // 6. Manual tool-use loop (FIX-02)
    // BudgetTracker.assertCanProceed() is the pre-call gate.
    // BudgetTracker.recordUsage() accounts tokens after each successful response.
    while (true) {
      budget.assertCanProceed(); // pre-call gate — throws BudgetExhausted if over ceiling

      const response = await ai.models.generateContent({
        model: opts.model,
        contents,
        config: {
          tools: [mcpToToolFn(mcpClient)],
          automaticFunctionCalling: { disable: true },
        },
      });

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
      const callable = mcpToToolFn(mcpClient);
      await callable.tool(); // ensures initialize side-effect (RESEARCH §Pattern 1)
      const responseParts = await callable.callTool(functionCalls);

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
  if (
    parsed !== null &&
    typeof parsed === 'object'
  ) {
    const p = parsed as Record<string, unknown>;
    if (
      typeof p.rootCause === 'string' &&
      (p.fixClass === 'selectors' || p.fixClass === 'waits') &&
      typeof p.diff === 'string' &&
      typeof p.rationale === 'string'
    ) {
      return {
        rootCause: p.rootCause,
        fixClass: p.fixClass as 'selectors' | 'waits',
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
