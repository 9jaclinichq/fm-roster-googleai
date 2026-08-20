# Engineering Workflow

This repository uses bounded engineering slices. The required loop is:

`DISCOVER -> PLAN -> HUMAN REVIEW -> IMPLEMENT -> VERIFY -> DIFF REVIEW`

## Discover

Read before editing:

- `AGENTS.md`
- `CLAUDE.md` when using Claude Code
- Current source and config relevant to the task
- Relevant migration files
- `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md`
- `docs/MODULARIZATION_ARCHITECTURE.md`
- `docs/LIVING_SYSTEM_GAP_AUDIT.md`
- `docs/REGISTRY.md`, with the understanding that it is partly stale
- Any module scoping document named by the task

Do not infer architecture from old summaries when current code or migrations
contradict them.

## Plan

Before substantial edits, state:

- Files to change
- Files explicitly out of scope
- Whether product behavior changes
- Whether schema, RLS, auth, tenancy, billing, deployment, or production data
  are touched
- Verification commands
- Known risks and open contradictions

## Human Review

Wait for human approval before:

- Product behavior changes
- Schema or migration edits
- RLS/auth/tenant-boundary edits
- Dependency changes
- Deployment config changes
- Production data access or mutation
- Broad refactors

## Implement

Keep the slice narrow. Prefer consolidating existing docs and references over
creating duplicate policy. Do not clean up unrelated code while passing through.

## Verify

Run the minimum command set for the change. For governance-only docs, use
`npm run verify` after package-script edits. For UI behavior changes, also run
browser checks at representative mobile, tablet, and desktop widths.

## Diff Review

Before handoff, inspect the complete diff and report:

- Files changed
- Whether any product implementation changed
- Verification results
- Unresolved contradictions
- Any skipped checks and why

## Definition Of Done

A change is complete when the reviewed scope is implemented, verification has
run or limitations are explicit, the diff is clean of unrelated changes and
secrets, and handoff notes distinguish target architecture from implemented
reality.
