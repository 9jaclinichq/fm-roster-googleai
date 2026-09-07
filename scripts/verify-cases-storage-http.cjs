#!/usr/bin/env node
// Cases slice 1 — the two Storage checks that SQL genuinely cannot make.
//
// The rollback-only SQL suite
// (.workspc-engineering/preflight/migration-81-post-apply-gates.sql) proves the
// policy predicates, including gate 9's cross-owner read denial, which is the
// authorisation half of cross-owner signed-URL refusal. Two claims are left over
// because they are properties of the Storage HTTP service rather than of a
// policy:
//
//   1. getPublicUrl() must not resolve for a private bucket. The client builds
//      that URL string offline and will happily hand you one for any bucket; the
//      question is whether the service serves it.
//   2. An anon caller must not be able to mint a signed URL for the private
//      bucket.
//
// Credentials come from the ENVIRONMENT and are never read from .env, matching
// scripts/verify-tenant-surface.cjs. Set SUPABASE_URL and SUPABASE_ANON_KEY
// before running; without them the script SKIPS rather than guessing, and exits
// 0 so it cannot silently look like a pass.
//
// This is read-only: it fetches two URLs and asks the API to sign a path. It
// uploads nothing, writes nothing and needs no doctor account.
//
// Run: npm run verify:cases-storage-http

const BUCKET = 'case-source-restricted';
// A path that does not exist. Both checks are about the SERVICE's answer, and
// for a private bucket "denied" must come before "not found" — a 404 for a
// missing object would tell us nothing about whether a real object is exposed.
const PROBE_PATH = '00000000-0000-0000-0000-000000000000/probe/none.jpg';

let failures = 0;
let skipped = false;

function ok(label, detail) {
  console.log(`OK:   ${label}${detail ? ` — ${detail}` : ''}`);
}
function fail(label, detail) {
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
  failures += 1;
}
function skip(reason) {
  console.log(`SKIP: ${reason}`);
  skipped = true;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    skip('SUPABASE_URL / SUPABASE_ANON_KEY not set in the environment — not reading .env to obtain them');
    return;
  }

  const base = url.replace(/\/+$/, '');

  // --- 1. The public URL for a private bucket must not serve content. ---
  const publicUrl = `${base}/storage/v1/object/public/${BUCKET}/${PROBE_PATH}`;
  try {
    const res = await fetch(publicUrl, { method: 'GET' });
    if (res.status === 200) {
      fail('getPublicUrl path does not resolve for the private bucket',
           `the service returned 200 for ${BUCKET} — the bucket is serving public content`);
    } else {
      ok('getPublicUrl path does not resolve for the private bucket', `HTTP ${res.status}`);
    }
  } catch (err) {
    fail('getPublicUrl path does not resolve for the private bucket', `request failed: ${err.message}`);
  }

  // --- 2. An anon caller must not be able to mint a signed URL. ---
  // A 2xx here would mean the private bucket can be handed out by anyone
  // holding the anon key, which is precisely what the slice exists to prevent.
  const signUrl = `${base}/storage/v1/object/sign/${BUCKET}/${PROBE_PATH}`;
  try {
    const res = await fetch(signUrl, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 60 }),
    });
    if (res.ok) {
      fail('anon cannot mint a signed URL for the private bucket',
           `the service returned ${res.status} — anon can sign objects in ${BUCKET}`);
    } else {
      ok('anon cannot mint a signed URL for the private bucket', `HTTP ${res.status}`);
    }
  } catch (err) {
    fail('anon cannot mint a signed URL for the private bucket', `request failed: ${err.message}`);
  }

  // --- 3. Control: the service is actually reachable. ---
  // Without this, a network failure would surface as two passes above, since
  // "did not serve content" is exactly what a broken connection looks like.
  try {
    const res = await fetch(`${base}/storage/v1/bucket`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    });
    if (res.status === 0 || !res.status) {
      fail('control: Storage service reachable', 'no HTTP status returned');
    } else {
      ok('control: Storage service reachable', `HTTP ${res.status} from /storage/v1/bucket`);
    }
  } catch (err) {
    fail('control: Storage service reachable',
         `${err.message} — the two results above cannot be trusted, since an unreachable service also fails to serve content`);
  }
}

main().then(() => {
  if (skipped && failures === 0) {
    console.log('\nSkipped: no credentials in the environment. This is not a pass.');
    process.exit(0);
  }
  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED.`);
    process.exit(1);
  }
  console.log('\nBoth Storage HTTP checks passed.');
  process.exit(0);
}).catch((err) => {
  console.error(`FAIL: unexpected error — ${err.message}`);
  process.exit(1);
});
