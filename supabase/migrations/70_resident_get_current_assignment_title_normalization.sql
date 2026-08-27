-- ====================================================================
-- Migration 70: resident_get_current_assignment() — Supervision/Priority
-- Dr-vs-Dr. title-normalization fix
-- ====================================================================
-- WRITTEN FOR REVIEW ONLY. NOT APPLIED LIVE. Do not run this against the
-- live database until a human explicitly lifts the current deployment
-- freeze and applies it (same discipline as migrations 66 and 67).
--
-- WHY THIS EXISTS: migration 67's resident_get_current_assignment()
-- matches the Supervision grid by raw `first_on_duty`/`second_on_duty`
-- STRING EQUALITY against the authenticated member's workforce.full_name,
-- with zero normalization. The real September 2026 ingest evidenced a
-- concrete, live failure: every real Supervision/Priority duty in the
-- approved source documents is written as "Dr <Surname>" (no period),
-- while workforce.full_name is consistently stored as "Dr. <Surname>"
-- (with period) — so none of the 26 real September Supervision duties
-- can ever match any member through this RPC as originally written. The
-- identical defect was independently confirmed client-side in
-- src/modules/roster-engine/lib/rosterReconciliation.ts's
-- findGridAppearancesForMember(), fixed in the same slice as this
-- migration by reusing identityResolver.ts's canonical
-- normalizeForComparison() helper — this migration applies the identical
-- semantic here, in SQL, so the client and the RPC share one canonical
-- normalization contract rather than two subtly different
-- implementations.
--
-- LOCKED NORMALIZATION SEMANTIC (identical to the TypeScript side):
-- trim, collapse repeated internal whitespace, case-insensitive, strip
-- only a single leading "Dr" or "Dr." prefix followed by whitespace, then
-- compare the remaining string exactly (case-insensitively). This is
-- still exact identity matching after narrow title normalization — NOT
-- fuzzy matching, NOT surname-only matching, NOT edit distance, NOT a
-- general alias mechanism, and it does not normalize any other internal
-- punctuation or spelling. A name that differs beyond this narrow Dr/Dr.
-- title form (e.g. a genuine misspelling, or a different person
-- entirely) still correctly fails to match, exactly as before.
--
-- SCOPE: this migration changes ONLY the Supervision-grid comparison
-- inside resident_get_current_assignment(). Every other aspect of the
-- function is preserved byte-for-byte from migration 67: signature,
-- SECURITY DEFINER, SET search_path = public, the credential
-- reverification block (workforce_id + resident_code + active = true),
-- tenant scoping derived only from the verified workforce row, the
-- current_collection_id / published-only roster lookup, the three-state
-- contract (not_published / published_no_assignment /
-- published_with_assignment), the GOP clinic grid workforce_id-matching
-- loop, the A&E emergency grid workforce_id-matching loop, the Satellite
-- grid workforce_id-matching loop (including its date_or_day-present
-- guard), the returned fields, and the GRANT EXECUTE statement. No other
-- function, table, RLS policy, or grant is touched by this migration.
--
-- NEW: a small, private, IMMUTABLE SQL helper
-- (public._normalize_supervision_name) implementing the locked semantic
-- above, used only by this function's Supervision-matching block.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._normalize_supervision_name(name text)
RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(regexp_replace(trim(coalesce(name, '')), '\s+', ' ', 'g'), '^dr\.?\s+', '', 'i'));
$$;

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

  -- GOP Clinic Grid — workforce_id match.
  FOR v_slot IN SELECT value FROM jsonb_array_elements(coalesce(v_roster.gop_clinic_grid->'slots', '[]'::jsonb))
  LOOP
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(coalesce(v_slot->'residents', '[]'::jsonb)) r
      WHERE r.value = p_workforce_id::text
    ) THEN
      v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
        'grid_label', 'GOP Clinic Grid',
        'date_or_day', v_slot->>'date_or_day'
      ));
    END IF;
  END LOOP;

  -- A&E Emergency Grid — workforce_id match.
  FOR v_slot IN SELECT value FROM jsonb_array_elements(coalesce(v_roster.emergency_call_grid->'shifts', '[]'::jsonb))
  LOOP
    IF EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(coalesce(v_slot->'on_call', '[]'::jsonb)) r
      WHERE r.value = p_workforce_id::text
    ) THEN
      v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
        'grid_label', 'A&E Emergency Grid',
        'date_or_day', v_slot->>'date_or_day'
      ));
    END IF;
  END LOOP;

  -- Satellite Grid — workforce_id match, only when date_or_day is present
  -- (parity with MultiRosterManagerView.tsx's own short-circuit check).
  FOR v_slot IN SELECT value FROM jsonb_array_elements(coalesce(v_roster.satellite_grid->'postings', '[]'::jsonb))
  LOOP
    IF nullif(v_slot->>'date_or_day', '') IS NOT NULL AND EXISTS (
      SELECT 1 FROM jsonb_array_elements_text(coalesce(v_slot->'assigned', '[]'::jsonb)) r
      WHERE r.value = p_workforce_id::text
    ) THEN
      v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
        'grid_label', 'Satellite Grid',
        'date_or_day', v_slot->>'date_or_day'
      ));
    END IF;
  END LOOP;

  -- Supervision Grid — title-normalized full_name match (migration 70).
  -- Was raw string equality (migration 67); now compares
  -- _normalize_supervision_name() of both sides, so "Dr Name" and
  -- "Dr. Name" correctly identify the same member when the remainder of
  -- the normalized name is identical. Still exact identity matching, not
  -- fuzzy — a genuinely different or misspelled name still fails to match.
  FOR v_slot IN SELECT value FROM jsonb_array_elements(coalesce(v_roster.supervision_grid->'duties', '[]'::jsonb))
  LOOP
    IF public._normalize_supervision_name(v_slot->>'first_on_duty') = public._normalize_supervision_name(v_full_name)
       OR public._normalize_supervision_name(v_slot->>'second_on_duty') = public._normalize_supervision_name(v_full_name) THEN
      v_assignments := v_assignments || jsonb_build_array(jsonb_build_object(
        'grid_label', 'Supervision Grid',
        'date_or_day', v_slot->>'date_or_day'
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
-- END OF MIGRATION 70
-- ====================================================================
