---
phase: 01-security-scaffold-composite-packaging
plan: 02
subsystem: shared
tags: [security-contract, zod, typescript, foundation]
dependency_graph:
  requires: [package.json, package-lock.json, tsconfig.json]
  provides: [src/shared/security-contract.ts, src/shared/config.ts, .planning/security-contract.snapshot.json]
  affects: [Phase 2 ingest schema extension, Phase 3 agent wiring (ALLOWED_TOOLS import), Plan 05 security-lint CI]
tech_stack:
  added:
    - "zod@4.3.6 — z.enum + z.string().min(1, {message}) + z.string().default('') factory pattern"
  patterns:
    - "Object.freeze(...) as const dual layering for compile-time + runtime immutability"
    - "Zod factory function getInputSchema() — module-level const avoided to allow test overrides"
    - "Canonical JSON formatter: recursive key+array sort, 2-space indent, trailing newline"
key_files:
  created:
    - path: src/shared/security-contract.ts
      size_bytes: 807
    - path: src/shared/config.ts
      size_bytes: 1005
    - path: .planning/security-contract.snapshot.json
      size_bytes: 229
  modified: []
decisions:
  - "Arrays in security-contract.ts sorted alphabetically (Glob, Grep, Read, mcp__playwright__*) — advisor reconciliation of PATTERNS §4 inconsistency with CONTEXT.md D-11 ordering; simpler CI byte-compare with no normalization needed"
  - "z.string().min(1, { message: '...' }) form used for Zod 4 (not shorthand z.string().min(1, 'msg') which is Zod 3 API)"
  - "Snapshot generated via node one-liner with recursive canonical() helper — not RESEARCH.md's JSON.stringify(obj, Object.keys(obj).sort(), 2) which would silently filter nested content"
metrics:
  duration: "~8 minutes"
  completed: "2026-04-24"
  tasks_completed: 2
  files_created: 3
---

# Phase 1 Plan 02: Security Contract + Config Schema Summary

Committed the immutable security design contract (`src/shared/security-contract.ts`), its canonical JSON mirror (`.planning/security-contract.snapshot.json`), and the Zod input-validation factory (`src/shared/config.ts`) — the three atoms that every downstream phase imports and that Plan 05's security-lint CI mechanically enforces.

## Files Created

| File | Size | Description |
|------|------|-------------|
| `src/shared/security-contract.ts` | 807 B | Frozen constants: ALLOWED_TOOLS, ALLOWED_ORIGIN_TEMPLATE, FORBIDDEN_WORKFLOW_TRIGGERS — zero imports, constants-only |
| `src/shared/config.ts` | 1,005 B | Zod factory `getInputSchema()` + `Config` inferred type — mode enum, .min(1) on secrets, .default('') on optional inputs |
| `.planning/security-contract.snapshot.json` | 229 B | Canonical JSON mirror — sorted keys, sorted arrays, 2-space indent, trailing newline |

## Byte-count and Canonical Equivalence

```
src/shared/security-contract.ts      807 bytes
src/shared/config.ts               1,005 bytes
.planning/security-contract.snapshot.json  229 bytes
```

**Snapshot byte-compare result:** CLEAN — `diff <(jq -S '.' snapshot.json) <(node --eval "...canonical(TS values)...")` produced zero output. Plan 05's security-lint will perform this same check mechanically.

## Canonicalization Recipe

The JSON snapshot was generated using this exact node one-liner (paste verbatim for future contract changes):

```bash
node --input-type=module -e "
const obj = {
  allowedOriginTemplate: ['<baseUrl>', 'http://localhost:*'],
  allowedTools: ['Glob', 'Grep', 'Read', 'mcp__playwright__*'],
  forbiddenWorkflowTriggers: ['pull_request_target'],
};
const canonical = (o) => Array.isArray(o)
  ? [...o].sort()
  : typeof o === 'object' && o !== null
    ? Object.keys(o).sort().reduce((a, k) => { a[k] = canonical(o[k]); return a; }, {})
    : o;
const json = JSON.stringify(canonical(obj), null, 2) + '\n';
process.stdout.write(json);
" > .planning/security-contract.snapshot.json
```

**Why not `JSON.stringify(obj, Object.keys(obj).sort(), 2)`:** This RESEARCH.md form treats the second argument as a key *filter* — it silently omits nested content. The recursive `canonical()` helper sorts both keys and array values at every level and is safe for nested structures.

## Zod 4 API Notes

No surprises. `z.string().min(1, { message: '...' })` with the object form `{ message: string }` is Zod 4 API (Zod 3 used the shorthand positional string). The installed version is `zod@4.3.6` (confirmed via `package-lock.json`).

`z.enum(['ingest', 'heal', 'dry-run']).describe('...')` works as expected. The `.describe()` call is optional but makes error messages more self-documenting.

## Zod Smoke-Test Results

```
safeParse({ mode: 'banana', ... })  → error, issues[].path.join('.') contains 'mode'   ✓
safeParse({ ..., anthropicApiKey: '' })  → error, path contains 'anthropicApiKey'       ✓
safeParse({ mode: 'ingest', anthropicApiKey: 'sk-ant-test', ... })  → success           ✓
```

## False Positive Note: `http` in security-contract.ts grep check

The plan's acceptance criterion `! grep -E "process\.env|http|fetch|require" src/shared/security-contract.ts` matches `http://localhost:*` in `ALLOWED_ORIGIN_TEMPLATE`. This is a false positive — the URL literal is required by the security contract. The actual intent (no HTTP client calls) is satisfied: there are no `http.request`, `fetch`, or similar side-effecting patterns. The check passed for `process.env`, `fetch`, and `require`; the `http` match is from the required URL value.

## Deviations from Plan

None — plan executed exactly as written. Array ordering follows the plan's advisor-reconciled alphabetical convention (`Glob, Grep, Read, mcp__playwright__*`), not RESEARCH.md's original order.

## Threat Mitigations Applied

| Threat ID | Status |
|-----------|--------|
| T-1-03 (Tampering — weakened allowedTools at runtime) | Mitigated: `Object.freeze([...] as const)` dual layering applied; Plan 05 will enforce import requirement via grep lint |
| T-1-05 (Tampering — unreviewed contract change) | Mitigated: JSON snapshot committed; header comment documents the `Security-Contract-Change: reviewed-by=<handle>` trailer protocol; Plan 05's CI diff gate will enforce this mechanically |
| T-1-07 (DoS — invalid config executes anyway) | Mitigated: `getInputSchema()` enforces mode enum + `.min(1)` on all three secrets; verified via smoke-test |

## Self-Check: PASSED

```
PASS: src/shared/security-contract.ts exists
PASS: src/shared/config.ts exists
PASS: .planning/security-contract.snapshot.json exists
PASS: tsc --noEmit passes
PASS: no imports in security-contract.ts
PASS: exactly 3 exports (3)
PASS: snapshot keys alphabetically sorted
PASS: snapshot trailing newline (0x0a)
PASS: getInputSchema factory export
PASS: Config type export
PASS: commit d03d7b6 exists (feat(01-02): add security-contract.ts frozen constants and JSON snapshot)
PASS: commit 153877a exists (feat(01-02): add config.ts Zod factory schema and Config inferred type)
PASS: snapshot byte-equivalent to TS values under canonical formatter
```
