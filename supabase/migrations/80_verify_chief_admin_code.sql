-- ====================================================================
-- Migration 80: verify_chief_admin_code -- server-side, body-based admin
-- code verification for the Roster AI V1 Edge Function.
-- ====================================================================
-- WRITTEN FOR REVIEW ONLY. NOT APPLIED LIVE. Do not run this against the
-- live database until a human explicitly lifts the current deployment
-- freeze and applies it (same discipline as migrations 66-79), and this
-- migration's own preflight/effective-privilege inspection has been
-- completed and reported separately.
--
-- WHY THIS EXISTS: supabase/functions/roster-patch-proposal/index.ts's
-- verifyAdminCodeAndDeriveTenant() previously verified the Chief's
-- admin_access_code via a plain REST GET request to
-- `/rest/v1/settings?admin_access_code=eq.<code>&select=tenant_id`,
-- embedding the raw credential in a URL query string. This is a real,
-- narrow exposure surface beyond how every other chief_* RPC in this
-- schema already verifies the identical credential -- as a POST-body /
-- RPC parameter, via each function's own inline
-- `WHERE admin_access_code = p_admin_code` check (see
-- chief_start_roster_revision, migration 75). Credentials embedded in a
-- URL query string are more commonly captured by intermediate
-- infrastructure (API gateway/access logs, error trackers, browser
-- history on a client-initiated request) than a POST body ever is.
--
-- THE FIX: this migration adds the smallest possible RPC to close that
-- gap -- verify_chief_admin_code(text) returns ONLY the tenant_id (or
-- NULL for an invalid code). No other `settings` row content is ever
-- returned. No hash/comparison logic is exposed to the client -- the
-- comparison happens entirely inside this SECURITY DEFINER function
-- body, exactly as every other chief_*/resident_* RPC's own code check
-- already does. Calling this RPC is a POST to
-- `/rest/v1/rpc/verify_chief_admin_code` with
-- `{ "p_admin_code": "..." }` in the request body -- the raw code never
-- appears in a URL under any code path that calls this function.
--
-- SCOPE: this function performs a single read-only SELECT against
-- `settings` -- the exact same lookup chief_start_roster_revision already
-- performs inline (migration 75). It has no SELECT/INSERT/UPDATE/DELETE
-- on roster_revisions, combined_master_rosters, or any other table. It
-- returns exactly one scalar column (tenant_id) -- no admin_access_code,
-- no other settings column, no roster/workforce content of any kind.
--
-- UNIQUENESS / CROSS-TENANT ISOLATION: `settings.admin_access_code` has
-- carried a UNIQUE constraint since migration 23
-- (`settings_admin_code_unique`) -- at most one row, and therefore at
-- most one tenant, can ever match a given code. A code that does not
-- match any row yields zero rows -- standard SQL equality semantics mean
-- `admin_access_code = NULL` (an absent/empty caller-supplied code) also
-- matches nothing. There is no code path in this function through which
-- one tenant's code could ever resolve a different tenant's id.
--
-- NO NEW ENUMERATION SURFACE: this function returns strictly less
-- information than any existing chief_* RPC that already accepts
-- p_admin_code (e.g. chief_start_roster_revision additionally reveals
-- collection-state via distinct exception messages) -- a caller
-- guessing codes against this function learns only "tenant_id or null,"
-- the same binary signal every existing admin-code-gated RPC in this
-- schema already exposes. No new brute-force/timing primitive is
-- introduced beyond what already exists project-wide for this
-- authentication model.
--
-- PRIVILEGE MODEL (ambient-default-privilege lesson, migrations 76/77):
-- a plain `REVOKE ALL ... FROM PUBLIC` after CREATE FUNCTION is NOT
-- sufficient on this project -- confirmed empirically in migrations 76
-- and 77 that `anon` had separately, ambiently obtained EXECUTE at
-- CREATE FUNCTION time, and a PUBLIC-only REVOKE did not remove it. Both
-- REVOKEs below are therefore explicit, by role name, exactly like
-- migrations 76/77's own remediation -- not inferred from a bare
-- `FROM PUBLIC` alone. `anon` AND `authenticated` are then explicitly
-- (re-)granted EXECUTE, matching verify_resident_login's own identical
-- posture (migration 77): this app's Chief/resident sessions are never
-- real Supabase Auth sessions, so `anon` is the actual PostgREST calling
-- role for every existing chief_*/resident_* RPC, and access control is
-- enforced entirely by the code parameter itself, verified inside the
-- function body -- exactly as this function does. This does not widen
-- any existing permission; it makes this one new function's resulting
-- privilege state explicit and deterministic rather than accidentally
-- inherited, and must still be confirmed against the LIVE database's own
-- actual ACL state (via has_function_privilege(...) or
-- information_schema.routine_privileges) once this migration is applied
-- -- that live check is explicitly OUT OF SCOPE for this local-only
-- migration-authoring pass and is required before this function is ever
-- relied upon in production.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.verify_chief_admin_code(p_admin_code text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM settings WHERE admin_access_code = p_admin_code;
  RETURN v_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_chief_admin_code(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_chief_admin_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_chief_admin_code(text) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 80
-- ====================================================================
