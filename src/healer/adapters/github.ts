// src/healer/adapters/github.ts
//
// GitHub Models adapter — OpenAI-compatible chat completions endpoint at
// https://models.github.ai/inference. Auth is a GitHub PAT with the
// `models:read` scope (passed via the `api_key` action input). Free tier is
// generous enough for development; consumers wanting paid throughput can
// override `api_endpoint` and `model` via standard inputs.
//
// Mirrors the Gemini adapter (manual MCP tool-use loop with the SEC-04 audit
// invariant), with three deliberate deviations:
//
//   1. HTTP transport via plain `fetch` — no provider SDK is added. The
//      OpenAI chat-completions schema is small enough to call directly, which
//      keeps the dependency surface unchanged.
//
//   2. Tool name shape is the raw MCP tool name (e.g. `browser_navigate`).
//      Per security-contract.ts this matches the Ollama provider mapping
//      ("native JSON-schema function names; no MCP namespace"). The audit
//      invariant still runs on the canonical `mcp__playwright__<name>` form
//      so the security-lint grep check (D-13) keeps working.
//
//   3. Cost reporting is $0 because the free tier carries no per-token
//      charge and we don't want to render a misleading paid-tier dollar
//      figure in PR bodies. BudgetTracker is bypassed; only `maxTurns` is
//      enforced (FIX-02 ceiling). If a paid tier becomes the default later,
//      revisit this and add per-model pricing constants like budget.ts does
//      for Gemini.
//
// Return contract (revised 2026-04-26 per checker BLOCKER #1): every successful
// resolve produces `{ proposal, stats }` where `stats.turnsUsed` reflects the
// real loop iteration count and `stats.usdSpent` is 0.

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

export interface GithubAdapterOpts {
  apiKey: string;
  model: string;          // e.g., 'openai/gpt-4.1' (DEFAULT_MODELS.github)
  endpoint: string;       // e.g., 'https://models.github.ai/inference'
  baseUrl: string;        // for ALLOWED_ORIGIN_TEMPLATE
  maxTurns: number;       // FIX-02 ceiling
  // Optional injection points for testing — production code uses defaults.
  _Client?: typeof Client;
  _StdioClientTransport?: typeof StdioClientTransport;
  _fetch?: typeof fetch;
}

export function createGithubAdapter(opts: GithubAdapterOpts): Adapter {
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

interface OpenAiChatResponse {
  choices: { message: OpenAiAssistantMessage; finish_reason?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

type OpenAiMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | OpenAiAssistantMessage
  | { role: 'tool'; tool_call_id: string; content: string };

async function runAgentImpl(
  opts: GithubAdapterOpts,
  context: ContextBundle,
  systemPrompt: string,
): Promise<{ proposal: FixProposal | NoFixProposable; stats: AgentRunStats }> {
  const TransportCtor = opts._StdioClientTransport ?? StdioClientTransport;
  const ClientCtor = opts._Client ?? Client;
  const fetchFn = opts._fetch ?? fetch;

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

  let turnsUsed = 0;

  try {
    // 3. AUDIT INVARIANT (SEC-04 / D-03 — same as gemini.ts).
    // Every tool returned by listTools() must satisfy:
    //   (a) Its canonical form (mcp__playwright__<name>) is covered by ALLOWED_TOOLS.
    //   (b) Its raw name starts with the Playwright MCP `browser_` prefix.
    // Throws BEFORE any chat-completions call if either fails.
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

    // 4. Translate MCP tool list into OpenAI function-tools shape.
    // Tool names pass through unchanged — the audit invariant above guarantees
    // the canonical form is allow-listed, and raw `browser_*` names are valid
    // OpenAI function identifiers (they match `[a-zA-Z0-9_-]{1,64}`).
    const openaiTools = toolList.tools.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: typeof t.description === 'string' ? t.description : '',
        parameters: (t.inputSchema as Record<string, unknown> | undefined) ?? {
          type: 'object',
          properties: {},
        },
      },
    }));

    // 5. Build initial messages.
    const messages: OpenAiMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: renderContextForAgent(context) },
    ];

    // 6. Manual tool-use loop (FIX-02). maxTurns is the only budget gate; cost
    // ceiling is irrelevant on the free tier. If maxTurns is reached, throw
    // BudgetExhausted with usdSpent: 0 so Plan 12's catch-and-issue path renders
    // a coherent message.
    while (true) {
      if (turnsUsed >= opts.maxTurns) {
        throw new BudgetExhausted(
          `Max turns reached: ${turnsUsed} / ${opts.maxTurns}`,
          { usdSpent: 0, turnsUsed },
        );
      }

      const res = await fetchFn(`${opts.endpoint}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${opts.apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          model: opts.model,
          messages,
          tools: openaiTools,
          tool_choice: 'auto',
        }),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new Error(
          `GitHub Models request failed: ${res.status} ${res.statusText} — ${text.slice(0, 500)}`,
        );
      }

      const json = (await res.json()) as OpenAiChatResponse;
      turnsUsed += 1;

      const choice = json.choices?.[0];
      if (!choice || !choice.message) {
        throw new Error('GitHub Models response missing choices[0].message');
      }
      const assistantMsg = choice.message;
      const toolCalls = assistantMsg.tool_calls ?? [];

      if (toolCalls.length === 0) {
        // Final answer — parse FixProposal | NoFixProposable
        const proposal = parseFinalText(assistantMsg.content ?? '');
        return {
          proposal,
          stats: { usdSpent: 0, turnsUsed },
        };
      }

      // Append the assistant message verbatim so tool_call_ids resolve on the
      // next round-trip.
      messages.push({
        role: 'assistant',
        content: assistantMsg.content ?? null,
        tool_calls: toolCalls,
      });

      // Dispatch each tool call to the MCP client and append a tool message.
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
    // Cleanup on all exit paths (success, BudgetExhausted, any error) — HEA-06
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

// Convenience: a default-named export that throws if anyone calls it directly
// without configuring opts. Production code uses createGithubAdapter(opts).
export const githubAdapter: Adapter = {
  async runAgent() {
    throw new Error(
      'githubAdapter requires configuration — call createGithubAdapter(opts) and pass the returned object to the orchestrator',
    );
  },
};

export { BudgetExhausted };
