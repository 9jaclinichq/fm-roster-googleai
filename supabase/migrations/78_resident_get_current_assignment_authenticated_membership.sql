-- ====================================================================
-- Migration 78: resident_get_current_assignment() — authenticated
-- institutional membership authorization, coexisting with legacy
-- resident-code login (Institutional Identity Slice 2c.1)
-- ====================================================================
-- WRITTEN FOR REVIEW ONLY. NOT APPLIED LIVE. LOCAL ONLY per this slice's
-- own explicit boundary ("New migration/helper/client changes LOCAL ONLY /
-- NOT APPLIED. No push. No deployment. Freeze remains ACTIVE."). Do not
-- run this against the live database until a human explicitly lifts the
-- current deployment freeze and separately approves applying it (same
-- discipline as every migration since 66).
--
-- REVIEWED DESIGN HANDOFF: WORKSPC_INSTITUTIONAL_IDENTITY_SLICE2C_
-- AUTHENTICATED_RESIDENT_AUTHORIZATION_DISCOVER_AND_PLAN_2026-08-29.md,
-- Sections 2/3/4/5/6/8, as narrowed by this task's own explicit locked
-- human decision below.
--
-- LOCKED HUMAN DECISION, restated verbatim from this task's own
-- authorization — membership status and legacy fallback are related in
-- authorization, but do NOT mutate each other automatically in this slice:
--   - status = 'active' may authorize through authenticated membership.
--   - status = 'suspended' or 'revoked' must NOT authorize through
--     authenticated membership.
--   - legacy_code_disabled_at IS NOT NULL blocks legacy-code fallback.
--   - This migration does NOT set legacy_code_disabled_at automatically
--     when a membership becomes suspended/revoked — no such write exists
--     anywhere in this file.
--   - This migration does NOT create any status-changing workflow — no
--     suspend/revoke/reinstate RPC of any kind.
--
-- SCOPE: migrates ONLY resident_get_current_assignment() (migrations
-- 67/70/71/72) to authenticated-membership-first authorization, with
-- legacy resident-code coexistence. Does NOT touch
-- resident_get_current_full_roster (73), resident_get_roster_section_
-- presentation (74), resident_set_email (64), verify_resident_login
-- beyond its existing migration-77 behavior (untouched here), or any
-- chief_*/admin RPC. Confirmed structurally by scripts/verify-migration-78.cjs.
--
-- WHY resident_get_current_assignment() ALONE: per the reviewed handoff's
-- own Section 6 recommendation — highest user-visible value (both
-- MyAssignmentView.tsx and Resident Home's summary card depend on this one
-- RPC), and the narrowest possible blast radius to prove the new mechanism
-- live before replicating it to Full Roster / roster-section presentation
-- in a follow-up slice.
--
-- SIGNATURE: UNCHANGED — still exactly (p_workforce_id uuid, p_code text).
-- RETURNS TABLE shape UNCHANGED — still exactly (status text, month
-- integer, year integer, assignments jsonb). No DROP FUNCTION is required
-- (unlike migration 77's OUT-parameter rename) because neither the
-- parameter list nor the return-column list changes — only the function
-- BODY gains one new credential block before the existing re-verification.
-- No PostgREST overload is introduced (reviewed handoff Section 5, option A
-- — rejected option B specifically because this repo has zero precedent
-- for RPC overloading and PostgREST's overload resolution is documented as
-- fragile).
--
-- THE PL/PGSQL "AMBIGUOUS COLUMN" GOTCHA FROM MIGRATION 77, CHECKED AND
-- CONFIRMED NOT APPLICABLE HERE: this function's RETURNS TABLE OUT-
-- parameter names are status/month/year/assignments. combined_master_
-- rosters DOES have a real column named "status" — but every reference to
-- it in this function's body (both before and after this migration) is
-- alias-qualified (cmr.status), never a bare identifier, so no ambiguity
-- exists (migration 77's bug was specifically an INSERT statement's own
-- target column list, a position that cannot be alias-qualified at all —
-- this function contains no INSERT statement anywhere). The new helper
-- function introduced below returns a single boolean, not a TABLE, so it
-- has no OUT-parameters and cannot hit this bug class at all. Every new
-- local variable this migration introduces (v_authorized) is a plain
-- boolean with no name collision against any RETURNS TABLE column of
-- either function.
--
-- SECURITY / GRANTS (migration-76/77 ambient-default-privilege lesson
-- applied prospectively, not re-learned): the new helper is never granted
-- to any role explicitly and is never meant to be callable directly by a
-- client — REVOKE ALL FROM PUBLIC and REVOKE ALL FROM anon (by name, not
-- inferred from the PUBLIC revoke) are both present below, exactly the
-- migration-76 lesson. It is NOT SECURITY DEFINER (matching this repo's
-- own precedent for small helpers — _normalize_supervision_name,
-- _roster_section_fallbacks, _resolve_workforce_names — none of which is
-- SECURITY DEFINER in its own right; each only ever executes from inside
-- an already-SECURITY-DEFINER caller, and auth.uid() is confirmed by this
-- session's own live testing, migration 77, to resolve to the real calling
-- client's JWT sub claim regardless of nesting). Unlike those three
-- siblings, this helper DOES gain an explicit SET search_path = public and
-- explicit REVOKEs — disclosed, not silently copied: none of those three
-- pre-existing siblings has either (checked directly; a real, pre-existing,
-- low-risk gap, not fixed by this migration, since none of them evaluates
-- auth.uid()/authorization state the way this one does).
-- resident_get_current_assignment() itself keeps its existing GRANT EXECUTE
-- TO anon, authenticated unchanged — this slice does not change who may
-- attempt to call it, only what the function does once called.
-- ====================================================================

-- Narrow, single-purpose, self-contained: takes ONLY p_workforce_id (the
-- same sole context selector every resident RPC already uses — no
-- p_tenant_id parameter, matching this task's own explicit "keep
-- workforce_id as the explicit context selector, never accept a
-- caller-supplied tenant id" instruction). Derives auth_user_id
-- exclusively from auth.uid(); derives tenant_id server-side via the join
-- to the workforce row itself, never from the membership row in isolation
-- and never from a caller-supplied value. Not directly callable by any
-- client (see REVOKE below) — only ever invoked from inside
-- resident_get_current_assignment(), an already-SECURITY-DEFINER caller.
CREATE OR REPLACE FUNCTION public._resident_authenticated_membership_match(p_workforce_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM workforce w
    JOIN organisation_memberships om
      ON om.tenant_id = w.tenant_id
     AND om.workforce_id = w.id
    WHERE w.id = p_workforce_id
      AND w.active = true
      AND om.auth_user_id = auth.uid()
      AND om.is_workforce_member = true
      AND om.status = 'active'
  );
$$;

-- A tenant-admin-only membership (workforce_id IS NULL) can never satisfy
-- `om.workforce_id = w.id` for any real workforce row — NULL = uuid is
-- never true in SQL — so it structurally never authorizes any
-- p_workforce_id, without needing a separate exclusion clause. A
-- suspended/revoked membership is excluded by `om.status = 'active'`
-- alone; per this task's own locked decision, nothing here (or anywhere
-- else in this migration) writes legacy_code_disabled_at as a side effect
-- of status, and no status-changing RPC is introduced.

REVOKE ALL ON FUNCTION public._resident_authenticated_membership_match(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._resident_authenticated_membership_match(uuid) FROM anon;

CREATE OR REPLACE FUNCTION public.resident_get_current_assignment(p_workforce_id uuid, p_code text)
RETURNS TABLE (
  status text,
  month integer,
  year integer,
  assignments jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_full_name text;
  v_current_collection_id uuid;
  v_roster combined_master_rosters%ROWTYPE;
  v_assignments jsonb := '[]'::jsonb;
  v_slot jsonb;
  -- Structural precedence flag: the strong (authenticated-membership)
  -- path is attempted first and unconditionally, every call; p_code is
  -- never even inspected while this remains false-then-true within one
  -- call unless the strong path did not match. This is what makes the
  -- weaker path unreachable for a matching caller, not merely unused —
  -- there is no client-observable branch to choose from.
  v_authorized boolean := false;
BEGIN
  -- Strong path. auth.uid() IS NULL is the ordinary case for a caller
  -- with no Supabase Auth session at all (still the overwhelming majority
  -- during coexistence) — the helper call is skipped entirely at zero
  -- cost for them, and the legacy path below is completely unaffected.
  IF auth.uid() IS NOT NULL AND public._resident_authenticated_membership_match(p_workforce_id) THEN
    v_authorized := true;
    -- The helper already proved this workforce row exists, is active, and
    -- has a matching active membership for this exact auth.uid() — this
    -- is a cheap, guaranteed-to-find-a-row lookup, not a new check.
    SELECT w.tenant_id, w.full_name INTO v_tenant_id, v_full_name
    FROM workforce w WHERE w.id = p_workforce_id;
  END IF;

  IF NOT v_authorized THEN
    -- Legacy fallback: reverify the caller server-side, same ratchet as
    -- verify_resident_login (migrations 64/72) — workforce_id +
    -- resident_code + active=true — now additionally gated by the same
    -- legacy_code_disabled_at guard migration 77 added to
    -- verify_resident_login, extended here to this RPC for the first time.
    -- This closes the central gap the reviewed handoff's own audit found:
    -- until this migration, a membership with legacy fallback disabled
    -- was still fully reachable through this RPC, because it never
    -- referenced organisation_memberships at all.
    SELECT w.tenant_id, w.full_name INTO v_tenant_id, v_full_name
    FROM workforce w
    WHERE w.id = p_workforce_id
      AND w.resident_code = p_code
      AND w.active = true
      AND NOT EXISTS (
        SELECT 1 FROM organisation_memberships om
        WHERE om.workforce_id = w.id AND om.legacy_code_disabled_at IS NOT NULL
      );

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid access code' USING ERRCODE = '28000';
    END IF;
  END IF;

  -- Tenant is derived from the verified workforce row only, via either
  -- path above — never a client-supplied parameter. This is what prevents
  -- a valid member from ever reading another tenant's roster.
  SELECT s.current_collection_id INTO v_current_collection_id
  FROM settings s
  WHERE s.tenant_id = v_tenant_id;

  IF v_current_collection_id IS NULL THEN
    RETURN QUERY SELECT 'not_published'::text, NULL::integer, NULL::integer, '[]'::jsonb;
    RETURN;
  END IF;

  SELECT * INTO v_roster
  FROM combined_master_rosters cmr
  WHERE cmr.collection_id = v_current_collection_id
    AND cmr.tenant_id = v_tenant_id
    AND cmr.status = 'published';

  IF NOT FOUND THEN
    -- Covers both "no roster row yet" and "row exists but still
    -- draft/chief_review" — both are 'not_published' from the member's
    -- point of view; draft/chief_review content is never inspected further.
    RETURN QUERY SELECT 'not_published'::text, NULL::integer, NULL::integer, '[]'::jsonb;
    RETURN;
  END IF;

  -- Everything below this point is BYTE-FOR-BYTE UNCHANGED from migration
  -- 72 — the GOP/A&E/Satellite/Supervision matching loops, their
  -- assignment_detail selection, and the final three-state RETURN QUERY
  -- contract. This migration's only behavioral change is the credential
  -- block above.

  FOR v_slot IN SELECT value FROM jsonb_array_elements(coalesce(v_roster.gop_clinic_grid->'slots', '[]'::jsonb))
  LOOP
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(coalesce(v_slot->'residents', '[]'::jsonb)) r
      WHERE r.value = p_workforce_id::text
    ) THEN
      v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
        'grid_label', 'GOP Clinic Grid',
        'date_or_day', v_slot->>'date_or_day',
        'assignment_detail', v_slot->>'clinic_type'
      ));
    END IF;
  END LOOP;

  FOR v_slot IN SELECT value FROM jsonb_array_elements(coalesce(v_roster.emergency_call_grid->'shifts', '[]'::jsonb))
  LOOP
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(coalesce(v_slot->'on_call', '[]'::jsonb)) r
      WHERE r.value = p_workforce_id::text
    ) THEN
      v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
        'grid_label', 'A&E Emergency Grid',
        'date_or_day', v_slot->>'date_or_day',
        'assignment_detail', v_slot->>'shift'
      ));
    END IF;
  END LOOP;

  FOR v_slot IN SELECT value FROM jsonb_array_elements(coalesce(v_roster.satellite_grid->'postings', '[]'::jsonb))
  LOOP
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(coalesce(v_slot->'assigned', '[]'::jsonb)) r
      WHERE r.value = p_workforce_id::text
    ) THEN
      v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
        'grid_label', 'Satellite Grid',
        'date_or_day', v_slot->>'date_or_day',
        'assignment_detail', v_slot->>'facility'
      ));
    END IF;
  END LOOP;

  FOR v_slot IN SELECT value FROM jsonb_array_elements(coalesce(v_roster.supervision_grid->'duties', '[]'::jsonb))
  LOOP
    IF public._normalize_supervision_name(v_slot->>'first_on_duty') = public._normalize_supervision_name(v_full_name) THEN
      v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
        'grid_label', 'Supervision Grid',
        'date_or_day', v_slot->>'date_or_day',
        'assignment_detail', '1st On Duty'
      ));
    ELSIF public._normalize_supervision_name(v_slot->>'second_on_duty') = public._normalize_supervision_name(v_full_name) THEN
      v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
        'grid_label', 'Supervision Grid',
        'date_or_day', v_slot->>'date_or_day',
        'assignment_detail', '2nd On Duty'
      ));
    END IF;
  END LOOP;

  IF jsonb_array_length(v_assignments) = 0 THEN
    RETURN QUERY SELECT 'published_no_assignment'::text, v_roster.month, v_roster.year, '[]'::jsonb;
  ELSE
    RETURN QUERY SELECT 'published_with_assignment'::text, v_roster.month, v_roster.year, v_assignments;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resident_get_current_assignment(uuid, text) TO anon, authenticated;

-- ====================================================================
-- LIVE VERIFICATION PLAN FOR DEPLOYMENT (not run in this LOCAL-ONLY slice
-- — documented here per this task's own explicit "add a live verification
-- plan, do not mutate live DB" instruction; methodology mirrors migrations
-- 76/77's own live-test discipline exactly)
-- ====================================================================
-- Fixtures: disposable synthetic Supabase Auth users (service-role admin
-- API, throwaway passwords) + disposable synthetic tenant/workforce/
-- organisation_memberships rows (direct SQL, bypassing RLS as postgres),
-- all removed in a finally block and independently re-verified absent
-- afterward via a separate read-only query — same discipline as
-- migrations 76/77.
--
-- Effective-privilege proof (before any behavioral test): information_
-- schema.routine_privileges confirms _resident_authenticated_membership_
-- match has no anon/PUBLIC EXECUTE grant; role_table_grants confirms
-- organisation_memberships gains no new grant of any kind; pg_get_
-- functiondef confirms resident_get_current_full_roster, resident_get_
-- roster_section_presentation, resident_set_email, verify_resident_login,
-- and every chief_* RPC are BYTE-IDENTICAL before/after applying —
-- untouched, proven not merely asserted.
--
-- Behavioral matrix (maps directly onto this task's own required
-- verification list):
--   - authenticated claimed active resident succeeds without resident
--     code (p_code = NULL or a deliberately wrong string — the call must
--     still succeed and must not even depend on p_code's value);
--   - restored authenticated session (fresh client, no code in memory)
--     succeeds identically;
--   - legacy unclaimed resident succeeds with valid code, auth.uid() NULL;
--   - wrong legacy code rejected (unchanged pre-existing behavior);
--   - active authenticated membership takes precedence over the code path
--     (a synthetic user with BOTH a valid active membership AND their
--     real resident_code available must still succeed when p_code is
--     intentionally wrong, proving the strong path alone decided it);
--   - a synthetic user with an active membership for workforce A cannot
--     use any code to read workforce B's assignment by passing
--     p_workforce_id = B (the membership match is workforce-scoped);
--   - a synthetic user with active memberships in two different tenants
--     can read ONLY the specific workforce row each respective membership
--     names, never the other tenant's;
--   - a tenant-admin-only membership (workforce_id IS NULL) never
--     authorizes any p_workforce_id;
--   - status='suspended' and status='revoked' memberships never
--     authorize the strong path (two separate synthetic rows, one per
--     status);
--   - an inactive workforce row is rejected via both paths;
--   - legacy_code_disabled_at IS NOT NULL blocks the legacy path for a
--     synthetic user with no matching active membership;
--   - a synthetic user with an ACTIVE matching membership AND
--     legacy_code_disabled_at IS NOT NULL on that same row still succeeds
--     via the strong path (proving the two facts are independent, per
--     this task's own locked decision);
--   - no p_tenant_id parameter exists to exploit (structural, confirmed
--     by scripts/verify-migration-78.cjs, not a live test);
--   - returned status/month/year/assignments shape and content are
--     confirmed identical to a pre-migration snapshot of the same
--     synthetic published roster fixture, for both the legacy-path and
--     strong-path callers;
--   - resident_get_current_full_roster, resident_get_roster_section_
--     presentation, resident_set_email, verify_resident_login, and every
--     chief_* RPC are confirmed byte-identical before/after applying.
--
-- Concurrency: not newly introduced by this migration — no new write to
-- organisation_memberships occurs anywhere in this file (this slice is
-- read-only against that table), so no new race exists beyond what
-- migration 77 already proved safe for writes to it.
-- ====================================================================
