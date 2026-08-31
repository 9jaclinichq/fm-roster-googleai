# Task Report — t-3c23e6e9

**TASK**: Roster AI V1: deterministic semantic row-targeting fix (WRONG_ROSTER_ROW_TARGETING_WITH_VALID_PROPOSAL) (`t-3c23e6e9`)
**TASK CLASS**: BUG_FIX
**FINAL STATUS**: COMMITTED_LOCAL
**SOURCE COMMIT**: e079f0d2811e6b1b8a620bcfa75bae1a9bc76def
**APPROVED SCOPE**: prompt1.txt (2026-09-01): 'Approved: implement the bounded deterministic row-targeting fix for Roster AI V1 locally only. Do not push, deploy, migrate, or re-enable the pilot.' Fixes WRONG_ROSTER_ROW_TARGETING_WITH_VALID_PROPOSAL: a Chief instructed a replace naming an exact date ('Tue 01/09'); the model's own interpreted_instruction correctly echoed that date, but the model separately returned a raw row_index that pointed at a different roster row (Thu 03/09) sharing the same clinic_type label for the same person (Dr Ikor) -- every downstream layer trusted that integer verbatim since it carried no semantic meaning to cross-check. Fix: remove row_index from the SymbolicOperation/SymbolicTarget contract entirely (schema.ts + rosterPatchProposalService.ts), add one new deterministic resolver resolveSymbolicRosterTarget(currentGrids, {section,date_or_day,label,field}) in rosterPatchProposalCompiler.ts requiring an exact unique match (fail closed on 0 or >1), rewire compileProposalOperations() so assign/unassign/replace and both swap endpoints resolve location deterministically FIRST (before identity), add a shared rowSemanticLabelFor() export in rosterPatch.ts reused by both the context-builder (MultiRosterManagerView.tsx) and the resolver, add a new 'location_unresolvable' compiled-operation status distinct from the existing identity 'unresolvable' status with matching UI branch, and update the Edge Function system prompt (buildSystemPrompt in index.ts) to describe date_or_day/label instead of row_index and instruct the model to copy them verbatim from context. No DB write, no migration, no deploy, no tenant enablement, no live provider call.

## FILES CHANGED
- scripts/verify-roster-patch-proposal.ts
- src/modules/org-admin/components/dashboard/MultiRosterManagerView.tsx
- src/modules/roster-engine/lib/rosterPatch.ts
- src/modules/roster-engine/lib/rosterPatchProposalCompiler.ts
- src/modules/roster-engine/lib/rosterPatchProposalService.ts
- supabase/functions/roster-patch-proposal/index.ts
- supabase/functions/roster-patch-proposal/schema.ts

## FILES OUTSIDE EXPECTED SCOPE
NONE

## PROTECTED SURFACE HITS
- workforce-option-a-live-cycle — src/modules/roster-engine/lib/rosterPatch.ts
- workforce-option-a-live-cycle — src/modules/roster-engine/lib/rosterPatchProposalCompiler.ts
- workforce-option-a-live-cycle — src/modules/roster-engine/lib/rosterPatchProposalService.ts

## VERIFICATION RESULTS
- unregistered:npx tsc --noEmit — MANUAL_ACKNOWLEDGED (ack: "Manually ran 'npx tsc --noEmit' this session — exit 0, zero output, zero errors.") — UNREGISTERED — MANUAL REVIEW REQUIRED: npx tsc --noEmit
- unregistered:npx tsx scripts/verify-roster-patch-proposal.ts — MANUAL_ACKNOWLEDGED (ack: "Manually ran 'npx tsx scripts/verify-roster-patch-proposal.ts' this session — 96 checks OK, 0 failure(s), including all new resolveSymbolicRosterTarget/exact-reproduction/adversarial fixtures for this fix.") — UNREGISTERED — MANUAL REVIEW REQUIRED: npx tsx scripts/verify-roster-patch-proposal.ts
- npm-verify — PASS — ok
- verify-roster-reconciliation — PASS — ok
- verify-e0-containment — PASS — ok

## MANUAL ACKNOWLEDGEMENTS
- unregistered:npx tsc --noEmit — "Manually ran 'npx tsc --noEmit' this session — exit 0, zero output, zero errors." (2026-08-31T23:54:04.271Z)
- unregistered:npx tsx scripts/verify-roster-patch-proposal.ts — "Manually ran 'npx tsx scripts/verify-roster-patch-proposal.ts' this session — 96 checks OK, 0 failure(s), including all new resolveSymbolicRosterTarget/exact-reproduction/adversarial fixtures for this fix." (2026-08-31T23:54:04.540Z)

## LIVE CHECKS
NONE

## MIGRATIONS CREATED
NONE

## MIGRATIONS APPLIED
NONE

## UNAPPLIED MIGRATIONS
- 1-57: UNKNOWN

**LOCAL COMMIT**: 148a671651141652bde8d35487691fd66e93d210
**PUSH STATUS**: NOT_PUSHED
**PRODUCTION BASELINE**: c2d22ff01c4f63f7f71fcdc61268bc19dd0121f0

## DECISIONS MADE
UNKNOWN

## NEW FINDINGS
NONE

## BLOCKERS
NONE

## MANUAL CHECKS REMAINING
NONE

## NEXT RECOMMENDED ACTION
UNKNOWN

_Generated 2026-08-31T23:59:20.257Z by `scripts/harness.cjs report`. Deterministic fields come from Harness/Git state. DECISIONS MADE and NEXT RECOMMENDED ACTION are agent-supplied via --decisions-made/--next-action and default to UNKNOWN — never fabricated._
