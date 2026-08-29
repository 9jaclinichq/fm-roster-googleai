# Task Report — t-2db892e9

**TASK**: Institutional Identity Slice 2c: Authenticated Resident Authorization Coexistence -- DISCOVER + PLAN (`t-2db892e9`)
**TASK CLASS**: DOCUMENTATION_GOVERNANCE
**FINAL STATUS**: COMMITTED_LOCAL
**SOURCE COMMIT**: 59cd898b9fbf754de66abf0480b3d09cf455f1a8
**APPROVED SCOPE**: prompt1.txt: 'Next task -- Institutional Identity Slice 2c: Authenticated Resident Authorization Coexistence. DISCOVER + PLAN only.' Documentation-only deliverable: WORKSPC_INSTITUTIONAL_IDENTITY_SLICE2C_AUTHENTICATED_RESIDENT_AUTHORIZATION_DISCOVER_AND_PLAN_2026-08-29.md. Audits the actual current implementations of resident_get_current_assignment, resident_get_current_full_roster, resident_get_roster_section_presentation, resident_set_email, verify_resident_login, claim_workforce_member, current_user_organisation_memberships, myAssignmentService, fullRosterService, rosterSectionPresentationService, Resident Home (IntelligenceHarnessHome.tsx), resident session restoration and Supabase Auth/doctor state in App.tsx, and organisation_memberships. Central finding: migration 77's legacy_code_disabled_at guard protects only verify_resident_login -- none of the other four resident RPCs re-checks it, so a membership with legacy fallback disabled is still fully accessible through resident_get_current_assignment/resident_get_current_full_roster/resident_get_roster_section_presentation/resident_set_email today. Designs a coexistence authorization pattern (a small reusable _resident_authenticated_membership_match(uuid,uuid) helper, auth-first with unconditional precedence so the caller can never choose the weaker path), evaluates and rejects signature-overload strategies B/C in favor of A (keep existing signatures), resolves multi-tenant/context ambiguity via workforce-derived tenant scoping (never guessing), recommends resident_get_current_assignment alone as the first bounded migration, specifies the exact frontend gating changes needed (App.tsx passing hasAuthenticatedSession, MyAssignmentView.tsx/IntelligenceHarnessHome.tsx load-gating), specifies the security/grant model for the one new helper function (applying the migration-76/77 ambient-default-privilege lesson prospectively), a full verification matrix, explicit non-goals, and an exact implementation handoff for a future, separately-approved implementation task. No code, schema, migration, RLS, Supabase Auth configuration, or live database mutation was performed. No Harness implementation lifecycle beyond this documentation task was started. STOP for human review before any implementation, per prompt1.txt's own explicit instruction.

## FILES CHANGED
- WORKSPC_INSTITUTIONAL_IDENTITY_SLICE2C_AUTHENTICATED_RESIDENT_AUTHORIZATION_DISCOVER_AND_PLAN_2026-08-29.md

## FILES OUTSIDE EXPECTED SCOPE
NONE

## PROTECTED SURFACE HITS
NONE

## VERIFICATION RESULTS
NONE

## MANUAL ACKNOWLEDGEMENTS
NONE

## LIVE CHECKS
NONE

## MIGRATIONS CREATED
NONE

## MIGRATIONS APPLIED
NONE

## UNAPPLIED MIGRATIONS
- 1-57: UNKNOWN

**LOCAL COMMIT**: 66372cbb3eb1d478a3e850cbda7b9b3e722cf21c
**PUSH STATUS**: NOT_PUSHED
**PRODUCTION BASELINE**: c2d22ff01c4f63f7f71fcdc61268bc19dd0121f0

## DECISIONS MADE
Audited all four resident-facing SECURITY DEFINER RPCs plus verify_resident_login, claim_workforce_member, current_user_organisation_memberships, their frontend service wrappers, Resident Home, and App.tsx session restoration. Central finding: migration 77's legacy_code_disabled_at guard protects only verify_resident_login -- resident_get_current_assignment, resident_get_current_full_roster, resident_get_roster_section_presentation, and resident_set_email each independently re-verify workforce_id+resident_code+active with no reference to organisation_memberships at all, so a membership with legacy fallback disabled is still fully reachable through any of those four RPCs today. Also found the pre-existing workforce.doctor_id convergence path already produces a currentResident with a null residentAccessCode, meaning a doctor-linked resident already hits the PIN-reentry wall on every session restore -- this is a live, already-existing gap, not hypothetical. Designed a coexistence pattern: a small, non-SECURITY-DEFINER _resident_authenticated_membership_match(uuid,uuid) helper, invoked first and unconditionally inside each RPC so a claimed, actively-linked caller's code is never even inspected -- closing the 'caller must never choose the weaker path' requirement structurally rather than by convention. Evaluated all three signature strategies and recommended keeping current signatures (option A), rejecting overloads (option B, due to PostgREST's documented overload-resolution fragility and this repo's zero precedent for RPC overloading) and deferred replacement (option C, unnecessary breaking change). Resolved multi-tenant ambiguity by confirming tenant is always workforce-derived, never guessed. Recommended resident_get_current_assignment alone as the first bounded migration (highest user-visible value: Resident Home + My Assignment), deferring Full Roster/roster-section presentation to an immediate follow-up slice and resident_set_email further out per 'read-only surfaces first'. Flagged one explicit open sub-question (membership status vs. legacy_code_disabled_at orthogonality) rather than silently resolving it. No code, schema, migration, RLS, or live database change was made.

## NEW FINDINGS
NONE

## BLOCKERS
NONE

## MANUAL CHECKS REMAINING
NONE

## NEXT RECOMMENDED ACTION
STOP for human review of the recommended coexistence pattern, signature strategy, and first-bounded-slice recommendation, per prompt1.txt's own explicit instruction. Do not begin implementation until a future, separately-approved task authorizes it.

_Generated 2026-08-29T20:42:46.163Z by `scripts/harness.cjs report`. Deterministic fields come from Harness/Git state. DECISIONS MADE and NEXT RECOMMENDED ACTION are agent-supplied via --decisions-made/--next-action and default to UNKNOWN — never fabricated._
