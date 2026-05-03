# Contributing

## Commit convention

All commits follow the format:

```
type(NN-MM): description

Types: feat, fix, docs, test, refactor, chore
NN = phase number (e.g., 06), MM = plan number (e.g., 01)
Example: docs(06-01): create SECURITY.md and CONTRIBUTING.md
```

The phase and plan numbers in the scope are how we trace commits back to the planning documentation. External contributors can use `00-00` as the scope when there is no applicable phase reference.

## Planning workflow

This project uses the GSD (Get Shit Done) planning workflow. Planning docs live in `.planning/`. If you are contributing a significant change, reading `.planning/ROADMAP.md` and `.planning/STATE.md` first will give you the current project state and what is in scope.

## CI gate

Every PR triggers `security-lint.yml`. This workflow checks:

- No `pull_request_target` triggers in any workflow file
- All `actions/checkout` steps have `persist-credentials: false`
- All `actions/checkout` refs are SHA-pinned

PRs that fail security-lint will not be merged.

To run the test suite locally:

```bash
npm run test -- --run
```

All tests must pass before opening a PR.

## PR review expectations

- **One concern per PR.** If a PR addresses both a bug fix and a new feature, split it.
- **Link to the relevant REQUIREMENTS.md ID(s) if applicable.** For example, if your change closes FIX-06, note that in the PR description.
- **Tests must pass:** `npm run test -- --run`
- **Keep changes focused.** The diff-lint gate that guards healer PRs is also a model for contributor PRs — narrow scope reduces review overhead and risk.
