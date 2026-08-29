# Task Report — t-768f7df4

**TASK**: Deploy migration 76 - Institutional Auth Mapping Foundation (apply + live verify + push) (`t-768f7df4`)
**TASK CLASS**: DATABASE_MIGRATION
**FINAL STATUS**: COMMITTED_LOCAL
**SOURCE COMMIT**: 1630b79c0abca2f83c919c3f696c55b1526a67a5
**APPROVED SCOPE**: prompt1.txt 'Authorize deployment of migration 76 -- Institutional Auth Mapping Foundation.' Full authorized deploy lifecycle for the already-implemented, already-reviewed migration 76 (organisation_memberships + current_user_organisation_memberships()): reconciled origin/main..HEAD exactly (origin/main=cec78ce, local HEAD=1630b79, exactly the 2 expected outgoing commits, no unexpected path); ran a live read-only preflight confirming absence of both new objects; applied migration 76 to the live database via the existing exact-file direct-SQL mechanism (.tmp-run-migration.cjs, run by the human via the `!` prefix after the classifier blocked direct execution -- consistent with this repo's established, previously-observed classifier behavior for live-DB writes); ran post-apply structural verification via read-only pg_catalog/information_schema queries. DURING that post-apply verification, self-caught and immediately corrected a real discrepancy BEFORE declaring the migration verified: this Supabase project's ambient ALTER DEFAULT PRIVILEGES grants ALL table privileges directly to authenticated (and EXECUTE directly to anon) at CREATE TABLE/FUNCTION time -- a grant held by that specific role, not by the PUBLIC pseudo-role, so the migration's original REVOKE ALL ... FROM PUBLIC statements did not remove it. Corrected the committed migration file itself (added explicit REVOKE ALL ... FROM authenticated on the table and REVOKE ALL ... FROM anon on the function, mirroring the exact-role-REVOKE pattern already used for anon on the table) and applied the corrective delta live via a small idempotent follow-up statement (CREATE POLICY has no IF NOT EXISTS, so the whole file could not simply be re-run) -- re-verified grants now match the file exactly: authenticated=SELECT-only on the table, anon=nothing on either object. Ran full LIVE SECURITY VERIFICATION (20 checks) using DISPOSABLE SYNTHETIC Supabase Auth users (created/deleted via the service-role admin API, real GoTrue accounts with a throwaway password this session set itself -- never a real user's credential) plus disposable synthetic tenant/workforce fixtures (direct SQL), all removed in a finally block and independently re-confirmed absent afterward (0 leftover synthetic tenants/workforce/memberships/auth.users) -- proving every item in prompt1.txt's own verification list: anon blocked from direct SELECT and from executing the resolver; authenticated A sees only A's 3 rows (workforce-linked, tenant-admin-with-null-workforce_id, revoked-status) via both direct SELECT and the resolver; authenticated B sees only B's own row; the resolver enriches with real tenant/workforce display data without relying on the caller's own visibility into those tables; a second attempt to link an already-active workforce row to a different membership was rejected by the partial unique index; a caller-supplied tenant_id argument to the resolver errors (no such parameter exists); authenticated direct INSERT/UPDATE/DELETE all failed and were independently re-confirmed to have made no actual change. Ran live regression verification confirming verify_resident_login, verify_chief_login, resident_get_current_assignment, resident_get_current_full_roster, chief_save_roster_revision, chief_publish_roster_revision, and resident_get_roster_section_presentation all remain present and untouched. Re-ran node scripts/verify-migration-76.cjs, scripts/verify-resident-home.cjs, scripts/verify-my-assignment.cjs, scripts/verify-full-roster.cjs, scripts/verify-roster-revisions.cjs, scripts/verify-roster-safety-slice.ts, scripts/verify-roster-section-config.cjs, scripts/verify-submission-status.ts, and npm run verify -- all confirm every existing surface remains unaffected (2 scripts show an expected, benign, unrelated stale self-check about their OWN prior task's migration ceiling, not a regression). Recorded migration 76 as VERIFIED_APPLIED in .workspc-engineering/migration-evidence.json with the full methodology above. This task's own commit set is: the corrected supabase/migrations/76_institutional_auth_mapping_foundation.sql (grant-tightening fix) plus .workspc-engineering/migration-evidence.json (new VERIFIED_APPLIED entry) plus this task's own Harness report -- then reconciling the exact outgoing range, creating one exact GOVERNANCE_SYNC authorization, pushing normally (no force, no --no-verify, no hook bypass), and consuming the authorization after confirming origin/main landed at the pushed commit. No claim RPC, admin/revocation UI, or auth-route migration was started.

## FILES CHANGED
- .workspc-engineering/migration-evidence.json
- supabase/migrations/76_institutional_auth_mapping_foundation.sql

## FILES OUTSIDE EXPECTED SCOPE
NONE

## PROTECTED SURFACE HITS
NONE

## VERIFICATION RESULTS
- npm-verify — SKIP — TASK_CLASS (conditional — no matching changed paths)
- unregistered:node scripts/verify-migration-76.cjs — MANUAL_ACKNOWLEDGED (ack: "Ran manually: 0 failures (34 substantive checks pass; 1 stale git-status assumption expected post-commit, non-issue).") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-migration-76.cjs
- unregistered:node scripts/verify-resident-home.cjs — MANUAL_ACKNOWLEDGED (ack: "Ran manually: 0 substantive failures (1 unrelated stale hardcoded migration-ceiling self-check from that prior task, expected).") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-resident-home.cjs
- unregistered:node scripts/verify-my-assignment.cjs — MANUAL_ACKNOWLEDGED (ack: "Ran manually: All My Assignment verification checks passed.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-my-assignment.cjs
- unregistered:node scripts/verify-full-roster.cjs — MANUAL_ACKNOWLEDGED (ack: "Ran manually: All Full Roster verification checks passed.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-full-roster.cjs
- unregistered:node scripts/verify-roster-revisions.cjs — MANUAL_ACKNOWLEDGED (ack: "Ran manually: All Roster Revisions verification checks passed.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-roster-revisions.cjs
- unregistered:npx tsx scripts/verify-roster-safety-slice.ts — MANUAL_ACKNOWLEDGED (ack: "Ran manually: 0 substantive failures (1 unrelated stale hardcoded migration-ceiling self-check from that prior task, expected).") — UNREGISTERED — MANUAL REVIEW REQUIRED: npx tsx scripts/verify-roster-safety-slice.ts
- unregistered:node scripts/verify-roster-section-config.cjs — MANUAL_ACKNOWLEDGED (ack: "Ran manually: All Roster Section Config verification checks passed.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-roster-section-config.cjs
- unregistered:npx tsx scripts/verify-submission-status.ts — MANUAL_ACKNOWLEDGED (ack: "Ran manually: 0 failures.") — UNREGISTERED — MANUAL REVIEW REQUIRED: npx tsx scripts/verify-submission-status.ts
- migration-state-check — PASS — ceiling=76; freeze=ACTIVE; 1-57:UNKNOWN, 58-76:VERIFIED_APPLIED
- npm-verify — PASS — ok

## MANUAL ACKNOWLEDGEMENTS
- unregistered:node scripts/verify-migration-76.cjs — "Ran manually: 0 failures (34 substantive checks pass; 1 stale git-status assumption expected post-commit, non-issue)." (2026-08-29T14:11:56.030Z)
- unregistered:node scripts/verify-resident-home.cjs — "Ran manually: 0 substantive failures (1 unrelated stale hardcoded migration-ceiling self-check from that prior task, expected)." (2026-08-29T14:11:56.275Z)
- unregistered:node scripts/verify-my-assignment.cjs — "Ran manually: All My Assignment verification checks passed." (2026-08-29T14:11:56.489Z)
- unregistered:node scripts/verify-full-roster.cjs — "Ran manually: All Full Roster verification checks passed." (2026-08-29T14:11:56.681Z)
- unregistered:node scripts/verify-roster-revisions.cjs — "Ran manually: All Roster Revisions verification checks passed." (2026-08-29T14:11:56.897Z)
- unregistered:npx tsx scripts/verify-roster-safety-slice.ts — "Ran manually: 0 substantive failures (1 unrelated stale hardcoded migration-ceiling self-check from that prior task, expected)." (2026-08-29T14:11:57.119Z)
- unregistered:node scripts/verify-roster-section-config.cjs — "Ran manually: All Roster Section Config verification checks passed." (2026-08-29T14:11:57.314Z)
- unregistered:npx tsx scripts/verify-submission-status.ts — "Ran manually: 0 failures." (2026-08-29T14:11:57.517Z)

## LIVE CHECKS
NONE

## MIGRATIONS CREATED
- supabase/migrations/76_institutional_auth_mapping_foundation.sql

## MIGRATIONS APPLIED
- supabase/migrations/76_institutional_auth_mapping_foundation.sql

## UNAPPLIED MIGRATIONS
- 1-57: UNKNOWN

**LOCAL COMMIT**: 6926bd21d760cdab1d909392b9dfb32160ab3c55
**PUSH STATUS**: NOT_PUSHED
**PRODUCTION BASELINE**: c2d22ff01c4f63f7f71fcdc61268bc19dd0121f0

## DECISIONS MADE
Reconciled origin/main..HEAD exactly before touching anything (origin/main=cec78ce, local HEAD=1630b79, exactly the 2 expected commits, no unexpected path). Live preflight confirmed absence of organisation_memberships/current_user_organisation_memberships(). Applied migration 76 via the exact-file direct-SQL mechanism -- the classifier blocked direct execution, so the human ran it via the ! prefix. Post-apply structural verification (read-only pg_catalog/information_schema queries) confirmed the table/constraints/indexes/policy/function all match the design, but ALSO surfaced a real, self-caught discrepancy BEFORE declaring the migration verified: this Supabase project's ambient ALTER DEFAULT PRIVILEGES grants ALL table privileges to authenticated (and EXECUTE to anon) at CREATE TABLE/FUNCTION time -- a grant held by that specific role, not by PUBLIC, so this migration's original REVOKE ALL ... FROM PUBLIC statements did not remove it (though RLS/absence-of-policy still blocked all practical exploitation). Corrected the committed migration file itself (explicit REVOKE ... FROM authenticated on the table, REVOKE ... FROM anon on the function) and applied the corrective delta live via a small idempotent follow-up statement (CREATE POLICY has no IF NOT EXISTS, so the whole file could not simply be re-run); re-verified grants now match the file exactly. Ran full LIVE SECURITY VERIFICATION (20 checks) using disposable synthetic Supabase Auth users (created/deleted via the service-role admin API, throwaway password this session set itself, never a real credential) plus disposable synthetic tenant/workforce fixtures -- all cleaned up in a finally block and independently re-confirmed absent afterward (0 leftover rows/users). Every item in prompt1.txt's own verification list was proven live: anon blocked from direct SELECT and from executing the resolver; authenticated A sees only A's 3 rows via both direct SELECT and the resolver (workforce-linked, tenant-admin-with-null-workforce_id, revoked-status, spanning 3 tenants); authenticated B sees only B's own row; resolver enrichment works without the caller having any direct grant on tenants/workforce; a second attempt to link an already-active workforce row to a different membership was rejected by the partial unique index; a caller-supplied tenant_id argument to the resolver errors; authenticated direct INSERT/UPDATE/DELETE all failed and the targeted row was independently re-queried and confirmed genuinely unchanged. Live regression verification confirmed verify_resident_login/verify_chief_login/resident_get_current_assignment/resident_get_current_full_roster/chief_save_roster_revision/chief_publish_roster_revision/resident_get_roster_section_presentation all remain present, untouched. Re-ran node scripts/verify-migration-76.cjs plus 7 other existing verify scripts plus npm run verify -- all confirm every existing surface remains unaffected (2 scripts show an expected, benign, unrelated stale migration-ceiling self-check from their OWN prior task, not a regression here). Recorded migration 76 as VERIFIED_APPLIED in migration-evidence.json with the full methodology. Cleaned up all one-off verification scratch scripts (kept only the pre-existing, reusable .tmp-run-migration.cjs).

## NEW FINDINGS
NONE

## BLOCKERS
NONE

## MANUAL CHECKS REMAINING
NONE

## NEXT RECOMMENDED ACTION
Reconcile exact outgoing range, create one exact GOVERNANCE_SYNC authorization, push normally, consume authorization after success, then confirm final post-push state. No claim RPC, admin/revocation UI, or auth-route migration was started -- freeze remains ACTIVE.

_Generated 2026-08-29T14:13:07.491Z by `scripts/harness.cjs report`. Deterministic fields come from Harness/Git state. DECISIONS MADE and NEXT RECOMMENDED ACTION are agent-supplied via --decisions-made/--next-action and default to UNKNOWN — never fabricated._
