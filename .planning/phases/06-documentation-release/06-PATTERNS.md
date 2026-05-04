# Phase 6: Documentation + Release — Pattern Map

**Mapped:** 2026-05-02
**Files analyzed:** 11 new/modified files
**Analogs found:** 10 / 11 (1 external reference only)

---

## Naming + Structure Conventions Inferred from the Repo

1. **Workflow YAML headers:** `name:` (short human label), then `on:`, then `permissions:` at workflow level, then `jobs:`. Section dividers use `# ──────────────────────────────────────────────────────────────────` horizontal rules (see `security-lint.yml` and `phase1-self-test.yml`). Job names are quoted strings with a descriptive label (`name: 'Check 1: ...'`).
2. **SHA-pinned action refs:** Every `uses: actions/checkout@<sha>` includes an inline comment `# v6.0.2 — re-verified at execution`. All new workflow steps must follow this pattern (copy the SHA + comment from `e2e-heal-self.yml` line 75).
3. **Commit message convention:** `type(NN-MM): ...` where `NN` is phase number and `MM` is plan/task number (e.g., `docs(06-01): ...`, `fix(06-02): ...`). Seen consistently across all phase commits in git log.
4. **Planning doc frontmatter:** YAML frontmatter block at top of `.planning/` markdown files (`phase:`, `created:`, `status:`, `phase_goal:`, `canonical_refs:`). See `06-CONTEXT.md` lines 1–17. New `docs/` files ship WITHOUT frontmatter (they are consumer-facing, not planning docs).
5. **`with:` key naming in workflows:** All action inputs use `snake_case` (`api_key`, `healer_token`, `setup_command`). Consumer example workflows must mirror `action.yml`'s exact input names verbatim.

---

## File Pattern Assignments

### `README.md` — expansion of 16-line stub

**Analog:** `.github/workflows/e2e-heal-self.yml` (workflow-level comment block, lines 1–17) — for the tone of "explains what this does, then shows the exact steps". Also: `action.yml` lines 1–180 for the canonical inputs surface to document.

**External tone reference:** CONTEXT.md D-05 explicitly names `anthropics/claude-code-action` README as the target tone. Use the CONTEXT.md description directly: "practical-detailed, code-snippet-first, prerequisite-callout-prominent. NOT marketing-tone."

**What to lift verbatim:**
- Current README lines 1–16: the stub's `## Auto-merge prerequisites` section becomes a one-liner + link to `docs/auto-merge.md` (D-05 says keep an anchor stub in README per pitfall 6, option a — no code changes required to `core.warning` strings).
- The four PAT-scope bullet points (README lines 3–14) move verbatim into `docs/auto-merge.md` §Required repository settings.

**What deliberately differs:**
- Consumer-facing prose (no phase numbers, no GSD terminology, no `.planning/` references).
- Mermaid sequence diagram (DOC-01) uses 6–8 lifelines per CONTEXT.md D-05 §3. Source is pre-written in `06-RESEARCH.md §R-03` — lift directly.
- 11-section structure per CONTEXT.md D-05 (not the 1-section stub).

---

### `CHANGELOG.md` — new (Keep a Changelog format)

**Analog:** `node_modules/jws/CHANGELOG.md` lines 1–20 — this follows Keep a Changelog format with `## [4.0.1]` version headers and `### Changed` subsections. The Anthropic SDK CHANGELOG uses Conventional Commits auto-generated format (`### Features`, `### Bug Fixes`, `### Chores`) which is the WRONG format for this project.

**What to lift verbatim from `node_modules/jws/CHANGELOG.md` (structural skeleton only):**
- Top-level header: `# Change Log` (or `# Changelog` — both are Keep a Changelog compliant; prefer `# Changelog` per keepachangelog.com 1.1.0 canonical wording).
- Version header pattern: `## [Unreleased]` at top (empty block), then `## [0.1.0] - YYYY-MM-DD`.
- Keep a Changelog section names: **`### Added`**, **`### Changed`**, **`### Deprecated`**, **`### Removed`**, **`### Fixed`**, **`### Security`** (NOT `### Features`, `### Bug Fixes`, `### Chores` — those are Conventional Commits, wrong format here).
- Comparison link pattern at bottom: `[0.1.0]: https://github.com/Sacharified/playwright-healer/releases/tag/v0.1.0`

**What deliberately differs:**
- Entries are user-facing feature bullets per CONTEXT.md D-07. Draft content is pre-written in `06-RESEARCH.md §R-06` — lift and refine.
- Explicit "Deferred items" subsection per CONTEXT.md D-07 (not in the jws CHANGELOG; specific to our pre-release state).
- No auto-generated commit links. Manual entries only (D-07).
- Tag-day mechanic: move all `[Unreleased]` entries to `[0.1.0]` block, add date, recreate empty `[Unreleased]`. Document this in `docs/release-process.md` (pitfall 7 per CONTEXT.md).

---

### `SECURITY.md` — new (vuln reporting + threat-model summary)

**Analog:** `node_modules/universal-user-agent/SECURITY.md` (structure only — 3 lines, too minimal for this project's needs). No closer codebase analog exists. Use CONTEXT.md D-08 as the structural specification directly.

**What to lift verbatim:**
- Section 1 heading: `## Reporting a Vulnerability` (standard GitHub community health file label — GitHub uses this exact string for the Security tab badge).
- Private vulnerability reporting link: `https://github.com/Sacharified/playwright-healer/security/advisories/new`
- 90-day responsible disclosure window, no bug bounty for v0.1.x (from D-08).

**What deliberately differs:**
- Section 2 (`## Security Posture`) is specific to this project: covers diff-lint FIX-06, tool-naming contract D-13, SSOT D-17, dispatch contract D-18, `pull_request_target` never-used, allowed tools list. Source material: CONTEXT.md D-08 bullet list — lift and lightly prose-ify.
- Do NOT copy the full threat model from `.planning/phases/01-security-scaffold-composite-packaging/01-CONTEXT.md`; D-08 explicitly says SECURITY.md ships the summary only.

---

### `CONTRIBUTING.md` — new (1-pager)

**Analog:** No CONTRIBUTING.md exists in this repo or in scanned `node_modules/`. Pattern from CONTEXT.md D-09: "1-pager: phase-numbered commits, GSD workflow note, PR review expectations."

**What to lift verbatim:**
- Commit message convention from git log: `type(NN-MM): description` (e.g., `docs(06-01): expand README`). The phase numbering is visible in every commit in git log.
- `security-lint.yml` runs on every PR — mention this as the required CI gate.

**What deliberately differs:**
- Consumer-contributor hybrid audience (external contributors who aren't familiar with GSD). Keep GSD mention brief: "This project uses the GSD planning workflow. Planning docs live in `.planning/`."
- No frontmatter (consumer-facing file).

---

### `docs/auto-merge.md` — expansion of Phase 5 stub

**Analog:** `README.md` lines 3–16 (the current stub content becomes the seed for this file's §Prerequisites section).

**What to lift verbatim:**
- The four numbered prerequisite bullet points from README lines 4–14 move verbatim into `docs/auto-merge.md` §Required repository settings.
- The `core.warning` soft-fail description (README line 15) becomes the seed for the §Soft-fail behavior matrix section.

**What deliberately differs:**
- Expands stub into full companion doc (see CONTEXT.md D-05 §`docs/auto-merge.md` companion structure): why opt-in, repo settings section, reasoning band format, soft-fail matrix, T-05-06 SKIP_SENTINEL explanation, link to live demo evidence file.
- No frontmatter. Consumer-facing.
- The `core.warning` text in `src/healer/pr-writer.ts` currently points to `README §auto-merge-prerequisites` — after D-05's split, the README keeps an anchor stub (`## Auto-merge prerequisites` → "See [docs/auto-merge.md](docs/auto-merge.md)") so existing warning links don't break (pitfall 6 option a — no code change required).

---

### `docs/release-process.md` — new

**Analog:** `06-RESEARCH.md §R-02` contains the full tag-day script and mechanics. This file is a prose wrapper around that script.

**What to lift verbatim:**
- The bash tag-day script from RESEARCH.md §R-02 lines 144–170 (v0.1.0 creation, v1 alias, push commands).
- The v0.1.1 mechanics script (RESEARCH.md §R-02 lines 172–179).
- Moving-alias cache note (RESEARCH.md §R-02 lines 182–186): "tag promotion takes effect on the next GitHub Actions runner cache refresh."
- `gh release create` command (RESEARCH.md §R-02 lines 192–196).

**What deliberately differs:**
- Consumer-readable prose sections wrapping the scripts (not a raw research dump).
- Section "When to re-point v1" explains the `[Unreleased] → [0.1.0]` CHANGELOG mechanic (pitfall 7 per CONTEXT.md).
- No frontmatter. Consumer-facing.

---

### `docs/examples/gemini.yml` — consumer-facing ingest+heal workflow

**Analog:** `.github/workflows/e2e-heal-self.yml` — our own dogfood workflow. This is the closest structural match.

**What to lift verbatim from `e2e-heal-self.yml`:**
- Overall two-job structure (ingest job + heal job) — adapt `assert-test-broken` → `ingest` and `heal` → `heal`.
- `actions/checkout@de0fac2e...  # v6.0.2` SHA-pinned ref (line 75) — same SHA, same comment.
- `persist-credentials: false` on all checkout steps (line 77).
- `permissions:` block at job level: `contents: write` + `pull-requests: write` on the heal job (lines 128–130).
- `concurrency:` block pattern (lines 63–67) — adapt group key for consumer use.
- The `with:` input block structure (lines 152–176) shows exact key names. For the Gemini example:
  - `provider: gemini`
  - `model: gemini-2.5-flash` (free tier per CONTEXT.md D-06 rationale)
  - `api_key: ${{ secrets.GEMINI_API_KEY }}`
  - `healer_token: ${{ secrets.HEALER_PAT }}`

**What deliberately differs:**
- Consumer-facing: references a fictional consumer repo structure, not `tests/fixture-app/`. The `test_command`, `setup_command`, `start_command` inputs show placeholder values.
- `on:` trigger is `workflow_dispatch` only (consumer chooses when to run the heal step). The ingest job uses `push` / `pull_request` on the consumer's main workflow.
- No red-guard job (the `assert-test-broken` job is internal testing scaffolding, not a consumer pattern).
- Secrets named `GEMINI_API_KEY` and `HEALER_PAT` (consumer-facing names from CONTEXT.md).

---

### `docs/examples/github-models.yml` — consumer-facing GitHub Models variant

**Analog:** Same as `gemini.yml` — `.github/workflows/e2e-heal-self.yml`, specifically the Phase 04 provider switch block (lines 151–162):

```yaml
provider: github
model: openai/gpt-4.1
api_key: ${{ secrets.HEALER_PAT }}
healer_token: ${{ secrets.HEALER_PAT }}
```

**What to lift verbatim:**
- The `# Phase 04 — switched from Gemini to GitHub Models` comment block (lines 151–162) explains that a single `HEALER_PAT` covers both `models:read` (api_key) and `repo` (healer_token) scopes. Lift this explanation as a comment in the example workflow.
- All structural elements identical to `gemini.yml` above.

**What deliberately differs:**
- `provider: github`, `model: openai/gpt-4.1` (per CLAUDE.md default model table).
- Comment clarifies the "single PAT for both api_key and healer_token" pattern (the Gemini example uses two separate secrets).

---

### `docs/examples/ingest.yml` — shared ingest workflow snippet

**Analog:** `action.yml` inputs `report_path`, `flake_rate_threshold`, `flake_window_days` (lines 57–75) — these are the exact keys the ingest snippet must pass. `e2e-heal-self.yml` has no standalone ingest step.

**What to lift verbatim:**
- `mode: ingest` call shape from `action.yml` input list.
- `report_path`, `flake_rate_threshold`, `flake_window_days`, `slow_regression_pct` as the four ingest-relevant inputs (from `action.yml` lines 57–75).
- `healer_token: ${{ secrets.HEALER_PAT }}` (required even in ingest mode for dispatch).
- `github_token: ${{ github.token }}` (default built-in token).

**What deliberately differs:**
- Standalone snippet, not a full workflow — consumers paste this into their existing CI workflow as a job step.
- `on: push` trigger shown on the enclosing job (not a full workflow `on:` block).
- `upload-artifact` step shown BEFORE the ingest call (this is the prerequisite that CONTEXT.md D-05 §4 flags as DOC-03 "prominent callout").

---

### `.github/workflows/self-test.yml` — promoted from `e2e-heal-self.yml`

**Primary analog:** `.github/workflows/e2e-heal-self.yml` (direct promotion, not a rewrite).

**Secondary analog for trigger pattern:** `.github/workflows/phase1-self-test.yml` lines 3–5 shows the `on: push: / pull_request:` pattern for always-on workflows. Note: phase1-self-test.yml's two-job `needs: / if: always()` verification pattern (lines 59–80) is a candidate for future hardening but the existing e2e-heal-self.yml three-job structure is a closer fit for self-test.yml's purpose.

**What to lift verbatim (structural changes only):**
- All three jobs (`assert-test-broken`, `heal`, `assert-artifact-opened`) — structure preserved.
- All SHA-pinned `actions/checkout` refs (line 75, 132, 190).
- All `with:` input values for the heal step (lines 149–176) — keep `provider: github`, `model: openai/gpt-4.1`.
- The `concurrency:` block (lines 63–67).

**What changes vs `e2e-heal-self.yml`:**
- `on:` trigger changes from `workflow_dispatch` only to:
  ```yaml
  on:
    push:
      branches: [main]
    pull_request:
      paths:
        - 'src/**'
        - 'action.yml'
        - '.github/workflows/self-test.yml'
    workflow_dispatch:
  ```
  (per CONTEXT.md D-02 and PKG-04; docs-only PRs skip self-test per D-05 §PKG-04).
- All `fixture/` path references updated to `tests/fixture-app/` (D-02).
- Auto-dispatch loop guard on the heal job. Source: `src/shared/loop-guard.ts` line 14 defines `BOT_NAME = 'playwright-healer-bot'` — this is the actor name to guard against. Use `if: github.actor != 'playwright-healer-bot'` on the heal job. (CONTEXT.md pitfall 4 named `playwright-healer-bot`; `github-actions[bot]` would be wrong here since healer PRs use `HEALER_PAT` which carries the PAT owner's identity, not the built-in bot identity.)
- `name:` changes from `E2E Self-Heal` to `Self-Test`.

---

### `tests/fixture-app/` — rename of `fixture/`

**No new files created.** This is a directory rename + reference update.

**Current structure to move (`fixture/` tree):**
- `fixture/index.html` → `tests/fixture-app/index.html`
- `fixture/package.json` → `tests/fixture-app/package.json`
- `fixture/playwright.config.ts` → `tests/fixture-app/playwright.config.ts`
- `fixture/tests/broken-selector.spec.ts` → `tests/fixture-app/tests/broken-selector.spec.ts`
- `fixture/tests/broken-assertion.spec.ts` → `tests/fixture-app/tests/broken-assertion.spec.ts`
- `fixture/.gitignore` → `tests/fixture-app/.gitignore`

**Known references requiring updates (run `git grep fixture/` for the complete set before planning tasks):**

| File | Lines | Change |
|------|-------|--------|
| `.github/workflows/e2e-heal-self.yml` | 9, 25, 84, 87, 89, 108, 110, 113, 163, 164, 165 | `fixture/` → `tests/fixture-app/` |
| `.github/workflows/self-test.yml` | (promoted file — use `tests/fixture-app/` from day one) | n/a |
| `scripts/trigger-heal-local.sh` | 68, 69, 108 | `fixture/` → `tests/fixture-app/` |
| `src/healer/diff-normalizer.test.ts` | 41 | `fixture/tests/` → `tests/fixture-app/tests/` |
| `src/healer/forbidden-patterns.test.ts` | 70, 71 | test description + path string |
| `src/healer/forbidden-patterns.ts` | 36 | comment reference to `fixture/tests/...` |
| `fixture/package.json` | 6 (description) | update to `tests/fixture-app` |
| Cross-repo: `Sacharified/playwright-healer-test:.github/workflows/sc1-healer.yml` | (references `fixture/tests/broken-selector.spec.ts`) | update both repos in lockstep per CONTEXT.md pitfall 3 |

**No internal content changes** to `.spec.ts` files or `playwright.config.ts` — the rename is structural only.

---

## Shared Patterns

### SHA-pinned action checkout
**Source:** `.github/workflows/e2e-heal-self.yml` line 75 and `.github/workflows/security-lint.yml` line 16
**Apply to:** All new workflow files (`self-test.yml`, `docs/examples/gemini.yml`, `docs/examples/github-models.yml`, `docs/examples/ingest.yml`)
```yaml
- uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd  # v6.0.2 — re-verified at execution
  with:
    persist-credentials: false
```

### Workflow `permissions:` at job level (not workflow level)
**Source:** `.github/workflows/e2e-heal-self.yml` lines 128–130
**Apply to:** Any job that opens PRs (the heal job in consumer examples)
```yaml
permissions:
  contents: write
  pull-requests: write
```

### `security-lint.yml` exclusion list update
**Source:** `.github/workflows/security-lint.yml` lines 29–36 (current exclude list)
**Apply to:** `security-lint.yml` CHECK 1 must be updated to exclude new documentation files from the `pull_request_target` grep: add `':(exclude)SECURITY.md'`, `':(exclude)CONTRIBUTING.md'`, `':(exclude)docs/'` alongside the existing excludes.

### Consumer `with:` block minimum required inputs
**Source:** `action.yml` lines 1–180 (complete input surface)
**Apply to:** All `docs/examples/*.yml` files. Minimum required inputs for heal mode:
- `mode: heal` (required)
- `healer_token: ${{ secrets.HEALER_PAT }}` (required)
- `provider:`, `model:`, `api_key:` (provider-specific)
- `test_command:`, `base_url:` (consumer-specific)

---

## No Analog Found

| File | Reason |
|------|--------|
| `CONTRIBUTING.md` | No CONTRIBUTING.md exists in repo or node_modules for comparable projects. Pattern from CONTEXT.md D-09 description is sufficient. |

---

## Metadata

**Analog search scope:** `.github/workflows/`, `fixture/`, `node_modules/@anthropic-ai/sdk/`, `node_modules/jws/`, `node_modules/universal-user-agent/`, `README.md`, `action.yml`, `src/shared/loop-guard.ts`, `.planning/phases/06-documentation-release/`
**Files read:** 15
**Pattern extraction date:** 2026-05-02
