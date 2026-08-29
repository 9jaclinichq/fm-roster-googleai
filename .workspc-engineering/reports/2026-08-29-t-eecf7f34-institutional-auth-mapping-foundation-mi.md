# Task Report — t-eecf7f34

**TASK**: Institutional Auth Mapping Foundation (migration 76) (`t-eecf7f34`)
**TASK CLASS**: DATABASE_MIGRATION
**FINAL STATUS**: COMMITTED_LOCAL
**SOURCE COMMIT**: cec78ce2830b52a0025fce6fbc89a634afb7a946
**APPROVED SCOPE**: prompt1.txt 'Next bounded security slice -- Institutional Auth Mapping Foundation. Implement locally only.' Instructed to use 'the final Codex Institutional Auth Mapping Foundation handoff' as the reviewed architecture -- no file literally named that was found anywhere in this repository (confirmed via exhaustive filename/content search). docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md (Slice 6, revision 3, 'Institutional Authentication & Identity Migration Specification') is the only in-repo document matching this topic -- its own §17 sequencing table names 'Slice 1: Foundation/linking primitives -- a thin Organisation Membership structure' as literally the first implementation slice, which is exactly what this task builds. Used that document's locked architecture (Organisation Membership as a distinct Person<->Organisation primitive, §3; workforce as an optional, separate Workforce Record a membership may link to, never the primitive itself) as the reviewed architectural basis, explicitly disclosed as a substitution since the named 'Codex' handoff file could not be located, cross-checked directly against the CURRENT live schema via a dedicated research pass (not assumed from the spec's own prose) covering doctor_profiles/tenants/workforce's exact columns/types/FKs/RLS, this repo's SECURITY DEFINER/search_path/grant conventions, its uniform text-CHECK status-column convention (no native enum anywhere), its uniform timestamptz/timezone('utc'::text, now()) convention, and its existing partial-unique-index precedent (roster_revisions, workforce.email). Implements exactly and only: supabase/migrations/76_institutional_auth_mapping_foundation.sql, creating ONE new table (organisation_memberships: id, tenant_id, auth_user_id, nullable workforce_id, is_workforce_member, is_tenant_admin, status active|suspended|revoked, created_at, nullable linked_at/claimed_at/claim_method/legacy_code_disabled_at, updated_at) with its exact required constraints (UNIQUE(tenant_id, auth_user_id); a partial unique index on workforce_id WHERE status IN ('active','suspended') preventing one current workforce row from being linked to two simultaneously active/suspended memberships; a relationship-invariant CHECK requiring is_workforce_member OR is_tenant_admin; a claim-semantics CHECK requiring claim_method IS NULL OR claimed_at IS NOT NULL, with claimed_at never defaulted), RLS enabled with exactly one policy (authenticated SELECT-only, USING auth.uid() = auth_user_id; anon explicitly revoked all grants in addition to having no policy; no INSERT/UPDATE/DELETE policy or grant of any kind, for any role), and ONE new resolver RPC (current_user_organisation_memberships(): zero arguments, SECURITY DEFINER, fixed search_path = public, derives the caller exclusively from auth.uid(), returns an explicit empty result for an unauthenticated caller before querying anything, enriches with tenant_name/workforce_full_name via its own SECURITY DEFINER join rather than any blanket grant, omits auth_user_id from its return shape per this slice's own explicit review instruction, returns every status value including suspended/revoked rather than pre-filtering since future routing consumers -- not this resolver -- must be the ones that refuse to authorize on a non-active status, and is granted EXECUTE to authenticated only, explicitly revoked from PUBLIC/anon). Also creates new scripts/verify-migration-76.cjs (dependency-free, source-text/git-status structural verification only -- this migration is LOCAL ONLY / NOT APPLIED, so no live-database test exists or is attempted) and one new package.json script entry. No claim RPC, no revocation/admin UI, no role tables, no appointment history, no RBAC framework, no membership-history/audit table, and no change of any kind to any existing table, function, policy, grant, route, or component -- confirmed programmatically (git status shows only the new migration file, the new verify script, and package.json changed; no ALTER TABLE on any existing table appears anywhere in the new migration; no reference to verify_resident_login/verify_chief_login/resident_code/admin_access_code/any roster RPC appears in actual SQL, only in header-comment non-goals documentation). Documents (in-file SQL comment, not built) that future status-changing workflows must preserve lifecycle provenance through an approved audit/history mechanism.

## FILES CHANGED
- package.json
- scripts/verify-migration-76.cjs
- supabase/migrations/76_institutional_auth_mapping_foundation.sql

## FILES OUTSIDE EXPECTED SCOPE
NONE

## PROTECTED SURFACE HITS
NONE

## VERIFICATION RESULTS
- npm-verify — SKIP — TASK_CLASS (conditional — no matching changed paths)
- unregistered:node scripts/verify-migration-76.cjs — MANUAL_ACKNOWLEDGED (ack: "Ran manually: node scripts/verify-migration-76.cjs -> 0 failures (35 structural checks covering required fields, cardinality, relationship invariant, claim semantics, RLS/grants, resolver RPC contract, status semantics documentation, and blast-radius containment). Migration is LOCAL ONLY / NOT APPLIED -- no live-database test exists or was attempted.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-migration-76.cjs
- migration-state-check — PASS — ceiling=76; freeze=ACTIVE; 1-57:UNKNOWN, 58-75:VERIFIED_APPLIED, 76:UNKNOWN
- npm-verify — PASS — ok

## MANUAL ACKNOWLEDGEMENTS
- unregistered:node scripts/verify-migration-76.cjs — "Ran manually: node scripts/verify-migration-76.cjs -> 0 failures (35 structural checks covering required fields, cardinality, relationship invariant, claim semantics, RLS/grants, resolver RPC contract, status semantics documentation, and blast-radius containment). Migration is LOCAL ONLY / NOT APPLIED -- no live-database test exists or was attempted." (2026-08-29T11:22:33.868Z)

## LIVE CHECKS
NONE

## MIGRATIONS CREATED
- supabase/migrations/76_institutional_auth_mapping_foundation.sql

## MIGRATIONS APPLIED
NONE

## UNAPPLIED MIGRATIONS
- 1-57: UNKNOWN
- 76: UNKNOWN

**LOCAL COMMIT**: 0821c526e547891e72139a525b3ae59107aaa8cd
**PUSH STATUS**: NOT_PUSHED
**PRODUCTION BASELINE**: c2d22ff01c4f63f7f71fcdc61268bc19dd0121f0

## DECISIONS MADE
Implemented the Institutional Auth Mapping Foundation (migration 76) exactly per prompt1.txt's explicit, complete field/constraint/RLS/RPC spec. Discovered and disclosed upfront: no file literally named 'Codex Institutional Auth Mapping Foundation handoff' exists anywhere in this repository despite exhaustive search; used docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md's own locked Organisation Membership architecture (its own §17 sequencing table names this exact task as Slice 1) as the reviewed in-repo architecture basis instead. Reconciled every schema/convention decision against the LIVE current repo (via dedicated research, not the spec's own prose) before writing any SQL: doctor_profiles/tenants/workforce's exact columns/types/FKs, this repo's uniform text-CHECK status convention (no native enum anywhere), its uniform timestamptz/timezone('utc'::text, now()) convention, its ON DELETE CASCADE (auth.users FKs) / ON DELETE SET NULL (optional domain-record FKs) conventions, its partial-unique-index precedent, and its unprefixed (no 'public.') schema-reference style used in migrations 74/75 -- corrected my own first draft to match that exact unprefixed convention once found, rather than leaving a stylistic inconsistency. organisation_memberships carries every required field; enforces UNIQUE(tenant_id, auth_user_id) plus a partial unique index preventing one current workforce row from being linked to two simultaneously active/suspended memberships; enforces the relationship invariant (is_workforce_member OR is_tenant_admin) and the claim-semantics constraint (claim_method never non-null without claimed_at, claimed_at never defaulted). RLS is enabled with exactly one policy (authenticated SELECT-own-row-only via auth.uid() = auth_user_id); anon is explicitly revoked all grants (belt-and-suspenders beyond RLS alone, per this slice's own explicit 'revoke/limit grants accordingly' instruction, a deliberate deviation from migration 74/75's RLS-alone posture, justified since this table is more auth-sensitive); no INSERT/UPDATE/DELETE policy or grant exists for any role. The new resolver RPC current_user_organisation_memberships() takes zero arguments, derives the caller exclusively from auth.uid(), returns an explicit empty result for an unauthenticated caller before querying anything, omits auth_user_id from its return shape (per the slice's own explicit review instruction -- the caller already knows their own auth.uid()), returns every status value including suspended/revoked (a future routing consumer, not this resolver, must be the one that refuses to authorize on a non-active status), and is granted EXECUTE to authenticated only (this repo's first authenticated-only RPC grant -- every existing RPC is code/PIN-based and grants to anon+authenticated both). Documented in-file (not built) that future status-changing workflows must preserve lifecycle provenance through an approved audit/history mechanism. New scripts/verify-migration-76.cjs performs 35 dependency-free structural/git-status checks -- this migration is LOCAL ONLY / NOT APPLIED, so no live-database test exists or was attempted anywhere. npm run verify (typecheck+build) also re-run clean, though no TS/frontend file was touched by this slice. Confirmed via git status/diff and the harness's own diff-review that no existing migration, RPC, route, or component was touched: only the new migration file, the new verify script, and one new package.json script entry are in the commit.

## NEW FINDINGS
NONE

## BLOCKERS
NONE

## MANUAL CHECKS REMAINING
NONE

## NEXT RECOMMENDED ACTION
No further slice is auto-started. Per docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md's own §17 sequencing, the natural next slices (each separately reviewed, each requiring its own explicit human approval) would be: (2) institutional identity claim/enrolment RPC, (3) Chief/admin migration, (4) platform-operator migration, (6) legacy credential retirement, (7) broader RLS migration -- none of these are implied or pre-approved by this task. This migration remains LOCAL ONLY / NOT APPLIED; nothing was pushed and the deployment freeze remains ACTIVE.

_Generated 2026-08-29T11:24:10.537Z by `scripts/harness.cjs report`. Deterministic fields come from Harness/Git state. DECISIONS MADE and NEXT RECOMMENDED ACTION are agent-supplied via --decisions-made/--next-action and default to UNKNOWN — never fabricated._
