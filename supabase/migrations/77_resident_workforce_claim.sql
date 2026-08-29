-- Institutional Identity Slice 2a — Resident Claim/Link with Legacy
-- Coexistence (additive only). Per prompt1.txt: reviewed design handoff is
-- the "institutional identity slice 2 claim/link" design doc (WORKSPC,
-- dated 2026-08-29), its own Sections 2 and 7. Reconciled directly against
-- the CURRENT live definitions of organisation_memberships (migration 76)
-- and verify_resident_login (migration 64) before writing this file, not
-- merely against the handoff's own conceptual description.
--
-- LOCKED HUMAN DECISION (restated here, load-bearing for this whole file):
-- a successful resident claim does NOT disable legacy resident-code
-- access. legacy_code_disabled_at is left NULL by claim_workforce_member
-- and is set only by a later, separate, explicitly admin-approved
-- workflow -- not built in this slice, not invented as a grace-period
-- timer here. This migration nevertheless makes verify_resident_login
-- HONOR legacy_code_disabled_at wherever it is already non-null (a state
-- that cannot yet be reached by any code path in this migration, but must
-- not silently continue authorizing once a future workflow sets it).
--
-- THIS MIGRATION DOES NOT:
--   - implement claim_tenant_admin, Chief account linking, or any
--     admin-code disable semantics (a different authority problem, per
--     the reviewed handoff's own Section 7 -- deferred, not this file);
--   - alter migration 76's organisation_memberships table/RLS/policies in
--     any way (no ALTER TABLE on it appears anywhere below);
--   - write workforce.doctor_id from any new code path (it remains the
--     frozen legacy compatibility bridge, per the handoff's Section 5 --
--     organisation_memberships is the sole canonical link going forward);
--   - build relink/history infrastructure, or touch event_log (per the
--     handoff's Section 9 -- this claim's own row fields are the
--     provenance);
--   - tighten RLS on any existing institutional table, or grant
--     authenticated any direct write access to organisation_memberships.

-- =====================================================================
-- claim_workforce_member(p_workforce_id, p_resident_code)
-- =====================================================================
--
-- Contract, restated from the reviewed handoff's Section 2, adjusted to
-- this slice's exact locked requirements (claim_method literal, and the
-- explicit "legacy_code_disabled_at unchanged unless already populated"
-- rule):
--   - requires an authenticated Supabase session (auth.uid() IS NOT NULL);
--   - derives the caller EXCLUSIVELY from auth.uid() -- no p_tenant_id or
--     any other caller-supplied identity parameter exists on this
--     function at all;
--   - fetches the workforce row server-side, requires it to be active,
--     and validates p_resident_code against it server-side (never
--     trusting a prior client-side login);
--   - derives tenant_id from the workforce row, never from the caller;
--   - creates or enriches the caller's existing (tenant_id, auth_user_id)
--     membership via INSERT ... ON CONFLICT, relying on the database's
--     own atomicity rather than a check-then-write pattern -- this repo's
--     own CLAUDE.md names check-then-write races as a known bug class to
--     avoid, and migration 76's own UNIQUE(tenant_id, auth_user_id) plus
--     its partial unique workforce-link index already give this upsert
--     everything it needs to be race-safe by construction;
--   - sets is_workforce_member = true and the current workforce_id;
--   - preserves any existing is_tenant_admin = true flag untouched (a
--     membership can be BOTH a workforce member and a tenant admin on one
--     row, per migration 76's own relationship invariant -- this is an
--     OR, not an XOR);
--   - sets claimed_at (only if not already set -- see the idempotency
--     note below) and claim_method = 'resident_code_claim' (exact literal
--     required by this slice);
--   - LEAVES legacy_code_disabled_at completely alone -- this INSERT/
--     UPDATE never references that column at all, so a fresh row gets it
--     as NULL (the column's own default) and an existing row's value is
--     never touched by this statement, satisfying "leave
--     legacy_code_disabled_at unchanged/null unless already populated"
--     exactly;
--   - REJECTS (not silently switches) an attempt to claim a DIFFERENT
--     workforce_id once this (tenant, auth_user_id) pair already has a
--     completed claim (claimed_at IS NOT NULL AND workforce_id IS NOT
--     NULL) for a workforce_id that differs from the one requested --
--     this is the "no self-service takeover" guard named in the reviewed
--     handoff's Section 2/8, checked explicitly BEFORE the upsert runs;
--   - is safely idempotent for a genuine repeat: the SAME authenticated
--     user calling this again with the SAME workforce_id (and, naturally,
--     that workforce row's current resident_code, since the code is
--     re-validated fresh every call) is a no-op that preserves the
--     original claimed_at/claim_method via COALESCE, never overwriting
--     them with a new timestamp;
--   - relies on migration 76's own partial unique index
--     (organisation_memberships_one_active_workforce_link) to reject a
--     DIFFERENT authenticated user attempting to claim a workforce row
--     that is already linked to an active/suspended membership -- caught
--     here as a unique_violation and re-raised as a clear, non-leaking
--     error, never allowed to silently succeed or silently overwrite.
--
-- Returns a MINIMAL result sufficient for UI confirmation only --
-- deliberately omits auth_user_id (the caller already knows their own
-- auth.uid(), per migration 76's own established omission rule for
-- current_user_organisation_memberships()) and never returns the resident
-- code itself (it was only ever a request parameter, never persisted or
-- echoed back by this or any other RPC in this app).
-- RETURNS TABLE column names below are deliberately NOT the bare
-- organisation_memberships column names (tenant_id/workforce_id/
-- is_workforce_member/is_tenant_admin/status/claimed_at) -- found live,
-- not by reading this file's own source: RETURNS TABLE(...) implicitly
-- declares each of those names as a plpgsql OUT-parameter variable for
-- the whole function body, and a real table column of the SAME name
-- anywhere inside the body (including, surprisingly, an INSERT's own
-- target column list -- table aliases do not help there, since that
-- position cannot be alias-qualified at all) raises "column reference
-- ... is ambiguous" at the SQL level. Caught only by live execution
-- during this slice's own deploy verification (a structural SQL-text
-- check cannot catch this). Prefixed with claim_ instead -- membership_id
-- needed no change since no column is literally named "membership_id"
-- (the real PK is just "id").
--
-- DROP FUNCTION IF EXISTS is required here (matching migration 64's own
-- established precedent for this exact situation): Postgres's CREATE OR
-- REPLACE FUNCTION refuses to change an existing function's RETURNS TABLE
-- column shape ("cannot change return type of existing function"), which
-- the OUT-parameter rename above does. This only matters because this
-- exact function was already live-applied once with the old column names
-- during this same slice's own deploy verification -- it has never been
-- exposed to real traffic.
DROP FUNCTION IF EXISTS claim_workforce_member(uuid, text);

CREATE OR REPLACE FUNCTION claim_workforce_member(p_workforce_id uuid, p_resident_code text)
RETURNS TABLE (
  membership_id uuid,
  claim_tenant_id uuid,
  claim_workforce_id uuid,
  claim_is_workforce_member boolean,
  claim_is_tenant_admin boolean,
  claim_status text,
  claim_claimed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workforce workforce%ROWTYPE;
  v_existing organisation_memberships%ROWTYPE;
  v_result organisation_memberships%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_workforce FROM workforce w WHERE w.id = p_workforce_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workforce record not found' USING ERRCODE = '22023';
  END IF;

  IF NOT v_workforce.active THEN
    RAISE EXCEPTION 'This workforce record is not active' USING ERRCODE = '22023';
  END IF;

  IF v_workforce.resident_code IS DISTINCT FROM p_resident_code THEN
    RAISE EXCEPTION 'Invalid resident code' USING ERRCODE = '28000';
  END IF;

  -- Tenant is derived from the workforce row -- there is no p_tenant_id
  -- parameter on this function for a caller to supply instead.
  --
  -- Every table reference below this point is explicitly aliased (w/om) --
  -- found live, not by reading this file's own source: this function's
  -- RETURNS TABLE clause implicitly declares plpgsql OUT-parameter
  -- variables named tenant_id/workforce_id/is_workforce_member/
  -- is_tenant_admin/status/claimed_at, which COLLIDE by name with real
  -- organisation_memberships (and workforce.tenant_id) columns. A bare,
  -- unqualified reference to any of those names inside this function body
  -- raises "column reference ... is ambiguous" at the SQL level, since
  -- Postgres cannot tell whether the bare name means the OUT parameter or
  -- the table column. Caught only by live execution during this slice's
  -- own deploy verification (structural SQL-text checks cannot catch
  -- this) -- fixed by aliasing every table (w for workforce, om for
  -- organisation_memberships) and qualifying every reference, rather than
  -- renaming the RETURNS TABLE columns (which would be a breaking change
  -- to this RPC's already-reviewed public return shape).
  --
  -- Fast, friendly PRE-CHECK for the common (non-concurrent) case: an
  -- already-completed claim for a DIFFERENT workforce_id in this same
  -- tenant is rejected outright here, before attempting any write. This
  -- alone is NOT sufficient for race-safety by itself (see below) -- it
  -- exists only to give a clear error without a write attempt in the
  -- ordinary sequential case.
  SELECT * INTO v_existing
    FROM organisation_memberships om
    WHERE om.tenant_id = v_workforce.tenant_id AND om.auth_user_id = auth.uid();

  IF FOUND
     AND v_existing.claimed_at IS NOT NULL
     AND v_existing.workforce_id IS NOT NULL
     AND v_existing.workforce_id <> p_workforce_id
  THEN
    RAISE EXCEPTION 'This account has already claimed a different workforce record in this organisation. Contact an admin to relink.' USING ERRCODE = '42501';
  END IF;

  -- Race-safe enforcement of the SAME "no silent switch" rule: the
  -- pre-check above has a time-of-check-to-time-of-use gap if two
  -- requests for two DIFFERENT workforce_ids from the same not-yet-
  -- claimed auth user commit concurrently -- both could see "no existing
  -- row" and both proceed, with a plain `workforce_id = EXCLUDED.
  -- workforce_id` on the conflict branch letting whichever commits SECOND
  -- silently overwrite the first's already-committed, different
  -- workforce_id. The WHERE clause on this DO UPDATE closes that window
  -- atomically, as part of ONE statement, independent of the earlier
  -- SELECT: the update is only applied when the row being conflicted into
  -- has no workforce_id yet, or already has THIS SAME workforce_id. If
  -- the WHERE evaluates false, Postgres treats that conflicting row as
  -- not updated and RETURNING yields no row for it -- detected below via
  -- NOT FOUND and turned into the same clear error, never a silent
  -- overwrite, race or not.
  BEGIN
    INSERT INTO organisation_memberships AS om (
      tenant_id, auth_user_id, workforce_id, is_workforce_member, is_tenant_admin, status, claimed_at, claim_method
    )
    VALUES (
      v_workforce.tenant_id, auth.uid(), p_workforce_id, true, false, 'active', timezone('utc'::text, now()), 'resident_code_claim'
    )
    ON CONFLICT (tenant_id, auth_user_id) DO UPDATE SET
      is_workforce_member = true,
      workforce_id = EXCLUDED.workforce_id,
      -- is_tenant_admin is deliberately absent from this SET list -- an
      -- existing true value is preserved untouched, never overwritten by
      -- a workforce-side claim.
      claimed_at = COALESCE(om.claimed_at, EXCLUDED.claimed_at),
      claim_method = COALESCE(om.claim_method, EXCLUDED.claim_method),
      updated_at = timezone('utc'::text, now())
      -- legacy_code_disabled_at is absent from this SET list entirely --
      -- never referenced, so a fresh row gets the column's own NULL
      -- default and an existing row's value (whatever it is) is left
      -- completely alone by this statement.
    WHERE om.workforce_id IS NULL
       OR om.workforce_id = EXCLUDED.workforce_id
    RETURNING * INTO v_result;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This workforce record has already been claimed by another account.' USING ERRCODE = '23505';
  END;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'This account has already claimed a different workforce record in this organisation. Contact an admin to relink.' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT v_result.id, v_result.tenant_id, v_result.workforce_id, v_result.is_workforce_member, v_result.is_tenant_admin, v_result.status, v_result.claimed_at;
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation, and
-- this Supabase project's ambient ALTER DEFAULT PRIVILEGES additionally
-- grants EXECUTE directly to anon/authenticated at creation time -- a
-- grant held BY THAT ROLE, not by the PUBLIC pseudo-role, so a
-- PUBLIC-only REVOKE does not remove it. This is the exact migration-76
-- lesson (prompt1.txt's own "Important migration-76 lesson" section) --
-- both REVOKEs below are therefore explicit, by role name, not inferred
-- from the PUBLIC revoke alone. Static SQL intent is not sufficient by
-- itself: effective live privileges must still be checked with
-- information_schema/pg_catalog queries after this migration is applied,
-- exactly as migration 76's own deploy did.
REVOKE ALL ON FUNCTION claim_workforce_member(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_workforce_member(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION claim_workforce_member(uuid, text) TO authenticated;

-- No GRANT of any kind is added on organisation_memberships itself in
-- this file -- authenticated still has SELECT-only (migration 76,
-- corrected), and this RPC writes to the table exclusively via its own
-- SECURITY DEFINER body, exactly like every other privileged RPC in this
-- app. No new client-facing write policy/grant is introduced anywhere.

-- =====================================================================
-- Legacy resident-code login guard (minimal change to verify_resident_login)
-- =====================================================================
--
-- Per the reviewed handoff's Section 7: the caller must never be able to
-- choose the weaker path. This adds exactly ONE additional AND-clause to
-- the function's existing WHERE predicate -- every other check (tenant/
-- code/active/email-ratchet) is completely unchanged, preserved verbatim
-- from migration 64. The function's language (plain SQL, not plpgsql),
-- parameter list, and RETURNS TABLE shape are all unchanged, so
-- CREATE OR REPLACE FUNCTION is used directly -- no DROP FUNCTION is
-- needed here (migration 64's own DROP was only required because THAT
-- migration changed the return column shape; this one does not).
--
-- Precisely what does and does not disable the legacy path, restated from
-- the locked human decision:
--   - a membership existing at all does NOT disable it;
--   - claimed_at being set does NOT disable it;
--   - status = 'suspended'/'revoked' does NOT, by itself, disable it here
--     (suspending/revoking a membership is a separate future concern from
--     the legacy-code fallback question this slice narrowly addresses --
--     conflating the two would create exactly the kind of "accidental
--     alternative authorization path" this task explicitly warns against);
--   - ONLY organisation_memberships.legacy_code_disabled_at being
--     non-null for this exact workforce_id disables it.
-- No code path in this migration can ever SET legacy_code_disabled_at --
-- it remains reachable only via a future, separate, explicitly
-- admin-approved workflow. This guard is therefore inert (never actually
-- blocks anyone) for as long as that future workflow does not exist, and
-- becomes active only once it does -- exactly the intended "fail closed
-- once, and only once, that column is explicitly populated" behavior.
CREATE OR REPLACE FUNCTION public.verify_resident_login(p_workforce_id uuid, p_code text, p_email text DEFAULT NULL)
RETURNS TABLE(id uuid, full_name text, category text, has_email boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.full_name, w.category, (w.email IS NOT NULL) AS has_email
  FROM workforce w
  WHERE w.id = p_workforce_id
    AND w.resident_code = p_code
    AND w.active = true
    AND (w.email IS NULL OR lower(w.email) = lower(trim(coalesce(p_email, ''))))
    AND NOT EXISTS (
      SELECT 1 FROM organisation_memberships om
      WHERE om.workforce_id = w.id AND om.legacy_code_disabled_at IS NOT NULL
    );
$$;
GRANT EXECUTE ON FUNCTION public.verify_resident_login(uuid, text, text) TO anon, authenticated;
