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
- **Data/Backend**: Supabase (Postgres + RLS + Storage + Edge Functions) via `@supabase/supabase-js`
- **Package manager**: npm (`package-lock.json`) — the project originally used Bun, but switched to npm when Bun couldn't be reliably installed in the working environment
- **Deploy target**: Netlify (`netlify.toml` present, SPA redirect configured)

### Note on dependencies
`@google/genai`, `express`, `dotenv`, `react-hook-form`, `zod`, and
`@tanstack/react-query` were all removed after being confirmed unused
anywhere in `src/` (leftovers from the Google AI Studio scaffold this
project was bootstrapped from, or from early exploration). Don't
re-introduce a dependency without checking it's actually imported
somewhere — `package.json` has drifted from reality before.

> **CLAUDE.md staleness warning**: the Security Notes / RBAC-gaps sections
> below were written during the Phase 0 audit and have not been fully
> refreshed since. Several described gaps (no `roles`/`user_roles` table, no
> `rotations` table, no `file_uploads` table) have since been closed by
> migrations 01–09 — check `supabase/migrations/` and `src/types.ts` for
> current schema reality rather than trusting this file's older sections at
> face value. This file needs a full pass; treat outdated claims as a known
> issue, not as ground truth.

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
| Platform Operator (new, migration 11) | Separate 6-digit `shared_code` in `platform_operators` — NOT a `workforce` row | Cross-tenant admin only, at `/saas-operator`: provision tenants, change plans, inspect AI adaptation rules. Deliberately outside the tenant model — see "SaaS Multi-Tenancy" section below. |

This is **not** database-level RBAC. All three roles authenticate against plaintext
codes stored in Postgres tables, compared client-side in React, with session
state kept in `localStorage` (`fm_session_resident`, `fm_session_chief`,
`fm_session_operator`). There is no Supabase Auth user, no JWT claims, and no
server-side session — RLS policies currently grant `public` (i.e. anyone
holding the anon key) full access to every table. See Security Notes below
before treating this as a real access-control boundary.

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

## AI / Supabase Edge Functions

`src/lib/ai/academicCopilot.ts` backs the Dissertation Assistant's and
Casebook Builder's AI-assisted actions (guideline check, Vancouver citation
formatting, differential-diagnosis extraction). It tries the
`academic-copilot` Supabase Edge Function first
(`supabase/functions/academic-copilot/index.ts`), which itself tries
**OpenAI first, then Gemini** as a second-tier fallback, and only if both
providers are unconfigured or fail does the client fall back to its own
deterministic local heuristic implementation — the UI never breaks
regardless of how many tiers fail. Every result carries a `source` field
(`'edge_function'` or `'heuristic_fallback'`) and, when it came from the
Edge Function, a `provider` field (`'openai'` or `'gemini'`) — both shown
in the UI badge and logged to `ai_action_logs`, so it's always clear
exactly which path produced a given result.

**Status: deployed and live-verified** (not just reviewed) as of this
writing. Both `AI_API_KEY` (OpenAI) and `GEMINI_API_KEY` (Gemini) secrets
are set on the `gdumksfffewpdqqwvcdo` project. All three actions were
tested against the real deployed function with real provider responses,
and the OpenAI→Gemini fallback was confirmed by temporarily unsetting
`AI_API_KEY` and observing `provider: "gemini"` in the response before
restoring it.

**Why an Edge Function at all**: this app is a pure static SPA with no
backend of its own. An LLM API key can never be embedded in client code —
even a non-`VITE_`-prefixed one — because Vite ships whatever the bundled
JS actually references. A Supabase Edge Function is the only place in this
project's architecture that can hold such a secret safely (`Deno.env`,
never in the repo or the client bundle).

**Deploying the function.** The standalone `supabase` CLI binary has been
unreliable in some environments (segfaults on even `--version`); `npx
supabase` (the npm-distributed CLI) works and is the recommended way to
run these commands. `supabase link` has also been flaky (a schema
validation bug against this account's project list) — pass `--project-ref`
directly to every command instead of relying on a persisted link.
`--use-api` bundles the function server-side and avoids needing Docker
locally:

```bash
npx supabase functions deploy academic-copilot --project-ref gdumksfffewpdqqwvcdo --no-verify-jwt --use-api
```

`--no-verify-jwt` is required because this app has no Supabase Auth
sessions to verify against (see the Role Model section above) — the
function is reachable by anyone holding the anon key, the same trust model
as the rest of this app's API surface.

**Setting secrets** (NOT the same as anything in `.env` — see
`.env.example`'s `AI_API_KEY`/`GEMINI_API_KEY` entries, which exist only as
documentation and are never read by the Vite app):

```bash
npx supabase secrets set AI_API_KEY=sk-... --project-ref gdumksfffewpdqqwvcdo
npx supabase secrets set GEMINI_API_KEY=... --project-ref gdumksfffewpdqqwvcdo
```

Either secret can be omitted or unset — the function tries whichever are
configured, in OpenAI-then-Gemini order, and returns a graceful `503` only
if neither works, at which point the app transparently uses its heuristic
fallback. That's a safe, expected state, not a broken one.

**Gemini model note**: the function uses the `gemini-flash-latest` alias
rather than a pinned version (e.g. `gemini-2.0-flash`), because pinned
model IDs get deprecated and start returning 404s — confirmed live while
building this (`gemini-2.0-flash`, `gemini-2.5-flash`, and
`gemini-1.5-flash` were all already 404 at the time of writing, despite
`gemini-2.0-flash` still appearing in `ListModels`). If Gemini calls start
failing with 404, check `GET https://generativelanguage.googleapis.com/v1beta/models?key=...`
for the current alias names.

**Second Edge Function: `roster-parser`** (`supabase/functions/roster-parser/index.ts`)
backs `src/lib/roster/uchRosterParser.ts`, which structures the 5 UCH roster
document formats (Combined GOP, Consultant GOP, A&E Emergency Call,
Afternoon/Priority/Saturday Supervision, Satellite Outposts) ingested by
`MultiRosterManagerView.tsx`. Same architecture and secrets as
`academic-copilot` (OpenAI → Gemini → client-side heuristic fallback, same
`source`/`provider` result fields). **Status: deployed and live-verified**
— tested against the real deployed function with a sample Consultant GOP
roster and confirmed a correctly structured response via the OpenAI tier.
No new secrets were needed; it reuses the same `AI_API_KEY`/`GEMINI_API_KEY`
already set on `gdumksfffewpdqqwvcdo`.

**CLI gotcha hit deploying this one**: `npx supabase functions deploy`
failed with `ENOSPC: no space left on device` (this machine's C: drive was
down to ~273MB free), which left a *corrupted partial install* of
`supabase@2.113.0` in the npx cache
(`%LOCALAPPDATA%\npm-cache\_npx\<hash>`). Retrying after freeing space
still failed with `No matching Supabase CLI binary package found for
win32-x64` — not a disk issue anymore, but the corrupted cache entry
persisted. Fix was two steps: `npm cache clean --force` to reclaim space,
then delete the specific stale `_npx` cache subfolder to force a clean
redownload, then pin the working version explicitly rather than trusting
`npx supabase` to resolve to something installable:
```bash
npx supabase@2.112.0 functions deploy roster-parser --project-ref gdumksfffewpdqqwvcdo --no-verify-jwt --use-api
```
If a future `npx supabase` invocation fails with a "no matching binary"
error right after an `ENOSPC` or other interrupted install, suspect a
corrupted npx cache entry before assuming the CLI itself is broken.

**Third Edge Function: `paystack-subaccount`** (`supabase/functions/paystack-subaccount/index.ts`)
creates a Paystack subaccount for a tenant being provisioned in the SaaS
Operator Console. Uses a `PAYSTACK_SECRET_KEY` secret (currently a **live**
key, not test — see "SaaS Multi-Tenancy" below). Deliberately narrow scope:
subaccount creation only, no charge/subscription/webhook code. **Status:
deployed and live-verified** — confirmed the key authenticates correctly
against the real live Paystack API (a bad key returns 401 "Invalid key";
this returned a validation error about the account details instead, proving
the key itself is good) without actually creating a subaccount, since no
real bank account details were available to test a full creation safely. A
`FLUTTERWAVE_SECRET_KEY` secret is also set on the project for future use,
but no Flutterwave code path exists yet.

## SaaS Multi-Tenancy & Platform Operator (migration 11)

The app was extended from a single-department tool into a multi-tenant
platform. `tenants` (seeded with UCH Family Medicine, id
`00000000-0000-0000-0000-000000000001`) has `tenant_id` added to 10 core
tables (`workforce`, `collections`, `combined_master_rosters`,
`announcements`, `knowledge_packs`, `dissertations`, `case_reports`,
`exam_readiness`, `viva_simulations`, `call_duty_rules` — the last one
created net-new by this migration). `settings` and `submissions` deliberately
do **not** have `tenant_id` yet — out of the original spec's table list, and
`settings` is a global singleton that doesn't cleanly fit the tenant model
as-is. A real multi-tenant Chief admin code / active-collection story is
still a future gap, not solved here.

**Tenant isolation is client-enforced only, not RLS-enforced** — same
permissive-RLS trust model as every other table since migration 01. The
originally-specced `current_setting('app.current_tenant_id')`-based RLS
policy needs signed JWT claims from real Supabase Auth, which this app
doesn't have. Don't assume `tenant_id` is a real security boundary; a
determined anon-key holder can read/write across tenants directly via the
REST API. Existing single-tenant queries in `databaseService.ts` are also
NOT filtered by `tenant_id` yet — there's nothing to filter against with
only one tenant seeded and no tenant-switching login flow.

**AI usage quota**: `tenant_ai_usage` + `check_and_increment_tenant_ai_quota()`
gate the free-tier plan to 50 AI-assisted actions per rolling 14-day window,
enforced **server-side inside** `academic-copilot` and `roster-parser`
(not just client-side, which would be trivially bypassable via a direct
curl to the Edge Function URL). Paid tiers (`tier_1`/`tier_2`/`enterprise`)
are unlimited in this pass.

**Guest review links**: `guest_review_invites` + `create_guest_review_invite`/
`get_guest_review_invite`/`submit_guest_review` RPCs let a resident share a
no-login review link for an external reviewer, extending `consultant_reviews`
(migrations 06/07) rather than duplicating it. Deliberately **no direct
SELECT policy** on `guest_review_invites` or `platform_operators` — the
token/code IS the access credential, so a permissive SELECT would let
anyone enumerate every outstanding link or operator code via the REST API.
Access only via the RPCs, which require the exact token/code. Mirrors
migration 07's co-resident restriction: a guest link can only carry final
**approval** authority (`invited_as = 'consultant'`) if its creator actually
holds an authorizing role — enforced server-side in
`create_guest_review_invite`, not just hidden in the UI, so a resident can't
hand a friend a link that rubber-stamps their own exam eligibility.

**Known bug found and fixed during this migration's verification**: `tenants`
initially had no INSERT/UPDATE RLS policy (an early draft's comment claimed
writes would go through operator-gated RPCs that were never actually built)
— this made every tenant provisioning/plan-change call 401. Fixed to match
the same permissive model as its sibling tables (`call_duty_rules`,
`tenant_ai_adaptation_rules`) in the same migration. If a future write to
`tenants` starts failing with 401 again, check `pg_policies` for that table
before assuming it's an app bug.

**Manually verified in a browser** (not just `tsc`/`build`/API-level checks):
operator login + tenant provisioning + plan/status changes, Chief
Customization tab (module toggles, call duty rules, terminology, AI tuning),
and the full guest-review round trip (generate link → open as guest →
submit feedback → confirm it landed in the resident's view). All test data
created during that walkthrough was cleaned up afterward.

**Not yet built** (flagged, not silently skipped): Flutterwave integration
code, live charge/subscription billing and webhooks, full terminology
retrofit across existing components (`TerminologyProvider`/`useTerminology`
in `src/lib/terminology.tsx` are real and applied only to the components
built in migration 11 — `SaaSOperatorConsoleView`, `TenantCustomizationView`,
`GuestReviewView` — not the rest of the app), and `tenant_ai_adaptation_rules`
actually being read/applied by the Edge Functions when constructing prompts.

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
