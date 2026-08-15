-- ====================================================================
-- Migration 36: Org-defined groups (living-system gap audit finding)
-- ====================================================================
-- docs/LIVING_SYSTEM_GAP_AUDIT.md's biggest finding: the spec's central
-- rule "groups are org-defined vocabulary, not a fixed hierarchy" (see
-- docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §2) is violated today — the
-- delegatable subadmin roles (hod/rtc/cme_coord/consultant) are a single
-- GLOBAL `roles` table with 4 hardcoded rows, duplicated independently in
-- three places in the frontend (types.ts's SubadminRoleId union, App.tsx's
-- SUBADMIN_ROLE_IDS, and a hardcoded dropdown in RoleDelegationPanel.tsx),
-- and chief_assign_user_role's own IN-list hardcodes the same 4 values
-- server-side.
--
-- WHAT THE ACTUAL PERMISSION SEMANTICS ARE TODAY (confirmed by reading
-- App.tsx before writing this): a workforce member holding ANY of the 4
-- subadmin roles gets the exact same capability — Consultant Review
-- approval authority (canApprove) and clinical-logbook sign-off management
-- (canManageLogbooks). There is no per-role-specific behavior anywhere in
-- the app beyond the display label. So the real permission model is a
-- single boolean ("does this assignment grant review/approval authority?")
-- plus a free-text label for what an org calls that authority — exactly
-- what org_groups.grants_review_approval below represents.
--
-- APPROACH: additive, not destructive. `roles`/`user_roles.role_id` are
-- NOT dropped — 'resident' and 'super_admin' remain fixed platform-level
-- identities (not an org-configurable "group" in the spec's sense; every
-- tenant has exactly one meaning for "resident" and one for "super_admin").
-- What becomes org-defined is the *delegatable* subadmin vocabulary: a new
-- tenant-scoped `org_groups` table, seeded per-tenant with the 4 existing
-- labels as editable (but not deletable) defaults, which a Chief can now
-- also extend with entirely custom group labels for their own org's
-- structure (e.g. "Unit Lead", "Branch Coordinator" — see CLAUDE.md's own
-- Role Model note that groups should not be hard-coded per organisation
-- type).
--
-- ALSO FIXES a latent bug found while researching this: migration 01 gated
-- user_roles' SELECT/mutate RLS policies behind `TO authenticated` only,
-- but this app has no Supabase Auth session (see CLAUDE.md's Role Model
-- section) — every client request uses the anon key. That means
-- getDelegatedRoles()'s direct `.from('user_roles').select(...)` call has
-- been returning zero rows unconditionally since migration 01, regardless
-- of how many roles were actually delegated. Widened to match this repo's
-- established permissive-RLS trust model (same as `roles`/`rotations`).
-- ====================================================================

-- --------------------------------------------------
-- 1. ORG_GROUPS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS org_groups (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  group_key text NOT NULL,
  label text NOT NULL,
  description text,
  -- The one real permission bit currently in use anywhere in the app
  -- (Consultant Review approval + clinical logbook sign-off management).
  -- Free-form future permission buckets can be added as additional
  -- boolean/enum columns later without another redesign.
  grants_review_approval boolean NOT NULL DEFAULT false,
  -- True only for the 4 seeded defaults below — blocks deletion (an org
  -- shouldn't be able to delete the baseline vocabulary out from under
  -- historical data) but NOT editing (a Chief can still rename/reconfigure
  -- what "Head of Department" means for their org).
  is_system_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_org_group_key_per_tenant UNIQUE (tenant_id, group_key)
);

CREATE INDEX IF NOT EXISTS idx_org_groups_tenant ON org_groups(tenant_id);

-- Seed every existing tenant with the 4 previously-global default groups.
INSERT INTO org_groups (tenant_id, group_key, label, description, grants_review_approval, is_system_default)
SELECT t.id, g.group_key, g.label, g.description, true, true
FROM tenants t
CROSS JOIN (VALUES
  ('hod', 'Head of Department', 'Department-wide oversight and approval authority.'),
  ('rtc', 'Rotation/Training Coordinator', 'Manages rotation schedules and postings.'),
  ('cme_coord', 'CME Coordinator', 'Manages continuing medical education announcements and records.'),
  ('consultant', 'Consultant', 'Supervising consultant with review access.')
) AS g(group_key, label, description)
ON CONFLICT (tenant_id, group_key) DO NOTHING;

ALTER TABLE org_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_groups_select" ON org_groups;
CREATE POLICY "org_groups_select" ON org_groups FOR SELECT TO anon, authenticated USING (true);
-- Mutation only via the SECURITY DEFINER RPCs below (which re-verify the
-- admin code server-side) — no direct client mutate policy, same pattern
-- as workforce's INSERT-less policy in migration 01.


-- --------------------------------------------------
-- 2. USER_ROLES: add org_group_id, relax role_id, backfill
-- --------------------------------------------------

ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS org_group_id uuid REFERENCES org_groups(id) ON DELETE CASCADE;
ALTER TABLE user_roles ALTER COLUMN role_id DROP NOT NULL;

ALTER TABLE user_roles DROP CONSTRAINT IF EXISTS user_roles_group_or_role_check;
ALTER TABLE user_roles ADD CONSTRAINT user_roles_group_or_role_check
  CHECK (role_id IS NOT NULL OR org_group_id IS NOT NULL);

-- Backfill: point every existing hod/rtc/cme_coord/consultant assignment at
-- its tenant's matching seeded default group. role_id is left in place
-- (harmless historical record) — display code now prefers org_group_id
-- when present.
UPDATE user_roles ur
SET org_group_id = og.id
FROM workforce w, org_groups og
WHERE ur.workforce_id = w.id
  AND og.tenant_id = w.tenant_id
  AND og.group_key = ur.role_id
  AND ur.role_id IN ('hod', 'rtc', 'cme_coord', 'consultant')
  AND ur.org_group_id IS NULL;

-- Fix: widen user_roles RLS to match this repo's established permissive
-- trust model (see header note — the previous `TO authenticated`-only
-- policies were unreachable by this app's anon-key-only client).
DROP POLICY IF EXISTS "user_roles_select" ON user_roles;
CREATE POLICY "user_roles_select" ON user_roles FOR SELECT TO anon, authenticated USING (true);
-- Mutation stays RPC-only (chief_assign_user_role / chief_remove_user_role,
-- both SECURITY DEFINER) — no direct client mutate policy, unchanged from
-- migration 01's intent, just no longer relying on the inert has_role() gate.


-- --------------------------------------------------
-- 3. RPCs: org_groups CRUD (Chief-only, admin-code gated, tenant-scoped)
-- --------------------------------------------------

CREATE OR REPLACE FUNCTION public.chief_create_org_group(
  p_admin_code text, p_group_key text, p_label text, p_description text, p_grants_review_approval boolean
)
RETURNS org_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row org_groups;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  IF p_group_key !~ '^[a-z0-9_]{2,32}$' THEN
    RAISE EXCEPTION 'Group key must be 2-32 lowercase letters, numbers, or underscores';
  END IF;
  IF trim(p_label) = '' THEN
    RAISE EXCEPTION 'Label is required';
  END IF;

  BEGIN
    INSERT INTO org_groups (tenant_id, group_key, label, description, grants_review_approval, is_system_default)
    VALUES (v_tenant_id, p_group_key, trim(p_label), NULLIF(trim(coalesce(p_description, '')), ''), p_grants_review_approval, false)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A group with that key already exists for this organization';
  END;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_create_org_group(text, text, text, text, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_update_org_group(
  p_admin_code text, p_group_id uuid, p_label text, p_description text, p_grants_review_approval boolean
)
RETURNS org_groups
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row org_groups;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM org_groups WHERE id = p_group_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Group not found in this organization';
  END IF;
  IF trim(p_label) = '' THEN
    RAISE EXCEPTION 'Label is required';
  END IF;

  UPDATE org_groups
  SET label = trim(p_label),
      description = NULLIF(trim(coalesce(p_description, '')), ''),
      grants_review_approval = p_grants_review_approval
  WHERE id = p_group_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_update_org_group(text, uuid, text, text, boolean) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_delete_org_group(p_admin_code text, p_group_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_is_default boolean;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  SELECT is_system_default INTO v_is_default FROM org_groups WHERE id = p_group_id AND tenant_id = v_tenant_id;
  IF v_is_default IS NULL THEN
    RAISE EXCEPTION 'Group not found in this organization';
  END IF;
  IF v_is_default THEN
    RAISE EXCEPTION 'Built-in groups cannot be deleted, only edited';
  END IF;
  IF EXISTS (SELECT 1 FROM user_roles WHERE org_group_id = p_group_id) THEN
    RAISE EXCEPTION 'Revoke this group from every member before deleting it';
  END IF;

  DELETE FROM org_groups WHERE id = p_group_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_delete_org_group(text, uuid) TO anon, authenticated;


-- --------------------------------------------------
-- 4. RPC: replace chief_assign_user_role's hardcoded role_id IN-list with
--    a tenant-verified org_group_id reference.
-- --------------------------------------------------

DROP FUNCTION IF EXISTS public.chief_assign_user_role(text, uuid, text);

CREATE OR REPLACE FUNCTION public.chief_assign_user_role(p_admin_code text, p_workforce_id uuid, p_org_group_id uuid)
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

  IF NOT EXISTS (SELECT 1 FROM org_groups g WHERE g.id = p_org_group_id AND g.tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Group not found in this organization';
  END IF;

  INSERT INTO user_roles (workforce_id, org_group_id)
  VALUES (p_workforce_id, p_org_group_id)
  ON CONFLICT DO NOTHING;

  SELECT * INTO v_row FROM user_roles WHERE workforce_id = p_workforce_id AND org_group_id = p_org_group_id;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_assign_user_role(text, uuid, uuid) TO anon, authenticated;

-- A unique index is needed for the ON CONFLICT above (org_group_id-based
-- assignments have no equivalent of migration 01's
-- unique_user_role_workforce, which is keyed on role_id not org_group_id).
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_role_workforce_group
  ON user_roles (workforce_id, org_group_id) WHERE workforce_id IS NOT NULL AND org_group_id IS NOT NULL;

-- chief_remove_user_role (migration 23) is unchanged — it deletes by
-- user_roles.id regardless of whether the row carries role_id or
-- org_group_id, and its tenant-boundary check already joins through
-- workforce, which still applies identically.

-- ====================================================================
-- END OF MIGRATION 36
-- ====================================================================
