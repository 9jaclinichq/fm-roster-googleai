-- ====================================================================
-- Migration 73: resident_get_current_full_roster() — resident-facing
-- read-only projection of the ENTIRE currently published roster
-- ====================================================================
-- WRITTEN FOR REVIEW ONLY. NOT APPLIED LIVE. Do not run this against the
-- live database until a human explicitly lifts the current deployment
-- freeze and applies it (same discipline as migrations 66, 67, 70, 71, 72).
--
-- WHY THIS EXISTS: residents currently have no way to see the whole
-- department's roster — only their own matched slots via
-- resident_get_current_assignment() (migrations 67/70/71/72). This adds a
-- SEPARATE, NEW function (does not touch resident_get_current_assignment
-- at all — that function, and My Assignment's behavior, are completely
-- unaffected by this migration) following the exact same credential/
-- tenant/published-state pattern, but returning the complete four-grid
-- structured publication instead of one resident's own matches.
--
-- SECURITY: combined_master_rosters' own RLS (migration 10) is
-- `USING (true)` for anon/authenticated on SELECT — a direct client read
-- would expose every tenant's every roster row, including drafts. This
-- function is the sanctioned path: SECURITY DEFINER, re-verifies
-- workforce_id + resident_code + active = true server-side on every call
-- (no session/JWT, identical reverification block to
-- resident_get_current_assignment), derives tenant_id only from the
-- verified workforce row (never a client-supplied parameter), and reads
-- only that tenant's currently `published` roster for its currently-open
-- collection. A draft/chief_review roster, or another tenant's roster, is
-- never reachable through this function no matter what is passed in.
--
-- WORKFORCE NAME RESOLUTION, SERVER-SIDE, NOT CLIENT-SIDE: GOP/A&E/
-- Satellite slots store `workforce_id` arrays (`consultants`/`residents`/
-- `on_call`/`assigned`); Supervision duties already store plain full_name
-- text (`first_on_duty`/`second_on_duty`, unchanged, no resolution
-- needed). Rather than have the resident client resolve a whole roster's
-- worth of workforce_ids into names itself (which would need broad
-- workforce reads well beyond "my own record"), this migration adds a
-- small helper, `_resolve_workforce_names(ids jsonb, tenant uuid)`, that
-- resolves each id to that tenant member's full_name, tenant-scoped, and
-- falls back to the raw stored string unchanged when it does not resolve
-- to a known workforce row in that tenant (this already happens today for
-- unresolved free-text names left over from ingestion — see
-- rosterReconciliation.ts's own tolerance for exactly this shape; nothing
-- new is fabricated, an unresolvable entry is shown exactly as stored).
-- Order is preserved via WITH ORDINALITY. This keeps the returned payload
-- already-safe, human-readable structured data — no second, broader
-- workforce query is ever required by the resident frontend.
--
-- THREE-STATE CONTRACT, ADAPTED (intentional, disclosed): the personal
-- My Assignment RPC has three states because "did THIS resident get
-- matched" is a real question with a real "no" answer
-- (published_no_assignment). A whole-roster view has no equivalent
-- per-caller match to fail — the roster either exists (published) or it
-- doesn't (not_published) for this resident's tenant's current cycle.
-- This function therefore returns a TWO-state status:
-- 'not_published' | 'published' — the 'not_published' half of the
-- contract (no current collection, or the collection's roster is not yet
-- published) is preserved byte-for-byte in meaning from the existing
-- function; there is no equivalent to 'published_no_assignment' here by
-- design, not omission.
--
-- RETURN SHAPE: the same four grid jsonb shapes already used everywhere
-- else in this app (GopClinicGrid/EmergencyCallGrid/SupervisionGrid/
-- SatelliteGrid), so the existing frontend types need no reshaping —
-- only the assignee arrays are resolved to display names; every other
-- field (date_or_day, clinic_type, shift, facility, unparsed_notes) is
-- passed through verbatim, preserving all retained notes/footnotes
-- exactly as stored. `not_published` returns all four grids as
-- '{"slots":[],"unparsed_notes":[]}'-shaped empty structures (matching
-- each grid's own empty shape) rather than null, so the frontend never
-- has to special-case a missing key.
--
-- MULTI-TENANCY: no UCH Family Medicine-specific term (GOP/A&E/NHIA/
-- Triage/etc.) appears anywhere in this migration's actual SQL code —
-- every field name here (`slots`, `shifts`, `duties`, `postings`,
-- `date_or_day`, `clinic_type`, `shift`, `facility`,
-- `first_on_duty`/`second_on_duty`, `unparsed_notes`) is the existing
-- generic storage shape already used by every other roster surface in
-- this app; section/service-point VALUES are always opaque
-- organization-supplied data, never referenced by literal value here.
-- Tenant-configurable display labels/colors (roster_section_config) are
-- explicitly out of scope for this migration — the frontend uses the
-- existing stored `grid_label`-equivalent section identity as-is for now,
-- per this slice's own scope boundary.
-- ====================================================================

CREATE OR REPLACE FUNCTION public._resolve_workforce_names(p_ids jsonb, p_tenant_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(jsonb_agg(resolved ORDER BY ord), '[]'::jsonb)
  FROM (
    SELECT
      elem,
      ord,
      COALESCE(
        (SELECT w.full_name FROM workforce w WHERE w.id::text = elem AND w.tenant_id = p_tenant_id),
        elem
      ) AS resolved
    FROM jsonb_array_elements_text(coalesce(p_ids, '[]'::jsonb)) WITH ORDINALITY AS t(elem, ord)
  ) sub;
$$;

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
BEGIN
  -- Reverify the caller server-side — identical block to
  -- resident_get_current_assignment (migrations 67-72). No session/JWT
  -- exists under the current transitional resident login model, so this
  -- in-call reverification is the entire authorization boundary.
  SELECT w.tenant_id INTO v_tenant_id
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

-- No explicit GRANT on _resolve_workforce_names — same convention as
-- migration 70's _normalize_supervision_name helper (never explicitly
-- granted; Postgres' default PUBLIC EXECUTE privilege on a newly created
-- function already covers it, and it is only ever called from within this
-- SECURITY DEFINER function, never directly by a client).
GRANT EXECUTE ON FUNCTION public.resident_get_current_full_roster(uuid, text) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 73
-- ====================================================================
