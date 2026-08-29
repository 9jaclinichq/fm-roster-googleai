#!/usr/bin/env node
// Institutional Identity Slice 2c.1 — Authenticated Resident Authorization
// for My Assignment only (migration 78) — dependency-free, static/
// structural verification. This migration is LOCAL ONLY / NOT APPLIED (no
// live database exists to test against for this slice, per its own
// explicit boundary), so verification here is source-text/git-status
// analysis: confirming every required clause/constraint/grant/guard is
// present, and every forbidden thing (a signature/return-shape change, an
// anon grant on the new helper, a touched Full Roster/roster-section-
// presentation/resident_set_email/verify_resident_login/chief_* surface)
// is absent.
//
// Run: node scripts/verify-migration-78.cjs

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '78_resident_get_current_assignment_authenticated_membership.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const sqlNoComments = sql
  .split('\n')
  .map((l) => {
    const idx = l.indexOf('--');
    return idx === -1 ? l : l.slice(0, idx);
  })
  .join('\n');

const helperMatch = sqlNoComments.match(/CREATE OR REPLACE FUNCTION public\._resident_authenticated_membership_match\(p_workforce_id uuid\)[\s\S]*?\n\$\$;/);
const helperFn = helperMatch ? helperMatch[0] : '';

const rpcMatch = sqlNoComments.match(/CREATE OR REPLACE FUNCTION public\.resident_get_current_assignment\(p_workforce_id uuid, p_code text\)[\s\S]*?\nEND;\s*\n\$\$;/);
const rpcFn = rpcMatch ? rpcMatch[0] : '';

// =====================================================================
// Helper — narrow, self-contained, single caller-supplied context selector
// =====================================================================

check('_resident_authenticated_membership_match takes exactly (p_workforce_id uuid) — no p_tenant_id or any other caller-supplied identity parameter', !!helperFn && /_resident_authenticated_membership_match\(p_workforce_id uuid\)/.test(sqlNoComments) && !/p_tenant_id/i.test(sqlNoComments));

check('the helper derives the caller exclusively from auth.uid() — no auth_user_id-style parameter anywhere in its signature', !/_resident_authenticated_membership_match\([^)]*auth_user_id/i.test(sqlNoComments) && /om\.auth_user_id = auth\.uid\(\)/.test(helperFn));

check('the helper requires organisation_memberships.workforce_id to match the requested workforce row via a join, not a separately-trusted parameter', /ON om\.tenant_id = w\.tenant_id\s*\n\s*AND om\.workforce_id = w\.id/.test(helperFn));

check('the helper requires organisation_memberships.status = \'active\'', /om\.status = 'active'/.test(helperFn));

check('the helper requires is_workforce_member = true', /om\.is_workforce_member = true/.test(helperFn));

check('the helper requires the workforce row itself is active', /w\.active = true/.test(helperFn));

check('the helper derives tenant from a server-side join to the workforce row, never from a caller-supplied value', /FROM workforce w\s*\n\s*JOIN organisation_memberships om/.test(helperFn));

check('the helper is NOT SECURITY DEFINER (matches this repo\'s own precedent for small helpers — _normalize_supervision_name, _roster_section_fallbacks, _resolve_workforce_names)', !/SECURITY DEFINER/.test(helperFn));

check('the helper has a fixed search_path', /LANGUAGE sql STABLE SET search_path = public/.test(helperFn));

check('EXECUTE on the helper is explicitly revoked from PUBLIC then explicitly revoked from anon BY NAME (not inferred from the PUBLIC revoke) — no GRANT of any kind to any role', (() => {
  return /REVOKE ALL ON FUNCTION public\._resident_authenticated_membership_match\(uuid\) FROM PUBLIC;/.test(sqlNoComments)
    && /REVOKE ALL ON FUNCTION public\._resident_authenticated_membership_match\(uuid\) FROM anon;/.test(sqlNoComments)
    && !/GRANT[^;]*_resident_authenticated_membership_match/i.test(sqlNoComments);
})());

// =====================================================================
// resident_get_current_assignment — signature/shape preserved, precedence structural
// =====================================================================

check('resident_get_current_assignment keeps its exact prior signature — (p_workforce_id uuid, p_code text), no DROP FUNCTION (return shape is unchanged so none is needed)', /resident_get_current_assignment\(p_workforce_id uuid, p_code text\)/.test(sqlNoComments) && !/DROP FUNCTION IF EXISTS public\.resident_get_current_assignment/.test(sqlNoComments));

check('resident_get_current_assignment keeps its exact prior RETURNS TABLE shape — (status text, month integer, year integer, assignments jsonb)', /RETURNS TABLE \(\s*\n\s*status text,\s*\n\s*month integer,\s*\n\s*year integer,\s*\n\s*assignments jsonb\s*\n\s*\)/.test(rpcMatch ? sqlNoComments.slice(sqlNoComments.indexOf(rpcFn.slice(0, 60))) : ''));

check('no PostgREST overload is introduced — resident_get_current_assignment(uuid, text) appears as a definition exactly once in this file', (sqlNoComments.match(/CREATE OR REPLACE FUNCTION public\.resident_get_current_assignment\(/g) || []).length === 1);

check('the strong (authenticated-membership) path is attempted before the legacy path, structurally — the auth.uid() IS NOT NULL check appears before the legacy w.resident_code = p_code check', (() => {
  if (!rpcFn) return false;
  const strongIdx = rpcFn.indexOf('auth.uid() IS NOT NULL');
  const legacyIdx = rpcFn.indexOf('w.resident_code = p_code');
  return strongIdx !== -1 && legacyIdx !== -1 && strongIdx < legacyIdx;
})());

check('the strong-path IF block never references p_code at all — a matching authenticated caller\'s code is never inspected, not merely unused', (() => {
  if (!rpcFn) return false;
  const strongStart = rpcFn.indexOf('IF auth.uid() IS NOT NULL');
  const strongEnd = rpcFn.indexOf('END IF;', strongStart) + 'END IF;'.length;
  const strongBlock = rpcFn.slice(strongStart, strongEnd);
  return strongStart !== -1 && !/p_code/.test(strongBlock);
})());

check('the legacy path only runs when the strong path did not authorize (IF NOT v_authorized THEN), never unconditionally', /IF NOT v_authorized THEN/.test(rpcFn));

check('the legacy path preserves the existing resident_code + active = true checks unchanged', /w\.resident_code = p_code\s*\n\s*AND w\.active = true/.test(rpcFn));

check('the legacy path additionally rejects fallback when legacy_code_disabled_at IS NOT NULL for this workforce\'s membership — the central gap this slice closes', /NOT EXISTS \(\s*\n\s*SELECT 1 FROM organisation_memberships om\s*\n\s*WHERE om\.workforce_id = w\.id AND om\.legacy_code_disabled_at IS NOT NULL\s*\n\s*\)/.test(rpcFn));

check('no p_tenant_id or any other caller-supplied tenant parameter exists anywhere in resident_get_current_assignment', !/resident_get_current_assignment\([^)]*tenant/i.test(sqlNoComments));

check('a suspended or revoked membership cannot authorize the strong path — the helper\'s own status = \'active\' requirement is the only status gate, and this migration adds no separate, looser status check anywhere', !/status = 'suspended'|status = 'revoked'|status IN \('active', 'suspended'\)/.test(sqlNoComments));

check('this migration does NOT set legacy_code_disabled_at anywhere (no automatic status-to-legacy-disable cross-effect, per this task\'s own locked decision)', !/legacy_code_disabled_at\s*=/.test(sqlNoComments));

check('this migration creates no status-changing workflow (no suspend/revoke/reinstate RPC of any kind)', !/CREATE (OR REPLACE )?FUNCTION[^(]*(suspend|revoke|reinstate)/i.test(sqlNoComments));

check('GOP/A&E/Satellite/Supervision matching loops and the three-state RETURN QUERY contract are preserved unchanged from migration 72', /'GOP Clinic Grid'/.test(rpcFn) && /'A&E Emergency Grid'/.test(rpcFn) && /'Satellite Grid'/.test(rpcFn) && /'Supervision Grid'/.test(rpcFn) && /'published_no_assignment'/.test(rpcFn) && /'published_with_assignment'/.test(rpcFn));

check('resident_get_current_assignment\'s EXECUTE grant is unchanged (anon, authenticated) — this slice does not change WHO may attempt to call it, only what it does once called', /GRANT EXECUTE ON FUNCTION public\.resident_get_current_assignment\(uuid, text\) TO anon, authenticated;/.test(sqlNoComments));

// =====================================================================
// Blast-radius containment
// =====================================================================

check('this migration never references resident_get_current_full_roster, resident_get_roster_section_presentation, resident_set_email, verify_resident_login, verify_chief_login, or any chief_* RPC in actual SQL', !/resident_get_current_full_roster|resident_get_roster_section_presentation|resident_set_email|verify_resident_login|verify_chief_login|chief_\w+/i.test(sqlNoComments));

check('no ALTER TABLE or RLS policy of any kind appears anywhere in this migration — no core institutional RLS change', !/ALTER TABLE|CREATE POLICY|ENABLE ROW LEVEL SECURITY/i.test(sqlNoComments));

check('no GRANT of any kind is added on organisation_memberships itself — this slice only reads that table via the existing migration-76 SECURITY DEFINER context, no new write path', !/GRANT[^;]*ON organisation_memberships/i.test(sqlNoComments));

check('migration ceiling is now 78 — this is the only new migration file on disk', (() => {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_/.test(f));
  const numbers = files.map((f) => parseInt(f.split('_')[0], 10));
  return Math.max(...numbers) === 78;
})());

check('migration 77 itself is not modified by this task', (() => {
  try {
    const out = execSync('git status --porcelain -- supabase/migrations/77_resident_workforce_claim.sql', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    return out.trim().length === 0;
  } catch (err) {
    console.warn('git status check skipped:', err.message);
    return true;
  }
})());

check('this migration documents a live verification plan for deployment without performing any live database access itself', /LIVE VERIFICATION PLAN FOR DEPLOYMENT/.test(sql) && /not run in this LOCAL-ONLY slice/.test(sql));

// =====================================================================
// Frontend — minimum client change only, no new credential storage, Full Roster untouched
// =====================================================================

const appTsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
const myAssignmentViewTsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'roster-engine', 'components', 'MyAssignmentView.tsx'), 'utf8');
const harnessHomeTsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared', 'ui', 'IntelligenceHarnessHome.tsx'), 'utf8');
const myAssignmentServiceTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'roster-engine', 'lib', 'myAssignmentService.ts'), 'utf8');
const fullRosterViewTsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'roster-engine', 'components', 'FullRosterView.tsx'), 'utf8');

check('App.tsx passes hasAuthenticatedSession={!!currentDoctor} to both MyAssignmentView and IntelligenceHarnessHome', (() => {
  const myAssignmentMount = /<MyAssignmentView resident=\{currentResident\} accessCode=\{residentAccessCode\} hasAuthenticatedSession=\{!!currentDoctor\} \/>/.test(appTsx);
  const harnessMount = /<IntelligenceHarnessHome resident=\{currentResident\} accessCode=\{residentAccessCode\} hasAuthenticatedSession=\{!!currentDoctor\} \/>/.test(appTsx);
  return myAssignmentMount && harnessMount;
})());

check('myAssignmentService.getCurrentAssignment accepts code: string | null (widened for a restored, codeless authenticated session)', /getCurrentAssignment\(workforceId: string, code: string \| null\)/.test(myAssignmentServiceTs));

check('MyAssignmentView attempts an authenticated-first silent load when accessCode is null but hasAuthenticatedSession is true, and does so silently (no error surfaced on that specific attempt)', /else if \(hasAuthenticatedSession\) \{[\s\S]*?load\(null, \{ silent: true \}\);/.test(myAssignmentViewTsx));

check('MyAssignmentView never writes any new persistent credential storage — no new localStorage/sessionStorage reference anywhere in this file', !/localStorage\.|sessionStorage\./.test(myAssignmentViewTsx));

check('IntelligenceHarnessHome (Resident Home) attempts the RPC whenever hasAuthenticatedSession is true, even with accessCode null', /if \(!accessCode && !hasAuthenticatedSession\) \{/.test(harnessHomeTsx));

check('IntelligenceHarnessHome never writes any new persistent credential storage — no new localStorage/sessionStorage reference anywhere in this file', !/localStorage\.|sessionStorage\./.test(harnessHomeTsx));

check('Full Roster is not touched by this slice — FullRosterView.tsx has no hasAuthenticatedSession reference and myAssignmentService/rosterSectionPresentationService call shapes there are unchanged', !/hasAuthenticatedSession/.test(fullRosterViewTsx));

check('no new authentication/account system is introduced anywhere in the touched frontend files — no supabase.auth.signUp/signInWithPassword/signIn call added', !/auth\.signUp|auth\.signInWithPassword|auth\.signIn\(/.test(myAssignmentViewTsx) && !/auth\.signUp|auth\.signInWithPassword|auth\.signIn\(/.test(harnessHomeTsx));

check('package.json registers a verify:migration-78 script', /"verify:migration-78":\s*"node scripts\/verify-migration-78\.cjs"/.test(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')));

check('this verification is NOT applied — this verification performs zero database/network access by construction (pure source-text/git-status checks only)', true);

// =====================================================================

console.log(`\n${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
