# Task Report — t-6b9ed6c1

**TASK**: Institutional Identity Slice 2a deploy: migration 77 live apply + PL/pgSQL ambiguous-column fix (`t-6b9ed6c1`)
**TASK CLASS**: DATABASE_MIGRATION
**FINAL STATUS**: COMMITTED_LOCAL
**SOURCE COMMIT**: 22d4be2ad6569a2473cc1e5e3f82460b16de4b46
**APPROVED SCOPE**: prompt1.txt: 'Authorize deployment review + live verification of Institutional Identity Slice 2a -- migration 77.' Reconciled expected state confirmed exactly: origin/main 485f1f0, local HEAD 22d4be2, outgoing eb6aca7 (feature) + 22d4be2 (harness report), migrations 58-76 VERIFIED_APPLIED, migration 77 UNKNOWN/NOT APPLIED, freeze ACTIVE, push guardrail INSTALLED -- no unexpected commit/path. During required live verification of the already-locally-implemented migration 77 (prior task t-0e5dde08 / commit eb6aca7), live testing surfaced a genuine PL/pgSQL bug: claim_workforce_member's RETURNS TABLE OUT-parameter names (tenant_id/workforce_id/is_workforce_member/is_tenant_admin/status/claimed_at) collide with real organisation_memberships column names, causing 'column reference ... is ambiguous' specifically in the INSERT's own target column list (a position that cannot be alias-qualified -- a first alias-only fix was tried and re-failed identically on live re-test, proving this). This task's scope is exactly: (1) the fix -- renaming those RETURNS TABLE columns to a claim_-prefixed form to remove the collision, adding a DROP FUNCTION IF EXISTS before the CREATE OR REPLACE (Postgres refuses to change an existing function's RETURNS TABLE shape in place; mirrors migration 64's own precedent), and updating the one TypeScript interface (ClaimWorkforceMemberResult) that mirrors the RPC's return shape; (2) applying the corrected migration 77 live via the exact-file direct-SQL method (.tmp-run-migration.cjs, never supabase db push); (3) proving effective live privileges (authenticated=EXECUTE, anon=false, PUBLIC=false, no new organisation_memberships writes) after creation, per the migration-76 ambient-default-privilege lesson; (4) running the full live synthetic security/concurrency/legacy-guard test suite to 0 failures using disposable synthetic Supabase Auth users and tenant/workforce fixtures only, with independent zero-leftover reconfirmation after cleanup; (5) full regression re-verification of all declared scripts; (6) recording migration 77 VERIFIED_APPLIED in migration-evidence.json with the bug/fix disclosed. No other change of any kind is in scope.

## FILES CHANGED
- .workspc-engineering/migration-evidence.json
- scripts/verify-migration-77.cjs
- src/modules/auth/lib/organisationMembershipService.ts
- supabase/migrations/77_resident_workforce_claim.sql

## FILES OUTSIDE EXPECTED SCOPE
NONE

## PROTECTED SURFACE HITS
- resident-login-email — src/modules/auth/lib/organisationMembershipService.ts

## VERIFICATION RESULTS
- unregistered:node scripts/verify-migration-77.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 38/38 structural checks pass, 0 failures.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-migration-77.cjs
- unregistered:node scripts/verify-migration-76.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 3 known-stale self-checks fail (hardcoded 'ceiling is exactly 76' and two git-status-porcelain checks scoped to migrations/src, all frozen assumptions invalidated by migration 77 and this task's own uncommitted WIP existing at all) — every substantive check (RLS, grants, constraints, resolver behavior, non-goals) passes. Not a regression.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-migration-76.cjs
- unregistered:node scripts/verify-resident-email-login.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 0 failures.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-resident-email-login.cjs
- unregistered:node scripts/verify-resident-home.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 1 known-stale self-check fails (hardcoded 'migration ceiling remains 75', frozen assumption invalidated by migrations 76/77's mere existence) — the other 3 checks all pass. Not a regression.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-resident-home.cjs
- unregistered:node scripts/verify-my-assignment.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 0 failures, all checks pass.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-my-assignment.cjs
- unregistered:node scripts/verify-full-roster.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 0 failures, all checks pass.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-full-roster.cjs
- unregistered:node scripts/verify-roster-revisions.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 0 failures, all checks pass.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-roster-revisions.cjs
- migration-state-check — PASS — ceiling=77; freeze=ACTIVE; 1-57:UNKNOWN, 58-77:VERIFIED_APPLIED
- npm-verify — PASS — ok
- verify-resident-email-login — PASS — ok

## MANUAL ACKNOWLEDGEMENTS
- unregistered:node scripts/verify-migration-77.cjs — "Re-run this turn: 38/38 structural checks pass, 0 failures." (2026-08-29T17:10:48.339Z)
- unregistered:node scripts/verify-migration-76.cjs — "Re-run this turn: 3 known-stale self-checks fail (hardcoded 'ceiling is exactly 76' and two git-status-porcelain checks scoped to migrations/src, all frozen assumptions invalidated by migration 77 and this task's own uncommitted WIP existing at all) — every substantive check (RLS, grants, constraints, resolver behavior, non-goals) passes. Not a regression." (2026-08-29T17:10:48.530Z)
- unregistered:node scripts/verify-resident-email-login.cjs — "Re-run this turn: 0 failures (also independently confirmed via the harness's own router-selected verify run this turn)." (2026-08-29T17:10:48.732Z)
- unregistered:node scripts/verify-resident-home.cjs — "Re-run this turn: 1 known-stale self-check fails (hardcoded 'migration ceiling remains 75', frozen assumption invalidated by migrations 76/77's mere existence) — the other 3 checks (no chief/admin route touched, no auth/RLS file touched, zero DB access) all pass. Not a regression." (2026-08-29T17:10:49.044Z)
- unregistered:node scripts/verify-my-assignment.cjs — "Re-run this turn: 0 failures, all checks pass." (2026-08-29T17:10:49.264Z)
- unregistered:node scripts/verify-full-roster.cjs — "Re-run this turn: 0 failures, all checks pass." (2026-08-29T17:10:49.476Z)
- unregistered:node scripts/verify-roster-revisions.cjs — "Re-run this turn: 0 failures, all checks pass." (2026-08-29T17:10:49.667Z)
- unregistered:node scripts/verify-migration-77.cjs — "Re-run this turn: 38/38 structural checks pass, 0 failures." (2026-08-29T17:12:10.595Z)
- unregistered:node scripts/verify-migration-76.cjs — "Re-run this turn: 3 known-stale self-checks fail (hardcoded 'ceiling is exactly 76' and two git-status-porcelain checks scoped to migrations/src, all frozen assumptions invalidated by migration 77 and this task's own uncommitted WIP existing at all) — every substantive check (RLS, grants, constraints, resolver behavior, non-goals) passes. Not a regression." (2026-08-29T17:12:10.804Z)
- unregistered:node scripts/verify-resident-email-login.cjs — "Re-run this turn: 0 failures." (2026-08-29T17:12:11.013Z)
- unregistered:node scripts/verify-resident-home.cjs — "Re-run this turn: 1 known-stale self-check fails (hardcoded 'migration ceiling remains 75', frozen assumption invalidated by migrations 76/77's mere existence) — the other 3 checks all pass. Not a regression." (2026-08-29T17:12:11.205Z)
- unregistered:node scripts/verify-my-assignment.cjs — "Re-run this turn: 0 failures, all checks pass." (2026-08-29T17:12:11.400Z)
- unregistered:node scripts/verify-full-roster.cjs — "Re-run this turn: 0 failures, all checks pass." (2026-08-29T17:12:11.595Z)
- unregistered:node scripts/verify-roster-revisions.cjs — "Re-run this turn: 0 failures, all checks pass." (2026-08-29T17:12:11.807Z)

## LIVE CHECKS
NONE

## MIGRATIONS CREATED
- supabase/migrations/77_resident_workforce_claim.sql

## MIGRATIONS APPLIED
- supabase/migrations/77_resident_workforce_claim.sql

## UNAPPLIED MIGRATIONS
- 1-57: UNKNOWN

**LOCAL COMMIT**: c6d4c6969870bdbd791f2e6410c9d6abc71755fe
**PUSH STATUS**: NOT_PUSHED
**PRODUCTION BASELINE**: c2d22ff01c4f63f7f71fcdc61268bc19dd0121f0

## DECISIONS MADE
Live testing of the already-locally-implemented migration 77 surfaced a genuine PL/pgSQL bug in claim_workforce_member: its RETURNS TABLE OUT-parameter names collided with real organisation_memberships columns, causing an ambiguous-column error specifically inside the INSERT statement's own target column list (a position that cannot be alias-qualified). A first alias-only fix was tried, re-applied live, and re-failed identically on retest -- proving it structurally insufficient, not just incomplete -- before a raw-pg diagnostic pinpointed the true cause. The correct fix renamed the RETURNS TABLE OUT-parameter columns to a claim_-prefixed form and added a DROP FUNCTION IF EXISTS before the CREATE OR REPLACE, since Postgres refuses to change an existing function's RETURNS TABLE shape in place (mirrors migration 64's own precedent). This was disclosed in full, including the insufficient first attempt, both in the migration file's own header comment and in migration-evidence.json, matching the disclosure discipline already established for migration 76's grant-correction entry. Migration 77 was then live-applied, effective privileges were proven correct (authenticated=EXECUTE only, no anon/PUBLIC, no new table writes), and the full live synthetic security, concurrency, and 5-part legacy-login-guard test suite passed with 0 failures using disposable Supabase Auth users and fixtures only, independently reconfirmed as fully cleaned up afterward. All declared regression scripts were re-run; the only failures were 4 already-known, frozen-in-time migration-ceiling/git-status self-checks in verify-migration-76.cjs and verify-resident-home.cjs (hardcoded to assert exactly one prior migration/no later files), which were confirmed structurally rather than dismissed. Migration 77 is now recorded VERIFIED_APPLIED.

## NEW FINDINGS
NONE

## BLOCKERS
NONE

## MANUAL CHECKS REMAINING
NONE

## NEXT RECOMMENDED ACTION
Reconcile the outgoing git range against origin/main, create one GOVERNANCE_SYNC push authorization, push, and confirm origin/main lands at the intended final commit -- then STOP without starting Institutional Identity Slice 2b (Chief claim).

_Generated 2026-08-29T17:13:03.839Z by `scripts/harness.cjs report`. Deterministic fields come from Harness/Git state. DECISIONS MADE and NEXT RECOMMENDED ACTION are agent-supplied via --decisions-made/--next-action and default to UNKNOWN — never fabricated._
