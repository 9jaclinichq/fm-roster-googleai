# Task Report — t-34b8f074

**TASK**: Institutional Identity Slice 2c.1 deploy: migration 78 live apply + authenticated-helper grant hardening (`t-34b8f074`)
**TASK CLASS**: DATABASE_MIGRATION
**FINAL STATUS**: COMMITTED_LOCAL
**SOURCE COMMIT**: 8f10f4ff7ae503d999a05f28105314c8e1bed666
**APPROVED SCOPE**: prompt1.txt: 'Authorize deployment review + live verification of Institutional Identity Slice 2c.1 -- My Assignment authenticated resident authorization / migration 78.' Reconciled exact outgoing range (origin/main 59cd898..local HEAD) confirmed as exactly the 4 expected commits (Slice 2c doc + report, Slice 2c.1 feature 09c8486 + report 8f10f4f) with no unexpected commit/path. During this deployment review's own internal-helper-privilege check, found that migration 78's original REVOKE statements for _resident_authenticated_membership_match only covered PUBLIC and anon -- not authenticated -- meaning this project's ambient default privileges (the migration-76 lesson) could leave the internal-only helper directly callable by any authenticated client via PostgREST, bypassing resident_get_current_assignment's own workforce-active check and structural precedence. This is a deployment-review correction made BEFORE the first live apply (not a live-testing-surfaced bug), applying the migration-76 lesson prospectively as instructed. This task's scope is exactly: (1) add an explicit REVOKE ALL ... FROM authenticated on the helper in migration 78, since it has no concrete reason for direct client invocation by any role; (2) update scripts/verify-migration-78.cjs's grant check to require all three explicit revokes; (3) apply the corrected migration 78 live via the exact-file direct-SQL method; (4) verify effective live privileges (helper: no anon/authenticated/PUBLIC EXECUTE, only postgres/service_role; resident_get_current_assignment: unchanged anon/authenticated grants; organisation_memberships: no new grants); (5) run the full live synthetic authorization matrix (20 test cases) using disposable synthetic Supabase Auth users/tenants/workforce/memberships/roster fixtures only, with independent zero-leftover reconfirmation; (6) exercise the actual restored-session frontend UX against a running local dev server signed in with synthetic credentials, confirming a claimed authenticated resident's session restore loads My Assignment (both the Resident Home card and the full page) without the PIN, an unclaimed resident's restore falls back cleanly to the PIN form with no error shown, the explicit PIN flow (including a wrong-code retry) still works via the same unified form with no regression from removing the old separate error card, and no new persistent credential storage exists; (7) classify every verification-suite failure from the older migration-76/77/Resident-Home checks as stale-update (A), frozen-historical (B), or real regression (C) -- found 3 Resident-Home checks that were Category A (testing a real, ongoing App.tsx/IntelligenceHarnessHome invariant with literal text tied to the pre-migration-78 shape) and updated them narrowly to the new approved invariant; found the remaining migration-76 (2), migration-77 (1), and Resident-Home (1, the ceiling=75 check) failures to be Category B (frozen historical snapshots, already non-blocking via the harness's own manual-acknowledgement router, not real regressions); found zero Category C findings; (8) record migration 78 VERIFIED_APPLIED with full methodology; (9) reconcile the complete outgoing range and push via one GOVERNANCE_SYNC authorization. No Full Roster authenticated migration and no Chief/admin slice were started.

## FILES CHANGED
- .workspc-engineering/migration-evidence.json
- scripts/verify-migration-78.cjs
- scripts/verify-resident-home.cjs
- supabase/migrations/78_resident_get_current_assignment_authenticated_membership.sql

## FILES OUTSIDE EXPECTED SCOPE
NONE

## PROTECTED SURFACE HITS
NONE

## VERIFICATION RESULTS
- npm-verify — SKIP — TASK_CLASS (conditional — no matching changed paths)
- unregistered:node scripts/verify-migration-78.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 39/39, 0 failures.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-migration-78.cjs
- unregistered:node scripts/verify-migration-77.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 1 known-stale failure (Category B), not a regression.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-migration-77.cjs
- unregistered:node scripts/verify-migration-76.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 2 known-stale failures (Category B), not a regression.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-migration-76.cjs
- unregistered:node scripts/verify-my-assignment.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 0 failures.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-my-assignment.cjs
- unregistered:node scripts/verify-resident-home.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 1 known-stale failure remaining (Category B, ceiling=75), 3 Category-A checks now updated and passing.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-resident-home.cjs
- unregistered:node scripts/verify-full-roster.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 0 failures.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-full-roster.cjs
- unregistered:node scripts/verify-roster-section-config.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 0 failures.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-roster-section-config.cjs
- unregistered:node scripts/verify-resident-email-login.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 0 failures.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-resident-email-login.cjs
- unregistered:node scripts/verify-roster-revisions.cjs — MANUAL_ACKNOWLEDGED (ack: "Re-run this turn: 0 failures.") — UNREGISTERED — MANUAL REVIEW REQUIRED: node scripts/verify-roster-revisions.cjs
- migration-state-check — PASS — ceiling=78; freeze=ACTIVE; 1-57:UNKNOWN, 58-78:VERIFIED_APPLIED
- npm-verify — PASS — ok

## MANUAL ACKNOWLEDGEMENTS
- unregistered:node scripts/verify-migration-78.cjs — "Re-run this turn: 39/39 structural checks pass (including the new authenticated-revoke check), 0 failures." (2026-08-29T23:57:08.096Z)
- unregistered:node scripts/verify-migration-77.cjs — "1 failure: known-stale git-status file-scope snapshot (Category B, tied to migration 77's own originating task) -- this task's own additional legitimate src/migration files now also show, not a regression. Every substantive migration-77 check passes." (2026-08-29T23:57:08.296Z)
- unregistered:node scripts/verify-migration-76.cjs — "2 failures: known-stale ceiling=76 and git-status snapshot checks (Category B), unchanged verdict from every prior turn. Every substantive check passes." (2026-08-29T23:57:08.493Z)
- unregistered:node scripts/verify-my-assignment.cjs — "0 failures." (2026-08-29T23:57:08.685Z)
- unregistered:node scripts/verify-resident-home.cjs — "1 failure remaining: known-stale ceiling=75 check (Category B). The 3 checks that tested the pre-migration-78 App.tsx/IntelligenceHarnessHome shape were Category A -- updated narrowly this turn to the new approved hasAuthenticatedSession-aware invariant and now pass. Zero Category C findings." (2026-08-29T23:57:08.891Z)
- unregistered:node scripts/verify-full-roster.cjs — "0 failures -- confirms Full Roster untouched." (2026-08-29T23:57:09.090Z)
- unregistered:node scripts/verify-roster-section-config.cjs — "0 failures -- confirms roster-section presentation untouched." (2026-08-29T23:57:09.306Z)
- unregistered:node scripts/verify-resident-email-login.cjs — "0 failures -- confirms resident_set_email/verify_resident_login untouched." (2026-08-29T23:57:09.494Z)
- unregistered:node scripts/verify-roster-revisions.cjs — "0 failures." (2026-08-29T23:57:09.678Z)
- unregistered:node scripts/verify-migration-78.cjs — "Re-run this turn: 39/39, 0 failures." (2026-08-29T23:58:32.248Z)
- unregistered:node scripts/verify-migration-77.cjs — "Re-run this turn: 1 known-stale failure (Category B), not a regression." (2026-08-29T23:58:32.430Z)
- unregistered:node scripts/verify-migration-76.cjs — "Re-run this turn: 2 known-stale failures (Category B), not a regression." (2026-08-29T23:58:32.623Z)
- unregistered:node scripts/verify-my-assignment.cjs — "Re-run this turn: 0 failures." (2026-08-29T23:58:32.828Z)
- unregistered:node scripts/verify-resident-home.cjs — "Re-run this turn: 1 known-stale failure remaining (Category B, ceiling=75), 3 Category-A checks now updated and passing." (2026-08-29T23:58:33.030Z)
- unregistered:node scripts/verify-full-roster.cjs — "Re-run this turn: 0 failures." (2026-08-29T23:58:33.218Z)
- unregistered:node scripts/verify-roster-section-config.cjs — "Re-run this turn: 0 failures." (2026-08-29T23:58:33.438Z)
- unregistered:node scripts/verify-resident-email-login.cjs — "Re-run this turn: 0 failures." (2026-08-29T23:58:33.619Z)
- unregistered:node scripts/verify-roster-revisions.cjs — "Re-run this turn: 0 failures." (2026-08-29T23:58:33.819Z)

## LIVE CHECKS
NONE

## MIGRATIONS CREATED
- supabase/migrations/78_resident_get_current_assignment_authenticated_membership.sql

## MIGRATIONS APPLIED
- supabase/migrations/78_resident_get_current_assignment_authenticated_membership.sql

## UNAPPLIED MIGRATIONS
- 1-57: UNKNOWN

**LOCAL COMMIT**: 35be3baf73a72b2e4c70c5b32d096dc50c7d39e9
**PUSH STATUS**: NOT_PUSHED
**PRODUCTION BASELINE**: c2d22ff01c4f63f7f71fcdc61268bc19dd0121f0

## DECISIONS MADE
This deployment review's own internal-helper-privilege check found migration 78's original grant model only revoked EXECUTE on _resident_authenticated_membership_match from PUBLIC and anon, not authenticated -- given this project's ambient default privileges (the migration-76 lesson) grant EXECUTE directly to authenticated at function-creation time, the internal-only helper could have been called directly by any authenticated client via PostgREST, bypassing resident_get_current_assignment's own workforce-active check and structural precedence. Corrected before the first live apply by adding an explicit REVOKE ... FROM authenticated (by role name, matching the other two explicit revokes) and updating verify-migration-78.cjs's grant check accordingly. Applied migration 78 live via the exact-file method; effective-privilege verification (both information_schema and the more rigorous has_function_privilege()) confirms the helper has EXECUTE for neither anon nor authenticated -- only postgres/service_role -- and resident_get_current_assignment/organisation_memberships grants are unchanged. Ran the full 20-case live synthetic authorization matrix using disposable Supabase Auth users/tenants/workforce/memberships/roster fixtures: 0 failures, including live proof that an authenticated (non-anon) caller also cannot call the helper directly via PostgREST, that a matching authenticated session succeeds even with a deliberately wrong code (proving the strong path is code-independent, not merely code-first), that disabling legacy fallback never disables the strong path, and that an extra p_tenant_id argument is rejected outright by PostgREST's own schema-cache lookup. One honest, disclosed finding (not a failure, not something this migration changes): an authenticated caller supplying an unrelated workforce's own valid, non-disabled legacy code still receives that workforce's data -- unchanged, pre-existing 'code is the credential' behavior since migration 67. Independently reconfirmed zero leftover fixtures/auth users across two separate synthetic-data rounds. Additionally exercised the actual restored-session frontend UX against a real local dev server signed in with disposable synthetic credentials through the real DoctorAuthView/ResidentLoginView UI: confirmed by screenshot that a claimed authenticated resident's page-reload restore loads real assignment data on both Resident Home and the full My Assignment page with zero PIN re-entry; an unclaimed resident's restore falls back cleanly to the PIN form with no error text; the explicit PIN flow including a wrong-code retry still works through the same unified form (confirming the earlier removal of the separate 'Try Again' card creates no UX regression); and localStorage inspection confirms no new persistent credential storage of any kind. Applied prompt1.txt's own explicit A/B/C verification-suite hygiene rubric rather than accepting red output: found 3 resident-home.cjs checks were Category A (testing a real, ongoing invariant with literal text tied to the pre-migration-78 shape) and updated them narrowly to the new approved hasAuthenticatedSession-aware invariant, now passing; classified the remaining migration-76 (2), migration-77 (1), and resident-home (1, ceiling=75) failures as Category B (frozen historical diff-scope snapshots for their own originating tasks, already non-blocking via the harness's own manual-acknowledgement router); found zero Category C (real regression) findings anywhere. Migration 78 is now recorded VERIFIED_APPLIED with full methodology.

## NEW FINDINGS
NONE

## BLOCKERS
NONE

## MANUAL CHECKS REMAINING
NONE

## NEXT RECOMMENDED ACTION
Reconcile the complete outgoing range against origin/main, create one GOVERNANCE_SYNC push authorization covering the full Slice 2c documentation + Slice 2c.1 implementation + this deployment-review range, push normally, and confirm origin/main reaches the intended final commit before consuming the authorization. Do not start Full Roster/roster-section-presentation authenticated migration or any Chief/admin slice.

_Generated 2026-08-29T23:59:18.240Z by `scripts/harness.cjs report`. Deterministic fields come from Harness/Git state. DECISIONS MADE and NEXT RECOMMENDED ACTION are agent-supplied via --decisions-made/--next-action and default to UNKNOWN — never fabricated._
