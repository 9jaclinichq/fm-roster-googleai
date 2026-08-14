-- Migration 23: per-tenant Chief admin code
--
-- PREREQUISITE for the self-serve "create new organization" flow (migration
-- 24) and for the same UX review's "less confusing admin entry point" ask.
--
-- THE GAP THIS CLOSES: since migration 11, `tenants` has existed and 10
-- tables carry `tenant_id`, but `settings` — the table holding the single
-- Chief `admin_access_code` — was never touched. It has always been a true
-- 1-row global singleton (`id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1)`,
-- schema.sql). Every Chief-gated RPC checks
-- `SELECT 1 FROM settings WHERE id = 1 AND admin_access_code = p_code`.
-- Migration 20's own header already flagged this explicitly: "a single
-- shared admin_access_code, not one per tenant ... still a future gap, not
-- solved here." This migration is that follow-up. Until now, a second
-- tenant's Chief would share UCH Family Medicine's exact admin code — full
-- read/write access to each other's workforce — which is why self-serve
-- org creation could not ship before this landed.
--
-- DESIGN DECISION: the admin code itself resolves the tenant, not a
-- client-supplied tenant_id. Every Chief-gated RPC now does
-- `SELECT tenant_id FROM settings WHERE admin_access_code = p_code`
-- instead of `WHERE id = 1`. This requires admin_access_code to be globally
-- UNIQUE across all tenants. The alternative (client passes p_tenant_id
-- explicitly) would require inventing a tenant-selection UI first —
-- ChiefLoginView, ResidentLoginView, and AuthLandingView all carry zero
-- tenant state today. That tenant-selection UI is exactly the "select your
-- institution" login redesign this same UX review asked for, and it is
-- DELIBERATELY DEFERRED (a separate, larger piece of work). Resolving via
-- the code means this migration does not need that UI to exist first.
--
-- SETTINGS BECOMES 1-ROW-PER-TENANT, NOT A REAL AUTH BOUNDARY: RLS on
-- `settings` stays exactly as permissive as it always was (column-grant
-- locked down for admin_access_code specifically, same as before — see
-- migration 01/02). This migration does not add a new security boundary;
-- it removes a cross-tenant data-leak bug (one shared code) using the same
-- trust model the rest of this app already runs on (see CLAUDE.md Security
-- Notes). `current_collection_id` — the other singleton field on
-- `settings` — becomes per-tenant "for free" as a side effect of settings
-- moving to 1-row-per-tenant; it did not need special-casing.
--
-- NEW SCOPE CALLED OUT EXPLICITLY (beyond the literal "make the code
-- per-tenant" ask): resolving the caller's tenant from the code is not
-- sufficient on its own. Six of the nine RPCs below take a target id
-- (p_workforce_id / p_user_role_id) but never verified that the target
-- actually belongs to the caller's tenant — a valid Tenant-A code could
-- otherwise act on a Tenant-B workforce row. This is the same bug class
-- migration 20 already fixed once, narrowly, for chief_get_workforce_codes
-- only. This migration closes it for the rest of the Chief-gated surface
-- too, not just the admin-code lookup itself.
--
-- WHAT IS DELIBERATELY NOT DONE HERE: no client (ChiefDashboardView,
-- TenantCustomizationView, databaseService.ts's resident/anonymous-session
-- reads) is changed to actually route a resolved tenant through — see the
-- companion client-side changes made alongside this migration for exactly
-- which call sites are updated now vs. left on DEFAULT_TENANT_ID pending
-- the future tenant-selection-at-login work.

-- --------------------------------------------------
-- 1. SETTINGS: singleton -> one row per tenant
-- --------------------------------------------------

ALTER TABLE settings ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE settings SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE settings ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE settings ADD CONSTRAINT settings_tenant_id_unique UNIQUE (tenant_id);

-- Admin codes must be unique ACROSS tenants now — see design decision above,
-- this is what lets an RPC resolve "which tenant" from the code alone.
ALTER TABLE settings ADD CONSTRAINT settings_admin_code_unique UNIQUE (admin_access_code);

-- `id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1)` was a one-off in an
-- otherwise all-uuid schema, specifically because it assumed exactly one
-- global row. That assumption is gone. Nothing FKs to settings.id anywhere
-- in the schema (verified), so converting it to match every other table's
-- uuid PK convention is safe.
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey;
ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_id_check;
ALTER TABLE settings ALTER COLUMN id DROP DEFAULT;
ALTER TABLE settings ALTER COLUMN id TYPE uuid USING gen_random_uuid();
ALTER TABLE settings ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE settings ADD PRIMARY KEY (id);

-- Column-privilege allowlist (migration 02 pattern) needs tenant_id added —
-- new columns are invisible to anon/authenticated without an explicit
-- GRANT even when RLS would otherwise allow the read.
GRANT SELECT (tenant_id) ON settings TO anon, authenticated;

-- --------------------------------------------------
-- 2. CHIEF-GATED RPCs: resolve tenant from the code, not id = 1
-- --------------------------------------------------

-- Return type changes (boolean -> table), so the old function must be
-- dropped before CREATE OR REPLACE can redefine it with a new signature.
DROP FUNCTION IF EXISTS public.verify_chief_login(text);

CREATE OR REPLACE FUNCTION public.verify_chief_login(p_code text)
RETURNS TABLE (tenant_id uuid, tenant_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
    SELECT s.tenant_id, t.name
    FROM settings s
    JOIN tenants t ON t.id = s.tenant_id
    WHERE s.admin_access_code = p_code;
END;
$$;
GRANT EXECUTE ON FUNCTION public.verify_chief_login(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_get_workforce_codes(p_admin_code text)
RETURNS TABLE(id uuid, resident_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  -- Replaces migration 20's hardcoded DEFAULT_TENANT_ID filter — that was
  -- always a provisional fix pending exactly this migration.
  RETURN QUERY
    SELECT w.id, w.resident_code::text
    FROM workforce w
    WHERE w.tenant_id = v_tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.chief_add_workforce_member(p_admin_code text, p_full_name text, p_category text)
RETURNS TABLE(id uuid, full_name text, category text, resident_code text, active boolean, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_code text;
  v_id uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  LOOP
    v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM workforce w WHERE w.resident_code = v_code);
  END LOOP;

  -- Bug fix included here: this INSERT previously relied on
  -- workforce.tenant_id's column DEFAULT (always the seeded UCH tenant) and
  -- never set it explicitly — harmless while only one tenant existed, but
  -- would have silently added every new tenant's members into UCH's roster
  -- the moment a second tenant's Chief existed.
  INSERT INTO workforce (full_name, category, resident_code, active, tenant_id)
  VALUES (p_full_name, p_category, v_code, true, v_tenant_id)
  RETURNING workforce.id INTO v_id;

  RETURN QUERY SELECT w.id, w.full_name, w.category, w.resident_code::text, w.active, w.created_at
  FROM workforce w WHERE w.id = v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.chief_reset_resident_code(p_admin_code text, p_workforce_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_code text;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  -- New tenant-boundary check — see this migration's header.
  IF NOT EXISTS (SELECT 1 FROM workforce w WHERE w.id = p_workforce_id AND w.tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Workforce member not found in this organization';
  END IF;

  LOOP
    v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM workforce w WHERE w.resident_code = v_code);
  END LOOP;

  UPDATE workforce SET resident_code = v_code WHERE id = p_workforce_id;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.chief_update_admin_code(p_admin_code text, p_new_code text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  BEGIN
    UPDATE settings SET admin_access_code = p_new_code WHERE tenant_id = v_tenant_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That access code is already in use by another organization';
  END;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.chief_assign_user_role(p_admin_code text, p_workforce_id uuid, p_role_id text)
RETURNS user_roles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row user_roles;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM workforce w WHERE w.id = p_workforce_id AND w.tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Workforce member not found in this organization';
  END IF;

  IF p_role_id NOT IN ('hod', 'rtc', 'cme_coord', 'consultant') THEN
    RAISE EXCEPTION 'Role % cannot be delegated through this action', p_role_id;
  END IF;

  INSERT INTO user_roles (workforce_id, role_id)
  VALUES (p_workforce_id, p_role_id)
  ON CONFLICT (workforce_id, role_id) WHERE workforce_id IS NOT NULL DO NOTHING;

  SELECT * INTO v_row FROM user_roles WHERE workforce_id = p_workforce_id AND role_id = p_role_id;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.chief_remove_user_role(p_admin_code text, p_user_role_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  -- New tenant-boundary check via a join, since user_roles itself has no
  -- tenant_id column — it's keyed by workforce_id.
  IF NOT EXISTS (
    SELECT 1 FROM user_roles ur
    JOIN workforce w ON w.id = ur.workforce_id
    WHERE ur.id = p_user_role_id AND w.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Role assignment not found in this organization';
  END IF;

  DELETE FROM user_roles WHERE id = p_user_role_id;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.chief_link_doctor_by_email(
  p_admin_code text,
  p_workforce_id uuid,
  p_doctor_email text
)
RETURNS TABLE (workforce_id uuid, doctor_id uuid, doctor_full_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_doctor_id uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code';
  END IF;

  -- Tenant-boundary check folded into the existing migration-21 active-only
  -- check (both are "is this workforce row actually mine to touch").
  IF NOT EXISTS (SELECT 1 FROM workforce WHERE id = p_workforce_id AND tenant_id = v_tenant_id AND active = true) THEN
    RAISE EXCEPTION 'Cannot link a doctor account to an inactive or out-of-organization workforce member';
  END IF;

  SELECT id INTO v_doctor_id FROM doctor_profiles WHERE email = lower(p_doctor_email);
  IF v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'No registered doctor found with that email';
  END IF;

  UPDATE workforce SET doctor_id = v_doctor_id WHERE id = p_workforce_id;

  RETURN QUERY
    SELECT p_workforce_id, v_doctor_id, dp.full_name
    FROM doctor_profiles dp WHERE dp.id = v_doctor_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.chief_unlink_doctor(
  p_admin_code text,
  p_workforce_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM workforce WHERE id = p_workforce_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Workforce member not found in this organization';
  END IF;

  UPDATE workforce SET doctor_id = NULL WHERE id = p_workforce_id;
END;
$$;

-- ====================================================================
-- END OF MIGRATION 23
-- ====================================================================
