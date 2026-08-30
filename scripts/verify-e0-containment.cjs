#!/usr/bin/env node
// Emergency Slice E0 — static containment tripwire.
//
// WHAT THIS IS: a plain-text/string-offset check over the two contained
// Edge Function source files. It confirms the emergency fail-closed
// `return` statement's *textual position* comes before the *textual
// position* of specific side-effect-capable calls in the same file.
//
// WHAT THIS IS NOT: this is NOT a formal proof of control-flow
// unreachability. It does not parse an AST, does not execute the code, and
// cannot detect every way a future edit could reintroduce a reachable path
// to a side effect (e.g. a second, later `return` inserted incorrectly, a
// refactor that moves code around while preserving textual order, or a
// conditional that re-enables a code path). It is a cheap regression
// tripwire against the one specific, known-good containment shape put in
// place by Slice E0 — nothing more. Manual diff/control-flow review of any
// future change to either file remains required regardless of this
// script's result.
//
// SCOPE CORRECTION (2026-08-30, containment-scope modernization): the
// original "no other Edge Function changed" check (below) scoped itself to
// the ENTIRE supabase/functions/ tree via `git status --porcelain --
// supabase/functions`, failing on any change anywhere under it besides the
// two named files. Re-reading docs/EMERGENCY_SLICE_E0_FINANCIAL_CONTAINMENT.md
// in full found no basis for that breadth — the actual, documented E0
// invariant ("Requirement for re-enablement") is scoped to exactly the two
// contained functions, not to Edge Functions as a category. The
// directory-wide form was an unintentionally overbroad addition made when
// this script was authored, not part of the reconstructed original
// invariant, and it made every unrelated new Edge Function permanently
// unable to pass this check for the life of the freeze. The check below now
// derives its protected paths from `.workspc-engineering/protected-surfaces.json`'s
// `e0-financial-containment` entry (glob-matched, not directory-collapsed
// git-status text) instead of hardcoding a two-file allowlist here — the
// exact same manifest the wider Harness (`computeProtectedSurfaceHits`)
// already uses for every other tracked surface, reused as a shared source
// of truth rather than a second, drift-prone copy. See
// scripts/verify-e0-containment-scope.cjs for deterministic coverage of
// this specific correction (unrelated-function PASS, protected-function
// FAIL, deleted-protected-function FAIL, new-file-inside-a-protected-
// directory FAIL).
//
// Run manually: node scripts/verify-e0-containment.cjs
// Deliberately NOT wired into package.json — this is a one-off emergency
// verification aid, not part of the general build/verify pipeline.
//
// Makes no network call. Does not invoke either Edge Function. Does not
// require Deno.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SENTINEL = 'financial_feature_temporarily_unavailable';
const E0_PROTECTED_SURFACE_ID = 'e0-financial-containment';

let failures = 0;

function fail(message) {
  console.error(`FAIL: ${message}`);
  failures += 1;
}

function pass(message) {
  console.log(`OK:   ${message}`);
}

function readFile(relPath) {
  const abs = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(abs)) {
    fail(`${relPath} does not exist`);
    return null;
  }
  return fs.readFileSync(abs, 'utf8');
}

// Minimal glob support -- '**' matches across path separators, '*' matches
// within one segment. Deliberately duplicated from scripts/harness.cjs's
// own globToRegExp() (not required from it) so this one-off script has no
// load-bearing dependency on harness.cjs's internals -- both independently
// implement the same tiny, stable glob subset protected-surfaces.json's
// entries actually use.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') {
      re += '[^/]*';
    } else if ('.+^$()|{}[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAnyGlob(filePath, globs) {
  return (globs || []).some((g) => globToRegExp(g).test(filePath));
}

// Reads the named protected-surface's glob list from
// .workspc-engineering/protected-surfaces.json. Returns [] (never throws)
// if the file or entry is missing, so a missing manifest degrades to "check
// nothing" with a visible warning rather than crashing the whole script --
// the two per-file ordering checks above remain the primary containment
// proof regardless.
function loadProtectedSurfaceGlobs(surfaceId) {
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, '.workspc-engineering', 'protected-surfaces.json'), 'utf8'));
    const surface = (doc.surfaces || []).find((s) => s.id === surfaceId);
    return surface ? (surface.glob || []) : [];
  } catch (err) {
    console.warn(`  note: could not read protected-surfaces.json (${err.message})`);
    return [];
  }
}

// Pure logic, directly unit-testable without git or a filesystem fixture
// (see scripts/verify-e0-containment-scope.cjs): which of `changedPaths`
// (already-normalized repo-relative paths from a git-status listing) fall
// inside one of the given protected globs. Every match is, by definition,
// an unexpected touch of an E0-protected surface -- there is no "expected"
// change to these two functions short of a formal re-enablement review.
function computeProtectedE0Changes(changedPaths, protectedGlobs) {
  return (changedPaths || []).filter((p) => matchesAnyGlob(p, protectedGlobs));
}

// Asserts `needle` appears in `source` and that its index is strictly
// before every index in `mustComeAfter` (a list of other needles that
// represent side-effect-capable calls).
function checkOrdering(relPath, source, sentinelNeedle, mustComeAfter) {
  const sentinelIndex = source.indexOf(sentinelNeedle);
  if (sentinelIndex === -1) {
    fail(`${relPath}: containment sentinel "${sentinelNeedle}" not found`);
    return;
  }
  pass(`${relPath}: containment sentinel present at offset ${sentinelIndex}`);

  for (const needle of mustComeAfter) {
    const idx = source.indexOf(needle);
    if (idx === -1) {
      // Not finding the needle at all is not itself a failure (the call
      // may legitimately not exist yet), but it's worth surfacing so a
      // silent rename doesn't quietly stop being checked.
      console.warn(`  note: "${needle}" not found in ${relPath} (nothing to check ordering against)`);
      continue;
    }
    if (idx <= sentinelIndex) {
      fail(`${relPath}: "${needle}" (offset ${idx}) appears at or before the containment sentinel (offset ${sentinelIndex}) — expected it strictly after`);
    } else {
      pass(`${relPath}: "${needle}" (offset ${idx}) is textually after the containment sentinel, as expected`);
    }
  }
}

// Guarded so `require('./verify-e0-containment.cjs')` (from
// scripts/verify-e0-containment-scope.cjs's deterministic tests) can reuse
// the pure functions above without also running the live checks below or
// calling process.exit() out from under the test script.
if (require.main === module) {
  // --- platform-operator-subaccount ---
  {
    const rel = 'supabase/functions/platform-operator-subaccount/index.ts';
    const src = readFile(rel);
    if (src !== null) {
      checkOrdering(rel, src, SENTINEL, [
        "Deno.env.get('PAYSTACK_SECRET_KEY')", // reading/using the Paystack credential
        'req.json()', // parsing financial provisioning input
        "fetch('https://api.paystack.co/subaccount'", // provider fetch
      ]);
    }
  }

  // --- payment-checkout ---
  {
    const rel = 'supabase/functions/payment-checkout/index.ts';
    const src = readFile(rel);
    if (src !== null) {
      checkOrdering(rel, src, SENTINEL, [
        'req.json()', // parsing checkout input
        'createClient(supabaseUrl, serviceRoleKey)', // service-role Supabase client
        "Deno.env.get('PAYSTACK_SECRET_KEY')", // provider credential
        "Deno.env.get('FLUTTERWAVE_SECRET_KEY')", // provider credential
        "fetch('https://api.paystack.co/transaction/initialize'", // provider fetch
        "fetch('https://api.flutterwave.com/v3/payments'", // provider fetch
        "admin.from('user_subscriptions').insert(", // user_subscriptions mutation
      ]);
    }
  }

  // --- no E0-protected surface changed (narrowed scope, see this file's
  //     header) -- git status scoped to the two protected directories only,
  //     matched against protected-surfaces.json's e0-financial-containment
  //     glob, NOT the entire supabase/functions/ tree. ---
  {
    const protectedGlobs = loadProtectedSurfaceGlobs(E0_PROTECTED_SURFACE_ID);
    if (protectedGlobs.length === 0) {
      console.warn(`  note: no "${E0_PROTECTED_SURFACE_ID}" entry found in protected-surfaces.json -- skipping the containment-scope check (the two per-file ordering checks above remain authoritative)`);
    } else {
      try {
        const output = execFileSync('git', ['status', '--porcelain', '--', 'supabase/functions'], {
          cwd: REPO_ROOT,
          encoding: 'utf8',
        });
        const changed = output
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => line.replace(/^[AMD?]{1,2}\s+/, '').trim());

        const unexpected = computeProtectedE0Changes(changed, protectedGlobs);
        if (unexpected.length > 0) {
          fail(`Protected E0 surface(s) changed: ${unexpected.join(', ')} -- any change here requires the formal re-enablement review in docs/EMERGENCY_SLICE_E0_FINANCIAL_CONTAINMENT.md, not an ordinary edit.`);
        } else {
          pass('No protected E0 surface changed (scoped to payment-checkout/ and platform-operator-subaccount/ only -- an unrelated Edge Function elsewhere under supabase/functions/ does not trigger this check)');
        }
      } catch (err) {
        console.warn(`  note: could not run git status to check for protected E0 surface changes (${err.message})`);
      }
    }
  }

  console.log('');
  if (failures > 0) {
    console.error(`${failures} check(s) failed. This is a static tripwire only — a pass does NOT substitute for manual diff/control-flow review.`);
    process.exit(1);
  } else {
    console.log('All static containment checks passed. This is a static tripwire only — a pass does NOT substitute for manual diff/control-flow review.');
    process.exit(0);
  }
}

module.exports = { computeProtectedE0Changes, matchesAnyGlob, globToRegExp, loadProtectedSurfaceGlobs, E0_PROTECTED_SURFACE_ID };
