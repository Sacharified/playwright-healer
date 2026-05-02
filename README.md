# playwright-healer

A reusable GitHub Action that auto-heals flaky, failing, or slow Playwright tests using an LLM agent and Playwright MCP. Opens validated PRs or structured issues for each detected problem. Supports multiple providers: Anthropic, Gemini, GitHub Models, and Ollama.

## Auto-merge prerequisites

This action ships an opt-in `enable_auto_merge` input (Phase 5+). When `true`, the action calls GitHub's `enablePullRequestAutoMerge` GraphQL mutation so eligible healer PRs squash-merge automatically once required CI checks pass. The mutation only succeeds when the consumer's repository has all four of the following configured:

1. **Repository Settings → General → Pull Requests → "Allow auto-merge"** must be ON.
2. **Repository Settings → General → Pull Requests → "Allow squash merging"** must be ON. (The action passes `mergeMethod: SQUASH` so the merge-commits-only configuration is incompatible.)
3. **Branch protection rule on the default branch** must require at least one status check to pass before merging (Settings → Branches → Branch protection rules → "Require status checks to pass before merging"). Without this, GitHub merges PRs synchronously and `enablePullRequestAutoMerge` returns an error — the action soft-fails and the PR stays open for human review.
4. **`healer_token` PAT scope** must include `repo` (covers Pull request write + auto-merge). Fine-grained PATs need `Contents: write` and `Pull requests: write` on the consumer repo.

If any of (1)–(3) is missing, the action emits a `core.warning(...)` with GitHub's specific error message and writes `auto_merge: blocked by: <reason>` to the run summary. The PR stays open for human review; the heal exit code is 0 (success-with-fallback). Set `enable_auto_merge: false` (the default) to opt out entirely.

> Note: Phase 5 ships a minimal stub of this section. Phase 6 (Documentation + Release) expands it with screenshots, an example branch-protection JSON, and trust-chain prerequisites for the full release.
