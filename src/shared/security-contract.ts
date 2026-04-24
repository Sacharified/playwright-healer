// src/shared/security-contract.ts
//
// SECURITY DESIGN CONTRACT — DO NOT MODIFY WITHOUT:
//   1. A commit message trailer:  Security-Contract-Change: reviewed-by=<github-handle>
//   2. A matching update to .planning/security-contract.snapshot.json
//
// Downstream phases (2+) MUST import these constants. Inline string literals
// for allowedTools, allowed origins, or forbidden triggers are banned and
// will be caught by the security-lint grep check in CI.

// ALLOWED_TOOLS uses the Anthropic/Claude-Agent-SDK CANONICAL tool-naming
// form (`mcp__server__tool` with double underscore). Provider adapters
// (arriving in Phase 3 under src/healer/) translate this to provider-specific
// syntax when invoking the agent loop:
//   - anthropic → identity (this form)
//   - gemini    → `mcp_server_tool` (single underscore, sanitized — per
//                 @google/genai experimental MCP tool-naming convention)
//   - ollama    → native JSON-schema function names (no MCP namespace;
//                 requires an MCP↔function-calling bridge since Ollama
//                 lacks native MCP as of 2026-04)
// The canonical form is authoritative. Adapters normalize at the call site.
// Inline string literals of these names remain banned (D-13) — downstream
// code must import this constant and run it through its adapter's normalizer.
export const ALLOWED_TOOLS = Object.freeze([
  'Glob',
  'Grep',
  'Read',
  'mcp__playwright__*',
] as const);

export const ALLOWED_ORIGIN_TEMPLATE = (baseUrl: string): readonly string[] =>
  Object.freeze([baseUrl, 'http://localhost:*']);

export const FORBIDDEN_WORKFLOW_TRIGGERS = Object.freeze([
  'pull_request_target',
] as const);
