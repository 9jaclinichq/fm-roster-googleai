# Task Report — t-7801c0a3

**TASK**: Slice 1B: wire missing_expected_coverage/ineligible_assignment into MultiRosterManagerView (`t-7801c0a3`)
**TASK CLASS**: PRODUCT_FEATURE
**FINAL STATUS**: COMMITTED_LOCAL
**SOURCE COMMIT**: 5a5c677b361b5a90942c7be10822cd5e64eb90cb
**APPROVED SCOPE**: Wire the two new Workforce Option A reconciliation issue types (missing_expected_coverage, ineligible_assignment, added in Slice 1) into MultiRosterManagerView.tsx's existing read-only checklist UI. missing_expected_coverage issues (workforceId null by design) now render in a new, clearly titled 'Missing Expected Coverage' roster-level section instead of silently collapsing into an unlabeled null-keyed group; ineligible_assignment issues (workforceId always present) continue to render through the pre-existing per-member grouped list unchanged. Added a small pure display-grouping helper, groupReconciliationIssuesForDisplay, to rosterReconciliation.ts (does not change computeReconciliationIssues or any issue semantics) so the member-vs-roster-level split is independently testable by the existing dependency-free harness instead of living untestable inline inside the .tsx component. No reconciliation-engine logic changed, no schema/migration/RLS/auth change, no writes anywhere.

## FILES CHANGED
- scripts/verify-roster-reconciliation.ts
- src/modules/org-admin/components/dashboard/MultiRosterManagerView.tsx
- src/modules/roster-engine/lib/rosterReconciliation.ts

## FILES OUTSIDE EXPECTED SCOPE
NONE

## PROTECTED SURFACE HITS
- workforce-option-a-live-cycle — src/modules/roster-engine/lib/rosterReconciliation.ts

## VERIFICATION RESULTS
- npm-verify — PASS — ok
- verify-roster-reconciliation — PASS — ok

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

**LOCAL COMMIT**: a9d4ae4078725da5b941c53cac61d1ae1a087f78
**PUSH STATUS**: NOT_PUSHED
**PRODUCTION BASELINE**: c2d22ff01c4f63f7f71fcdc61268bc19dd0121f0

## DECISIONS MADE
Extracted the member-vs-roster-level split into a pure, exported groupReconciliationIssuesForDisplay helper in rosterReconciliation.ts rather than inlining it in the .tsx component, so it stays testable by the dependency-free harness without importing React/databaseService. Roster-level section rendered as a flat (non-collapsible) list since these are typically few in number; per-member collapsible list untouched.

## NEW FINDINGS
NONE

## BLOCKERS
NONE

## MANUAL CHECKS REMAINING
NONE

## NEXT RECOMMENDED ACTION
None required for this slice. Two prior human-decision items remain open from Slice 1 (NHIA mapping confirmation, Special-coverage cardinality) for whenever a follow-up rule slice is scoped. No push/deploy/migration — freeze remains ACTIVE.

_Generated 2026-08-23T23:12:34.443Z by `scripts/harness.cjs report`. Deterministic fields come from Harness/Git state. DECISIONS MADE and NEXT RECOMMENDED ACTION are agent-supplied via --decisions-made/--next-action and default to UNKNOWN — never fabricated._
