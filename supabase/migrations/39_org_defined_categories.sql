-- ====================================================================
-- Migration 39: Org-defined workforce categories
-- ====================================================================
-- Same living-system gap as migration 36 (org-defined groups), applied to a
-- different piece of hardcoded vocabulary: src/types.ts's
-- `Category = 'Registrar' | 'Senior Registrar' | 'Medical Officer'` union is
-- a fixed, global, 3-value enum used everywhere a workforce member's
-- grade/category is set or displayed (workforce registry dropdowns, CSV
-- export, role delegation forms, submission tables). Those three values are
-- UK/Commonwealth hospital residency training grades — exactly the kind of
-- vocabulary docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §2 says must be
-- org-defined, not hard-coded, per docs/LIVING_SYSTEM_GAP_AUDIT.md's
-- "groups" finding (already fixed for subadmin roles by migration 36). A
-- private clinic, diagnostic centre, or professional association has no use
-- for "Registrar"/"Senior Registrar" and today has no way to define its own
-- equivalent (e.g. "Associate"/"Partner", "Junior Tech"/"Senior Tech").
--
-- APPROACH: additive, not destructive — mirrors migration 36's own pattern
-- exactly. `workforce.category` (text) is NOT dropped or renamed; too many
-- existing call sites (workforce registry, CSV export, role delegation
-- forms, submission tables) depend on it as-is, and rewiring all of them is
-- explicitly out of scope for this pass (flagged as a followup below). This
-- migration only adds the parallel `workforce_categories` table and a
-- nullable `workforce.category_id` FK, seeded/backfilled from the existing
-- `category` text values, so a future UI-rewiring pass has schema to build
-- on without another migration.
--
-- NOT DONE HERE (flagged, not silently skipped, same as migration 36's own
-- "followup" framing): no component is rewired to read/write category_id —
-- ChiefDashboardView.tsx, App.tsx, and WorkforceRegistryPanel.tsx (and any
-- other component currently reading/writing workforce.category) are
-- untouched. A standalone CategoryManagerPanel.tsx exists for CRUD on
-- workforce_categories but is not wired into any dashboard tab yet.
-- ====================================================================

-- --------------------------------------------------
-- 1. WORKFORCE_CATEGORIES
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS workforce_categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_key text NOT NULL,
  label text NOT NULL,
  description text,
  -- True only for the 3 seeded legacy defaults below — blocks deletion (an
  -- org shouldn't be able to delete the baseline vocabulary out from under
  -- historical workforce rows) but NOT editing (a Chief can still rename
  -- what "Registrar" means for their org).
  is_system_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_category_key_per_tenant UNIQUE (tenant_id, category_key)
);

CREATE INDEX IF NOT EXISTS idx_workforce_categories_tenant ON workforce_categories(tenant_id);

-- Seed every existing tenant with the 3 previously-global legacy categories.
INSERT INTO workforce_categories (tenant_id, category_key, label, description, is_system_default)
SELECT t.id, c.category_key, c.label, c.description, true
FROM tenants t
CROSS JOIN (VALUES
  ('registrar', 'Registrar', 'Entry-level specialist trainee grade.'),
  ('senior_registrar', 'Senior Registrar', 'Senior specialist trainee grade, closer to completing training.'),
  ('medical_officer', 'Medical Officer', 'Non-specialist-track clinical grade.')
) AS c(category_key, label, description)
ON CONFLICT (tenant_id, category_key) DO NOTHING;

ALTER TABLE workforce_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "workforce_categories_select" ON workforce_categories;
CREATE POLICY "workforce_categories_select" ON workforce_categories FOR SELECT TO anon, authenticated USING (true);
-- Mutation only via the SECURITY DEFINER RPCs below (which re-verify the
-- admin code server-side) — no direct client mutate policy, same pattern as
-- org_groups (migration 36) and workforce's INSERT-less policy (migration 01).


-- --------------------------------------------------
-- 2. WORKFORCE: add category_id alongside the existing category text column
-- --------------------------------------------------

ALTER TABLE workforce ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES workforce_categories(id);

-- Backfill: match each workforce row's existing free-text `category` value
-- to its tenant's matching seeded default category. Normalization mirrors
-- the seeded category_key values exactly: 'Registrar' -> 'registrar',
-- 'Senior Registrar' -> 'senior_registrar', 'Medical Officer' ->
-- 'medical_officer' (lowercase, spaces to underscores).
UPDATE workforce w
SET category_id = wc.id
FROM workforce_categories wc
WHERE wc.tenant_id = w.tenant_id
  AND wc.category_key = lower(replace(w.category, ' ', '_'))
  AND w.category_id IS NULL;


-- --------------------------------------------------
-- 3. RPCs: workforce_categories CRUD (Chief-only, admin-code gated, tenant-scoped)
--    Mirrors migration 36's chief_create_org_group / chief_update_org_group /
--    chief_delete_org_group exactly.
-- --------------------------------------------------

CREATE OR REPLACE FUNCTION public.chief_create_workforce_category(
  p_admin_code text, p_category_key text, p_label text, p_description text
)
RETURNS workforce_categories
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row workforce_categories;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  IF p_category_key !~ '^[a-z0-9_]{2,32}$' THEN
    RAISE EXCEPTION 'Category key must be 2-32 lowercase letters, numbers, or underscores';
  END IF;
  IF trim(p_label) = '' THEN
    RAISE EXCEPTION 'Label is required';
  END IF;

  BEGIN
    INSERT INTO workforce_categories (tenant_id, category_key, label, description, is_system_default)
    VALUES (v_tenant_id, p_category_key, trim(p_label), NULLIF(trim(coalesce(p_description, '')), ''), false)
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'A category with that key already exists for this organization';
  END;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_create_workforce_category(text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_update_workforce_category(
  p_admin_code text, p_category_id uuid, p_label text, p_description text
)
RETURNS workforce_categories
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row workforce_categories;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM workforce_categories WHERE id = p_category_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Category not found in this organization';
  END IF;
  IF trim(p_label) = '' THEN
    RAISE EXCEPTION 'Label is required';
  END IF;

  UPDATE workforce_categories
  SET label = trim(p_label),
      description = NULLIF(trim(coalesce(p_description, '')), '')
  WHERE id = p_category_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_update_workforce_category(text, uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_delete_workforce_category(p_admin_code text, p_category_id uuid)
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

  SELECT is_system_default INTO v_is_default FROM workforce_categories WHERE id = p_category_id AND tenant_id = v_tenant_id;
  IF v_is_default IS NULL THEN
    RAISE EXCEPTION 'Category not found in this organization';
  END IF;
  IF v_is_default THEN
    RAISE EXCEPTION 'Built-in categories cannot be deleted, only edited';
  END IF;
  IF EXISTS (SELECT 1 FROM workforce WHERE category_id = p_category_id) THEN
    RAISE EXCEPTION 'Reassign every member out of this category before deleting it';
  END IF;

  DELETE FROM workforce_categories WHERE id = p_category_id;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_delete_workforce_category(text, uuid) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 39
-- ====================================================================
