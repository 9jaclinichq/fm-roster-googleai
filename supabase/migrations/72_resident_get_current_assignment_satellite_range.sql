-- ====================================================================
-- Migration 72: resident_get_current_assignment() — Satellite/Special
-- Coverage postings with a null date_or_day (period/range postings)
-- ====================================================================
-- WRITTEN FOR REVIEW ONLY. NOT APPLIED LIVE. Do not run this against the
-- live database until a human explicitly lifts the current deployment
-- freeze and applies it (same discipline as migrations 66, 67, 70, 71).
--
-- WHY THIS EXISTS: a live-production, read-only investigation (2026-08-28,
-- prompted by Dr. Olanipekun's September Agbeke Mercy / Airport PHC / NYSC
-- Satellite postings never appearing in his My Assignment) confirmed:
--   - the postings exist correctly in the published
--     combined_master_rosters row, with his correct workforce_id present
--     in each posting's assigned[] array;
--   - his workforce record's identity (full_name, active, tenant) is
--     exact and unambiguous — this is NOT an identity-resolution defect;
--   - all three postings have date_or_day = null, because the source
--     document represented them as a whole-month period ("1-30 Sep")
--     rather than a single date, and no day-header format the parser
--     supports can represent a range — null is the correct, already
--     legitimate representation for this (SatellitePosting.date_or_day is
--     `string | null` at the type level; no separate period/range field
--     exists anywhere in the type, parser, or ingestion pipeline to
--     reuse instead);
--   - the RPC's Satellite-matching loop (migrations 67/70/71, unchanged
--     until this migration) required
--     `nullif(v_slot->>'date_or_day', '') IS NOT NULL` to be true BEFORE
--     it ever checked assigned[] membership — so a legitimately
--     null-dated posting was excluded from consideration entirely,
--     regardless of who is in assigned[]. This is a structural gap in
--     how month-long/open-ended postings are modeled, not specific to
--     this one resident.
--
-- THE FIX: drop the `nullif(v_slot->>'date_or_day', '') IS NOT NULL AND`
-- clause from the Satellite loop's IF condition, leaving only the
-- pre-existing `EXISTS (... assigned[] ...)` check — Satellite now
-- matches purely by assigned[] workforce membership, exactly the same
-- way GOP (`residents[]`) and A&E (`on_call[]`) already do. This is the
-- ONLY behavioral change in this migration.
--
-- NO FABRICATED DATES: `v_slot->>'date_or_day'` continues to be selected
-- verbatim into the returned jsonb_build_object, exactly as migrations
-- 67/70/71 already did. When the underlying value is SQL/JSON null, the
-- returned `date_or_day` is null — this migration does not invent a
-- "1-30 Sep" string, does not hardcode September, and does not hardcode
-- any other placeholder. A null-dated Satellite posting now truthfully
-- returns with `date_or_day: null` and its real `assignment_detail`
-- (the posting's own facility, unchanged from migration 71). Frontend
-- handling of a null/absent date_or_day is addressed separately in this
-- same slice (myAssignmentService.ts / MyAssignmentView.tsx), not in SQL.
--
-- SCOPE: this migration changes ONLY the Satellite loop's IF condition
-- (one boolean clause removed). Every other aspect of the function is
-- preserved byte-for-byte from migration 71: signature, SECURITY
-- DEFINER, SET search_path = public, the credential reverification
-- block, tenant scoping derived only from the verified workforce row,
-- the current_collection_id/published-only roster lookup, the
-- three-state contract, the GOP loop (identity matching and
-- assignment_detail unchanged), the A&E loop (identity matching and
-- assignment_detail unchanged), the Supervision loop (migration 70's
-- _normalize_supervision_name() title-normalization reused verbatim,
-- migration 71's IF/ELSIF assignment_detail unchanged), the Satellite
-- loop's own assignment_detail selection (`v_slot->>'facility'`,
-- unchanged) and EXISTS/assigned[] membership check (unchanged), the
-- returned top-level shape (status/month/year/assignments), and the
-- GRANT EXECUTE statement. No other function, table, RLS policy, or
-- grant is touched. Identity and tenant-isolation checks are not
-- weakened anywhere by this change.
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

  -- Satellite Grid — workforce_id match by assigned[] membership only,
  -- same as GOP/A&E above. Migration 72: the prior
  -- `nullif(v_slot->>'date_or_day', '') IS NOT NULL AND` guard is REMOVED
  -- — a legitimately null-dated (period/range) posting is no longer
  -- excluded before its assigned[] membership is even checked. See this
  -- migration's header for the full rationale. assignment_detail remains
  -- the matched posting's own facility, verbatim; date_or_day is still
  -- selected verbatim (may now legitimately be null — not fabricated).
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

  -- Supervision Grid — title-normalized full_name match (migration 70's
  -- _normalize_supervision_name(), reused verbatim, untouched). IF/ELSIF
  -- (migration 71) so assignment_detail can report exactly which generic
  -- duty position matched: '1st On Duty' for first_on_duty, '2nd On Duty'
  -- for second_on_duty. Completely unchanged by this migration.
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
-- END OF MIGRATION 72
-- ====================================================================
