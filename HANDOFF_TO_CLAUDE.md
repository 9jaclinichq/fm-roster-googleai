# Handoff To Claude

Snapshot: 2026-08-19
Branch: `main`
Commit: `40cecd4`

This is a commit-stamped handoff snapshot. It is not an architectural authority;
use `AGENTS.md` and the source-of-truth hierarchy defined there.

## Repository State

PrivyDoc Workspace is a React/Vite/TypeScript/Tailwind app backed by Supabase.
The repo has a module tree under `src/modules/`, a large residual
`src/lib/databaseService.ts`, Supabase Edge Functions, and migrations through
`57_doctor_ownership_rls_newer_modules.sql`.

The worktree had unrelated untracked files before this governance pass,
including `.claude/`, `.tmp-run-migration.cjs`, and several historical task
notes. Do not assume they were created by this handoff.

## Authoritative Documents

- `AGENTS.md`: agent-independent constitution and source-of-truth hierarchy.
- `CLAUDE.md`: concise Claude-specific operating notes.
- `docs/ENGINEERING_WORKFLOW.md`: bounded-slice workflow and definition of
  done.
- `docs/TESTING_AND_VERIFICATION.md`: current commands and missing harness.
- `docs/DATABASE_AND_SECURITY.md`: migration, tenancy, and RLS discipline.
- `docs/UI_UX_PRINCIPLES.md`: durable UI constraints.
- `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md`: target product architecture.
- `docs/MODULARIZATION_ARCHITECTURE.md`: module-boundary direction.
- `docs/LIVING_SYSTEM_GAP_AUDIT.md`: current contradiction map, especially the
  addendum.
- `docs/REGISTRY.md`: component registry, useful but stale in places.

## Commands

- `npm run dev`: Vite dev server on port 3000.
- `npm run lint`: typecheck only, retained for compatibility.
- `npm run typecheck`: `tsc --noEmit`.
- `npm run build`: production build.
- `npm run verify`: typecheck plus build.

## Module Boundaries

Primary app modules live in `src/modules/`: auth, doctors, org-admin, form,
announcements, research, casebook-logbook, dissertation, billing,
knowledge-packs, roster-engine, scheduling, meetings, clinical-writing,
consultant-review, exam-readiness, viva-simulator, and shared.

Known boundary debt:

- `src/lib/databaseService.ts` remains a large data-access spine.
- `src/App.tsx` remains a large route/session composition root.
- Some modules still import other modules directly instead of communicating
  through clean contracts or the spine.
- `src/components/SaaSOperatorConsoleView.tsx` is still outside
  `src/modules/platform-operator/`.

## Known Risks

- Institutional tenant isolation is not fully RLS-enforced.
- Doctor-owned RLS is real only for explicitly migrated and verified tables.
- No automated tests or CI exist.
- Large files have high regression risk.
- Older docs contain stale statements.
- Migration headers cannot be trusted as live-state proof.
- Edge Functions and billing/payment paths are high-risk.

## Migration State Uncertainty

Migration files exist through 57. That does not prove live application. Some
older headers saying "NOT APPLIED LIVE" are known to be stale; some older docs
were written before later migrations existed. Always distinguish:

- migration file exists on disk
- code expects the schema
- live database state has been verified

Do not apply migrations or mutate live data without explicit approval.

## First Recommended Recovery Slice

Refresh `docs/REGISTRY.md` against current `src/modules/` and migrations 44-57
without changing product code. The registry currently lags newer scheduling,
meetings, clinical-writing, productivity, and doctor-ownership RLS work.

## Do Not Touch Yet

- Product feature implementation.
- Source implementation under `src/`.
- Supabase schema, migrations, RLS, auth, storage, and Edge Functions.
- Production data.
- Payment/billing integrations.
- Deployment configuration.
- UI redesigns.
- Dependencies.
