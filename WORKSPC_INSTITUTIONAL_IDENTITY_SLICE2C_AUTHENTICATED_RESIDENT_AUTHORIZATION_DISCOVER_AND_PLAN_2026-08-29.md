# Institutional Identity Slice 2c — Authenticated Resident Authorization Coexistence (DISCOVER + PLAN)

Status: **Design/handoff only. No code, schema, migration, RLS, Supabase Auth
configuration, live database mutation, or Harness implementation lifecycle
was performed to produce this document.** Current baseline: local HEAD ==
origin/main == `59cd898`; migrations 58-77 VERIFIED_APPLIED;
`organisation_memberships` live; `claim_workforce_member` live; the
`verify_resident_login` legacy-guard live; legacy resident-code login still
fully supported; My Assignment / Full Roster / Resident Home all live and
unchanged; no Chief/admin claim RPC; no institutional RLS lockdown;
deployment freeze ACTIVE; push guardrail INSTALLED. STOP for human review
before any implementation.

**This document's own central finding, load-bearing for everything below**:
the `legacy_code_disabled_at` guard shipped in migration 77 protects exactly
**one** call site — `verify_resident_login`, the login screen. It protects
**none** of the four other resident-facing SECURITY DEFINER RPCs
(`resident_get_current_assignment`, `resident_get_current_full_roster`,
`resident_get_roster_section_presentation`, `resident_set_email`). Each of
those re-validates `workforce_id + resident_code + active = true` completely
independently, inline, with **no reference to `organisation_memberships` at
all**. Today, nothing in this app forces a client to call
`verify_resident_login` before calling any of the other four — the frontend
happens to call it first during a fresh login, but the RPCs themselves do not
enforce that ordering. This means: **a membership with
`legacy_code_disabled_at IS NOT NULL` is only blocked at the login screen
today — the same old code still works against every other resident RPC**,
because none of them re-checks it. This is not a defect introduced by this
document; it is the exact, disclosed, current gap this slice exists to close.
It sharpens prompt1.txt's own core invariant from a forward-looking design
goal into a concrete, already-live enforcement hole in four specific,
named functions.

---

## 1. Inventory — resident RPCs, current auth signatures, and call sites

Every row below was independently re-verified against current migration
source and current `src/` call sites during this pass, not assumed from
Slice 2's own prior audit (which predates migration 77 and did not need to
look at these four RPCs' bodies at all).

| RPC | Migration (live def.) | Signature | Auth mechanism (today) | `legacy_code_disabled_at` checked? | Grant |
|---|---|---|---|---|---|
| `verify_resident_login` | 64, guard added 77 | `(p_workforce_id uuid, p_code text, p_email text DEFAULT NULL)` | `workforce_id + resident_code + active=true` inline | **Yes** (migration 77's `AND NOT EXISTS (...)` clause) | `anon, authenticated` |
| `resident_set_email` | 64 | `(p_workforce_id uuid, p_code text, p_email text)` | Same inline re-check | **No** | `anon, authenticated` |
| `resident_get_current_assignment` | 67, body last changed 72 | `(p_workforce_id uuid, p_code text)` | Same inline re-check | **No** | `anon, authenticated` |
| `resident_get_current_full_roster` | 73 | `(p_workforce_id uuid, p_code text)` | Same inline re-check | **No** | `anon, authenticated` |
| `resident_get_roster_section_presentation` | 74 | `(p_workforce_id uuid, p_code text)` | Same inline re-check | **No** | `anon, authenticated` |
| `claim_workforce_member` | 77 | `(p_workforce_id uuid, p_resident_code text)` | `auth.uid()` only, no code parameter at all | N/A (writes the column, never reads it) | `authenticated` only |
| `current_user_organisation_memberships` | 76 | `()` | `auth.uid()` only | N/A (returns it, does not gate on it) | `authenticated` only |

All four of the "same inline re-check" rows share **byte-identical logic**
(confirmed by direct comparison of each function body, not inferred): a
`SELECT ... FROM workforce w WHERE w.id = p_workforce_id AND
w.resident_code = p_code AND w.active = true` (or an `EXISTS` form of the
same predicate for `resident_set_email`), immediately followed by `IF NOT
FOUND THEN RAISE EXCEPTION 'Invalid access code' USING ERRCODE = '28000';
END IF;`. No RPC in this list has ever had a `p_tenant_id` parameter — tenant
is always `v_workforce.tenant_id`/`w.tenant_id`, derived from the verified
workforce row, never client-supplied. This uniformity is exactly what makes a
single, small, reusable authorization helper viable (Section 4) instead of
four bespoke rewrites.

**Frontend call sites** (each thin, single-purpose, no shared abstraction
today — confirmed by reading all three):

- `src/modules/roster-engine/lib/myAssignmentService.ts` →
  `resident_get_current_assignment`. Called from
  `MyAssignmentView.tsx` (full page) and
  `src/modules/shared/ui/IntelligenceHarnessHome.tsx` (Resident Home's
  compact summary card).
- `src/modules/roster-engine/lib/fullRosterService.ts` →
  `resident_get_current_full_roster`. Called from `FullRosterView.tsx`
  only.
- `src/modules/roster-engine/lib/rosterSectionPresentationService.ts` →
  `resident_get_roster_section_presentation`. Called alongside both of the
  above (best-effort, non-blocking — a failure here falls back to
  hardcoded section labels, never blocks the assignment/roster view
  itself).
- All three services take `(workforceId, code)` positionally and pass
  through to `p_workforce_id`/`p_code` verbatim — none has ever accepted a
  tenant id.

**Resident session / auth state** (`src/App.tsx`, re-verified this pass, not
re-derived from Slice 2's older summary):

- `currentResident: ResidentSession | null` — restored synchronously from
  `localStorage['fm_session_resident']` on every mount (`readInitialResidentSession`,
  `App.tsx:148-157`). **No expiry.**
- `residentAccessCode: string | null` (`App.tsx:235`) — **never persisted**,
  populated only by a fresh code-based `handleResidentLogin` call, **always
  `null`** on every page reload / returning-visit session restore. This is
  the literal reason `MyAssignmentView.tsx` and `IntelligenceHarnessHome.tsx`
  show a PIN-reentry wall / locked card on every restore (`MyAssignmentView.tsx:84-93`,
  `IntelligenceHarnessHome.tsx:402-406`, both read this pass).
- `currentDoctor: DoctorSession | null` — restored from a real, persisted
  Supabase Auth session via `databaseService.onDoctorAuthStateChange`
  (`App.tsx:259-296`), fires with event `'INITIAL_SESSION'` on every mount.
- **The pre-existing convergence path** (migration 18, `workforce.doctor_id`,
  completely separate from `organisation_memberships`): when a restored
  doctor session resolves a linked workforce row via
  `getLinkedWorkforceForDoctor`, `currentResident` is populated
  (`App.tsx:274-289`) with `hasEmail: true` — **but `residentAccessCode`
  stays `null`**, because this path never involved a PIN at all. **Concrete,
  already-live consequence, confirmed by reading the gating logic in both
  consumer components**: a doctor who is linked to a workforce row through
  this pre-existing bridge is treated by `App.tsx` as `currentResident`
  everywhere, yet still hits the exact same "Confirm Your Access PIN" wall
  on My Assignment and the exact same locked summary card on Resident Home,
  on every single restore, forever — this coexistence gap already exists
  today, independent of anything this document proposes, and this slice's
  frontend work (Section 6) fixes it as a natural side effect of fixing the
  newer `organisation_memberships`-claimed case, since both paths converge on
  the same `currentResident`/`currentDoctor` state shape.
- **The new claim path** (migration 77, this session's own prior work):
  `LinkInstitutionalAccessPrompt.tsx`, mounted in `App.tsx` gated on
  `currentDoctor && currentResident`, lets an authenticated doctor claim
  their workforce identity into `organisation_memberships`. **Confirmed this
  pass**: nothing in `App.tsx`, `MyAssignmentView.tsx`,
  `FullRosterView.tsx`, or `IntelligenceHarnessHome.tsx` reads
  `current_user_organisation_memberships()` or references
  `organisationMembershipService` at all outside that one claim-prompt
  component. A successful claim today has **zero effect** on any of the
  three read surfaces — it only records the membership row. This is the
  precise gap Section 6 closes.

---

## 2. Core invariant, restated precisely against the audit above

Prompt1.txt's own invariant:

1. authenticated active institutional membership when available, then only
   where allowed:
2. legacy resident-code fallback.

Given Section 1's finding, the correct, precise per-call rule — not "does
this auth user have *a* membership somewhere" but **workforce-scoped, not
tenant-scoped-alone**:

> For a specific call requesting workforce `p_workforce_id` (whose tenant is
> always server-derived from that row, exactly as today): if `auth.uid() IS
> NOT NULL` **and** an `organisation_memberships` row exists with
> `auth_user_id = auth.uid() AND workforce_id = p_workforce_id AND
> is_workforce_member = true AND status = 'active'` for that workforce row's
> own tenant, **authorize immediately — `p_code` is never even compared**.
> Otherwise, fall through to the existing legacy check
> (`resident_code`/`active`), gated by the existing `legacy_code_disabled_at`
> guard for that specific `workforce_id` (extended, per Section 6, to all
> four RPCs, not just the login screen).

**Why "never even compared" is the mechanism that satisfies "caller must
never be able to deliberately choose the weaker path"**: there is no
client-visible branch to choose from. The server always attempts the
stronger check first, unconditionally, for every call; the code parameter is
only inspected at all when the stronger check did not match. A claimed,
actively-linked, authenticated caller cannot make the server take the weaker
path by sending a blank/wrong code instead of a real session — the strong
check runs regardless of what `p_code` contains, and if it succeeds, `p_code`
is irrelevant. This is the same shape already proven in this exact codebase
by `claim_workforce_member` itself (an `auth.uid()`-only RPC with no code
parameter at all) and is the natural generalization of it to the four
existing code-parameter RPCs rather than a new mechanism.

---

## 3. Multi-tenant / context resolution

**"Never guess a tenant" is already structurally guaranteed by an existing
property, not a new mechanism this slice must invent**: every RPC in
Section 1 already derives tenant exclusively from the `workforce` row named
by `p_workforce_id` (`v_workforce.tenant_id` / `w.tenant_id`) — never from
the auth session, never from a client-supplied tenant id, never by scanning
`current_user_organisation_memberships()`'s full result set and picking one.
Adding the auth-first check does not change this: the membership lookup in
Section 2 is a **targeted** row lookup —
`WHERE auth_user_id = auth.uid() AND tenant_id = <that workforce row's own
tenant_id> AND workforce_id = p_workforce_id` — never a scan of "all of this
person's tenants" followed by a pick. There is no ambiguity to resolve
because the query is never ambiguous in the first place: it asks one
precise question ("does this exact (auth_user, tenant, workforce) triple have
an active link?") and gets a boolean answer.

This directly resolves every named ambiguity case:

- **One active workforce membership** — matches directly, authorized.
- **Belongs to multiple tenants** — irrelevant; the lookup only ever
  inspects the one row (if any) matching the requested workforce's own
  tenant, never the person's other tenant memberships. Two tenants never
  interact in one call.
- **Tenant-admin membership, no workforce link** (`workforce_id IS NULL`) —
  **cannot ever match** `workforce_id = p_workforce_id` for any real UUID
  (`NULL = uuid` is never true in SQL) — this is a structural guarantee, not
  an app-level check that could be forgotten. Satisfies "tenant-admin-only
  membership cannot impersonate resident workforce" directly.
- **Authenticated but membership does not match the requested workforce** —
  the targeted lookup returns no row; falls through to the legacy check for
  *that* workforce id, gated by *that* workforce's own
  `legacy_code_disabled_at` — this is a different, still-legitimate
  authorization question ("is this workforce's own legacy code still live"),
  not the same question as "does my own auth session match," and the two
  must not be conflated (see the recovery-scenario table in Section 6 for
  why this is the more defensible reading than blocking legacy outright
  whenever *any* auth session is present).
- **No Supabase session** — `auth.uid()` is `NULL`; the strong check is
  skipped entirely server-side (a `NULL = uuid` / `auth.uid() IS NULL`
  short-circuit costs nothing extra), falls through to legacy exactly as
  today, zero added latency for the population with no Supabase Auth session
  at all (still the overwhelming majority during coexistence).

---

## 4. Authorization contract — the one small reusable helper

Following this repo's own established precedent for small, single-purpose
SQL helpers (`_normalize_supervision_name`, `_roster_section_fallbacks`,
`_resolve_workforce_names` — none of which is `SECURITY DEFINER` in its own
right; each is only ever called from inside an already-`SECURITY DEFINER`
outer function, which is sufficient, confirmed empirically this session:
`auth.uid()` resolves correctly to the real calling client's JWT `sub` claim
even from inside nested SQL called from a `SECURITY DEFINER` body — this was
proven repeatedly by `claim_workforce_member`'s own live test suite this
session, not assumed):

```sql
-- Not directly callable by any client (see Section 8 — REVOKE, no GRANT).
-- Only ever invoked from inside an existing SECURITY DEFINER RPC body that
-- has already independently resolved v_workforce (so p_tenant_id here is
-- always that row's own tenant_id, never a caller-supplied value).
CREATE OR REPLACE FUNCTION _resident_authenticated_membership_match(
  p_workforce_id uuid, p_tenant_id uuid
)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM organisation_memberships om
    WHERE om.auth_user_id = auth.uid()
      AND om.tenant_id = p_tenant_id
      AND om.workforce_id = p_workforce_id
      AND om.is_workforce_member = true
      AND om.status = 'active'
  );
$$;
```

Deliberately **not** reusing `current_user_organisation_memberships()`
(migration 76) as-is: that resolver returns *every* membership across every
tenant for the UI to render a list — calling it from inside a hot,
per-request authorization check and then filtering client-side (or even
server-side, row-by-row) is unnecessary indirection for a single targeted
boolean question. A dedicated, minimal, `STABLE` (not `VOLATILE`) helper that
answers exactly one yes/no question is both clearer and strictly narrower in
what it can leak (nothing — it returns only `true`/`false`, never row data).

**Insertion point in each of the four RPCs**: immediately before the
existing legacy re-verification `SELECT`, insert:

```sql
-- Auth-first: try authenticated institutional membership before ever
-- looking at the caller-supplied code. If auth.uid() is NULL, this is
-- simply false — zero added cost for a caller with no Supabase Auth
-- session at all, and the legacy path below is completely unaffected.
IF auth.uid() IS NOT NULL THEN
  SELECT w.tenant_id, w.full_name, w.active INTO v_tenant_id, v_full_name, v_active
  FROM workforce w WHERE w.id = p_workforce_id;

  IF FOUND AND v_active AND _resident_authenticated_membership_match(p_workforce_id, v_tenant_id) THEN
    -- Authorized via membership. p_code is never inspected below this
    -- point for this call — this is what makes the weaker path
    -- unreachable, not merely unused, whenever the strong path matches.
    v_authorized := true;
  END IF;
END IF;

IF NOT v_authorized THEN
  -- Existing legacy path, extended with the same legacy_code_disabled_at
  -- guard migration 77 already added to verify_resident_login (Section 6).
  SELECT w.tenant_id, w.full_name INTO v_tenant_id, v_full_name
  FROM workforce w
  WHERE w.id = p_workforce_id AND w.resident_code = p_code AND w.active = true
    AND NOT EXISTS (
      SELECT 1 FROM organisation_memberships om
      WHERE om.workforce_id = w.id AND om.legacy_code_disabled_at IS NOT NULL
    );
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid access code' USING ERRCODE = '28000';
  END IF;
END IF;
```

(Illustrative shape for the handoff, not final SQL to run — the exact
variable names/control flow must be fitted per-function during
implementation, since `resident_get_current_full_roster` doesn't need
`v_full_name` at all and `resident_get_roster_section_presentation` needs
neither. This is deliberately not written as a migration file in this
DISCOVER+PLAN document.)

**Suspended / revoked membership, and the one open sub-question this
document surfaces rather than silently resolves**: `status <> 'active'`
already fails the membership-match helper outright (`AND om.status =
'active'` in its `WHERE`), so a suspended or revoked membership **never**
authorizes via the strong path — satisfying those two verification-matrix
rows directly. What is genuinely open: today, **nothing automatically sets
`legacy_code_disabled_at` when `status` becomes `'suspended'`/`'revoked'`**
(no admin RPC to change `status` exists yet at all — Slice 2's own Section 8
named this as explicitly future, not-built work), so a suspended/revoked
member's **old code still works** unless a human has also, separately, set
`legacy_code_disabled_at`. Consistent with this repo's own established
precedent (Slice 2 Section 6 made the identical call for claim-vs-disable:
two related but orthogonal facts, each requiring its own explicit action, not
an automatic cross-effect) — **recommendation: keep `status` and
`legacy_code_disabled_at` orthogonal for this slice too**, not resolved here.
This is flagged explicitly, not silently assumed, exactly as Slice 2 flagged
its own analogous open question.

---

## 5. Function signature strategy

Evaluating the three named options against this repo's actual, current
constraints:

- **(C) replace signatures later** — rejected. This would be a breaking
  change requiring the frontend and the RPC to deploy in lockstep, exactly
  the "flag-day rewrite" this repo's own established incremental-migration
  precedent (the additive guard-clause pattern already used for migration
  77's `verify_resident_login` change) explicitly avoids.
- **(B) add authenticated overloads with no code parameter** — rejected.
  PostgREST resolves overloaded RPC names by matching the JSON body's keys
  against candidate parameter names; when two overloads of the same
  function name exist with different parameter counts/names, PostgREST has
  documented, real ambiguity-resolution fragility (this is a widely known
  PostgREST limitation, not specific to this repo) — introducing a second
  `resident_get_current_assignment` overload risks an unpredictable
  "Could not choose the best candidate function" error depending on exactly
  which keys the client happens to send, for a repo that has **never once**
  used function overloading for any RPC across 77 migrations (confirmed:
  every `chief_*`/`resident_*`/`verify_*` RPC in this codebase has exactly
  one live signature at any time — migrations 62 and 64 both explicitly
  `DROP FUNCTION` the old shape rather than overload). Introducing the
  pattern here would be a new, repo-wide-inconsistent risk for a coexistence
  slice that is supposed to be low-risk by design.
- **(A) keep the current `(workforce_id, resident_code)` signature,
  internally prefer auth when available** — **recommended**. Zero frontend
  API-shape change is required for the RPC call itself (the existing
  services already send both parameters positionally); a session-restored
  caller with no code simply sends an empty string for `p_code` (Section 6),
  and the RPC's own internal precedence (Section 2/4) means that empty code
  is **never even inspected** when the strong path matches. This is the
  smallest possible diff, requires no PostgREST overload risk, and is the
  direct, mechanical generalization of the exact one-line-guard-clause
  pattern already used successfully for `verify_resident_login` in migration
  77 — proven, not novel.

---

## 6. First bounded RPC migration

**Recommend migrating `resident_get_current_assignment` alone first**, not
all three read surfaces together, for two concrete, disclosed reasons:

1. It is the single highest-value target for prompt1.txt's own explicit
   frontend goal ("Resident Home can eventually show assignment after
   restore without retaining the resident code") — Resident Home's compact
   summary card (`IntelligenceHarnessHome.tsx:402-406`) and the full
   `MyAssignmentView.tsx` PIN wall (`:84-93`) are both driven by this one
   RPC. Migrating it alone already delivers the single most user-visible
   improvement named in the prompt.
2. It lets the new helper (Section 4) and its effective-privilege
   verification (Section 8) be proven live, end-to-end, against the
   narrowest possible blast radius, mirroring this session's own established
   discipline of shipping the smallest safe unit first (Slice 2a shipped
   resident-claim alone, deferring Chief-claim; this mirrors that same
   judgment call one level down).

**`resident_get_current_full_roster` and `resident_get_roster_section_presentation`
are the natural, low-risk immediate follow-up**, recommended as one
combined second slice once the first is live-verified — not because they are
risky (they share the identical pattern and are, if anything, lower-traffic
than My Assignment), but because splitting the *proof* of the new mechanism
from its *replication* to two structurally-identical siblings keeps each
reviewed diff small and each live-test cycle focused on one genuinely new
piece of logic at a time. **`resident_set_email` is explicitly deferred**,
per prompt1.txt's own "prefer read-only surfaces before writes" instruction —
it is a write path, and migrating it is a materially different risk profile
(an authenticated, membership-matched caller changing `workforce.email`
without ever supplying the code is a new capability, not just a new way to
read something already readable) that deserves its own dedicated review, not
a bundled afterthought.

**`verify_resident_login` is explicitly out of scope for this migration**,
despite already having the `legacy_code_disabled_at` guard — it is the login
*gate* itself, not a data read, and changing its behavior (e.g., letting an
already-authenticated session skip the code at the login screen too) is a
different, login-flow-shaped design question this document does not attempt
to fold in, per "Do not redesign auth or navigation."

---

## 7. Frontend changes required

**Goal-by-goal, from prompt1.txt's own list:**

- *No repeated PIN prompt where authenticated membership is sufficient* —
  `MyAssignmentView.tsx`'s `load()` effect (`:65-73`) currently only fires
  when `accessCode` is truthy; it must also attempt the call when
  `accessCode` is `null` **but a Supabase Auth session is known to exist**,
  sending `p_code: ''` (the RPC's own strong-path check runs first and never
  inspects an empty code once it matches). If that attempt fails (the strong
  path did not match — an unclaimed workforce identity, or a legacy-only
  session with no Supabase Auth at all), fall back to exactly today's
  PIN-entry UI — no new failure state, no new copy needed beyond what
  already exists.
- **How the component knows "a Supabase Auth session is known to exist"
  without duplicating state**: recommend threading one small, explicit
  boolean prop down from `App.tsx` (which already computes `currentDoctor`),
  e.g. `hasAuthenticatedSession={!!currentDoctor}`, passed alongside the
  existing `resident`/`accessCode` props to `MyAssignmentView`,
  `IntelligenceHarnessHome`, and (in the follow-up slice) `FullRosterView`.
  **Rejected alternative, named explicitly for the trade-off**: always
  attempt the RPC call optimistically regardless of any prop (empty code
  when `accessCode` is null), relying purely on the RPC's own server-side
  rejection to fall back to the PIN UI. This needs zero new prop threading,
  but costs every legacy-only session (still the overwhelming majority
  during coexistence) one guaranteed-to-fail extra network round-trip (and a
  brief loading flicker) on every single mount of these two components,
  purely to discover what a single, already-known boolean (`currentDoctor
  !== null`) could have told the component for free. The explicit-prop
  approach is recommended as the smaller true cost, matching this repo's own
  precedent of small, explicit, typed booleans threaded as props (`accessCode`
  itself is exactly this shape already).
- *Legacy users continue using current code flow* — a session with
  `hasAuthenticatedSession = false` (no `currentDoctor` at all) skips the
  auth-first attempt entirely client-side too (not just server-side) and
  goes straight to today's PIN-entry UI on restore — literally zero
  behavior change, zero added latency, for that population.
- *Existing deep links/session behavior remain functional* — no route, no
  redirect, no navigation change of any kind; only the two named components'
  internal load-gating logic changes.
- *Resident Home can eventually show assignment after restore without
  retaining the resident code* — `IntelligenceHarnessHome.tsx`'s own
  `!accessCode` locked-card branch (`:402-406`) gets the identical treatment:
  attempt the call (empty code) whenever `hasAuthenticatedSession` is true,
  only render the locked/link-out card if that attempt actually fails.

**No other frontend redesign** — this is a targeted, two-component (three,
once the follow-up slice lands) gating-logic change, not a rewrite of either
view, matching "Do not redesign auth or navigation" and "Do not redesign
screens during infrastructure/governance work" (`docs/UI_UX_PRINCIPLES.md`).

---

## 8. Security / grant model

Applying the migration-76/77 lesson prospectively, as a named, mandatory
step rather than an assumption, for the **one new** object this slice
introduces (`_resident_authenticated_membership_match`):

| Requirement | Design |
|---|---|
| `SECURITY DEFINER` | **No** — matches the exact precedent of this repo's other small helpers (`_normalize_supervision_name`, `_roster_section_fallbacks`, `_resolve_workforce_names`), none of which is separately `SECURITY DEFINER`; it only ever executes from inside an already-`SECURITY DEFINER` caller. |
| Fixed `search_path` | `SET search_path = public` — **note, disclosed inconsistency found this pass**: none of the three pre-existing sibling helpers actually has this clause (checked directly in migrations 70/73/74). Recommend the **new** helper set it explicitly anyway, since (unlike its siblings, which are pure string/lookup transforms) this one evaluates live authorization state (`auth.uid()` + `organisation_memberships`) — the stricter standard costs nothing and this session's own established discipline treats fixed `search_path` as mandatory for anything auth-adjacent. The siblings' omission is a real, pre-existing, low-risk (no auth-sensitive branching in any of them) gap, not something this slice is asked to fix. |
| `PUBLIC` revoke | `REVOKE ALL ON FUNCTION _resident_authenticated_membership_match(uuid, uuid) FROM PUBLIC;` |
| `anon` revoke | `REVOKE ALL ... FROM anon;` **explicit, by role name** — per the migration-76 lesson, this project's ambient `ALTER DEFAULT PRIVILEGES` grants EXECUTE directly to `anon` at function-creation time, which a PUBLIC-only revoke does not remove. This is the one place this slice must not repeat the exact sibling helpers' own gap (Section 4's rationale: unlike them, this function's whole purpose is an authorization decision). |
| `authenticated` grant | **None needed, and none should be added** — this helper is never called directly by any client; it is only ever invoked from inside the four already-`SECURITY DEFINER` RPC bodies it is inserted into, which already execute with the necessary privileges regardless of the calling client's own grants. |
| Effective privilege verification | **Mandatory, named step**: after creating the helper and editing the four (really: one, per Section 6) RPC bodies, re-run the same `information_schema.routine_privileges`/`role_table_grants` class of check used for migrations 76/77, confirming the helper has **no** `anon`/PUBLIC EXECUTE grant and that `organisation_memberships` gains **no new** table-level grant of any kind (this slice only *reads* that table, via the existing migration-76 RLS-bypassing `SECURITY DEFINER` context of the outer RPCs — no new write path). |
| Base-table RLS | **Untouched** — `organisation_memberships`'s existing single SELECT-own policy and `combined_master_rosters`'s existing permissive policies are both unchanged; this slice adds no RLS anywhere, per prompt1.txt's own explicit "do not tighten base-table RLS yet." |

---

## 9. Verification matrix

| Test | Mechanism it depends on |
|---|---|
| Authenticated claimed resident succeeds without code | Section 2/4's strong-path check matching, `p_code` never inspected. |
| Restored authenticated session succeeds without code | Same mechanism — the frontend's own `accessCode === null` state is irrelevant server-side; only `auth.uid()` + the membership row matter. |
| Legacy unclaimed resident still succeeds with valid code | Strong path returns false (`auth.uid()` NULL or no matching row) → falls through to unchanged legacy check. |
| Wrong legacy code rejected | Existing `resident_code` equality check, unchanged. |
| Claimed user cannot use another workforce identity | The membership lookup is scoped to the exact requested `p_workforce_id`; a mismatched `workforce_id` simply fails the strong-path `EXISTS`, falling through to that *other* workforce's own legacy check (which the claimed user's real code for their *own* workforce would not satisfy either, since `resident_code` is validated against the *requested* workforce row, not the caller's). |
| Multi-tenant user accesses only explicitly resolved membership/workforce | Section 3 — the lookup is a targeted `(auth_user_id, tenant_id, workforce_id)` triple, never a scan across the user's other tenant memberships. |
| Tenant-admin-only membership cannot impersonate resident workforce | `workforce_id IS NULL` structurally never equals any real `p_workforce_id` (Section 3). |
| Suspended membership rejected | `status = 'active'` required by the helper's own `WHERE` clause. |
| Revoked membership rejected | Same. |
| Inactive workforce rejected | Existing `w.active = true` check, unchanged, applies identically to both the strong and legacy paths. |
| `legacy_code_disabled_at` blocks code fallback | Section 4's guard clause, extended from `verify_resident_login` (migration 77) to this RPC's own legacy branch. |
| Caller cannot downgrade from authenticated membership to weaker code path | Section 2 — the strong path is attempted unconditionally first, every call, regardless of what `p_code` contains; there is no client-observable branch to choose. |
| Anon rejected where expected | `auth.uid() IS NULL` for a genuine anon-key caller — strong path is skipped, legacy path behaves exactly as it does today (this RPC has always granted `anon` EXECUTE, matching the "code IS the identity" model — this slice does not change that grant). |
| My Assignment output unchanged | The **only** new behavior is a new *authorization* path; every returned field (`status`/`month`/`year`/`assignments`) and its construction is untouched by this design — Section 6 scopes the change to the credential-check block only. |
| Full Roster output unchanged | Deferred to the follow-up slice (Section 6); when implemented, same reasoning applies. |
| Tenant presentation unchanged | Same as above. |

---

## 10. Explicit non-goals

- No migration/code/live DB/Harness implementation of any kind in this
  document — DISCOVER + PLAN only, per prompt1.txt's own instruction.
- No change to `resident_set_email`, `verify_resident_login`, any
  `chief_*` RPC, or any Chief/admin-facing surface.
- No RLS tightening on `organisation_memberships`, `workforce`,
  `combined_master_rosters`, or any other table.
- No admin RPC for suspend/revoke/relink — the open sub-question in
  Section 4 (status vs. `legacy_code_disabled_at` orthogonality) is
  flagged, not resolved or built.
- No new account-creation/auth mechanism — this slice only changes *which
  already-existing* credential (`auth.uid()` + membership, vs. legacy code)
  a read RPC accepts; it creates no new way to obtain either one.
- No tenant switcher UI, no MFA, no session-expiry mechanism, no rewrite of
  `App.tsx`'s session-restore architecture.
- No fix to the two pre-existing sibling helpers' missing
  `search_path`/grant hygiene (Section 8) — disclosed, not in scope.
- `resident_get_current_full_roster` and
  `resident_get_roster_section_presentation` are named as the *recommended
  next* slice, not built now.

---

## 11. Exact implementation handoff for the first slice

Scope for the eventual, separately-approved implementation task (not started
by this document):

1. New migration: `_resident_authenticated_membership_match(uuid, uuid)`
   helper (Section 4/8 exact grant model) + `resident_get_current_assignment`'s
   body edited to insert the auth-first check (Section 4's illustrative shape,
   fitted to that function's actual variable names) before its existing
   credential re-verification block. No signature change (Section 5) — no
   `DROP FUNCTION` needed, since `RETURNS TABLE` shape is unchanged.
2. New/updated verify script (`scripts/verify-migration-7N.cjs`, following
   this repo's own established structural-verification-script convention)
   asserting: no `p_tenant_id` parameter anywhere; the helper has no
   `SECURITY DEFINER`; explicit `anon`/PUBLIC revokes exist on the helper;
   `resident_get_current_assignment`'s returned shape/columns are unchanged;
   the legacy branch still contains the `legacy_code_disabled_at` guard;
   `resident_set_email`/`verify_resident_login`/every `chief_*` RPC is
   untouched.
3. Frontend: `App.tsx` passes `hasAuthenticatedSession={!!currentDoctor}` to
   `MyAssignmentView`/`IntelligenceHarnessHome`; both components' load-gating
   logic updated per Section 7; `myAssignmentService.getCurrentAssignment`
   itself needs no signature change (already accepts a `code: string`, an
   empty string is a valid `string`).
4. Live verification (per this repo's own now-established discipline,
   migrations 76/77): effective-grant proof for the new helper; disposable
   synthetic Supabase Auth users + fixtures proving every row of Section 9's
   matrix; independent zero-leftover reconfirmation after cleanup.
5. Regression re-verification: `verify-migration-76.cjs`,
   `verify-migration-77.cjs`, `verify-resident-email-login.cjs`,
   `verify-resident-home.cjs`, `verify-my-assignment.cjs`,
   `verify-full-roster.cjs`, `verify-roster-revisions.cjs`, `npm run verify`.
6. One Harness `DATABASE_MIGRATION` task, human-reviewed and approved before
   any SQL is written, per the required workflow — this document is the
   PLAN input for that future task's `task plan`, not a substitute for it.

---

*No code, schema, migration, RLS, Supabase Auth configuration, or live
database mutation was performed to produce this document. No Harness
implementation lifecycle was started. STOP for human review before any
implementation.*
