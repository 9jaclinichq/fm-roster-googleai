# AGENTS.md - Engineering Constitution

This file is the agent-independent operating constitution for PrivyDoc
Workspace. Claude, Codex, and any future coding agent must follow it.

## Mission

Re-engineer and extend this repository as a disciplined software system, not as
a pile of one-off product screens. Preserve live behavior unless a reviewed task
explicitly authorizes a product change.

## Source Of Truth Hierarchy

Use this hierarchy whenever documents disagree:

1. **Implementation reality**: current `src/`, `supabase/migrations/`,
   `package.json`, deployment config, and actual verified live state.
2. **Current-state audit evidence**: `docs/LIVING_SYSTEM_GAP_AUDIT.md`,
   especially its addendum.
3. **Target architecture**: `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md`.
   It defines where the product is going, not what is fully implemented today.
4. **Module boundary plan**: `docs/MODULARIZATION_ARCHITECTURE.md`.
5. **Component registry**: `docs/REGISTRY.md`. Useful, but stale until refreshed
   against migrations 44-57 and current modules.
6. **Module scoping docs**: scoped proposals and rationale, not authorization to
   build.
7. **README and handoffs**: onboarding snapshots. They are not architecture
   authorities.

Migration-file existence and verified live migration state are different facts.
Record them separately.

## Required Workflow

Every non-trivial change follows:

1. **DISCOVER**: read the relevant code, docs, scripts, migrations, and current
   diff before proposing changes.
2. **PLAN**: state bounded files, intended behavior, verification, risks, and
   non-goals.
3. **HUMAN REVIEW**: wait for approval before substantial edits, schema changes,
   production data operations, dependency changes, or broad refactors.
4. **IMPLEMENT**: make only the approved change. Keep slices small.
5. **VERIFY**: run the minimum relevant commands and document any gaps.
6. **DIFF REVIEW**: inspect the final diff for scope creep, product behavior
   changes, secrets, generated noise, and stale-doc contradictions.

## Hard Boundaries

- Do not implement product features unless explicitly asked.
- Do not redesign screens, routes, data flows, auth, RLS, schema, migrations,
  deployment, dependencies, or production data as a side effect of governance
  work.
- Do not delete legacy functionality to make architecture cleaner.
- Do not run live migrations or mutate live data without exact user approval.
- Do not inspect or disclose secrets. Treat `.env` as live-sensitive.
- Do not introduce new hardcoded tenant, specialty, college, role, grade, or
  organization assumptions.

## Architecture Model

PrivyDoc Workspace targets five layers:

- L5 Faces: route-level user surfaces.
- L4 Organs: capability modules.
- L3 Spine: UDR, tenant config, event/audit, rules, integrations.
- L2 Engines: PrivyBrain-2 for academic/writing intelligence; BabsBrain-2 for
  operational intelligence.
- L1 Agents: declared rung-based agents that write through the spine.

The 10 target capability modules are Dashboard, Forms & pipelines, Scheduling,
Clinical & professional writing, Research & academic tracks, Learning &
development, Meetings & actions, Messages & broadcasts, Profile & memberships,
and Billing & plans.

Modules are capabilities, not one tenant's workflow. A hospital monthly roster,
a clinic shift form, and an association renewal form are instances/configuration
of modules, not separate hardcoded product directions.

## Module Boundaries

- Prefer existing module folders under `src/modules/<module>/`.
- A module should expose components/services through its own boundary.
- Cross-module coupling should happen through typed props, shared utilities, or
  spine contracts, not deep imports into another module's internals.
- `src/lib/databaseService.ts` is still a large de facto data spine. Avoid
  expanding it casually; any split must be its own reviewed bounded slice.
- Update `docs/REGISTRY.md` when touching component/module behavior it
  describes. If the registry is stale, say so rather than pretending it is
  current.

## Definition Of Done

A slice is done only when:

- Scope matches the reviewed plan.
- No unrelated product behavior changed.
- Types/build pass, or failures are documented with exact causes.
- Relevant manual/browser checks are run when UI behavior changed.
- Database/security implications are stated.
- Docs and handoff notes distinguish implementation reality from target state.
- Final diff has been reviewed for generated noise, secrets, and unintended
  files.

## Testing And Harness

Use `docs/TESTING_AND_VERIFICATION.md` as the command reference.

Current baseline:

- `npm run lint`: compatibility alias for `tsc --noEmit`; it is typecheck only.
- `npm run typecheck`: `tsc --noEmit`.
- `npm run build`: Vite production build.
- `npm run verify`: typecheck plus build.
- No automated unit, integration, browser, or migration test suite exists.

## Database, Migration, And Security Discipline

Use `docs/DATABASE_AND_SECURITY.md` before touching anything related to
Supabase, auth, tenancy, billing, storage, Edge Functions, or RLS.

Rules:

- A migration file on disk is not proof that the live database has that change.
- `supabase/schema.sql` is not the current complete schema after migrations.
- Institutional plaintext-code flows do not provide `auth.uid()` for strict RLS.
- Doctor-owned RLS exists only where migrations explicitly implemented and live
  checks verified it.
- RLS tightening is a product/security architecture change, not a drive-by fix.

## UI/UX Discipline

Use `docs/UI_UX_PRINCIPLES.md`.

Durable constraints:

- Preserve one responsive component tree across mobile, tablet, and desktop.
- Keep pre-login surfaces tenant-neutral until a tenant is selected.
- Operational tools should be dense, clear, and scan-friendly.
- Use tenant configuration and terminology wrappers instead of hardcoded
  hospital/residency vocabulary.
- Do not redesign screens during infrastructure/governance work.

## Repo Scan Hygiene

Broad repository scans should ignore generated and nested-worktree noise:
`node_modules`, `dist`, `coverage`, `.claude/worktrees`, and Supabase temp
artifacts. Do not use ignore files to hide active-worktree source, docs,
migrations, configs, or tests.
