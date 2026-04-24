// src/shared/security-contract.ts
//
// SECURITY DESIGN CONTRACT — DO NOT MODIFY WITHOUT:
//   1. A commit message trailer:  Security-Contract-Change: reviewed-by=<github-handle>
//   2. A matching update to .planning/security-contract.snapshot.json
//
// Downstream phases (2+) MUST import these constants. Inline string literals
// for allowedTools, allowed origins, or forbidden triggers are banned and
// will be caught by the security-lint grep check in CI.

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
