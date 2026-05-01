---
phase: 4
slug: auto-dispatch-full-fix-classes-deduplication
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-01
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test -- --run && npm run lint && npm run typecheck` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test -- --run && npm run lint && npm run typecheck`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| To be filled in by planner | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] To be filled in by planner

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Live `workflow_dispatch` fires from ingest on threshold breach | DET-05 | Requires GitHub Actions runtime + real PAT | Push fixture failures to a test repo with `enable-auto-dispatch: 'true'`; verify healer workflow run appears in Actions tab |
| Concurrency group queues simultaneous dispatch events | DET-07 | Requires concurrent GH Actions runs | Trigger two dispatches for same `(test_file, test_title)` within seconds; verify second is queued, not parallel |
| End-to-end re-run of 03.1 demo with all gates re-engaged | success-criteria | Requires full e2e fixture + LLM provider | Re-run `e2e-heal-self.yml` with `skip_diff_lint: 'false'` and `skip_post_fix_validation: 'false'`; PR opens with diff-lint clean and post-fix validation green |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
