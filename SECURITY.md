# Security

## Reporting a Vulnerability

Please report security vulnerabilities via one of the following channels:

- **Email:** sacha.guddoy@gmail.com
- **GitHub Security Advisories (private):** https://github.com/Sacharified/playwright-healer/security/advisories/new

We follow a **90-day responsible disclosure** window. Upon receiving a report, we commit to acknowledging it within 7 days and providing a remediation plan or status update within 30 days.

There is no bug bounty program for v0.1.x.

## Security Posture

playwright-healer is designed with defense-in-depth. The security controls below are enforced in code, not just documented as policy.

**Diff-lint gate (FIX-06):** Every proposed fix patch is linted before a PR is opened. The lint pass blocks `waitForTimeout` calls, positional selectors (`nth(`, `:nth-child`), weakened assertions (`not.toThrow`, removed `expect` calls), and any edits to files outside test directories. This gate runs outside the agent loop so the agent cannot circumvent it.

**Auto-merge gate (Phase 5):** When opt-in auto-merge is enabled, a four-condition trust gate applies independently of the diff-lint pass: post-fix validation pass rate, fix class within the allowed set, no forbidden patterns in the diff, and no security-contract violations. The gate soft-fails on any error — if it cannot confirm eligibility, the PR falls back to manual review.

**Tool-naming contract (D-13):** The canonical allowed-tool form `mcp__playwright__*` is never written as an inline literal in source code. An audit invariant in `src/healer/security-contract.ts` enforces this at test time. Provider adapters translate to the provider's required naming convention at the call site; the scope (Playwright MCP + read-only file tools) is invariant.

**Single source of truth for allow-lists (D-17):** Forbidden-pattern allow-lists are exported from `src/healer/forbidden-patterns.ts` and consumed by both the diff-lint pass and the auto-merge gate. They are never duplicated.

**Dispatch contract (D-18):** The payload that triggers the healer workflow is validated by Zod at the action boundary. No implicit-undefined inputs reach the agent.

**`pull_request_target` trigger is never used (SEC-02):** This trigger grants write access to the repo's secrets in workflows triggered by fork pull requests — a well-known exfiltration vector. It is banned from every workflow in this repo and enforced by `security-lint.yml` on every PR.

**Agent tool scope:** The agent is granted exactly `["mcp__playwright__*", "Read", "Grep", "Glob"]`. `Bash`, `Write`, and `Edit` are never granted. Provider adapters may rename these entries per provider syntax but may never expand the scope.

**`persist-credentials: false` on all checkout steps:** The runner workspace is never written with a GitHub token that the agent could read from `.git/config`.

**PAT required for PR creation:** `GITHUB_TOKEN` cannot trigger downstream CI on PRs it opens (GitHub's recursion guard). A fine-grained PAT or GitHub App token (`healer_token` input) is required for PR creation and `workflow_dispatch`. Token scope documentation is in the README under §Token scopes.

The full threat model for each phase lives in `.planning/phases/` alongside each phase's CONTEXT.md and VERIFICATION.md files.
