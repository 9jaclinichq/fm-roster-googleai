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

## RLS Pattern Guidance

When building doctor-owned features, copy the existing verified pattern rather
than inventing a new one:

- Owning parent rows carry a doctor owner and use `auth.uid()` checks.
- Child rows derive ownership through the parent when possible.
- Institutional rows must preserve existing behavior unless an approved auth
  architecture change says otherwise.

Do not pretend permissive RLS is safe just because it is already present. Also
do not "fix" it in passing; that is a broad architecture change.
