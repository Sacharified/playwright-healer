import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GoogleGenAI, mcpToTool } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createGeminiAdapter, type GeminiAdapterOpts } from './gemini.js';
import { BudgetExhausted } from '../budget.js';

let mockListTools = vi.fn();
let mockGenerateContent = vi.fn();
let mockClose = vi.fn();
let mockConnect = vi.fn();
let mockCallTool = vi.fn();
let mockToolFn = vi.fn();
let stdioCtorSpy = vi.fn();
let clientCtorSpy = vi.fn();

beforeEach(() => {
  mockListTools = vi.fn().mockResolvedValue({
    tools: [{ name: 'browser_navigate' }, { name: 'browser_click' }],
  });
  mockGenerateContent = vi.fn();
  mockClose = vi.fn().mockResolvedValue(undefined);
  mockConnect = vi.fn().mockResolvedValue(undefined);
  mockCallTool = vi.fn().mockResolvedValue([{ functionResponse: {} }]);
  mockToolFn = vi.fn().mockResolvedValue(undefined);
  stdioCtorSpy = vi.fn();
  clientCtorSpy = vi.fn();
});

function makeOpts(overrides: Record<string, unknown> = {}): GeminiAdapterOpts {
  return {
    apiKey: 'test-key',
    model: 'gemini-2.5-pro',
    baseUrl: 'https://app.example.com',
    maxTurns: 30,
    maxBudgetUsd: 2.0,
    _StdioClientTransport: function (args: unknown) {
      stdioCtorSpy(args);
      return {} as unknown; // transport handle — mcpClient.connect() handles it
    } as unknown as typeof StdioClientTransport,
    _Client: function (info: unknown) {
      clientCtorSpy(info);
      return {
        connect: mockConnect,
        listTools: mockListTools,
        close: mockClose,
      };
    } as unknown as typeof Client,
    _GoogleGenAI: function () {
      return { models: { generateContent: mockGenerateContent } };
    } as unknown as typeof GoogleGenAI,
    _mcpToTool: (() => ({ tool: mockToolFn, callTool: mockCallTool })) as unknown as typeof mcpToTool,
    ...overrides as Partial<GeminiAdapterOpts>,
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

describe('geminiAdapter — audit invariant (SEC-04 / D-03)', () => {
  it('passes audit when MCP tools all match mcp__playwright__*', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: VALID_FIX_PROPOSAL_JSON,
      usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
      functionCalls: undefined,
      candidates: [{ content: { parts: [] } }],
    });
    const adapter = createGeminiAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(result.proposal).toMatchObject({ fixClass: 'selectors' });
  });

  it('throws when MCP exposes a non-Playwright tool (filesystem_write) BEFORE generateContent', async () => {
    mockListTools.mockResolvedValueOnce({ tools: [{ name: 'filesystem_write' }] });
    const adapter = createGeminiAdapter(makeOpts());
    await expect(adapter.runAgent(minimalContext, 'system', [])).rejects.toThrow(
      /Audit failed.*filesystem_write/,
    );
    // Audit must throw BEFORE any generateContent call (SEC-04 / D-03)
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });
});

describe('geminiAdapter — SEC-03 / D-21 MCP spawn', () => {
  it('spawns Playwright MCP with --allowed-origins=${baseUrl};http://localhost:*', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: VALID_FIX_PROPOSAL_JSON,
      usageMetadata: {},
      functionCalls: undefined,
    });
    const adapter = createGeminiAdapter(makeOpts({ baseUrl: 'https://app.example.com' }));
    await adapter.runAgent(minimalContext, 'system', []);
    expect(stdioCtorSpy).toHaveBeenCalled();
    const args = stdioCtorSpy.mock.calls[0][0].args as string[];
    expect(args.some((a: string) => a === '--allowed-origins=https://app.example.com;http://localhost:*')).toBe(true);
  });

  it('pins @playwright/mcp@0.0.70 (D-21)', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: VALID_FIX_PROPOSAL_JSON,
      usageMetadata: {},
      functionCalls: undefined,
    });
    const adapter = createGeminiAdapter(makeOpts());
    await adapter.runAgent(minimalContext, 'system', []);
    const args = stdioCtorSpy.mock.calls[0][0].args as string[];
    expect(args).toContain('@playwright/mcp@0.0.70');
  });
});

describe('geminiAdapter — FIX-02 budget enforcement', () => {
  it('passes automaticFunctionCalling.disable: true', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: VALID_FIX_PROPOSAL_JSON,
      usageMetadata: {},
      functionCalls: undefined,
    });
    const adapter = createGeminiAdapter(makeOpts());
    await adapter.runAgent(minimalContext, 'system', []);
    const callConfig = mockGenerateContent.mock.calls[0][0].config;
    expect(callConfig.automaticFunctionCalling.disable).toBe(true);
  });

  it('throws BudgetExhausted before second generateContent call when budget exceeded', async () => {
    // First call: returns a function call (so loop continues) with usage that exceeds $1.0 budget
    mockGenerateContent.mockResolvedValueOnce({
      text: '',
      functionCalls: [{ name: 'browser_navigate', args: {} }],
      candidates: [{ content: { parts: [] } }],
      usageMetadata: { promptTokenCount: 1_000_000 }, // costs $1.25 which exceeds $1.0 maxBudgetUsd
    });
    // No second call should happen — assertCanProceed throws BudgetExhausted
    const adapter = createGeminiAdapter(makeOpts({ maxBudgetUsd: 1.0 }));
    await expect(adapter.runAgent(minimalContext, 'system', [])).rejects.toThrow(BudgetExhausted);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
  });
});

describe('geminiAdapter — FIX-04 result parsing + revised contract stats', () => {
  it('returns { proposal: FixProposal, stats } when JSON shape matches', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: '```json\n' + VALID_FIX_PROPOSAL_JSON + '\n```',
      // $1.25 input + $0.50 output = ~$0.5005
      usageMetadata: { promptTokenCount: 400_000, candidatesTokenCount: 50_000 },
      functionCalls: undefined,
    });
    const adapter = createGeminiAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(result.proposal).toMatchObject({
      fixClass: 'selectors',
      rootCause: 'Selector wrong',
    });
    // stats pass-through (revised contract — no hardcoded zeros)
    expect(result.stats.usdSpent).toBeGreaterThan(0);
    expect(result.stats.turnsUsed).toBeGreaterThanOrEqual(1);
  });

  it('returns { proposal: NoFixProposable, stats } when JSON has reason: no-fix-proposable', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: NO_FIX_JSON,
      usageMetadata: { promptTokenCount: 200_000, candidatesTokenCount: 30_000 },
      functionCalls: undefined,
    });
    const adapter = createGeminiAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(result.proposal).toMatchObject({ reason: 'no-fix-proposable' });
    // stats present even when no fix proposed
    expect(result.stats.usdSpent).toBeGreaterThan(0);
    expect(result.stats.turnsUsed).toBeGreaterThanOrEqual(1);
  });

  it('throws on unparseable final text', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: 'this is not JSON',
      usageMetadata: {},
      functionCalls: undefined,
    });
    const adapter = createGeminiAdapter(makeOpts());
    await expect(adapter.runAgent(minimalContext, 'system', [])).rejects.toThrow(/non-JSON/);
  });

  it('stats.turnsUsed reflects the real loop iteration count (2 turns)', async () => {
    // First call: function call (continue loop); second call: final text.
    mockGenerateContent
      .mockResolvedValueOnce({
        text: '',
        functionCalls: [{ name: 'browser_navigate', args: {} }],
        candidates: [{ content: { parts: [] } }],
        usageMetadata: { promptTokenCount: 100_000, candidatesTokenCount: 5_000 },
      })
      .mockResolvedValueOnce({
        text: VALID_FIX_PROPOSAL_JSON,
        usageMetadata: { promptTokenCount: 100_000, candidatesTokenCount: 5_000 },
        functionCalls: undefined,
      });
    const adapter = createGeminiAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(result.stats.turnsUsed).toBe(2);
  });

  it('stats present on NoFixProposable — usdSpent > 0 and turnsUsed >= 1', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: NO_FIX_JSON,
      usageMetadata: { promptTokenCount: 100_000, candidatesTokenCount: 10_000 },
      functionCalls: undefined,
    });
    const adapter = createGeminiAdapter(makeOpts());
    const result = await adapter.runAgent(minimalContext, 'system', []);
    expect(result.stats.usdSpent).toBeGreaterThan(0);
    expect(result.stats.turnsUsed).toBeGreaterThanOrEqual(1);
  });
});

describe('geminiAdapter — FIX-07 parseFinalText class widening', () => {
  it('accepts fixClass: assertions (FIX-07 — assertions class must not be rejected)', async () => {
    const assertionsJson = JSON.stringify({
      rootCause: 'Assertion wrong',
      fixClass: 'assertions',
      diff: 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-x\n+y\n',
      rationale: 'correct expected value',
    });
    mockGenerateContent.mockResolvedValueOnce({
      text: assertionsJson,
      usageMetadata: {},
      functionCalls: undefined,
    });
    const adapter = createGeminiAdapter(makeOpts());
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
    mockGenerateContent.mockResolvedValueOnce({
      text: slowJson,
      usageMetadata: {},
      functionCalls: undefined,
    });
    const adapter = createGeminiAdapter(makeOpts());
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
    mockGenerateContent.mockResolvedValueOnce({
      text: unknownJson,
      usageMetadata: {},
      functionCalls: undefined,
    });
    const adapter = createGeminiAdapter(makeOpts());
    await expect(adapter.runAgent(minimalContext, 'system', [])).rejects.toThrow(
      /Agent JSON does not match FixProposal or NoFixProposable shape/,
    );
  });
});

describe('geminiAdapter — HEA-06 inner cleanup', () => {
  it('closes mcpClient on success', async () => {
    mockGenerateContent.mockResolvedValueOnce({
      text: VALID_FIX_PROPOSAL_JSON,
      usageMetadata: {},
      functionCalls: undefined,
    });
    const adapter = createGeminiAdapter(makeOpts());
    await adapter.runAgent(minimalContext, 'system', []);
    expect(mockClose).toHaveBeenCalled();
  });

  it('closes mcpClient on failure (generateContent throws)', async () => {
    mockGenerateContent.mockRejectedValueOnce(new Error('API down'));
    const adapter = createGeminiAdapter(makeOpts());
    await expect(adapter.runAgent(minimalContext, 'system', [])).rejects.toThrow('API down');
    expect(mockClose).toHaveBeenCalled();
  });
});
