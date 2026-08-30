#!/usr/bin/env node
// Institutional Identity Slice 2c.2 — Authenticated Resident Authorization
// for Full Roster + Roster Section Presentation (migration 79) —
// dependency-free, static/structural verification. This migration is
// LOCAL ONLY / NOT APPLIED (no live database exists to test against for
// this slice, per its own explicit boundary), so verification here is
// source-text/git-status analysis: confirming every required clause/
// grant/guard is present, and every forbidden thing (a signature/return-
// shape change, a new helper, a touched Chief RPC, a touched
// resident_set_email/verify_resident_login/resident_get_current_assignment)
// is absent.
//
// Run: node scripts/verify-migration-79.cjs

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

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '79_full_roster_and_section_presentation_authenticated_membership.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const sqlNoComments = sql
  .split('\n')
  .map((l) => {
    const idx = l.indexOf('--');
    return idx === -1 ? l : l.slice(0, idx);
  })
  .join('\n');

const fullRosterMatch = sqlNoComments.match(/CREATE OR REPLACE FUNCTION public\.resident_get_current_full_roster\(p_workforce_id uuid, p_code text\)[\s\S]*?\nEND;\s*\n\$\$;/);
const fullRosterFn = fullRosterMatch ? fullRosterMatch[0] : '';

const presentationMatch = sqlNoComments.match(/CREATE OR REPLACE FUNCTION public\.resident_get_roster_section_presentation\(p_workforce_id uuid, p_code text\)[\s\S]*?\nEND;\s*\n\$\$;/);
const presentationFn = presentationMatch ? presentationMatch[0] : '';

// =====================================================================
// No new/modified helper — reuse only
// =====================================================================

check('no new function named _resident_authenticated_membership_match or any other helper is defined in this migration — it is reused as-is', !/CREATE (OR REPLACE )?FUNCTION public\._resident_authenticated_membership_match/.test(sqlNoComments));

check('no REVOKE/GRANT statement referencing _resident_authenticated_membership_match appears anywhere in this migration — its migration-78 grant state is completely untouched', !/_resident_authenticated_membership_match/.test(sqlNoComments.replace(/public\._resident_authenticated_membership_match\(p_workforce_id\)/g, '')));

check('both migrated functions call the existing helper exactly as migration 78 defined it — public._resident_authenticated_membership_match(p_workforce_id)', (sqlNoComments.match(/public\._resident_authenticated_membership_match\(p_workforce_id\)/g) || []).length === 2);

// =====================================================================
// resident_get_current_full_roster — signature/shape preserved, precedence structural
// =====================================================================

check('resident_get_current_full_roster keeps its exact prior signature — (p_workforce_id uuid, p_code text), no DROP FUNCTION', /resident_get_current_full_roster\(p_workforce_id uuid, p_code text\)/.test(sqlNoComments) && !/DROP FUNCTION IF EXISTS public\.resident_get_current_full_roster/.test(sqlNoComments));

check('resident_get_current_full_roster keeps its exact prior RETURNS TABLE shape (status/month/year/gop_clinic_grid/emergency_call_grid/supervision_grid/satellite_grid)', /RETURNS TABLE \(\s*\n\s*status text,\s*\n\s*month integer,\s*\n\s*year integer,\s*\n\s*gop_clinic_grid jsonb,\s*\n\s*emergency_call_grid jsonb,\s*\n\s*supervision_grid jsonb,\s*\n\s*satellite_grid jsonb\s*\n\s*\)/.test(sqlNoComments));

check('no PostgREST overload is introduced — resident_get_current_full_roster is defined exactly once in this file', (sqlNoComments.match(/CREATE OR REPLACE FUNCTION public\.resident_get_current_full_roster\(/g) || []).length === 1);

check('resident_get_current_full_roster: the strong path is attempted before the legacy path, structurally', (() => {
  if (!fullRosterFn) return false;
  const strongIdx = fullRosterFn.indexOf('auth.uid() IS NOT NULL');
  const legacyIdx = fullRosterFn.indexOf('w.resident_code = p_code');
  return strongIdx !== -1 && legacyIdx !== -1 && strongIdx < legacyIdx;
})());

check('resident_get_current_full_roster: the strong-path IF block never references p_code at all', (() => {
  if (!fullRosterFn) return false;
  const strongStart = fullRosterFn.indexOf('IF auth.uid() IS NOT NULL');
  const strongEnd = fullRosterFn.indexOf('END IF;', strongStart) + 'END IF;'.length;
  const strongBlock = fullRosterFn.slice(strongStart, strongEnd);
  return strongStart !== -1 && !/p_code/.test(strongBlock);
})());

check('resident_get_current_full_roster: the legacy path only runs when the strong path did not authorize', /IF NOT v_authorized THEN/.test(fullRosterFn));

check('resident_get_current_full_roster: the legacy path preserves resident_code + active = true unchanged and additionally gates on legacy_code_disabled_at', /w\.resident_code = p_code\s*\n\s*AND w\.active = true\s*\n\s*AND NOT EXISTS \(\s*\n\s*SELECT 1 FROM organisation_memberships om\s*\n\s*WHERE om\.workforce_id = w\.id AND om\.legacy_code_disabled_at IS NOT NULL\s*\n\s*\)/.test(fullRosterFn));

check('resident_get_current_full_roster: two-state contract, _resolve_workforce_names resolution, and current_collection_id/published gate are preserved unchanged from migration 73', /'not_published'::text/.test(fullRosterFn) && /'published'::text/.test(fullRosterFn) && /_resolve_workforce_names/.test(fullRosterFn) && /cmr\.status = 'published'/.test(fullRosterFn));

check('resident_get_current_full_roster\'s EXECUTE grant is unchanged (anon, authenticated)', /GRANT EXECUTE ON FUNCTION public\.resident_get_current_full_roster\(uuid, text\) TO anon, authenticated;/.test(sqlNoComments));

// =====================================================================
// resident_get_roster_section_presentation — signature/shape preserved, precedence structural
// =====================================================================

check('resident_get_roster_section_presentation keeps its exact prior signature — (p_workforce_id uuid, p_code text), no DROP FUNCTION', /resident_get_roster_section_presentation\(p_workforce_id uuid, p_code text\)/.test(sqlNoComments) && !/DROP FUNCTION IF EXISTS public\.resident_get_roster_section_presentation/.test(sqlNoComments));

check('resident_get_roster_section_presentation keeps its exact prior RETURNS TABLE shape (section_key/display_label/short_label/display_order/accent_color/icon)', /RETURNS TABLE \(\s*\n\s*section_key text,\s*\n\s*display_label text,\s*\n\s*short_label text,\s*\n\s*display_order integer,\s*\n\s*accent_color text,\s*\n\s*icon text\s*\n\s*\)/.test(sqlNoComments));

check('no PostgREST overload is introduced — resident_get_roster_section_presentation is defined exactly once in this file', (sqlNoComments.match(/CREATE OR REPLACE FUNCTION public\.resident_get_roster_section_presentation\(/g) || []).length === 1);

check('resident_get_roster_section_presentation: the strong path is attempted before the legacy path, structurally', (() => {
  if (!presentationFn) return false;
  const strongIdx = presentationFn.indexOf('auth.uid() IS NOT NULL');
  const legacyIdx = presentationFn.indexOf('w.resident_code = p_code');
  return strongIdx !== -1 && legacyIdx !== -1 && strongIdx < legacyIdx;
})());

check('resident_get_roster_section_presentation: the strong-path IF block never references p_code at all', (() => {
  if (!presentationFn) return false;
  const strongStart = presentationFn.indexOf('IF auth.uid() IS NOT NULL');
  const strongEnd = presentationFn.indexOf('END IF;', strongStart) + 'END IF;'.length;
  const strongBlock = presentationFn.slice(strongStart, strongEnd);
  return strongStart !== -1 && !/p_code/.test(strongBlock);
})());

check('resident_get_roster_section_presentation: the legacy path only runs when the strong path did not authorize', /IF NOT v_authorized THEN/.test(presentationFn));

check('resident_get_roster_section_presentation: the legacy path preserves resident_code + active = true unchanged and additionally gates on legacy_code_disabled_at', /w\.resident_code = p_code\s*\n\s*AND w\.active = true\s*\n\s*AND NOT EXISTS \(\s*\n\s*SELECT 1 FROM organisation_memberships om\s*\n\s*WHERE om\.workforce_id = w\.id AND om\.legacy_code_disabled_at IS NOT NULL\s*\n\s*\)/.test(presentationFn));

check('resident_get_roster_section_presentation: fallback-merge resolution (COALESCE/NULLIF over roster_section_config LEFT JOIN _roster_section_fallbacks) preserved unchanged from migration 74', /_roster_section_fallbacks\(\)/.test(presentationFn) && /LEFT JOIN roster_section_config c/.test(presentationFn) && /COALESCE\(NULLIF\(c\.display_label, ''\), f\.display_label\)/.test(presentationFn));

check('resident_get_roster_section_presentation\'s EXECUTE grant is unchanged (anon, authenticated)', /GRANT EXECUTE ON FUNCTION public\.resident_get_roster_section_presentation\(uuid, text\) TO anon, authenticated;/.test(sqlNoComments));

// =====================================================================
// Blast-radius containment
// =====================================================================

check('this migration never references chief_get_roster_section_config, chief_upsert_roster_section_config, resident_set_email, verify_resident_login, verify_chief_login, resident_get_current_assignment, or any other chief_* RPC in actual SQL', !/chief_get_roster_section_config|chief_upsert_roster_section_config|resident_set_email|verify_resident_login|verify_chief_login|resident_get_current_assignment|chief_\w+/i.test(sqlNoComments));

check('no ALTER TABLE or RLS policy of any kind appears anywhere in this migration', !/ALTER TABLE|CREATE POLICY|ENABLE ROW LEVEL SECURITY/i.test(sqlNoComments));

check('no GRANT/REVOKE of any kind touches organisation_memberships or roster_section_config themselves', !/GRANT[^;]*ON (organisation_memberships|roster_section_config)|REVOKE[^;]*ON (organisation_memberships|roster_section_config)/i.test(sqlNoComments));

check('migration ceiling is now 79 — this is the only new migration file on disk', (() => {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_/.test(f));
  const numbers = files.map((f) => parseInt(f.split('_')[0], 10));
  return Math.max(...numbers) === 79;
})());

check('migrations 73, 74, and 78 themselves are not modified by this task', (() => {
  try {
    const out = execSync('git status --porcelain -- supabase/migrations/73_resident_get_current_full_roster.sql supabase/migrations/74_roster_section_config.sql supabase/migrations/78_resident_get_current_assignment_authenticated_membership.sql', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    return out.trim().length === 0;
  } catch (err) {
    console.warn('git status check skipped:', err.message);
    return true;
  }
})());

check('this migration documents a live verification plan for deployment without performing any live database access itself', /LIVE VERIFICATION PLAN FOR DEPLOYMENT/.test(sql) && /not run in this LOCAL-ONLY slice/.test(sql));

// =====================================================================
// Frontend — minimum client change only, no new credential storage, legacy flow preserved
// =====================================================================

const appTsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
const fullRosterViewTsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'roster-engine', 'components', 'FullRosterView.tsx'), 'utf8');
const myAssignmentViewTsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'roster-engine', 'components', 'MyAssignmentView.tsx'), 'utf8');
const harnessHomeTsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'shared', 'ui', 'IntelligenceHarnessHome.tsx'), 'utf8');
const fullRosterServiceTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'roster-engine', 'lib', 'fullRosterService.ts'), 'utf8');
const presentationServiceTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'roster-engine', 'lib', 'rosterSectionPresentationService.ts'), 'utf8');

check('App.tsx passes hasAuthenticatedSession={!!currentDoctor} to FullRosterView', /<FullRosterView resident=\{currentResident\} accessCode=\{residentAccessCode\} hasAuthenticatedSession=\{!!currentDoctor\} \/>/.test(appTsx));

check('fullRosterService.getCurrentFullRoster accepts code: string | null', /getCurrentFullRoster\(workforceId: string, code: string \| null\)/.test(fullRosterServiceTs));

check('rosterSectionPresentationService.getResidentPresentation accepts code: string | null', /getResidentPresentation\(workforceId: string, code: string \| null\)/.test(presentationServiceTs));

check('FullRosterView attempts an authenticated-first silent load when accessCode is null but hasAuthenticatedSession is true', /else if \(hasAuthenticatedSession\) \{[\s\S]*?load\(null, \{ silent: true \}\);/.test(fullRosterViewTsx));

check('FullRosterView never writes any new persistent credential storage', !/localStorage\.|sessionStorage\./.test(fullRosterViewTsx));

check('MyAssignmentView now calls rosterSectionPresentationService.getResidentPresentation unconditionally (no longer gated on code being truthy) since migration 79 migrates that RPC too', (() => {
  const loadFn = myAssignmentViewTsx.slice(myAssignmentViewTsx.indexOf('const load = useCallback'), myAssignmentViewTsx.indexOf('}, [resident.id]);'));
  return /rosterSectionPresentationService\.getResidentPresentation\(resident\.id, code\)/.test(loadFn) && !/if \(code\) \{/.test(loadFn);
})());

check('IntelligenceHarnessHome now calls rosterSectionPresentationService.getResidentPresentation unconditionally (no longer gated on accessCode being truthy)', (() => {
  const effectBlock = harnessHomeTsx.slice(harnessHomeTsx.indexOf('My Assignment compact summary'), harnessHomeTsx.indexOf('const quickAccess'));
  return /rosterSectionPresentationService\.getResidentPresentation\(resident\.id, accessCode\)/.test(effectBlock) && !/if \(accessCode\) \{\s*\n\s*rosterSectionPresentationService/.test(effectBlock);
})());

check('no new authentication/account system is introduced anywhere in the touched frontend files', !/auth\.signUp|auth\.signInWithPassword|auth\.signIn\(/.test(fullRosterViewTsx));

check('package.json registers a verify:migration-79 script', /"verify:migration-79":\s*"node scripts\/verify-migration-79\.cjs"/.test(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')));

check('this verification is NOT applied — pure source-text/git-status checks only', true);

// =====================================================================

console.log(`\n${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
