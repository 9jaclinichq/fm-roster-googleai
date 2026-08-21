#!/usr/bin/env node
// Priority-0 Tenant Surface — reusable security verification harness (P0-6).
//
// Dependency-free by design: no Vitest/Jest/Playwright, no new npm
// packages. Uses Node core (fs/path/child_process) and the
// already-installed @supabase/supabase-js only.
//
// THREE CATEGORIES, THREE DIFFERENT SAFETY LEVELS:
//
//   STATIC (default, no flags)      - pure text/regex inspection of
//                                      migration and source files already
//                                      on disk. No network call is ever
//                                      made in this mode. Safe anywhere,
//                                      including CI.
//
//   --remote-read                   - additionally invokes
//                                      list_public_tenants() live. This is
//                                      the ONE RPC this harness will ever
//                                      call over the network: it is
//                                      intentionally public (migration 58),
//                                      requires no auth, and calling it
//                                      isn't "testing authorization" since
//                                      there is none to bypass. chief_*/
//                                      platform_operator_* RPCs are NEVER
//                                      invoked by this script, live or
//                                      otherwise. Requires SUPABASE_URL/
//                                      SUPABASE_ANON_KEY already present in
//                                      the process environment - this
//                                      script does not read .env itself
//                                      (no dotenv, no manual file parse).
//                                      Skips gracefully, not a failure, if
//                                      those vars are absent.
//
//   --local-mutation                - anonymous INSERT/UPDATE negative
//                                      tests against `tenants`. P0-7C
//                                      (migration 63) dropped the
//                                      permissive tenants_insert/
//                                      tenants_update policies, so a
//                                      successful anonymous write is now a
//                                      hard FAIL, not an informational
//                                      baseline — this only means anything
//                                      once migration 63 is actually
//                                      applied to whatever instance this
//                                      is pointed at. Requires
//                                      TENANT_SURFACE_ALLOW_LOCAL_MUTATION=1
//                                      plus TENANT_SURFACE_LOCAL_SUPABASE_URL/
//                                      _ANON_KEY (harness-specific env var
//                                      names, never reused from the app's
//                                      own VITE_SUPABASE_URL). Hard-refuses,
//                                      before any network call, if the
//                                      target URL contains the known
//                                      production project ref or matches
//                                      VITE_SUPABASE_URL if that is also
//                                      set in the environment.
//
// Run manually:
//   node scripts/verify-tenant-surface.cjs
//   node scripts/verify-tenant-surface.cjs --remote-read
//   node scripts/verify-tenant-surface.cjs --local-mutation

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const PRODUCTION_PROJECT_REF = 'gdumksfffewpdqqwvcdo';
// The always-present seeded tenant row (migration 11's fixed-id INSERT) —
// used only as a stable UPDATE target for the --local-mutation probe
// below, on whatever instance TENANT_SURFACE_LOCAL_SUPABASE_URL points
// at. Never referenced by any static/remote-read check.
const SEEDED_TENANT_ID = '00000000-0000-0000-0000-000000000001';

const args = process.argv.slice(2);
const runRemoteRead = args.includes('--remote-read');
const runLocalMutation = args.includes('--local-mutation');

let failures = 0;
let skipped = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

function pass(message) {
  console.log(`OK:   ${message}`);
}

function info(message) {
  console.log(`INFO: ${message}`);
}

function skip(message) {
  console.log(`SKIP: ${message}`);
  skipped += 1;
}

function readFile(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    fail(`${relPath} does not exist`);
    return null;
  }
  return fs.readFileSync(abs, 'utf8');
}

// Recursively lists .ts/.tsx files under a src-relative dir, skipping
// node_modules/dist — no glob dependency needed for this narrow use.
function listSourceFiles(relDir) {
  const abs = path.join(REPO_ROOT, relDir);
  const results = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(abs);
  return results;
}

// Lists migration files numbered strictly after `afterNumber`, sorted
// numerically by their leading number (not lexically — "9" must sort
// before "10"). Non-numbered files in supabase/migrations/ are ignored.
function listMigrationFilesAfter(afterNumber) {
  const dir = path.join(REPO_ROOT, 'supabase/migrations');
  return fs.readdirSync(dir)
    .map(name => {
      const match = name.match(/^(\d+)_/);
      return match ? { name, num: parseInt(match[1], 10) } : null;
    })
    .filter(entry => entry && entry.num > afterNumber)
    .sort((a, b) => a.num - b.num)
    .map(entry => `supabase/migrations/${entry.name}`);
}

// ============================================================
// STATIC CHECKS — no network, run unconditionally
// ============================================================

function checkPublicDiscoveryProjection() {
  const sql = readFile('supabase/migrations/58_list_public_tenants_rpc.sql');
  if (sql === null) return;

  const match = sql.match(/CREATE OR REPLACE FUNCTION public\.list_public_tenants\(\)\s*RETURNS TABLE \(([\s\S]*?)\)\s*LANGUAGE/);
  if (!match) {
    fail('list_public_tenants() RETURNS TABLE block not found in migration 58');
    return;
  }
  const columnBlock = match[1];
  const columns = columnBlock
    .split(',')
    .map(c => c.trim().split(/\s+/)[0])
    .filter(Boolean);

  const approved = ['id', 'name', 'institution', 'department'];
  const excluded = ['plan_type', 'status', 'short_code', 'module_flags', 'terminology_overrides', 'paystack_subaccount_code', 'created_at'];

  const missing = approved.filter(c => !columns.includes(c));
  const extra = columns.filter(c => !approved.includes(c));
  const leaked = excluded.filter(c => columns.includes(c));

  if (missing.length === 0 && extra.length === 0) {
    pass(`list_public_tenants() projection is exactly [${approved.join(', ')}]`);
  } else {
    fail(`list_public_tenants() projection is [${columns.join(', ')}], expected exactly [${approved.join(', ')}]`);
  }
  if (leaked.length > 0) {
    fail(`list_public_tenants() leaks excluded field(s): ${leaked.join(', ')}`);
  } else {
    pass('list_public_tenants() exposes none of the excluded private fields');
  }
}

function checkChiefRpcsHaveNoTenantId() {
  const files = [
    'supabase/migrations/59_chief_tenant_config_rpcs.sql',
    'supabase/migrations/61_chief_platform_operator_tenant_reads.sql',
  ];
  const chiefFns = ['chief_get_tenant', 'chief_update_tenant_terminology', 'chief_update_tenant_module_flags'];
  const combined = files.map(f => readFile(f)).filter(Boolean).join('\n');
  if (!combined) return;

  for (const fnName of chiefFns) {
    const re = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fnName}\\(([^)]*)\\)`);
    const match = combined.match(re);
    if (!match) {
      fail(`${fnName}() definition not found`);
      continue;
    }
    const params = match[1];
    if (/tenant_id/i.test(params)) {
      fail(`${fnName}() signature contains a tenant_id parameter: (${params.trim()})`);
    } else {
      pass(`${fnName}() accepts no tenant_id parameter: (${params.trim()})`);
    }
  }
}

function checkOperatorRpcsSelfVerify() {
  const files = [
    'supabase/migrations/60_platform_operator_tenant_rpcs.sql',
    'supabase/migrations/61_chief_platform_operator_tenant_reads.sql',
  ];
  const combined = files.map(f => readFile(f)).filter(Boolean).join('\n');
  if (!combined) return;

  const definitions = combined.match(/CREATE OR REPLACE FUNCTION public\.platform_operator_\w+/g) || [];
  const checks = combined.match(/platform_operators\s+\w+\s+WHERE\s+\w+\.shared_code\s*=\s*p_operator_code/g) || [];

  if (definitions.length === 0) {
    fail('No platform_operator_* RPC definitions found');
    return;
  }
  if (definitions.length === checks.length) {
    pass(`All ${definitions.length} platform_operator_* RPCs independently verify shared_code (${definitions.length} definitions, ${checks.length} inline checks)`);
  } else {
    fail(`platform_operator_* RPC count (${definitions.length}) does not match inline operator-code check count (${checks.length}) — at least one RPC may be relying on prior login state instead of self-verifying`);
  }
}

function checkNoActiveConsumersOfUnsafeMethods() {
  const unsafeMethods = [
    'createTenant',
    'updateTenantPlan',
    'updateTenantStatus',
    'updateTenantTerminology',
    'updateTenantModuleFlags',
    'getTenants',
    'getPlatformAnalyticsSummary',
    'getTenantUsageBreakdown',
  ];
  // getTenant() is deliberately excluded — P0-5 established it remains a
  // genuine, approved consumer of CasebookBuilderView.tsx/terminology.tsx
  // pending institutional Auth. Flagging it here would be a false positive.

  const files = listSourceFiles('src').filter(f => path.basename(f) !== 'databaseService.ts');

  for (const method of unsafeMethods) {
    const re = new RegExp(`databaseService\\.${method}\\(`);
    const hits = [];
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (re.test(content)) {
        hits.push(path.relative(REPO_ROOT, file));
      }
    }
    if (hits.length === 0) {
      pass(`databaseService.${method}() has no active consumers outside databaseService.ts`);
    } else {
      fail(`databaseService.${method}() is still called from: ${hits.join(', ')}`);
    }
  }
}

function checkNoPermissivePolicyReintroduced() {
  // P0-7D: mechanical enforcement of P0-7C's (migration 63) own removal —
  // fails if any migration numbered after 63 re-creates a permissive
  // INSERT/UPDATE/ALL policy on tenants (USING(true) or WITH CHECK(true)),
  // under any policy name. Deliberately does not care about the policy's
  // name — a future migration reintroducing the same exposure under a
  // different name would defeat a name-only check.
  const files = listMigrationFilesAfter(63);
  if (files.length === 0) {
    pass('No migrations exist after migration 63 yet — no permissive tenants INSERT/UPDATE policy has been reintroduced');
    return;
  }

  const policyStatementRe = /CREATE\s+(?:OR\s+REPLACE\s+)?POLICY\s+"[^"]*"\s+ON\s+tenants\s+FOR\s+(?:INSERT|UPDATE|ALL)\b[^;]*;/gi;
  const permissiveConditionRe = /(?:USING|WITH\s+CHECK)\s*\(\s*true\s*\)/i;

  const found = [];
  for (const relPath of files) {
    const sql = readFile(relPath);
    if (sql === null) continue;
    const matches = sql.match(policyStatementRe) || [];
    for (const statement of matches) {
      if (permissiveConditionRe.test(statement)) {
        found.push({ file: relPath, statement: statement.trim() });
      }
    }
  }

  if (found.length === 0) {
    pass(`No permissive tenants INSERT/UPDATE policy has been reintroduced in any migration after 63 (${files.length} later migration file(s) checked)`);
  } else {
    for (const hit of found) {
      fail(`Permissive tenants INSERT/UPDATE policy reintroduced in ${hit.file}: ${hit.statement}`);
    }
  }
}

// Extracts a single top-level method's source text from databaseService.ts
// by scanning line-by-line from its declaration to the first line that is
// exactly the method-closing `  },` at this file's consistent 2-space
// top-level indent — mirrors this file's own established convention
// (every method in databaseService.ts closes this way), so this is not a
// brace-counting/AST parse, just a boundary match on that convention. If
// the method is ever renamed, removed, or its closing convention changes,
// this returns null and the caller treats that as a hard failure rather
// than silently skipping the check.
function extractMethodBody(fileContent, methodName) {
  const lines = fileContent.split('\n');
  const startPattern = new RegExp(`\\basync ${methodName}\\(`);
  const startIndex = lines.findIndex(line => startPattern.test(line));
  if (startIndex === -1) return null;

  for (let i = startIndex + 1; i < lines.length; i++) {
    if (lines[i].replace(/\r$/, '') === '  },') {
      return lines.slice(startIndex, i + 1).join('\n');
    }
  }
  return null;
}

function checkProvisionTenantWithSubaccountHasNoDirectWrite() {
  // P0-7A (migration 62) removed the last unverified direct tenants write
  // — provisionTenantWithSubaccount() now creates its tenant row via the
  // capability-checked platformOperatorCreateTenant() RPC path instead of
  // a raw `.from('tenants').insert()`. This is the mechanical enforcement
  // of that invariant: re-extracts the method's current body from disk on
  // every run, so a future edit that reintroduces ANY direct `.from(
  // 'tenants')` access inside this specific method — INSERT, UPDATE, or
  // otherwise — fails this check, regardless of what else in the file
  // changes around it.
  const content = readFile('src/lib/databaseService.ts');
  if (content === null) return;

  const body = extractMethodBody(content, 'provisionTenantWithSubaccount');
  if (body === null) {
    fail('databaseService.provisionTenantWithSubaccount() not found — cannot verify it has no direct tenants write (method renamed/removed/restructured?)');
    return;
  }

  if (/\.from\(\s*['"]tenants['"]\s*\)/.test(body)) {
    fail('databaseService.provisionTenantWithSubaccount() contains a direct .from(\'tenants\') access — P0-7A\'s invariant requires all tenant writes here to go through platformOperatorCreateTenant() instead');
  } else {
    pass('databaseService.provisionTenantWithSubaccount() contains no direct .from(\'tenants\') access (INSERT/UPDATE/SELECT)');
  }
}

function checkGetTenantProjectionAllowlist() {
  // Tenant Client-Surface Minimization / defense-in-depth slice:
  // databaseService.getTenant() must request only the exact column
  // allow-list its two real consumers (CasebookBuilderView.tsx,
  // terminology.tsx) read — id, terminology_overrides, module_flags —
  // never select('*') and never a field outside this allow-list, so a
  // future edit can't silently re-expand what this one helper requests/
  // re-exposes. This asserts the APPROVED allow-list rather than merely
  // blacklisting today's known-sensitive fields (paystack_subaccount_code/
  // plan_type/status/short_code), so a future column added to `tenants`
  // cannot silently become exposed through this helper either.
  //
  // NOTE: this is application-layer defense-in-depth only. tenants_select
  // RLS remains USING(true) and the table's default table-level GRANT to
  // anon/authenticated has never been narrowed to a column allow-list
  // (unlike workforce/settings — see migration 02) — so this check says
  // nothing about, and does not close, that database-level exposure.
  const content = readFile('src/lib/databaseService.ts');
  if (content === null) return;

  const body = extractMethodBody(content, 'getTenant');
  if (body === null) {
    fail('databaseService.getTenant() not found — cannot verify its projection allow-list (method renamed/removed/restructured?)');
    return;
  }

  if (/\.select\(\s*['"]\*['"]\s*\)/.test(body)) {
    fail("databaseService.getTenant() requests select('*') — must request only the approved column allow-list");
    return;
  }

  const selectMatch = body.match(/\.select\(\s*['"]([^'"]*)['"]\s*\)/);
  if (!selectMatch) {
    fail("databaseService.getTenant() has no recognizable .select('...') call — cannot verify its projection allow-list");
    return;
  }

  const columns = selectMatch[1].split(',').map(c => c.trim()).filter(Boolean);
  const APPROVED = ['id', 'terminology_overrides', 'module_flags'];

  const missing = APPROVED.filter(c => !columns.includes(c));
  const extra = columns.filter(c => !APPROVED.includes(c));

  if (missing.length === 0 && extra.length === 0) {
    pass(`databaseService.getTenant() projection is exactly [${APPROVED.join(', ')}]`);
  } else {
    if (extra.length > 0) {
      fail(`databaseService.getTenant() projection includes unapproved field(s): ${extra.join(', ')} — narrow it back to the approved allow-list [${APPROVED.join(', ')}], or add a new field here only after confirming it is genuinely required by a current consumer`);
    }
    if (missing.length > 0) {
      fail(`databaseService.getTenant() projection is missing approved field(s): ${missing.join(', ')}`);
    }
  }
}

function checkCliToolingHealth() {
  // Optional, non-blocking: confirms the pinned repo-local CLI (tooling
  // slice, docs/DATABASE_AND_SECURITY.md) is at least invocable. Does not
  // fail the harness if the CLI is unavailable — this environment has
  // known CLI flakiness, and CLI availability is not itself a tenant-
  // surface security property.
  try {
    // shell: true so this resolves npx.cmd on Windows (execFileSync does
    // not apply PATHEXT resolution to shims on its own).
    const version = execFileSync('npx supabase --version', { cwd: REPO_ROOT, encoding: 'utf8', timeout: 15000, shell: true }).trim();
    info(`Repo-local Supabase CLI reports version ${version}`);
  } catch (err) {
    info(`Repo-local Supabase CLI unavailable/unresponsive (non-blocking): ${err.message.split('\n')[0]}`);
  }
}

// ============================================================
// REMOTE READ-ONLY — opt-in via --remote-read
// ============================================================

async function checkPublicDiscoveryLiveShape() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    skip('remote-read: SUPABASE_URL/SUPABASE_ANON_KEY not set in environment — not reading .env to obtain them');
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(url, anonKey);
  const { data, error } = await client.rpc('list_public_tenants');
  if (error) {
    fail(`remote-read: list_public_tenants() call failed: ${error.message}`);
    return;
  }

  const approved = ['id', 'name', 'institution', 'department'];
  const excluded = ['plan_type', 'status', 'short_code', 'module_flags', 'terminology_overrides', 'paystack_subaccount_code', 'created_at'];
  const rows = data || [];
  let bad = false;
  for (const row of rows) {
    const keys = Object.keys(row);
    const unexpected = keys.filter(k => !approved.includes(k));
    if (unexpected.length > 0) {
      fail(`remote-read: list_public_tenants() row has unexpected key(s): ${unexpected.join(', ')}`);
      bad = true;
    }
    const leaked = excluded.filter(k => keys.includes(k));
    if (leaked.length > 0) {
      fail(`remote-read: list_public_tenants() row leaks excluded field(s): ${leaked.join(', ')}`);
      bad = true;
    }
  }
  if (!bad) {
    pass(`remote-read: list_public_tenants() returned ${rows.length} row(s), all matching the approved projection exactly`);
  }
}

// ============================================================
// LOCAL/TEST MUTATION-NEGATIVE — opt-in via --local-mutation
// ============================================================

async function checkAnonymousMutationRejected() {
  if (process.env.TENANT_SURFACE_ALLOW_LOCAL_MUTATION !== '1') {
    fail('local-mutation: refused — TENANT_SURFACE_ALLOW_LOCAL_MUTATION=1 not set. This is a deliberate hard requirement, not a default-on test.');
    return;
  }
  const url = process.env.TENANT_SURFACE_LOCAL_SUPABASE_URL;
  const anonKey = process.env.TENANT_SURFACE_LOCAL_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    fail('local-mutation: refused — TENANT_SURFACE_LOCAL_SUPABASE_URL/_ANON_KEY not set. These are harness-specific vars, deliberately not the app\'s own VITE_SUPABASE_URL.');
    return;
  }
  if (url.includes(PRODUCTION_PROJECT_REF) || (process.env.VITE_SUPABASE_URL && url === process.env.VITE_SUPABASE_URL)) {
    fail(`local-mutation: refused — target URL appears to be the production project (${PRODUCTION_PROJECT_REF}). Local mutation tests must never target production.`);
    return;
  }

  const { createClient } = require('@supabase/supabase-js');
  const client = createClient(url, anonKey);
  const probeShortCode = `zzz_p0_6_harness_probe_${Date.now()}`;

  const insertResult = await client.from('tenants').insert([{ name: 'P0-6 harness probe (disposable)', short_code: probeShortCode }]).select().maybeSingle();
  if (insertResult.error) {
    pass('local-mutation: anonymous INSERT into tenants is rejected');
  } else {
    // P0-7D (post migration 63): a successful anonymous INSERT is now a
    // real regression, not an expected pre-lockdown baseline — hard FAIL.
    // Cleanup of the disposable row this probe just created still runs
    // regardless, so a failing regression run doesn't also leave garbage
    // data behind in whatever instance this was pointed at.
    fail('local-mutation: anonymous INSERT into tenants succeeded — expected rejection after migration 63 (permissive tenants_insert policy may have been reintroduced or migration 63 is not applied to this target)');
    if (insertResult.data && insertResult.data.id) {
      await client.from('tenants').delete().eq('id', insertResult.data.id);
    }
  }

  // UPDATE probe deliberately targets the always-present seeded tenant row
  // (SEEDED_TENANT_ID, migration 11), NOT the row the INSERT probe above
  // may or may not have created. Targeting the INSERT probe's own row
  // would make this check meaningless whenever INSERT is correctly
  // rejected: an UPDATE matching zero rows returns no error regardless of
  // RLS, so a working lockdown would have produced a false FAIL here.
  // .select().single() forces an explicit error when the update matches
  // no visible rows (RLS-denied looks identical to "no such row" from the
  // client's perspective, which is exactly the rejection this is testing
  // for), decoupling this check entirely from the INSERT probe's outcome.
  // Read the seeded row's current name first (SELECT remains permissive —
  // unaffected by this lockdown) so a regression can be cleanly restored.
  const { data: seededTenant } = await client.from('tenants').select('name').eq('id', SEEDED_TENANT_ID).maybeSingle();
  const originalSeededTenantName = seededTenant?.name ?? null;

  const probeName = `P0-6 harness probe (should be rejected) ${Date.now()}`;
  const updateResult = await client.from('tenants').update({ name: probeName }).eq('id', SEEDED_TENANT_ID).select().single();
  if (updateResult.error) {
    pass('local-mutation: anonymous UPDATE into tenants is rejected');
  } else {
    // Regression: this actually renamed the seeded tenant row on whatever
    // instance this is pointed at (local/test only, per the guards above).
    // Restore its original name — the same permission state that allowed
    // this update to succeed also allows the restore, so this is safe
    // best-effort cleanup, not a second independent write dependency.
    fail('local-mutation: anonymous UPDATE into tenants succeeded — expected rejection after migration 63 (permissive tenants_update policy may have been reintroduced or migration 63 is not applied to this target)');
    if (originalSeededTenantName !== null) {
      await client.from('tenants').update({ name: originalSeededTenantName }).eq('id', SEEDED_TENANT_ID);
    }
  }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
  info('Static checks (no network):');
  checkPublicDiscoveryProjection();
  checkChiefRpcsHaveNoTenantId();
  checkOperatorRpcsSelfVerify();
  checkNoActiveConsumersOfUnsafeMethods();
  checkProvisionTenantWithSubaccountHasNoDirectWrite();
  checkGetTenantProjectionAllowlist();
  checkNoPermissivePolicyReintroduced();
  checkCliToolingHealth();

  if (runRemoteRead) {
    info('Remote read-only checks (--remote-read):');
    await checkPublicDiscoveryLiveShape();
  } else {
    skip('remote-read checks not requested (pass --remote-read to include list_public_tenants() live-shape verification)');
  }

  if (runLocalMutation) {
    info('Local/test mutation-negative checks (--local-mutation):');
    await checkAnonymousMutationRejected();
  } else {
    skip('local-mutation checks not requested (pass --local-mutation to include anonymous INSERT/UPDATE rejection tests against a local/test instance)');
  }

  console.log('');
  console.log(`${failures} failure(s), ${skipped} skipped.`);
  process.exit(failures > 0 ? 1 : 0);
}

main();
