// src/healer/adapters/openrouter.ts
//
// OpenRouter adapter — OpenAI-compatible chat completions endpoint at
// https://openrouter.ai/api/v1. Auth is an OpenRouter API key (passed via
// `api_key`). Models use slash-prefixed names (e.g. `anthropic/claude-sonnet-4-6`,
// `google/gemini-2.5-pro`, `openai/gpt-4.1`, `meta-llama/llama-3.1-70b`).
//
// Mirrors the GitHub Models adapter (manual MCP tool-use loop with the SEC-04
// audit invariant) with two deliberate deviations from github.ts:
//
//   1. Cost is read from response.usage.cost (USD already computed by
//      OpenRouter per upstream's pricing). We don't carry a per-model pricing
//      table — that's the whole point of routing through OpenRouter. Usage is
//      included automatically in every response (the legacy
//      `usage: { include: true }` opt-in is deprecated per OpenRouter's
//      usage-accounting guide). If a response omits `cost` we leave usdSpent
//      unchanged for that turn and rely on maxTurns to bound the run.
//
//   2. BudgetTracker.assertCanProceed semantics — both maxTurns AND
//      maxBudgetUsd are enforced (unlike github.ts free-tier which gates only
//      maxTurns). Pre-call gate: if usdSpent >= maxBudgetUsd before the next
//      turn, throw BudgetExhausted with the at-throw snapshot.
//
// Tool name shape is the raw MCP tool name (e.g. `browser_navigate`) — same
// as github.ts. The audit invariant runs on the canonical
// `mcp__playwright__<name>` form so D-13 inline-literal ban stays intact.

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  ALLOWED_TOOLS,
  ALLOWED_ORIGIN_TEMPLATE,
  MCP_PLAYWRIGHT_TOOL_PREFIX,
} from '../../shared/security-contract.js';
import { BudgetExhausted } from '../budget.js';
import type { Adapter, FixProposal, NoFixProposable, AgentRunStats } from '../adapter.js';
import type { ContextBundle } from '../types.js';
import {
  SUBMIT_TOOLS,
  isSubmitToolName,
  parseSubmitArgs,
} from './submit-tool.js';

const VALID_CLASSES = ['selectors', 'waits', 'assertions', 'slow'] as const;
type FixClass = typeof VALID_CLASSES[number];

export interface OpenrouterAdapterOpts {
  apiKey: string;
  model: string;          // e.g. 'anthropic/claude-sonnet-4-6' (DEFAULT_MODELS.openrouter)
  endpoint: string;       // e.g. 'https://openrouter.ai/api/v1' (DEFAULT_ENDPOINTS.openrouter)
  baseUrl: string;        // for ALLOWED_ORIGIN_TEMPLATE
  maxTurns: number;       // FIX-02 ceiling
  maxBudgetUsd: number;   // FIX-02 ceiling — enforced (unlike github.ts)
  // Optional injection points for testing — production code uses defaults.
  _Client?: typeof Client;
  _StdioClientTransport?: typeof StdioClientTransport;
  _fetch?: typeof fetch;
}

export function createOpenrouterAdapter(opts: OpenrouterAdapterOpts): Adapter {
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

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
}

interface OpenRouterChatResponse {
  choices: { message: OpenAiAssistantMessage; finish_reason?: string }[];
  // OpenRouter exposes `cost` (USD) in the usage block on every response — the
  // legacy `usage: { include: true }` opt-in is deprecated and full usage is
  // always returned. May still be absent on some upstreams or older replays;
  // treat absent as 0 for the turn (maxTurns still bounds the run).
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
}

type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | OpenAiAssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

async function runAgentImpl(
  opts: OpenrouterAdapterOpts,
  context: ContextBundle,
  systemPrompt: string,
): Promise<{ proposal: FixProposal | NoFixProposable; stats: AgentRunStats }> {
  const TransportCtor = opts._StdioClientTransport ?? StdioClientTransport;
  const ClientCtor = opts._Client ?? Client;
  const fetchFn = opts._fetch ?? fetch;

  const allowedOrigins = ALLOWED_ORIGIN_TEMPLATE(opts.baseUrl).join(';');
  const transport = new TransportCtor({
    command: 'npx',
    args: [
      '@playwright/mcp@0.0.70',
      '--headless',
      `--allowed-origins=${allowedOrigins}`,
    ],
  });

  const mcpClient = new ClientCtor({ name: 'playwright-healer', version: '0.1.0' });
  await mcpClient.connect(transport);

  let turnsUsed = 0;
  let usdSpent = 0;

  try {
    // SEC-04 / D-03 audit invariant — same as github.ts and gemini.ts.
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

    const openaiTools = [
      ...toolList.tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: typeof t.description === 'string' ? t.description : '',
          parameters: (t.inputSchema as Record<string, unknown> | undefined) ?? {
            type: 'object',
            properties: {},
          },
        },
      })),
      // Synthetic terminator tools — orchestrator-internal, never dispatched to
      // MCP. Forces the agent to return its proposal through a schema-validated
      // function call instead of free-form prose, which Sonnet 4.6 in particular
      // emits despite explicit JSON-only instructions.
      ...SUBMIT_TOOLS,
    ];

    const messages: OpenAiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: renderContextForAgent(context) },
    ];

    while (true) {
      // Pre-call gate (FIX-02). Both ceilings are enforced; budget check first
      // because it's the more user-visible failure (maxTurns is a safety net,
      // maxBudgetUsd is the user's actual cost cap).
      if (usdSpent >= opts.maxBudgetUsd) {
        throw new BudgetExhausted(
          `USD budget exhausted: $${usdSpent.toFixed(4)} / $${opts.maxBudgetUsd.toFixed(2)}`,
          { usdSpent, turnsUsed },
        );
      }
      if (turnsUsed >= opts.maxTurns) {
        throw new BudgetExhausted(
          `Max turns reached: ${turnsUsed} / ${opts.maxTurns}`,
          { usdSpent, turnsUsed },
        );
      }

      const res = await fetchFn(`${opts.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          // OpenRouter best practice — identifies the calling app for their
          // dashboard rankings. Optional but recommended. Header names per
          // OpenRouter's authentication guide: HTTP-Referer + X-OpenRouter-Title.
          'HTTP-Referer': 'https://github.com/sacha/playwright-healer',
          'X-OpenRouter-Title': 'playwright-healer',
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          tools: openaiTools,
          tool_choice: 'auto',
          // OpenRouter does a pre-flight credit check against max_tokens:
          // a request that asks for the model's full output window (often
          // 65k+ on Sonnet 4.6) gets 402'd as soon as remaining credits drop
          // below that cap, even if the actual response would be far smaller.
          // Cap output at 4096 — ample for FixProposal JSON (rootCause +
          // fixClass + diff + rationale ≈ 500–1500 tokens) and any tool-call
          // arguments. Truncation would route to issue-fallback via the JSON
          // parse failure path, which is still a valid heal outcome.
          max_tokens: 4096,
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new Error(
          `OpenRouter request failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`,
        );
      }

      const json = (await res.json()) as OpenRouterChatResponse;
      turnsUsed += 1;
      if (typeof json.usage?.cost === 'number') {
        usdSpent += json.usage.cost;
      }

      const choice = json.choices?.[0];
      if (!choice || !choice.message) {
        throw new Error('OpenRouter response missing choices[0].message');
      }
      const assistantMsg = choice.message;
      const toolCalls = assistantMsg.tool_calls ?? [];

      if (toolCalls.length === 0) {
        // No tool calls AND no submit_* call — the agent dropped back to chat
        // prose despite explicit submit-tool instructions. Don't crash; route
        // to no-fix-proposable with the prose as evidence (the orchestrator
        // files a clean issue carrying the model's reasoning).
        const proposal = parseFinalText(assistantMsg.content ?? '');
        return {
          proposal,
          stats: { usdSpent, turnsUsed },
        };
      }

      messages.push({
        role: 'assistant',
        content: assistantMsg.content ?? null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        let args: Record<string, unknown>;
        try {
          args = call.function.arguments
            ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
            : {};
        } catch (err) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: `Error: tool arguments were not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
          });
          continue;
        }

        // Submit-tool intercept — terminates the loop with the parsed proposal.
        // If args fail validation we feed the error back as a tool message so
        // the model can retry within the existing maxTurns / maxBudgetUsd gates.
        if (isSubmitToolName(call.function.name)) {
          const submit = parseSubmitArgs(call.function.name, args);
          if (submit.ok) {
            return {
              proposal: submit.proposal,
              stats: { usdSpent, turnsUsed },
            };
          }
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: `Error: ${submit.error}`,
          });
          continue;
        }

        let toolContent: string;
        try {
          const result = await mcpClient.callTool({
            name: call.function.name,
            arguments: args,
          });
          toolContent = renderToolResult(result);
        } catch (err) {
          toolContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: toolContent,
        });
      }
    }
  } finally {
    try { await mcpClient.close(); } catch { /* ignore cleanup errors */ }
  }
}

function renderToolResult(result: unknown): string {
  if (
    result !== null &&
    typeof result === 'object' &&
    'content' in result &&
    Array.isArray((result as { content: unknown }).content)
  ) {
    const parts = ((result as { content: { type?: string; text?: string }[] }).content ?? [])
      .map((p) => (typeof p.text === 'string' ? p.text : JSON.stringify(p)))
      .join('\n');
    return parts.length > 0 ? parts : JSON.stringify(result);
  }
  return JSON.stringify(result);
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

// Backward-compat fallback for content-only final messages (the legacy
// parse-JSON-from-prose path). Primary path is the submit_* tool intercept
// in the loop above. If parsing fails or the JSON shape is wrong we degrade
// to NoFixProposable carrying the raw prose as evidence — the orchestrator
// then files a no-fix-proposable issue instead of crashing the runner.
function parseFinalText(text: string): FixProposal | NoFixProposable {
  const stripped = text
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  if (stripped.length === 0) {
    return {
      reason: 'no-fix-proposable',
      evidence: 'Agent returned an empty final response and did not call submit_fix_proposal or submit_no_fix.',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return {
      reason: 'no-fix-proposable',
      evidence: `Agent returned a non-JSON final response and did not call submit_fix_proposal or submit_no_fix. Response excerpt: ${truncate(text, 1500)}`,
    };
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
  return {
    reason: 'no-fix-proposable',
    evidence: `Agent returned JSON that does not match FixProposal or NoFixProposable shape and did not call submit_fix_proposal or submit_no_fix. Response excerpt: ${truncate(text, 1500)}`,
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…[truncated]`;
}

export const openrouterAdapter: Adapter = {
  async runAgent() {
    throw new Error(
      'openrouterAdapter requires configuration — call createOpenrouterAdapter(opts) and pass the returned object to the orchestrator',
    );
  },
};

export { BudgetExhausted };
