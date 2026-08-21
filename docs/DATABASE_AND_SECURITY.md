# Database And Security Discipline

This document records the repository rules for Supabase, migrations, tenancy,
RLS, auth, storage, Edge Functions, billing, and production data.

## Ground Truth

- `supabase/schema.sql` is the original/base schema, not the full current
  schema after migrations.
- `supabase/migrations/` is a linear history of intended schema/data changes.
- A migration file existing on disk does not prove it is applied live.
- A migration header saying "applied" or "not applied" does not prove live
  state. Several headers have been contradicted by later live checks.
- Verified live migration state must be recorded as a separate fact with the
  verification method and date.

## Current Security Posture

The target architecture says tenant isolation should be database-enforced. The
implemented system is mixed:

- Institutional/plaintext-code flows mostly rely on application-level tenant
  filtering because those requests do not have a per-user `auth.uid()`.
- Many institutional tables still use permissive `USING (true)` style RLS.
- Doctor-owned rows have real `auth.uid()`-scoped RLS only for the tables where
  migrations explicitly implemented that pattern and live checks verified it.
- Edge Functions may use service-role access; treat them as high-risk.
- `.env` may point at live Supabase resources. Treat it as sensitive.

### Tenant-Surface Posture (updated 2026-08-21, Governance/Registry Reconciliation)

- `public.tenants` direct client INSERT/UPDATE is closed live (migration 63
  dropped the permissive `tenants_insert`/`tenants_update` policies). Every
  legitimate mutation now goes through a `SECURITY DEFINER` RPC
  (`chief_update_tenant_terminology`/`chief_update_tenant_module_flags`,
  migration 59; `platform_operator_create_tenant`/`update_tenant_status`/
  `update_tenant_plan`, migrations 60/62).
- `public.tenants` SELECT remains open (`tenants_select USING (true)`),
  deliberately, pending Institutional Auth — residents/members have no
  server-verifiable credential today to write a real per-tenant read policy
  against. This is a recorded, deferred gap, not an oversight.
- `tenants` has never had a `REVOKE`/column-allow-list applied (unlike
  `workforce`/`settings`, migration 02) — it still carries Supabase's default
  blanket table-level `GRANT` to `anon`/`authenticated`. Combined with the
  open SELECT policy above, any anon-key holder can independently select
  every column of `tenants` directly, including `paystack_subaccount_code`,
  `plan_type`, and `status`, outside any application helper.
- Local-only commit `01bb0aa` narrowed `databaseService.getTenant()`'s own
  projection to `id, terminology_overrides, module_flags`. This is
  **application client-surface minimization / defense-in-depth only** — it
  stops that one helper from requesting or re-exposing sensitive columns, but
  it is **not** database-level confidentiality and does not change what a
  direct anon-key query against `tenants` can still read.

## Prohibited Without Explicit Approval

- Applying migrations.
- Editing schema/RLS/auth/payment/storage behavior.
- Mutating production data.
- Reading, copying, or disclosing live secrets or access codes.
- Using elevated live-DB access.
- Tightening RLS as an incidental fix.

## Migration Work Requirements

Any future migration slice must include:

- Current schema discovery.
- Clear "file exists" versus "live verified" status.
- Rollback/recovery plan.
- RLS impact analysis.
- Tenant-scope analysis.
- Verification plan using disposable data only.
- Human review before writing SQL.
- Separate human approval before applying SQL anywhere live.

## CLI Tooling

- The repo pins a local Supabase CLI as a devDependency: `supabase@2.111.0`,
  exact version (no `^`/`~`).
- Prefer `npm run supabase:version` / repo-local `npx supabase ...` over any
  global install. The global/Scoop CLI is unreliable in the current agent
  environment (observed segfault in Git-Bash and exit code 5 in PowerShell)
  and should not be relied on.
- `supabase db push` remains prohibited until migration-history
  reconciliation between local migration files and live applied state is
  separately completed and approved. No `db push`/`db:*` script is provided
  in `package.json` — its absence is intentional, not an oversight.
- Migration-file existence does not establish remote application state (see
  "Ground Truth" above). For migration inspection, use
  `npx supabase migration list --linked` only after the repo has been
  explicitly linked in the current environment, or a separately approved
  `--db-url` path when appropriate — no convenience script wraps this,
  because doing so would hide which of those two preconditions is in play.
- Read-only CLI commands (`supabase:version`, `supabase:functions:list`,
  a manually-run `migration list`) are allowed where authentication is
  already available. This does not extend to any command that mutates
  remote state.
- Broken global tooling is not justification for using
  `.tmp-run-migration.cjs`, direct DB passwords, or any other stronger
  credential path than the CLI itself provides.

## RLS Pattern Guidance

When building doctor-owned features, copy the existing verified pattern rather
than inventing a new one:

- Owning parent rows carry a doctor owner and use `auth.uid()` checks.
- Child rows derive ownership through the parent when possible.
- Institutional rows must preserve existing behavior unless an approved auth
  architecture change says otherwise.

Do not pretend permissive RLS is safe just because it is already present. Also
do not "fix" it in passing; that is a broad architecture change.
