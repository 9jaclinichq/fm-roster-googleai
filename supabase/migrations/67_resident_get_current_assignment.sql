-- ====================================================================
-- Migration 67: resident_get_current_assignment() — member-facing
-- "My Assignment" read RPC (Workforce live-cycle integration slice)
-- ====================================================================
-- WRITTEN FOR REVIEW ONLY. NOT APPLIED LIVE. Do not run this against the
-- live database until a human explicitly lifts the current deployment
-- freeze and applies it (same discipline as migration 66).
--
-- WHY THIS EXISTS: combined_master_rosters has no RLS beyond
-- `USING (true)` for SELECT/INSERT/UPDATE to anon/authenticated (migration
-- 10), and gained a tenant_id column (migration 11) that RLS was never
-- tightened around. A direct table read from any member-facing client
-- would therefore return every tenant's entire roster grids, including
-- unpublished drafts — confirmed by source/migration inspection during
-- this slice's DISCOVER pass, not fixed here (broad RLS remediation is an
-- explicit non-goal). This function is the only sanctioned path for a
-- member to read roster data: it runs SECURITY DEFINER (bypassing RLS
-- under its own, narrowly-scoped logic) and returns only that one
-- member's own extracted appearances, never the table's rows.
--
-- CREDENTIAL MODEL: identical to verify_resident_login()/resident_set_email()
-- (migration 64) — (p_workforce_id, p_code) is reverified server-side on
-- every call, independent of any client-held session state. There is no
-- p_target_workforce_id parameter: the only identity this function can
-- ever resolve is the one that authenticates via p_code, so one member can
-- never request another member's assignment by passing a different id.
--
-- "CURRENT PUBLISHED ROSTER" — authoritative definition (not "latest row
-- wins"): the tenant's settings.current_collection_id singleton pointer
-- (migration 23) identifies the active collection; combined_master_rosters
-- has UNIQUE(collection_id), so at most one roster row can match; that row
-- must additionally have status = 'published'. A draft/chief_review roster
-- for the current collection is never returned, and there is no fallback
-- to any prior month's roster (roster history is an explicit non-goal).
--
-- GRID MATCHING PARITY — this function's four-grid scan reproduces
-- src/modules/roster-engine/lib/rosterReconciliation.ts's
-- findGridAppearancesForMember() exactly, field-for-field:
--   - gop_clinic_grid.slots[].residents   (uuid array) -> match by workforce_id
--   - emergency_call_grid.shifts[].on_call (uuid array) -> match by workforce_id
--   - satellite_grid.postings[].assigned   (uuid array) -> match by workforce_id,
--     but ONLY when postings[].date_or_day is present (a posting missing
--     date_or_day is skipped even if assigned — mirrors
--     MultiRosterManagerView.tsx's own
--     `posting.date_or_day && posting.assigned.includes(member.id)` check)
--   - supervision_grid.duties[].first_on_duty / second_on_duty (text) ->
--     match by workforce.full_name STRING EQUALITY ONLY. This is a
--     pre-existing, disclosed limitation of the grid data model itself
--     (MultiRosterManagerView's assignToSupervisionDuty stores a resident's
--     name, not their id) — NOT something this migration repairs.
--     Supervision identity redesign is an explicit non-goal of this slice.
--     A member whose full_name has changed since a supervision assignment
--     was made will silently miss that assignment, exactly as the existing
--     reconciliation code already documents and exactly as
--     scripts/verify-my-assignment.cjs's renamed-member test asserts.
--
-- THREE-STATE CONTRACT (locked, not "latest row wins" nor a boolean):
--   'not_published'             — no combined_master_rosters row exists
--                                  for the tenant's current collection, or
--                                  it exists but is not status='published'
--   'published_no_assignment'   — the current roster is published, but
--                                  zero grid appearances were found for
--                                  this member
--   'published_with_assignment' — one or more appearances found; supports
--                                  a member appearing in more than one
--                                  grid/day in the same cycle (assignments
--                                  is always an array, never assumed to be
--                                  exactly one string)
--
-- RETURNED FIELDS ARE MINIMAL: only {grid_label, date_or_day} pairs plus
-- month/year of the roster. Never the full grid JSON, never any other
-- member's id/name, never draft content.
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

  -- Supervision Grid — full_name STRING match only (see header note).
  FOR v_slot IN SELECT value FROM jsonb_array_elements(coalesce(v_roster.supervision_grid->'duties', '[]'::jsonb))
  LOOP
    IF (v_slot->>'first_on_duty') = v_full_name OR (v_slot->>'second_on_duty') = v_full_name THEN
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
-- END OF MIGRATION 67
-- ====================================================================
