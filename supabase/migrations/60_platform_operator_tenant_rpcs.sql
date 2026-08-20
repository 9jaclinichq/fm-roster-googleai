-- ====================================================================
-- Migration 60: Platform-operator-scoped tenant RPCs (Priority-0 Tenant
-- Surface, slice P0-4)
-- ====================================================================
-- docs/TENANT_SURFACE_SECURITY_SPEC.md §5: SaaSOperatorConsoleView.tsx's
-- tenant provisioning (billing-free path only — provisionTenantWithSubaccount
-- and its platform-operator-subaccount Edge Function are untouched, see
-- below), status, and plan writes currently go through direct
-- `.from('tenants').insert()/.update()` calls, which depend entirely on
-- `tenants`' permissive client INSERT/UPDATE policy (migration 11).
-- verify_platform_operator_code() (migration 11) is called once at login,
-- but nothing re-checks the operator's identity before any of these
-- mutations — a valid session cookie's worth of trust, not a per-action
-- check.
--
-- This slice adds three capability-checked RPCs. Each independently
-- verifies p_operator_code against platform_operators inline, in its own
-- body — no function relies on a prior login call as sufficient
-- authorization. Unlike the Chief-scoped RPCs (migration 59), the status
-- and plan RPCs legitimately accept an explicit target tenant_id:
-- cross-organisation administration is itself an authorised platform
-- capability, not a boundary violation (spec §5's transitional RPC rule).
--
-- p_operator_code is explicitly transitional compatibility (the same
-- plaintext-code verification pattern already live via
-- verify_platform_operator_code()), not the target API contract — see
-- docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md §11 for the eventual
-- `auth.uid()`-based replacement.
--
-- Does NOT touch platform-operator-subaccount or payment-checkout — both
-- remain under Emergency Slice E0 fail-closed containment (see
-- docs/EMERGENCY_SLICE_E0_FINANCIAL_CONTAINMENT.md). Does not change
-- `tenants`' base-table RLS policy — the old permissive policy/direct-write
-- path remains in place until the final atomic narrowing slice (P0-7).

-- Create-only fields actually used by the non-billing provisioning path
-- (databaseService.createTenant()'s current shape) — the Paystack-
-- subaccount path is a separate, still-contained flow, not replicated
-- here.
CREATE OR REPLACE FUNCTION public.platform_operator_create_tenant(
  p_operator_code text,
  p_name text,
  p_short_code text,
  p_institution text DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_plan_type text DEFAULT 'free_seeded'
)
RETURNS tenants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row tenants;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_operators po WHERE po.shared_code = p_operator_code) THEN
    RAISE EXCEPTION 'Invalid operator code' USING ERRCODE = '28000';
  END IF;

  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  INSERT INTO tenants (name, short_code, institution, department, plan_type)
  VALUES (trim(p_name), lower(p_short_code), p_institution, p_department, COALESCE(p_plan_type, 'free_seeded'))
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.platform_operator_create_tenant(text, text, text, text, text, text) TO anon, authenticated;

-- Cross-organisation by design — p_tenant_id is legitimate here (spec §5).
CREATE OR REPLACE FUNCTION public.platform_operator_update_tenant_status(p_operator_code text, p_tenant_id uuid, p_status text)
RETURNS tenants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row tenants;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_operators po WHERE po.shared_code = p_operator_code) THEN
    RAISE EXCEPTION 'Invalid operator code' USING ERRCODE = '28000';
  END IF;

  IF p_status NOT IN ('active', 'suspended') THEN
    RAISE EXCEPTION 'Invalid tenant status';
  END IF;

  UPDATE tenants SET status = p_status WHERE id = p_tenant_id RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.platform_operator_update_tenant_status(text, uuid, text) TO anon, authenticated;

-- Cross-organisation by design — p_tenant_id is legitimate here (spec §5).
CREATE OR REPLACE FUNCTION public.platform_operator_update_tenant_plan(p_operator_code text, p_tenant_id uuid, p_plan_type text)
RETURNS tenants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row tenants;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_operators po WHERE po.shared_code = p_operator_code) THEN
    RAISE EXCEPTION 'Invalid operator code' USING ERRCODE = '28000';
  END IF;

  IF p_plan_type NOT IN ('free_seeded', 'tier_1', 'tier_2', 'enterprise') THEN
    RAISE EXCEPTION 'Invalid plan type';
  END IF;

  UPDATE tenants SET plan_type = p_plan_type WHERE id = p_tenant_id RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.platform_operator_update_tenant_plan(text, uuid, text) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 60
-- ====================================================================
