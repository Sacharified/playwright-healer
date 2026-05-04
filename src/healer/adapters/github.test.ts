import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createGithubAdapter, type GithubAdapterOpts } from './github.js';
import { BudgetExhausted } from '../budget.js';

let mockListTools = vi.fn();
let mockCallTool = vi.fn();
let mockClose = vi.fn();
let mockConnect = vi.fn();
let mockFetch = vi.fn();
let stdioCtorSpy = vi.fn();
let clientCtorSpy = vi.fn();

beforeEach(() => {
  mockListTools = vi.fn().mockResolvedValue({
    tools: [
      {
        name: 'browser_navigate',
        description: 'Navigate to a URL',
        inputSchema: { type: 'object', properties: { url: { type: 'string' } } },
      },
      {
        name: 'browser_click',
        description: 'Click an element',
        inputSchema: { type: 'object', properties: { selector: { type: 'string' } } },
      },
    ],
  });
  mockCallTool = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: 'tool result' }],
  });
  mockClose = vi.fn().mockResolvedValue(undefined);
  mockConnect = vi.fn().mockResolvedValue(undefined);
  mockFetch = vi.fn();
  stdioCtorSpy = vi.fn();
  clientCtorSpy = vi.fn();
});

function makeOpts(overrides: Record<string, unknown> = {}): GithubAdapterOpts {
  return {
    apiKey: 'ghp_test',
    model: 'openai/gpt-4.1',
    endpoint: 'https://models.github.ai/inference',
    baseUrl: 'https://app.example.com',
    maxTurns: 30,
    _StdioClientTransport: function (args: unknown) {
      stdioCtorSpy(args);
      return {} as unknown;
    } as unknown as typeof StdioClientTransport,
    _Client: function (info: unknown) {
      clientCtorSpy(info);
      return {
        connect: mockConnect,
        listTools: mockListTools,
        callTool: mockCallTool,
        close: mockClose,
      };
    } as unknown as typeof Client,
    _fetch: mockFetch as unknown as typeof fetch,
    ...overrides as Partial<GithubAdapterOpts>,
  };
}

const VALID_FIX_PROPOSAL_JSON = JSON.stringify({
  rootCause: 'Selector wrong',
  fixClass: 'selectors',
  diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-x\n+y\n',
  rationale: 'getByRole is more stable',
});

const NO_FIX_JSON = JSON.stringify({
  reason: 'no-fix-proposable',
  evidence: 'could not reproduce',
});

const minimalContext = {
  testFile: 'tests/x.spec.ts',
  testTitle: 'X',
  testFileSource: 'test source',
  firstHopImports: {},
  gitBlame: '',
  traceAttachmentPath: null,
  recentErrorMessages: [],
};

function fetchOk(body: unknown): { ok: boolean; status: number; statusText: string; json: () => Promise<unknown>; text: () => Promise<string> } {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function finalAnswer(text: string) {
  return fetchOk({
    choices: [{ message: { role: 'assistant', content: text, tool_calls: [] } }],
    usage: { prompt_tokens: 100, completion_tokens: 50 },
  });
}

function toolCall(name: string, args: Record<string, unknown>, id = 'call_1') {
  return fetchOk({
    choices: [{
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }],
      },
    }],
    usage: { prompt_tokens: 100, completion_tokens: 5 },
  });
}

describe('githubAdapter — audit invariant (SEC-04 / D-03)', () => {
  it('passes audit when MCP tools all match mcp__playwright__*', async () => {
    mockFetch.mockResolvedValueOnce(finalAnswer(VALID_FIX_PROPOSAL_JSON));
    const adapter = createGithubAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(result.proposal).toMatchObject({ fixClass: 'selectors' });
  });

  it('throws when MCP exposes a non-Playwright tool BEFORE any fetch call', async () => {
    mockListTools.mockResolvedValueOnce({ tools: [{ name: 'filesystem_write' }] });
    const adapter = createGithubAdapter(makeOpts());
    await expect(adapter.runAgent(minimalContext, 'system', [])).rejects.toThrow(
      /Audit failed.*filesystem_write/,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('githubAdapter — SEC-03 / D-21 MCP spawn', () => {
  it('spawns Playwright MCP with --allowed-origins=${baseUrl};http://localhost:*', async () => {
    mockFetch.mockResolvedValueOnce(finalAnswer(VALID_FIX_PROPOSAL_JSON));
    const adapter = createGithubAdapter(makeOpts({ baseUrl: 'https://app.example.com' }));
    await adapter.runAgent(minimalContext, 'system', []);
    expect(stdioCtorSpy).toHaveBeenCalled();
    const args = stdioCtorSpy.mock.calls[0][0].args as string[];
    expect(args.some((a: string) => a === '--allowed-origins=https://app.example.com;http://localhost:*')).toBe(true);
  });

  it('pins @playwright/mcp@0.0.70 (D-21)', async () => {
    mockFetch.mockResolvedValueOnce(finalAnswer(VALID_FIX_PROPOSAL_JSON));
    const adapter = createGithubAdapter(makeOpts());
    await adapter.runAgent(minimalContext, 'system', []);
    const args = stdioCtorSpy.mock.calls[0][0].args as string[];
    expect(args).toContain('@playwright/mcp@0.0.70');
  });
});

describe('githubAdapter — HTTP request shape', () => {
  it('POSTs to endpoint/chat/completions with bearer auth + tools', async () => {
    mockFetch.mockResolvedValueOnce(finalAnswer(VALID_FIX_PROPOSAL_JSON));
    const adapter = createGithubAdapter(makeOpts());
    await adapter.runAgent(minimalContext, 'system', []);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://models.github.ai/inference/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer ghp_test');
    expect(init.headers['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('openai/gpt-4.1');
    expect(body.tool_choice).toBe('auto');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'system' });
    expect(body.messages[1].role).toBe('user');
    // OpenAI-shape tools: { type: 'function', function: { name, description, parameters } }
    expect(body.tools).toHaveLength(2);
    expect(body.tools[0]).toMatchObject({
      type: 'function',
      function: { name: 'browser_navigate' },
    });
  });

  it('raises a descriptive error on non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      text: async () => '{"error":"bad token"}',
      json: async () => ({}),
    });
    const adapter = createGithubAdapter(makeOpts());
    await expect(adapter.runAgent(minimalContext, 'system', [])).rejects.toThrow(
      /GitHub Models request failed: 401 Unauthorized/,
    );
  });
});

describe('githubAdapter — tool-use loop', () => {
  it('dispatches tool_calls to mcpClient.callTool and feeds results back as tool messages', async () => {
    mockFetch
      .mockResolvedValueOnce(toolCall('browser_navigate', { url: 'https://app.example.com' }, 'call_abc'))
      .mockResolvedValueOnce(finalAnswer(VALID_FIX_PROPOSAL_JSON));

    const adapter = createGithubAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);

    expect(mockCallTool).toHaveBeenCalledWith({
      name: 'browser_navigate',
      arguments: { url: 'https://app.example.com' },
    });
    expect(result.proposal).toMatchObject({ fixClass: 'selectors' });
    expect(result.stats.turnsUsed).toBe(2);

    // Second call's body should include the assistant tool_calls turn AND the tool message
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const lastTwo = secondBody.messages.slice(-2);
    expect(lastTwo[0].role).toBe('assistant');
    expect(lastTwo[0].tool_calls?.[0].id).toBe('call_abc');
    expect(lastTwo[1]).toEqual({
      role: 'tool',
      tool_call_id: 'call_abc',
      content: 'tool result',
    });
  });

  it('feeds an error tool message when tool arguments are not valid JSON', async () => {
    mockFetch
      .mockResolvedValueOnce(fetchOk({
        choices: [{
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{
              id: 'call_bad',
              type: 'function',
              function: { name: 'browser_navigate', arguments: '{not json' },
            }],
          },
        }],
      }))
      .mockResolvedValueOnce(finalAnswer(NO_FIX_JSON));

    const adapter = createGithubAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(mockCallTool).not.toHaveBeenCalled();
    expect(result.proposal).toMatchObject({ reason: 'no-fix-proposable' });

    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMsg.content).toMatch(/tool arguments were not valid JSON/);
  });

  it('captures MCP tool errors as a tool message instead of throwing', async () => {
    mockCallTool.mockRejectedValueOnce(new Error('navigation blocked by allowed-origins'));
    mockFetch
      .mockResolvedValueOnce(toolCall('browser_navigate', { url: 'https://elsewhere.example' }))
      .mockResolvedValueOnce(finalAnswer(NO_FIX_JSON));

    const adapter = createGithubAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(result.proposal).toMatchObject({ reason: 'no-fix-proposable' });

    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === 'tool');
    expect(toolMsg.content).toMatch(/navigation blocked/);
  });
});

describe('githubAdapter — FIX-02 turn-budget enforcement', () => {
  it('throws BudgetExhausted with usdSpent: 0 when maxTurns is reached', async () => {
    // Every call returns a tool_call so the loop never terminates by content.
    mockFetch.mockResolvedValue(toolCall('browser_navigate', { url: 'https://app.example.com' }));
    const adapter = createGithubAdapter(makeOpts({ maxTurns: 2 }));
    await expect(adapter.runAgent(minimalContext, 'system', [])).rejects.toThrow(BudgetExhausted);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('BudgetExhausted error carries usdSpent: 0 and turnsUsed reflects loop count', async () => {
    mockFetch.mockResolvedValue(toolCall('browser_navigate', { url: 'https://app.example.com' }));
    const adapter = createGithubAdapter(makeOpts({ maxTurns: 3 }));
    try {
      await adapter.runAgent(minimalContext, 'system', []);
      throw new Error('expected BudgetExhausted');
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExhausted);
      const be = err as BudgetExhausted;
      expect(be.usdSpent).toBe(0);
      expect(be.turnsUsed).toBe(3);
    }
  });
});

describe('githubAdapter — FIX-04 result parsing + stats contract', () => {
  it('returns { proposal: FixProposal, stats } when JSON shape matches', async () => {
    mockFetch.mockResolvedValueOnce(finalAnswer('```json\n' + VALID_FIX_PROPOSAL_JSON + '\n```'));
    const adapter = createGithubAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(result.proposal).toMatchObject({
      fixClass: 'selectors',
      rootCause: 'Selector wrong',
    });
    expect(result.stats.usdSpent).toBe(0);
    expect(result.stats.turnsUsed).toBe(1);
  });

  it('returns { proposal: NoFixProposable, stats } when JSON has reason: no-fix-proposable', async () => {
    mockFetch.mockResolvedValueOnce(finalAnswer(NO_FIX_JSON));
    const adapter = createGithubAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(result.proposal).toMatchObject({ reason: 'no-fix-proposable' });
    expect(result.stats.usdSpent).toBe(0);
    expect(result.stats.turnsUsed).toBe(1);
  });

  it('throws on unparseable final text', async () => {
    mockFetch.mockResolvedValueOnce(finalAnswer('this is not JSON'));
    const adapter = createGithubAdapter(makeOpts());
    await expect(adapter.runAgent(minimalContext, 'system', [])).rejects.toThrow(/non-JSON/);
  });
});

describe('githubAdapter — FIX-07 parseFinalText class widening', () => {
  it('accepts fixClass: assertions (FIX-07 — assertions class must not be rejected)', async () => {
    const assertionsJson = JSON.stringify({
      rootCause: 'Assertion wrong',
      fixClass: 'assertions',
      diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-x\n+y\n',
      rationale: 'correct expected value',
    });
    mockFetch.mockResolvedValueOnce(finalAnswer(assertionsJson));
    const adapter = createGithubAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(result.proposal).toMatchObject({ fixClass: 'assertions' });
  });

  it('accepts fixClass: slow (FIX-07 — slow class must not be rejected)', async () => {
    const slowJson = JSON.stringify({
      rootCause: 'Test too slow',
      fixClass: 'slow',
      diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-x\n+y\n',
      rationale: 'use Promise.all to overlap waits',
    });
    mockFetch.mockResolvedValueOnce(finalAnswer(slowJson));
    const adapter = createGithubAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(result.proposal).toMatchObject({ fixClass: 'slow' });
  });

  it('rejects fixClass: unknown-class (negative case stays narrow)', async () => {
    const unknownJson = JSON.stringify({
      rootCause: 'Something',
      fixClass: 'unknown-class',
      diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-x\n+y\n',
      rationale: 'whatever',
    });
    mockFetch.mockResolvedValueOnce(finalAnswer(unknownJson));
    const adapter = createGithubAdapter(makeOpts());
    await expect(adapter.runAgent(minimalContext, 'system', [])).rejects.toThrow(
      /Agent JSON does not match FixProposal or NoFixProposable shape/,
    );
  });
});

describe('githubAdapter — HEA-06 inner cleanup', () => {
  it('closes mcpClient on success', async () => {
    mockFetch.mockResolvedValueOnce(finalAnswer(VALID_FIX_PROPOSAL_JSON));
    const adapter = createGithubAdapter(makeOpts());
    await adapter.runAgent(minimalContext, 'system', []);
    expect(mockClose).toHaveBeenCalled();
  });

  it('closes mcpClient on failure (fetch rejects)', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    const adapter = createGithubAdapter(makeOpts());
    await expect(adapter.runAgent(minimalContext, 'system', [])).rejects.toThrow('network down');
    expect(mockClose).toHaveBeenCalled();
  });
});
