-- ====================================================================
-- Migration 71: resident_get_current_assignment() — assignment_detail
-- (actual service point / shift / facility / duty position)
-- ====================================================================
-- WRITTEN FOR REVIEW ONLY. NOT APPLIED LIVE. Do not run this against the
-- live database until a human explicitly lifts the current deployment
-- freeze and applies it (same discipline as migrations 66, 67, and 70).
--
-- WHY THIS EXISTS: a legitimate resident-session positive-path test
-- (2026-08-27, real Supervision assignment for Dr. Ugwueze, exercising
-- migration 70's Dr-vs-Dr. fix) confirmed the RPC correctly recognizes
-- identity and returns real September assignments, but exposed a real
-- product/UX gap: every assignments[] entry has only {grid_label,
-- date_or_day} — e.g. "GOP Clinic Grid — Tue 01/09" — telling the
-- resident THAT they appear on the roster that day, but never WHAT/WHERE
-- their actual assignment is. This is genuinely discarded at the RPC
-- level: every one of the four matching loops already has the relevant
-- detail sitting in the same v_slot jsonb it iterates (clinic_type for
-- GOP, shift for A&E, facility for Satellite, and an implicit
-- first_on_duty-vs-second_on_duty distinction for Supervision) but never
-- selects it into the returned jsonb_build_object.
--
-- ONE STABLE GENERIC FIELD, NOT FOUR TENANT-SPECIFIC ONES: every entry
-- gains a single additional key, 'assignment_detail' (text), populated
-- generically per grid type:
--   - GOP Clinic Grid      -> the matched slot's clinic_type, verbatim
--   - A&E Emergency Grid   -> the matched shift's shift label, verbatim
--   - Satellite Grid       -> the matched posting's facility, verbatim
--   - Supervision Grid     -> the generic literal '1st On Duty' or
--                             '2nd On Duty', matching whichever of
--                             first_on_duty/second_on_duty matched
--
-- MULTI-TENANCY (important, do not weaken this in a future edit):
-- clinic_type/shift/facility are OPAQUE ORGANIZATION-SUPPLIED TEXT —
-- this function does not know or care what values an organization's own
-- roster data happens to use for them (UCH Family Medicine's data
-- happens to contain "Triage", "NHIA / Managed Care", "Ikolaba", etc.,
-- but nothing here references those specific strings; a different
-- organization's roster data would flow through identically with its own
-- section/service-point vocabulary). '1st On Duty'/'2nd On Duty' are the
-- only two literal strings introduced by this migration, and they are
-- generic scheduling English, not a UCH-specific term — the exact same
-- generic labels already hardcoded in the existing Chief-facing admin
-- editor (MultiRosterManagerView.tsx's Supervision tab), not new
-- vocabulary invented here. If both first_on_duty and second_on_duty
-- degenerately normalize-match the same caller (a data anomaly no real
-- roster should produce), '1st On Duty' is reported, deterministically,
-- via IF/ELSIF rather than the prior bare IF/OR — this is the only
-- behavioral branching change; which SLOTS match is completely
-- unchanged.
--
-- SCOPE: this migration changes ONLY the 4 jsonb_build_object(...) calls'
-- key sets (adding assignment_detail to each). Every other aspect of the
-- function is preserved byte-for-byte from migration 70: signature,
-- SECURITY DEFINER, SET search_path = public, the credential
-- reverification block, tenant scoping derived only from the verified
-- workforce row, the current_collection_id/published-only roster lookup,
-- the three-state contract, the GOP/A&E/Satellite workforce_id-matching
-- loops (identity matching logic itself is completely unchanged), the
-- Supervision _normalize_supervision_name() title-normalization matching
-- from migration 70 (reused verbatim, not touched), the returned
-- top-level shape (status/month/year/assignments), and the GRANT EXECUTE
-- statement. No other function, table, RLS policy, or grant is touched.
-- ====================================================================

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
BEGIN
  -- Reverify the caller server-side, same ratchet as verify_resident_login:
  -- workforce_id + resident_code + active=true. No session/JWT exists under
  -- the current transitional resident login model, so this in-call
  -- reverification is the entire authorization boundary — never trust that
  -- the client already completed a login this session.
  SELECT w.tenant_id, w.full_name INTO v_tenant_id, v_full_name
  FROM workforce w
  WHERE w.id = p_workforce_id
    AND w.resident_code = p_code
    AND w.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid access code' USING ERRCODE = '28000';
  END IF;

  -- Tenant is derived from the verified workforce row only — never a
  -- client-supplied parameter. This is what prevents a valid member from
  -- ever reading another tenant's roster.
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

  -- GOP Clinic Grid — workforce_id match. assignment_detail is the
  -- matched slot's own clinic_type, verbatim (opaque organization text).
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

  -- A&E Emergency Grid — workforce_id match. assignment_detail is the
  -- matched shift's own shift label, verbatim.
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

  -- Satellite Grid — workforce_id match, only when date_or_day is present
  -- (parity with MultiRosterManagerView.tsx's own short-circuit check).
  -- assignment_detail is the matched posting's own facility, verbatim.
  FOR v_slot IN SELECT value FROM jsonb_array_elements(coalesce(v_roster.satellite_grid->'postings', '[]'::jsonb))
  LOOP
    IF nullif(v_slot->>'date_or_day', '') IS NOT NULL AND EXISTS (
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

  -- Supervision Grid — title-normalized full_name match (migration 70's
  -- _normalize_supervision_name(), reused verbatim, untouched). Split into
  -- IF/ELSIF (was IF/OR) so assignment_detail can report exactly which
  -- generic duty position matched: '1st On Duty' for first_on_duty,
  -- '2nd On Duty' for second_on_duty. Which slots match is unchanged; only
  -- one label is now attached to each already-matched slot.
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
-- END OF MIGRATION 71
-- ====================================================================
