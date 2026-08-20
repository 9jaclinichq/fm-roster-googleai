-- ====================================================================
-- Migration 58: Public tenant discovery RPC (Priority-0 Tenant Surface,
-- slice P0-1)
-- ====================================================================
-- docs/TENANT_SURFACE_SECURITY_SPEC.md identified `tenants`' current
-- anonymous `SELECT *` access (migration 11) as Priority 0: pre-login
-- consumers (TenantSelectorView.tsx, ResidentLoginView.tsx) only ever need
-- id/name/institution/department for a discoverable, active organisation,
-- but today receive every column, including short_code, plan_type,
-- paystack_subaccount_code, module_flags, and terminology_overrides.
--
-- This slice (P0-1 of that spec's bounded implementation plan) is
-- deliberately add-only: it introduces the locked public projection as a
-- read-only RPC and changes nothing else. No existing tenants policy is
-- modified or dropped, and no consumer is migrated to call this RPC yet
-- (that is P0-2's job) — `tenants`' permissive SELECT/INSERT/UPDATE
-- policies from migration 11 remain in effect after this migration runs,
-- so no existing behaviour changes.
--
-- Locked projection (spec §3, Decision 1): exactly id, name, institution,
-- department. `status` is NOT returned — active/discoverable filtering
-- happens server-side, inside this function body, so a suspended tenant is
-- never present in the result set for a client to filter out itself.
-- short_code, plan_type, paystack_subaccount_code, module_flags,
-- terminology_overrides, and created_at are all private (spec §3) and are
-- not exposed here.

CREATE OR REPLACE FUNCTION public.list_public_tenants()
RETURNS TABLE (
  id uuid,
  name text,
  institution text,
  department text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.id, t.name, t.institution, t.department
  FROM tenants t
  WHERE t.status = 'active'
  ORDER BY t.created_at ASC;
$$;

GRANT EXECUTE ON FUNCTION public.list_public_tenants() TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 58
-- ====================================================================
