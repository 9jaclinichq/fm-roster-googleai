-- ====================================================================
-- Migration 59: Chief-scoped tenant configuration RPCs (Priority-0 Tenant
-- Surface, slice P0-3)
-- ====================================================================
-- docs/TENANT_SURFACE_SECURITY_SPEC.md §5: TenantCustomizationView.tsx's
-- terminology/module-flag saves currently go through direct
-- `.from('tenants').update(...)` calls, which depend entirely on
-- `tenants`' permissive client UPDATE policy (migration 11) — any anon
-- caller who can guess/enumerate a tenant id can currently write to it.
--
-- This slice replaces those two specific writes with capability-checked
-- RPCs, following the exact pattern already live and safe in this schema
-- (chief_assign_user_role, migration 36; create_tenant_with_admin,
-- migration 24): resolve the caller's own tenant server-side from
-- `settings.admin_access_code`, then act only on that tenant. Neither RPC
-- accepts a target tenant_id — there is nothing for a caller to supply
-- that would let them target another organisation's row.
--
-- `p_admin_code` is explicitly transitional compatibility (the same
-- plaintext-code verification every `chief_*` RPC already uses), not the
-- target API contract — see docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md §11
-- for the eventual `auth.uid()`-based replacement. This migration does not
-- change `tenants`' base-table RLS policy — the old permissive
-- policy/direct-write path remains in place until the final atomic
-- narrowing slice (P0-7) confirms no caller of the old path remains.

CREATE OR REPLACE FUNCTION public.chief_update_tenant_terminology(p_admin_code text, p_overrides jsonb)
RETURNS tenants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row tenants;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  UPDATE tenants SET terminology_overrides = p_overrides WHERE id = v_tenant_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_update_tenant_terminology(text, jsonb) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_update_tenant_module_flags(p_admin_code text, p_flags jsonb)
RETURNS tenants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row tenants;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  UPDATE tenants SET module_flags = p_flags WHERE id = v_tenant_id RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_update_tenant_module_flags(text, jsonb) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 59
-- ====================================================================
