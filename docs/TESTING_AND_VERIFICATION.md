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
