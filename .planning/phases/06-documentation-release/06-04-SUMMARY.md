---
phase: 06-documentation-release
plan: 06-04
subsystem: docs
tags: [documentation, auto-merge, release-process, example-workflows, consumer-adoption]
dependency_graph:
  requires:
    - 06-01 (security pre-flight — confirms no secrets before docs go public)
    - 06-02 (fixture rename — tests/fixture-app/ path used in context)
  provides:
    - docs/auto-merge.md (auto-merge prerequisite matrix and soft-fail reference)
    - docs/release-process.md (v0.1.0 tag-day script + v1 alias mechanics)
    - docs/examples/gemini.yml (copy-paste Gemini 2.5 Flash heal workflow)
    - docs/examples/github-models.yml (copy-paste GitHub Models gpt-4.1 heal workflow)
    - docs/examples/ingest.yml (ingest job-step snippet)
  affects:
    - README.md ##auto-merge-prerequisites anchor (links to docs/auto-merge.md)
    - plan 06-06 tag-day task (follows docs/release-process.md procedure)
tech_stack:
  added: []
  patterns:
    - SHA-pinned actions/checkout with persist-credentials: false
    - Job-level permissions (not workflow-level) for heal jobs
    - Single-PAT dual-use pattern for GitHub Models (models:read + repo scope)
key_files:
  created:
    - docs/auto-merge.md
    - docs/release-process.md
    - docs/examples/gemini.yml
    - docs/examples/github-models.yml
    - docs/examples/ingest.yml
  modified: []
decisions:
  - Lifted release-process bash scripts verbatim from RESEARCH.md §R-02 without adaptation — scripts are deterministic shell commands, no reason to paraphrase
  - Used v6.0.2 SHA (de0fac2e4500dabe0009e67214ff5f5447ce83dd) for actions/checkout in example workflows — same SHA as in e2e-heal-self.yml per PATTERNS.md shared patterns
  - upload-artifact SHA pinned to v4.5.0 (6f51ac03b9356f520e9adb1b1b7802705f340c2b) in ingest.yml for consistency with security posture
  - gemini.yml and github-models.yml kept structurally identical — only provider/model/api_key lines and comment headers differ; verified by diff
metrics:
  duration: 25m
  completed: 2026-05-04
  tasks_completed: 3
  tasks_total: 3
  files_created: 5
  files_modified: 0
---

# Phase 06 Plan 04: Docs Companion Files Summary

**One-liner:** Five consumer-facing docs files: auto-merge companion (6-section), release-process tag-day script, and three example workflows (Gemini default, GitHub Models alternative, ingest snippet).

## Tasks Completed

| Task | Name | Commit | Key files |
|------|------|--------|-----------|
| 1 | Create docs/auto-merge.md and docs/release-process.md | da9abc0 | docs/auto-merge.md, docs/release-process.md |
| 2 | Create docs/examples/ingest.yml and docs/examples/gemini.yml | 01d54da | docs/examples/ingest.yml, docs/examples/gemini.yml |
| 3 | Create docs/examples/github-models.yml | eb1fbf7 | docs/examples/github-models.yml |

## Files Created

### docs/auto-merge.md

Six sections as specified:
1. Why auto-merge is opt-in — automation risk framing, auditable trust gate rationale
2. Required repository settings — all 4 prerequisites with exact GitHub UI paths (Allow auto-merge, Allow squash merging, branch protection with required status check, healer_token PAT scopes — both classic `repo` and fine-grained `Contents:write + Pull requests:write`)
3. The reasoning band format — 4-condition trust gate table (pass rate, fix class, diff-lint, security-contract)
4. Soft-fail behavior matrix — 4-row table mapping GitHub API errors to `core.warning` annotations and consumer actions
5. T-05-06 SKIP_SENTINEL preservation — explains `[skip-healer]` sentinel and `shouldSkipIngest()` loop prevention
6. Live demo evidence — forward reference to `tests/fixture-app/uat-evidence-live-auto-merge.md` (D-03)

### docs/release-process.md

Tag-day bash script lifted verbatim from RESEARCH.md §R-02 with prose wrapper sections:
- Overview of immutable `v0.1.0` vs moving `v1` alias strategy
- CHANGELOG preparation step (move [Unreleased] → [0.1.0], re-create empty [Unreleased])
- v0.1.0 tag creation script
- v1 alias creation + `--force` push with cache-invalidation note
- `gh release create --notes-file CHANGELOG.md --draft` command
- Future v0.1.1+ patch release mechanics
- v2 alias convention for minor version bumps

Scripts lifted verbatim from RESEARCH.md §R-02 without modification.

### docs/examples/gemini.yml

Complete consumer heal workflow for Gemini 2.5 Flash:
- `uses: Sacharified/playwright-healer@v1` (published action, not `./`)
- `provider: gemini`, `model: gemini-2.5-flash`, `api_key: ${{ secrets.GEMINI_API_KEY }}`
- `actions/checkout@de0fac2e...  # v6.0.2` SHA-pinned
- `persist-credentials: false`
- `permissions: contents: write, pull-requests: write` at job level (not workflow level)
- `workflow_dispatch` trigger only with testFile, testTitle, fixClassHint, concurrencyKey, enable_auto_merge inputs
- `concurrency:` block to prevent parallel heal runs
- Placeholder comments on base_url, setup_command, start_command
- No internal repo structure references

### docs/examples/github-models.yml

Structurally identical to gemini.yml except:
- `name: playwright-healer / heal (GitHub Models)`
- `provider: github`, `model: openai/gpt-4.1`
- `api_key: ${{ secrets.HEALER_PAT }}` — same PAT as healer_token (single-PAT pattern)
- Comment header explaining the single-PAT dual-use (models:read + repo scope)
- Comment block explaining why the same PAT covers both auth roles

### docs/examples/ingest.yml

Job-step snippet (not a complete workflow) for pasting into existing CI:
- `on: push / pull_request` trigger shown for the enclosing job
- `upload-artifact` step shown BEFORE the ingest action call (DOC-03 prominent callout)
- `mode: ingest`, `report_path`, `healer_token`, `github_token`, `flake_rate_threshold`, `flake_window_days` inputs
- Comments explaining: paste into existing CI after test run, auto-dispatch note, upload-artifact is required prerequisite

## Verification Results

All phase-level gates passed:
- Gate 1: all 5 files exist — PASS
- Gate 2: `persist-credentials: false` in both gemini.yml and github-models.yml — PASS
- Gate 3: `Sacharified/playwright-healer@v1` in both heal example workflows — PASS
- Gate 4: `git tag -f v1` present in release-process.md (3 occurrences) — PASS
- Gate 5: soft-fail / core.warning present in auto-merge.md (5 occurrences) — PASS

## Deviations from Plan

None — plan executed exactly as written. Scripts in release-process.md lifted verbatim from RESEARCH.md §R-02 as specified.

## Known Stubs

None. All five files are complete documentation with no placeholder content that would prevent their purpose.

## Threat Flags

No new network endpoints, auth paths, or schema changes introduced. These are static documentation files only.

## Self-Check: PASSED

Files verified:
- docs/auto-merge.md: FOUND
- docs/release-process.md: FOUND
- docs/examples/gemini.yml: FOUND
- docs/examples/github-models.yml: FOUND
- docs/examples/ingest.yml: FOUND

Commits verified:
- da9abc0 (Task 1) — FOUND
- 01d54da (Task 2) — FOUND
- eb1fbf7 (Task 3) — FOUND
