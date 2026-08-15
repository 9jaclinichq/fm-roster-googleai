# CLAUDE.md — PrivyDoc Workspace (formerly FM Residents Dashboard)

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

**PrivyDoc Workspace** (formerly FM Residents Dashboard — see the Branding &
Routing section) — a monthly workforce data collection system for a
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
- **Real `auth.uid()`-scoped RLS boundaries do exist for a few tables — don't
  assume everything is `USING(true)` just because most of the app is.**
  `doctor_profiles` (migration 18), `research_workspaces`/`casebook_workspaces`
  (migration 25 — doctor-owned rows, `doctor_id IS NOT NULL`, require
  `auth.uid() = doctor_id`; institutional rows, `workforce_id IS NOT NULL`,
  stay `USING(true)` same as everything else), and now their child content
  tables too (migration 31, 2026-08-15): `research_chapters`,
  `research_correction_logs` (both join to `research_workspaces`), and
  `clinical_case_reports` (joins to `casebook_workspaces`) each got a
  join-based policy mirroring their parent's own institutional-vs-doctor
  split. **Correction to migration 25's own header**: it named 5 child
  tables as affected, but `clinical_logbooks`/`admin_logbook_parsing_queue`
  turned out to be workforce_id-keyed only with no workspace_id or doctor_id
  path at all (confirmed against both the live schema and
  `CasebookWorkspaceView.tsx`'s own `owner.kind === 'workforce'` write
  gates) — a doctor-owned workspace can never produce a row in either, so
  there was nothing to fix there; only 3 tables actually needed it.
  **Manually verified** (migration 31): rather than a full browser Supabase
  Auth signup, simulated PostgREST's own request context directly
  (`SET ROLE anon|authenticated` + `set_config('request.jwt.claims', ...)`)
  against real test rows for all 3 tables — confirmed an anonymous/different-
  doctor request now gets 0 rows and is blocked from inserting, the owning
  doctor still gets full access, and institutional rows are completely
  unaffected (still publicly readable, same as every other table) — then
  cleaned up every test row.

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

**Function renames (2026-08-15, modularization Phase 1)**: `academic-copilot` → `dissertation-copilot`
and `paystack-subaccount` → `platform-operator-subaccount`, per `docs/MODULARIZATION_ARCHITECTURE.md`'s
backend module map — 1:1 naming with the frontend module each serves. Cosmetic rename only (Deno
bundles per-function, so no functional change); the 2 real client call sites
(`src/lib/ai/academicCopilot.ts` — filename deliberately NOT renamed in this pass, that's a later
module-move phase — and `src/lib/databaseService.ts`'s `provisionTenantWithSubaccount`) were updated,
both new functions deployed and live-verified (a real OpenAI response through the actual Dissertation
Assistant UI; a real Paystack validation-error response confirming the key still authenticates,
without creating a real subaccount), then the old function slugs deleted from Supabase so nothing is
left orphaned. The AI-rigor tuning `feature_key` string stayed `'academic_copilot'` deliberately — that's
a `tenant_ai_adaptation_rules` data identifier, independent of the function's deploy name; renaming it
too would be a data-contract change, out of scope for this rename.

`src/lib/ai/academicCopilot.ts` backs the Dissertation Assistant's and
Casebook Builder's AI-assisted actions (guideline check, Vancouver citation
formatting, differential-diagnosis extraction). It tries the
`dissertation-copilot` Supabase Edge Function first
(`supabase/functions/dissertation-copilot/index.ts`), which itself tries
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
npx supabase functions deploy dissertation-copilot --project-ref gdumksfffewpdqqwvcdo --no-verify-jwt --use-api
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
`dissertation-copilot` (OpenAI → Gemini → client-side heuristic fallback, same
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

**Third Edge Function: `platform-operator-subaccount`** (`supabase/functions/platform-operator-subaccount/index.ts`)
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

**Fourth Edge Function: `research-copilot`** (`supabase/functions/research-copilot/index.ts`)
backs the Universal Research Engine's AI Copilot Panel (see that section below) for 3 of its 4
actions — `audit_draft`, `synthesize_literature_matrix`, `generate_table_shells`. Same
OpenAI→Gemini→client-heuristic-fallback architecture and `source`/`provider` result fields as
`dissertation-copilot`, but prompts are built dynamically per-request from the workspace's active
`research_templates` row (via `supabase/functions/_shared/researchRubric.ts`'s
`buildDynamicSystemPrompt`) rather than a fixed prompt set. Reuses the same
`check_and_increment_tenant_ai_quota` RPC and `AI_API_KEY`/`GEMINI_API_KEY` secrets — no new
secrets needed. The AI Copilot Panel's 4th action (Fisher's-formula sample size) is deliberately
**not** routed through this function — it's a fixed formula, not a candidate for an LLM call.
**Status: deployed and live-verified** — curl-tested directly against the deployed function
(confirmed real OpenAI JSON responses for all 3 actions) and re-verified end-to-end in the browser
(AI-generated badges, on-topic content, `ai_action_logs` rows confirmed landing with the new
action types).

**Fifth Edge Function: `casebook-copilot`** (`supabase/functions/casebook-copilot/index.ts`)
backs the Casebook & Clinical Logbook Engine's AI-assisted actions (see that section below):
`audit_case` (WACP 100-point / PMR 7-step scoring), `generate_defense_questions` (viva prep
questions grounded in the resident's own write-up), and `parse_logbook_curriculum` (structures
raw pasted logbook text into stations/procedures/required-counts). Same
OpenAI→Gemini→client-heuristic-fallback architecture as every other Edge Function here, built on
`supabase/functions/_shared/casebookRubric.ts`'s `buildCasebookSystemPrompt`. Kept as its own
function rather than folded into `dissertation-copilot`, matching the separation precedent
`research-copilot` set — despite the original task spec asking to inject these into
`dissertation-copilot` directly, that call was made explicitly with the user rather than followed
literally. Reuses the same quota RPC and `AI_API_KEY`/`GEMINI_API_KEY` secrets — no new secrets
needed. **Status: deployed and live-verified** — curl-tested all 3 actions directly against the
deployed function (real OpenAI responses confirmed) and re-verified end-to-end in the browser.

**AI-rigor tuning was first wired here** (2026-08-14, the first Edge Function to actually read
`tenant_ai_adaptation_rules` — schema/UI-only since migration 11 until this), **and extended to all
4 AI Copilot Edge Functions on 2026-08-15.** The fetch/splice logic
(`fetchTenantAdaptationPromptOverride`/`appendTenantAdaptationOverride`) moved out of
`casebookRubric.ts` into a new `supabase/functions/_shared/tenantAdaptation.ts`, parameterized with
a `featureKey` argument instead of hardcoding `casebook_copilot` — `casebook-copilot`,
`dissertation-copilot`, `research-copilot`, and `roster-parser` each now call it with their own feature
key (`casebook_copilot` / `academic_copilot` / `research_copilot` / `roster_parser`) right after
their existing quota check, splicing the tenant's `adapted_prompt_overrides.extra_instructions`
(still the one trusted free-text field, length-capped, type-checked) onto that action's system
prompt — never replacing the base safety/rubric framing, only appended on top. Any failure (network,
malformed row, no tenant_id) silently falls back to the unmodified prompt, same as before.
`TenantCustomizationView.tsx`'s "AI Behavior Tuning" panel copy/placeholders were also fixed — they
previously said "not yet applied by the Edge Functions" (stale even for casebook_copilot) and
suggested an arbitrary JSON shape like `{"citation_style": "APA"}` that the code silently ignored
(only `.extra_instructions` is ever read); it now names the real 4 feature keys and the real JSON
shape. **Live-verified**: all 4 functions deployed; for each, set a real `tenant_ai_adaptation_rules`
row with a distinctive marker string as `extra_instructions` and curled the live function directly —
the marker appeared verbatim in the real OpenAI response for all 4 (`dissertation-copilot`,
`research-copilot`, `roster-parser`, and a `casebook-copilot` regression check since its import path
changed); all 4 test rows deleted afterward. Browser-verified the updated panel copy renders
correctly as the real UCH Chief.

## Casebook & Clinical Logbook Engine (migrations 15-16)

A template-driven WACP/NPMCN PMR (Membership) and 15-Casebook (Fellowship) portfolio workspace,
reachable at `/workspace/casebook-logbook` (formerly `/resident/casebook-logbook`), backed by 5 new tables from migration 15:

- **`casebook_templates`**: framework/rubric templates — `framework_type` (WACP_PMR_10,
  WACP_CASEBOOK_15, NPMCN_CASEBOOK_15, GENERIC_10, CUSTOM_CLINICAL), each with a thematic
  case-distribution, a scoring rubric (10 WACP domains summing to 100 points, or the PMR's 7-step
  pass/fail checklist), and formatting rules (Vancouver references, min count, max age, no
  figures starting sentences). Seeded with 4 global templates.
- **`casebook_workspaces`**: one candidate's portfolio per resident, with a `page_count_target`
  stamped from the framework (PMR: 80-120p; 15-Casebook tracks: 80-140p).
- **`clinical_case_reports`**: one row per case (1-15) — full clinical write-up (demographics,
  history, examination, PCCM/biopsychosocial formulation, family tools data, management plan,
  discussion, references) plus AI-generated `rubric_scores` and `defense_questions`.
- **`clinical_logbooks`**: per-resident procedure/competency/station tracking with supervisor
  sign-offs (`addLogbookSignoff` appends a sign-off and bumps `completed_count`, capped at
  `required_count`).
- **`admin_logbook_parsing_queue`**: Chief/Admin-uploaded raw logbook text queued for AI
  curriculum extraction. Has a `raw_text_content` column beyond the original spec's literal list
  — mirrors `raw_roster_uploads` (migration 10): this app has no server-side PDF/DOCX parsing, so
  a resident/admin pastes the document's text directly (same convention as
  `MultiRosterManagerView.tsx`'s ingest flow) rather than the file itself being parsed.

**SCOPE DECISION — sits alongside the original Casebook Builder, not replacing it.** `case_reports`
(migration 04) + `CasebookBuilderView.tsx` + `/workspace/casebook` remain a simpler, already-live
15-slot MVP. `clinical_case_reports` here is a materially richer clinical write-up model at a
**different** route/nav tab — an explicit choice made with the user rather than silently colliding
two "casebook" concepts or migrating existing resident data. Both stay live and independent.

**`thematic_area` adds `accident_emergency`**, which the original task spec's own enum list
omitted despite the WACP PMR-10 seed template explicitly requiring "1 A&E" case — folding it into
`trauma_orthopaedics` would have made the seeded distribution misrepresent its own curriculum, so
the enum was corrected rather than worked around. Flagged in migration 15's header, same as every
other deliberate spec deviation in this file.

**Family Medicine Tools** (`src/lib/clinical/familyTools.ts`, pure client-side, no persistence
logic of its own): 3-generation genogram builder (nodes/relationships/disease-legend), Family
APGAR calculator (Smilkstein 0-2-per-item, 0-10 total, banded 0-3/4-6/7-10 interpretation),
Ecomap and Family Circle mappers, and Duvall's/Stevenson's 8-stage family life cycle evaluator.
Results are stored in `clinical_case_reports.genogram_data` / `family_tools_data`.

**Real-Time WACP Scorecard**: live, client-side-only validators
(`src/lib/clinical/caseRubricEngine.ts`) check reference formatting (Vancouver + min count + max
age), sentences starting with a raw figure, PCCM component completeness (FIFE/Common Ground/Whole
Person/Health Promotion), and an overall score summary against the active template — same
independent-implementation-per-side pattern as the Research Engine's `rubricEngine.ts` vs.
`researchRubric.ts`.

**AI Copilot** (in `CasebookWorkspaceView.tsx`, provider in `src/lib/ai/casebookCopilot.ts`):
"Audit Against WACP Rubric" and "Generate Defense Questions" call the live `casebook-copilot`
Edge Function and fall back to a deterministic heuristic if it's unavailable — same
`source`/`provider` badging pattern as every other AI Copilot panel in this app. The Admin Logbook
Curriculum Parser panel (visible only to residents holding a subadmin role — same
`canApprove`-style gating as `ConsultantReviewView`) also calls `casebook-copilot`
(`parse_logbook_curriculum`) to structure pasted logbook text into stations/procedures, which can
then be applied directly to the current user's `clinical_logbooks` tracker.

Migration 16 widens `ai_action_logs.action_type`'s CHECK constraint to add `casebook_audit`,
`defense_questions`, `logbook_parse`.

**Bug found and fixed during browser verification**: the genogram's disease-list input was fully
controlled — its displayed value was re-derived via `.join(', ')` from parsed state on every
keystroke, which silently stripped a just-typed trailing comma before the next disease name was
entered, corrupting fast/real typing alike. Fixed with a local-buffer + onBlur-commit input
(`GenogramDiseasesInput`), matching this app's existing pattern for other free-text-to-
structured-data fields (e.g. the PICO Title input in `ResearchWorkspaceView`).

**Manually verified**: migrations applied live (all 4 seed templates confirmed present); a full
resident-session browser walkthrough — created a PMR-10 workspace → opened Case 1 → filled
demographics/PCCM/discussion/references → generated the genogram template (caught and fixed the
bug above mid-verification) → set Family APGAR (7/10, Highly Functional) → added an Ecomap
connection and Family Circle member → set Duvall stage 2 → saved → ran both AI Copilot actions
against real OpenAI responses (scorecard updated live to 2/7 PMR steps met) → full page reload
confirmed all data, including AI-generated rubric scores and defense questions, persisted
correctly. The admin logbook-parsing panel's UI was not browser-tested (no resident in this
database currently holds a subadmin role) — its underlying Edge Function action was curl-verified
against a real provider instead. Merged to `main` via PR #9.

## Universal Research Engine (migrations 13-14)

A template-driven research proposal/dissertation workspace, reachable at `/workspace/research` (formerly `/resident/research`)
(gated exactly like every other resident view — see scope note below), backed by 4 new tables
from migration 13:

- **`research_templates`**: rubric/format templates — `organization_or_body` (WACP, NPMCN, ICMJE,
  STROBE, CONSORT, PRISMA, CARE, University_Thesis, Custom_Doctor), `referencing_style`
  (vancouver/apa7/harvard), `proposal_rubric`/`dissertation_rubric`/`word_count_limits` jsonb.
  Seeded with 9 global templates (`tenant_id`/`created_by_workforce_id` both NULL). Residents can
  fork any template into a personal (`is_public=false`) or department-wide (`is_public=true`,
  `tenant_id` set) custom copy and edit its word caps, rubric items, referencing style, and custom
  AI prompt rules — see `src/lib/research/templateEngine.ts`.
- **`research_workspaces`**: one research project per resident, linked to an active template, with
  a `pico_framework` jsonb (currently just the proposal title), a `status` lifecycle
  (`proposal_draft` -> `proposal_approved` -> `data_collection` -> `thesis_writeup` -> `completed`),
  and a `folder_tree` jsonb stamped at creation time from the fixed 7-folder Drive taxonomy in
  `src/lib/research/folderStructure.ts` (`00-Proposal` through `07-Admin`).
- **`research_chapters`**: one row per section (`proposal`, `ch1_intro` ... `ch5_discussion`) per
  workspace, with `content_text`, `word_count`, and `ai_audit_logs`.
- **`research_correction_logs`**: tabular tracker mapping assessor/supervisor feedback
  (`comment_source`: college_assessor/supervisor_round_1/supervisor_round_2/peer_reviewer) to
  `action_taken` and a pending/resolved `status`.

RLS on all 4 tables is permissive, matching every table since migration 01 — see this file's
Security Notes; not a real security boundary.

**SCOPE DECISION -- no "independent doctor" identity.** The task spec implied a workspace owner
could be either an institutional resident or an unaffiliated individual doctor, with
`tenant_id`/`workforce_id` both nullable on `research_workspaces` to support that. That identity
system was **not built** in this pass -- this app has no standalone user identity outside
`workforce` (see Role Model above). `/workspace/research` is gated exactly like every other
resident view today; the nullable columns exist so a future "independent doctor" login doesn't
require a schema change, but no such login flow exists yet.

**Real-Time Rubric Scorecard**: live, client-side-only validators
(`src/lib/research/rubricEngine.ts`) check PICO title length, active-section word cap, and
citation syntax (Vancouver numbering plus a minimum African-literature-source ratio for
WACP/NPMCN templates) against the workspace's active template, with zero network cost per
keystroke. A server-side mirror of the same validators lives in
`supabase/functions/_shared/researchRubric.ts` for `research-copilot`'s use — the two are
deliberately independent implementations, same pattern as `academicCopilot.ts` vs.
`dissertation-copilot/index.ts`'s heuristic fallback, not shared code across the Vite/Deno boundary.

**AI Copilot Panel** (`ResearchWorkspaceView.tsx`, provider in `src/lib/ai/researchCopilot.ts`):
"Run AI Audit", "Generate [Dummy Table Shells]", and "Synthesize [Literature Matrix]" call the
live `research-copilot` Edge Function (see AI / Supabase Edge Functions above) and fall back to a
deterministic heuristic if it's unavailable — same dual-path pattern and `source`/`provider` UI
badging as the Dissertation Assistant/Casebook Builder. "Precision Sample Size (Fisher's Formula)"
stays a pure client-side formula (`n = Z^2 p(1-p)/d^2`) — never sent to an AI provider.

Migration 14 widens `ai_action_logs.action_type`'s CHECK constraint to add `research_audit`,
`literature_matrix`, `table_shells` alongside the 4 original academicCopilot action types, so
these are logged/audited the same way as every other AI action in this app.

**Manually verified**: migration applied live (all 9 seed templates confirmed present); a full
resident-session browser walkthrough — create workspace → apply WACP template → edit PICO title
(live word-count gauge) → save chapter → paste Vancouver references (citation + African-literature
gauges both went green) → add/resolve a correction log row → Fisher's sample-size calc → all 3 AI
Copilot actions run against real OpenAI responses (confirmed via curl and in-browser) →
full-page-reload persistence confirmed. Merged to `main` via PR #8.

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
enforced **server-side inside** `dissertation-copilot` and `roster-parser`
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

**Not yet built** (flagged, not silently skipped): `tenant_ai_adaptation_rules`
is now wired into all 4 AI Copilot Edge Functions (`casebook-copilot`,
`dissertation-copilot`, `research-copilot`, `roster-parser` — see the AI/Edge
Functions section above), closing what was previously flagged here.
Flutterwave integration, live charge/subscription billing and webhooks, and
the terminology retrofit are all now built — see the Billing section and
`src/lib/terminology.tsx`'s own header for current coverage.

## Billing, Tiers & AI Copilot Feature Gating (migration 17)

Paystack/Flutterwave-backed Pro upgrades gating the Research & PMR/Casebook
AI Copilot actions:

- **`src/config/tiers.ts`**: Free = 50 AI actions per rolling 14 days
  (Research + Casebook action types only — the original dissertation-copilot
  types are deliberately ungated); Pro/Unlimited = no cap. Pro price is
  **₦12,000/month**, confirmed by the user (Dr. Olanipekun) on 2026-08-14 —
  no longer the earlier ₦5,000 placeholder. The charged amount lives in
  `payment-checkout/index.ts` (authoritative, `PLAN_AMOUNT_NGN`), mirrored
  display-only in `tiers.ts` — keep both in sync if this changes again.
- **`useWorkspaceQuota`** (`src/lib/billing/`): client-side per-member gate
  counting `ai_action_logs`; fails OPEN on read errors. The tenant-level
  `check_and_increment_tenant_ai_quota` RPC inside the copilot Edge
  Functions remains the authoritative backstop. Exhaustion opens
  `UpgradeCheckoutModal` (wired into Research + Casebook workspace views).
- **Migration 17**: `user_subscriptions` ("user" = workforce row; SELECT-only
  RLS for anon — writes are service-role-only so anon can't self-grant Pro)
  and `payment_events` (no policies at all; webhook idempotency via UNIQUE
  (provider, event_type, reference)). Applied live.
- **Edge Functions** (both deployed + live-verified): `payment-checkout`
  initializes provider-hosted checkout server-side (amount can't be forged
  client-side; returns redirect URL; inserts 'pending' subscription row) —
  real checkout URLs confirmed from BOTH live providers. `payment-webhook`
  verifies Paystack via HMAC-SHA512 of the raw body (curl-verified: unsigned
  → 401, forged → 401) and Flutterwave via `verif-hash` CONSTANT-TIME
  EQUALITY — a flagged deviation from the task brief's "HMAC for both":
  Flutterwave v3 doesn't sign payloads, it sends the dashboard-configured
  secret hash verbatim. Activation (pending → active, 30-day period) happens
  ONLY in the webhook, never client-side.
- `FLUTTERWAVE_WEBHOOK_HASH` is SET on the project (value matches the
  Flutterwave dashboard's secret hash; never write the value into this repo)
  and live-verified: correct hash → 200, wrong hash → 401. Flutterwave is
  the DEFAULT/recommended provider in the upgrade modal
  (`DEFAULT_PAYMENT_PROVIDER` in tiers.ts); Paystack is the secondary option.
- **Per-tenant usage breakdown** (2026-08-14, `SaaSOperatorConsoleView`'s new
  "Per-Tenant Usage" table, `databaseService.getTenantUsageBreakdown()`):
  replaces the old flat global-only analytics with a per-tenant table (plan,
  status, member count, AI actions this 14-day window, submission count),
  sorted by AI actions descending so the operator can spot free-tier-heavy
  tenants (upsell candidates) or paying tenants gone quiet. No schema change —
  joins `tenants`/`tenant_ai_usage`/`workforce`/`submissions` client-side.
- **Per-module pricing was scoped and explicitly rejected in favor of one
  flat Pro price (Phase 5, 2026-08-14).** The user chose "one flat Pro
  price for everything" over per-module pricing when asked directly —
  `WORKSPACE_TIERS` stays a two-tier (`free`/`pro_unlimited`) flat
  structure, not a per-module matrix. What Phase 5 *did* add: two more
  paid-gated surfaces beyond the original AI Copilot quota — creating/
  editing an organization's own Template Manager content (custom Casebook
  templates; Research template forking) and Viva Vignette bank entries.
  See migration 29 and the new paragraph below for the mechanism.
- **Migration 29 — org-custom-content creation gated behind
  `tenants.plan_type`, a SEPARATE gate from the AI Copilot quota above.**
  `chief_create_casebook_template`, `chief_update_casebook_template`,
  `chief_create_viva_vignette`, `chief_update_viva_vignette` all now
  `RAISE EXCEPTION` when the calling tenant's `plan_type = 'free_seeded'`.
  This is deliberately NOT the per-resident `user_subscriptions` gate used
  by the AI Copilot quota — a Chief has no `workforce_id` of their own (see
  Role Model above), so there's no per-resident row to check for a
  Chief-authored action; the only coherent gate is the organization's own
  plan. Delete/reset RPCs stay ungated (downgrading shouldn't lock a Chief
  out of cleaning up their own org's content). Research template forking
  has no RPC to attach a server-side check to (`research_templates` stays
  under its original permissive-RLS trust model, migration 13) — its gate
  in `TemplateManagerView.tsx`'s `handleForkResearch` is client-side only,
  flagged as weaker than the RPC-enforced casebook/viva gates, not hidden.
  `TemplateManagerView.tsx` fetches the tenant's `plan_type` via
  `databaseService.getTenant()` on load, shows an amber "Free plan" banner
  and lock icons on the three create entry points when gated, and surfaces
  the real RPC rejection message (via a `PostgrestError`-aware
  `errorMessage()` helper) instead of a generic "Failed to save..." string.
  The self-serve upgrade gap this originally left is closed by migration 30
  below — this paragraph's own banner/lock-icon UI now also carries an
  "Upgrade Organization" button. **Manually verified**:
  applied migration 29 live; browser-verified as the real UCH Chief on the
  live `free_seeded` tenant — banner + lock icons rendered, clicking a
  locked "Fork for My Org" button correctly blocked client-side with no
  modal opening and the right message; temporarily promoted the tenant to
  `tier_1` via direct DB update, reloaded, confirmed the banner/locks
  disappeared, created a real Viva Vignette end-to-end through the live RPC,
  deleted it, then reverted the tenant back to `free_seeded` — no test data
  left behind.
- **Migration 30 (2026-08-15) — self-serve organization-wide Pro upgrade
  checkout**, closing the gap migration 29 flagged. Extends the EXISTING
  per-resident billing machinery (migration 17) rather than adding a second
  parallel table: `user_subscriptions` gets a `scope` discriminator
  (`'workforce'` | `'tenant'`), `workforce_id` becomes nullable, and a CHECK
  constraint enforces exactly one owner shape per scope (`scope='tenant'`
  requires `tenant_id` and forbids `workforce_id`). This keeps
  `payment-checkout`/`payment-webhook` on one lookup-by-`provider_reference`
  code path instead of two — same "extend, don't duplicate" precedent as
  migration 11's `guest_review_invites`.
  `payment-checkout` now accepts `scope: 'tenant'` (Chief buying Pro for the
  whole org — no `workforce_id`, `tenant_id` required) alongside the
  original `scope: 'workforce'`/default (a resident's own per-resident AI
  Copilot allowance) — same flat ₦12,000/month price either way, no
  per-scope pricing. `payment-webhook`'s activation branches on the row's
  `scope`: a `'tenant'` row also promotes `tenants.plan_type` from
  `'free_seeded'` to `'tier_1'` via `promoteTenantIfFreeSeeded()` — guarded
  to only fire FROM `'free_seeded'`, so it can never downgrade or silently
  overwrite a tenant an operator has manually placed on `tier_2`/`enterprise`
  (a custom/negotiated deal outside this flow). `databaseService.
  initiateTenantPlanCheckout()` and the new `TenantUpgradeCheckoutModal.tsx`
  (sibling to the per-resident `UpgradeCheckoutModal.tsx`, same
  email-then-provider-buttons-then-confirm flow, no per-resident quota
  numbers since a Chief has none) wire this into `TemplateManagerView.tsx`'s
  existing Free-plan banner via a new "Upgrade Organization" button — the
  three lock-gated create entry points now open this checkout directly
  instead of a dead-end "contact the platform" message. **Manually
  verified**: applied migration 30 live; POSTed directly to the deployed
  `payment-checkout` function with `scope: 'tenant'` and confirmed a real
  Flutterwave checkout URL plus a correctly-shaped pending
  `user_subscriptions` row (`scope: 'tenant'`, `workforce_id: null`);
  independently simulated the webhook's exact activation SQL to confirm the
  row flips to `active` and `tenants.plan_type` flips to `tier_1`; separately
  confirmed the `tier_2`-downgrade guard by pre-setting the tenant to
  `tier_2` and confirming the guarded promotion UPDATE affected zero rows;
  browser-verified as the real UCH Chief — clicked "Upgrade Organization",
  filled a real email, clicked "Pay with Flutterwave", confirmed a genuine
  Flutterwave-hosted checkout tab opened (closed without entering payment
  details — no live transaction was completed, consistent with every other
  billing verification in this file), clicked "I've completed payment" and
  confirmed the modal correctly reports "not confirmed yet" and closes
  cleanly since no webhook fired. All test rows deleted and the tenant
  reverted to `free_seeded` afterward — no test data left behind. No actual
  end-to-end paid transaction has been run (would move real money on the
  live keys), matching this file's existing note on the per-resident
  checkout below.
- **Flutterwave webhook is relayed through a DIFFERENT PrivyDoc product's backend, not
  registered directly (2026-08-15) — this app shares one Flutterwave account/webhook slot with
  `privydoc_prod`** (a separate, unrelated live telemedicine platform at `app.privydoc.com.ng`,
  repo at `C:\Users\hp\Projects\privydoc_prod` — see that repo's own `CLAUDE.md`; do not confuse
  it with this one). Flutterwave only supports a single webhook URL per account, and that slot is
  already registered to `privydoc_prod`'s own `POST /api/webhooks/flutterwave` (`server.ts`
  ~line 16656). Rather than fighting over the one slot, `privydoc_prod`'s handler now relays: right
  after its own signature check (against the SAME shared `FLW_WEBHOOK_HASH` value both apps use —
  `PD_FLW_Hash_9jaClinic2026`) and before touching its own `payments_log`, it checks whether
  `tx_ref` starts with `privydoc-pro-` (the exact prefix this app's `payment-checkout` function
  stamps on every transaction, which `privydoc_prod` never generates itself) and, if so, forwards
  the untouched payload + `verif-hash` header to this app's `payment-webhook` Edge Function via a
  plain server-to-server `fetch`, then returns — never writing that event into its own tables.
  This app's `FLUTTERWAVE_WEBHOOK_HASH` Supabase secret is set to the same shared value so its own
  independent verification also passes. **Paystack is NOT wired for this app** — the user
  confirmed Flutterwave-only in practice, so the Paystack webhook/code paths remain live in code
  (untested end-to-end) but nothing registers a Paystack webhook pointing here. **Manually
  verified**: `privydoc_prod`'s own verification gate run clean after the relay edit (`npm run
  lint` / `npm test` — 2884 assertions, 0 failures / `npm run build`, all clean); this app's
  `payment-webhook` function live-probed directly with the shared hash (correct → 200, wrong →
  401) after the secret update; test audit row cleaned up afterward. **NOT yet done**: the
  `privydoc_prod` edit is deliberately left staged/uncommitted for the user to review and commit
  themselves (per their explicit choice, given it's live healthcare-platform code this session had
  never touched before) — the relay is NOT actually live until that commit ships; no end-to-end
  real Flutterwave transaction has been run through the relay post-deploy (would move real money).

## Branding & Routing (PrivyDoc rebrand)

The product was rebranded from "FM Residents Dashboard" to **PrivyDoc
Workspace** (branch `feature/gcp-cloudrun-branding-cleanup`):

- **`src/config/branding.ts`** is the single source of truth for user-facing
  product naming. `getActiveBrand()` drives the Navbar brand block and
  `document.title`; `getFooterBrand(session)` is a narrower, session-aware
  variant used only by the footer and (as of 2026-08-14, see below) the
  Navbar's org-label subtitle. Brand selection is cosmetic only — NOT a
  tenant/auth boundary.
- Branding here is PRODUCT naming only; ROLE vocabulary ("Resident", "Chief
  Resident"...) stays with the tenant terminology system in
  `src/lib/terminology.tsx`. **Terminology retrofit (2026-08-15)**: two
  real gaps closed in the same pass — (1) `TerminologyProvider` was
  previously mounted once at `App()`'s root with no `tenantId`, so it was
  permanently pinned to `DEFAULT_TENANT_ID` (UCH) regardless of who was
  actually logged in; a Chief/resident on a non-UCH tenant (self-serve orgs,
  migration 24) would have silently seen UCH's vocabulary. Fixed by moving
  the provider inside `MainAppContent` and computing the active tenant from
  the real session (`currentResident.tenant_id`, or the Chief's
  `fm_chief_tenant_id`). (2) `useTerminology()` now covers every user-facing
  role-word label across the main login flow (`AuthLandingView`,
  `ResidentLoginView`, `ChiefLoginView`), `Navbar`, the Chief dashboard's
  headers/tabs/table/CSV export/toasts (`ChiefDashboardView`), the roster
  HITL editor (`MultiRosterManagerView`), and the review flow
  (`ConsultantReviewView`, `GuestReviewView`) — not just the 3 components
  migration 11 originally wired it into. **Deliberately still hardcoded**:
  `DevHelper.tsx` (dev-only, never rendered in production) and internal
  identifiers/comments/variable names (`currentResident`, `ResidentSession`,
  etc.) — renaming those has no user-facing effect. **Manually verified**:
  `tsc --noEmit` clean; temporarily set a real `terminology_overrides` value
  on the live UCH tenant (`member`→"Trainee", `admin`→"Program Director") and
  confirmed every retrofitted surface picked it up in a real browser session
  (login chooser, Chief portal heading, dashboard header/tabs/table, Navbar
  chip), then reverted — no test data left behind.

**2026-08-14 UX-review fixes** (`workspc.pdf` walkthrough — small, low-risk
items only; see "Backlog: institution-first / self-serve org flow" below for
the larger asks from the same review that were deliberately NOT done here):
- **Domain split retired.** The B2C `doc.privydoc.com.ng` subdomain and its
  hostname-based brand branching are gone — `getActiveBrand()` now always
  returns the B2B/institutional profile (`resolveBrandForHostname` and the
  `B2C_HOSTNAME`/`B2B_HOSTNAME` constants were deleted). The org-vs-individual
  choice lives entirely at `/login` (`AuthLandingView`), which no longer
  pre-highlights either option since there's no hostname signal to base that
  on anymore. If `doc.privydoc.com.ng` DNS/hosting still exists, it now just
  serves the same single B2B-branded app as `workspace.privydoc.com.ng` — no
  separate deploy target was set up for it.
- **`ResidentLoginView`'s portal heading** dropped its `brand.key ===
  'b2c_independent' ? 'Doctor Portal' : 'Resident Portal'` branch (dead now
  that the brand key is always institutional) in favor of
  `` `${t('member', 'Resident')} Portal` `` — same tenant-terminology pattern
  `ChiefLoginView` already used for its admin label.
- **Navbar org-label subtitle** (under "PrivyDoc Workspace") no longer shows
  before anyone is signed in — review annotation: "the institutional label
  only appears after login to an institution." It now mirrors
  `getFooterBrand`'s session-aware logic inline (institutional session →
  `B2B_UCH_BRAND.orgLabel`; unlinked individual-doctor session →
  `B2C_INDEPENDENT_BRAND.orgLabel`; no session → hidden entirely), computed
  from the same `currentResident`/`isChiefAuthenticated`/`currentDoctor`
  props Navbar already receives. `getFooterBrand` itself is unchanged.
- **Copy fixes in `ResidentLoginView`**: submit button "Access My Form" →
  "Access My Workspace" (the monthly form is one module of the workspace,
  not the whole account); footer link "Are you the Chief Resident? Admin
  Portal →" → "Organizational Admin Portal →" (dropped the Chief-Resident
  framing and the tenant-terminology admin word per the review's explicit
  wording).

**Backlog: institution-first / self-serve org flow** (scoped, not built —
flagging per this file's own anti-scope-creep policy, since it implies new
schema/RLS and role-model decisions): the same review asks for (1) a
login flow that asks "select your institution" first (pre-populated with the
seeded tenant, e.g. "UCH Family Medicine") before name+code entry, with a
parallel "not affiliated / individual" path whose accounts get *limited*
tools (e.g. roster-form filling only, no full dashboard) rather than today's
all-or-nothing linked/unlinked split; (2) a self-serve "create a new
organization" flow reachable from the admin-portal link area — no such flow
exists today, `tenants` rows are only ever seeded/provisioned manually (see
SaaS Multi-Tenancy section); (3) repointing `/#admin`-style entry points at a
single "workspace admin panel" that manages organizations, individual users,
and module config together — today `/chief/login` (per-org Chief admin) and
`/saas-operator` (cross-tenant Platform Operator Console) are separate,
differently-scoped surfaces, not one unified panel. None of this was
implemented in the 2026-08-14 pass; it needs its own scoping conversation
before touching schema/RLS.
- **All `/resident/*` routes moved to `/workspace/*`** (and `/resident-form` →
  `/workspace/form`). Old paths silently redirect via `LegacyResidentRedirect`
  in `App.tsx` (query string preserved) — don't remove those redirect routes;
  chief-authored `compliance_nudges` rows in the live DB may still carry old
  `action_link` paths (`ComplianceNudgesView.tsx` also keeps legacy keys in
  its `ACTION_LABELS` map for the same reason).
- Internal view-key identifiers (`'resident-dissertation'` etc. in
  `App.tsx`/`Navbar.tsx`) intentionally kept — they're not user-facing.

**Manually verified in a browser** (after PR #10 merged): every legacy
redirect (`#/resident/login`, `#/resident-form`, `#/resident/research?src=nudge`
— query string preserved — `#/resident/casebook-logbook`,
`#/resident/announcements`, bare `#/resident`) lands on its `/workspace/*`
equivalent; session restore chains correctly through the redirected login
route; Navbar/footer/tab-title all show the new PrivyDoc branding; nav-tab
clicks and compliance-nudge action buttons navigate to the new routes with
views rendering fully; zero console errors against the live DB.
`resolveBrandForHostname` was verified by direct import in the page
(`doc.privydoc.com.ng` → B2C profile; `localhost`/other hosts → B2B UCH) since
a hostname can't be faked in a local browser session. Still NOT verified:
the Docker container itself (Docker not installed on this machine — see
Deployment below).

## Deployment

- **Netlify**: `netlify.toml` configures `npm run build` → `dist/`, with SPA
  fallback redirect (`/* → /index.html`, 200).
- **GCP Cloud Run**: `Dockerfile` (multi-stage: `node:20-alpine` build →
  `nginx:alpine` serving `dist/` on port 8080), `nginx.conf` (SPA fallback,
  security headers, immutable caching for hashed `/assets/`), and
  `cloudbuild.yaml` (build → push to Artifact Registry repo `privydoc`,
  image `doc-workspace` → deploy Cloud Run service `privydoc-doc-workspace`
  in `europe-west2`, `--allow-unauthenticated`). Vite bakes `VITE_*` vars at
  build time, so the Supabase URL/anon key flow in as `--build-arg`s from the
  `_VITE_SUPABASE_URL`/`_VITE_SUPABASE_ANON_KEY` trigger substitutions —
  Cloud Run runtime env vars would be invisible to the static bundle.
  **Status: deployed and live** — service URL
  https://privydoc-doc-workspace-62182046731.europe-west2.run.app (project
  `privydoc-500414`), built via manual `gcloud builds submit` (pass
  `COMMIT_SHA=<sha>` in `--substitutions`; manual builds don't auto-bind it)
  and verified serving with the nginx security headers. Setup that was needed
  once: Artifact Registry repo `privydoc` created; the default compute SA
  (`62182046731-compute@...`, this project's Cloud Build SA) granted
  `cloudbuild.builds.builder`, `run.admin`, and `iam.serviceAccountUser`.
  The Dockerfile explicitly installs the rollup/lightningcss/tailwind-oxide
  Linux-musl native binaries after `npm ci` — the Windows-generated
  package-lock.json omits them (npm/cli#4828) and the Alpine build fails
  without each of them in turn; don't remove those installs. **CI/CD is live**:
  GitHub trigger `deploy-doc-workspace-main` (global region, 1st-gen GitHub
  App repo link, branch `^main$`, `cloudbuild.yaml`, both `_VITE_*`
  substitutions, service account = the compute SA above) auto-builds and
  deploys every push to `main`. It had to be created through the console UI —
  `gcloud builds triggers create github` kept returning an opaque
  INVALID_ARGUMENT even with the repo connected (a CLI/API quirk; the console
  form with identical parameters worked). An org policy on this project
  requires triggers to name a user-managed/explicit service account — and any
  build running under an explicit SA must declare a logging mode, which is why
  `cloudbuild.yaml` sets `options: logging: CLOUD_LOGGING_ONLY`. Don't remove
  it: without it every triggered build fails instantly with "must either
  specify 'build.logs_bucket' ..." (the trigger's very first run failed
  exactly this way; fixed in commit b9fe843, whose own triggered build then
  succeeded and deployed).
- **Firebase Hosting fronting**: site `privydoc-doc-workspace`
  (https://privydoc-doc-workspace.web.app) rewrites every path (`**`) to the
  Cloud Run service via `firebase.json` + `.firebaserc` (deploy target
  `doc-workspace`). ⚠️ This project's DEFAULT hosting site
  (`privydoc-500414.web.app`) serves a DIFFERENT live PrivyDoc product, and
  `privydoc-root-redirect.web.app` 301s to app.privydoc.com.ng — never deploy
  hosting to those from this repo. `firebase.json` deliberately defines ONLY
  the `doc-workspace` target so a bare `firebase deploy --only hosting`
  cannot touch them. `firebase-hosting-empty/` must stay empty: any static
  file there would shadow the Cloud Run rewrite. Note the hosting layer
  caches: Cloud Run serves `index.html` with `no-cache` so HTML stays fresh.
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

## Module admin-content build-out progress (2026-08-14, ongoing)

Phased effort extending org-admin (and app-operator) content control across
the dashboard modules, following the 2026-08-14 scoping audit's recommended
sequencing. Each phase is scoped/researched before building — see the
per-phase notes elsewhere in this file (Casebook & Logbook Engine section
for the Template Manager, Billing section for operator analytics/AI-rigor)
for the ones already shipped. This section tracks the smaller module-by-
module wiring pass:

- **Casebook Builder (old 15-slot MVP) — SHIPPED**: `TenantCustomizationView`
  already let a Chief set `module_flags.case_reports_required_count`, but
  `CasebookBuilderView.tsx` never read it (hardcoded `Array.from({length:
  15}, ...)`) — now wired through, clamped to 1-15 client-side since
  `case_reports.case_number` has a DB-level `CHECK (case_number BETWEEN 1
  AND 15)` (migration 04). Raising the ceiling above 15 needs a migration
  widening that CHECK — not attempted, flagged as a follow-up if a program
  ever needs more than 15 cases.
- **Exam Readiness — DELIBERATELY SKIPPED, not an oversight**: audited and
  found NOT to be a real gap. Its four pillars (dissertation/ethics,
  15-casebook, roster compliance, Evidemy+logbook+fees+forms) mirror the
  actual WACP/NPMCN eligibility structure set by the certifying college —
  fixed by external regulation, not something a program would want to
  relabel or reorder per-tenant. `exam_readiness`'s schema (fixed named
  columns, migration 05) already reflects this; building a flexible
  per-tenant checklist model here would be schema churn for a requirement
  nobody has. If a future need for genuinely tenant-custom checklist items
  emerges, revisit — don't assume this was simply missed.
- **Viva Simulator — SCOPED, NOT BUILT (its own future phase)**: real gap.
  `OralExamSimulatorView.tsx`'s 5 practice vignettes are hardcoded in the
  component (`VIGNETTES` array), identical for every tenant regardless of
  specialty mix, and explicitly labeled non-authoritative practice content.
  `viva_simulations` (migration 05) only stores session *scores*, not
  question-bank content — there's no existing flag/table to wire through
  like the Casebook Builder fix above. A real slice needs a new
  tenant-scoped `viva_vignettes` table, SECURITY DEFINER CRUD RPCs mirroring
  the Template Manager's `casebook_templates` pattern, an admin editor tab,
  and switching the component from the static array to a live fetch —
  comparable in size to the whole Template Manager phase, not a small
  wiring fix. Not started.

## Sourcing module content (templates, rubrics, curricula, reference docs)

The multi-module admin/content build-out (Research Engine, Casebook &
Logbook, and the other dashboard modules — see the 2026-08-14 scoping
audit referenced from the Branding & Routing section) will need real
templates, rubrics, curricula, and guideline documents per module, not
placeholder content. Per the user (Dr. Olanipekun): don't silently
fabricate or guess at documents that should be authoritative (WACP/NPMCN
rubrics, institutional guidelines, sample dissertations, etc.) — if a
needed reference document can't be reliably found/verified online, ask
the user for it explicitly so they can supply it (they hold a number of
these already). Once the relevant module's admin-content tooling exists,
Dr. Olanipekun also wants a way to pre-populate his own guidelines/
documents directly through it, rather than only via ad hoc seeding —
build that content-entry path with that self-service use in mind when
it's reached.
