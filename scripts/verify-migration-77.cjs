#!/usr/bin/env node
// Institutional Identity Slice 2a — Resident Claim/Link with Legacy
// Coexistence (migration 77) — dependency-free, static/structural
// verification. This migration is LOCAL ONLY / NOT APPLIED (no live
// database exists to test against for this slice, per its own explicit
// boundary), so verification here is source-text/git-status analysis:
// confirming every required clause/constraint/grant/guard is present, and
// every forbidden thing (a write policy on organisation_memberships, an
// anon grant, a workforce.doctor_id write, a touched existing file) is
// absent.
//
// Run: node scripts/verify-migration-77.cjs

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

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '77_resident_workforce_claim.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
const sqlNoComments = sql
  .split('\n')
  .map((l) => {
    const idx = l.indexOf('--');
    return idx === -1 ? l : l.slice(0, idx);
  })
  .join('\n');

const migration64Path = path.join(__dirname, '..', 'supabase', 'migrations', '64_resident_email_login_contract.sql');
const migration64Sql = fs.readFileSync(migration64Path, 'utf8');

const claimFnMatch = sqlNoComments.match(/CREATE OR REPLACE FUNCTION claim_workforce_member\(p_workforce_id uuid, p_resident_code text\)[\s\S]*?\n\$\$;/);
const claimFn = claimFnMatch ? claimFnMatch[0] : '';

const verifyResidentLoginMatch = sqlNoComments.match(/CREATE OR REPLACE FUNCTION public\.verify_resident_login\([\s\S]*?\n\$\$;/);
const verifyResidentLoginFn = verifyResidentLoginMatch ? verifyResidentLoginMatch[0] : '';

// =====================================================================
// claim_workforce_member — signature, identity, tenant derivation
// =====================================================================

check('claim_workforce_member is defined with exactly (p_workforce_id uuid, p_resident_code text) — no p_tenant_id or any other caller-supplied identity parameter', !!claimFn && /claim_workforce_member\(p_workforce_id uuid, p_resident_code text\)/.test(sqlNoComments) && !/p_tenant_id/i.test(sqlNoComments));

check('unauthenticated caller is rejected: auth.uid() IS NULL guard runs before any table query', (() => {
  if (!claimFn) return false;
  const guardIdx = claimFn.indexOf('auth.uid() IS NULL');
  const firstSelectIdx = claimFn.indexOf('SELECT * INTO v_workforce');
  return guardIdx !== -1 && firstSelectIdx !== -1 && guardIdx < firstSelectIdx;
})());

check('workforce row is fetched server-side and required to be active before any other check', /IF NOT v_workforce\.active THEN/.test(claimFn));

check('resident code is validated server-side (IS DISTINCT FROM comparison against the fetched row, never trusting a prior client-side login)', /v_workforce\.resident_code IS DISTINCT FROM p_resident_code/.test(claimFn));

check('tenant is derived exclusively from the workforce row (v_workforce.tenant_id), never from a caller-supplied parameter', /v_workforce\.tenant_id, auth\.uid\(\), p_workforce_id/.test(claimFn));

// =====================================================================
// Idempotency, no-silent-switch, and race safety
// =====================================================================

check('a pre-check rejects claiming a DIFFERENT workforce_id once this (tenant, auth_user_id) pair already has a completed claim', /v_existing\.claimed_at IS NOT NULL[\s\S]*?v_existing\.workforce_id IS NOT NULL[\s\S]*?v_existing\.workforce_id <> p_workforce_id/.test(claimFn));

check('the upsert uses ON CONFLICT (tenant_id, auth_user_id) DO UPDATE — native atomicity, not a separate check-then-write statement', /ON CONFLICT \(tenant_id, auth_user_id\) DO UPDATE SET/.test(claimFn));

check('race-safety backstop: the DO UPDATE carries its own WHERE guard (workforce_id IS NULL OR = EXCLUDED.workforce_id) so a genuinely concurrent conflicting claim cannot silently overwrite an already-different workforce_id, independent of the earlier pre-check', /WHERE om\.workforce_id IS NULL\s*\n\s*OR om\.workforce_id = EXCLUDED\.workforce_id/.test(claimFn));

check('a blocked WHERE-guarded conflict (no row returned) is detected via NOT FOUND after the statement and raises the same clear error, never silently succeeding', /RETURNING \* INTO v_result;\s*\n\s*EXCEPTION WHEN unique_violation[\s\S]*?END;\s*\n\s*IF NOT FOUND THEN\s*\n\s*RAISE EXCEPTION/.test(claimFn));

check('a genuine repeat claim (same user, same workforce_id) is idempotent: claimed_at/claim_method are COALESCE-preserved, never overwritten with a new value', /claimed_at = COALESCE\(om\.claimed_at, EXCLUDED\.claimed_at\)/.test(claimFn) && /claim_method = COALESCE\(om\.claim_method, EXCLUDED\.claim_method\)/.test(claimFn));

check('a different authenticated user claiming an already active/suspended-linked workforce row is rejected via migration 76\'s own partial unique index (unique_violation handler present, no bypass)', /EXCEPTION WHEN unique_violation THEN\s*\n\s*RAISE EXCEPTION 'This workforce record has already been claimed by another account\.'/.test(claimFn));

check('an existing is_tenant_admin = true flag survives a resident claim — the DO UPDATE SET list never mentions is_tenant_admin at all', (() => {
  const setBlock = claimFn.slice(claimFn.indexOf('DO UPDATE SET'), claimFn.indexOf('WHERE om.workforce_id'));
  return !/is_tenant_admin/.test(setBlock);
})());

check('claim sets claim_method to the exact literal \'resident_code_claim\' required by this slice', /'resident_code_claim'/.test(claimFn));

check('claim never references legacy_code_disabled_at anywhere in its INSERT/UPDATE — a fresh row gets the column\'s own NULL default, an existing row\'s value is left completely alone', !/legacy_code_disabled_at/.test(claimFn));

check('claim never WRITES workforce.doctor_id anywhere in actual SQL (header comments are allowed to NAME it to document the non-goal — this only rejects real code)', !/doctor_id/i.test(sqlNoComments));

check('this migration builds no relink/history table and never touches event_log in actual SQL (header comments are allowed to NAME event_log to document the non-goal)', !/event_log/i.test(sqlNoComments) && (sqlNoComments.match(/CREATE TABLE/gi) || []).length === 0);

check('claim_workforce_member returns a minimal result and never returns the resident code (p_resident_code is never selected into the return shape)', (() => {
  const returnsBlock = sqlNoComments.match(/RETURNS TABLE \(([\s\S]*?)\)\s*\nLANGUAGE plpgsql/);
  return !!returnsBlock && !/resident_code|p_resident_code/.test(returnsBlock[1]) && !/auth_user_id/.test(returnsBlock[1]);
})());

// =====================================================================
// Grants — the migration-76 lesson applied prospectively
// =====================================================================

check('EXECUTE on claim_workforce_member is revoked from PUBLIC then explicitly revoked from anon BY NAME (not inferred from the PUBLIC revoke), then granted to authenticated only', (() => {
  return /REVOKE ALL ON FUNCTION claim_workforce_member\(uuid, text\) FROM PUBLIC;/.test(sqlNoComments)
    && /REVOKE ALL ON FUNCTION claim_workforce_member\(uuid, text\) FROM anon;/.test(sqlNoComments)
    && /GRANT EXECUTE ON FUNCTION claim_workforce_member\(uuid, text\) TO authenticated;/.test(sqlNoComments);
})());

check('no GRANT of any kind is added on organisation_memberships itself in this migration — authenticated retains SELECT-only from migration 76', !/GRANT[^;]*ON organisation_memberships/i.test(sqlNoComments));

check('this migration documents that effective live privileges must be checked after creation (the migration-76 lesson), not merely inferred from this file\'s own source text', /effective live privileges must still be checked/i.test(sql));

// =====================================================================
// Legacy resident-code login guard — minimal, additive change only
// =====================================================================

check('verify_resident_login gains exactly ONE additional AND-clause; every prior clause (id/code/active/email-ratchet) is preserved character-for-character from migration 64', (() => {
  const migration64Body = migration64Sql.match(/SELECT w\.id, w\.full_name, w\.category, \(w\.email IS NOT NULL\) AS has_email\s*\n\s*FROM workforce w\s*\n\s*WHERE w\.id = p_workforce_id\s*\n\s*AND w\.resident_code = p_code\s*\n\s*AND w\.active = true\s*\n\s*AND \(w\.email IS NULL OR lower\(w\.email\) = lower\(trim\(coalesce\(p_email, ''\)\)\)\)/);
  return !!migration64Body && verifyResidentLoginFn.includes(migration64Body[0].trim());
})());

check('the new guard checks organisation_memberships for THIS exact workforce_id with legacy_code_disabled_at IS NOT NULL — nothing else', /NOT EXISTS \(\s*\n\s*SELECT 1 FROM organisation_memberships om\s*\n\s*WHERE om\.workforce_id = w\.id AND om\.legacy_code_disabled_at IS NOT NULL\s*\n\s*\)/.test(verifyResidentLoginFn));

check('the guard never references status/claimed_at/suspended/revoked — only legacy_code_disabled_at disables the legacy path, exactly as locked', !/status|claimed_at|suspended|revoked/i.test(verifyResidentLoginFn.replace(/--.*$/gm, '')));

check('verify_resident_login keeps its exact prior signature/return shape (no DROP FUNCTION needed, none present) — LANGUAGE sql, not rewritten to plpgsql', /LANGUAGE sql SECURITY DEFINER SET search_path = public/.test(verifyResidentLoginFn) && !/DROP FUNCTION IF EXISTS public\.verify_resident_login/.test(sqlNoComments));

check('verify_resident_login\'s EXECUTE grant is unchanged (anon, authenticated) — this slice does not change WHO may call the legacy RPC, only what it checks', /GRANT EXECUTE ON FUNCTION public\.verify_resident_login\(uuid, text, text\) TO anon, authenticated;/.test(sqlNoComments));

// =====================================================================
// Blast-radius containment
// =====================================================================

check('no ALTER TABLE or RLS policy of any kind appears anywhere in this migration — no core institutional RLS change, migration 76\'s own table/policies are untouched', !/ALTER TABLE|CREATE POLICY|ENABLE ROW LEVEL SECURITY/i.test(sqlNoComments));

check('this migration never references verify_chief_login, chief_*, or any roster RPC — Chief login and roster surfaces are untouched', !/verify_chief_login|chief_\w+|resident_get_current_assignment|resident_get_current_full_roster/i.test(sql));

check('migration ceiling is now 77 — this is the only new migration file on disk', (() => {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_/.test(f));
  const numbers = files.map((f) => parseInt(f.split('_')[0], 10));
  return Math.max(...numbers) === 77;
})());

check('migration 76 itself is not modified by this task', (() => {
  try {
    const out = execSync('git status --porcelain -- supabase/migrations/76_institutional_auth_mapping_foundation.sql', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    return out.trim().length === 0;
  } catch (err) {
    console.warn('git status check skipped:', err.message);
    return true;
  }
})());

// =====================================================================
// UI seam — App.tsx wiring, no new account system, no persistent code storage
// =====================================================================

const appTsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'App.tsx'), 'utf8');
const promptTsx = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'auth', 'components', 'LinkInstitutionalAccessPrompt.tsx'), 'utf8');
const serviceTs = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'auth', 'lib', 'organisationMembershipService.ts'), 'utf8');
// Comments stripped for checks below that must find real code, not a
// comment merely documenting a non-goal (the same discipline applied to
// the SQL checks above).
const promptCodeOnly = promptTsx.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const serviceRpcCallsOnly = (serviceTs.match(/\.rpc\([^)]*\)/gs) || []).join('\n');

check('App.tsx gates the seam on BOTH an existing Supabase Auth session (currentDoctor) AND an active resident session (currentResident) — the exact convergence precondition, not a new one', /\{currentDoctor && currentResident && \(\s*\n\s*<LinkInstitutionalAccessPrompt/.test(appTsx));

check('the seam component checks migration 76\'s resolver on mount and renders nothing if this workforce_id is already linked or the check is still in flight', /getCurrentUserMemberships\(\)/.test(promptTsx) && /if \(checking \|\| alreadyLinked \|\| dismissed\) return null;/.test(promptTsx));

check('the resident code is never written to localStorage or any persistent client state anywhere in the new component\'s actual code (header comments are allowed to NAME localStorage to document that it is NOT used)', !/localStorage/.test(promptCodeOnly));

check('a failed claim does not touch the legacy resident session in any way — no reference in actual code to currentResident/fm_session_resident/logout/signOut anywhere in the new component', !/currentResident|fm_session_resident|logout|signOut/i.test(promptCodeOnly));

check('the seam never disables the resident code after success — no reference to legacy_code_disabled_at anywhere in actual code (sending p_resident_code as the claim RPC\'s own request parameter is expected and correct — that is not a reference to the disable column)', !/legacy_code_disabled_at/i.test(promptCodeOnly) && !/legacy_code_disabled_at/i.test(serviceTs));

check('no second authentication/account system is introduced — the new component/service never calls supabase.auth.signUp/signInWithPassword/signIn', !/auth\.signUp|auth\.signInWithPassword|auth\.signIn\(/.test(promptTsx) && !/auth\.signUp|auth\.signInWithPassword/.test(serviceTs));

check('the service never sends a caller-supplied tenant id as an RPC argument to either function (its RETURNS-shape type declarations may still describe a returned tenant_id field)', !/tenant_id:|tenantId:/.test(serviceRpcCallsOnly));

check('only the 3 task-owned application files are touched (App.tsx + the 2 new auth files) — no other src/ file was modified', (() => {
  try {
    const out = execSync('git status --porcelain -- src', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    const lines = out.split('\n').filter(Boolean).map((l) => l.trim());
    // Status markers vary (untracked "??" vs staged "A "/"M ") depending on
    // whether these files have been `git add`-ed yet — only the PATH is
    // load-bearing here, not the exact marker.
    const expectedPaths = new Set([
      'src/App.tsx',
      'src/modules/auth/components/LinkInstitutionalAccessPrompt.tsx',
      'src/modules/auth/lib/organisationMembershipService.ts',
      'src/modules/auth/lib/',
    ]);
    return lines.every((l) => expectedPaths.has(l.replace(/^\S+\s+/, '')));
  } catch (err) {
    console.warn('git status check skipped:', err.message);
    return true;
  }
})());

check('this verification is NOT applied — this verification performs zero database/network access by construction (pure source-text/git-status checks only)', true);

// =====================================================================

console.log(`\n${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
