-- ====================================================================
-- Migration 61: Chief and platform-operator scoped tenant reads
-- (Priority-0 Tenant Surface, slice P0-5)
-- ====================================================================
-- docs/TENANT_SURFACE_SECURITY_SPEC.md's remaining direct-read inventory
-- (P0-5 re-discovery): TenantCustomizationView.tsx, TemplateManagerView.tsx,
-- and SaaSOperatorConsoleView.tsx all read `tenants` directly via
-- databaseService.getTenant()/getTenants() (`select('*')`), depending on
-- the permissive read policy from migration 11 — but every one of these
-- callers already holds a reusable, independently re-verifiable
-- credential (the Chief's admin_access_code, migration 59; the platform
-- operator's shared_code, migration 60/11's platform_operators). This
-- slice adds read RPCs for exactly those already-securable callers.
--
-- Deliberately NOT covered here (see docs — P0-5's own explicit scope):
-- CasebookBuilderView.tsx, udr.ts (either identity path), and
-- TerminologyProvider — residents have no reusable server-verifiable
-- credential today, so no RPC here can safely re-verify them. These
-- remain on direct getTenant() reads pending institutional Auth.
--
-- Each RPC independently verifies its caller's code inline, in its own
-- body — no function relies on a prior login call as sufficient
-- authorization, same discipline as migrations 59/60. p_admin_code/
-- p_operator_code are explicitly transitional compatibility, not the
-- target API contract — see docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md §11.
--
-- Return shapes are deliberately narrow, not `RETURNS tenants`: each RPC
-- returns only the columns its actual current consumer(s) read (see
-- ChiefTenantConfig/OperatorTenantListing in src/types.ts). In particular,
-- chief_get_tenant() does not return paystack_subaccount_code — no Chief
-- surface reads it today.

-- No p_tenant_id — derives the caller's own tenant from admin_access_code,
-- same pattern as chief_update_tenant_terminology (migration 59). Covers
-- TenantCustomizationView.tsx (name/module_flags/terminology_overrides)
-- and TemplateManagerView.tsx (plan_type only, reusing this same RPC
-- rather than a second near-duplicate one).
CREATE OR REPLACE FUNCTION public.chief_get_tenant(p_admin_code text)
RETURNS TABLE (
  id uuid,
  name text,
  plan_type text,
  module_flags jsonb,
  terminology_overrides jsonb
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
  SELECT t.id, t.name, t.plan_type, t.module_flags, t.terminology_overrides
  FROM tenants t
  WHERE t.id = v_tenant_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_get_tenant(text) TO anon, authenticated;

-- Cross-organisation listing is the operator's legitimate platform-level
-- capability (same rationale as migration 60's status/plan RPCs taking a
-- target tenant_id) — this one takes no parameter beyond the operator code
-- because it lists every tenant, not one. Matches exactly what
-- SaaSOperatorConsoleView.tsx's tenant management table renders today.
CREATE OR REPLACE FUNCTION public.platform_operator_list_tenants(p_operator_code text)
RETURNS TABLE (
  id uuid,
  name text,
  short_code text,
  institution text,
  department text,
  plan_type text,
  status text,
  paystack_subaccount_code text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_operators po WHERE po.shared_code = p_operator_code) THEN
    RAISE EXCEPTION 'Invalid operator code' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT t.id, t.name, t.short_code, t.institution, t.department, t.plan_type, t.status, t.paystack_subaccount_code
  FROM tenants t
  ORDER BY t.created_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.platform_operator_list_tenants(text) TO anon, authenticated;

-- Replicates getPlatformAnalyticsSummary()'s exact current logic
-- (databaseService.ts) server-side: global, unfiltered counts across
-- tenants/workforce/combined_master_rosters/ai_action_logs.
CREATE OR REPLACE FUNCTION public.platform_operator_get_analytics_summary(p_operator_code text)
RETURNS TABLE (
  total_tenants bigint,
  total_members bigint,
  active_master_rosters bigint,
  ai_action_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_operators po WHERE po.shared_code = p_operator_code) THEN
    RAISE EXCEPTION 'Invalid operator code' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY SELECT
    (SELECT count(*) FROM tenants),
    (SELECT count(*) FROM workforce),
    (SELECT count(*) FROM combined_master_rosters WHERE status = 'published'),
    (SELECT count(*) FROM ai_action_logs);
END;
$$;
GRANT EXECUTE ON FUNCTION public.platform_operator_get_analytics_summary(text) TO anon, authenticated;

-- Replicates getTenantUsageBreakdown()'s exact current logic
-- (databaseService.ts) server-side: per-tenant member count (active
-- workforce), this-window AI action count (tenant_ai_usage — UNIQUE on
-- tenant_id, migration 11, so a direct join is correct, not an
-- aggregate), and submission count (submissions has no tenant_id of its
-- own — attributed via its workforce_id -> workforce.tenant_id, same join
-- the original TS code performs).
CREATE OR REPLACE FUNCTION public.platform_operator_get_tenant_usage_breakdown(p_operator_code text)
RETURNS TABLE (
  tenant_id uuid,
  name text,
  plan_type text,
  status text,
  member_count bigint,
  ai_actions_this_window integer,
  submission_count bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_operators po WHERE po.shared_code = p_operator_code) THEN
    RAISE EXCEPTION 'Invalid operator code' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
  SELECT
    t.id,
    t.name,
    t.plan_type,
    t.status,
    COALESCE(m.member_count, 0) AS member_count,
    COALESCE(u.action_count, 0) AS ai_actions_this_window,
    COALESCE(s.submission_count, 0) AS submission_count
  FROM tenants t
  LEFT JOIN (
    SELECT w.tenant_id, count(*) AS member_count
    FROM workforce w
    WHERE w.active = true
    GROUP BY w.tenant_id
  ) m ON m.tenant_id = t.id
  LEFT JOIN tenant_ai_usage u ON u.tenant_id = t.id
  LEFT JOIN (
    SELECT w.tenant_id, count(*) AS submission_count
    FROM submissions sub
    JOIN workforce w ON w.id = sub.workforce_id
    GROUP BY w.tenant_id
  ) s ON s.tenant_id = t.id
  ORDER BY t.created_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.platform_operator_get_tenant_usage_breakdown(text) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 61
-- ====================================================================
