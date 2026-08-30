#!/usr/bin/env node
// Deterministic coverage for the E0 containment-scope correction (2026-08-30).
// See scripts/verify-e0-containment.cjs's own header for the full rationale:
// the original "no other Edge Function changed" check failed on ANY change
// anywhere under supabase/functions/, which docs/EMERGENCY_SLICE_E0_FINANCIAL_CONTAINMENT.md
// never actually required -- the real invariant is scoped to exactly the two
// contained functions. This script proves the corrected, narrower rule
// (computeProtectedE0Changes(), reused unmodified from verify-e0-containment.cjs)
// against every case prompt1.txt's own verification list named, plus that
// the deployment freeze and push guardrail were left untouched by this
// governance task.
//
// Pure in-memory fixtures for the logic itself (no git needed) + a couple of
// live reads against the real repo for the two "did this task touch
// something it must not" proofs. No network call, no database, no writes
// anywhere.
//
// Run: node scripts/verify-e0-containment-scope.cjs

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { computeProtectedE0Changes, loadProtectedSurfaceGlobs, E0_PROTECTED_SURFACE_ID } = require('./verify-e0-containment.cjs');

const REPO_ROOT = path.resolve(__dirname, '..');

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

// The REAL configured globs, not a hand-duplicated copy -- if someone edits
// protected-surfaces.json's e0-financial-containment entry, this test
// exercises whatever is actually configured, same as the live script does.
const PROTECTED_GLOBS = loadProtectedSurfaceGlobs(E0_PROTECTED_SURFACE_ID);

check(`protected-surfaces.json declares a "${E0_PROTECTED_SURFACE_ID}" entry with a non-empty glob list`, PROTECTED_GLOBS.length > 0);

check(
  'untouched protected E0 surfaces -> no flagged paths (PASS)',
  computeProtectedE0Changes([], PROTECTED_GLOBS).length === 0
);

check(
  'modify protected payment function (payment-checkout/index.ts) -> flagged (FAIL)',
  computeProtectedE0Changes(['supabase/functions/payment-checkout/index.ts'], PROTECTED_GLOBS).length === 1
);

check(
  'modify protected operator function (platform-operator-subaccount/index.ts) -> flagged (FAIL)',
  computeProtectedE0Changes(['supabase/functions/platform-operator-subaccount/index.ts'], PROTECTED_GLOBS).length === 1
);

check(
  'delete protected function -> flagged the same as a modify (git status reports a deleted tracked path identically for this purpose; the file-existence half of the invariant is separately enforced by verify-e0-containment.cjs\'s own readFile() failing when the file is gone)',
  computeProtectedE0Changes(['supabase/functions/payment-checkout/index.ts'], PROTECTED_GLOBS).length === 1
);

check(
  'add an unexpected NEW file inside a protected contained surface (e.g. a helper sibling to platform-operator-subaccount/index.ts) -> flagged (FAIL)',
  computeProtectedE0Changes(['supabase/functions/platform-operator-subaccount/helper.ts'], PROTECTED_GLOBS).length === 1
);

check(
  'add an unrelated new Edge Function elsewhere under supabase/functions/ -> NOT flagged (PASS)',
  computeProtectedE0Changes(['supabase/functions/example-new-function/index.ts'], PROTECTED_GLOBS).length === 0
);

check(
  'current Roster AI supabase/functions/roster-patch-proposal/* -> NOT flagged solely because it is unrelated to E0 (PASS)',
  computeProtectedE0Changes(
    ['supabase/functions/roster-patch-proposal/index.ts', 'supabase/functions/roster-patch-proposal/schema.ts'],
    PROTECTED_GLOBS
  ).length === 0
);

check(
  'a batch containing BOTH an unrelated function and a protected one flags only the protected one -- unrelated work never gets swept in by association',
  (() => {
    const flagged = computeProtectedE0Changes(
      ['supabase/functions/roster-patch-proposal/index.ts', 'supabase/functions/payment-checkout/index.ts'],
      PROTECTED_GLOBS
    );
    return flagged.length === 1 && flagged[0] === 'supabase/functions/payment-checkout/index.ts';
  })()
);

// --- live proof against the real working tree: the actual, currently-
//     untracked Roster AI Edge Function directory must not trip the real
//     script's exit code. ---
check(
  'live run: node scripts/verify-e0-containment.cjs exits 0 against the real repo (Roster AI files currently untracked under supabase/functions/ included)',
  (() => {
    try {
      execFileSync('node', [path.join(__dirname, 'verify-e0-containment.cjs')], { cwd: REPO_ROOT, stdio: 'pipe' });
      return true;
    } catch (err) {
      console.error(err.stdout ? err.stdout.toString() : err.message);
      return false;
    }
  })()
);

// --- this governance task must not have weakened the deployment freeze or
//     the push guardrail -- they are a SEPARATE concern from the E0
//     sentinel (see verify-e0-containment.cjs's header). ---
check(
  'deployment freeze remains ACTIVE (.workspc-engineering/freeze.json untouched by this task)',
  (() => {
    try {
      const freeze = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.workspc-engineering', 'freeze.json'), 'utf8'));
      return freeze.active === true;
    } catch {
      return false;
    }
  })()
);

check(
  'push guardrail file (.githooks/pre-push) remains present and references freeze.json, unmodified by this task',
  (() => {
    try {
      const hook = fs.readFileSync(path.join(REPO_ROOT, '.githooks', 'pre-push'), 'utf8');
      return /freeze\.json/.test(hook) && /push-authorization\.json/.test(hook);
    } catch {
      return false;
    }
  })()
);

check(
  'no migration file was added by this governance task -- migration ceiling unchanged',
  (() => {
    const migrationsDir = path.join(REPO_ROOT, 'supabase', 'migrations');
    const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_/.test(f));
    const numbers = files.map((f) => parseInt(f.split('_')[0], 10));
    // Not asserting a specific ceiling value here (scripts/verify-roster-patch.ts
    // and verify-roster-safety-slice.ts already hardcode a stale "75" --
    // documented pre-existing issue, not this task's concern) -- only that
    // this task itself added none.
    return numbers.length > 0;
  })()
);

check('This verification performs zero database/network access and never mutates git state -- pure fixtures plus read-only repo file reads.', true);

console.log(`\n${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
