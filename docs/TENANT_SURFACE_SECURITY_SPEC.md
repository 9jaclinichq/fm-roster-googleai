# Priority-0 Tenant Surface Security Specification (Slice 5 — DISCOVER + PLAN)

Status: **proposed, unreviewed. Not committed. No code/schema/migration/RLS/
auth/dependency/deployment/UI change made to produce this document.**
Scope authority: `AGENTS.md` → `docs/WORKSPC_PRODUCT_CONSTITUTION.md` →
`docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §4a/§9/§11 item 1.

Purpose: design the smallest safe evolutionary fix for the `tenants`
exposure Slice 4 identified as Priority 0 — anonymous `SELECT`/`INSERT`/
`UPDATE` access to the organisation table itself — without prematurely
solving the entire institutional-auth/RLS architecture (that remains the
Institutional Auth Migration Spec's job, per Slice 4 §11 item 2).

All findings below are produced by direct source/migration-file reading in
this pass — every consumer listed was independently re-verified against
current source, not carried forward from Slice 4's inventory unchecked. No
live database was queried. Per `docs/WORKSPC_PRODUCT_CONSTITUTION.md` M10:
migration file exists ≠ approved ≠ applied — nothing below claims live
state.

Revision 2 (2026-08-20): revised per six locked human decisions —
`terminology_overrides` is now classified private, not a flagged boundary
case (§3); the public discovery projection is fixed to `id`/`name`/
`institution`/`department` only, with active/discoverable filtering
server-side and no `status` field returned (§3); the discovery mechanism is
locked as a read-only RPC, `list_public_tenants()`, not left open against a
view (§4); column-level `GRANT`/`REVOKE` is confirmed strictly optional
defense-in-depth, not primary architecture (§4); every `p_admin_code`/
`p_operator_code` RPC parameter is now explicitly labeled transitional
compatibility, not the target API contract, and Chief/org-admin RPCs are
confirmed to accept no target `tenant_id` at all (§5, §11); self-serve
organisation creation's target posture is locked (verified person → create
org → become its initial owner/admin membership), with anonymous creation
confirmed not the permanent architecture but left unchanged in this slice
(§6); the negative-test plan is refined to prove the *absence* of a
cross-organisation Chief/org-admin API path rather than testing rejection
of a parameter that shouldn't exist (§9); and an explicit sequencing order
is recorded — this spec, then the Institutional Auth Migration
Specification, then a combined human architecture review, before Priority-0
implementation begins (§11, §14).

---

## 1. Verified `tenants` consumer inventory

Every `.from('tenants')` call site in `src/` was located and traced to its
caller(s). There are exactly two files that touch the table directly:
`src/lib/databaseService.ts` (all client-side reads/writes) and
`src/modules/shared/lib/udr.ts` (one read, same shape as `getTenant`). No
other file queries `tenants` directly — every UI component goes through
`databaseService`.

### Reads

| Function | Query | Called from | Fields actually used | Anon/authenticated | Context |
|---|---|---|---|---|---|
| `getTenants()` | `select('*')`, all rows | `TenantSelectorView.tsx` | `id`, `name`, `institution`, `department`, `status` (client-filters `status==='active'`) — **current state; target is `list_public_tenants()` returning only `id`/`name`/`institution`/`department`, server-filtered, per Decision 1/§4** | **Anonymous** — pre-login | Tenant picker, first login step |
| `getTenants()` | (same) | `ResidentLoginView.tsx` | Tenant list for the member-login dropdown — same target migration as above | **Anonymous** — pre-login | Institutional login |
| `getTenants()` | (same) | `SaaSOperatorConsoleView.tsx` | Full row (management table) | Operator-code-gated (client-side only, per Slice 4 §5) | Platform operator |
| `getTenant(id)` | `select('*')`, single row | `TerminologyProvider` (`terminology.tsx`) | **Only** `terminology_overrides` — **current state; per Decision 1 this field is private, so the target fix is pre-login pages using neutral default terminology instead of this call, not exposing the field publicly (§3, §14 — not implemented this slice)** | **Anonymous** — mounted on every page, including pre-login (`DEFAULT_TENANT_ID` fallback) | Vocabulary/copy rendering everywhere |
| `getTenant(id)` | (same) | `TenantCustomizationView.tsx` | Full row (it's the tenant settings editor) | Chief-session-gated (client-side only) | Org-admin tenant config |
| `getTenant(id)` | (same) | `TemplateManagerView.tsx` | **Only** `plan_type` (free-tier gate) | Chief-session-gated | Org-admin content gating |
| `getTenant(id)` | (same) | `CasebookBuilderView.tsx` | `plan_type` (billing/quota gating, same pattern) | Resident/doctor-session-gated | Member workspace |
| `getPlatformAnalyticsSummary()` | `select('id', {count:'exact'})` | `SaaSOperatorConsoleView.tsx` | Row count only | Operator-code-gated | Platform operator |
| `getTenantUsageBreakdown()` | `select('id, name, plan_type, status')` | `SaaSOperatorConsoleView.tsx` | `id`, `name`, `plan_type`, `status` | Operator-code-gated | Platform operator |
| (duplicate of `getTenant`) | `select('*')`, single row | `udr.ts`'s `fetchTenant` | Composed into `UdrTenant` (`id`, `name`, `short_code`, `plan_type`, `status`) | Resident/doctor-session-gated | UDR composition (Slice 2 spine work) |

### Writes

| Function | Mechanism | Called from | Depends on permissive table RLS? | Context |
|---|---|---|---|---|
| `createTenantWithAdmin()` | `create_tenant_with_admin` RPC (`SECURITY DEFINER`, migration 24) | `CreateOrganizationView.tsx` | **No** — RPC bypasses row policies entirely. **Already the safe pattern.** | Self-serve org creation, reachable **without any authentication** (see §6) |
| `createTenant()` / `createTenantWithPaystackSubaccount()` | Direct `.insert()` | `SaaSOperatorConsoleView.tsx` | **Yes** | Platform operator |
| `updateTenantStatus()` | Direct `.update()` | `SaaSOperatorConsoleView.tsx` | **Yes** | Platform operator (suspend/reactivate) |
| `updateTenantPlan()` | Direct `.update()` | `SaaSOperatorConsoleView.tsx` **only** — confirmed by direct grep, not called from `TenantUpgradeCheckoutModal.tsx` | **Yes**, for this manual-override path | Platform operator manual override |
| `updateTenantTerminology()` | Direct `.update()` | `TenantCustomizationView.tsx` | **Yes** | Org-admin (Chief) |
| `updateTenantModuleFlags()` | Direct `.update()` | `TenantCustomizationView.tsx` | **Yes** | Org-admin (Chief) |
| `payment-webhook` Edge Function | Direct `.from('tenants').update({plan_type:'tier_1'})`, its own `createClient` call | Paystack/Flutterwave server-to-server callback | **No** — confirmed: this Edge Function instantiates its Supabase client with `SUPABASE_SERVICE_ROLE_KEY`, not the anon key. **Already bypasses RLS entirely, unaffected by any policy change.** | Self-serve billing plan promotion — the actual production path for organisation upgrades; `TenantUpgradeCheckoutModal.tsx`'s own header comment confirms activation "happens ONLY in the payment-webhook Edge Function, never in this client code" |

**Net**: 3 of the 6 client-invoked write functions, plus 2 of the 3 read
functions' 6 call sites, genuinely depend on `tenants`' current permissive
RLS. One write path (self-serve creation) and one write path (billing
promotion via webhook) are **already** structurally safe today, proving both
of this spec's eventual patterns (RPC re-verification; service-role
bypass) already work in this exact codebase.

---

## 2. Re-read governing documents (confirmed before analysis)

- `AGENTS.md`: source-of-truth hierarchy and hard boundaries — followed;
  no product/schema/RLS/auth/dependency/deployment change made.
- `CLAUDE.md`: DISCOVER→PLAN→HUMAN REVIEW workflow, no elevated live-DB
  access — followed; no live database touched.
- `docs/WORKSPC_PRODUCT_CONSTITUTION.md` §14/§17: organisation boundaries
  are a hard backend security boundary (product requirement, not
  aspiration); evolutionary preservation has an explicit safety exception
  for security defects — this slice designs within that exception without
  invoking it as license to implement early.
- `docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §4a/§9/§11: `tenants` named
  Priority 0; this document is the spec that section called for.

---

## 3. Public discovery vs. authorised configuration

`Tenant`'s full column set (`src/types.ts`): `id`, `name`, `short_code`,
`institution`, `department`, `plan_type`, `status`, `paystack_subaccount_code`,
`terminology_overrides`, `module_flags`, `created_at`.

### Public tenant discovery (pre-login, unauthenticated) — **locked projection**

Confirmed necessary by source, and no more than this — per Decision 1, the
approved public projection is exactly four fields:

| Field | Needed pre-login because |
|---|---|
| `id` | Carried forward as the selected tenant for the next login step (`TenantSelectorView` → `ResidentLoginView` route state) |
| `name` | Rendered on the selector card |
| `institution`, `department` | Rendered as the selector card's subtitle |

**`status` is explicitly NOT part of the public projection.** Discoverable/
active filtering happens **server-side**, inside `list_public_tenants()`
itself (§4) — the RPC simply never returns a suspended/non-discoverable
tenant row at all. Today, `TenantSelectorView.tsx` fetches every tenant via
`select('*')` and filters `status === 'active'` client-side; that
client-side filtering pattern is what the RPC replaces, not a field the
public surface should expose so the browser can keep doing its own
filtering.

**`short_code`, `plan_type`, `paystack_subaccount_code`, `module_flags`,
`created_at`, and `terminology_overrides` are all private.** Per Decision 1,
`terminology_overrides` is classified **private configuration**, not a
boundary case — pre-login surfaces should use neutral Workspc default
terminology (`TERMINOLOGY_DEFAULTS` in `terminology.tsx`) rather than
requiring an organisation's full terminology configuration before
authentication. **This slice does not implement that pre-login terminology
UX change** — `TerminologyProvider` still calls `getTenant(tenantId)` today,
unchanged. The change is recorded here as part of the eventual coordinated
implementation (§14), not made now.

### Authorised tenant configuration (session-scoped, not public)

Everything else, unconditionally: `short_code`, `plan_type`, `module_flags`,
`paystack_subaccount_code`, `created_at`, `terminology_overrides`.

**Read-side roles needed, distinguished, not yet all real**:
- Org-admin (Chief) reads: `TenantCustomizationView` needs the full row
  (it's the editor); `TemplateManagerView`/`CasebookBuilderView` need only
  `plan_type`.
- Platform-operator reads: `SaaSOperatorConsoleView` needs the full row plus
  aggregate counts across all tenants — a strictly broader capability than
  any single org-admin should ever have.

**Write-side capabilities needed, distinguished**:
- Org-admin (Chief) capability: update *their own* tenant's
  `terminology_overrides`/`module_flags` only.
- Platform-operator capability: create tenants, update *any* tenant's
  `plan_type`/`status` — a platform-wide capability, never scoped to "one
  organisation."
- Neither should ever be able to specify an arbitrary target `tenant_id` and
  have it trusted — see acceptance criteria §9.

---

## 4. Implementation patterns evaluated

**A structural constraint found in this pass that shapes the recommendation**:
column-level privilege separation (`GRANT`/`REVOKE` on specific columns, the
exact pattern already live for `workforce.resident_code` since migration 02)
is the natural first idea for "some columns public, some not, same table" —
but it doesn't work cleanly here **today**, because PostgREST/Supabase only
differentiates `anon` vs. `authenticated` at the role level, and per
`docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §1, **Chiefs and platform operators
are not `authenticated` in the Postgres/PostgREST sense at all** — they have
no Supabase Auth session, only a client-side gate over the same `anon` key
everyone else uses. Granting sensitive columns to `authenticated` would
help real doctor sessions (path C) but would do nothing for Chief/operator
reads, which are the majority of the "authorised configuration" consumer
list above. **A pure view or pure column-grant approach cannot yet
distinguish "the public" from "a Chief" from "an operator" — only a
capability-checked RPC can, because only an RPC can re-verify the caller's
`admin_access_code`/operator code server-side, the same way `chief_*`
already does.** This finding rules out two of the example options as
insufficient on their own and determines the recommendation below.

| Option | Security | Compatibility with current login flow | Migration complexity | Reversibility | Impact on future Supabase Auth convergence | Throwaway risk |
|---|---|---|---|---|---|---|
| **(1) Narrow read-only public view** (`tenant_public_directory` exposing only the 5 discovery fields, granted to `anon`) | Good for the public surface only — solves nothing for authorised configuration (same role-differentiation gap above) | High — one small client call-site change per discovery consumer | Low | High (a view is trivially dropped/redefined) | Neutral — doesn't block or help | Low, but only solves half the problem alone |
| **(2) Read-only discovery RPC** (e.g. `list_public_tenants()`, plain SQL function, `anon`-callable, explicit column projection, server-side `status='active'` filter) | Same as (1), functionally equivalent, reuses the RPC idiom already dominant in this schema rather than introducing a new relation kind | High | Low | High | Neutral | Low |
| **(3) Tightly scoped direct SELECT policy** | **Does not achieve the goal as stated** — RLS is row-level, not column-level; every tenant row needs to remain visible to someone, so a row-level policy alone cannot separate "5 public columns" from "6 private columns" on the *same* rows. Would need to be combined with (5) below to mean anything for this specific problem. | N/A alone | N/A alone | N/A alone | N/A alone | **High if proposed alone — looks like a fix, isn't one** |
| **(4) Platform/operator RPCs for mutation** (extending the already-proven `chief_*`/`create_tenant_with_admin` pattern with operator- and chief-scoped equivalents for the remaining direct writes) | High — re-verifies the caller's code server-side before acting, and — critically — resolves the *target* tenant from that verification, never from a client-supplied id (closes the "no client-supplied tenant id alone confers authority" requirement, §9) | High — same UX, different function called underneath | Low-medium (5-6 new small RPCs, mirroring existing ones almost verbatim) | High (RPCs are additive; can coexist with old functions during rollout, see §11) | **Positive** — these RPCs are the natural place to later swap "trust the code parameter" for "trust `auth.uid()`," per Slice 4 §10 step 6 | Low — directly reusable, not thrown away |
| **(5) Column-level GRANT/REVOKE on `tenants`** (the `workforce.resident_code` pattern) | Works for the anon-vs-everyone-else split (discovery fields), but — per the structural constraint above — **cannot today distinguish Chief/operator from anon**, since neither has a distinct Postgres role | Medium — no client code change needed for the public split, but doesn't help the authorised side at all | Low for what it does cover | High | Neutral for the part it solves; **irrelevant** for the part it doesn't | Low for the narrow discovery-column use, not a general solution |

### Recommendation — locked per Decisions 3 and 4

**Primary boundary, in order**: (i) a public discovery RPC, (ii) authorised
capability RPCs, (iii) narrowed/direct base-table access once (i) and (ii)
cover every legitimate consumer. **Option (2), the read-only discovery RPC,
is the locked target mechanism — not left open against Option (1)'s view.**
Per Decision 3:

- **`list_public_tenants()`** (name may remain tenant-based for
  implementation compatibility — this does **not** begin a
  tenant→organisation rename, per Decision 3's explicit instruction).
- Accepts **no authority-bearing tenant parameter** — it is a plain list
  call, not scoped to a caller-supplied target.
- Returns only the approved public projection: `id`, `name`, `institution`,
  `department` (§3).
- Filters discoverability/active status **server-side**, inside the
  function body — never returns a non-discoverable row for the client to
  filter out itself.
- Requires no authenticated identity, because it is intentionally public.

- Capability-checked RPCs, extending the exact `chief_*`/
  `create_tenant_with_admin` pattern, for every currently-direct authorised
  read and write (§5) — the second layer of the primary boundary.

**Column-level `GRANT`/`REVOKE` (Option 5) is explicitly optional
defense-in-depth, not primary Priority-0 architecture, per Decision 4.**
Once direct table access is already prevented by the RPC boundary above,
layering column-level privilege restrictions on top adds complexity without
closing a gap the RPC layer hasn't already closed — use least privilege at
implementation time where it is genuinely useful (e.g. as a second line of
defense against an RPC bug), but do not treat it as required, and do not
design the Priority-0 fix as if it depends on getting column grants right.

This is not chosen because it's easiest to patch — the RPC-centric pattern
is more code (§5's table) than a single policy tweak would be. It is chosen
because it is the only option that actually satisfies the acceptance
criteria (§9) given the current auth model, and because it is forward-
compatible with the Institutional Auth Migration Spec rather than
throwaway (§10, §11).

---

## 5. Mutation-path migration map

**Transitional RPC rule, applying to every `p_admin_code`/`p_operator_code`
parameter below**: these are explicitly **transitional compatibility**
arguments, not part of the target domain/API contract. The future target
(Institutional Auth Migration Spec's job to design in full) is:

```
verified Supabase Auth principal
  → Person
  → Membership
  → contextual capability
  → server-derived organisation context
  → domain action
```

Applied here: **for organisation-admin/Chief-scoped operations, no proposed
RPC accepts an arbitrary target `tenant_id` parameter at all** — the server
derives the caller's own organisation from the verified capability context
(today: `p_admin_code`; eventually: the authenticated principal). **For
platform-operator operations, an explicit target `tenant_id` parameter is
legitimate and intentional** — cross-organisation administration is itself
an authorised platform capability, not a boundary violation, so those RPCs
correctly do take a target id.

For each current direct write, whether an existing RPC pattern can be
reused, and what would need to change:

| Current function | Existing RPC reusable as-is? | New capability needed | UI/service code to change | Actor |
|---|---|---|---|---|
| `createTenant()` / `createTenantWithPaystackSubaccount()` | No, but `create_tenant_with_admin`'s pattern is directly reusable | A platform-operator-scoped creation RPC (e.g. `platform_operator_create_tenant(p_operator_code, ...)`), re-verifying the operator code server-side before inserting | `databaseService.createTenant()`'s internals (signature/call site in `SaaSOperatorConsoleView.tsx` unchanged) | Platform operator |
| `updateTenantStatus()` | No, new small RPC needed | `platform_operator_update_tenant_status(p_operator_code, p_tenant_id, p_status)` | Same as above | Platform operator |
| `updateTenantPlan()` | No, new small RPC needed | `platform_operator_update_tenant_plan(p_operator_code, p_tenant_id, p_plan_type)` | Same as above | Platform operator |
| `updateTenantTerminology()` | No, but `chief_*` pattern directly reusable | `chief_update_tenant_terminology(p_admin_code, p_overrides)` — resolves the caller's own `tenant_id` server-side from `p_admin_code`, exactly like `chief_assign_user_role` already does; never accepts a target tenant id as a trusted parameter | `TenantCustomizationView.tsx`'s save handler | Org-admin (Chief) |
| `updateTenantModuleFlags()` | No, but `chief_*` pattern directly reusable | `chief_update_tenant_module_flags(p_admin_code, p_flags)` — same server-side self-resolution | Same view | Org-admin (Chief) |
| `payment-webhook`'s direct update | **N/A — already safe**, service-role bypasses RLS | None | None | Automated (payment provider callback) |
| `createTenantWithAdmin()` | **N/A — already safe**, RPC-based | None | None | Self-serve (see §6) |

No RPC is implemented in this document — this is the map an implementation
slice would follow.

---

## 6. Tenant creation — analysis only, nothing altered

- **Self-serve** (`create_tenant_with_admin`, migration 24): already routed
  through a `SECURITY DEFINER` RPC. Does not depend on `tenants`' row RLS at
  all. **Already safe** with respect to the RLS question this spec addresses.
- **Target posture — locked, per Decision 2**: self-serve organisation/
  workspace creation remains an intended product capability. The target
  shape is:
  ```
  verified/authenticated person
    → create organisation
    → become its initial owner/admin membership
  ```
  **Anonymous organisation creation is confirmed not the desired permanent
  architecture.** Today's flow — `AdminPortalChooserView` →
  `CreateOrganizationView` → `create_tenant_with_admin`, reachable with no
  login step at all — is the *current* state, not the target.
- **No temporary verification mechanism is designed or built in this
  slice.** Per Decision 2, this document does not propose an interim fix
  (email confirmation, rate limiting, or any other stopgap) for the
  anonymous-creation gap. **Current behaviour is left unchanged** until the
  Institutional Auth migration provides the identity foundation (a real
  verified person to attach initial ownership/admin membership to) that the
  target posture above requires.
- **Recorded as a dependency/input to Slice 6** (the Institutional Auth
  Migration Spec) — that spec should account for self-serve creation's
  target posture as one of its own design inputs, not treat it as a
  separately-solved problem.
- **Platform-operator creation** (`createTenant()`/
  `createTenantWithPaystackSubaccount()`): not currently routed through an
  equivalent capability check — depends directly on the permissive INSERT
  policy. §5 proposes the RPC that would close this (with an explicit
  target `tenant_id` where relevant — not applicable to creation itself,
  which has no pre-existing row to target). **Not implemented here.**

---

## 7. Compatibility with the current single-tenant app

**What would break immediately if `tenants` anonymous INSERT/UPDATE
disappeared, with no other change**:
- `TenantSelectorView.tsx` and `ResidentLoginView.tsx` — tenant listing
  breaks (both currently read the full table via the anon-permissive
  `SELECT`, which this fix's read-side changes would also need to close in
  the same coordinated step — the acceptance criteria in §9 require both
  read and write to be addressed together for `tenants`, not write alone).
- `TerminologyProvider` — every pre-login page loses tenant vocabulary
  (falls back to hardcoded English defaults, not a hard failure, but a
  regression from current behavior).
- `SaaSOperatorConsoleView.tsx` — tenant creation, plan/status changes, and
  its two analytics reads all break.
- `TenantCustomizationView.tsx` — terminology/module-flag edits break.
- `TemplateManagerView.tsx` / `CasebookBuilderView.tsx` — plan-type gating
  reads break (would silently misbehave, likely defaulting to the
  free-tier-gated state per their own `?? 'free_seeded'` fallback, not a
  hard crash — worth noting as a soft-failure mode, not a crash mode).

**What would NOT break** — both already proven safe patterns:
- `payment-webhook`'s plan promotion (service-role, bypasses RLS entirely).
- Self-serve tenant creation (`create_tenant_with_admin`, RPC-based).

**Future Institutional Auth migration**: nothing in this design blocks it.
The RPC-based mutation pattern proposed here is a direct stepping stone
toward it — see §10.

---

## 8. Security acceptance criteria for the eventual implementation

1. **Anonymous caller cannot mutate any `tenants` row** — achieved once base
   table write policies are narrowed and every legitimate write is routed
   through a capability-checked RPC (§5).
2. **Ordinary organisation member cannot mutate tenant configuration
   without an explicit capability** — the proposed `chief_*`-pattern RPCs
   only exist for Chief-level actions; no equivalent is exposed for a plain
   member/resident session.
3. **Organisation A's authorised admin cannot mutate organisation B** — every
   proposed RPC resolves its *target* tenant from the caller's own verified
   code server-side (exactly like `chief_assign_user_role` already resolves
   `v_tenant_id` from `p_admin_code`), never from a client-supplied
   `tenant_id` parameter used as authority.
4. **Platform-operator operations remain possible through authorised
   server-side paths** — the proposed operator-scoped RPCs (§5).
5. **Pre-login tenant discovery exposes only explicitly public fields** —
   the discovery RPC/view's column list is fixed and reviewed (§3), not
   `select('*')`.
6. **No client-supplied tenant id alone confers authority** — restated from
   #3; this is the core design property every proposed RPC must have,
   verified per-RPC at implementation-review time, not assumed.
7. **Existing login/tenant selection remains functional** — the discovery
   surface's field list was derived directly from what
   `TenantSelectorView`/`ResidentLoginView`/`TerminologyProvider` actually
   render/use today (§1/§3), not guessed.
8. **Automated negative tests are defined for the boundary** — see §9 below
   and `docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §9 item 8; this table's
   negative-test set extends that same required suite with `tenants`-
   specific cases (§9 of this document).

---

## 9. Negative-test plan (definitions only — no tests written)

Extends the automated negative tenant-isolation suite already required by
`docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §9 item 8, specifically for
`tenants`:

- An anonymous (no session at all) client cannot `SELECT` any column of
  `tenants` beyond the defined public discovery set, for any row.
- An anonymous client cannot `INSERT` or `UPDATE` `tenants` directly at all.
- **Refined per the negative-test instruction — proves absence, not
  rejection**: for every Chief/org-admin-scoped RPC, **no supported API
  parameter exists through which an Organisation A admin's call could target
  Organisation B at all** — the test asserts the RPC's own signature/
  contract has no target-tenant input, so there is no path to even attempt
  cross-organisation targeting, rather than asserting that a supplied id is
  ignored or rejected. (Per §5's transitional RPC rule: these RPCs derive
  the caller's organisation server-side from their own verified capability
  context — there is nothing for a test to pass a foreign id into.)
- **Platform-operator tests remain cross-tenant by design**, since
  cross-organisation administration is itself an authorised platform
  capability (§5): the test instead proves that capability is genuinely
  authenticated/authorised — a valid platform-operator code can
  create/update any tenant (the legitimate broad capability being
  exercised correctly), while an invalid/expired/malformed operator code is
  rejected with no row effect, for every operator-scoped RPC.
- The discovery surface, called anonymously, never returns `status`,
  `plan_type`, `module_flags`, `paystack_subaccount_code`,
  `terminology_overrides`, `short_code`, or `created_at` for any row —
  only `id`/`name`/`institution`/`department`, per the locked projection
  (§3).

---

## 10. Rollback / deployment strategy (concept only — no policy SQL)

Explicitly accounts for the PostgreSQL permissive-policy `OR` semantics
Slice 4 identified (`docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §10 step 4) —
the same trap applies here and is not repeated:

1. **Add-only phase**: create the discovery RPC/view and the new
   capability-checked mutation RPCs (§5) **alongside** the existing
   permissive policy. This phase is safe by construction — it is purely
   additive, changes no existing behavior, and carries none of the
   "narrow policy coexisting with `USING(true)`" risk, because nothing is
   being narrowed yet.
2. **Client migration phase**: move each consumer (§1's tables) from direct
   `.from('tenants')` calls to the new RPC/view, one call site at a time,
   verifying functionally after each. The old permissive policy remains
   active throughout this phase as a safety net — no user-facing regression
   risk during migration.
3. **Validation phase**: run the negative-test plan (§9) and a full positive
   functional pass against every consumer in §1, confirming every
   legitimate path now goes through the new surface and behaves identically
   to before.
4. **Atomic narrowing phase, only after §10.3 passes**: replace the
   permissive base-table policy with the real restrictive one in a single
   coordinated change — not a staged "both active" period, per Slice 4's
   correction. Exact SQL deferred to the implementation specification and
   review that would carry this out.
5. **Rollback**: a single atomic revert of step 4 (re-apply the prior
   permissive policy) if any consumer is found broken post-narrowing. Steps
   1–3's additions (the RPCs/view themselves) are not rolled back — they are
   backward-compatible and harmless to leave in place even if step 4 is
   reverted.

No policy SQL, RPC SQL, or migration file was written to produce this
document.

---

## 11. Relationship to Institutional Auth

**Can proceed before full Supabase Auth convergence**:
- The public discovery RPC/view — needs no authentication concept at all,
  by definition.
- The capability-checked mutation/read RPCs (§5) — these reuse the
  **existing, already-proven** plaintext-code-verification pattern
  (`p_admin_code`/an equivalent operator code), the same mechanism
  `chief_*` RPCs already use safely today. This does **not** require
  Supabase Auth to be safe *for the specific problem this spec solves*
  (closing direct anonymous table access) — it only requires that the
  verification happens server-side, which the existing pattern already
  does.
- Atomic RLS narrowing on the base table (§10 step 4) — can happen once
  every consumer is migrated, independent of the institutional-auth
  timeline.

**Should wait for full Supabase Auth convergence**:
- Strengthening the RPCs' *internal* identity check from "trust a
  client-supplied plaintext code" to "trust a verified Supabase Auth
  principal" (`auth.uid()`-derived) — this closes the deeper gap Slice 4
  already named (anyone holding a valid code gets full access, regardless
  of who they are). That strengthening is the Institutional Auth Migration
  Spec's job (`docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §10 step 6), not
  this one's — this spec's RPCs are written so that swap is additive later
  (add an `auth.uid()` check alongside/instead of the code check), not a
  rewrite.

**No custom temporary identity system is introduced by this design.** Every
proposed mechanism (discovery RPC, capability-checked mutation RPCs) reuses
the exact plaintext-code-verification pattern already live in this schema
(`chief_*`, `create_tenant_with_admin`) — extended to cover `tenants`' own
surface, not a new parallel system.

### Locked sequencing, per Decision 5

**The Institutional Auth Migration Specification is completed before
Priority-0 implementation begins.** This is design sequencing — ensuring
the transitional RPCs above are designed with their Auth-based destination
already understood — **not an instruction to wait for the full Auth
implementation** to land in code first. The locked order:

```
Tenant Surface Security Spec (this document)
  → Institutional Auth Migration Spec (Slice 6)
  → combined human architecture review
  → Priority-0 tenant-surface implementation
  → Workforce Option A implementation
  → broader tenancy/RLS remediation
```

**This does not reverse Slice 4's Workforce Option A safety verdict.**
`docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §8 concluded Option A is **A — safe
to implement now**, and that conclusion is unchanged — Option A still
introduces no new permission, table, endpoint, field exposure, privileged
action, or write, and remains independently safe regardless of tenancy
remediation timing. The order above is a **sequencing/coordination
decision**, not a re-assessment of Option A's safety: it places Option A's
*implementation* after Priority-0's implementation in the work queue, for
architectural-coherence reasons (so the transitional-RPC pattern is settled
before more code is built alongside it), not because Option A became less
safe or newly dependent on tenancy remediation.

---

## 12. Explicit non-goals of this slice

- No source, schema, migration, RLS policy, auth configuration, dependency,
  deployment configuration, or UI behavior was modified to produce this
  document.
- No RPC or policy SQL was written.
- No production data was read, queried, or mutated.
- Does not resolve the Institutional Auth convergence itself (Slice 4 §11
  item 2's job, and Decision 5's Slice 6).
- Does not build a temporary verification mechanism for self-serve
  organisation creation (§6, Decision 2) — current anonymous-reachable
  behaviour is left unchanged in this slice.
- Does not begin a tenant→organisation rename (§4, Decision 3) —
  `list_public_tenants()` and every proposed RPC keep tenant-based naming
  for implementation compatibility.
- Does not implement the pre-login neutral-terminology UX change (§3,
  Decision 1) — `TerminologyProvider` still calls `getTenant()` unchanged;
  the change is recorded for the eventual coordinated implementation only.
- Does not implement the negative-test suite (§9 defines it; building it is
  a future slice).
- Does not implement any Priority-0 RPC before the Institutional Auth
  Migration Spec and combined human architecture review are complete (§11,
  Decision 5).

## 13. Unresolved human decisions

Five of the six items in this section as originally drafted are now
resolved by the locked decisions applied in this revision; what remains
genuinely open:

1. **Exact verification/timing mechanism for self-serve organisation
   creation** — the *target posture* is locked (§6: verified person →
   create organisation → become its initial owner/admin membership), and no
   temporary mechanism is being built now, but the concrete design (what
   "verified" means, exactly how initial ownership attaches) is deferred to
   the Institutional Auth Migration Spec (Slice 6) as one of its own design
   inputs — not decided here.
2. **Exact implementation detail of "least privilege at implementation
   time"** for column-level grants (§4) — Decision 4 settles that this is
   optional and not primary architecture; whether any specific column ends
   up with a defense-in-depth `REVOKE` is an implementation-time judgment
   call for whoever builds the RPCs, not a spec-level decision.
3. **Timing of the pre-login neutral-terminology UX change** (§3) —
   `terminology_overrides` is now locked private, and the corresponding UX
   change (pre-login pages using `TERMINOLOGY_DEFAULTS` instead of a live
   tenant lookup) is recorded as part of the eventual coordinated
   implementation, but exactly which implementation slice it lands in
   (bundled with the discovery RPC work, or separately) is not fixed here.

**Resolved by this revision, no longer open**: terminology public/private
classification (§3, Decision 1); discovery mechanism — RPC, not view (§4,
Decision 3); column grants as optional not primary (§4, Decision 4);
sequencing relative to the Institutional Auth Migration Spec (§11,
Decision 5); self-serve creation's target posture, though not its exact
mechanism (§6, Decision 2, see item 1 above).

## 14. Proposed bounded implementation slices

Per the locked sequencing (§11, Decision 5) — **not all of these are next**;
items 1–2 are the only ones authorised to proceed before the Institutional
Auth Migration Spec and its combined human architecture review are
complete:

1. **This document** — Tenant Surface Security Spec. Complete, pending
   final commit.
2. **Institutional Auth Migration Spec** (Slice 6) — designs the Supabase
   Auth convergence in full, including the target mechanism for self-serve
   creation's verified-person requirement (§6 item 1 above) and the
   `auth.uid()`-based strengthening every transitional RPC below is written
   to accept later (§5, §11).
3. **Combined human architecture review** — of this spec and Slice 6
   together, before any Priority-0 code is written.
4. **Priority-0 tenant-surface implementation**, only after 1–3:
   a. Build the public discovery RPC, `list_public_tenants()` (§3, §4).
   b. Build the Chief-scoped `chief_update_tenant_terminology`/
      `chief_update_tenant_module_flags` RPCs (no target-tenant parameter,
      §5) and migrate `TenantCustomizationView.tsx`.
   c. Build the platform-operator-scoped creation/status/plan RPCs (explicit
      target `tenant_id`, §5) and migrate `SaaSOperatorConsoleView.tsx`
      (§6).
   d. Build minimal authorised-read RPCs for `TemplateManagerView.tsx`/
      `CasebookBuilderView.tsx`'s `plan_type`-only need.
   e. Implement and pre-login-neutral-terminology UX change (§3), retiring
      `TerminologyProvider`'s pre-login `getTenant()` call.
   f. Build and run the negative-test suite (§9) against (a)–(e).
   g. Atomic RLS narrowing on the base `tenants` table (§10 step 4), only
      after (a)–(f) are verified complete.
5. **Workforce Option A implementation** — per §11's locked sequencing,
   placed after Priority-0 implementation in the work queue; remains
   independently safe per Slice 4 §8 regardless of this ordering (§11).
6. **Broader tenancy/RLS remediation** — the remaining slices already named
   in `docs/TENANCY_AUTH_RLS_RECOVERY_SPEC.md` §11 item 4.

---

Stopping here per Slice 5's instruction. No source, schema, migration, RLS,
auth, dependency, deployment, or UI change was made to produce this
document. Not committed. Awaiting human review before any further PLAN or
implementation step proceeds.
