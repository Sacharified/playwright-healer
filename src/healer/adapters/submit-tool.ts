// src/healer/adapters/submit-tool.ts
//
// Provider-neutral submit-proposal tools. The agent terminates the loop by
// calling one of these synthetic functions instead of emitting a free-form
// final message — instruction-following on "respond as JSON" is unreliable
// across models (Claude Sonnet 4.6 in particular drops back to chat prose),
// and these schemas are validated by the provider's tool-call layer before
// we see them.
//
// Not security-relevant: these tools are orchestrator-internal control
// signals, never dispatched to MCP. The audit invariant in each adapter
// iterates only the MCP-supplied tool list, so D-13 stays intact.

import type { FixProposal, NoFixProposable } from '../adapter.js';

const VALID_CLASSES = ['selectors', 'waits', 'assertions', 'slow'] as const;
type FixClass = typeof VALID_CLASSES[number];

export const SUBMIT_FIX_PROPOSAL = 'submit_fix_proposal';
export const SUBMIT_NO_FIX = 'submit_no_fix';
export const SUBMIT_TOOL_NAMES: readonly string[] = [SUBMIT_FIX_PROPOSAL, SUBMIT_NO_FIX];

interface OpenAiFunctionTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export const SUBMIT_TOOLS: readonly OpenAiFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: SUBMIT_FIX_PROPOSAL,
      description:
        'Submit your final fix proposal. Call this exactly once when you have a complete proposal. Calling this terminates the agent loop.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          rootCause: {
            type: 'string',
            description: 'One-sentence explanation of why the test fails.',
          },
          fixClass: {
            type: 'string',
            enum: [...VALID_CLASSES],
            description: 'Category of fix being proposed.',
          },
          diff: {
            type: 'string',
            description:
              'Unified diff applied via `git apply --3way`. Scoped to the failing test file. May NOT modify any file outside the test directory.',
          },
          rationale: {
            type: 'string',
            description: 'One-paragraph explanation of why this fix is correct and stable.',
          },
        },
        required: ['rootCause', 'fixClass', 'diff', 'rationale'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: SUBMIT_NO_FIX,
      description:
        'Submit when you cannot propose a fix (insufficient context, ambiguous failure, or out-of-scope cause). Calling this terminates the agent loop.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          evidence: {
            type: 'string',
            description:
              'Text excerpt explaining tool calls performed, observations, and why no fix applies.',
          },
        },
        required: ['evidence'],
      },
    },
  },
];

export type SubmitParseResult =
  | { ok: true; proposal: FixProposal | NoFixProposable }
  | { ok: false; error: string };

export function parseSubmitArgs(toolName: string, args: Record<string, unknown>): SubmitParseResult {
  if (toolName === SUBMIT_FIX_PROPOSAL) {
    if (
      typeof args.rootCause === 'string' &&
      typeof args.fixClass === 'string' &&
      VALID_CLASSES.includes(args.fixClass as FixClass) &&
      typeof args.diff === 'string' &&
      typeof args.rationale === 'string'
    ) {
      return {
        ok: true,
        proposal: {
          rootCause: args.rootCause,
          fixClass: args.fixClass as FixClass,
          diff: args.diff,
          rationale: args.rationale,
        },
      };
    }
    return {
      ok: false,
      error: `submit_fix_proposal requires { rootCause: string, fixClass: ${VALID_CLASSES.join('|')}, diff: string, rationale: string }`,
    };
  }
  if (toolName === SUBMIT_NO_FIX) {
    if (typeof args.evidence === 'string' && args.evidence.length > 0) {
      return {
        ok: true,
        proposal: { reason: 'no-fix-proposable', evidence: args.evidence },
      };
    }
    return {
      ok: false,
      error: 'submit_no_fix requires { evidence: non-empty string }',
    };
  }
  return { ok: false, error: `unknown submit tool: ${toolName}` };
}

export function isSubmitToolName(name: string): boolean {
  return SUBMIT_TOOL_NAMES.includes(name);
}
