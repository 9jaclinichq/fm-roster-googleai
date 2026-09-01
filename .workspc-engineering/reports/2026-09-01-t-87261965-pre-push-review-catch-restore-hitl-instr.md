# Task Report — t-87261965

**TASK**: Pre-push review catch: restore HITL_INSTRUCTION dropped from buildSystemPrompt() during the row-targeting fix edit (`t-87261965`)
**TASK CLASS**: BUG_FIX
**FINAL STATUS**: COMMITTED_LOCAL
**SOURCE COMMIT**: 6064c6246954ad483439304d43d23fb8bc0a1307
**APPROVED SCOPE**: Pre-push review (prompt1.txt, 2026-09-01 Phase 0) caught a real regression introduced during the prior row-targeting fix (t-3c23e6e9, commit 148a671): editing buildSystemPrompt() in supabase/functions/roster-patch-proposal/index.ts to add the new LOAD-BEARING date_or_day/label comment block accidentally REPLACED the `HITL_INSTRUCTION,` array element instead of being added alongside it, silently dropping the human-in-the-loop framing text from every real system prompt sent to the AI provider. Not caught by tsc/npm run verify because supabase/functions is excluded from tsconfig.json (see tsconfig.json's own exclude list), so the resulting unused HITL_INSTRUCTION const produced zero compiler signal. Fix: restore `HITL_INSTRUCTION,` as its own array element (net-identical to origin/main at that line), and add one new regression check in scripts/verify-roster-patch-proposal.ts asserting the identifier appears both as a definition and as an actual element of the returned array, so this class of silent drop cannot recur undetected.

## FILES CHANGED
- scripts/verify-roster-patch-proposal.ts
- supabase/functions/roster-patch-proposal/index.ts

## FILES OUTSIDE EXPECTED SCOPE
NONE

## PROTECTED SURFACE HITS
NONE

## VERIFICATION RESULTS
- unregistered:npx tsc --noEmit — MANUAL_ACKNOWLEDGED (ack: "Manually ran 'npx tsc --noEmit' this session -- exit 0, zero output.") — UNREGISTERED — MANUAL REVIEW REQUIRED: npx tsc --noEmit
- unregistered:npx tsx scripts/verify-roster-patch-proposal.ts — MANUAL_ACKNOWLEDGED (ack: "Manually ran 'npx tsx scripts/verify-roster-patch-proposal.ts' this session -- 97 checks OK (96 + 1 new HITL_INSTRUCTION regression guard), 0 failures.") — UNREGISTERED — MANUAL REVIEW REQUIRED: npx tsx scripts/verify-roster-patch-proposal.ts
- npm-verify — PASS — ok
- verify-e0-containment — PASS — ok

## MANUAL ACKNOWLEDGEMENTS
- unregistered:npx tsc --noEmit — "Manually ran 'npx tsc --noEmit' this session -- exit 0, zero output." (2026-09-01T00:22:42.931Z)
- unregistered:npx tsx scripts/verify-roster-patch-proposal.ts — "Manually ran 'npx tsx scripts/verify-roster-patch-proposal.ts' this session -- 97 checks OK (96 + 1 new HITL_INSTRUCTION regression guard), 0 failures." (2026-09-01T00:22:43.129Z)

## LIVE CHECKS
NONE

## MIGRATIONS CREATED
NONE

## MIGRATIONS APPLIED
NONE

## UNAPPLIED MIGRATIONS
- 1-57: UNKNOWN

**LOCAL COMMIT**: a071daadf97ac81a0b8e1e9c89393061f692a776
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

_Generated 2026-09-01T00:23:10.573Z by `scripts/harness.cjs report`. Deterministic fields come from Harness/Git state. DECISIONS MADE and NEXT RECOMMENDED ACTION are agent-supplied via --decisions-made/--next-action and default to UNKNOWN — never fabricated._
