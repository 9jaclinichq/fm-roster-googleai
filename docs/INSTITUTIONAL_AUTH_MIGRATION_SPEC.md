# Institutional Authentication & Identity Migration Specification (Slice 6 — DISCOVER + PLAN)

Status: **proposed, unreviewed. Not committed. No code/schema/migration/RLS/
Supabase Auth configuration/Edge Function/production data/dependency/
deployment/UI change made to produce this document.**
Scope authority: `AGENTS.md` → `docs/WORKSPC_PRODUCT_CONSTITUTION.md` →
`docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` → `docs/TENANT_SURFACE_SECURITY_SPEC.md`
→ `docs/WORKFORCE_V1_RECOVERY_SPEC.md`.

This is intended as the final broad foundational specification before bounded
implementation begins. Every finding below is produced by direct source/
migration-file reading — three independent research passes plus this
document's own synthesis. No live database was queried. Per
`docs/WORKSPC_PRODUCT_CONSTITUTION.md` M10: migration file exists ≠ approved
≠ applied — nothing below claims live state. No decision already locked in
`docs/WORKSPC_PRODUCT_CONSTITUTION.md`, `docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md`,
or `docs/TENANT_SURFACE_SECURITY_SPEC.md` is reopened here; this document
extends and reconciles with them, per §18.

Revision 2 (2026-08-20): revised per the human architecture-review decisions
on the initial draft — Person locked profession-neutral (not equated with
`doctor_profiles`, §3); `workforce` locked as the V1 Membership carrier
only, not permanently identical to Organisation Membership (§3); Chief/
org-admin locked as a Role/Group + Capability grant, not an identity type
(§6); platform-operator identity architecture approved with a locked
individual-attribution requirement (§7); `tenants.owner_person_id`
explicitly not locked (§9); an explicit migration-state/feature-flag
concept added to the RPC evolution path (§11); capability model direction
locked toward an extensible key vocabulary, not indefinite boolean columns
(§3); coexistence locked at a 90-day default window with immediate
per-individual cutover on claim, not a population-wide event (§14);
recovery locked to Chief/admin-assisted, audit-logged, with no fuzzy or
AI-based identity resolution (§15); all language describing the financial
Edge Function findings as currently live/uncontained is corrected to
reflect Emergency Slice E0's successful deployment, with the underlying
identity gap preserved as historical evidence, not current exposure (⚠,
§13, §18); and the Workforce Option A sequencing finding is explicitly
preserved, not expanded upon (§18). See the response accompanying this
revision for the full list of exact changed sections and any new
cross-document contradictions surfaced.

Revision 3 (2026-08-20): resolves Revision 2's one flagged open tension —
**Organisation Membership is introduced as its own distinct, profession-
neutral primitive** (`Person ↔ Organisation`, independent of Workforce
Operations participation), with `WorkforceRecord` (`workforce`) as a
separate, optional record a Membership may connect to. `workforce` is no
longer described anywhere in this document as the universal Membership
implementation (§3, §6, §9, §12, §17 revised accordingly). This resolves
former unresolved decision 9 (removed) without a big-bang refactor —
`workforce`/`doctor_profiles`/existing login paths remain unchanged during
migration, per an explicit V1 evolutionary constraint (§3).

---

## ⚠ Historical finding — discovered during this pass, since contained via Emergency Slice E0

**Original finding (as discovered during this Slice 6 research pass, now
historical)**: `supabase/functions/platform-operator-subaccount/index.ts`
created a real, live Paystack subaccount — a financial payout destination,
with attacker-controlled settlement bank account details — with zero
server-side verification of any kind. `payment-checkout` had a related,
lower-severity gap (§13). Both were more severe in kind than the `tenants`
RLS finding (Slice 4/5) — not a data-exposure or cross-tenant risk, but
direct, unauthenticated creation of a real financial account/subscription.

**Current state — contained, not fixed.** Emergency Slice E0 has been
deployed successfully: both functions now fail closed
(`financial_feature_temporarily_unavailable`, HTTP 503) before any
credential read, provider call, or database mutation, for every caller
unconditionally. Source containment: commit `24045df`. Live deployment
confirmed via Supabase deployment metadata (`platform-operator-subaccount`
v2, `payment-checkout` v7, both `ACTIVE`, 2026-08-20) — see
`docs/EMERGENCY_SLICE_E0_FINANCIAL_CONTAINMENT.md` for the full record.
**The financial side effects these two functions could produce are no
longer reachable.**

**What containment does not resolve**: the underlying cause — no
server-verifiable platform-operator identity, no server-verifiable caller/
tenant context for these functions — remains completely unresolved.
Containment is a fail-closed stopgap, not an identity fix; re-enabling
either function's real functionality still requires the platform-operator
migration this document specifies (§7) and the Edge Function auth contract
named in §13. This finding is preserved here as architectural evidence for
why platform-operator identity migration matters, not as a live emergency
— see §7, §13, and §19 item 5 (revised).

---

## 1. Verified identity-flow matrix

Six distinct identity paths were found and independently verified — five
expected, plus a sixth (guest review invites) that turns out to be the
**best-designed** access pattern in the app and a useful structural
precedent (§3, §15).

### 1. Institutional member/resident
- **Entry**: `ResidentLoginView.tsx`. **Credential**: tenant + name/workforce
  picker + 6-digit `resident_code` + registered email (conditionally
  enforced — see below).
- **Verification**: `verify_resident_login(p_workforce_id, p_code, p_email
  DEFAULT NULL)`, `SECURITY DEFINER`, migration 26 (current):
  `WHERE w.id = p_workforce_id AND w.resident_code = p_code AND w.active =
  true AND (w.email IS NULL OR lower(w.email) = lower(trim(p_email)))`. The
  email check is a **ratchet** — only enforced once an admin has seeded that
  member's `email`; until then, name+PIN alone suffices. `workforce.email`
  is never client-SELECT-granted.
- **Supabase Auth session**: No. **DB identity**: existing `workforce` row
  (never created by this flow). **Tenant context**: `workforce.tenant_id`,
  copied into the session object at login. **Role/capability**:
  `refreshSubadminRoles()` re-reads `user_roles`⋈`org_groups` on every
  mount, not just login (a revoked role takes effect next page load, not
  live). **Session storage**: `localStorage['fm_session_resident']`, plain
  JSON. **Logout/expiry**: explicit logout clears the key; **no expiry of
  any kind** — the session persists indefinitely across browser restarts
  until manually logged out. **Server-verifiable**: nothing post-login —
  every subsequent call trusts the client-held `workforce_id`. **Major
  consumers**: ~15 `/workspace/*` routes plus `Navbar`/`TerminologyProvider`.

### 2. Chief/org-admin
- **Entry**: `ChiefLoginView.tsx`. **Credential**: 6-digit
  `admin_access_code` only (self-resolves the tenant).
- **Verification**: `verify_chief_login(p_code)`, migration 23 (current):
  `SELECT s.tenant_id, t.name FROM settings s JOIN tenants t ... WHERE
  s.admin_access_code = p_code`.
- **Supabase Auth session**: No. **DB identity**: **none** — there is no
  "Chief person" row; identity *is* possession of the code. **Tenant
  context**: the RPC-resolved `tenant_id`, stored as
  `localStorage['fm_chief_tenant_id']`. **Role/capability**: none beyond
  "holds the code" — full, undifferentiated Chief authority. **Session
  storage**: three separate localStorage keys, including the raw plaintext
  code itself (`fm_admin_code`), re-sent on every subsequent privileged
  call. **Logout/expiry**: explicit logout clears all three keys; **no
  expiry**. **Server-verifiable**: the `chief_*` RPCs genuinely re-verify
  the code and resolve the real tenant server-side — real enforcement of a
  shared secret, not a person. **Major consumers**: the entire `/chief/*`
  tree (18 dashboard tabs).

### 3. Platform operator
- **Entry**: `SaaSOperatorConsoleView.tsx` (self-contained). **Credential**:
  6-digit `shared_code`.
- **Verification**: `verify_platform_operator_code(p_code)`, migration 11:
  `SELECT po.id, po.name FROM platform_operators po WHERE po.shared_code =
  p_code`.
- **Supabase Auth session**: No. **DB identity**: `platform_operators` — a
  **single seeded row** ("Platform Owner"), **no per-operator distinction
  at all** — the weakest credential in the schema. RLS: `USING(false)` for
  SELECT — no direct read, RPC-only (a good pattern, undermined by the
  credential itself having no per-person granularity). **Tenant context**:
  none — explicitly above the tenant model. **Session storage**: a
  dedicated key. **Logout/expiry**: explicit clear; **no expiry**.
  **Server-verifiable**: nothing beyond "holds the code" — `logOperatorEvent`
  records a **client-asserted** `operatorId`, not a verified one. **Major
  consumers**: `SaaSOperatorConsoleView.tsx` only — narrowest blast radius
  of the code-based actors, but gates the most severe finding in this
  document (⚠ above).

### 4. Independently authenticated doctor
- **Entry**: `DoctorAuthView.tsx`. **Credential**: email + password (the
  "PIN" is literally used as the password — real Supabase Auth underneath).
- **Verification**: real `supabase.auth.signUp()`/`signInWithPassword()`.
  `doctor_profiles` auto-created via `handle_new_doctor_signup()` trigger,
  never client-inserted.
- **Supabase Auth session**: **Yes — the only actor type with one.** Real
  JWT, managed by `supabase-js`'s own storage/refresh. **DB identity**:
  `doctor_profiles` (`id = auth.uid()`). **Tenant context**: none inherently
  — **convergence point**: if a Chief has linked this doctor to a
  `workforce` row (`workforce.doctor_id`), the app synthesizes a
  resident-shaped session and the doctor is thereafter treated identically
  to actor 1 for every institutional operation — **the real `auth.uid()`
  stops being consulted the moment institutional routes take over.**
  **Logout/expiry**: real `supabase.auth.signOut()` — genuine
  server-side invalidation, unlike every other actor's logout (a local
  state-clear only). **Server-verifiable**: `doctor_profiles`' own RLS
  (`auth.uid() = id`) is real; everything downstream of convergence
  reverts to actor 1's unverifiable posture. **Major consumers**:
  `/doctor/*` pre-link; actor 1's consumer list post-link.

### 5. Self-serve organisation creator
- **Entry**: `CreateOrganizationView.tsx`, reached via `/organization/new`
  — **no login step of any kind precedes this route.**
- **Verification**: none — anonymous. `create_tenant_with_admin` (migration
  24) atomically creates the `tenants` row and its admin-code row, returns
  the plaintext code once.
- **DB identity**: a new `tenants` row. **Confirmed: `tenants` has no
  `created_by`/`owner` column of any kind** — checked the full column list
  and every migration touching the table. The fresh admin code is handed to
  whoever's browser submitted the form — functionally anonymous,
  unattributable creation, and the flow immediately hands that code into
  `ChiefLoginView`. **Server-verifiable**: nothing about *who* created the
  tenant, because nothing records it.

### 6. Guest review invite — a genuine, distinct 6th path, and the best-designed one
- **Entry**: `GuestReviewView.tsx`, route `/guest-review/:token`.
  **Credential**: a UUID token embedded in the URL, shared out-of-band.
- **Verification**: `get_guest_review_invite`/`submit_guest_review`,
  reading `guest_review_invites WHERE token = p_token`. **DB identity**:
  none persistent — the invite row itself *is* the entire identity,
  single-use (`status → 'completed'` on submission). **Tenant context**:
  inherited from the issuer. **Role/capability**: exactly one — submit one
  review against one target, nothing else. **Session storage**: none — the
  URL token is re-validated on every call, never cached as a session.
  **Server-verifiable**: `guest_review_invites` has **no direct SELECT
  policy at all** (`USING(false)`) — access is RPC-only, single-use,
  narrowly scoped. **This is the most tightly-scoped identity mechanism in
  the app** — a useful structural precedent for §15.

---

## 2. Existing identity primitives inventory

| Primitive | Shape | Verdict |
|---|---|---|
| `auth.users` | Referenced by exactly one table (`doctor_profiles.id`) | **REUSABLE AS-IS** — the one real Auth integration point |
| `doctor_profiles` | `id (→auth.users), email UNIQUE NOT NULL, full_name, created_at`. Auto-provisioned by trigger. | **REUSABLE OPERATIONALLY, NOT CONSTITUTIONALLY** — the current, durable, org-independent, `auth.uid()`-keyed identity row, and preserved as-is per M1's ban on renaming `doctor_*` tables. **Not locked as the permanent universal Person model** — its name is profession-specific and Workspc is multi-professional (per human decision, this revision). See §3. |
| `workforce` | Base + `on_floor`, `tenant_id`, `doctor_id (→doctor_profiles, nullable, NOT unique)`, `email (nullable, unique-when-set, write-only from client)`, `category_id` | **REUSABLE WITH EXTENSION** for V1 specifically — the de facto institutional-member record; `doctor_id`/`email` are already the exact linking seams a migration would extend. **Not locked as permanently identical to "Organisation Membership"** — see §3. |
| Organisation membership (dedicated table) | **Does not exist.** Confirmed by exhaustive grep — "membership" appears only in comments/unrelated seed content. Implicit only via `workforce.tenant_id`/`workforce.doctor_id`. | **MISSING** — the single largest structural gap; §3 proposes `workforce` as the **V1 membership carrier for workforce-type members**, explicitly not a permanent equation with the Membership concept itself |
| `roles`/`user_roles` | Global 6-row enum; `user_roles.auth_user_id` column exists, **never populated by any live code path** | `roles` mutate = **LEGACY-DEAD** (unreachable `has_role()` gate); `user_roles` = **REUSABLE WITH EXTENSION** — built for exactly this migration, never used |
| `org_groups` | Tenant-scoped, `grants_review_approval boolean`, `is_system_default` | **REUSABLE AS-IS** — the real Role/Group layer |
| Capability beyond `grants_review_approval` | None found anywhere | **MISSING** — smallest extension is more capability bits on `org_groups`, not a new table (§3) |
| `settings.admin_access_code` | Per-tenant (migration 23), plaintext, no expiry/rotation timestamp | **LEGACY** — target is claim-only, never the permanent credential |
| `workforce.resident_code` | `varchar(6) UNIQUE` — **globally unique across all tenants, not per-tenant** (worth flagging as its own minor design note) | **LEGACY** — same posture |
| `platform_operators` | Single seeded row, `shared_code UNIQUE`, `USING(false)` SELECT | **LEGACY-WEAKEST** — no per-operator distinction at all |
| Invitations | No enrolment/invite table exists for members/doctors/admins. `guest_review_invites` is the only invite-shaped concept, narrowly scoped to consultant review. | **MISSING** for identity enrolment — but `guest_review_invites`' token pattern is a reasonable structural precedent to reuse |
| Email/phone | `doctor_profiles.email` real; `workforce.email` real but write-only; `user_roles.email` present, not further verified; **no `phone` column anywhere in the schema** | Email infrastructure partially reusable; phone infrastructure **MISSING entirely** |
| `tenants` ownership | **No owner/creator column of any kind, confirmed** | **MISSING** — required for Slice 5's locked self-serve target posture to be enforceable at the data level |
| User↔workforce/tenant linking | `workforce.doctor_id → doctor_profiles.id` (real, nullable, not unique); `user_roles.auth_user_id → auth.users.id` (real FK, never populated) | Both **REUSABLE** — the second is a built-but-dormant seam |

**Complete `SECURITY DEFINER` RPC catalog** (~25 functions, exhaustively
grepped): institutional login/identity (`verify_resident_login`,
`verify_chief_login`, `chief_get_workforce_codes`,
`chief_add_workforce_member`, `chief_reset_resident_code`,
`chief_update_admin_code`, `chief_assign_user_role`,
`chief_remove_user_role`); doctor linking (`handle_new_doctor_signup`,
`chief_link_doctor_by_email`, `chief_unlink_doctor`); self-serve tenant
(`create_tenant_with_admin`); org content management (7 `chief_create/
update/delete_*` functions across templates/vignettes/groups/categories);
platform operator (`verify_platform_operator_code`); consultant review/guest
sharing (`submit_consultant_review`, `create_guest_review_invite`,
`get_guest_review_invite`, `submit_guest_review`); plus non-identity
functions (quota, activity logging, rubric totals) not relevant here.

**Pattern verdict, load-bearing for this entire spec**: every Chief/operator
RPC already follows the exact server-side-resolve-then-verify pattern the
target model needs — `SELECT tenant_id FROM settings WHERE
admin_access_code = p_code`, **never** trusting a client-supplied tenant id.
**This is a reusable pattern, not a reusable identity** — the migration is
"swap the identity check inside ~25 existing function bodies from a
plaintext-code lookup to an `auth.uid()` lookup," not "invent a new
authorization architecture." This is the central finding that makes the
"smallest evolutionary path" instruction achievable (§3, §11).

---

## 3. Conceptual identity layers, locked target model mapped onto what exists

```
Supabase Auth principal → persistent Workspc Person → OrganisationMembership
  → contextual Role/Group → explicit Capability → authorised domain action
  → backend/RLS enforcement

OrganisationMembership → WorkforceRecord (optional — exists only where the
  Person participates in managed Workforce Operations; not required for
  organisation owners/admins, research collaborators, external members, or
  future non-workforce actors)
```

| Layer | Responsibility | Existing primitive | Gap |
|---|---|---|---|
| **Auth principal** | Credential/security identity | `auth.users`, currently only reached via the doctor path | Extend reach to institutional members/Chiefs/operators (§5–§7) |
| **Person** | Durable human identity, independent of one org **or profession/role** | `doctor_profiles` — the current, and only, real `auth.uid()`-keyed identity table | **Locked, per human decision**: Person is defined as **profession-neutral**. Workspc is multi-professional; `doctor_profiles` is **not** constitutionally equated with the permanent universal Person model, even though it is preserved and reused operationally (no big-bang rename, per M1). Practically: every institutional member's Auth principal still resolves through `doctor_profiles` as the *current physical table* (there is nowhere else for an `auth.uid()`-linked row to live yet). **Person implementation constraint, locked**: a new generic people table is **not** required as part of the first Membership implementation merely for conceptual purity — `doctor_profiles.id = auth.uid()` may remain the operational Person anchor during the evolutionary transition where necessary. This does not make `doctor_profiles` the permanent universal Person model. |
| **Organisation Membership** | **New, locked, distinct primitive (resolves the prior draft's tension) — represents `Person ↔ Organisation`, independently of whether that Person participates in Workforce Operations.** May carry or connect to: lifecycle/status; contextual roles/groups; capabilities; future temporal membership information. | **No dedicated table yet.** Today's institutional membership is approximated only by `workforce.tenant_id`/`workforce.doctor_id`, for workforce-type members. | **Locked, per human decision**: `workforce` must **not** become the permanent universal Organisation Membership representation. Organisation Membership is its own profession-neutral conceptual/platform primitive, separate from — and broader than — any single carrier record, so organisation owners/admins, research collaborators, external members, and future non-workforce actors can belong to an organisation **without fake/empty `workforce` rows**. **V1 evolutionary constraint, locked**: this is not a big-bang refactor. `workforce.tenant_id`, `workforce.doctor_id`, existing login paths, and existing operational code may all remain exactly as they are during migration. The eventual implementation may introduce a thin Membership structure and progressively link `workforce` records to it — existing Workforce V1 is not rewritten around the new primitive before its own separately reviewed migration slice (§17). |
| **Workforce Record (optional)** | **New row, locked** — a separate domain record for a Person's participation in managed Workforce Operations specifically. Exists only where that participation is real; not every Organisation Membership has one. | `workforce` — real, live, the actual V1 record for workforce-type members, unchanged by this revision | `workforce` **is** a Workforce Record, not Organisation Membership itself — a subtle but load-bearing distinction. Once a thin Membership structure exists, `workforce` rows are the natural first Workforce-Record kind to link to it (not to be replaced by it). Exact linking mechanism/timing is implementation-spec work (§17), not decided here. |
| **Role/Group** | Contextual organisational responsibility | `org_groups` — already tenant-scoped, already real | None — reuse as-is. **Locked**: "Chief/org-admin" is a Role/Group + Capability combination granted to a Person's **Organisation Membership** — not a distinct identity type, and not dependent on that Person also having a Workforce Record (§6). |
| **Capability** | Actual authority to perform an operation | `org_groups.grants_review_approval` — the **only** capability bit that exists | **Locked direction, per human decision**: do **not** commit to indefinitely adding boolean capability columns to `org_groups`. Direction is an **extensible capability-key vocabulary** (e.g. a capability-grants relation keyed by a free-text/enum `capability_key`, or a `jsonb` set of keys carried by the Organisation Membership/Role row) capable of covering Workforce, Research, Meetings, Forms, Scheduling, and future modules without a schema change per new capability. Exact smallest-compatible implementation is deferred to the implementation spec (§19), not chosen here — this document locks the *direction* (extensible, key-based, cross-module, attached to Membership) only. |
| **Domain action** | The actual operation | The ~25 `SECURITY DEFINER` RPCs — already real, already following the right internal pattern | Swap the internal identity check per §11 — not a redesign |
| **Backend/RLS enforcement** | Final boundary | Currently permissive (`USING(true)`) on institutional tables, per Slice 4 | Blocked until Organisation Membership is real and `auth.uid()`-keyed (§12) — RLS policies cannot reference a stored-procedure parameter like `p_admin_code`; only a real principal makes row-level policies possible here |

**Person is not collapsed into Organisation Membership, Organisation
Membership is not collapsed into Workforce Record, and Membership is not
collapsed into Role**, per this section's explicit instruction — four
distinct responsibilities, not three: Person (currently `doctor_profiles`),
Organisation Membership (new primitive, no dedicated table yet), Workforce
Record (currently `workforce`, one specific kind of thing a Membership may
optionally connect to), and Role/Group+Capability (currently `org_groups`,
carried by the Membership). **`workforce` is not the universal Membership
implementation anywhere in this document any longer** — wherever earlier
sections still describe `workforce` as *the* Membership carrier, read that
as shorthand for "the V1 Workforce Record, one thing a Membership may
optionally have," not as Membership itself (§6, §9, §12 revised
accordingly below). **This remains the smallest evolutionary implementation
found that respects the distinction**: no new table is required today,
`workforce`/`doctor_profiles` keep operating exactly as they do, and the
conceptual model is now wide enough that a future organisation owner,
research collaborator, or external member never needs a fake Workforce
Record just to belong to an organisation.

---

## 4. Minimum Supabase Auth strategy

| Method | Fit for this repo |
|---|---|
| **Email OTP / magic link** | **Recommended primary.** `workforce.email` already exists as a column (migration 26), currently write-only/unverified — extending it to be the real Auth identity is a small step. No password to remember or reset — closer to the existing 6-digit-code UX residents already know than a password would be. Mobile-friendly. Account recovery is trivial (just request a new code/link). |
| **Password** | The doctor path's existing precedent (PIN-as-password) — viable as a secondary option, but strictly worse UX for migration purposes: residents already have a code-based mental model; a password is a *new* burden, not a continuation of one. |
| **Phone OTP** | **Not realistic short-term.** Confirmed: **no `phone` column exists anywhere in this schema.** Would require new data collection plus SMS costs. Worth naming as a credible future option once phone infrastructure exists, not now. |
| **Invitation/enrolment flow** | Needed regardless of the primary method chosen — bootstraps the link between a fresh Auth principal and a pre-existing `workforce` row. This is the claim flow (§5), not a separate method. |
| **Linking an existing access code during migration** | This *is* the claim mechanism (§5) — the code proves entitlement to a specific pre-existing record; it is the bridge, not a standalone auth method. |

**Locked, per human decision — no longer an open recommendation**: Supabase
Auth with **email OTP/magic link as the primary authentication method**,
paired with the access-code-based claim flow (§5) as the bootstrap
mechanism during migration. Password **may remain secondary** (already
proven for doctors) rather than removed. Phone OTP is named as credible
future work, not proposed now. **Existing resident/admin access codes
become transitional claim/enrolment credentials only — never a permanent
standalone server authorization credential again**, per §5/§6 and the
transitional RPC rule (§11). Provider configuration itself is not
implemented in this document, per this section's own instruction.

This satisfies every named requirement: server-verifiable `auth.uid()`
(real Supabase Auth); durable identity (`doctor_profiles`-shaped Person,
independent of any one org); reasonable mobile UX (no password); account
recovery (re-request OTP to the same verified email); multi-organisation
support eventually (§3's Membership model); and compatibility with members
who currently know only a code (the code becomes the claim credential, not
a discarded artifact).

---

## 5. Existing access-code migration (institutional member claim flow)

Transitional flow, not implemented here:

1. **Entitlement proof**: the member proves entitlement to a specific
   existing `workforce` row exactly as they do today — tenant selection +
   name/workforce picker + their current `resident_code`. This is the
   answer to "what proves the user is entitled to claim the existing
   record" — the same fact already required for login today, reused as a
   one-time claim credential instead of a standing one.
2. The member provides/confirms an email (if `workforce.email` is not
   already set by an admin).
3. A Supabase Auth OTP/magic-link is sent to that email.
4. On successful verification, a claim RPC (`SECURITY DEFINER`, mirroring
   `chief_link_doctor_by_email`'s already-proven shape) requires **both**
   the valid `resident_code` **and** a fresh `auth.uid()` session to
   complete the link — `workforce.doctor_id` is set (or a `doctor_profiles`
   row is created first if this Person has never authenticated before,
   reusing the existing trigger). **Note, per §3's revised Person model**:
   `doctor_profiles` here is the *current physical table* the Person's Auth
   principal resolves through — this is an operational reuse, not a claim
   that the Person being created is "a doctor" in any professional sense.
5. **`resident_code`'s server-authorization role ends at that point.** It
   may survive as a **secondary local convenience PIN** (e.g. a fast
   in-app re-entry gesture within an already-Auth-authenticated session)
   but is **never again treated as a standalone server credential**, per
   this section's explicit instruction.
6. **Duplicate-claim prevention**: once a `workforce` row is claimed,
   `doctor_id` is set and a uniqueness constraint (mirroring
   `resident_code`'s own `UNIQUE` pattern) rejects a second claim attempt
   against the same row. The reverse case — one Person attempting to claim
   a second row **within the same tenant** — is rejected by the `UNIQUE
   (doctor_id, tenant_id)` constraint named in §3; claiming a row in a
   **different** tenant remains legitimate (multi-org membership).
7. **Account recovery**: passwordless OTP means recovery is simply
   re-requesting a code to the same verified email — no forgotten-password
   flow needed.
8. **Members without usable email**: **locked, per human decision** — an
   explicit **Chief/admin-assisted recovery path, with audit logging, is
   required.** No fuzzy identity matching and no AI-based identity
   resolution, under any circumstances (§15). What exact evidence a Chief
   must check before assisting a claim (in-person attestation, institutional
   record cross-check, or similar) remains a policy detail for the
   implementation spec (§19), but the *mechanism* — human-mediated,
   audit-logged, deterministic — is locked, not open.
9. **Existing client-stored session state**: legacy `ResidentSession`
   localStorage entries remain valid for the duration of the coexistence
   window (§14) — not immediately invalidated on deployment day.

**Not retaining reusable plaintext codes as the permanent server
authorization credential** is satisfied directly by step 5.

---

## 6. Chief/org-admin migration

**Locked, per human decision**: Chief/org-admin is an
**organisation-scoped Role/Group + Capability grant** (§3), never a
permanent identity type of its own. Authentication belongs to the Person
layer (§3/§4) — "Chief" describes what a Person's **Organisation
Membership** in a specific Organisation is authorised to do, not a separate
kind of account. A Person who is Chief of Organisation A and a plain member
of Organisation B is the same Person, two different Organisation
Memberships, two different Role/Capability grants — not two identity types.

Higher-stakes mirror of §5:

1. **Resolved by §3's Organisation Membership primitive**: the legacy
   Chief claims an **Organisation Membership** (not a `workforce` row) by
   proving possession of the current tenant's `admin_access_code` (the same
   fact already required today) **plus** completing email OTP
   verification, becoming a real Person with an Organisation Membership in
   that tenant, carrying an `org_groups` role with admin-level capability
   (§3's extended capability set). **This membership does not require a
   Workforce Record.** A Chief who is also a workforce member gets both — a
   Workforce Record (their existing `workforce` row, once linked per §5)
   *and* an Organisation Membership carrying the admin Role/Capability, the
   two connected but distinct, exactly as §3 now models it. A Chief with no
   `workforce` row at all simply has an Organisation Membership and no
   Workforce Record — no longer a gap, no special "admin identity" invented
   to paper over it.
2. **Once claimed, the shared `admin_access_code` no longer remains the
   permanent definition of "Chief."** Chief-level capability lives on a
   real Membership + Role/Group row, checked via `auth.uid()`.
3. A natural byproduct, not a requirement of this migration: since
   capability lives on Membership+Role rather than one shared secret, a
   tenant could eventually support **multiple** admins — worth naming, not
   required to build now.
4. **Restated, unchanged from Slice 5**: no Chief/org-admin API accepts an
   arbitrary target organisation identity as authority — the claim RPC
   resolves the target tenant from the admin code (today) or the caller's
   verified Membership (target), never from a client-supplied `tenant_id`.
5. `admin_access_code`'s future mirrors `resident_code`'s — a one-time
   claim/enrolment credential, potentially surviving as a convenience
   mechanism for adding *another* admin (functioning like an invite code
   for admin-level Membership), never again the sole standing credential.

---

## 7. Platform operator identity

**Approved, per human decision: a separate platform-level identity/
capability architecture**, treated separately from tenant Chief (§6), per
this section's explicit instruction — and still the highest-priority
remaining item within Slice 6's own scope, even though the acute financial
exposure this identity mechanism gated has since been contained (⚠ above,
E0). Containment stopped the side effects; it did not touch this
mechanism's identity weakness at all.

Current state (§1, §2): a single shared code, one seeded row, zero
per-operator distinction, no strong authentication, and — as this pass
discovered — the credential that a live financial-account-creation Edge
Function *should have been* checking and wasn't (now contained, not fixed —
see ⚠ above).

**Target, locked**: platform operators become real Auth principals, **each
with their own row** (not one shared "Platform Owner"), and **platform
operators must not require tenant membership** — an operator's identity and
capability are entirely platform-scoped, never dependent on being a member
of any organisation. **Every privileged operator action must eventually be
attributable to an individual authenticated operator** — this is a locked
requirement, not a nice-to-have: `saas_operator_logs`/`event_log` entries
currently record a client-asserted `operatorId` that is never verified,
and that must not remain the permanent state (§16). Platform-level
capabilities should be **explicit and possibly graduated** — not just "is an
operator," but potentially distinguishing lower-stakes support actions from
higher-stakes ones like subaccount creation, given the severity difference
found in this pass (§13). Cross-organisation actions remain a legitimate,
explicitly-allowed platform capability (per this section's own instruction
and the Product Constitution) — the requirement is that they be
**authenticated and attributable**, not that they be restricted to one
organisation (they shouldn't be).

**Not conflated with tenant Chief**: platform operator identity is a
platform-level Auth principal + platform-level capability, entirely
separate from any tenant's Membership/Role/Group — an operator does not
need, and should not be modeled as needing, a `workforce` row in any tenant.

---

## 8. Independent/personal users

`doctor_profiles` already satisfies the **shape** the Constitution's Person
concept requires — tenant-agnostic, no forced organisation membership,
already real — **without being constitutionally equated with Person itself**
(§3's Person row, as revised: operationally reused, not the permanent
universal model). The target model does not change the operational reuse;
it extends it: once institutional members also get a `doctor_profiles`-
keyed Auth principal (via claim, §5), the *same table* continues serving
every actor type operationally — there is no parallel table for
"institutional people" vs. "independent people" today, and none is required
by this document. A Person may hold zero Organisation Memberships
(personal-only, today's doctor path exactly as it works now), one, or —
target — several (§3). **No personal-workspace change is implemented in
this slice**, per this section's explicit instruction; this section only
confirms the existing doctor path already satisfies the target Person
*shape* operationally and needs no redesign for that purpose, only reuse —
not that `doctor_profiles` is thereby locked as Person's permanent
definition (§3, §19).

---

## 9. Self-serve organisation creation — target flow, per Slice 5's locked posture

```
Authenticated Person → create Organisation → create OrganisationMembership
  → assign Owner/Admin capability
```

Minimum future flow, not implemented here:

1. The creation route requires an authenticated session **before** it is
   reachable (a route-level gate that does not exist today).
2. **Locked, per human decision — reaffirmed and refined in this
   revision**: the creation RPC is extended (not replaced —
   `create_tenant_with_admin`'s atomic tenant+admin-code creation shape is
   directly reusable) to create the caller's **Organisation Membership**
   (§3 — not a `workforce` row, not a bespoke "owner" record shape) and
   assign it Owner/Admin capability, atomically, in the same transaction as
   the tenant itself. **A separate `tenants.owner_person_id` column is
   reaffirmed as NOT needed for the current target.** Ownership/admin
   authority derives from Organisation Membership + capability, not a
   competing owner pointer — the Owner/Admin Organisation Membership row
   *is* the ownership signal. Two independent ownership authorities (a
   dedicated owner column **and** an Organisation Membership that could in
   principle disagree with it) are avoided **unless later evidence during
   the implementation spec demonstrates a genuine need for a distinct
   tenant-owner pointer** (e.g. if ownership must ever be represented
   independently of any single
   Membership row — not shown to be needed by anything in this pass).
3. **What must happen to the existing anonymously-reachable route during
   migration**: per Slice 5's own locked decision, current behaviour is
   **left unchanged** until this migration lands — no temporary
   verification hack. When this migration does land, the fix is adding the
   authentication gate in front of the existing route, not a separate
   interim mechanism.
4. No new `tenants` column is proposed by this document. If the
   implementation spec later finds a genuine need for one, that is its own
   decision to make with its own evidence, not inherited from this draft.

---

## 10. Active organisation context

- **Client convenience state**: "which organisation's dashboard is
  currently displayed" is fine as pure client-side UI state — cheap to
  change, no security weight.
- **Server-verifiable membership**: any action that reads or mutates
  privileged organisation-scoped data derives the caller's membership from
  `auth.uid()` plus a Membership lookup — never from the client's "active
  org" selection.
- **Derived from request/resource**: for actions targeting a specific
  resource, the organisation context is derived from that resource's own
  `tenant_id`, and the caller's membership is checked against *that*
  tenant — not against whatever the client currently has "selected."
- **Never trusted merely because the client sends a tenant/org id**:
  restates and generalises Slice 5's locked rule beyond just the tenant-
  table RPCs — this applies to every organisation-scoped operation in the
  target model.
- For a Person with multiple future memberships: the client may remember a
  "last active org" as a UI convenience (e.g. a dropdown selection cached
  in `localStorage`), but every privileged server operation independently
  re-derives and re-checks membership regardless of that convenience state
  — switching the UI's active-org lens is never itself an authority grant.

---

## 11. Transitional RPC strategy

```
TODAY: plaintext code re-verification
TRANSITION: Auth principal linked to Person/Membership, with compatibility
  where needed
TARGET: auth.uid()-derived identity → membership/capability verification
  → server-derived or capability-authorised organisation context
```

| RPC category | Today | Transition | Target |
|---|---|---|---|
| Institutional login/identity (`verify_resident_login`, `verify_chief_login`, `chief_get_workforce_codes`, `chief_add_workforce_member`, `chief_reset_resident_code`, `chief_update_admin_code`, `chief_assign_user_role`, `chief_remove_user_role`) | Code-only | Accept `auth.uid()` when present (checked first), falling back to the code parameter only if no session exists — both paths resolve to the same tenant/Membership logic | Code parameter removed entirely; `auth.uid()` required. A breaking signature change, deployed only after every legitimate caller has migrated (§14) |
| Self-serve tenant creation (`create_tenant_with_admin`) | No identity check at all — never carried a transitional secret | Requires an authenticated `auth.uid()` (a route-level gate is the actual change) | Same, plus `owner_person_id` attribution (§9) — this RPC's migration is simpler than the others precisely because it never had a secret to phase out |
| Platform operator (`verify_platform_operator_code`, and any operator-scoped RPCs proposed in Slice 5) | Single shared code | Per-operator `auth.uid()` becomes the primary check; `p_operator_code` retained **only** as a bootstrap/enrolment mechanism for claiming the first operator identity or provisioning a new one — never as the standing per-call credential | `p_operator_code` removed from ongoing operation RPCs entirely |
| Guest review (`create_guest_review_invite`, `get_guest_review_invite`, `submit_guest_review`) | Token-based, already narrow and safe | **No change needed** | Unchanged — already matches the target shape |
| Slice 5's proposed tenant-surface RPCs (`chief_update_tenant_terminology`, `chief_update_tenant_module_flags`, `platform_operator_create_tenant`, `platform_operator_update_tenant_status`, `platform_operator_update_tenant_plan`) | Not yet built | Built with `p_admin_code`/`p_operator_code` **explicitly labeled transitional-only** from day one (already the case per Slice 5's own framing) — auth.uid() path added as an OR/preferred branch as soon as §6/§7's migrations land, not bolted on later | Code parameters removed once the coexistence window (§14) closes |

**Every proposed Slice 5 RPC signature avoids baking `p_admin_code`/
`p_operator_code` into its permanent contract** — this was already true of
Slice 5's own design (each RPC's tenant/target is server-resolved, never a
trusted client parameter); this section confirms that property and extends
the same discipline to every RPC named above. No RPC SQL is written here.

**Locked addition, per human decision — explicit migration-state/
feature-flag concept**: the code → Auth-preferred/code-fallback → Auth-only
evolution above is approved, but **compatibility mode must not become an
indefinite, hidden, code-level fallback** baked silently into each RPC
forever. Two explicit, visible state mechanisms are required (exact schema/
implementation deferred, direction locked here):
- **Per-identity migration state**: whether a *specific* Person/Membership
  has completed claim (§5/§6) must be a real, checkable fact (e.g. a
  `claimed_at`/`migrated_at` timestamp on the Membership row), not inferred
  from whether an `auth.uid()` happens to be present on a given call. This
  is what makes the per-individual-immediate-cutover rule in §14 enforceable
  — an RPC can check "has *this* identity already migrated?" and refuse the
  code-only path if so, independent of the population-wide coexistence
  window.
- **Population-level compatibility switch**: a single, explicit,
  inspectable flag (or small set of them, e.g. per RPC category) controlling
  whether the code-only fallback path is accepted *at all* — so "are we
  still in compatibility mode" is answerable by reading a flag's value, not
  by auditing RPC source code. Turning it off is how legacy credential
  retirement (§14, §17 slice 6) actually happens, not a code deletion
  exercise performed under time pressure.

Exact mechanism (a database table, a `tenants`/global config row, an
environment-level flag, or another repository-compatible pattern) is an
implementation-spec decision, not fixed here — the requirement locked in
this revision is that the mechanism **exists, is explicit, and is
inspectable**, not that compatibility mode be perpetually implicit.

---

## 12. RLS implications (conceptual primitives only — no policies written)

Reusable auth primitives future RLS will need, as SQL helper functions
(mirroring the existing, now largely-dead `has_role()` helper's *shape*, not
its logic):

- **`current_person()`** — `auth.uid()` itself; trivial.
- **`current_memberships()`** — **revised to query Organisation Membership
  (§3), not `workforce` directly.** The set of `(tenant_id, org_group_id)`
  rows for the calling Person's **Organisation Memberships**. Once the thin
  Membership structure exists (§3, §17), this queries it directly. **Before
  that structure exists**, a V1-only approximation over `workforce WHERE
  doctor_id = auth.uid()` captures workforce-type members' memberships but
  — correctly, per §3/§6's resolved model — **would not** capture a Chief
  or organisation owner whose Organisation Membership carries no Workforce
  Record. This is named explicitly as a known limitation of the V1
  approximation, not silently glossed over: any RLS/capability check that
  needs to cover Chiefs/owners without a Workforce Record cannot rely on
  the `workforce`-only approximation and needs the real Membership
  structure first.
- **`membership_check(target_tenant_id)`** — boolean, built from the above.
- **`capability_check(target_tenant_id, capability_key)`** — checks the
  caller's Organisation Membership's `org_groups` capability key(s) (§3) for
  that tenant.
- **`ownership_check(row)`** — for personal/doctor-owned rows, the exact
  `auth.uid() = doctor_id` pattern already live since migrations 25/31/40/
  51/57. **Fully supported today, no gap.** (This one is about direct
  row ownership by a Person, not about Organisation Membership at all —
  unaffected by this revision.)
- **`platform_capability_check(capability_key)`** — analogous, against the
  redesigned `platform_operators` (§7) — platform-level, not an Organisation
  Membership check at all, per §7's "must not require tenant membership."

**Critical finding, load-bearing for sequencing (§17)**: RLS policy
expressions cannot reference a stored-procedure parameter like
`p_admin_code` — they can only reference session-level facts like
`auth.uid()`. **This means real row-level RLS enforcement on institutional
tables is structurally blocked until Organisation Membership is real and
`auth.uid()`-keyed.** Until then, the enforcement layer for anything beyond
already-doctor-owned rows must remain RPC-body-based (`SECURITY DEFINER`
functions), exactly as it is today — not a limitation of this spec's
design, a hard fact about how Postgres RLS works. This independently
confirms why `docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` and
`docs/TENANT_SURFACE_SECURITY_SPEC.md` both correctly deferred institutional
RLS narrowing behind this migration rather than attempting it directly.

`ownership_check` needs no new structure — it is a direct Person-owns-row
check, unrelated to Organisation Membership. The other four depend on §3's
Organisation Membership primitive landing first. Per §3's V1 evolutionary
constraint, that does not have to mean a large new schema paradigm
immediately — the smallest viable version may still be a thin structure
plus linking `workforce` to it as one Workforce-Record kind — but it is a
genuinely new relation/concept, not merely "one constraint, one column" on
`workforce` as an earlier draft of this section understated.

---

## 13. Edge Function implications

Complete audit, all 7 functions in `supabase/functions/`:

| Function | `--no-verify-jwt` | Client | Trusted-as-given fields | Severity |
|---|---|---|---|---|
| `dissertation-copilot` / `casebook-copilot` / `research-copilot` | Yes, by design (own headers state no Auth sessions exist to verify) | Service-role (bypasses RLS) | `tenant_id` — used only for quota accounting/prompt-override lookup, never verified | Cost-bearing (real AI spend), but a forged `tenant_id` only skews another tenant's quota counter — moderate |
| `roster-parser` | Same | Same | Same pattern | Same, moderate |
| `payment-webhook` | Yes, **required** — providers can't send a Supabase JWT | Service-role | N/A — authenticity comes from provider signature verification (Paystack HMAC-SHA512, Flutterwave hash-equality), not caller identity | **Already correctly designed** — a model for how a non-JWT-verifiable caller can still be safely authenticated |
| `payment-checkout` | Yes | Service-role | `provider`, `scope`, `workforce_id`, `tenant_id`, `email` — **all trusted as given, only presence validated, never ownership**, as originally written | **As originally found**: a self-funded checkout could insert a pending subscription attributing itself to an **arbitrary target `tenant_id`/`workforce_id`**, which `payment-webhook` would then legitimately activate. **Current state: CONTAINED, not fixed** — Emergency Slice E0 (deployed, `ACTIVE` v7) makes this function fail closed before any of the above logic runs. The identity gap in the source shown here is preserved as evidence for why the migration in this document is needed; it is no longer reachable in the deployed function. |
| `platform-operator-subaccount` | Yes, header **self-admits** the gate is client-only | No Supabase client — calls Paystack directly with a live secret key | `business_name`, `settlement_bank`, `account_number`, etc. — **zero verification of any kind**, as originally written | **As originally found**: highest severity in this document — created a real financial artifact with attacker-controlled payout details. **Current state: CONTAINED, not fixed** — Emergency Slice E0 (deployed, `ACTIVE` v2) makes this function fail closed before any of the above logic runs. See ⚠ note at top of document. |

**JWT verification expectation, going forward**: once real institutional
`auth.uid()` exists, cost-bearing/privileged functions should read and
verify the caller's JWT (Supabase's `--no-verify-jwt` deploy flag only
skips the *platform's automatic* check — a function can still manually
verify a bearer token itself) and derive `tenant_id`/`workforce_id` from a
Membership lookup keyed on that verified identity, rather than trusting
client-supplied fields. **Service-role use should be reserved for
genuinely server-to-server flows with independent authenticity**
(`payment-webhook`'s signature check is the correct model) — not, as it
currently is for `payment-checkout` and `platform-operator-subaccount`, a
stand-in for having no caller identity to check at all. **Audit
attribution**: every privileged function call should log a real,
verified caller identity once available, not a self-asserted parameter.

**Minimum auth contract future automation must inherit**: per the Product
Constitution §11 (attributable, auditable, delegated authority), any Edge
Function that becomes an automation-execution surface **cannot** be built on
the current no-JWT-plus-trust-the-body pattern — this reinforces and makes
concrete the finding already flagged in `docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md`
§4c. Server-verifiable identity is a hard prerequisite for any future A2/A3
automation touching these functions, not a nice-to-have.

**`platform-operator-subaccount`'s original finding was the single most
urgent item across Slices 4, 5, and 6 combined; it is now contained (⚠
callout, §19 item 5, revised).** The underlying identity gap it exposed —
no server-verifiable platform-operator identity — remains the
highest-priority *unresolved architecture* item in this document, even
though the acute financial exposure itself has been closed.

---

## 14. Session migration and coexistence

**Locked, per human decision — default maximum legacy coexistence window =
90 days**, subject to explicit adjustment before rollout begins (a human
call at implementation time, not re-opened by this document). This is the
*outer bound* for the **unmigrated population**, not a blanket grace period
for everyone regardless of status — see the per-individual rule below,
which is the more important of the two mechanisms.

- **Old session recognition**: existing localStorage-based sessions (all
  three code-based actor types) continue working unmodified for
  **unmigrated** individuals through the coexistence window — no
  deployment-day breakage.
- **Enrolment prompt/claim**: a non-blocking in-app nudge toward the claim
  flow (§5/§6) for already-logged-in users, becoming progressively more
  insistent as the window closes; new logins are offered the claim path
  alongside the existing code login from day one.
- **Locked, per human decision — per-individual immediate cutover, not a
  population-wide event**: coexistence applies **only to individuals who
  have not yet claimed/migrated**. The moment a specific Person
  successfully completes claim (§5) or Chief migration (§6), **code-only
  server authorization for that individual must be disabled
  immediately** — not at the end of the 90-day window, not batched with
  everyone else. This requires the per-identity migration-state check
  named in §11 (a real, checkable "has this identity claimed?" fact) to be
  consulted on every privileged call, not just a population-level flag.
  Practically: a claimed Person's `resident_code`/`admin_access_code` stops
  being accepted as sole server authorization for *that person* the instant
  their claim RPC succeeds, even while the RPC as a whole still accepts the
  code-only path for everyone who hasn't claimed yet.
- **Authenticated replacement session**: once claimed, the app prefers the
  real Supabase Auth session for privileged operations — mirroring the
  doctor→workforce convergence pattern that already exists in `App.tsx`
  today (§1 actor 4), extended to cover the resident/Chief paths.
- **Expiry/deprecation of legacy authorization for the remaining unmigrated
  population**: at the 90-day (or adjusted) window's end, the code-only RPC
  paths are disabled server-side **for whoever has not claimed by then** —
  mirroring the atomic-transition discipline already established for RLS
  policies in `docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §10: no indefinite
  dual-permissive state, and no indefinite per-population fallback either.
- **Rollback strategy**: the legacy code-verification logic stays present
  in each RPC body (not deleted) until both the per-individual cutover and
  the population-wide window-end cutover have run and been verified working
  — a revert is a config/flag flip (§11), not a code rewrite.
- **Avoiding indefinitely maintaining two systems**: the window has an
  explicit end condition — the 90-day default (or its adjusted value),
  **not** an open-ended claim-rate threshold as previously drafted; a
  documented manual-recovery path for stragglers (§5 item 8, §15) covers
  whoever hasn't claimed by the hard cutover.

---

## 15. Identity linking and duplicate prevention

- **One Auth principal claiming multiple people incorrectly**: prevented
  structurally — a claim attempt requires a valid code for one *specific*
  pre-existing row; the resulting link is unique per row (§5 step 6).
- **Two Auth principals claiming the same Person**: prevented by the same
  uniqueness constraint — a second claim against an already-linked row is
  rejected, mirroring exactly how `chief_link_doctor_by_email` already
  behaves today (a real, live, reusable precedent, not a new design).
- **Duplicate workforce records**: a data-quality problem, not an identity-
  architecture one — explicitly out of this spec's scope, not solved here.
- **Email/phone reuse**: `workforce.email` already has a partial unique
  index; `doctor_profiles.email` is already `NOT NULL UNIQUE`; Supabase
  Auth itself enforces one `auth.users` row per verified email — the claim
  flow's OTP step naturally prevents two principals claiming via the same
  address.
- **A Person belonging to multiple organisations**: already structurally
  supported (`workforce.doctor_id` not unique) — the target model formalizes
  this as multiple Membership rows, one per tenant, per §3.
- **Existing doctor profile + institutional workforce record belonging to
  the same human**: this is **exactly** what `workforce.doctor_id` (migration
  18) already does — the institutional claim flow (§5) is an extension of
  this exact existing linking mechanism, made self-service-initiated
  (OTP-verified) rather than only Chief-initiated as it is today.
- **Manual administrative recovery — locked, per human decision**: for
  cases automatic matching can't resolve confidently (email mismatch, no
  email on file, suspected fraud), an explicit **Needs Review** state —
  mirroring the same "deterministic, conservative, explicit-review-on-
  ambiguity" philosophy already established in
  `docs/WORKFORCE_V1_RECOVERY_SPEC.md` §4 — routed to **explicit
  Chief/admin-assisted recovery, with audit logging of the recovery action
  itself** (who assisted, when, which identity was resolved to which
  record — feeding the same `event_log`/actor-attribution requirement as
  §16), using the same underlying linking RPC pattern that already exists.
- **Not overbuilt, and explicitly bounded — locked, per human decision**:
  no fuzzy matching, no automatic merging of ambiguous records, and **no
  AI-based identity resolution of any kind** — not as a convenience
  feature, not as a fallback, not anywhere in the claim/recovery path.
  Deterministic rules only (exact code + exact verified email), with a
  human-mediated, audit-logged manual fallback for everything else,
  consistent with this repo's own established conservative-matching
  precedent (`docs/WORKFORCE_V1_RECOVERY_SPEC.md`'s "Needs Review /
  Unknown," never inferred).

---

## 16. Auditability (minimum requirements — not building the system)

Minimum attribution needed for: login/claim, Membership creation, role/
capability assignment, organisation creation, Chief/admin changes,
platform-operator actions, and future automation actions.

**All of these already route through `SECURITY DEFINER` RPCs that could
attribute a real actor once one exists** — several already call `emitEvent`
for other purposes (e.g. `createTenantWithAdmin` already emits
`tenant.provisioned`). The single blocking gap, already identified
independently in `docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §6: **`event_log`
has no per-actor column at all.** The minimum fix is one nullable
`actor_person_id` column, populated once real identity exists, with the RPCs
above becoming real call sites for it. This is a small, additive schema
change — named here as required future work, **not built in this document**.
Future automation actions inherit the same requirement, per the Product
Constitution §11 — an execution with no attributable actor remains, as
already established, not a permitted shape.

**Two specific attribution requirements are now locked (not just
minimums)**, both dependent on this same `actor_person_id` gap being
closed: (1) **platform-operator actions** — every privileged operator
action must eventually attribute to an individual authenticated operator,
per §7, not a client-asserted `operatorId`; (2) **manual identity-recovery
actions** — every Chief/admin-assisted recovery (§15) must be audit-logged
with who assisted and what was resolved. Neither is built in this document;
both are named here as concrete, non-optional call sites for the
`actor_person_id` fix once it lands.

---

## 17. Migration sequencing

| Slice | Schema impact | Product-code impact | Compatibility impact | Security risk | Verification | Rollback boundary |
|---|---|---|---|---|---|---|
| **1. Foundation/linking primitives** — a **thin Organisation Membership structure** (§3: `Person ↔ Organisation`, carrying/connecting to lifecycle-status, Role/Group, capability-key vocabulary, and optionally a link to a Workforce Record), `event_log.actor_person_id` (nullable), extensible capability-key vocabulary for `org_groups`/Membership (§3, not indefinite boolean columns), the per-identity migration-state field and population-level compatibility flag (§11) | A new small relation for Organisation Membership + a new small relation for capability keys; several additive `ALTER TABLE`s elsewhere | None required — nullable/additive, don't break existing code; `workforce`/`doctor_profiles`/existing login paths untouched, per §3's V1 evolutionary constraint | None — pure addition | None — no auth/policy change | Schema-only smoke tests | Trivial — drop the new relations/columns |
| **2. Institutional identity claim/enrolment** (§5) | `workforce.doctor_id` link becomes the real target of a new claim RPC; **the claim RPC also creates/links the Person's Organisation Membership** (progressive linking of the existing Workforce Record to the new Membership structure, per §3's evolutionary constraint — not a replacement of `workforce.doctor_id`) | New claim UI path alongside existing code login | Additive — old login unaffected during coexistence | Medium — new privileged linking RPC, must enforce §15's duplicate-claim rules carefully | Manual claim-flow test + negative duplicate-claim tests | Disable the new route/RPC; old flow keeps working |
| **3. Chief/admin migration** (§6) | Mirrors slice 2, for `admin_access_code`, **creating an Organisation Membership directly — no `workforce` row required or created for a Chief who doesn't already have one** (§6, resolved) | New admin claim UI path | Additive | Higher — elevated privilege, extra review warranted | Same pattern as slice 2, plus admin-capability-specific tests | Same |
| **4. Platform-operator migration** (§7) | `platform_operators` becomes per-person | New operator claim path; migrate the single "Platform Owner" row | Additive | **Still the highest remaining priority within Slice 6's own scope** — not because of live exposure (E0 has contained that, ⚠ above), but because it is the least-developed identity mechanism in the schema and the one this pass found weakest overall (§19 item 5, revised) | Operator-specific negative tests | Same pattern |
| **5. Tenant-surface RPC authorization upgrade** (Slice 5's RPCs, §11) | None beyond Slice 5's own | Build/migrate per Slice 5 §14's sub-steps | Additive | Per Slice 5's own analysis | Slice 5's own negative-test plan | Slice 5's own rollback plan |
| **6. Legacy credential retirement** (§14, revised) | None | **Two-part**: per-individual code-path disable at the moment each claims (continuous, throughout slices 2-4's rollout, not a separate event); population-wide code-only path disabled server-side at the 90-day (or adjusted) window's end for whoever hasn't claimed | **Breaking, by design, for the unmigrated remainder at window-end**; non-breaking and continuous for the per-individual part | Population-wide cutover requires the window's end genuinely arriving, per the locked 90-day default | Confirm per-individual disable fires on every successful claim (test per slice 2-4); confirm window-end cutover criteria before the population-wide step | Re-enable the legacy path via the compatibility flag (§11) — kept dormant, not deleted, until this point |
| **7. Broader RLS migration** | Real policy changes on institutional tables | None beyond what Tenancy spec §10 already scoped | Requires slices 1-6 complete | Addressed by `docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §10's corrected atomic-transition strategy | Per that document | Per that document |

This sequence is derived from repository evidence (the reusable-RPC-pattern
finding in §2, the RLS-blocked-until-Membership finding in §12) rather than
assumed — the suggested shape in the source prompt (foundation → claim →
Chief → operator → tenant-surface → retirement → RLS) matches what the
evidence supports, with one explicit deviation recommended: **operator
migration (slice 4) deserves elevated priority as the weakest identity
mechanism in the schema**, not because of live exposure (E0 already closed
that), and not strict adherence to the default order.

---

## 18. Priority-0 combined architecture review

Reconciling this document with `docs/TENANT_SURFACE_SECURITY_SPEC.md`:

**1. Can Priority-0 tenant-surface implementation still safely precede full
institutional-auth *implementation*?** Yes. Priority-0's RPCs don't need
real Auth to be *safe* — they reuse the same transitional-code-verification
pattern already proven safe elsewhere (§2's pattern finding). "Precede full
Auth implementation" and "wait for the Auth migration to be *designed* first"
(Slice 5 Decision 5, restated in this document's own header) are not in
tension — the former is about code safety, the latter about design
sequencing.

**2. Which RPCs should be built transitional-code-aware versus waiting for
Auth?** The discovery RPC (`list_public_tenants()`) has no identity concept
at all — build immediately, no dependency on anything in this document. The
Chief-scoped mutation RPCs (`chief_update_tenant_terminology`/
`chief_update_tenant_module_flags`) are **better built after §6's Chief
migration lands**, so they can be `auth.uid()`-preferred from day one rather
than needing a second pass — a genuine tradeoff, not a hard rule; if
timeline pressure requires building them sooner, building them code-only
now with the transitional label already satisfies §11's requirement, just
at the cost of a later second pass.

**3. Is any Slice 5 design now unnecessary because Auth provides a simpler
route?** Nothing is *wasted* — the "resolve tenant from `p_admin_code`"
logic Slice 5 designed becomes "resolve tenant from `auth.uid()`'s
Membership," a simpler version of the same shape, not a different one. One
genuine simplification: **if Priority-0 implementation is sequenced after
operator migration (§7), the platform-operator-scoped RPCs
(`platform_operator_create_tenant`, etc.) can be built `auth.uid()`-native
from the start, skipping the transitional-code phase for those specific RPCs
entirely** — worth taking, since it avoids throwaway work.

**4. What is the smallest security implementation before Workforce Option
A?** Option A itself needs nothing (Slice 4 §8, unchanged). "Before Option
A" is a sequencing artifact of Slice 5 Decision 5, not a safety dependency.
The smallest unit that satisfies that sequencing without overbuilding: the
discovery RPC (zero identity dependency) plus closing the direct-write paths
(`createTenant`/`updateTenant*`) via the operator/Chief RPCs — the actual
mutation-risk findings from Slice 5. The full authorised-read surface
(`TenantCustomizationView` etc.) is lower urgency and can follow Option A
without contradicting its "safe now" verdict. **The `platform-operator-
subaccount`/`payment-checkout` financial exposure named throughout this
document as ⚠ has since been contained via Emergency Slice E0 (deployed,
both `ACTIVE`)** — it is no longer a live, accelerated-handling question;
the platform-operator identity migration itself (§7, §17 slice 4) remains
worth prioritising highly, but as ordinary (if high-priority) Slice 6
sequencing, not an emergency folded into "before Option A" reasoning.

**5. What should deliberately wait until after Workforce Option A?**
**Locked, per human decision — this finding is preserved, not expanded by
any revision in this document**: the full claim-flow *build* (§5/§6, as
opposed to this document's design of it), legacy credential retirement
(§14), broader institutional RLS migration (§12/§17 slice 7), and
platform-operator's full redesign (§7) — none of these are prerequisites
for Option A's safety, and nothing in this revision extends Slice 6 into a
prerequisite for rebuilding Workforce beyond the minimum security
sequencing already approved in Slice 5. Option A may proceed on its own
timeline regardless of how much of Slice 6 has actually been built.

---

## 19. Unresolved human decisions (revised)

**Locked by this revision — no longer open**:
- Primary Auth method: email OTP/magic-link, password secondary (§4).
- Existing codes are transitional claim/enrolment credentials only, never
  a permanent standalone credential again (§4, §5, §6).
- Person is profession-neutral; `doctor_profiles` is operationally reused
  (no new generic people table required for the first Membership
  implementation), not constitutionally equated with Person (§3, §8).
- **Organisation Membership is introduced as its own distinct,
  profession-neutral primitive**, representing `Person ↔ Organisation`
  independently of Workforce Operations participation — `workforce` is
  explicitly **not** its permanent universal representation.
  `Person → OrganisationMembership → WorkforceRecord (optional)` is the
  locked conceptual shape (§3).
- A Workforce Record (`workforce`) is a separate, optional domain record
  that exists only where a member participates in managed Workforce
  Operations — a Membership does not require one (§3, §6).
- **Resolved — the prior draft's open Chief/Owner-Admin Membership-carrier
  gap**: a Chief or organisation owner with no pre-existing `workforce` row
  gets an Organisation Membership directly; no special "admin identity" or
  fake Workforce Record is invented (§6, §9).
- V1 evolutionary constraint: no big-bang refactor — `workforce.tenant_id`,
  `workforce.doctor_id`, existing login paths, and operational code may all
  remain during migration; existing Workforce V1 is not rewritten around
  the new primitive before its own separately reviewed migration slice
  (§3, §17).
- Chief/org-admin is a Role/Group + Capability grant carried by an
  Organisation Membership, not an identity type (§6).
- Platform operators get a separate platform-level identity/capability
  architecture, must not require tenant membership, and every privileged
  operator action must eventually be individually attributable (§7).
- `tenants.owner_person_id` is explicitly **not** needed for the current
  target, reaffirmed in this revision — ownership/admin authority derives
  from Organisation Membership + capability, not a competing owner pointer,
  unless later evidence shows a genuine need for a separate one (§9).
- Self-serve creation target sequence locked: `Authenticated Person →
  create Organisation → create OrganisationMembership → assign Owner/Admin
  capability` (§9).
- Active-organisation-context design (§10) — approved as drafted.
- RPC evolution path (code → Auth-preferred/code-fallback → Auth-only)
  approved, with an explicit per-identity migration-state fact and a
  population-level compatibility flag now required (§11).
- Capability model **direction**: an extensible capability-key vocabulary
  across modules, carried by the Organisation Membership/Role, not
  indefinite boolean columns on `org_groups` (§3) — exact shape still
  open, see below.
- Coexistence: 90-day default maximum window for the unmigrated population,
  subject to pre-rollout adjustment; per-individual cutover is immediate on
  successful claim, not deferred to the window's end (§14).
- Recovery for members without usable email: Chief/admin-assisted,
  audit-logged, no fuzzy matching, no AI-based identity resolution (§5 item
  8, §15).
- The `platform-operator-subaccount`/`payment-checkout` financial exposure
  is contained (Emergency Slice E0, deployed) — no longer an open "should
  we accelerate a fix" question (⚠, §13, §18).
- Workforce Option A does not require the full Auth migration, and Slice 6
  is not expanded into a prerequisite for rebuilding Workforce beyond the
  already-approved minimum security sequencing (§18 item 5).

**Still open, revised or newly surfaced by this revision**:
1. **Member enrolment/claim UX exact timing** — soft-nudge banner duration
   before claim becomes required; forced-claim-on-next-login vs. a longer
   grace period, within the locked 90-day outer bound (§14).
2. **Legacy PIN/code long-term future beyond the coexistence window** —
   once every currently-active member has either claimed or been cut over,
   does the code concept disappear entirely, or persist indefinitely as a
   secondary local convenience PIN for already-claimed identities (§5 step
   5)? Not the same question as the (now-locked) coexistence window itself.
3. **Exact evidence a Chief must check during manual recovery** (§5 item 8,
   §15) — the mechanism (human-mediated, audit-logged, no AI/fuzzy
   matching) is locked; the specific verification standard is not.
4. **Exact thin-Organisation-Membership schema shape and linking timing**
   (§3, §17, narrowed by this revision) — the *concept* (a distinct
   Membership primitive, `workforce` as one optional Workforce-Record kind
   under it, progressive linking rather than replacement) is now locked;
   what remains open is the exact relation shape, when precisely `workforce`
   rows get linked to it during rollout, and whether any other Workforce-
   Record-like carrier is needed beyond `workforce` for V1 specifically.
5. **Person-vs-`doctor_profiles` long-term architecture** (§3) — given
   Person is now locked profession-neutral while `doctor_profiles` remains
   the sole physical implementation, is a future generically-named table/
   view ever introduced, or does `doctor_profiles` get reinterpreted in
   place (no rename, per M1) indefinitely? Not decided.
6. **Exact migration-state/feature-flag mechanism** (§11) — a database
   table, a config row, an environment flag, or another pattern; the
   requirement (explicit, inspectable, not silently indefinite) is locked,
   the mechanism is not.
7. **Exact capability-key taxonomy per module** (§3) — the direction
   (extensible key vocabulary spanning Workforce, Research, Meetings,
   Forms, Scheduling, future modules) is locked; the actual key names/shape
   are implementation-spec work.
8. **Sequencing priority of platform-operator migration relative to the
   default slice order** (§17 slice 4) — still recommended elevated, now
   for architectural-weakness reasons rather than live-exposure urgency
   (since E0 closed that); exact scheduling still a human call.

## Explicit non-goals of this slice

- No source, schema, migration, RLS policy, Supabase Auth configuration,
  Edge Function, production data, dependency, deployment configuration, or
  UI behavior was modified to produce this document.
- No RPC or policy SQL was written.
- No provider configuration was implemented (§4).
- No personal-workspace changes were made (§8).
- Does not design the full Automation Engine — only names the identity
  prerequisites automation will need (§13, consistent with
  `docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §6's own scope boundary).
- Does not build the audit system (§16) or the negative-test suite named
  throughout — defines requirements only.
- Does not itself fix the underlying platform-operator identity gap the ⚠
  finding exposed — that fix is §7's migration, not built in this document.
  The acute financial side effect was separately contained via Emergency
  Slice E0 (its own commits, `24045df`/`bb76e2b`/`048676d`), not by anything
  in this document.
- Does not reopen any decision already locked in the Product Constitution,
  the Tenancy/Auth/RLS Recovery Spec, the Tenant Surface Security Spec, or
  this document's own prior human-architecture-review decisions (this
  revision) — extends and reconciles with them only (§18).

---

Stopping here per Slice 6's instruction. No source, schema, migration, RLS,
Supabase Auth configuration, Edge Function, production data, dependency,
deployment configuration, or UI behavior was touched to produce this
document (the ⚠ finding's containment was performed separately, under
Emergency Slice E0, not by this document). This revision incorporates the
human architecture-review decisions received; still not committed. Awaiting
approval before this revised document is committed, and before any further
PLAN or implementation step proceeds.
