# Tenancy / Authentication / Authorization / RLS Recovery Specification (Slice 4 — DISCOVER + PLAN)

Status: **proposed, unreviewed. Not committed. No code/schema/migration/RLS/auth
change made to produce this document.**
Scope authority: `docs/WORKSPC_PRODUCT_CONSTITUTION.md` §14/§17/M5.
Revision 2 (2026-08-20): revised per locked review decisions — `tenants` is
now named Priority 0 with its real consumer dependencies documented (§4a);
Supabase Auth is locked as the preferred institutional-auth target, not a
bespoke token system (§7); rotations' long-term direction is locked
organisation-configurable (§2); the second-organisation gate gains an 8th,
automated-testing condition (§9); the RLS transition strategy in §10 is
corrected — multiple permissive PostgreSQL policies do not compose into a
narrowing, so the "add alongside, verify, then drop" plan in the prior
revision was invalid and has been replaced; explicit findings added for
Edge Functions (§4b) and the `form_entries` mismatch's forward implication
for Workforce read-path authority (§4c); the implementation sequence is
revised accordingly (§11).

Purpose: determine the smallest safe evolutionary path to genuine organisation
isolation, and specifically whether the approved Workforce Option A (read-only
reconciliation, `docs/WORKFORCE_V1_RECOVERY_SPEC.md`) can safely be implemented
for the current single-organisation deployment **before** that remediation.

All findings below are source/migration-file evidence, produced by four
independent read-only research passes plus this document's own synthesis. No
live database was queried at any point. Per `docs/WORKSPC_PRODUCT_CONSTITUTION.md`
M10: **migration file exists ≠ approved ≠ applied.** Every claim in this
document is a claim about what the repository's source says, not about
verified live state, unless explicitly marked otherwise — and nothing below is
marked otherwise, because no live check was performed.

---

## 1. Current identity model (verified, not aspirational)

Four parallel, structurally disconnected identity mechanisms exist. None of
the first three produces a server-verifiable session.

| # | Mechanism | Session storage | How established | Real `auth.uid()`? |
|---|---|---|---|---|
| A | Resident/member (institutional) | `localStorage['fm_session_resident']`, plain JSON | `ResidentLoginView.tsx` → `verify_resident_login` RPC → client builds the session object itself and stores it | **No.** Anon key only. |
| B | Chief/admin (institutional) | `localStorage['fm_session_chief']='true'` + `fm_admin_code` + `fm_chief_tenant_id` | `ChiefLoginView.tsx` → `verify_chief_login` RPC resolves `tenant_id` server-side from the plaintext code → client sets a boolean and re-stores the raw code for reuse on every later privileged call | **No.** |
| C | Individual doctor | Real Supabase Auth JWT | `DoctorAuthView.tsx` → real `supabase.auth` email+PIN sign-in (migration 18) | **Yes** — the only real one. |
| D | Platform operator | Not app-session-tracked; gated per-screen | `SaaSOperatorConsoleView.tsx` → `verify_platform_operator_code` RPC, same shared-code pattern as A/B | **No.** |

**Convergence point**: once a doctor session (C) is linked to a `workforce`
row (`workforce.doctor_id`, set only via a Chief-gated RPC), the app
synthesizes a resident-shaped session from it and treats the doctor
identically to path A from then on for every subsequent institutional
read/write — the one real `auth.uid()` in the whole system stops being
consulted for anything `/workspace/*` does next.

**Tenant resolution** (`App.tsx`), verified exactly:
```
activeTenantId =
  currentResident?.tenant_id
  || (isChiefAuthenticated ? localStorage.getItem('fm_chief_tenant_id') : null)
  || incomingLoginTenantId
  || DEFAULT_TENANT_ID
```
A four-step fallback chain ending in a **hardcoded** tenant id, reached by
every session type, including pre-login. Classification: **global/hardcoded
fallback**, not organisation-scoped by construction.

**Role/permission storage — two systems, one dead, one live-but-weak**:
- `roles`/`user_roles` (migration 01) were built around `auth.uid()`/
  `has_role()` — **dead scaffolding**. Their own later migration (36)
  documents this directly: the original `TO authenticated` policies were
  *"unreachable by this app's anon-key-only client"* and had to be widened to
  `USING(true)` just to make the table readable at all. The `roles_mutate`/
  `user_roles_mutate` policies (still gated on `has_role()`) remain
  **permanently unreachable** from the app's actual institutional session
  population — a control that can never fire, not a real gate.
- `org_groups` (migration 36) is the real, live delegatable-role mechanism —
  tenant-scoped by column, but its SELECT policy is `USING(true)` for
  `anon, authenticated` (readable across every tenant by anyone with the anon
  key; not isolated between tenants).
- The actual live authorization signal the app computes
  (`currentResident.subadminRoles`) is derived **client-side**, in React
  state, then trusted as a UI prop for gates like `canApprove`.

**Classification summary** (per the categories requested):
- **Global, hardcoded**: `DEFAULT_TENANT_ID` fallback; the dead `has_role()`
  policies.
- **Organisation-scoped, real** (by column, not by cross-tenant RLS
  isolation): `org_groups`, `workforce.tenant_id`, `settings.tenant_id`.
- **Doctor-specific, real**: `doctor_profiles` RLS — the **only**
  genuinely `auth.uid()`-enforced boundary anywhere in this identity chain.
- **Inferred from UI state only**: `subadminRoles` as consumed by
  `canApprove`/`canManageLogbooks` props.
- **Not bound at all**: every institutional (path A/B/D) database call after
  login. There is no session token of any kind for these paths — every
  subsequent request is anon-key-plus-whatever-parameters-the-client-sends.
  **This is the single most load-bearing fact in this document.**

---

## 2. Current organisation/tenant model

- **`tenants`** (migration 11): one row = one hospital/department deployment.
  Only one seeded row exists today (UCH Family Medicine). Columns include
  `plan_type`, `status`, `module_flags`, `terminology_overrides`.
- **No `workspaces` table exists.** "Workspace" is a routing term
  (`/workspace/*`) only, denoting institutional session context — not a
  distinct entity. Individual doctor "personal workspaces" (migration 25) are
  **not tenant-scoped at all**: a doctor-owned `research_workspaces`/
  `casebook_workspaces` row has `tenant_id = NULL`, a second, independent
  ownership dimension (`doctor_id`) entirely outside the tenant model.
- **No explicit membership table.** Membership is implicit via
  `workforce.tenant_id` (one value, no history, no time bounds).
  `workforce.doctor_id` links a doctor identity to a workforce row and is
  **not database-unique** — the schema permits one doctor linking to multiple
  workforce rows across tenants, but the client only ever reads the
  most-recently-linked one. Multi-org membership is schema-permitted, not
  implemented.
- **`org_groups` vs. legacy `roles`: they coexist by explicit design.**
  Migration 36's own header states `roles`/`user_roles.role_id` were
  deliberately not dropped — `'resident'`/`'super_admin'` remain fixed
  platform-level identities; only the *delegatable subadmin* vocabulary moved
  to `org_groups`.
- **`tenant_id` coverage** — three populations:
  1. Tables **built with `tenant_id` from birth**, generally paired with real
     doctor-owned `auth.uid()` RLS where relevant: `research_templates`/
     `research_workspaces` onward through `personal_tasks`/`wellbeing_entries`/
     `focus_sessions`/`scheduling_*`/`meeting_*`/`clinical_document_*`/
     `rubric_*` (migrations 13→51/57).
  2. Legacy tables **retrofitted** with `tenant_id` via `ALTER TABLE` in
     migration 11 (`workforce`, `collections`, `combined_master_rosters`,
     `announcements`, `knowledge_packs`, `dissertations`, `case_reports`,
     `exam_readiness`, `viva_simulations`) or migration 23 (`settings`) — all
     backfilled to the single seeded tenant.
  3. Tables with **no `tenant_id` at all**: `tenants` itself (top of
     hierarchy), `platform_operators`/`saas_operator_logs` (deliberately
     above the tenant model), `roles`/`user_roles`/`rotations` (still global),
     **`submissions`** (confirmed no column exists — migration 11's own
     header calls this a deliberate scope exclusion, "a known gap for a
     future migration," not an oversight), plus numerous child tables scoped
     only by joining to a parent.
- **`submissions` and `rotations` cannot currently be attributed to one
  organisation without a join** (`submissions` → `workforce.tenant_id`,
  one hop; `rotations` has no owning row to join through at all — it is a
  single flat list every tenant shares).
- **Decoupling, stated explicitly by the repo's own authors — the single
  most important structural fact in this section**: migration 11's header
  states verbatim: *"TENANT ISOLATION IS CLIENT-ENFORCED, NOT RLS-ENFORCED...
  This is NOT a real security boundary... A determined anon-key holder can
  still read across tenants directly via the REST API."* Having a
  `tenant_id` column was never treated as equivalent to RLS enforcement
  anywhere in this repo's history — the two were consistently, deliberately
  decoupled.

---

## 3. RLS inventory — Workforce V1 and its foundations

`current` = the latest policy found for each table (later migrations
routinely `DROP POLICY IF EXISTS` + `CREATE POLICY` to replace, not append).
**Live application of every row below is UNKNOWN — not verified against a
live database in this pass, per this document's own ground rules.**

| Table | RLS enabled | Access model (current) | Introduced/last changed |
|---|---|---|---|
| `doctor_profiles` | yes | Owner-scoped, real `auth.uid() = id`, `authenticated` only, no `anon`. **The only real boundary in this inventory.** No INSERT policy — rows created only via a `SECURITY DEFINER` trigger. | migration 18 |
| `workforce` | yes | `USING(true)` for `anon, authenticated` (SELECT/UPDATE). No INSERT/DELETE policy found. `resident_code` column is separately locked via an explicit `GRANT` allow-list (migration 02) — a real, correctly-implemented mitigating control distinct from row-level scoping. | migration 01 (never revised) |
| `collections` | yes | `USING(true)` (SELECT/INSERT/UPDATE) | migration 01 |
| `submissions` | yes | `USING(true)` for `public` (SELECT/INSERT/UPDATE). **No `tenant_id` column exists** — org-scoped RLS is not structurally possible without a schema change or a join-based policy. No column-level lockdown either (unlike `workforce`/`settings`) — leave dates and uploaded documents are fully public to the anon key. | `schema.sql` base, never revised |
| `rotations` | yes | `USING(true)` (SELECT + ALL). No `tenant_id` column — single global list shared by every tenant. | migration 01 |
| `raw_roster_uploads` | yes | `USING(true)` (SELECT/INSERT, append-only by design) | migration 10 |
| `combined_master_rosters` | yes | `USING(true)` (SELECT/INSERT/UPDATE) | migration 10 |
| `roster_types` | yes | `USING(true)` (SELECT only; static reference data) | migration 10 |
| `announcements` | yes | `USING(true)` (SELECT + ALL) | migration 01 |
| `tenants` | yes | **`USING(true)` for SELECT, INSERT, and UPDATE, for `anon`.** The organisation table itself — including `plan_type`, `status`, `module_flags` — is world-readable and world-writable at the RLS layer. **Highest-severity single finding in this inventory.** **CORRECTION (2026-08-21, Governance/Registry Reconciliation) — CLOSED for INSERT/UPDATE: migration 63 (`63_tenants_drop_permissive_insert_update.sql`) dropped the permissive `tenants_insert`/`tenants_update` policies live; every legitimate mutation now goes through a `SECURITY DEFINER` RPC instead (see `docs/TENANT_SURFACE_SECURITY_SPEC.md`). SELECT remains `USING(true)` by design, deferred pending Institutional Auth — the finding is preserved above as originally written; only the INSERT/UPDATE half is superseded.** | migration 11; INSERT/UPDATE closed by migration 63 |
| `roles` | yes | Read permissive; mutate gated on `has_role(['super_admin'])`, which is **structurally unreachable** from the app's actual session population (§1) — not a real control in practice. | migration 01 |
| `user_roles` | yes | Read widened to `USING(true)` by migration 36 specifically because the prior `authenticated`-only policy was unreachable; mutate still gated the same unreachable way as `roles`. Real mutation happens through `SECURITY DEFINER` RPCs that bypass row policies entirely. | migration 01 (mutate) / 36 (select) |
| `org_groups` | yes | Read `USING(true)`, readable across every tenant; mutate appears RPC-mediated (not independently confirmed by reading RPC bodies in this pass). | migration 36 |
| `form_instances` | yes | Mixed: institutional and global-seed rows (`tenant_id`/`doctor_id` both null) permissive; only purely doctor-claimed rows require matching `auth.uid()`. | 35 → 40 → 42 (current) |
| `form_entries` | yes | Join-based to parent `form_instances`. **Confirmed stale**: this policy was last touched by migration 40, before migration 42 added the global (both-null) ownership shape to the parent — a global-seed instance's entries would fail this table's EXISTS check today. Newly discovered, not previously documented. | migration 35 → 40 (current, not touched by 42) |
| `event_log` | yes | `USING(true)` (SELECT/INSERT/UPDATE) | migration 32 |
| `insights` | yes | `USING(true)` (SELECT/INSERT/UPDATE); not confirmed whether migration 49 (doctor-scope extension) added any new policy | migration 37 (current, per available evidence) |
| `agent_manifests` | yes | `USING(true)` (SELECT/INSERT/UPDATE) | migration 34 |

**Summary**: of 18 tables inventoried, **17 have at least one `USING(true)`
policy reachable by `anon`** — every one except `doctor_profiles`. Newer
modules (Scheduling/Meetings/Clinical Writing/Rubric, migration 57) added a
real doctor-owned `auth.uid()` boundary, but only for the doctor-claimed
subset of their own rows — institutional and global rows in those same
tables remain exactly as permissive as everything else.

---

## 4. Trust-boundary failures — repository-proven vs. live-unknown

### 4a. `tenants` — Priority 0, the highest-priority individual security defect found

**Any anon-key holder can read and modify any tenant's row in `tenants`
itself** — including `plan_type`, `status`, and configuration columns. This
is treated as **Priority 0**: not a cross-tenant leak of operational data,
but a leak of the tenant boundary's own definition — every other finding in
this document assumes tenant identity means something, and this finding is
the one case where that assumption itself is unenforced.

**Anonymous discovery and anonymous mutation are two different problems, not
one.** The target distinction, for a future Priority-0 spec (not designed
here): unauthenticated users may eventually need only the minimal public
organisation-discovery data required for login (e.g. tenant name/short_code
for a selector screen) — not full-row read, and never write. Tenant
configuration writes belong behind an authorised, server-verifiable
capability. Closing this finding is therefore two separable questions (what
minimal read is genuinely needed pre-auth vs. how writes get authorised), not
one blanket "lock everything."

**Current application dependency on the permissive policy — verified by
reading every direct caller, not assumed:**

| Function (`databaseService.ts`) | Mechanism | Depends on permissive `tenants` RLS? |
|---|---|---|
| `createTenantWithAdmin()` (self-serve org creation, migration 24) | `SECURITY DEFINER` RPC `create_tenant_with_admin` | **No** — the RPC bypasses row policies entirely. This is the safe pattern already proven to work in this codebase. |
| `createTenant()` / `createTenantWithPaystackSubaccount()` (platform-operator tenant creation) | Direct `.from('tenants').insert(...)` | **Yes** |
| `updateTenantPlan()` | Direct `.from('tenants').update(...)` | **Yes** — called from `TenantUpgradeCheckoutModal.tsx` (billing checkout) and `SaaSOperatorConsoleView.tsx` |
| `updateTenantStatus()` | Direct `.from('tenants').update(...)` | **Yes** — called from `SaaSOperatorConsoleView.tsx` |
| `updateTenantTerminology()` | Direct `.from('tenants').update(...)` | **Yes** — called from `TenantCustomizationView.tsx` (Chief session) |
| `updateTenantModuleFlags()` | Direct `.from('tenants').update(...)` | **Yes** — called from `TenantCustomizationView.tsx` (Chief session) |

**Implication**: one real flow (self-serve tenant creation) already proves the
RPC-bypass pattern works cleanly for this exact table. The remaining five —
platform-operator tenant creation/status changes and Chief-side terminology/
module-flag customization — would break immediately if the permissive policy
were removed without first rerouting each through an equivalent
`SECURITY DEFINER` RPC (mirroring the `create_tenant_with_admin`/`chief_*`
pattern already established elsewhere in this schema). **No policy is
changed in this slice** — this table is documented, not touched.

### 4b. Repository-proven, remaining findings

1. **Any anon-key holder can read and write `workforce`, `submissions`,
   `collections`, `combined_master_rosters`, `raw_roster_uploads`,
   `announcements`, `org_groups`, `event_log`, `insights`, `agent_manifests`
   across every tenant** — RLS places no boundary between organisations on
   any of these tables today.
2. **`submissions` has no `tenant_id` column**, so even a future RLS policy
   attempt on this table cannot scope by tenant without either a schema
   change or a join through `workforce_id`.
3. **The institutional login flow (paths A/B/D, §1) produces no server-
   verifiable session at all.** Every RPC that does enforce a real
   tenant-boundary check (the `chief_*` RPCs, confirmed genuinely well-built
   — see §5) does so by trusting a client-supplied `p_admin_code` parameter,
   not an authenticated session. Anyone in possession of a valid
   `admin_access_code` — via network inspection, a shared device's
   `localStorage`, or by reading it directly out of the permissively-`SELECT`-
   able `settings` table were its column not separately locked (it is,
   migration 02) — gets Chief-equivalent access without ever touching the
   React app.
4. **A self-admitted, documented bypass**: migration 06's own header states
   that even though `submit_consultant_review()` does a real server-side
   role check, `dissertation_milestones.status`/`case_reports.status` still
   carry permissive UPDATE RLS from migration 04 — *"a resident could still
   directly set their own item to 'approved' via a raw API call, bypassing
   the review flow entirely."*

### 4c. Edge Functions — no-JWT invocation, client-supplied tenant context

**Finding**: every Edge Function in this repo is deployed with
`--no-verify-jwt`, and `roster-parser` (and the other AI Copilot functions)
accept a client-supplied `tenant_id` used for quota accounting with **zero
server-side verification** that the caller actually represents that tenant
(detail in §5). This is consistent with — not separate from — finding 3
above (no server-verifiable session exists yet to check against).

**Forward-looking requirement, not a change made here**: this posture must
not become the basis for multi-tenant or paid automation execution. Per the
Product Constitution §11, automation execution must be attributable and
auditable and must derive from explicit delegation — a cost-bearing or
privileged Edge Function that trusts an unverified client-supplied tenant_id
cannot satisfy that once real money or autonomous action is on the line. The
institutional-auth recovery (§7, §11 sequencing) must eventually provide
server-verifiable caller/tenant context for privileged or cost-bearing Edge
Functions before any such use proceeds.

**Not a blocker to Workforce Option A**: Option A adds no new Edge Function
privilege or invocation path — it calls no Edge Function at all. This finding
is recorded for the automation/paid-Edge-Function future, not as a condition
on Option A.

### 4d. `form_entries` RLS mismatch — recorded as a known Forms defect, not fixed here

The parent/child ownership-policy mismatch found in §3 (`form_entries`'s
policy is stale relative to `form_instances`'s current three-way ownership
shape) is recorded here as a **known Forms access/integrity defect**. Not
fixed in this slice — no schema, RLS, or code change was made.

**Forward-looking constraint**: the generic Forms & Pipelines engine
(`form_instances`/`form_entries`) must **not** become the authoritative
Workforce read path — including for any future Option B or Workforce-state
generalisation work — until this ownership/RLS mismatch has been
independently understood and resolved. This is directly relevant because
`docs/WORKFORCE_V1_RECOVERY_SPEC.md` already documents `form_entries` as an
unread, one-way mirror of `submissions` — this finding is an additional,
independent reason not to promote it to authoritative status prematurely,
on top of it simply having no reader today.

**Live-exploitability unknown** (cannot be established without live database
access, which this task does not have and did not attempt):
- Whether any of the above has ever actually been exploited, accidentally or
  otherwise.
- Whether Supabase-level network/API restrictions (IP allowlisting, WAF
  rules, rate limiting configured outside the repository) narrow the
  practical blast radius of any of the above. **Not found in this
  repository** — if such controls exist, they exist outside what a source
  read can confirm, and must not be assumed present.
- Current row counts / actual data sensitivity exposed at this moment (e.g.,
  how many real leave documents, real names, real admin codes exist in the
  live database right now).
- Whether the currently-single-tenant deployment means the `tenants` finding
  (§4a) and finding 1 above (cross-tenant read/write on operational tables)
  have *any* cross-tenant target to reach today (see §8 — they do not, yet,
  because there is only one tenant; this does not make either finding
  untrue, only currently unexploitable in the cross-tenant dimension
  specifically).

No penetration testing or production mutation was performed or attempted to
produce this document.

---

## 5. Authorization model across layers

| Layer | Enforcement reality |
|---|---|
| **Database/RLS** | Not the enforcement mechanism for the Workforce/Roster path — permissive across the board (§3). One partial exception: `consultant_reviews` has no INSERT/UPDATE policy at all; writes are RPC-only. |
| **Server/Edge Functions** | **Every Edge Function is deployed with `--no-verify-jwt`**, with comments in-source stating the reason plainly: *"this app has no Supabase Auth sessions to verify."* `roster-parser` accepts a client-supplied `tenant_id` used only for AI-quota accounting — **zero verification that the caller is that tenant's Chief.** |
| **Server/`SECURITY DEFINER` RPCs** | **The real, and genuinely well-built, server-side gate.** Every `chief_*` RPC resolves `v_tenant_id` from `p_admin_code` server-side, then checks every target row actually belongs to that resolved tenant before acting (e.g. migration 36's `chief_assign_user_role`). This is real tenant-boundary enforcement, independent of RLS — but it authenticates a **shared secret**, not a session: no token, no expiry, no rate limiting found anywhere in the RPCs read. |
| **Application/service layer** (`databaseService.ts`) | `submitRoster()` performs **no authorization check of any kind** — a plain insert/update against a client-supplied `workforce_id`. Since `submissions` RLS is permissive, this function will execute for any caller with a valid anon-key client, writing to any `workforce_id` in any tenant. Reads (`getSubmissions()` etc.) have the same absence of caller-identity checks. |
| **React/UI gating** | `isChiefAuthenticated` is a plain client-side boolean, restored from `localStorage`, gating **routes only**. The server never sees this flag. `canApprove` (`subadminRoles.length > 0`) is a plain prop derived client-side. |

**Capabilities protected only by UI visibility** (RLS/RPC layer would allow
these to anyone with the anon key today):
- Submitting or editing a `submissions` row for any `workforce_id`, in any
  tenant.
- Reading `workforce`/`submissions`/`collections`/`combined_master_rosters`/
  `raw_roster_uploads` for any tenant — no admin code or session required.
- Setting `dissertation_milestones.status`/`case_reports.status` to
  `'approved'` directly via a raw table write (bypassing the one RPC that
  does check).
- Invoking `roster-parser` with an arbitrary `tenant_id` — nothing server-side
  confirms the caller is that tenant's Chief.

**Global-role-without-organisation-context**:
- `isChiefAuthenticated` itself carries no tenant scoping in the flag; the
  accompanying `fm_chief_tenant_id` is client-asserted and stored alongside
  it, with nothing forcing the two to agree if they ever diverged in
  `localStorage`.
- `canApprove={currentResident.subadminRoles.length > 0}` — a global "holds
  any subadmin role" check at its call site, with no explicit tenant
  comparison visible there (the underlying RPC scopes correctly via
  `reviewer_workforce_id`'s own tenant, but the client-side gate itself
  asserts no organisation context).

---

## 6. Automation implications (prerequisites only — not an Automation Engine design)

Per the Product Constitution §11, every automation execution must be
**attributable and auditable**, and automation authority must derive from
**explicit human/organisational delegation** — never assumed. Two structural
gaps block this today, both already surfaced independently in earlier slices:

1. **No real per-session identity exists for the institutional flow (§1).**
   An automation acting "on behalf of" a Chief or a resident needs a real
   actor to attribute its actions to and a real delegation boundary to stay
   inside. Today there is nothing for that delegation to bind to — a
   `p_admin_code`-style shared secret is not an identity an automation's
   authority can be scoped against safely.
2. **`event_log` has no per-actor column at all** (confirmed independently
   in Slice 2's registry work — this is why `udr.audit[]` is hardcoded
   empty). Attributability requires recording *who or what* triggered an
   event; the current event infrastructure cannot express that yet, for
   humans or automations alike.

Both are **prerequisites**, not blockers to Workforce V1 recovery itself —
Option A (§8) requires neither. They become blockers only once any
A2/A3-level automation (prepare-and-approve or execute-within-delegation) is
proposed. Not designing that engine here, per this slice's scope — only
naming that its authorization foundation does not yet exist.

---

## 7. Evolutionary target (smallest defensible path)

**Institutional authentication target — locked**: Supabase Auth is the
preferred target authentication foundation for institutional members/admins,
converging with the one real authenticated identity path already present in
this repository (`doctor_profiles`, migration 18 — path C in §1). A bespoke
signed-token system built around the plaintext access-code model is **not**
the preferred architecture. Access codes may survive as
enrolment/verification/invitation or low-friction authentication UX (e.g.
"enter your 6-digit code to claim your account"), but they must not remain
the durable server-side identity/authorization credential. A bespoke token
system would require its own later, explicit human decision, supported by
evidence that the Supabase Auth route is genuinely unsuitable — not assumed
as a fallback here.

```
Supabase Auth security principal
  → persistent Workspc Person
  → contextual Membership (person, organisation, role, time-bounded)
  → Organisation/workspace context (resolved from the verified principal, not a fallback chain)
  → Role/Group (org_groups — already real, reuse as-is)
  → explicit capability (grants_review_approval and future capability bits — already real, reuse as-is)
  → authorised domain action (the existing chief_* RPC pattern — already real, reuse as-is)
  → backend/RLS enforcement (keyed off the verified principal, not USING(true))
```

**What already exists and should be reused, not rebuilt**:
- The real `auth.uid()` path (`doctor_profiles`) is the convergence target
  itself, not a separate thing to design — institutional members/admins
  moving onto Supabase Auth means they gain the same kind of identity
  individual doctors already have, not a third, new mechanism.
- `org_groups` is a working, tenant-scoped, contextual role/permission model
  — the target's Role/Group and explicit-capability layers are substantially
  already built. The gap is not this layer; it's everything above it in the
  diagram.
- The `chief_*` `SECURITY DEFINER` RPC pattern already does real
  tenant-boundary checks inside the function body. This is the right shape
  for "authorised domain action" — the gap is what identity it trusts (a
  shared secret, not a Supabase Auth principal), not the pattern itself.
- `workforce.tenant_id` / `doctor_profiles` / `org_groups` already give
  most of the *shape* of Membership, just without a dedicated table or
  temporal tracking.

**What's missing, smallest version**:
- **Real Supabase Auth principals for the institutional flow** — the single
  root-cause gap everything else in this section depends on. This is a
  convergence with the existing doctor-identity path (§1 path C), not a new
  parallel mechanism. Exact migration/rollout mechanics (how existing
  residents/Chiefs acquire a Supabase Auth identity without a disruptive
  re-registration event) belong to the Institutional Auth Migration Spec
  named in §11, not decided here.
- `submissions.tenant_id` (schema addition + backfill) — the one clear
  schema gap, since no column exists to scope by at all today.
- RLS policies on the core operational tables rewritten to check the
  verified principal's tenant against the row's tenant, replacing
  `USING(true)` — exact mechanics deferred to §10's corrected strategy.
- `tenants`' own RLS closed to something narrower than world-writable (§4a,
  §9), including rerouting its five currently-permissive-policy-dependent
  call sites (§4a) through RPCs first.

**No big-bang rename or schema rewrite is proposed.** Repository evidence
does not show a case where an evolutionary route is unavailable — `org_groups`,
the RPC pattern, and the tenant_id-on-most-tables convention are all sound,
reusable foundations. The gap is narrow and specific: real session identity,
one missing column, and a policy rewrite on a bounded table list.

---

## 8. Workforce Option A safety decision

## **A. SAFE TO IMPLEMENT NOW**

**Reasoning, against each required consideration:**

- **Option A's read paths**: `submissions`, `workforce`, `rotations`,
  `combined_master_rosters` — all four are tables the Chief-authenticated
  `MultiRosterManagerView.tsx`/`SubmissionsPanel.tsx`/`WorkforceRegistryPanel.
  tsx` already read and render today, individually, in sibling panels of the
  exact same dashboard. Option A adds **no new table, no new RLS policy, no
  new RPC, and no new read permission** — it computes a derived
  cross-reference over data the same already-authenticated session already
  has full read access to and already displays elsewhere.
- **Current deployment is single-organisation**: the severe cross-tenant
  findings in §4 (the `tenants` Priority-0 finding, §4a, and finding 1 of
  §4b) describe a real vulnerability *class*, but there is currently only
  one tenant for it to leak *between*. Option A does
  not touch, worsen, deepen, or interact with that vulnerability in any
  way — it performs no cross-tenant query, no tenant-spanning join, and
  operates entirely within whatever single `activeTenantId` the surrounding
  already-loaded dashboard is already scoped to.
- **New data exposure**: none. Every field Option A reads (leave dates,
  rotation values, `on_floor`, grid contents) is already independently
  visible to the same Chief session in an adjacent panel of the same
  dashboard. Cross-referencing two already-visible facts into one derived
  signal does not cross a permission boundary that did not already not
  exist — it's the security equivalent of a UI convenience feature, not a
  new grant.
- **Client-side-only authorization reliance**: Option A introduces none. It
  rides on exactly the same (weak — see §1/§5) `isChiefAuthenticated` gate
  already protecting the page it lives inside. It does not make that gate
  weaker, and it does not add a new privileged action, write path, or RPC
  that this gate would need to protect on Option A's behalf.
- **Access expansion**: none — it is read-only, writes nothing to
  `workforce.on_floor`, any grid, or `submissions`, per the approved Slice 3
  spec.

**Explicit boundary on this recommendation**: this "safe" verdict is scoped
**precisely to Option A as specified** — read-only, embedded in the existing
authenticated view, no new table/RLS/RPC/write. It is **not** a statement
that the platform's tenancy/RLS model is safe in general, and must not be
read that way. The findings in §3/§4 remain real, severe, and unresolved
regardless of this recommendation. **Single tenant today is not being
equated with secure** — it is one specific, narrow, read-only feature being
judged safe against the vulnerability surface it actually touches, which is
none beyond what already exists.

Why not **B** (narrow auth prerequisite first): a prerequisite would be
relevant if Option A introduced a new write, a new cross-tenant read, or a
new privileged action. It introduces none of these — there is nothing for an
auth prerequisite to gate that isn't already gated (however weakly) by the
page Option A lives inside.

Why not **C** (block until tenancy remediation): blocking a zero-write,
zero-new-access, already-single-tenant-scoped UI feature on unrelated
platform-wide tenancy remediation would conflate two different risk
surfaces, stall legitimate Workforce V1 recovery, and close no actual gap —
the vulnerabilities in §4 exist with or without Option A and are not made
easier or harder to exploit by it either way.

**Sequencing note, distinct from the safety verdict itself**: the safety
recommendation above is unconditional — Option A does not *need* any
tenancy/auth prerequisite to be safe. However, as a matter of planning
discipline rather than security necessity, **product-code implementation of
Option A should begin only after the Priority-0 Tenant Surface Security Spec
and the Institutional Auth Migration Spec (§11) have been defined** — not
implemented, defined — so that Option A's own implementation slice is
written with full awareness of where the surrounding platform is headed,
rather than in isolation from planning already known to be starting
immediately after this document.

---

## 9. Second-organisation gate (proposed minimum, before onboarding a second real organisation)

All of the following must be true — not aspirational, verified:

1. **`tenants`' own RLS is no longer world-writable.** This is the single
   highest-severity finding in this document and should arguably be closed
   regardless of second-org timing — with two real organisations, any
   anon-key holder could otherwise directly corrupt either organisation's
   own configuration.
2. **A real, server-verifiable session exists for the institutional flow**,
   replacing the plaintext-shared-secret model — bound to a specific
   identity and tenant, checked on every privileged operation, not just at
   login.
3. **Core operational tables' RLS is rewritten to check that verified
   session's tenant** against each row's tenant — `workforce`, `submissions`
   (after #4), `collections`, `combined_master_rosters`, `raw_roster_uploads`,
   `announcements`, `org_groups` — replacing `USING(true)`.
4. **`submissions` gains a `tenant_id` column**, backfilled, so #3 is even
   possible for this table without a join-based policy as a permanent
   workaround.
5. **The self-admitted approval-bypass gap is closed** —
   `dissertation_milestones.status`/`case_reports.status` UPDATE RLS
   tightened so the one real role-checking RPC can no longer be bypassed by
   a direct table write. Materially more important once real organisational
   boundaries mean an approval crossing one org's data shouldn't be
   forgeable by another's user error or malice.
6. **`rotations`' organisation-configurable direction is underway or
   explicitly scoped** — the long-term direction is locked (see below); this
   gate item is about that direction being at least scoped for
   implementation by second-org time, not necessarily fully shipped, since
   rotations content itself is lower-severity than the PII/isolation
   findings above.
7. **Live verification, not migration-file trust**: before declaring this
   gate met, the actual live database state is checked against an approved
   process (per M10) — a migration file existing or a header claiming
   "applied" is not sufficient evidence on its own.
8. **Automated negative tenant-isolation tests pass.** At minimum, an
   automated test suite verifies that an Organisation A identity cannot
   read or mutate Organisation B's: workforce, submissions, roster state
   (`raw_roster_uploads`/`combined_master_rosters`), or tenant configuration
   (`tenants` itself) — and cannot create or update records targeting
   another organisation through ordinary application/API paths. This
   becomes part of the release gate itself, not a manual smoke-test
   checklist item — no automated test suite exists in this repository today
   (`docs/TESTING_AND_VERIFICATION.md`), so this item requires establishing
   that capability, not merely running an existing one.

**`rotations` — long-term direction locked, not implemented here**: the
current 10-value Family Medicine list remains as legacy/seed data for the
current tenant. The long-term target is **organisation-configurable** — a
future model of global templates/catalog entries (reusable starting content,
similar in shape to the global-seed convention already used by
`form_instances`/`scheduling_instances`/`meeting_series`/
`clinical_document_types`) plus organisation-specific configured
rotations/postings layered on top. **No rotations migration or
generalisation happens during Workforce Option A** — Option A's rotation
matching (per `docs/WORKFORCE_V1_RECOVERY_SPEC.md` §4) is explicit,
tenant-specific compatibility logic against the *current* list, unaffected
by this locked long-term direction.

This list is proposed as an explicit release gate — a second real
organisation should not be onboarded until every item above is independently
confirmed, not merely believed to be in progress.

---

## 10. Migration strategy (conceptual only — no migrations written)

If remediation proceeds, in dependency order:

1. **Prerequisite data audit** (live, approved-process, not part of this
   document): confirm the single-tenant assumption actually holds in
   production data today — no orphaned or unexpectedly multi-tenant-shaped
   rows anywhere in the tables listed in §9.
2. **Institutional Auth Migration Spec** (its own separately-reviewed
   document, named in §11): the architectural decision of exactly how the
   institutional flow converges onto Supabase Auth (§7) — Person/Membership
   mapping, migration path from the existing access-code UX, and Chief/
   admin/member identity handling. Supabase Auth is the locked preferred
   route (§7); this step designs the convergence, it does not re-open
   whether to use it.
3. **`submissions.tenant_id`**: add nullable, backfill from
   `workforce_id → workforce.tenant_id` for every existing row, then (only
   after backfill is verified complete) add `NOT NULL` + an index.
4. **Policy transition — corrected strategy.** The prior draft of this
   document proposed adding a new tenant-scoped policy *alongside* the
   existing `USING(true)` policy, verifying parity, then dropping the old
   one. **This is invalid and has been withdrawn**: PostgreSQL RLS combines
   multiple permissive policies on the same table/command with `OR` — a
   `USING(true)` policy continues to allow every row regardless of any
   narrower policy added beside it. There is no "verify parity" window under
   that plan; the old permissive policy simply keeps allowing everything for
   the entire duration both policies coexist, silently defeating the new
   one. Corrected approach:
   - **Validate the new authorization predicate before enforcement** — test
     the intended tenant-scoped condition (e.g. as a read-only query or
     against a staging copy) to confirm it returns the expected row set for
     real data, *before* it ever becomes the sole enforcing policy.
   - **Do not assume a narrow policy alongside `USING(true)` provides any
     protection** — treat that state as equivalent to no new policy at all,
     because it is.
   - **Transition atomically and reversibly, only after validation**: the
     permissive policy is replaced by the validated tenant-scoped policy in
     one coordinated change per table (e.g. within a single migration/
     transaction), not staged as a multi-step "both active" period.
   - **Exact SQL/policy mechanics are deferred to the implementation
     specification and review** that would carry out this step — not
     written here, per this slice's own boundary (no policy SQL in Slice 4).
   - **Rollback is a revert of that same atomic change** (re-apply the
     previous policy definition), not a design that relies on deliberately
     leaving both a permissive and a supposedly-restrictive policy active as
     an intermediate "security-validation state" — that state is not safe to
     rely on or to treat as a rollback position, per the correction above.
5. **`tenants` RLS narrowing**: replace world-writable with, at minimum,
   platform-operator-only writes (there is no per-tenant `auth.uid()` to key
   a normal tenant-scoped policy on for this specific table, since it's the
   tenant table itself) — this table's fix is structurally different from
   the others and should be scoped as its own small, self-contained slice,
   preceded by rerouting its five currently-permissive-dependent call sites
   (§4a) through RPCs, using the same atomic-transition discipline as step 4.
6. **Compatibility considerations**: every `chief_*` RPC that currently
   trusts `p_admin_code` needs to be revisited once real Supabase Auth
   principals exist for institutional sessions — whether it starts trusting
   the authenticated principal instead of (or in addition to) the code is a
   design decision for step 2's spec, not assumed here.
7. **Rollback/recovery**: each atomic transition in step 4 is independently
   revertible by re-applying its prior policy definition — no step in this
   sequence should ever pass through, or rely on, a state with both an old
   permissive and a new restrictive policy simultaneously active as if that
   were itself a safe or reversible checkpoint.
8. **Verification**: manual smoke tests per `docs/TESTING_AND_VERIFICATION.md`
   (no automated suite exists) for every affected read/write path, plus
   explicit human approval before any step touches the live database, per
   M10 — a migration file existing is never, on its own, sufficient
   justification to consider a step "done."

---

## Unresolved human decisions

1. Timeline/priority for closing the `tenants` world-writable RLS gap (§4a,
   §9 item 1) — arguably should not wait for full second-org readiness given
   its severity, but that's a sequencing call, not this document's to make.
2. Exact rollout mechanics for the Supabase Auth convergence (§7) — how
   existing residents/Chiefs acquire a real Supabase Auth principal without a
   disruptive re-registration event, and what role access codes play as
   enrolment/invitation UX during that transition. The *destination*
   (Supabase Auth) is locked; the *path* there is the Institutional Auth
   Migration Spec's own decision (§11 item 2).
3. Exact shape and timing of `rotations`' organisation-configurable model
   (global templates/catalog + org-specific configured entries, §9 item 6) —
   the long-term *direction* is locked; the specific design and rollout
   timing are not decided here.
4. How conservative the second-organisation gate (§9) should be beyond the
   now-8 listed conditions — this document proposes a minimum; a stricter
   bar is a legitimate alternative a human may prefer.
5. Exact scope/tooling for the automated negative tenant-isolation test
   suite required by §9 item 8 — this document requires the capability to
   exist and pass; how it's built (framework, where it runs, what "Org B"
   fixture data looks like) is implementation-spec territory, not decided
   here.

## Explicit non-goals of this slice

- No source, schema, migration, RLS policy, or auth configuration was
  modified to produce this document.
- No production data was read, queried, or mutated.
- No penetration testing or exploitation attempt was performed.
- No full Automation Engine was designed (§6 names prerequisites only).
- No big-bang rename or schema rewrite is proposed (§7).
- No migration was written (§10 is conceptual sequencing only).
- This document does not implement Option A, Option B, or any tenancy
  remediation step — it recommends and specifies only.

## 11. Revised implementation sequence

Replaces the prior draft's flat "proposed bounded slices" list with an
explicit ordering, per review decision. Each numbered item below is its own
future, separately-reviewed DISCOVER → PLAN → HUMAN REVIEW cycle — none of
them is started by this document.

1. **Priority-0 Tenant Surface Security Spec** — specifically `tenants`
   (§4a). Scope: identify every current read/write consumer (the six
   functions in §4a's table, confirmed exhaustively or re-confirmed at spec
   time), design the minimal safe public discovery surface (what an
   unauthenticated login screen genuinely needs to read), design the safe
   mutation path (routing the five currently-permissive-dependent write
   functions through RPCs, mirroring `create_tenant_with_admin`). No
   implementation until this spec is reviewed.
2. **Institutional Auth Migration Spec** — the Supabase Auth convergence
   locked in §7: Person/Membership mapping, migration path from the existing
   access-code UX (including whether/how codes survive as enrolment UX),
   Chief/admin/member identity design, compatibility and session-migration
   handling for existing users. No implementation until this spec is
   reviewed.
3. **Workforce Option A implementation** — may proceed once the above two
   specs (not their implementations) are defined and understood, per §8's
   sequencing note. Does not need to wait for the entire multi-table RLS
   migration (§10) to complete — Option A introduces no new permission,
   table, endpoint, field exposure, privileged action, or write, and remains
   independently safe regardless of when tenancy remediation itself lands.
4. **Subsequent bounded tenancy/RLS remediation slices** — following §10's
   corrected strategy: `submissions.tenant_id` addition, the atomic (not
   additive-then-drop) policy transition for the core operational table
   list, the `dissertation_milestones`/`case_reports` approval-bypass fix,
   the automated negative tenant-isolation test suite (§9 item 8), and the
   second-organisation readiness audit against the full §9 gate — each its
   own reviewed slice, sequenced after items 1–2 land.

---

Stopping here per Slice 4's instruction. No source, schema, migration, RLS,
or auth configuration was touched to produce this document. Not committed.
Awaiting human review before any further PLAN or implementation step
proceeds.
