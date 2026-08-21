# Testing And Verification

This repository currently has a minimal harness.

## Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start Vite on port 3000.
- `npm run lint`: compatibility alias for `tsc --noEmit`. This is typecheck
  only; it is not ESLint.
- `npm run typecheck`: run `tsc --noEmit`.
- `npm run build`: run the Vite production build.
- `npm run preview`: preview the built app.
- `npm run verify`: run typecheck and production build.

## Harness Inventory (updated 2026-08-21, Governance/Registry Reconciliation)

Four dependency-free `verify-*` scripts exist beyond `npm run verify`. None of
these are a unit/integration/e2e test suite or a formal proof — classify and
use them exactly as follows, and do not describe any of them more strongly
than this:

- `node scripts/verify-tenant-surface.cjs` — **static/string tripwire**
  (default mode, no network): regex/text inspection of migration and source
  files already on disk (RPC projections, GRANT statements, policy text,
  consumer greps). Additional opt-in modes on the same script: `--remote-read`
  is **read-only remote** (the one live network call this script ever makes,
  `list_public_tenants()`, intentionally public, no auth to bypass);
  `--local-mutation` is **local/test mutation** (anonymous INSERT/UPDATE
  negative tests — refuses to run without explicit env vars, and hard-refuses
  any URL matching the production project ref). Neither opt-in mode is run by
  default.
- `node scripts/verify-resident-email-login.cjs` — **static/string tripwire
  plus logic-level deterministic verification**: extracts migration 64's exact
  SQL text and asserts it is unweakened (string-level), then independently
  re-implements that same logic in plain JS and asserts it against 8 required
  cases (logic-level). Its own header is explicit that it does not execute
  against a real Postgres instance.
- `node scripts/verify-e0-containment.cjs` — **static/string tripwire**: byte-
  offset text checks that a containment sentinel appears before every
  credential/provider/DB-write statement in two Edge Functions. Its own output
  states plainly: "a pass does NOT substitute for manual diff/control-flow
  review."
- `npx tsx scripts/verify-roster-reconciliation.ts` — **logic-level
  deterministic verification**: runs the real `rosterReconciliation.ts`
  matching/discrepancy logic against fixed, hand-authored in-memory fixtures
  (whitespace variants, reversed leave ranges, exact matches) and asserts
  expected issue output. No network, no live data.
- **Production-prohibited**: no script in this repository applies a migration
  or mutates live/production data, by design — there is no `db push`/`db:*`
  script (see `docs/DATABASE_AND_SECURITY.md`), and `--local-mutation` above
  explicitly refuses to target anything resembling the production project.

None of the above is an integration test against a real Postgres instance, a
browser/e2e test, or a formal security proof — they are deterministic
regression guards against specific, named regressions, nothing broader.

## Missing Harness

No automated unit test, integration test, browser/e2e test, migration test, or
CI workflow exists in this repository today.

Minimum future harness, in order:

1. A real lint formatter/static-analysis pass distinct from TypeScript.
2. Unit tests for pure libraries such as rubrics, parsers, terminology, and
   agent derivations.
3. Browser smoke tests for auth landing, tenant selection, resident workspace,
   org-admin dashboard, doctor workspace, and operator route.
4. Migration verification that can compare file existence, expected schema, and
   verified live database state without mutating production data.

## Manual Verification

For UI or route changes, verify the affected workflow in a browser. Include at
least:

- Desktop viewport
- Mobile viewport
- Console error check
- Route reload/session-restore check when auth-gated routes are involved

For governance-only changes, do not start a browser unless scripts or docs
explicitly require it.
