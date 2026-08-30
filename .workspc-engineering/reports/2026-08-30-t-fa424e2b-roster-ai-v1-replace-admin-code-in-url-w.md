# Task Report — t-fa424e2b

**TASK**: Roster AI V1: replace admin-code-in-URL with verify_chief_admin_code RPC (migration 80, not applied) (`t-fa424e2b`)
**TASK CLASS**: SECURITY_HARDENING
**FINAL STATUS**: COMMITTED_LOCAL
**SOURCE COMMIT**: 36f3032c6fa20117ec0d230acf46094dd4dbdb69
**APPROVED SCOPE**: prompt1.txt: 'Do not deploy roster-patch-proposal yet. Resolve the remaining admin-code transport issue first as a bounded SECURITY_HARDENING task. verifyAdminCodeAndDeriveTenant() currently places raw admin_access_code in a Supabase REST GET query string. Replace that lookup with a server-side verification path where the raw admin code travels in a request body / RPC parameter, not in a URL query string. Prefer the smallest secure RPC consistent with existing Chief/admin-code verification semantics. This task may add exactly one migration if required. Current ceiling: 79. If adding one migration, use 80 only. Do not use supabase db push. Prepare the exact migration and verify locally first. Do not apply live until preflight is complete and explicitly reported. LOCAL ONLY first. No Edge Function deployment. No live AI call. No production migration application until human review.' Added supabase/migrations/80_verify_chief_admin_code.sql (written for review, NOT applied): a single new SECURITY DEFINER RPC, verify_chief_admin_code(p_admin_code text) RETURNS uuid, performing the exact same SELECT tenant_id FROM settings WHERE admin_access_code = p_admin_code lookup chief_start_roster_revision already performs inline (migration 75), returning ONLY tenant_id (or NULL) -- no other settings column, no hash/comparison logic exposed to the client, no roster/revision table referenced, no INSERT/UPDATE/DELETE anywhere in the migration. Privilege model follows the exact migrations-76/77 ambient-default-privilege remediation pattern: explicit REVOKE ALL FROM PUBLIC, explicit REVOKE ALL FROM anon (a PUBLIC-only REVOKE was empirically proven insufficient on this project in those migrations), then explicit GRANT EXECUTE TO anon, authenticated -- matching verify_resident_login's identical posture (migration 77), since this app's Chief/resident sessions are never real Supabase Auth sessions and access control is enforced entirely by the code parameter verified inside the function body. Cross-tenant isolation relies on settings.admin_access_code's pre-existing UNIQUE constraint (settings_admin_code_unique, migration 23), confirmed present and untouched by this migration. Rewrote verifyAdminCodeAndDeriveTenant() in supabase/functions/roster-patch-proposal/index.ts to call this RPC via admin.rpc('verify_chief_admin_code', { p_admin_code: adminCode }) -- a POST request with the code in the JSON body, replacing the prior raw fetch() to /rest/v1/settings?admin_access_code=eq.<code> which embedded the code in a URL query string. The function's external contract (input: adminCode string, output: tenant_id string | null) is completely unchanged, so its call site and every existing test exercising the surrounding Edge Function logic remain valid. Added scripts/verify-migration-80.cjs (17 static structural checks, no live DB) proving the migration's exact shape, privilege sequence, and scope containment, and explicitly documenting which invariants (live data resolution, live has_function_privilege confirmation) require a future live-apply step this task does not perform. Added/updated 6 tests in scripts/verify-roster-patch-proposal.ts: the new RPC-based call shape, absence of any URL/query-string embedding of the admin code anywhere in the Edge Function's actual code, the unchanged minimal return contract, the unchanged tenant-derivation call site, and a corrected migration-ceiling assertion (previously hardcoded to exactly 79; now accepts 79 or 80, with 80 required to be exactly this one function and nothing roster/revision-related). No live migration application, no Edge Function deployment, no live AI/provider call, no roster/revision DB write.

## FILES CHANGED
- scripts/verify-roster-patch-proposal.ts
- supabase/functions/roster-patch-proposal/index.ts
- scripts/verify-migration-80.cjs
- supabase/migrations/80_verify_chief_admin_code.sql

## FILES OUTSIDE EXPECTED SCOPE
NONE

## PROTECTED SURFACE HITS
NONE

## VERIFICATION RESULTS
- security-manual-review — MANUAL_ACKNOWLEDGED (ack: "Manually reviewed full diff of index.ts (only verifyAdminCodeAndDeriveTenant's implementation changed -- external contract unchanged, no admin code or key ever logged), the new migration 80 (single SECURITY DEFINER function, exact revoke-then-grant privilege sequence matching migrations 76/77's own remediation and verify_resident_login's posture, no roster/revision table touched, no INSERT/UPDATE/DELETE), and the new verify-migration-80.cjs script. No credentials/secrets in any file. No widening of permissions beyond the established chief_*/resident_* pattern.") — manual diff/control-flow review may remain necessary
- unregistered:npm run verify:roster-patch-proposal — MANUAL_ACKNOWLEDGED (ack: "Ran manually: npx tsx scripts/verify-roster-patch-proposal.ts -- 0 failures across 71 checks (65 prior + 6 new for the RPC-based admin-code transport).") — UNREGISTERED — MANUAL REVIEW REQUIRED: npm run verify:roster-patch-proposal
- unregistered:verify-migration-80 — MANUAL_ACKNOWLEDGED (ack: "Ran manually: node scripts/verify-migration-80.cjs -- 0 failures across 17 static structural checks.") — UNREGISTERED — MANUAL REVIEW REQUIRED: verify-migration-80
- npm-verify — PASS — ok
- verify-e0-containment — PASS — ok

## MANUAL ACKNOWLEDGEMENTS
- security-manual-review — "Manually reviewed full diff of index.ts (only verifyAdminCodeAndDeriveTenant's implementation changed -- external contract unchanged, no admin code or key ever logged), the new migration 80 (single SECURITY DEFINER function, exact revoke-then-grant privilege sequence matching migrations 76/77's own remediation and verify_resident_login's posture, no roster/revision table touched, no INSERT/UPDATE/DELETE), and the new verify-migration-80.cjs script. No credentials/secrets in any file. No widening of permissions beyond the established chief_*/resident_* pattern." (2026-08-30T22:29:15.824Z)
- unregistered:npm run verify:roster-patch-proposal — "Ran manually: npx tsx scripts/verify-roster-patch-proposal.ts -- 0 failures across 71 checks (65 prior + 6 new for the RPC-based admin-code transport)." (2026-08-30T22:29:16.316Z)
- unregistered:verify-migration-80 — "Ran manually: node scripts/verify-migration-80.cjs -- 0 failures across 17 static structural checks." (2026-08-30T22:29:16.632Z)

## LIVE CHECKS
NONE

## MIGRATIONS CREATED
- supabase/migrations/80_verify_chief_admin_code.sql

## MIGRATIONS APPLIED
NONE

## UNAPPLIED MIGRATIONS
- 1-57: UNKNOWN
- 80: UNKNOWN

**LOCAL COMMIT**: 0e22437c2cdb8954f1451f7846397fb67d1e4a14
**PUSH STATUS**: NOT_PUSHED
**PRODUCTION BASELINE**: c2d22ff01c4f63f7f71fcdc61268bc19dd0121f0

## DECISIONS MADE
Replaced verifyAdminCodeAndDeriveTenant()'s URL-embedded admin-code lookup with a body-based RPC call, per prompt1.txt's explicit instruction. Design: verify_chief_admin_code(p_admin_code text) RETURNS uuid, SECURITY DEFINER, SET search_path=public -- the smallest possible RPC, performing the exact same SELECT tenant_id FROM settings WHERE admin_access_code = p_admin_code lookup chief_start_roster_revision already performs inline (migration 75), returning ONLY the tenant_id scalar (or NULL for an invalid/absent code) -- no other settings column, no admin_access_code echo, no hash/comparison logic ever exposed to the client, no roster/revision table read or write of any kind. Privilege model: read migrations 76 and 77 in full to reconstruct the documented ambient-default-privilege lesson (a plain REVOKE ALL ... FROM PUBLIC after CREATE FUNCTION was empirically found insufficient on this project -- anon had separately, ambiently obtained EXECUTE at CREATE FUNCTION time, and PUBLIC-only REVOKE did not remove it) and applied the identical remediation here: explicit REVOKE ALL FROM PUBLIC, explicit REVOKE ALL FROM anon (by role name, not inferred), then explicit GRANT EXECUTE TO anon, authenticated -- matching verify_resident_login's own identical final posture (migration 77), since this app's Chief/resident sessions are never real Supabase Auth sessions and every existing chief_*/resident_* RPC already relies on anon as the actual PostgREST calling role, with the code parameter itself (verified inside the function body) as the real access gate. This is not a permission widening -- it makes this one new function's resulting privilege state explicit and deterministic rather than accidentally inherited, matching established project convention exactly. Cross-tenant isolation: confirmed settings.admin_access_code has carried a UNIQUE constraint since migration 23 (settings_admin_code_unique) -- at most one row/tenant can ever match a given code; an invalid code matches zero rows under standard SQL equality semantics. This migration does not touch that constraint. No new enumeration primitive: the function returns strictly less information (tenant_id or null only) than existing chief_* RPCs already accepting p_admin_code (which additionally reveal collection-state via distinct exception messages) -- a caller guessing codes learns only the same binary signal every existing admin-code-gated RPC already exposes. Rewired verifyAdminCodeAndDeriveTenant() in index.ts to call admin.rpc('verify_chief_admin_code', { p_admin_code: adminCode }) -- confirmed this issues a POST with the code in the JSON request body, never a URL query string; the function's external contract (input adminCode string, output tenant_id string|null) is unchanged, so its call site and all surrounding Edge Function logic (tenant-derivation gate, quota check, tenant prompt override, provider calls, schema validation, model-prompt construction) remain untouched and unaffected. Added scripts/verify-migration-80.cjs: 17 static SQL-text structural checks (function shape, exact equality lookup, minimal return value, no roster/revision table reference, no mutation statement, exact REVOKE/GRANT sequence and ordering, exactly-anon-and-authenticated grant, UNIQUE-constraint cross-check) -- explicitly documents in its own output which invariants (live tenant resolution against real data; live has_function_privilege(anon/authenticated, ...) confirmation) require a future live-apply step and are NOT claimed to be proven by static analysis alone. Added/updated 6 tests in scripts/verify-roster-patch-proposal.ts: the new RPC call shape, absence of admin-code URL embedding anywhere in the Edge Function's actual code (comment mentioning the old, replaced approach for documentation is fine and excluded via the file's own established codeOnly convention), the unchanged minimal return contract, the unchanged tenant-derivation call site, and a corrected migration-ceiling assertion (previously hardcoded to exactly 79 from the earlier no-migration Roster AI feature slice; now accepts 79 or 80, with 80 required to be exactly this one function and structurally free of any roster/revision reference) -- full suite now 71 checks, 0 failures. Full re-verification: npm run verify (PASS), harness router (npm-verify PASS, verify-e0-containment PASS), verify-migration-80.cjs (17/17), harness self-test (156-157/157, same single pre-existing flaky/unrelated case observed intermittently both before and after this change, not a regression). Manual diff/control-flow review completed and acknowledged before commit. No live database connection was made at any point -- migration 80 is written for review only and was NOT applied; no supabase db push or equivalent was run.

## NEW FINDINGS
NONE

## BLOCKERS
NONE

## MANUAL CHECKS REMAINING
NONE

## NEXT RECOMMENDED ACTION
STOP for human review, per prompt1.txt's explicit instruction. Do not apply migration 80 live, do not deploy the Edge Function, do not make a live AI call, until: (1) this RPC design and privilege model are explicitly approved; (2) a future, separately-approved live-apply task applies migration 80 and performs the live has_function_privilege('anon', 'public.verify_chief_admin_code(text)', 'EXECUTE') / authenticated-equivalent preflight this task could not perform locally, confirming the REVOKE+GRANT sequence actually took effect against this project's own ambient default-privilege behavior; (3) only then should supabase functions deploy roster-patch-proposal be considered, followed by a disposable/synthetic-tenant smoke test per the standing deployment plan. Freeze remains ACTIVE; nothing was pushed, deployed, or live-migrated.

_Generated 2026-08-30T22:30:40.335Z by `scripts/harness.cjs report`. Deterministic fields come from Harness/Git state. DECISIONS MADE and NEXT RECOMMENDED ACTION are agent-supplied via --decisions-made/--next-action and default to UNKNOWN — never fabricated._
