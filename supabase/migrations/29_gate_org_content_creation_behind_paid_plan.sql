-- Migration 29: gate org-custom content CREATE/UPDATE behind a paid
-- tenant plan (Phase 5 of the module admin-content build-out).
--
-- USER DECISION (2026-08-14, Dr. Olanipekun): Research Engine + Casebook
-- AI Copilot actions were already Pro-gated (migration 17, per-resident
-- quota). This migration adds two MORE surfaces to the paid set: creating/
-- editing an organization's own Template Manager content (casebook
-- templates; research template forking, gated client-side — see below)
-- and Viva Vignette bank entries (migrations 27/28). One flat Pro price
-- covers everything (₦12,000/month as of this migration, see
-- src/config/tiers.ts and supabase/functions/payment-checkout/index.ts).
--
-- WHY A TENANT-LEVEL GATE, NOT THE EXISTING PER-RESIDENT ONE: Template
-- Manager and Viva Vignette creation are Chief/org-admin actions,
-- authorized by the shared admin_access_code — not a resident's own
-- workforce_id. The Chief role has no workforce row of its own (see
-- CLAUDE.md's Role Model), so there is no per-resident user_subscriptions
-- row to check for a Chief action. The only coherent gate is the
-- ORGANIZATION's own plan: tenants.plan_type != 'free_seeded'.
--
-- FLAGGED GAP, NOT SILENTLY SOLVED: there is no self-serve "upgrade my
-- organization's plan" checkout today — tenants.plan_type is changed only
-- by the Platform Operator (SaaSOperatorConsoleView's updateTenantPlan).
-- A Chief hitting this gate sees a message saying so, not a checkout
-- button. Building a real self-serve tenant-plan checkout (extending
-- payment-checkout/payment-webhook to handle tenant-keyed subscriptions)
-- is a separate, larger task — not attempted here.
--
-- DELETE IS DELIBERATELY NOT GATED: removing your org's own custom
-- template/vignette ("Reset to Default") should stay available regardless
-- of plan — a downgraded org shouldn't be locked out of cleaning up its
-- own content, only from creating new paid content.
--
-- RESEARCH TEMPLATE FORKING IS NOT GATED HERE: it has no RPC to attach a
-- server-side check to (templateEngine.forkTemplate writes directly under
-- research_templates' existing permissive RLS, unchanged since migration
-- 13 — see migration 27's header for why that was deliberately left
-- alone). The equivalent gate for that path is client-side only, added in
-- TemplateManagerView.tsx alongside this migration — flagged as weaker
-- than the RPC-enforced gates below, consistent with this table's
-- existing client-enforced trust model.

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
  v_plan_type text;
  v_row casebook_templates;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  SELECT t.plan_type INTO v_plan_type FROM tenants t WHERE t.id = v_tenant_id;
  IF v_plan_type = 'free_seeded' THEN
    RAISE EXCEPTION 'Creating custom casebook templates requires a paid plan. Contact the platform to upgrade your organization.';
  END IF;

  INSERT INTO casebook_templates (tenant_id, name, framework_type, thematic_distribution, scoring_rubric, formatting_rules)
  VALUES (v_tenant_id, p_name, p_framework_type, p_thematic_distribution, p_scoring_rubric, p_formatting_rules)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

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
  v_plan_type text;
  v_row casebook_templates;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  SELECT t.plan_type INTO v_plan_type FROM tenants t WHERE t.id = v_tenant_id;
  IF v_plan_type = 'free_seeded' THEN
    RAISE EXCEPTION 'Editing custom casebook templates requires a paid plan. Contact the platform to upgrade your organization.';
  END IF;

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

CREATE OR REPLACE FUNCTION public.chief_create_viva_vignette(
  p_admin_code text,
  p_title text,
  p_category text,
  p_scenario text,
  p_prompts text[]
)
RETURNS viva_vignettes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_plan_type text;
  v_row viva_vignettes;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  SELECT t.plan_type INTO v_plan_type FROM tenants t WHERE t.id = v_tenant_id;
  IF v_plan_type = 'free_seeded' THEN
    RAISE EXCEPTION 'Creating custom viva vignettes requires a paid plan. Contact the platform to upgrade your organization.';
  END IF;

  INSERT INTO viva_vignettes (tenant_id, title, category, scenario, prompts)
  VALUES (v_tenant_id, p_title, p_category, p_scenario, p_prompts)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.chief_update_viva_vignette(
  p_admin_code text,
  p_vignette_id uuid,
  p_title text,
  p_category text,
  p_scenario text,
  p_prompts text[]
)
RETURNS viva_vignettes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_plan_type text;
  v_row viva_vignettes;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  SELECT t.plan_type INTO v_plan_type FROM tenants t WHERE t.id = v_tenant_id;
  IF v_plan_type = 'free_seeded' THEN
    RAISE EXCEPTION 'Editing custom viva vignettes requires a paid plan. Contact the platform to upgrade your organization.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM viva_vignettes WHERE id = p_vignette_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Vignette not found in this organization';
  END IF;

  UPDATE viva_vignettes
  SET title = p_title, category = p_category, scenario = p_scenario, prompts = p_prompts
  WHERE id = p_vignette_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- ====================================================================
-- END OF MIGRATION 29
-- ====================================================================
