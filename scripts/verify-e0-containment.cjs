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

// --- no other Edge Function changed ---
{
  const expected = new Set([
    'supabase/functions/platform-operator-subaccount/index.ts',
    'supabase/functions/payment-checkout/index.ts',
  ]);
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

    const unexpected = changed.filter((f) => !expected.has(f));
    if (unexpected.length > 0) {
      fail(`Unexpected changes under supabase/functions/: ${unexpected.join(', ')}`);
    } else {
      pass(`No unexpected changes under supabase/functions/ (git status scoped check)`);
    }
  } catch (err) {
    console.warn(`  note: could not run git status to check for unrelated Edge Function changes (${err.message})`);
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
