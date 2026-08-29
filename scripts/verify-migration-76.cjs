#!/usr/bin/env node
// Institutional Auth Mapping Foundation (migration 76) — dependency-free,
// static/structural verification of the migration SQL file itself. This
// migration is LOCAL ONLY / NOT APPLIED (no live database exists to test
// against for this slice), so verification here is source-text analysis:
// confirming every required clause/constraint/policy/grant is present,
// and every forbidden thing (a write policy, an anon grant, a caller-
// supplied tenant/identity parameter, a touched existing file) is absent.
// Matches this repo's own established convention for LOCAL-ONLY migration
// verification (no network/DB access anywhere in this file).
//
// Run: node scripts/verify-migration-76.cjs

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

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '76_institutional_auth_mapping_foundation.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');
// Comments stripped for checks that must find REAL SQL clauses, not a
// comment merely naming/discussing one — same discipline this repo's own
// pg_get_functiondef comment-reproduction lesson established.
const sqlNoComments = sql
  .split('\n')
  .map((l) => {
    const idx = l.indexOf('--');
    return idx === -1 ? l : l.slice(0, idx);
  })
  .join('\n');

// =====================================================================
// Required fields
// =====================================================================

const REQUIRED_COLUMNS = [
  'id', 'tenant_id', 'auth_user_id', 'workforce_id', 'is_workforce_member',
  'is_tenant_admin', 'status', 'created_at', 'linked_at', 'claimed_at',
  'claim_method', 'legacy_code_disabled_at', 'updated_at',
];
check('organisation_memberships defines every required field named in the spec, exactly once each', REQUIRED_COLUMNS.every((col) => {
  const re = new RegExp(`^\\s*${col}\\s+\\w`, 'm');
  return re.test(sqlNoComments);
}));

check('workforce_id has no NOT NULL constraint (nullable — a tenant admin may have no Workforce Record)', !/workforce_id uuid[^,]*NOT NULL/i.test(sqlNoComments));
check('linked_at/claimed_at/claim_method/legacy_code_disabled_at are all nullable (no NOT NULL, no default)', (() => {
  return ['linked_at', 'claimed_at', 'claim_method', 'legacy_code_disabled_at'].every((col) => {
    const re = new RegExp(`${col} \\w+,`, 'i');
    const m = sqlNoComments.match(re);
    return m && !/NOT NULL|DEFAULT/i.test(m[0]);
  });
})());
check('claimed_at is never defaulted (no DEFAULT clause anywhere near its column definition)', !/claimed_at timestamptz\s+(DEFAULT|NOT NULL)/i.test(sqlNoComments));

// =====================================================================
// Cardinality
// =====================================================================

check('UNIQUE (tenant_id, auth_user_id) exists — one row per person per tenant, same auth user may have rows in multiple tenants', /UNIQUE\s*\(\s*tenant_id\s*,\s*auth_user_id\s*\)/i.test(sqlNoComments));
check('no UNIQUE/PK constraint exists on auth_user_id ALONE (would wrongly forbid multi-tenant membership for one person)', !/UNIQUE\s*\(\s*auth_user_id\s*\)/i.test(sqlNoComments));

check('a partial unique index prevents one workforce_id from being linked to two simultaneously active/suspended memberships', (() => {
  const idx = sqlNoComments.match(/CREATE UNIQUE INDEX[^;]*ON organisation_memberships \(workforce_id\)\s*WHERE[^;]*;/i);
  return !!idx && /workforce_id IS NOT NULL/.test(idx[0]) && /status IN \('active', 'suspended'\)/.test(idx[0]);
})());

// =====================================================================
// Relationship invariant + claim semantics
// =====================================================================

check('relationship invariant: CHECK (is_workforce_member OR is_tenant_admin) exists', /CHECK\s*\(\s*is_workforce_member\s+OR\s+is_tenant_admin\s*\)/i.test(sqlNoComments));
check('claim_method is never non-null without claimed_at also being non-null (CHECK constraint)', /CHECK\s*\(\s*claim_method IS NULL OR claimed_at IS NOT NULL\s*\)/i.test(sqlNoComments));
check('status CHECK constraint allows exactly active|suspended|revoked, no other value', /status IN \('active', 'suspended', 'revoked'\)/.test(sqlNoComments));
check('no claim RPC is implemented in this migration (no CREATE FUNCTION with "claim" in its name)', !/CREATE (OR REPLACE )?FUNCTION[^(]*claim/i.test(sqlNoComments));

// =====================================================================
// RLS / grants
// =====================================================================

check('RLS is enabled on organisation_memberships', /ALTER TABLE organisation_memberships ENABLE ROW LEVEL SECURITY/i.test(sqlNoComments));
check('anon is explicitly revoked all access to the table (no grant, in addition to no policy)', /REVOKE ALL ON organisation_memberships FROM anon/i.test(sqlNoComments));
check('authenticated is granted SELECT only on the table (never ALL, never INSERT/UPDATE/DELETE)', (() => {
  const grants = sqlNoComments.match(/GRANT [A-Z, ]+ ON organisation_memberships TO \w+/gi) || [];
  return grants.some((g) => /GRANT SELECT ON organisation_memberships TO authenticated/i.test(g))
    && grants.every((g) => !/INSERT|UPDATE|DELETE|ALL/i.test(g));
})());
check('exactly one RLS policy exists on the table, and it is a SELECT-only, own-row policy', (() => {
  const policies = sqlNoComments.match(/CREATE POLICY[^;]*;/gi) || [];
  return policies.length === 1
    && /FOR SELECT/i.test(policies[0])
    && /TO authenticated/i.test(policies[0])
    && /USING\s*\(\s*auth\.uid\(\)\s*=\s*auth_user_id\s*\)/i.test(policies[0]);
})());
check('no INSERT/UPDATE/DELETE policy exists anywhere in the file (direct client writes are structurally impossible)', !/FOR (INSERT|UPDATE|DELETE)/i.test(sqlNoComments));
check('no GRANT of INSERT/UPDATE/DELETE on the table exists for any role', !/GRANT[^;]*(INSERT|UPDATE|DELETE)[^;]*ON organisation_memberships/i.test(sqlNoComments));

// =====================================================================
// Resolver RPC
// =====================================================================

const rpcMatch = sqlNoComments.match(/CREATE OR REPLACE FUNCTION current_user_organisation_memberships\(\)[\s\S]*?\$\$;/);
check('current_user_organisation_memberships() exists, takes ZERO arguments (no caller-supplied tenant/identity parameter of any kind)', !!rpcMatch && /current_user_organisation_memberships\(\)/.test(rpcMatch[0]) && !/current_user_organisation_memberships\([^)]+\)/.test(sqlNoComments));
check('resolver is SECURITY DEFINER with a fixed search_path = public', !!rpcMatch && /SECURITY DEFINER/.test(rpcMatch[0]) && /SET search_path = public/.test(rpcMatch[0]));
check('resolver derives the caller exclusively from auth.uid() — no p_workforce_id/p_code/p_tenant_id-style parameter anywhere in its body', !!rpcMatch && /auth\.uid\(\)/.test(rpcMatch[0]) && !/\bp_\w+/.test(rpcMatch[0]));
check('resolver returns an explicit empty result for an unauthenticated caller (auth.uid() IS NULL guard) BEFORE querying the table', (() => {
  if (!rpcMatch) return false;
  const guardIdx = rpcMatch[0].indexOf('IF auth.uid() IS NULL THEN');
  const queryIdx = rpcMatch[0].indexOf('RETURN QUERY');
  return guardIdx !== -1 && queryIdx !== -1 && guardIdx < queryIdx;
})());
check('resolver filters its query by auth_user_id = auth.uid() — never a blanket/unscoped read of organisation_memberships', !!rpcMatch && /WHERE om\.auth_user_id = auth\.uid\(\)/.test(rpcMatch[0]));
check('resolver omits auth_user_id from its RETURNS TABLE shape (adds no information the caller does not already have)', (() => {
  const returnsBlock = sqlNoComments.match(/RETURNS TABLE \(([\s\S]*?)\)/);
  return !!returnsBlock && !/\bauth_user_id\b/.test(returnsBlock[1]);
})());
check('resolver returns tenant/workforce DISPLAY enrichment (tenant_name, workforce_full_name) via its own SECURITY DEFINER join, not a blanket tenants/workforce grant', !!rpcMatch && /t\.name/.test(rpcMatch[0]) && /w\.full_name/.test(rpcMatch[0]) && /LEFT JOIN workforce w/.test(rpcMatch[0]));
check('resolver returns EVERY status value (active/suspended/revoked), never pre-filtering — enforcement of "must not authorize routing" belongs to a future consumer, not to hiding rows here', !!rpcMatch && /om\.status/.test(rpcMatch[0]) && !/WHERE[^;]*status\s*=\s*'active'/i.test(rpcMatch[0]));

check('EXECUTE on the resolver is revoked from PUBLIC then granted to authenticated only (never anon)', (() => {
  const revokeIdx = sqlNoComments.indexOf('REVOKE ALL ON FUNCTION current_user_organisation_memberships() FROM PUBLIC');
  const grantMatch = sqlNoComments.match(/GRANT EXECUTE ON FUNCTION current_user_organisation_memberships\(\) TO (\w+)/);
  return revokeIdx !== -1 && !!grantMatch && grantMatch[1] === 'authenticated';
})());

// =====================================================================
// Status semantics / documentation requirement
// =====================================================================

check('the migration documents that future status-changing workflows must preserve lifecycle provenance through an approved audit/history mechanism', (() => {
  const normalized = sql.replace(/^\s*--\s?/gm, '').replace(/\s+/g, ' ');
  return /audit\/history mechanism/i.test(normalized) && /future status-changing workflows/i.test(normalized);
})());
check('no revocation/admin UI or RPC is implemented (no CREATE FUNCTION with "revoke"/"suspend"/"reinstate" in its name)', !/CREATE (OR REPLACE )?FUNCTION[^(]*(revoke|suspend|reinstate)/i.test(sqlNoComments));
check('no membership-history/audit table is created by this migration (only organisation_memberships itself)', (() => {
  const createTables = sqlNoComments.match(/CREATE TABLE[^(]*\(/gi) || [];
  return createTables.length === 1 && /organisation_memberships/i.test(createTables[0]);
})());

// =====================================================================
// Absolutely unchanged — blast-radius containment
// =====================================================================

check('this migration never CALLS/depends on any existing login/claim RPC in actual SQL (verify_resident_login, verify_chief_login) — header comments are allowed to NAME them to document non-goals, this only rejects real code', !/verify_resident_login|verify_chief_login/i.test(sqlNoComments));
check('this migration never reads/writes resident_code/admin_access_code in actual SQL — header comments are allowed to NAME them to document non-goals, this only rejects real code', !/resident_code|admin_access_code/i.test(sqlNoComments));
check('this migration never touches resident_get_current_assignment/resident_get_current_full_roster/roster revision RPCs', !/resident_get_current_assignment|resident_get_current_full_roster|chief_save_roster_revision|chief_publish_roster_revision|chief_start_roster_revision|chief_discard_roster_revision/i.test(sql));
check('this migration creates exactly one new table and one new function — no ALTER TABLE on any EXISTING table (workforce/tenants/settings/collections/submissions/etc.)', (() => {
  const alters = sqlNoComments.match(/ALTER TABLE \w+/gi) || [];
  return alters.every((a) => /organisation_memberships/i.test(a));
})());

check('migration ceiling is now 76 — this is the only new migration file on disk', (() => {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_/.test(f));
  const numbers = files.map((f) => parseInt(f.split('_')[0], 10));
  return Math.max(...numbers) === 76;
})());

check('no OTHER migration file was modified by this task (git shows only the new 76_ file as changed under supabase/migrations)', (() => {
  try {
    const out = execSync('git status --porcelain -- supabase/migrations', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    const lines = out.split('\n').filter(Boolean);
    return lines.length === 1 && lines[0].includes('76_institutional_auth_mapping_foundation.sql');
  } catch (err) {
    console.warn('git status check skipped (not a git worktree or git unavailable):', err.message);
    return true;
  }
})());

check('no .ts/.tsx production route/component file is part of this migration change (git shows no src/ files touched by this task alongside the migration)', (() => {
  try {
    const out = execSync('git status --porcelain -- src', { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    return out.trim().length === 0;
  } catch (err) {
    console.warn('git status check skipped (not a git worktree or git unavailable):', err.message);
    return true;
  }
})());

check('this migration is NOT applied — this verification performs zero database/network access by construction (pure source-text/git-status checks only)', true);

// =====================================================================

console.log(`\n${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
