---
phase: 06-documentation-release
created: 2026-05-03
status: ready_for_research
phase_goal: A new consumer can adopt playwright-healer in one PR by copying example workflows from the README; the repo has an immutable version tag, a self-test CI workflow, and a SECURITY.md; all prior work is packaged for public consumption (mapped to PKG-03/04/05 + DOC-01/02/03/04/05 in REQUIREMENTS.md)
canonical_refs:
  - .planning/PROJECT.md
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
  - .planning/phases/05-auto-merge/05-CONTEXT.md (D-10 — Phase 5 ships the README §auto-merge-prerequisites stub; Phase 6 expands it into docs/auto-merge.md)
  - .planning/phases/05-auto-merge/05-03-UAT-EVIDENCE.md (Phase 6 release prerequisites — live SC#2 + T-05-06 demo, fixture-tier discussion)
  - .planning/phases/03.1-first-heal-end-to-end-demo/03.1-VERIFICATION.md (the canonical end-to-end demo this phase will package as the "example workflow it does")
  - .planning/phases/01-security-scaffold-composite-packaging/01-CONTEXT.md (composite-action packaging decision, Node 24 ncc-incompatibility — the why behind the npm-ci-at-runtime model documented in DOC-04)
  - README.md (current Phase 5 stub — Phase 6 expands)
  - .github/workflows/e2e-heal-self.yml (existing self-test scaffolding, promote to self-test.yml per PKG-04)
  - fixture/ (existing in-repo fixture, moves to tests/fixture-app/ per D-02 below)
---

# Phase 06: Documentation + Release — Context

## Phase Goal

> A new consumer can adopt playwright-healer in one PR by copying example workflows from the README; the repo has an immutable version tag, a self-test CI workflow, and a SECURITY.md; all prior work is packaged for public consumption.

Maps to ROADMAP success criteria SC#1–4 and requirements PKG-03/PKG-04/PKG-05/DOC-01/DOC-02/DOC-03/DOC-04/DOC-05.

This is the **release phase** — the goal is not a new capability but to take the work from Phases 1–5 and make it consumable. Three deliverables: (a) docs that let an external Playwright project adopt the action in one PR under 15 min, (b) packaging artifacts (immutable tag, self-test workflow, SECURITY.md, CHANGELOG), (c) closing Phase 5's deferred live SC#2 / T-05-06 evidence as a release-readiness checklist item.

## Locked Decisions

### D-01: Release strategy — `v0.1.0` immutable + moving `v1` alias, ship NOW (do not gate on SC#2 live demo)

Tag strategy mirrors `actions/checkout`: an immutable `v0.1.0` tag for the SHA-pinned consumer + a moving `v1` alias that consumers can pin for "latest 0.1.x" stability. v0.1.0 ships as soon as Phase 6 deliverables land — not gated on closing Phase 5's deferred live SC#2 / T-05-06 demo, because:

1. SC#2 is verified mathematically by Plan 05-02 Test IN2 + the gate's defense-in-depth contract (D-02/D-07/D-08 all unit-tested).
2. The CHANGELOG entry for v0.1.0 explicitly documents the deferral (see D-07 below) so consumers know auto-merge live demo evidence comes in v0.1.1 once the public-fixture flow lands.
3. Gating release on a live demo would couple the release timeline to fixture-tier upgrades — that's not a v0.1.0 must-have; it's a v0.1.x polish item.

Tag-day mechanics: the `v1` alias is created via `git tag -f v1 <SHA-of-v0.1.0>` and pushed with `--force`. Going forward, every `0.1.x` patch tag also re-points `v1`. Documented in CHANGELOG and a `docs/release-process.md` (one-pager).

### D-02: Self-test fixture — move existing `fixture/` → `tests/fixture-app/`, promote `e2e-heal-self.yml` → `self-test.yml`

The in-repo fixture chosen over alternatives (cross-repo dispatch via `Sacharified/playwright-healer-test`, separate public fixture repo, Pro-tier upgrade). Rationale: most isolated, no cross-repo PAT dance, single repo to maintain, and the existing `fixture/` directory + `e2e-heal-self.yml` workflow already implement this pattern — we promote rather than rebuild.

Concrete moves:
- `fixture/` → `tests/fixture-app/` (rename for naming consistency with `tests/_helpers/`, `tests/unit/`, `tests/integration/`, `tests/fixtures/`).
- All path references updated: `e2e-heal-self.yml`, `Sacharified/playwright-healer-test:.github/workflows/sc1-healer.yml`, README examples, any test code.
- `e2e-heal-self.yml` is renamed to `.github/workflows/self-test.yml` and runs on `push: branches: [main]` + `pull_request` (against feature branches that touch the action surface). Manual `workflow_dispatch` retained for ad-hoc use.
- Existing test setup that the heal step expects (`scripts/start-fixture.sh`, secrets layout) follows the rename.

### D-03: Live SC#2 + T-05-06 demo runs against THIS REPO after going public — captured as release prerequisite, not Phase 6 blocker

Once D-04 (going public) is done and branch protection is enabled on `main`, the `self-test.yml` workflow + a one-shot dispatch with `enable_auto_merge: true` provides the live SC#2 evidence Phase 5 deferred. Captured in `tests/fixture-app/uat-evidence-live-auto-merge.md` (parallel to `05-03-UAT-EVIDENCE.md` shape) and linked from the v0.1.0 CHANGELOG entry.

If the live demo can't be captured before tag-day for any reason, v0.1.0 still ships and the demo lands in v0.1.1 — see D-01.

### D-04: Make `Sacharified/playwright-healer` PUBLIC as part of Phase 6 (early task, with security pre-flight)

Implicit prerequisite for PKG-03 / PKG-05: external consumers cannot `uses: Sacharified/playwright-healer@v1` from their own repos if the source is private without a PAT-backed checkout fallback (the Phase 03.1 subpath workaround), which is operationally awkward and contradicts "consumer adopts in one PR under 15 minutes" (SC#1).

Going public also unlocks free-tier branch protection + `allow_auto_merge` on this repo, which is what enables D-03's live SC#2 demo.

**Security pre-flight required BEFORE the visibility flip** (early task in Phase 6):
1. `git log` audit for any accidentally-committed secrets, paths, or internal references (use `git secrets` or `trufflehog`).
2. `.planning/` directory review — anything that should not be public (private workflow notes, partner names, etc.). The `.planning/` directory itself is fine to ship; it's documentation. But individual files need a sanity-check pass.
3. README NOTICES already on file: any internal Sacharified-only commentary that should be removed.
4. `.gitattributes` and `.gitignore` audit (sometimes the patterns differ between private and public expectations).
5. Confirm `Sacharified/playwright-healer-test` (the Phase 03.1 fixture) is OK to either stay private or become public. If it stays private, the v0.1.0 README's example workflows do NOT reference it (they reference fictional consumer repos). If it goes public, README can link to it as a worked example.

The pre-flight task lands BEFORE the visibility flip in the plan order. The flip itself is a single step (Settings → Danger Zone → Change visibility). Branch protection and `allow_auto_merge` are configured immediately after the flip via `gh api repos/.../branches/main/protection` and `gh api repos/... -X PATCH -F allow_auto_merge=true`.

### D-05: README structure — single README + `docs/auto-merge.md` companion

README is the adoption surface (DOC-01/02/03/04). One detailed companion file under `docs/` — `docs/auto-merge.md` — for the auto-merge prerequisite matrix that's too long for the main README (Phase 5 D-10 stub gets fully expanded into this file: branch-protection requirements, repo settings, PAT scopes, soft-fail behavior, troubleshooting matrix).

README sections (PKG-05 enabling SC#1's "one PR under 15 minutes"):
1. **What it is** (1 paragraph + 1-line value)
2. **Quick start** (the 1-PR adoption path: copy ingest workflow, copy heal workflow, add 2 secrets, push)
3. **Architecture** (DOC-01 sequence diagram: ingest → state branch → threshold breach → dispatch → heal → PR)
4. **Prerequisites** (DOC-03 prominent callout: Playwright `trace: 'on'` or `retain-on-failure`, `upload-artifact` step, `actions: write` OR `healer_token` PAT)
5. **Token scopes & why GITHUB_TOKEN doesn't work** (DOC-04 with explicit citation of GitHub's recursion guard for bot-opened PRs not triggering downstream CI — this is the most-asked question)
6. **Example workflows** (DOC-02: see D-06 below for provider matrix)
7. **Switching providers** (1-section subsection summarizing the four providers + 1-line input diff per provider, links to per-provider configuration)
8. **Auto-merge** (1-paragraph summary + link to `docs/auto-merge.md` for full matrix)
9. **Troubleshooting** (5-7 entries: heal step OOM, agent fix rejected by diff-lint, validation failures, PR not opening, auto-merge soft-fail)
10. **Roadmap** (1 paragraph: what's coming in v0.1.x and v0.2)
11. **Contributing & Security** (1-line links to `CONTRIBUTING.md` and `SECURITY.md`)

`docs/auto-merge.md` companion structure:
- Why auto-merge is opt-in
- Required repo settings (branch protection, allow auto-merge, allow squash merging, healer_token PAT scopes)
- Reasoning band format (the four conditions + outcome row)
- Soft-fail behavior matrix (which GitHub error → which `core.warning` text)
- T-05-06 SKIP_SENTINEL preservation explanation
- Link to live demo evidence file from D-03

### D-06: Example workflows — TWO providers, Gemini default + GitHub Models gpt-4.1

Ships two example workflow pairs (ingest + heal):

1. **`docs/examples/gemini.yml`** (default — recommended in README's Quick Start because Gemini 2.5 Flash is free-tier, used in Phase 03.1 demo, and produces successful selector heals at $0.03–$0.05/run)
2. **`docs/examples/github-models.yml`** (alternative — also free tier, GitHub-native auth, recommended for "I already use GitHub Models for other things")

Anthropic claude-sonnet-4-6 + Ollama get a "Switching providers" subsection in the main README that shows the input diff (just `provider:`, `model:`, `api_key:` change). No standalone example file for them — the diff is small enough to fit inline in README.

Rationale: the user picked option B over options C (full matrix) and A (single example). Two examples is the right balance — shows that provider choice matters but doesn't drown the README in alternatives.

### D-07: CHANGELOG.md follows Keep a Changelog format with manual entries

Manual entries under `[Unreleased]` / `[0.1.0]` sections. Stable URL anchors. The v0.1.0 entry highlights:
- Two-workflow ingest + dispatch + heal pipeline (Phases 1–4)
- Auto-merge gate (Phase 5)
- Multi-provider support (Anthropic, Gemini, GitHub Models, Ollama)
- Default-OFF safety on auto-merge + auto-dispatch + threshold detection
- **Deferred items called out explicitly:**
  - Live SC#2 / T-05-06 auto-merge happy-path demo evidence (lands in v0.1.1 once D-03 demo is captured against the public repo)
  - App-code fix capability (deferred to v0.2 per Phase 5 CONTEXT)
  - v2 trace-aware confidence bands (deferred per Phase 5 CONTEXT, REQUIREMENTS TRC-03)
- Link to `docs/release-process.md` for the v1-alias mechanics

Auto-generation tooling (release-please, semantic-release) NOT used. The user's commit history follows a `feat(NN-MM): ...` / `fix(NN-MM): ...` / `docs(NN-MM): ...` convention (per Wave 1/2/3 commits in Phases 1–5), but mapping these phase-numbered scopes to user-facing release notes adds a tooling translation layer that isn't worth the dependency for v0.1.0.

### D-08: SECURITY.md — vulnerability reporting + brief threat-model summary

Two sections:
1. **Reporting a vulnerability** — email or GitHub Security Advisories (private vulnerability reporting), 90-day responsible disclosure window, no bug bounty for v0.1.x.
2. **Security posture summary** — 1–2 paragraphs covering:
   - Defense-in-depth gates: diff-lint (FIX-06) blocks `waitForTimeout`, positional selectors, weakened assertions, files outside test directory; auto-merge gate (Phase 5) is a second layer enforcing the same boundaries
   - Tool-naming contract D-13: `mcp__playwright__*` literals never inlined in source (audit invariant, not just docs)
   - SSOT D-17: shared allow-lists exported from `src/healer/forbidden-patterns.ts`, never duplicated
   - Dispatch contract D-18: Zod-validated payload at action boundary; no implicit-undefined inputs
   - `pull_request_target` trigger never used (PIT-04 binding constraint)
   - Allowed-tools list explicitly `["mcp__playwright__*", "Read", "Grep", "Glob"]` — adapters may rename per provider syntax but never grant `Bash`/`Write`/`Edit`
   - PAT scopes documented + `GITHUB_TOKEN` recursion guard explanation cross-referenced

Full threat model lives in `.planning/phases/01-security-scaffold-composite-packaging/01-CONTEXT.md` and per-phase SECURITY.md files; SECURITY.md ships the summary, not the source.

### D-09: Documentation hierarchy & file conventions

```
README.md                       <- adoption surface (DOC-01/02/03/04, PKG-05)
CHANGELOG.md                    <- DOC-05 (Keep a Changelog)
SECURITY.md                     <- DOC-05 (vuln reporting + posture summary)
CONTRIBUTING.md                 <- 1-pager: phase-numbered commits, GSD workflow note, PR review expectations
docs/
  auto-merge.md                 <- D-05 companion (Phase 5 D-10 stub expanded)
  release-process.md            <- D-01/D-07 mechanics + v1-alias workflow
  examples/
    gemini.yml                  <- D-06 default
    github-models.yml           <- D-06 alternative
    ingest.yml                  <- shared ingest workflow snippet (referenced by both heal examples)
.github/workflows/
  self-test.yml                 <- D-02 promoted from e2e-heal-self.yml
  ingest.yml                    <- our own dogfood-ingest workflow (eats own dog food on this repo's tests/)
  security-lint.yml             <- existing — keep
tests/fixture-app/              <- D-02 renamed from fixture/
  package.json
  tests/broken-selector.spec.ts
  ...
```

`docs/examples/*.yml` files are the literal copy-paste consumer-facing workflows. README's Quick Start says "copy this file into your `.github/workflows/`" with a one-liner.

## Specifics / "I want it like X" References

- **README Quick Start narrative tone**: like `anthropics/claude-code-action`'s README — practical-detailed, code-snippet-first, prerequisite-callout-prominent. NOT marketing-tone, NOT comparison-table-heavy.
- **DOC-01 sequence diagram format**: Mermaid (renders inline on GitHub, no external image hosting). 6–8 lifelines (Consumer CI, ingest workflow, state branch, threshold evaluator, healer dispatcher, heal workflow, healer agent, GitHub PR API).
- **PKG-04 self-test cadence**: every push to `main` AND every PR that touches files matching `src/**`, `action.yml`, `.github/workflows/self-test.yml`. Skip self-test for docs-only PRs to keep CI minutes manageable.
- **D-04 visibility flip ordering**: pre-flight audit → audit fixes (if any) → CONTRIBUTING.md exists → security-lint passes → SECURITY.md exists → THEN flip. Don't flip before the audit lands.
- **Deferred-from-Phase-5 evidence file location**: `tests/fixture-app/uat-evidence-live-auto-merge.md` — same shape as `.planning/phases/05-auto-merge/05-03-UAT-EVIDENCE.md` so the verification-replay procedure is parallel.

## Out of Scope (Deferred Ideas)

- **App-code fix capability** — Plan 5 deferred; remains deferred. README's "What it does NOT do" section calls this out.
- **v2 trace-aware confidence bands** — Plan 5 deferred; v0.2 work.
- **Plugin/extension API** — not in v0.1.0 scope. README's "Roadmap" section may mention as future direction.
- **Hosted SaaS** — explicitly out of scope per PROJECT.md.
- **Per-test owner @-mentions** — deferred per PROJECT.md.
- **Multi-language support (Cypress, Playwright Python)** — out of scope per PROJECT.md.
- **Release-please / semantic-release CHANGELOG auto-generation** — D-07 ship manual; revisit in v0.2 if release cadence increases.
- **Full SECURITY-AUDIT.md threat model in repo root** — D-08 ships summary; the full doc stays in `.planning/`.
- **Translated README (i18n)** — v0.1.0 is English-only.
- **GIF/video walkthrough in README** — v0.1.0 is text + Mermaid only; videos are a v0.1.x polish item.
- **Public roadmap site / project board** — not v0.1.0; CHANGELOG + REQUIREMENTS.md are sufficient.

## Phase 6 Critical Pitfalls (carry into Research)

These are pitfall-class items the researcher should investigate:

1. **Going-public secret-leakage risk** — `git secrets` / `trufflehog` audit before flip. Phase 03.1 verification noted secrets transit via `INPUT_*` env; verify nothing leaked into commit messages or test fixtures. (Spike if uncertain.)
2. **Moving `v1` tag and stale Action caches** — GitHub Actions caches resolved actions. After re-pointing `v1`, some consumer caches may serve stale code. Document the cache-invalidation expectation in `docs/release-process.md`.
3. **`fixture/` → `tests/fixture-app/` rename impacts cross-repo workflow** — `Sacharified/playwright-healer-test:.github/workflows/sc1-healer.yml` references `fixture/tests/broken-selector.spec.ts`. Update both repos in lockstep, OR keep a redirect/symlink for the deprecation window.
4. **Self-test workflow on PR + auto-dispatch loop risk** — if `self-test.yml` runs on PRs and the action's own ingest workflow runs on push, an auto-dispatch loop is theoretically possible. Verify SEC-05 sentinel (`[skip-healer]` in commits, fork-PR / bot-author exclusion) covers this case for in-repo execution too. May need an explicit `if: github.actor != 'playwright-healer-bot'` guard on `self-test.yml`.
5. **Mermaid diagram rendering quirks on GitHub** — recent renderer changes can break otherwise-valid Mermaid. Validate the DOC-01 diagram source on the public repo BEFORE tag day; consider an SVG fallback link.
6. **`docs/auto-merge.md` link targets from `core.warning`** — Phase 5 emits `see README §auto-merge-prerequisites`. After D-05's split, the link target moves from README to `docs/auto-merge.md`. Either: (a) keep an anchor stub `## Auto-merge prerequisites` in README that links to `docs/auto-merge.md`, OR (b) update the `core.warning` text to point at `docs/auto-merge.md` directly. Option (a) is non-breaking (existing v0.1.0 builds keep working); option (b) requires a code change.
7. **CHANGELOG `[Unreleased]` vs `[0.1.0]` ordering at tag time** — Keep a Changelog convention: `[Unreleased]` at top, then `[0.1.0]` etc. Tag-day mechanics: move all `[Unreleased]` entries to `[0.1.0]` block, then re-create empty `[Unreleased]`. Document in `docs/release-process.md`.

## Open Items for Research Phase

The phase-researcher should produce a RESEARCH.md covering:

1. **Visibility-flip security audit** — concrete `git secrets` / `trufflehog` invocation + acceptance criteria. What patterns to scan, what's known-OK, exit criteria.
2. **`docs/release-process.md` exact mechanics** — the v0.1.0 + v1 tag-creation script, plus the future v0.1.1 mechanics (tag patch, re-point v1).
3. **Mermaid sequence diagram literal source** — DOC-01 lifelines + interaction list, ready for the README writer to lift directly. Verify renders correctly on GitHub.
4. **`self-test.yml` post-rename shape** — concrete YAML, including SEC-05 guards from pitfall 4 above.
5. **GitHub Models vs Gemini cost/quality matrix in 2026-05** — confirm the README's "default Gemini, alternative GitHub Models" framing is still accurate. Spot-check both providers for recent breaking changes.
6. **CHANGELOG v0.1.0 entry draft** — pre-write the bulleted release notes from each phase's SUMMARY/VERIFICATION; the planner can refine, but having a draft accelerates plan-writing.
7. **`fixture/` → `tests/fixture-app/` rename impact map** — full grep across this repo + the fixture repo to identify every reference. Plan estimates one task per affected location.

CONTEXT.md is finalized. Researcher consumes this and produces RESEARCH.md → Planner consumes both and produces PLAN.md files.
