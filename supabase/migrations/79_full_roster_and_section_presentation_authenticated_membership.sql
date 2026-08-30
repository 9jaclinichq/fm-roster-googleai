-- ====================================================================
-- Migration 79: resident_get_current_full_roster() and
-- resident_get_roster_section_presentation() — authenticated
-- institutional membership authorization, coexisting with legacy
-- resident-code login (Institutional Identity Slice 2c.2)
-- ====================================================================
-- WRITTEN FOR REVIEW ONLY. NOT APPLIED LIVE. LOCAL ONLY per this slice's
-- own explicit boundary ("LOCAL ONLY / NOT APPLIED. No live DB mutation.
-- No push. No deployment. Freeze remains ACTIVE."). Do not run this
-- against the live database until a human explicitly lifts the current
-- deployment freeze and separately approves applying it (same discipline
-- as every migration since 66).
--
-- REVIEWED PATTERN: exactly migration 78's own authenticated-membership-
-- first structural precedence, extended to the two remaining read-only
-- resident RPCs prompt1.txt named as the next bounded slice (Full Roster,
-- roster-section presentation). NOT a second authorization model — the
-- same helper, the same precedence, the same legacy-fallback guard.
--
-- HELPER REUSE, NOT REINVENTION: _resident_authenticated_membership_match
-- (uuid) already exists (migration 78), is already internal-only (EXECUTE
-- revoked from PUBLIC/anon/authenticated), and already derives everything
-- this migration needs (auth.uid(), tenant via a join to the workforce
-- row, is_workforce_member=true, status='active', workforce.active=true)
-- from a single p_workforce_id argument — no p_tenant_id, no caller-
-- supplied identity of any kind. Its contract fits both RPCs below
-- exactly as-is; this migration does NOT modify it and does NOT create a
-- second helper.
--
-- SCOPE: migrates ONLY resident_get_current_full_roster (migration 73)
-- and resident_get_roster_section_presentation (migration 74). Does NOT
-- touch resident_set_email, verify_resident_login, resident_get_current_
-- assignment (already migrated, migration 78, untouched here), any
-- chief_* RPC (including chief_get_roster_section_config/chief_upsert_
-- roster_section_config, the Chief-facing configuration write/read path
-- — a completely different function pair, never referenced by either
-- change below), or migrations 73/74/78 themselves (this file only adds
-- new CREATE OR REPLACE statements for the two functions named above;
-- migrations 73/74/78's own files on disk are untouched). Confirmed
-- structurally by scripts/verify-migration-79.cjs.
--
-- SIGNATURES: UNCHANGED for both — still exactly (p_workforce_id uuid,
-- p_code text). RETURNS TABLE shapes UNCHANGED for both. No DROP FUNCTION
-- needed for either (neither the parameter list nor the return-column
-- list changes — only each function BODY gains the same credential block
-- migration 78 already introduced). No PostgREST overload is introduced.
--
-- THE PL/PGSQL "AMBIGUOUS COLUMN" GOTCHA FROM MIGRATION 77, CHECKED AND
-- CONFIRMED NOT APPLICABLE TO EITHER FUNCTION: resident_get_current_full_
-- roster's RETURNS TABLE OUT-parameters are status/month/year/gop_
-- clinic_grid/emergency_call_grid/supervision_grid/satellite_grid —
-- combined_master_rosters.status IS a real column referenced in this
-- body, but always as the alias-qualified cmr.status, never bare, so no
-- ambiguity exists (same reasoning already confirmed for migration 78's
-- resident_get_current_assignment). resident_get_roster_section_
-- presentation's OUT-parameters are section_key/display_label/short_
-- label/display_order/accent_color/icon — none of these collide with any
-- workforce/organisation_memberships column referenced by the new
-- credential block (auth_user_id, workforce_id, tenant_id, status,
-- is_workforce_member, active are all either not OUT-parameter names here
-- or, for the ones that could theoretically appear, are never referenced
-- as bare identifiers in this function's own body — the new block only
-- assigns v_tenant_id, a plain local variable, exactly like migration 78).
--
-- SECURITY / GRANTS: NEITHER function's own GRANT changes (both keep
-- GRANT EXECUTE ... TO anon, authenticated, unchanged from migrations
-- 73/74) — this migration does not change who may attempt to call either
-- RPC, only what each does once called. _resident_authenticated_
-- membership_match's own REVOKE/GRANT state (migration 78, corrected
-- during that slice's own deployment review to explicitly revoke from
-- PUBLIC, anon, AND authenticated) is completely untouched by this file —
-- no REVOKE/GRANT statement referencing it appears anywhere below. No new
-- SECURITY DEFINER function of any kind is introduced by this migration.
-- organisation_memberships gains no new grant of any kind — both
-- functions only ever read it via the existing helper, inside their own
-- already-SECURITY-DEFINER context, exactly as migration 78 established.
-- No base-table RLS is touched anywhere in this file.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.resident_get_current_full_roster(p_workforce_id uuid, p_code text)
RETURNS TABLE (
  status text,
  month integer,
  year integer,
  gop_clinic_grid jsonb,
  emergency_call_grid jsonb,
  supervision_grid jsonb,
  satellite_grid jsonb
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_current_collection_id uuid;
  v_roster combined_master_rosters%ROWTYPE;
  v_gop jsonb;
  v_emergency jsonb;
  v_satellite jsonb;
  -- Same structural-precedence flag migration 78 introduced for
  -- resident_get_current_assignment — the strong path is attempted first
  -- and unconditionally, every call; p_code is never even inspected while
  -- this remains true, closing the weaker path entirely for a matching
  -- caller, not merely leaving it unused.
  v_authorized boolean := false;
BEGIN
  -- Strong path (migration 79, reusing migration 78's own helper
  -- unchanged). auth.uid() IS NULL is the ordinary case for a caller with
  -- no Supabase Auth session at all — the helper call is skipped entirely
  -- at zero cost for them, and the legacy path below is completely
  -- unaffected.
  IF auth.uid() IS NOT NULL AND public._resident_authenticated_membership_match(p_workforce_id) THEN
    v_authorized := true;
    SELECT w.tenant_id INTO v_tenant_id FROM workforce w WHERE w.id = p_workforce_id;
  END IF;

  IF NOT v_authorized THEN
    -- Legacy fallback: reverify the caller server-side — identical block
    -- to resident_get_current_assignment (migrations 67-72/78) and
    -- resident_get_current_full_roster's own migration-73 original — now
    -- additionally gated by the same legacy_code_disabled_at guard
    -- migration 77 added to verify_resident_login and migration 78 added
    -- to resident_get_current_assignment, extended here for the first
    -- time to this RPC.
    SELECT w.tenant_id INTO v_tenant_id
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

  -- Everything below this point is BYTE-FOR-BYTE UNCHANGED from migration
  -- 73 — tenant-scoped published-roster lookup, the two-state contract,
  -- workforce-name resolution via _resolve_workforce_names, and the final
  -- RETURN QUERY shape. This migration's only behavioral change is the
  -- credential block above.

  -- Tenant is derived from the verified workforce row only, via either
  -- path above — never a client-supplied parameter. This is what prevents
  -- a valid member from ever reading another tenant's roster.
  SELECT s.current_collection_id INTO v_current_collection_id
  FROM settings s
  WHERE s.tenant_id = v_tenant_id;

  IF v_current_collection_id IS NULL THEN
    RETURN QUERY SELECT
      'not_published'::text, NULL::integer, NULL::integer,
      '{"slots":[],"unparsed_notes":[]}'::jsonb,
      '{"shifts":[],"unparsed_notes":[]}'::jsonb,
      '{"duties":[],"unparsed_notes":[]}'::jsonb,
      '{"postings":[],"unparsed_notes":[]}'::jsonb;
    RETURN;
  END IF;

  SELECT * INTO v_roster
  FROM combined_master_rosters cmr
  WHERE cmr.collection_id = v_current_collection_id
    AND cmr.tenant_id = v_tenant_id
    AND cmr.status = 'published';

  IF NOT FOUND THEN
    -- Covers both "no roster row yet" and "row exists but still
    -- draft/chief_review" — a draft is never exposed through this
    -- function, exactly like resident_get_current_assignment.
    RETURN QUERY SELECT
      'not_published'::text, NULL::integer, NULL::integer,
      '{"slots":[],"unparsed_notes":[]}'::jsonb,
      '{"shifts":[],"unparsed_notes":[]}'::jsonb,
      '{"duties":[],"unparsed_notes":[]}'::jsonb,
      '{"postings":[],"unparsed_notes":[]}'::jsonb;
    RETURN;
  END IF;

  -- GOP Clinic Grid — resolve consultants[]/residents[] workforce_id
  -- arrays to display names, tenant-scoped; every other field
  -- (date_or_day, clinic_type) and unparsed_notes passed through verbatim.
  SELECT jsonb_build_object(
    'slots', COALESCE(jsonb_agg(jsonb_build_object(
      'date_or_day', slot->>'date_or_day',
      'clinic_type', slot->>'clinic_type',
      'consultants', public._resolve_workforce_names(slot->'consultants', v_tenant_id),
      'residents', public._resolve_workforce_names(slot->'residents', v_tenant_id)
    ) ORDER BY ord), '[]'::jsonb),
    'unparsed_notes', coalesce(v_roster.gop_clinic_grid->'unparsed_notes', '[]'::jsonb)
  ) INTO v_gop
  FROM jsonb_array_elements(coalesce(v_roster.gop_clinic_grid->'slots', '[]'::jsonb)) WITH ORDINALITY AS t(slot, ord);

  -- A&E Emergency Grid — resolve on_call[] the same way.
  SELECT jsonb_build_object(
    'shifts', COALESCE(jsonb_agg(jsonb_build_object(
      'date_or_day', shift->>'date_or_day',
      'shift', shift->>'shift',
      'on_call', public._resolve_workforce_names(shift->'on_call', v_tenant_id)
    ) ORDER BY ord), '[]'::jsonb),
    'unparsed_notes', coalesce(v_roster.emergency_call_grid->'unparsed_notes', '[]'::jsonb)
  ) INTO v_emergency
  FROM jsonb_array_elements(coalesce(v_roster.emergency_call_grid->'shifts', '[]'::jsonb)) WITH ORDINALITY AS t(shift, ord);

  -- Satellite Grid — resolve assigned[] the same way. date_or_day is
  -- passed through verbatim, including null for a period/range posting
  -- (migration 72) — never fabricated here either.
  SELECT jsonb_build_object(
    'postings', COALESCE(jsonb_agg(jsonb_build_object(
      'facility', posting->>'facility',
      'date_or_day', posting->>'date_or_day',
      'assigned', public._resolve_workforce_names(posting->'assigned', v_tenant_id)
    ) ORDER BY ord), '[]'::jsonb),
    'unparsed_notes', coalesce(v_roster.satellite_grid->'unparsed_notes', '[]'::jsonb)
  ) INTO v_satellite
  FROM jsonb_array_elements(coalesce(v_roster.satellite_grid->'postings', '[]'::jsonb)) WITH ORDINALITY AS t(posting, ord);

  -- Supervision Grid — first_on_duty/second_on_duty are ALREADY plain
  -- full_name text in storage (unlike the other three grids), so this is
  -- passed through completely unchanged, no resolution needed.
  RETURN QUERY SELECT
    'published'::text,
    v_roster.month,
    v_roster.year,
    v_gop,
    v_emergency,
    v_roster.supervision_grid,
    v_satellite;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resident_get_current_full_roster(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.resident_get_roster_section_presentation(p_workforce_id uuid, p_code text)
RETURNS TABLE (
  section_key text,
  display_label text,
  short_label text,
  display_order integer,
  accent_color text,
  icon text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_authorized boolean := false;
BEGIN
  IF auth.uid() IS NOT NULL AND public._resident_authenticated_membership_match(p_workforce_id) THEN
    v_authorized := true;
    SELECT w.tenant_id INTO v_tenant_id FROM workforce w WHERE w.id = p_workforce_id;
  END IF;

  IF NOT v_authorized THEN
    SELECT w.tenant_id INTO v_tenant_id
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

  -- Everything below this point is BYTE-FOR-BYTE UNCHANGED from migration
  -- 74 — the same fallback-merged resolution (COALESCE/NULLIF over
  -- roster_section_config LEFT JOINed to _roster_section_fallbacks()),
  -- section_key set, and display_order sort. This migration's only
  -- behavioral change is the credential block above. The Chief-facing
  -- configuration RPCs (chief_get_roster_section_config, chief_upsert_
  -- roster_section_config) are a completely separate function pair, never
  -- referenced here, and are not touched by this migration in any way.
  RETURN QUERY
  SELECT
    f.section_key,
    COALESCE(NULLIF(c.display_label, ''), f.display_label) AS display_label,
    COALESCE(NULLIF(c.short_label, ''), f.short_label) AS short_label,
    COALESCE(c.display_order, f.display_order) AS display_order,
    NULLIF(c.accent_color, '') AS accent_color,
    NULLIF(c.icon, '') AS icon
  FROM public._roster_section_fallbacks() f
  LEFT JOIN roster_section_config c ON c.tenant_id = v_tenant_id AND c.section_key = f.section_key
  ORDER BY COALESCE(c.display_order, f.display_order);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resident_get_roster_section_presentation(uuid, text) TO anon, authenticated;

-- ====================================================================
-- LIVE VERIFICATION PLAN FOR DEPLOYMENT (not run in this LOCAL-ONLY slice
-- — documented here per this repo's own established discipline for a
-- not-yet-applied migration; methodology mirrors migrations 76/77/78's
-- own live-test discipline exactly, applied to both functions below)
-- ====================================================================
-- Fixtures: disposable synthetic Supabase Auth users + disposable
-- synthetic tenant/workforce/organisation_memberships/roster_section_
-- config/combined_master_rosters rows (direct SQL, bypassing RLS as
-- postgres), all removed in a finally block and independently
-- re-verified absent afterward via a separate read-only query.
--
-- Effective-privilege proof (before any behavioral test): confirm
-- resident_get_current_full_roster and resident_get_roster_section_
-- presentation's own grants (anon, authenticated, PUBLIC, postgres,
-- service_role) are unchanged from their pre-79 snapshot; confirm
-- _resident_authenticated_membership_match's own grants remain exactly
-- {postgres, service_role} (unchanged by this migration, which touches no
-- REVOKE/GRANT for it); confirm organisation_memberships and roster_
-- section_config gain no new grant of any kind.
--
-- Behavioral matrix, for EACH of the two migrated RPCs (mirroring
-- migration 78's own required list): authenticated claimed active
-- resident succeeds without resident code (p_code = NULL or a
-- deliberately wrong string — the call must still succeed and must not
-- depend on p_code's value); restored authenticated session succeeds
-- identically; legacy unclaimed resident succeeds with valid code,
-- auth.uid() NULL; wrong legacy code rejected; a synthetic user with an
-- active membership for workforce A cannot read another tenant's/
-- workforce's content via A's own session without a valid code for that
-- other workforce; a multi-tenant user's session reads only the specific
-- workforce/tenant its own active membership names; a tenant-admin-only
-- membership never authorizes either RPC; status='suspended' and
-- status='revoked' memberships never authorize the strong path; an
-- inactive workforce is rejected via both paths; legacy_code_disabled_at
-- IS NOT NULL blocks the legacy path; a synthetic user with an ACTIVE
-- matching membership AND legacy_code_disabled_at IS NOT NULL on that
-- same row still succeeds via the strong path; no p_tenant_id parameter
-- exists to exploit (structural, confirmed by scripts/verify-migration-
-- 79.cjs); returned shape/content (full-roster's four grids and
-- two-state contract; presentation's section_key/display_label/short_
-- label/display_order/accent_color/icon and its fallback-merge
-- semantics) are confirmed identical between the legacy-path and
-- strong-path callers for the same synthetic fixtures, and identical to
-- resident_get_current_assignment's own already-live-verified shape
-- discipline. Also reconfirm: My Assignment (migration 78) remains green;
-- Chief roster-section configuration RPCs are confirmed byte-identical
-- before/after applying; roster revision/edit/publish RPCs untouched;
-- resident_set_email and verify_resident_login untouched beyond their
-- already-existing migration-64/77 behavior; Chief/admin login untouched;
-- no base-table RLS policy changed anywhere.
--
-- Concurrency: not newly introduced by this migration — no new write to
-- organisation_memberships or roster_section_config occurs anywhere in
-- this file (both migrated functions are read-only against every table
-- they touch), so no new race exists beyond what migrations 76/77 already
-- proved safe for writes to organisation_memberships.
-- ====================================================================
