---
plan_id: 06-06
plan_name: release
phase: 06-documentation-release
status: complete
completed: 2026-05-04
key-files:
  created: []
  modified:
    - CHANGELOG.md
key-links:
  - from: v0.1.0 tag
    to: GitHub Release
    via: gh release create v0.1.0 --notes-file
    verified: true
  - from: v1 tag
    to: v0.1.0 SHA
    via: git tag v1 v0.1.0 (lightweight alias for first release)
    verified: true
  - from: CHANGELOG.md [0.1.0]
    to: GitHub Release notes
    via: awk extraction of [0.1.0] section piped to gh release create --notes-file
    verified: true
  - from: Sacharified/playwright-healer-test sc1-healer.yml
    to: v1 tag
    via: gh api PUT updating ref main → v1
    verified: true
---

# 06-06 Release — Summary

## Outcome

playwright-healer **v0.1.0** is publicly released:
- Repo: https://github.com/Sacharified/playwright-healer (visibility = public)
- Release: https://github.com/Sacharified/playwright-healer/releases/tag/v0.1.0
- Tags: `v0.1.0` (annotated), `v1` (alias)
- Both tags point to merge commit `77dc63678cc9f2942a843a51e07913c1e0d176d8`

## Sequence executed

| # | Op | Outcome |
|---|----|---------|
| 1 | CHANGELOG.md `[Unreleased]` → `[0.1.0] - 2026-05-04` | committed (`17366e5`) |
| 2 | Push feature branch to origin | pushed |
| 3 | PR #12 opened: feature → main | open then merged |
| 4 | PR #12 merge to main | merge commit `77dc6367` |
| 5a | `git tag -a v0.1.0` | annotated tag at `800f43d` → `77dc6367` |
| 5b | `git tag v1 v0.1.0` (alias, no `--force` needed for first release) | lightweight tag at `800f43d` |
| 5c | `git push origin v0.1.0 v1` | both tags on origin |
| 6 | Visibility flip private → public | done by user via UI/terminal (runtime gated) |
| 7a | Branch protection on main | **skipped** — runtime denied permissive config (no required checks/reviews); user to configure via UI if needed |
| 7b | `allow_auto_merge: true` | enabled via `gh api -X PATCH` |
| 8 | `gh release create v0.1.0 --notes-file /tmp/release-notes.md` | published (not draft) |
| 9 | Cross-repo `Sacharified/playwright-healer-test/.github/workflows/sc1-healer.yml`: `ref: main` → `ref: v1` | committed (`c432e6f`) |

## CI fixes applied during release (PR #12)

The release surfaced four pre-existing CI failures, none introduced by phase 6 plans 01–05 but blocking the merge gate. All four landed in PR #12 before merge:

| Fix | Commit | What |
|-----|--------|------|
| Check 3a auth header | `030221c` | `git fetch origin main` failed on private repo + `persist-credentials: false`. Added inline `Authorization: Basic` header (not persisted). SEC-01 invariant preserved. |
| Check 3b TS-to-JSON projection | `c98671f` | Lint-script object missed `mcpPlaywrightToolPrefix: m.MCP_PLAYWRIGHT_TOOL_PREFIX`; snapshot has it. Diff was a perpetual false positive. Lint-script-only change; no contract values touched. |
| Check 4 allowlist | `fc506ad` | `app-supervisor.ts:waitForReady()` polls consumer `base_url` via `fetch()` (legitimate startup gate, no exfiltration surface). Documented inline allowlist exception under D-14. |
| self-test heal job gate | `b5183fe` | 06-05 added push/PR triggers; heal step references `${{ inputs.X }}` only available on `workflow_dispatch`. Zod payload validation rejected undefined values on PR runs. Gated heal job to `workflow_dispatch` only; dry-run/security scenarios still run on push/PR. |

## Code review (06-REVIEW.md)

0 critical, 4 warnings, 3 info. All 4 warnings (WR-01..WR-04) fixed in branch before merge:

- **WR-01:** `docs/examples/{gemini,github-models}.yml` declared 4 of 8 `workflow_dispatch` inputs; missing `commitSha`, `flakeRate`, `windowDays`, `runCount`. Auto-dispatch from ingest would have returned 422. Fixed in `a5f5666`.
- **WR-02:** README PAT scope corrected from `Actions: Read` to `Actions: Write` (`workflow_dispatch` is a write op). Fixed in `e40f8f3`.
- **WR-03:** CONTRIBUTING.md said `security-lint` enforces SHA pinning — it doesn't (no such check exists). Removed false claim. Fixed in `473d17a`.
- **WR-04:** SECURITY.md path corrected from `src/healer/security-contract.ts` to `src/shared/security-contract.ts`. Fixed in `396adf1`.

## Gates verified

| Gate | Command | Result |
|------|---------|--------|
| Repo public | `gh api repos/Sacharified/playwright-healer --jq .private` | `false` ✓ |
| Tags exist | `git ls-remote --tags origin` | `v0.1.0` + `v1` both present ✓ |
| v1 alias | `git rev-list -n 1 v0.1.0` == `git ls-remote origin refs/tags/v1` | `800f43d` == `800f43d` ✓ |
| Release published | `gh release view v0.1.0 --json isDraft` | `false` ✓ |
| CHANGELOG `[0.1.0]` | `grep "\[0.1.0\] - 2026-05-04" CHANGELOG.md` | match ✓ |
| Test suite | `npm test -- --run` | 478/478 pass ✓ |
| `allow_auto_merge` | `gh api repos/.../allow_auto_merge` | `true` ✓ |
| Cross-repo ref | `gh api .../sc1-healer.yml \| base64 -d \| grep "ref: v1"` | match ✓ |

## Deferred to v0.1.1

- **Branch protection on `main`**: minimal config blocked by runtime gate during release; user to configure via Settings → Rules. Until then, `allow_auto_merge: true` is set but auto-merge will not actually delay-merge (no required checks gate the merge). SC#2 live demo capability remains gated on branch protection being configured.
- **`app-supervisor.ts:waitForReady()` SEC-07 hardening**: replace `fetch()` with `net.connect()` TCP probe to remove the lint allowlist entry. Tracked under v0.1.1 backlog.
- **Anthropic + Ollama provider implementation**: shipped as preview (throw-on-call stubs) per CHANGELOG `[0.1.0]` Added section.

## Requirements addressed

| ID | Description | Status |
|----|-------------|--------|
| PKG-03 | Immutable version tag for consumer pinning | v0.1.0 annotated ✓ |
| PKG-04 | Self-test runs on push/PR (not manual-only) | self-test.yml triggers ✓ (heal gated to dispatch) |
| PKG-05 | One-PR consumer adoption path | README + 3 example workflows + docs/examples/ingest.yml snippet ✓ |
| DOC-01 | Architecture diagram (Mermaid) | README §Architecture ✓ |
| DOC-02 | Auto-merge companion doc | docs/auto-merge.md ✓ |
| DOC-03 | Prerequisites documented (trace, retain, tokens) | README §Prerequisites + docs/auto-merge.md ✓ |
| DOC-04 | Token scopes + PAT vs GITHUB_TOKEN | README §Token scopes ✓ |
| DOC-05 | CHANGELOG with [0.1.0] | CHANGELOG.md `[0.1.0] - 2026-05-04` ✓ |
