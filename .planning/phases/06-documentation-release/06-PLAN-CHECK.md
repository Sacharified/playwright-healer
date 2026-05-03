---
status: needs_revision
score: 7/7 checks pass (3 with warnings, 1 with info)
phase: 06-documentation-release
plans_checked: 06-01, 06-02, 06-03, 06-04, 06-05, 06-06
checker_date: 2026-05-02
---

# Phase 06 Plan Check Report

## Verdict

**needs_revision** — All 7 checks pass, but 3 produce warnings that require planner revision before execution. One warning is a blocker-class context compliance gap (D-09 dogfood ingest workflow unplanned); two are concrete failure paths if left unaddressed (anchor ambiguity in 06-03, Wave 2 parallel-read fragility in 06-04).

---

## Check 1: Coverage — all 8 requirements land in at least one plan

**Status: PASS**

| Requirement | Covering Plan(s) | Covering Task(s) | Notes |
|-------------|-----------------|-----------------|-------|
| PKG-03 | 06-06 | Task 1 (CHANGELOG prep) + Task 3 (tag creation) | 06-01 also claims PKG-03 in frontmatter — see Issue #4 |
| PKG-04 | 06-02 + 06-05 | 06-02 Task 1 (rename), 06-05 Task 1 (self-test.yml creation) | Correctly split across plans |
| PKG-05 | 06-03 + 06-04 | 06-03 Task 1 (README), 06-04 Task 2–3 (example workflows) | SC#1 path covered |
| DOC-01 | 06-03 | Task 1, §3 Architecture + Mermaid diagram | Verbatim from RESEARCH.md §R-03 |
| DOC-02 | 06-04 | Task 2 (ingest.yml + gemini.yml), Task 3 (github-models.yml) | Two providers per D-06 |
| DOC-03 | 06-03 | Task 1, §4 Prerequisites | Prominent callout per decision |
| DOC-04 | 06-03 | Task 1, §5 Token scopes | GITHUB_TOKEN recursion guard |
| DOC-05 | 06-01 + 06-03 + 06-06 | 06-01 Task 2 (SECURITY.md), 06-03 Task 2 (CHANGELOG [Unreleased]), 06-06 Task 1 (CHANGELOG finalize) | Fully covered |

All 8 requirements have at least one covering plan. Coverage is complete for PKG-/DOC- requirements.

---

## Check 2: Wave safety — no intra-wave files_modified overlap

**Status: PASS**

Wave 1 (06-01, 06-02 — parallel):

| Plan | files_modified |
|------|---------------|
| 06-01 | .gitleaks.toml, SECURITY.md, CONTRIBUTING.md |
| 06-02 | fixture/ (deleted), tests/fixture-app/ (created), .github/workflows/e2e-heal-self.yml, scripts/trigger-heal-local.sh, src/healer/forbidden-patterns.ts, src/healer/forbidden-patterns.test.ts, src/healer/diff-normalizer.test.ts |

No overlap. Clean.

Wave 2 (06-03, 06-04 — parallel):

| Plan | files_modified |
|------|---------------|
| 06-03 | README.md, CHANGELOG.md, .github/workflows/security-lint.yml |
| 06-04 | docs/auto-merge.md, docs/release-process.md, docs/examples/gemini.yml, docs/examples/github-models.yml, docs/examples/ingest.yml |

No overlap. Clean.

Wave 3 (06-05 — serial after Wave 2):
Only plan in wave. Modifies .github/workflows/self-test.yml (new) and deletes .github/workflows/e2e-heal-self.yml. No wave peers. Clean.

Wave 4 (06-06 — serial after Wave 3):
Only plan in wave. Modifies CHANGELOG.md only (Task 1 + auto). Clean.

No file overlap found in any intra-wave pair.

---

## Check 3: Dependency correctness

**Status: PASS (with informational note)**

| Plan | depends_on | Wave | Valid? |
|------|-----------|------|--------|
| 06-01 | [] | 1 | Yes |
| 06-02 | [] | 1 | Yes |
| 06-03 | [06-01, 06-02] | 2 | Yes |
| 06-04 | [06-01, 06-02] | 2 | Yes |
| 06-05 | [06-01, 06-02, 06-03, 06-04] | 3 | Yes |
| 06-06 | [06-05] | 4 | Yes |

Dependency graph is acyclic. Wave numbers are consistent with max(deps)+1. No forward references.

**Informational note (not a blocker):** 06-05's dependency on 06-04 is over-constrained. self-test.yml depends on the fixture rename (06-02) and technically on the security-lint exclusion updates (06-03), but has no actual dependency on any of 06-04's `docs/` outputs. The over-constraint does not cause failure — it only prevents 06-05 from being promoted to Wave 2. Not worth changing; the wave structure is already serialized appropriately.

---

## Check 4: Verification gates — real automated checks, no echo-fakes

**Status: PASS**

| Plan | Task | Automated Verify Command | Real? |
|------|------|--------------------------|-------|
| 06-01 | T1 | `npx gitleaks@latest git . && echo "gitleaks CLEAN"` | Yes — real tool exit code |
| 06-01 | T2 | `test -f SECURITY.md && test -f CONTRIBUTING.md && echo "FILES_EXIST" && grep -c "Reporting a Vulnerability" SECURITY.md && grep -c "Security Posture" SECURITY.md && grep -c "pull_request_target" SECURITY.md` | Yes — file existence + content checks |
| 06-02 | T1 | `test -d tests/fixture-app && test ! -d fixture && ls tests/fixture-app/tests/broken-selector.spec.ts && echo "RENAME_OK"` | Yes |
| 06-02 | T2 | `npm run test -- --run src/healer/forbidden-patterns.test.ts && npm run test -- --run src/healer/diff-normalizer.test.ts && echo "TESTS_PASS"` | Yes — real test runner |
| 06-02 | T3 | `gh api repos/Sacharified/playwright-healer-test/contents/.github/workflows/sc1-healer.yml --jq '.content' | base64 -d | grep -c "tests/fixture-app"` | Yes — API round-trip verification |
| 06-03 | T1 | `grep -c "sequenceDiagram" README.md && grep -c "Auto-merge prerequisites" README.md && grep -c "docs/examples/gemini.yml" README.md && echo "README_STRUCTURE_OK"` | Yes — structural content check |
| 06-03 | T2 | `test -f CHANGELOG.md && grep -c "\[Unreleased\]" CHANGELOG.md && grep -c "Keep a Changelog" CHANGELOG.md && echo "CHANGELOG_OK"` | Yes |
| 06-03 | T3 | `git grep -l "pull_request_target" -- ':!.planning/' ':!node_modules/' ':!SECURITY.md' ':!CONTRIBUTING.md' ':!docs/' | grep -v "security-lint.yml" | wc -l | xargs -I{} test {} -eq 0 && echo "LINT_CLEAN"` | Yes — real git grep |
| 06-04 | T1 | `test -f docs/auto-merge.md && test -f docs/release-process.md && grep -c "soft-fail" docs/auto-merge.md && grep -c "git tag" docs/release-process.md && echo "DOCS_OK"` | Yes |
| 06-04 | T2 | `test -f docs/examples/ingest.yml && test -f docs/examples/gemini.yml && grep -c "persist-credentials: false" docs/examples/gemini.yml && grep -c "Sacharified/playwright-healer@v1" docs/examples/gemini.yml && echo "EXAMPLES_OK"` | Yes |
| 06-04 | T3 | `test -f docs/examples/github-models.yml && grep -c "provider: github" docs/examples/github-models.yml && grep -c "model: openai/gpt-4.1" docs/examples/github-models.yml && grep -c "persist-credentials: false" docs/examples/github-models.yml && echo "GITHUB_MODELS_OK"` | Yes |
| 06-05 | T1 | `test -f .github/workflows/self-test.yml && python3 -c "import yaml; yaml.safe_load(open('.github/workflows/self-test.yml'))" && grep -c "playwright-healer-bot" .github/workflows/self-test.yml && grep -c "tests/fixture-app" .github/workflows/self-test.yml && echo "SELF_TEST_OK"` | Yes — YAML parse + content check |
| 06-05 | T2 | `test ! -f .github/workflows/e2e-heal-self.yml && test -f .github/workflows/self-test.yml && echo "PROMOTION_COMPLETE"` | Yes |
| 06-06 | T1 | `test -f CHANGELOG.md && grep -c "\[0.1.0\]" CHANGELOG.md && grep "\[Unreleased\]" CHANGELOG.md && echo "CHANGELOG_PREPARED"` | Yes |
| 06-06 | T3 | `git ls-remote --tags origin | grep -c "refs/tags/v0.1.0" && gh release view v0.1.0 --json isDraft --jq '.isDraft | not' && echo "RELEASE_LIVE"` | Yes — remote state verification |

All automated verify commands are real tool invocations with observable exit codes. No echo-only fakes found.

---

## Check 5: D-decision compliance

**Status: PASS with WARNING — Issue #1 (D-09 gap)**

| Decision | Implementing Plan(s) | Compliant? | Notes |
|----------|---------------------|------------|-------|
| D-01 (tag now, not gated on SC#2) | 06-06 T3 | Yes | Tag created in 06-06 T3 regardless of SC#2 live demo status; D-03 captured as best-effort only |
| D-02 (rename to tests/fixture-app) | 06-02 T1 | Yes | `git mv fixture tests/fixture-app` |
| D-03 (best-effort live demo) | 06-06 T2 checkpoint + docs/auto-merge.md §6 | Yes | Soft-reference in docs/auto-merge.md; not a blocker |
| D-04 (visibility flip with pre-flight) | 06-01 + 06-06 T2 | Yes | Pre-flight in 06-01 (gitleaks, SECURITY.md, CONTRIBUTING.md); flip in 06-06 T2 checkpoint; 7-check pre-flight in 06-06 T1 |
| D-05 (README + docs/auto-merge.md) | 06-03 T1 + 06-04 T1 | Yes (WARNING) | README correctly planned as 11-section doc per D-05; docs/auto-merge.md created in 06-04 T1. WARNING: section 8 anchor name ambiguity — see Issue #2 |
| D-06 (TWO examples: Gemini + GitHub Models) | 06-04 T2 + T3 | Yes | gemini.yml in T2, github-models.yml in T3. ingest.yml also in T2 as shared snippet |
| D-07 (manual Keep a Changelog) | 06-03 T2 + 06-06 T1 | Yes | [Unreleased] in Wave 2; [Unreleased]→[0.1.0] promotion in Wave 4 |
| D-08 (SECURITY.md two sections) | 06-01 T2 | Yes | Both sections explicitly specified: "Reporting a Vulnerability" + "Security Posture" |
| D-09 (file hierarchy) | All 6 plans | WARNING | All D-09 files covered EXCEPT .github/workflows/ingest.yml — see Issue #1 |

---

## Check 6: Anti-patterns

**Status: PASS**

Checked across all 6 plans:

- **Vague tasks**: No vague tasks found. All tasks specify exact files, commands, and source material in `read_first`. Actions reference specific line numbers and grep patterns.
- **Missing key_files/requirements arrays**: All plans have `requirements` and `key_links` frontmatter populated.
- **Bash/Write/Edit grants to agent**: Not applicable to this phase — Phase 6 plans have no LLM agent invocations. All tasks are human-executor tasks (the Phase 06 executor is Claude Code, not the healer agent). The plans correctly use `type="auto"` for Claude Code tasks, not agent-loop tasks. No security concern.
- **echo-only verification**: Confirmed clean in Check 4.
- **Missing read_first directives**: All tasks specify relevant files to read first, including action.yml for input name validation.

---

## Check 7: Goal achievement — can a verifier confirm the phase goal holistically?

**Status: PASS (with warning for Issue #1)**

**Phase goal:** "A new consumer can adopt playwright-healer in one PR by copying example workflows from the README; the repo has an immutable version tag, a self-test CI workflow, and a SECURITY.md; all prior work is packaged for public consumption."

Goal decomposed into 4 truths:

**Truth 1: Consumer can adopt in one PR by copying example workflows from the README.**
- README §Quick Start (06-03 T1) references docs/examples/gemini.yml as step 1.
- docs/examples/gemini.yml (06-04 T2) is a complete copy-paste heal workflow.
- docs/examples/ingest.yml (06-04 T2) is the ingest snippet to paste into existing CI.
- The three-step copy path (ingest snippet + heal workflow + secrets) is explicitly planned in 06-03 T1 §Quick Start.
- Verifier can confirm with: `test -f docs/examples/gemini.yml && grep "Sacharified/playwright-healer@v1" docs/examples/gemini.yml`.
- **PASS**

**Truth 2: Repo has an immutable version tag (v0.1.0 + v1 alias).**
- 06-06 T3 creates both tags with the exact commands from RESEARCH.md §R-02.
- v1 alias SHA verification included: `test "$V0_SHA" = "$V1_SHA"`.
- Verifier can confirm with: `git ls-remote --tags origin | grep -E "refs/tags/v0.1.0|refs/tags/v1$"`.
- **PASS**

**Truth 3: Repo has a self-test CI workflow (PKG-04).**
- 06-05 T1 creates self-test.yml with push/PR/workflow_dispatch triggers.
- Verifier can confirm with: `test -f .github/workflows/self-test.yml && grep "push:" .github/workflows/self-test.yml`.
- **PASS**

**Truth 4: SECURITY.md exists with vulnerability reporting process.**
- 06-01 T2 creates SECURITY.md with both required D-08 sections.
- Verifier can confirm with: `grep -c "Reporting a Vulnerability" SECURITY.md`.
- **PASS**

**Overall goal achievement: PASS** — the 4 goal truths are fully traceable to specific plan tasks. The D-09 gap (Issue #1) does not prevent goal achievement because none of PKG-03..05 or DOC-01..05 requires the dogfood ingest workflow. However, D-09 is a locked decision enumerating it as a deliverable, which requires a resolution.

---

## Issues Found (Revision Required)

### Issue #1 — WARNING (blocker-class context compliance): .github/workflows/ingest.yml listed in locked D-09 hierarchy has no covering plan task

**Dimension:** context_compliance
**Severity:** warning (blocker-class — D-09 is a locked decision)

D-09 CONTEXT.md explicitly lists the following in the Phase 6 file hierarchy as a locked deliverable:

```
.github/workflows/
  self-test.yml          <- D-02 promoted from e2e-heal-self.yml   [covered by 06-05]
  ingest.yml             <- our own dogfood-ingest workflow         [NOT COVERED by any plan]
  security-lint.yml      <- existing — keep                         [existing, no action needed]
```

None of the 6 plans' `files_modified` arrays include `.github/workflows/ingest.yml`. None of the plans' task actions mention creating a dogfood ingest workflow for the playwright-healer repo itself.

Note: `docs/examples/ingest.yml` (created in 06-04 T2) is the copy-paste consumer snippet. `.github/workflows/ingest.yml` is the playwright-healer repo's own ingest workflow — eating its own dog food by collecting stats from its own `tests/fixture-app/` test runs. These are two distinct artifacts; D-09 requires both.

**Impact:** None of PKG-03..05 or DOC-01..05 specifically mandates this file, so the phase goal is achievable without it. However, D-09 is a locked decision from /gsd-discuss-phase and explicitly enumerates this file. The orchestrator must choose: add a task to cover it, or update D-09 to defer it.

```yaml
issue:
  plan: null  # no plan currently covers this
  dimension: context_compliance
  severity: warning
  description: ".github/workflows/ingest.yml listed in locked D-09 file hierarchy has no covering plan task"
  d09_entry: "ingest.yml <- our own dogfood-ingest workflow"
  fix_hint: "Option A: Add task to 06-05 (2 tasks, Wave 3, .github/workflows/ directory, same dependency profile). Option B: Update D-09 in CONTEXT.md to mark .github/workflows/ingest.yml as deferred to v0.1.1."
```

---

### Issue #2 — WARNING: 06-03 Task 1 §8 anchor name ambiguity — `## Auto-merge` vs `## Auto-merge prerequisites`

**Dimension:** key_links_planned
**Severity:** warning

The plan 06-03 Task 1 action text contains a contradiction about the exact H2 heading text for README section 8:

- D-05 CONTEXT.md section list entry 8 is labeled: **"Auto-merge"** (1-paragraph summary + link to docs/auto-merge.md)
- 06-03 Task 1 action, under §8 Auto-merge, says: "This section MUST include the `## Auto-merge prerequisites` anchor (H2 heading) to preserve the existing link target from pr-writer.ts core.warning text."
- 06-03 `must_haves.truths` says: "README §Auto-merge prerequisites stub anchor preserved (P-06 option a)"
- 06-03 `key_links` says `from: "README.md ##auto-merge-prerequisites"`
- 06-03 Task 1 `automated` verify: `grep -c "Auto-merge prerequisites" README.md`

The problem: if the executor uses `## Auto-merge` as the H2 heading (following D-05's section list), GitHub renders the anchor as `#auto-merge`. But pr-writer.ts `core.warning` links to `README §auto-merge-prerequisites`, which only resolves if the heading text is exactly `## Auto-merge prerequisites` (anchor `#auto-merge-prerequisites`). A wrong heading breaks the link silently.

The automated verify `grep -c "Auto-merge prerequisites" README.md` will catch the error — but only after the executor has already written the wrong content, requiring a rewrite.

```yaml
issue:
  plan: "06-03"
  dimension: key_links_planned
  severity: warning
  task: 1
  description: "Section 8 heading is ambiguous: D-05 labels it 'Auto-merge' but plan requires '## Auto-merge prerequisites' for pr-writer.ts anchor compatibility"
  fix_hint: "In Task 1 action §8 description, prepend the heading constraint prominently before section body description."
```

---

### Issue #3 — WARNING: 06-04 Task 1 read_first has a stale README.md bullet that conflicts with Wave 2 parallel execution

**Dimension:** dependency_correctness (Wave 2 parallel-read fragility)
**Severity:** warning

06-04 Task 1 `read_first` currently has two bullets relevant to the auto-merge prerequisites content source:

Line 86: `- 06-PATTERNS.md §docs/auto-merge.md — what to lift from current README lines 3–16`

Line 88: `- README.md current content lines 3–16 (the auto-merge prerequisites — this content moves to docs/auto-merge.md)`

06-03 and 06-04 are in the same Wave 2 (parallel). 06-03 Task 1 replaces README.md wholesale. If 06-04 Task 1 executes after 06-03 T1 runs (or in the same session), "README.md current content lines 3–16" will be the new README content — not the old Phase 5 stub with the four prerequisites bullets. Reading the new README for this content would yield the redirect sentence (P-06 option a), creating a docs/auto-merge.md §Required repository settings with circular content instead of the four actual prerequisites.

The fix is simple: 06-PATTERNS.md §docs/auto-merge.md is already in the read_first (line 86) and is a stable, session-invariant source. Line 88 (README.md) is the problematic duplicate that points at a moving target.

```yaml
issue:
  plan: "06-04"
  dimension: dependency_correctness
  severity: warning
  task: 1
  description: "Task 1 read_first line 88 instructs reading README.md lines 3-16 for auto-merge prerequisites, but 06-03 running in parallel in Wave 2 replaces README.md. The stable source (06-PATTERNS.md §docs/auto-merge.md) is already listed at line 86."
  fix_hint: "Remove line 88 (README.md current content lines 3-16) from read_first. Update line 86 to clarify it is the primary stable source, e.g.: '06-PATTERNS.md §docs/auto-merge.md — use this as primary source for the four prerequisites bullets (do NOT read README.md for this; 06-03 replaces it in Wave 2 in parallel).'"
```

---

### Issue #4 — INFO: 06-01 frontmatter claims PKG-03 but only delivers a PKG-03 prerequisite

**Dimension:** requirement_coverage (frontmatter accuracy)
**Severity:** info

06-01 frontmatter lists `PKG-03` in its `requirements` array. PKG-03 is "The repo publishes at least one immutable version tag." 06-01 creates .gitleaks.toml, SECURITY.md, CONTRIBUTING.md — security pre-flight, not tags. Actual PKG-03 delivery is 06-06 Task 3. All 8 requirements are still covered; this is a frontmatter hygiene issue only.

```yaml
issue:
  plan: "06-01"
  dimension: requirement_coverage
  severity: info
  description: "06-01 frontmatter claims PKG-03 but delivers PKG-03 prerequisite (security pre-flight). Actual PKG-03 delivery is 06-06 Task 3."
  fix_hint: "Remove PKG-03 from 06-01 frontmatter requirements array or annotate as 'PKG-03 prerequisite'. 06-06 correctly claims PKG-03."
```

---

## Revision List

EXACT changes needed in specific PLAN.md files for the orchestrator to apply. Do not modify PLAN.md files directly.

### Revision R-1 (Issue #1 — D-09 ingest.yml gap) — ORCHESTRATOR MUST CHOOSE OPTION

**Option A — Add task to 06-05 (preferred: same directory, same dependency profile, only 2 tasks currently):**

In `/Users/sacha/dev/playwright-healer/.planning/phases/06-documentation-release/06-05-PLAN.md`:

1. Add `.github/workflows/ingest.yml` to `files_modified` array in frontmatter.
2. Change `task_count: 2` to `task_count: 3`.
3. Add a new Task 3 (type="auto") at the end of `<tasks>`:

```xml
<task type="auto">
  <name>Task 3: Create .github/workflows/ingest.yml (dogfood ingest workflow)</name>

  <read_first>
    - docs/examples/ingest.yml (created in 06-04 Task 2) — structural base to adapt
    - 06-CONTEXT.md §D-09 — hierarchy entry: "ingest.yml <- our own dogfood-ingest workflow"
    - action.yml — confirm exact input names for mode: ingest
    - tests/fixture-app/playwright.config.ts — confirm report output path for report_path input
  </read_first>

  <files>.github/workflows/ingest.yml</files>

  <action>
Create `.github/workflows/ingest.yml` — the playwright-healer repo's own dogfood ingest workflow.
This is a complete workflow (not a snippet), adapted from docs/examples/ingest.yml for this repo's specific paths.

Key differences from docs/examples/ingest.yml:
- This IS a complete workflow file, not a job-step snippet
- Trigger: push: branches: [main] (runs after every merge, collecting self-test stats)
- report_path: tests/fixture-app/playwright-report/ (this repo's fixture runner output)
- healer_token: ${{ secrets.HEALER_PAT }} (same PAT used by self-test.yml)
- Demonstrate "eating our own dog food" — playwright-healer ingesting stats from its own self-tests

The workflow should depend on the self-test completing first (use needs: [self-test-job-name] if in same workflow, or trigger on workflow_run if separate). Check whether e2e-heal-self.yml already has a report upload step — if not, a basic upload-artifact step should be added for the artifact this ingest workflow will consume.

Note: If adding the upload-artifact step to self-test.yml is complex, a minimal implementation is acceptable: create ingest.yml as a workflow_dispatch-triggered proof-of-concept with a comment explaining the full automation is a v0.1.1 enhancement.
  </action>

  <verification>
    <automated>test -f .github/workflows/ingest.yml && grep -c "mode: ingest" .github/workflows/ingest.yml && echo "DOGFOOD_INGEST_OK"</automated>
    <human-verify>
      1. Verify the workflow uses tests/fixture-app/ paths (not the generic placeholder paths from docs/examples/ingest.yml).
      2. Verify mode: ingest is present in the with: block.
      3. Confirm the workflow does not reference the private playwright-healer-test repo.
    </human-verify>
  </verification>

  <done>
    - .github/workflows/ingest.yml exists as a complete workflow
    - mode: ingest present in with: block
    - report_path references tests/fixture-app/ (this repo's fixture output)
    - Trigger is push: branches: [main] or workflow_run targeting self-test
  </done>
</task>
```

**Option B — Explicitly defer in CONTEXT.md (lower risk if dogfood ingest integration is complex):**

In `/Users/sacha/dev/playwright-healer/.planning/phases/06-documentation-release/06-CONTEXT.md`, in the D-09 hierarchy block, update the ingest.yml line:

```
  ingest.yml             <- our own dogfood-ingest workflow [DEFERRED to v0.1.1 — not required for PKG-03..05/DOC-01..05; publish docs/examples/ingest.yml as the consumer template; dogfood integration requires self-test report-upload wiring]
```

Recommend Option B if the self-test report artifact upload integration is uncertain. Recommend Option A if the dogfood story strengthens v0.1.0.

---

### Revision R-2 (Issue #2 — Anchor name ambiguity in 06-03 Task 1)

In `/Users/sacha/dev/playwright-healer/.planning/phases/06-documentation-release/06-03-PLAN.md`, Task 1 action, in the `**Section structure (D-05):**` block, find section 8:

**Find:**
```
8. **Auto-merge** — 1-paragraph summary + link to docs/auto-merge.md. This section MUST include the `## Auto-merge prerequisites` anchor (H2 heading) to preserve the existing link target from pr-writer.ts core.warning text.
```

**Replace with:**
```
8. **Auto-merge prerequisites** — H2 heading MUST be exactly `## Auto-merge prerequisites` (NOT `## Auto-merge`).
   GitHub renders `## Auto-merge prerequisites` as anchor `#auto-merge-prerequisites`, which matches the pr-writer.ts core.warning link target. Using `## Auto-merge` renders anchor `#auto-merge` and breaks the link silently.
   Body: 1-paragraph summary of auto-merge + "For full prerequisites, trust-gate conditions, and troubleshooting, see [docs/auto-merge.md](docs/auto-merge.md)."
```

---

### Revision R-3 (Issue #3 — Wave 2 parallel-read fragility in 06-04 Task 1)

In `/Users/sacha/dev/playwright-healer/.planning/phases/06-documentation-release/06-04-PLAN.md`, Task 1 `read_first` block:

**Find (line 86 of plan file):**
```
    - 06-PATTERNS.md §docs/auto-merge.md — what to lift from current README lines 3–16
```

**Replace with:**
```
    - 06-PATTERNS.md §docs/auto-merge.md — PRIMARY SOURCE for the four auto-merge prerequisites bullets. Use this, not README.md: 06-03 runs in parallel in Wave 2 and replaces README.md with the new 11-section document. The four prerequisites bullets will NOT be at lines 3–16 after 06-03 runs.
```

**Find (line 88 of plan file):**
```
    - README.md current content lines 3–16 (the auto-merge prerequisites — this content moves to docs/auto-merge.md)
```

**Delete this line entirely.** The content it referenced is stably preserved in 06-PATTERNS.md §docs/auto-merge.md (now the explicit primary source above).

---

### Revision R-4 (Issue #4 — 06-01 frontmatter PKG-03 claim — optional)

In `/Users/sacha/dev/playwright-healer/.planning/phases/06-documentation-release/06-01-PLAN.md`, frontmatter:

**Find:**
```yaml
requirements:
  - PKG-03
  - DOC-05
```

**Replace with (optional):**
```yaml
requirements:
  - DOC-05
  # Note: PKG-03 delivery is in 06-06 Task 3 (tag creation). This plan delivers PKG-03 prerequisites only.
```

This is informational only — not required for phase execution.

---

## Summary Table

| Check | Status | Issues |
|-------|--------|--------|
| 1. Coverage | PASS | — |
| 2. Wave safety | PASS | — |
| 3. Dependency correctness | PASS | Informational: 06-05 over-constrained dependency |
| 4. Verification gates | PASS | — |
| 5. D-decision compliance | PASS (warning) | Issue #1: D-09 ingest.yml gap |
| 6. Anti-patterns | PASS | — |
| 7. Goal achievement | PASS (warning) | Issue #1: D-09 gap (does not block goal achievement) |

**Required revisions before execution:** R-2 and R-3 (Issues #2 and #3) — concrete failure paths.

**Must decide before execution:** R-1 (Issue #1) — orchestrator chooses Option A (add dogfood ingest task to 06-05) or Option B (defer to v0.1.1 in CONTEXT.md).

**Optional:** R-4 (Issue #4) — frontmatter cosmetic only.
