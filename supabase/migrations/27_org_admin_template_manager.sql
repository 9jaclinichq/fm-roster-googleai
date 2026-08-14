-- Migration 27: org-admin Template Manager (Research + Casebook)
--
-- Gives a Chief real create/edit/delete/reset-to-defaults control over
-- their own organization's Research Engine and Casebook templates,
-- instead of only ever reading the global seed templates or relying on an
-- individual resident's personal fork.
--
-- CASEBOOK_TEMPLATES: closes a real pre-existing gap, not just adds a
-- feature. Its INSERT/UPDATE RLS policies (migration 15) were
-- `USING(true)`/`WITH CHECK(true)` — any anon-key holder could already
-- write to ANY row, including the global (tenant_id IS NULL) seed
-- templates every tenant depends on. There was also no create/update/
-- delete path in databaseService.ts at all (confirmed by exploration
-- before writing this migration) — this table was effectively read-only
-- from the client despite its permissive RLS. Replaced with the
-- SECURITY DEFINER + admin-code-check RPC pattern used everywhere else in
-- this app for Chief-privileged writes (chief_add_workforce_member etc.),
-- since there's no JWT/tenant claim for RLS to check against (no Supabase
-- Auth for the Chief role — see CLAUDE.md Security Notes). SELECT stays
-- permissive/unchanged — reading templates was never the gap.
--
-- RESEARCH_TEMPLATES: deliberately NOT retrofitted to the same RPC
-- pattern in this migration. Its existing permissive create/update path
-- (templateEngine.ts's forkTemplate/editTemplate, used today by every
-- resident forking their own template) already works and is relied upon;
-- tightening it is a separate, bigger hardening task, not bundled in here
-- to avoid scope creep. The only genuinely missing piece is DELETE — no
-- policy exists for research_templates at all — so this migration adds
-- exactly that, gated the same tenant-boundary way as the casebook RPCs.
--
-- "RESET TO DEFAULTS" = delete the tenant's fork. The global template is
-- always still selectable, so a separate revert-in-place RPC would just
-- be a delete with extra steps.

-- --------------------------------------------------
-- 1. CASEBOOK_TEMPLATES: close the permissive write gap, add RPCs
-- --------------------------------------------------

DROP POLICY IF EXISTS "casebook_templates_insert" ON casebook_templates;
DROP POLICY IF EXISTS "casebook_templates_update" ON casebook_templates;
-- No DELETE policy existed before this migration either — nothing to drop.
-- SELECT policy is untouched (still permissive, matches every other
-- read path in this app).

CREATE OR REPLACE FUNCTION public.chief_create_casebook_template(
  p_admin_code text,
  p_name text,
  p_framework_type text,
  p_thematic_distribution jsonb DEFAULT '{}'::jsonb,
  p_scoring_rubric jsonb DEFAULT '{}'::jsonb,
  p_formatting_rules jsonb DEFAULT '{}'::jsonb
)
RETURNS casebook_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row casebook_templates;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  INSERT INTO casebook_templates (tenant_id, name, framework_type, thematic_distribution, scoring_rubric, formatting_rules)
  VALUES (v_tenant_id, p_name, p_framework_type, p_thematic_distribution, p_scoring_rubric, p_formatting_rules)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_create_casebook_template(text, text, text, jsonb, jsonb, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_update_casebook_template(
  p_admin_code text,
  p_template_id uuid,
  p_name text,
  p_thematic_distribution jsonb,
  p_scoring_rubric jsonb,
  p_formatting_rules jsonb
)
RETURNS casebook_templates
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row casebook_templates;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  -- A global template (tenant_id IS NULL) can never be edited, and a
  -- template belonging to a different tenant can't either — same
  -- tenant-boundary check pattern as migration 23's Chief RPCs.
  IF NOT EXISTS (SELECT 1 FROM casebook_templates WHERE id = p_template_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Template not found in this organization';
  END IF;

  UPDATE casebook_templates
  SET name = p_name,
      thematic_distribution = p_thematic_distribution,
      scoring_rubric = p_scoring_rubric,
      formatting_rules = p_formatting_rules
  WHERE id = p_template_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_update_casebook_template(text, uuid, text, jsonb, jsonb, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_delete_casebook_template(
  p_admin_code text,
  p_template_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM casebook_templates WHERE id = p_template_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Template not found in this organization';
  END IF;

  DELETE FROM casebook_templates WHERE id = p_template_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_delete_casebook_template(text, uuid) TO anon, authenticated;

-- --------------------------------------------------
-- 2. RESEARCH_TEMPLATES: only the missing delete path
-- --------------------------------------------------

CREATE OR REPLACE FUNCTION public.chief_delete_research_template(
  p_admin_code text,
  p_template_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM research_templates WHERE id = p_template_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Template not found in this organization';
  END IF;

  DELETE FROM research_templates WHERE id = p_template_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_delete_research_template(text, uuid) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 27
-- ====================================================================
