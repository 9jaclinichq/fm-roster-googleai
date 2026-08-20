# CLAUDE.md - Claude Code Operating Notes

Claude-specific instructions for this repository. Shared engineering rules live
in `AGENTS.md`; follow that file first.

## Startup Checklist

1. Read `AGENTS.md`.
2. Read the relevant authority documents named there before editing:
   `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md`,
   `docs/MODULARIZATION_ARCHITECTURE.md`,
   `docs/LIVING_SYSTEM_GAP_AUDIT.md`,
   `docs/REGISTRY.md`, and any module scoping doc that matches the task.
3. Inspect the current code and migration files. Do not trust stale summaries,
   including older notes in removed/condensed Claude history, over the actual
   worktree.
4. Keep work in the required loop:
   `DISCOVER -> PLAN -> HUMAN REVIEW -> IMPLEMENT -> VERIFY -> DIFF REVIEW`.

## Claude-Specific Rules

- Do not propose snippets for the user to copy when the approved task requires
  repository edits. Edit the repo directly after human review.
- Do not silently expand scope. If a task implies schema, RLS, auth, tenancy,
  production data, payment, or deployment changes, stop and get explicit human
  approval.
- Do not run or apply migrations, mutate production data, inspect secrets, or
  use elevated live-DB access unless the user explicitly approves that exact
  action.
- For read-only audits, touch only documentation unless the user approves a
  harness-only change.
- Before trusting any subagent/worktree output, inspect its diff and verify it
  stayed inside its authorized file scope.
- Never ask the user to paste credentials into the chat. If credentials are
  needed, ask them to configure the environment outside the conversation.

## Current Repo Facts To Preserve

- Product: PrivyDoc Workspace, a Vite/React/TypeScript/Tailwind/Supabase
  workspace for doctor-led organizations and individual doctors.
- Routing: React Router `HashRouter`; legacy `/resident/*` routes are preserved
  through silent redirects to `/workspace/*`.
- Data: Supabase Postgres, Storage, and Edge Functions. The base
  `supabase/schema.sql` is not the full current schema; the linear migration
  series in `supabase/migrations/` must be considered.
- Deployment: Netlify config exists; Cloud Run deployment uses `Dockerfile`,
  `nginx.conf`, and `cloudbuild.yaml`; Firebase Hosting rewrites to Cloud Run.
- `npm run lint` is currently compatibility naming for `tsc --noEmit`, not an
  ESLint pass.
- There is no automated unit/e2e/browser test suite in this repository today.

## Known High-Risk Areas

- Institutional-table tenancy is still largely enforced by application logic
  rather than strict database RLS. Doctor-owned RLS exists for a named subset
  of tables only; see `docs/DATABASE_AND_SECURITY.md`.
- Migration-file existence is not proof that a migration is applied live.
  Several migration headers and older docs have been contradicted by live-state
  checks. Explicitly distinguish "file exists" from "live state verified".
- `src/lib/databaseService.ts`, `src/App.tsx`, and large dashboard/workspace
  components remain high-blast-radius files.
- Known bug classes to avoid: check-then-write races, unbounded fetch-on-mount,
  and async session restoration that causes first-render route redirects.

## Sourcing Content

Do not fabricate authoritative medical, institutional, WACP/NPMCN, curriculum,
rubric, or guideline content. If a feature needs authoritative source material
and it is not already present or verifiably sourced, ask the user for it.
