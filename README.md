# PrivyDoc Workspace

PrivyDoc Workspace is a professional workspace for doctor-led organizations and
individual doctors. The first live tenant grew from a Family Medicine roster
workflow, but the product direction is broader: configurable forms, scheduling,
clinical writing, research, meetings, messages, profile/memberships, billing,
and agent-assisted operational/academic workflows.

The app is built with React, Vite, TypeScript, Tailwind CSS, and Supabase.

## Start Here

This repository is governed by agent-independent engineering documents:

- `AGENTS.md`: source-of-truth hierarchy, workflow, hard boundaries.
- `CLAUDE.md`: Claude Code-specific operating notes.
- `docs/ENGINEERING_WORKFLOW.md`: bounded-slice process and definition of done.
- `docs/TESTING_AND_VERIFICATION.md`: available commands and missing test
  harness.
- `docs/DATABASE_AND_SECURITY.md`: migration, RLS, tenancy, and live-data rules.
- `docs/UI_UX_PRINCIPLES.md`: durable UI constraints.

Architecture target and current-state evidence:

- `docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md`: target architecture.
- `docs/MODULARIZATION_ARCHITECTURE.md`: module-boundary direction.
- `docs/LIVING_SYSTEM_GAP_AUDIT.md`: contradiction/gap audit.
- `docs/REGISTRY.md`: component registry, useful but currently stale in places.

## Source Of Truth

Do not treat `supabase/schema.sql` as the complete current schema. It is the
base schema and must be read together with the linear migration series in
`supabase/migrations/`.

Do not treat migration-file existence as proof of live database state. Live
migration state must be verified separately and recorded as such. Some older
docs and migration headers are known to be stale.

When documentation conflicts, follow the hierarchy in `AGENTS.md`.

## Local Development

Install dependencies:

```bash
npm install
```

Create a local `.env` from `.env.example` and provide:

```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

Run the app:

```bash
npm run dev
```

## Verification Commands

```bash
npm run lint
npm run typecheck
npm run build
npm run verify
```

`npm run lint` is retained for compatibility but is currently typecheck only
(`tsc --noEmit`). There is no automated unit/e2e/browser test suite yet.

## Deployment

The repository contains:

- `netlify.toml` for static SPA deployment.
- `Dockerfile`, `nginx.conf`, and `cloudbuild.yaml` for Cloud Run.
- `firebase.json`/`.firebaserc` for Firebase Hosting rewrite to Cloud Run.

Do not change deployment config as part of governance or documentation cleanup
unless the task explicitly authorizes it.
