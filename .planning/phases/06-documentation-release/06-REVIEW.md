---
phase: 06-documentation-release
reviewed: 2026-05-04T00:00:00Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - .github/workflows/ingest.yml
  - .github/workflows/security-lint.yml
  - .github/workflows/self-test.yml
  - .gitleaks.toml
  - CHANGELOG.md
  - CONTRIBUTING.md
  - README.md
  - SECURITY.md
  - docs/auto-merge.md
  - docs/examples/gemini.yml
  - docs/examples/github-models.yml
  - docs/examples/ingest.yml
  - docs/release-process.md
  - scripts/trigger-heal-local.sh
  - src/healer/diff-normalizer.test.ts
  - src/healer/forbidden-patterns.test.ts
  - src/healer/forbidden-patterns.ts
findings:
  critical: 0
  warning: 4
  info: 3
  total: 7
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-05-04
**Depth:** standard
**Files Reviewed:** 17
**Status:** issues_found

## Summary

Phase 6 delivers user-facing documentation, GitHub Actions workflow YAML for dogfood and
example consumers, and a fixture rename touching three `src/healer/` files. The security
controls reviewed (SHA-pinned action refs, `persist-credentials: false` on all checkout
steps, no `pull_request_target` trigger, SEC-05 actor guard) are correctly applied across
all workflow files. The `src/healer/` changes are comment-only for `forbidden-patterns.ts`
and path-string updates in the two test files; the regex and test logic are unaffected and
consistent with the renamed fixture path.

Four documentation-accuracy warnings were found. The most impactful is that the two
consumer-facing example healer workflows (`docs/examples/gemini.yml` and
`docs/examples/github-models.yml`) do not declare the four `workflow_dispatch` inputs that
`src/ingest/dispatch.ts` sends when auto-dispatching a heal. GitHub's API rejects
`workflow_dispatch` calls that supply undeclared inputs with HTTP 422, which means the
automated healing path is broken for any consumer who copies these example files without
modification. This is the only finding with production-correctness consequences.

## Warnings

### WR-01: Example healer workflows missing four `workflow_dispatch` inputs — auto-dispatch will fail with HTTP 422

**Files:** `docs/examples/gemini.yml:24-44`, `docs/examples/github-models.yml:24-44`

**Issue:** `src/ingest/dispatch.ts` (line 50-58) fires a `workflow_dispatch` event with
eight named inputs: `commitSha`, `testFile`, `testTitle`, `fixClassHint`, `flakeRate`,
`windowDays`, `runCount`, `concurrencyKey`. The two consumer-facing example workflows
declare only five of these in their `workflow_dispatch.inputs` blocks: `testFile`,
`testTitle`, `fixClassHint`, `concurrencyKey`, `enable_auto_merge`. The four inputs
`commitSha`, `flakeRate`, `windowDays`, `runCount` are missing.

GitHub's REST API (`POST /repos/.../actions/workflows/.../dispatches`) returns HTTP 422
"Unexpected inputs provided" when a dispatch call includes input keys not declared in the
target workflow. This means any consumer who copies an example file as-is will receive a
422 error from the ingest step the first time a threshold is breached, silently swallowing
the heal trigger. The internal `self-test.yml` correctly declares all eight inputs (lines
37-61) and is not affected.

**Fix:** Add the four missing input declarations to both example workflow files:

```yaml
# In docs/examples/gemini.yml and docs/examples/github-models.yml,
# add these four entries to the workflow_dispatch.inputs block:
      commitSha:
        description: 'Commit SHA to heal against (set automatically by ingest dispatch)'
        required: false
        default: ''
      flakeRate:
        description: 'Recent flake rate (0.0–1.0). Set automatically by ingest dispatch.'
        required: false
        default: ''
      windowDays:
        description: 'Rolling window in days. Set automatically by ingest dispatch.'
        required: false
        default: ''
      runCount:
        description: 'Recent run count. Set automatically by ingest dispatch.'
        required: false
        default: ''
```

Also update `commit_sha: ${{ inputs.commitSha || github.sha }}` (currently line 71 in
`gemini.yml`, line 76 in `github-models.yml`) — once `commitSha` is declared, the
`|| github.sha` fallback is only needed for manual dispatches without the ingest flow.
That fallback remains correct behavior so no change is strictly required there, but the
pattern is already used in `self-test.yml:149` with the same semantics.

---

### WR-02: README fine-grained PAT table lists `Actions | Read` — creating a `workflow_dispatch` event requires `Actions: write`

**File:** `README.md:171`

**Issue:** The "Required PAT scopes" table states:

```
| Actions | Read | Trigger workflow dispatch |
```

Creating a workflow dispatch event via the GitHub REST API
(`POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`) requires
`Actions: write` permission on fine-grained PATs, not `Read`. The `Read` scope only
allows listing and viewing workflow runs. A consumer who follows the README and creates a
fine-grained PAT with only `Actions: read` will receive HTTP 403 on every ingest-triggered
heal dispatch. The correct value (`Actions:write`) is already present in
`docs/examples/ingest.yml:13`.

**Fix:**

```markdown
| Actions | Write | Trigger workflow dispatch |
```

---

### WR-03: CONTRIBUTING.md claims security-lint enforces SHA-pinning on action refs — no such check exists

**File:** `CONTRIBUTING.md:27`

**Issue:** The CI gate description states:

> All `actions/checkout` refs are SHA-pinned

`security-lint.yml` has five checks (Check 1: no `pull_request_target`; Check 2:
`persist-credentials: false`; Check 3a/b: security-contract trailer + snapshot; Check 4:
no HTTP clients; Check 5: no global gitconfig PAT writes). None of them verify that action
refs are SHA-pinned. A contributor reading CONTRIBUTING.md would expect that non-SHA-pinned
refs are blocked by CI, but they are not — the enforcement is by convention only.

**Fix:** Either add a SHA-pinning check to `security-lint.yml` (the `yq`-based approach in
Check 2 can be adapted), or correct the documentation:

```markdown
- All `actions/checkout` steps have `persist-credentials: false`
- No `pull_request_target` triggers in any workflow file
```

_(Remove the SHA-pinning bullet until a CI check enforces it, or replace it with a note
that SHA-pinning is a convention verified during PR review.)_

---

### WR-04: SECURITY.md references wrong path for `security-contract.ts`

**File:** `SECURITY.md:22`

**Issue:** The Tool-naming contract section says:

> An audit invariant in `src/healer/security-contract.ts` enforces this at test time.

The file is located at `src/shared/security-contract.ts`, not `src/healer/`. This is
confirmed by both the filesystem and `security-lint.yml:118`, which references the correct
path. A contributor following the SECURITY.md pointer will not find the file.

**Fix:**

```markdown
An audit invariant in `src/shared/security-contract.ts` enforces this at test time.
```

---

## Info

### IN-01: CHANGELOG `[Unreleased]` link resolves to an empty diff (`HEAD...HEAD`)

**File:** `CHANGELOG.md:81`

**Issue:** The link footer is:

```
[Unreleased]: https://github.com/Sacharified/playwright-healer/compare/HEAD...HEAD
```

This URL always resolves to an empty diff (HEAD compared to itself). The Keep-a-Changelog
convention for a pre-first-release repo is
`compare/v0.0.0...HEAD` (using a sentinel base tag) or no link at all. The release-process
doc (`docs/release-process.md:5`) correctly instructs updating the link footer on tag-day,
so this will be fixed as part of the release procedure. No code change is needed before
the first release.

**Fix (at release time, already covered in `docs/release-process.md`):**

```markdown
[Unreleased]: https://github.com/Sacharified/playwright-healer/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Sacharified/playwright-healer/releases/tag/v0.1.0
```

---

### IN-02: `docs/examples/ingest.yml` uses a directory path for `report_path` while README uses a file path

**Files:** `docs/examples/ingest.yml:55`, `README.md:39`

**Issue:** The ingest snippet example passes a directory (`report_path: ./playwright-report/`)
while the README Quick Start snippet uses a file path (`report_path: test-results/results.json`).
Both are valid — `src/ingest/index.ts:55` uses `@actions/glob` so both forms resolve — but
the inconsistency may confuse consumers trying to reconcile the two examples. The
`upload-artifact` step in `docs/examples/ingest.yml` uploads `playwright-report/` (the
artifact directory) so the directory form is correct in context; the README snippet targets
the default output path directly.

**Fix:** Add a clarifying comment to the `report_path` line in `docs/examples/ingest.yml`:

```yaml
          report_path: ./playwright-report/   # directory: glob finds results.json within; or pass a direct file path
```

---

### IN-03: `self-test.yml` concurrency group is an empty suffix for push/PR events

**File:** `.github/workflows/self-test.yml:69`

**Issue:** The workflow-level concurrency group is:

```yaml
group: playwright-healer-${{ github.repository }}-${{ github.event.inputs.concurrencyKey }}
```

On `push` and `pull_request` events, `github.event.inputs.concurrencyKey` evaluates to
empty string. All concurrent push/PR runs on the same repository share the same concurrency
group key (`playwright-healer-<owner>/<repo>-`). With `cancel-in-progress: false` this
causes queuing rather than cancellation — so runs are not dropped, they wait. This is
unlikely to cause problems in practice but could slow CI if multiple PRs trigger the
self-test simultaneously. The `workflow_dispatch` path is unaffected because `concurrencyKey`
is always populated by `inputs.*`.

**Fix:** Differentiate push/PR runs from dispatch runs by incorporating the run SHA:

```yaml
group: playwright-healer-${{ github.repository }}-${{ github.event.inputs.concurrencyKey || github.sha }}
cancel-in-progress: false
```

This matches the pattern already used in `docs/examples/gemini.yml:47` and
`docs/examples/github-models.yml:52`.

---

_Reviewed: 2026-05-04_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
