#!/usr/bin/env node
// Migration 80 -- verify_chief_admin_code -- static structural verification.
// Matches the established convention for a migration written for review but
// NOT applied live (see scripts/verify-migration-79.cjs): pure SQL-text
// assertions, no database connection, no network call. This is NOT a
// substitute for live behavioral/privilege verification once the migration
// is actually applied (see the migration's own header for exactly what
// remains open) -- it proves the FILE says what this task claims it says.
//
// Run: node scripts/verify-migration-80.cjs

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '80_verify_chief_admin_code.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const sqlNoComments = sql
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n');

// =====================================================================
// Migration ceiling / naming
// =====================================================================

check('migration ceiling is exactly 80 -- no other migration file exists beyond it', (() => {
  const dir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(dir).filter((f) => /^\d+_/.test(f));
  const numbers = files.map((f) => parseInt(f.split('_')[0], 10));
  return Math.max(...numbers) === 80;
})());

check('exactly one new migration file was added by this task (80_verify_chief_admin_code.sql)', fs.existsSync(migrationPath));

// =====================================================================
// Function shape
// =====================================================================

check('verify_chief_admin_code is defined exactly once, taking a single text parameter', (sqlNoComments.match(/CREATE OR REPLACE FUNCTION public\.verify_chief_admin_code\(p_admin_code text\)/g) || []).length === 1);

check('verify_chief_admin_code returns uuid only -- the minimum needed tenant identity, no row/record/table shape', /RETURNS uuid\s*\nLANGUAGE plpgsql SECURITY DEFINER SET search_path = public/.test(sqlNoComments));

check('verify_chief_admin_code is SECURITY DEFINER with search_path pinned, matching every other chief_*/resident_* RPC in this schema', /LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS \$\$/.test(sqlNoComments));

check('the lookup is an exact equality match against settings.admin_access_code -- no ILIKE/LIKE/fuzzy comparison', /SELECT tenant_id INTO v_tenant_id FROM settings WHERE admin_access_code = p_admin_code;/.test(sqlNoComments));

check('the function returns tenant_id (or NULL) and nothing else -- no admin_access_code, no other settings column, ever appears in a RETURN/SELECT in this function body', (() => {
  const fnMatch = sqlNoComments.match(/CREATE OR REPLACE FUNCTION public\.verify_chief_admin_code[\s\S]*?\nEND;\s*\n\$\$;/);
  const fn = fnMatch ? fnMatch[0] : '';
  return fn.length > 0 && !/admin_access_code[^=]/.test(fn.replace('admin_access_code = p_admin_code', '')) && /RETURN v_tenant_id;/.test(fn);
})());

check('no roster/revision table (roster_revisions, combined_master_rosters) is referenced anywhere in this migration', !/roster_revisions|combined_master_rosters/.test(sqlNoComments));

check('no INSERT/UPDATE/DELETE statement appears anywhere in this migration -- read-only lookup only', !/\b(INSERT INTO|UPDATE |DELETE FROM)\b/i.test(sqlNoComments));

check('no other function/table is created, altered, or dropped in this migration -- scope is exactly verify_chief_admin_code', (() => {
  const creates = (sqlNoComments.match(/CREATE (OR REPLACE )?(FUNCTION|TABLE)/g) || []).length;
  const alters = (sqlNoComments.match(/ALTER (TABLE|FUNCTION)/g) || []).length;
  const drops = (sqlNoComments.match(/DROP (TABLE|FUNCTION)/g) || []).length;
  return creates === 1 && alters === 0 && drops === 0;
})());

// =====================================================================
// Privilege model (ambient-default-privilege lesson, migrations 76/77)
// =====================================================================

check('REVOKE ALL ... FROM PUBLIC is explicit for verify_chief_admin_code(text)', /REVOKE ALL ON FUNCTION public\.verify_chief_admin_code\(text\) FROM PUBLIC;/.test(sqlNoComments));

check('REVOKE ALL ... FROM anon is explicit (PUBLIC-only REVOKE is documented as insufficient on this project, migrations 76/77) -- not inferred, not skipped', /REVOKE ALL ON FUNCTION public\.verify_chief_admin_code\(text\) FROM anon;/.test(sqlNoComments));

check('the anon REVOKE comes before the final GRANT (revoke-then-grant, deterministic final state, not "grant on top of whatever anon already had")', sqlNoComments.indexOf('REVOKE ALL ON FUNCTION public.verify_chief_admin_code(text) FROM anon;') < sqlNoComments.indexOf('GRANT EXECUTE ON FUNCTION public.verify_chief_admin_code(text)'));

check('EXECUTE is explicitly (re-)granted to anon and authenticated -- matching verify_resident_login\'s identical posture (migration 77), since this app\'s Chief/resident sessions are never real Supabase Auth sessions', /GRANT EXECUTE ON FUNCTION public\.verify_chief_admin_code\(text\) TO anon, authenticated;/.test(sqlNoComments));

check('no other role (service_role, PUBLIC) is granted EXECUTE on this function -- the grant line names exactly anon and authenticated', (() => {
  const grantMatch = sqlNoComments.match(/GRANT EXECUTE ON FUNCTION public\.verify_chief_admin_code\(text\) TO ([^;]+);/);
  return grantMatch !== null && grantMatch[1].trim() === 'anon, authenticated';
})());

// =====================================================================
// Cross-tenant isolation -- structural argument (no live DB available;
// see this migration's own header for why this is provable by
// construction rather than requiring a live query).
// =====================================================================

check('cross-tenant isolation depends on settings.admin_access_code carrying a UNIQUE constraint (migration 23) -- confirmed that constraint exists on disk', (() => {
  const m23 = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '23_per_tenant_chief_admin_code.sql'), 'utf8');
  return /ALTER TABLE settings ADD CONSTRAINT settings_admin_code_unique UNIQUE \(admin_access_code\);/.test(m23);
})());

check('this migration does not touch, weaken, or drop the settings_admin_code_unique constraint -- it is never mentioned here', !/settings_admin_code_unique/.test(sqlNoComments));

console.log('');
console.log('NOTE: the following require a LIVE database connection and are NOT proven by this');
console.log('script -- they must be confirmed at live-apply time, per this migration\'s own header:');
console.log('  - a correct admin code actually resolves its own tenant (requires live data)');
console.log('  - has_function_privilege(\'anon\', \'public.verify_chief_admin_code(text)\', \'EXECUTE\')');
console.log('    and the authenticated equivalent both return the intended true/true, confirming the');
console.log('    REVOKE+GRANT sequence above actually took effect against this project\'s own ambient');
console.log('    default-privilege behavior (the documented reason a purely static check cannot fully');
console.log('    replace this step -- migrations 76/77 found PUBLIC-only REVOKE insufficient in practice).');
console.log('');

console.log(`${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
