-- ====================================================================
-- Migration 74: roster_section_config — tenant-configurable roster
-- presentation (display label / short label / order / color / icon)
-- ====================================================================
-- WRITTEN FOR REVIEW ONLY. NOT APPLIED LIVE. Do not run this against the
-- live database until a human explicitly lifts the current deployment
-- freeze and applies it (same discipline as migrations 66-73).
--
-- WHY THIS EXISTS: today, "GOP Clinic Grid" / "A&E Emergency Grid" /
-- "Supervision Grid" / "Satellite Grid" are literal strings baked into
-- resident_get_current_assignment() (migrations 67/70/71/72, UNCHANGED by
-- this migration) and into FullRosterView.tsx's own constants. UCH Family
-- Medicine is only one tenant/use case, and a different organization's
-- roster would want its own section names, order, and accent color. This
-- migration adds the smallest schema that lets an authorized Chief/Admin
-- configure PRESENTATION ONLY per roster section, while every stable
-- internal identifier (section_key, and every existing RPC's own matching
-- logic/return shape) stays completely unchanged.
--
-- STABLE IDENTIFIERS VS DISPLAY VOCABULARY: `section_key` is one of
-- exactly 4 fixed, generic, ALREADY-EXISTING internal identifiers —
-- 'gop' / 'emergency' / 'supervision' / 'satellite' — the same stable
-- keys implicit in combined_master_rosters' own column names
-- (gop_clinic_grid, emergency_call_grid, supervision_grid,
-- satellite_grid) and in FullRosterView.tsx's RosterSection.key (migration
-- 73). These are structural/internal, not UCH vocabulary — no
-- organization-specific term (GOP, NHIA, Ikolaba, Triage, A&E, Priority,
-- Agbeke, Airport, NYSC, etc.) is used AS A KEY, matching condition, or
-- piece of business logic anywhere in this migration. The only place any
-- of that vocabulary appears is as the DEFAULT/FALLBACK display_label
-- text for UCH's own current tenant row (see _roster_section_fallbacks()
-- below) — i.e. presentation data, exactly mirroring the instruction to
-- "define deterministic fallback labels/order using the current
-- behavior." A different tenant simply configures different text; the
-- section_key set itself never changes and nothing here assumes a fixed
-- clinical taxonomy beyond these 4 already-existing internal grid keys.
--
-- COLOR/ICON ARE PRESENTATION METADATA ONLY: no matching, validation, or
-- business logic anywhere in this schema or in resident_get_current_
-- assignment/resident_get_current_full_roster reads or depends on
-- accent_color/icon. A missing or invalid value simply resolves to NULL
-- (see the resolver RPCs below) — frontend components must render safely
-- with no color/icon present; a textual label is always returned
-- regardless of color/icon configuration.
--
-- SECURITY MODEL: `roster_section_config` has RLS ENABLED with ZERO
-- policies defined — by Postgres default-deny, this means NO
-- anon/authenticated client can SELECT/INSERT/UPDATE this table directly
-- under any circumstance, stricter than this schema's historical
-- permissive-by-default posture (see CLAUDE.md Security Notes) and
-- deliberately so, per this slice's own explicit instruction: "Do not
-- expose broad tenant configuration tables directly if existing
-- RLS/security architecture makes an RPC safer." All access is mediated
-- by three SECURITY DEFINER RPCs below, each re-verifying the caller
-- exactly like every existing resident/chief RPC in this schema:
--   - resident_get_roster_section_presentation(): resident-facing,
--     READ ONLY, credential-reverified (workforce_id+resident_code+
--     active=true, identical block to resident_get_current_assignment),
--     tenant derived only from the verified workforce row. An ordinary
--     resident has no write path to this table at all.
--   - chief_get_roster_section_config() / chief_upsert_roster_section_
--     config(): Chief-facing, admin-code-verified (identical pattern to
--     chief_update_tenant_terminology, migration 59) — tenant derived
--     only from settings.admin_access_code, never a client-supplied
--     tenant_id, so a Chief can never read or write another tenant's
--     configuration.
-- No existing RLS policy on any other table is modified. No existing RPC
-- (resident_get_current_assignment, resident_get_current_full_roster) is
-- touched — both are byte-for-byte unchanged by this migration.
--
-- FALLBACK/PARTIAL-CONFIGURATION BEHAVIOR: both read RPCs LEFT JOIN the
-- fixed 4-row fallback set against whatever configuration actually
-- exists for the caller's tenant, and resolve EACH FIELD independently —
-- COALESCE(NULLIF(configured_value, ''), fallback_value) for
-- display_label/short_label/display_order, and NULLIF(..., '') alone for
-- accent_color/icon (which have no fallback text, only "absent"). A
-- tenant with zero configuration rows receives exactly today's current
-- behavior; a tenant that configured only, say, a color for one section
-- still receives correct fallback labels/order for every unconfigured
-- field — partial configuration can never break rendering.
-- ====================================================================

CREATE TABLE IF NOT EXISTS roster_section_config (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  section_key text NOT NULL CHECK (section_key IN ('gop', 'emergency', 'supervision', 'satellite')),
  display_label text,
  short_label text,
  display_order integer,
  accent_color text,
  icon text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_roster_section_config_per_tenant_section UNIQUE (tenant_id, section_key)
);

ALTER TABLE roster_section_config ENABLE ROW LEVEL SECURITY;
-- Deliberately NO POLICIES — see SECURITY MODEL above. Every read/write
-- goes through a SECURITY DEFINER RPC.

-- Single source of truth for "today's current behavior" fallback —
-- referenced by every resolver RPC below so the 4 defaults are declared
-- exactly once, not duplicated. IMMUTABLE: pure literal data, no table
-- reads, safe to inline/fold by the planner.
CREATE OR REPLACE FUNCTION public._roster_section_fallbacks()
RETURNS TABLE (section_key text, display_label text, short_label text, display_order integer)
LANGUAGE sql IMMUTABLE AS $$
  VALUES
    ('gop', 'GOP Clinic Grid', 'GOP', 1),
    ('emergency', 'A&E Emergency Grid', 'A&E', 2),
    ('supervision', 'Supervision Grid', 'Supervision', 3),
    ('satellite', 'Satellite Grid', 'Satellite', 4)
$$;

-- Resident-facing, read-only. Same credential/tenant pattern as
-- resident_get_current_assignment() (migrations 67-72) and
-- resident_get_current_full_roster() (migration 73) — neither of which
-- this function touches or depends on.
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
BEGIN
  SELECT w.tenant_id INTO v_tenant_id
  FROM workforce w
  WHERE w.id = p_workforce_id
    AND w.resident_code = p_code
    AND w.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid access code' USING ERRCODE = '28000';
  END IF;

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

-- Chief-facing read, same resolved (fallback-applied) shape as the
-- resident RPC above, so the Chief/Admin UI can render "what residents
-- would currently see" and edit from there. Admin-code-verified, same
-- pattern as chief_get_tenant (migration 61).
CREATE OR REPLACE FUNCTION public.chief_get_roster_section_config(p_admin_code text)
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
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

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
GRANT EXECUTE ON FUNCTION public.chief_get_roster_section_config(text) TO anon, authenticated;

-- Chief-facing write — the ONLY write path to roster_section_config.
-- Admin-code-verified, tenant derived only from that code (never a
-- client-supplied tenant_id, so a Chief can never write another
-- tenant's row), same pattern as chief_update_tenant_terminology
-- (migration 59). Rejects an unrecognized section_key with a clean error
-- rather than a raw constraint-violation (the table's own CHECK
-- constraint is the actual enforcement backstop). Empty-string inputs
-- are normalized to NULL so the resolver's NULLIF-based fallback applies
-- uniformly whether a field was never set or was cleared back to blank.
CREATE OR REPLACE FUNCTION public.chief_upsert_roster_section_config(
  p_admin_code text,
  p_section_key text,
  p_display_label text,
  p_short_label text,
  p_display_order integer,
  p_accent_color text,
  p_icon text
)
RETURNS roster_section_config
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row roster_section_config;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public._roster_section_fallbacks() f WHERE f.section_key = p_section_key) THEN
    RAISE EXCEPTION 'Unknown roster section key: %', p_section_key USING ERRCODE = '22023';
  END IF;

  INSERT INTO roster_section_config (tenant_id, section_key, display_label, short_label, display_order, accent_color, icon, updated_at)
  VALUES (
    v_tenant_id, p_section_key,
    NULLIF(p_display_label, ''), NULLIF(p_short_label, ''), p_display_order,
    NULLIF(p_accent_color, ''), NULLIF(p_icon, ''),
    timezone('utc'::text, now())
  )
  ON CONFLICT (tenant_id, section_key) DO UPDATE SET
    display_label = EXCLUDED.display_label,
    short_label = EXCLUDED.short_label,
    display_order = EXCLUDED.display_order,
    accent_color = EXCLUDED.accent_color,
    icon = EXCLUDED.icon,
    updated_at = timezone('utc'::text, now())
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_upsert_roster_section_config(text, text, text, text, integer, text, text) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 74
-- ====================================================================
