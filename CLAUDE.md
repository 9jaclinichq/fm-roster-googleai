# CLAUDE.md — FM Residents Dashboard

## AI Philosophy: Embedded Infrastructure, Not Chat

Claude works on this repo as **embedded infrastructure**, not as a conversational
assistant bolted onto the side of it. That means:

- Changes are made directly in the codebase, following the standards below, not
  proposed as free-floating snippets for a human to hand-copy.
- Claude is expected to know and enforce this project's schema, RLS posture, and
  role model on every change — not re-derive them from scratch each session.
- Silent scope creep is not acceptable. If a task implies a schema change, a new
  RLS policy, or a change to who can do what, that must be called out explicitly,
  not slipped in as a side effect.
- Read-only audits (like Phase 0) must not touch source/schema files. Only
  documentation (this file) is updated during an audit.
- Security posture (auth, RLS, secrets) is treated as production-critical from
  day one, even while the app is small. "It's just an internal tool" is not a
  reason to skip RBAC or RLS correctness.

---

## Project Summary

**FM Residents Dashboard** — a monthly workforce data collection system for a
Department of Family Medicine. Residents log in with a name + 6-digit code to
submit their current/next rotation and leave details (with document uploads).
A Chief Resident logs in with a single shared admin code to manage the
workforce roster, open/close monthly collection cycles, and export submissions.

## Tech Stack

- **Frontend**: React 19, TypeScript (strict-ish, `noEmit` lint via `tsc`), Vite 6
- **Styling**: Tailwind CSS v4 (via `@tailwindcss/vite`)
- **Routing**: `react-router-dom` v7 (`HashRouter`)
- **Data/Backend**: Supabase (Postgres + RLS + Storage) via `@supabase/supabase-js`
- **Forms**: `react-hook-form`, `zod` (present, not yet confirmed wired into all forms)
- **State/data fetching**: `@tanstack/react-query` (present as a dependency —
  confirm actual usage before assuming query caching is active)
- **Package manager**: Bun (`bun.lock` present)
- **Deploy target**: Netlify (`netlify.toml` present, SPA redirect configured)

### Dependencies present but currently unused (do not assume they're wired up)
- `@google/genai` — no references found in `src/`. Likely leftover from the
  Google AI Studio scaffold this project was bootstrapped from.
- `express`, `dotenv` — no server file exists; this is a pure static SPA.
- Do not build features assuming a Node/Express backend exists — it doesn't.

## Project Structure

```
src/
  App.tsx                       # Router + session state (localStorage-based)
  components/
    Navbar.tsx
    ChiefLoginView.tsx          # Chief login (single shared admin code)
    ChiefDashboardView.tsx      # Chief admin dashboard
    ResidentLoginView.tsx       # Resident login (name + 6-digit code)
    ResidentFormView.tsx        # Resident rotation/leave submission form
    DevHelper.tsx               # Credentials-reveal panel — see Security Notes
  lib/
    databaseService.ts          # All Supabase reads/writes/storage go through here
  types.ts                      # WorkforceMember, Collection, Submission, Settings
supabase/
  schema.sql                    # Single unified migration: tables, RLS, storage, seed data
```

All Supabase access is centralized in `src/lib/databaseService.ts` — new
features should extend this service rather than calling `supabase` directly
from components.

## Environment & Supabase Setup

- `.env` (gitignored) currently has `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY` **both set** — the app is connected to a live
  Supabase project, not running in a mock/offline mode.
- `databaseService.isMock` is hardcoded `false` — there is no mock data layer;
  all reads are live queries. If Supabase env vars are missing, calls throw
  rather than silently falling back.
- Supabase Storage: bucket `leave-documents` is provisioned by `schema.sql`
  itself (public, 5MB limit, PDF/JPEG/PNG only). Upload logic exists and is
  implemented in `databaseService.uploadLeaveDocument`.

## Role Model (current state — see Security Notes for gaps)

| Role | Auth mechanism | Scope |
|---|---|---|
| Resident | Select name from `workforce` + enter personal 6-digit `resident_code` | Submit/update own `submissions` row for the open `collection` |
| Chief Resident | Single shared 6-digit `admin_access_code` from `settings` table | Full read/write on `workforce`, `collections`, `submissions`, `settings` |

This is **not** database-level RBAC. Both roles authenticate against plaintext
codes stored in Postgres tables, compared client-side in React, with session
state kept in `localStorage` (`fm_session_resident`, `fm_session_chief`). There
is no Supabase Auth user, no JWT claims, and no server-side session — RLS
policies currently grant `public` (i.e. anyone holding the anon key) full
access to every table. See Security Notes below before treating this as a
real access-control boundary.

## Security Notes (read before touching auth/RLS/DevHelper)

- **`DevHelper.tsx` is mounted unconditionally in `App.tsx`** (no `import.meta.env.DEV`
  guard, no build-mode check). It fetches and displays **every active resident's
  6-digit code plus the Chief Resident's admin code**, live from Supabase, to
  any visitor on the public site. This is the single highest-priority finding
  from the Phase 0 audit — treat it as a production credential leak, not a
  cosmetic dev tool, until it's gated or removed.
- **RLS policies in `schema.sql` are effectively "allow all" for `public`**
  (`USING (true) WITH CHECK (true)` on `workforce`, `collections`, `submissions`,
  `settings`, and `storage.objects`). The anon key can read/write/delete
  anything, including other residents' submissions and the admin code itself.
  Real row-level scoping (resident can only touch their own submission; only
  Chief can touch `workforce`/`settings`) does not exist yet at the database
  layer — it's assumed/enforced only by the UI.
  ⚠️ **Requires user confirmation before changing**: tightening RLS is a
  security fix but also a behavior change (could break the admin override
  flow, DevHelper, or anonymous submission flow) — confirm scope with the user
  before modifying `schema.sql` policies.
  ⚠️ **Requires user confirmation before running**: any RLS/policy change
  needs to be applied by re-running SQL in the Supabase dashboard — this repo
  has no automated migration runner, so coordinate before assuming a change is live.
- Admin and resident codes are stored and compared in plaintext (`text`/`varchar(6)`
  columns, `===` comparison in `ChiefLoginView.tsx`). No hashing.
- `.env` currently holds live production-looking Supabase credentials (URL +
  anon key both set, ~40/~208 chars). Treat this workspace as pointed at a
  real backend, not a throwaway sandbox — be careful with destructive queries
  even in "just testing" contexts.

## What's Missing for Full RBAC / Schema Completeness

Current `schema.sql` has **no dedicated tables** for:
1. **User roles / RBAC** — no `roles` or `user_roles` table; role is entirely
   implied by which login form was used and which shared code was entered.
   There is no per-Chief-Resident identity (all Chiefs share one code), so
   there's no audit trail of *which* Chief made a given change.
2. **Rotation schedule / roster reference data** — `submissions.current_rotation`
   and `next_rotation` are free-text columns, not foreign keys into a
   `rotations` or `rotation_schedule` table. There's no canonical list of valid
   rotation names/departments to validate against or drive dropdowns from.
3. **File upload metadata table** — uploaded files are stored only as raw
   public URLs in `submissions.leave_document_urls text[]`. There's no
   `file_uploads` table tracking uploader, upload timestamp, file size, MIME
   type, or a soft-delete/audit trail independent of the submission row.

These three gaps are the main schema-design backlog items — see the execution
plan below.

## Deployment

- **Netlify**: `netlify.toml` configures `npm run build` → `dist/`, with SPA
  fallback redirect (`/* → /index.html`, 200). This is the only deployment
  config found in the repo.
- **Cloud Run**: no Dockerfile, cloudbuild.yaml, or other Cloud Run config
  exists in the repo despite `metadata.json` referencing
  `MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API` and `APP_URL` (Cloud Run env vars)
  — these appear to be leftover scaffolding from Google AI Studio, not an
  active deployment target. Don't assume a Cloud Run pipeline exists; confirm
  with the user before building against it.
- No CI (`.github/workflows` does not exist). `npm run lint` is `tsc --noEmit`
  only — there is no test runner/script in `package.json`.

## Coding Standards

- All Supabase calls go through `src/lib/databaseService.ts` — don't call
  `supabase` directly from components.
- Match existing component style: functional components, Tailwind utility
  classes inline, `lucide-react` for icons, no CSS modules/styled-components.
- Types live in `src/types.ts` and mirror `schema.sql` columns exactly — when
  the schema changes, update both together.
- This app has no automated tests. Manual verification (running `npm run dev`
  and exercising the flow) is the current QA method — be explicit when a
  change hasn't been manually verified.
