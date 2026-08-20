-- ====================================================================
-- Migration 62: platform_operator_create_tenant, widened to accept a
-- Paystack subaccount code (Priority-0 Tenant Surface, slice P0-7A)
-- ====================================================================
-- docs/EMERGENCY_SLICE_E0_FINANCIAL_CONTAINMENT.md's containment left one
-- gap unaddressed: databaseService.ts's provisionTenantWithSubaccount()
-- still performed a raw, operator-code-unverified `.from('tenants').insert()`
-- after calling the (now fail-closed) platform-operator-subaccount Edge
-- Function. That insert is inert today only because E0 blocks everything
-- upstream of it — the moment platform-operator-subaccount is ever
-- re-enabled by a future, separately-authorized decision, this would have
-- been the one remaining tenant write with no capability check at all.
-- This migration closes that gap without touching E0 containment itself
-- (supabase/functions/platform-operator-subaccount/index.ts is not
-- modified by this migration or its accompanying source change) and
-- without invoking the Edge Function, Paystack, or Flutterwave.
--
-- Design: widen platform_operator_create_tenant (migration 60) with one
-- optional trailing parameter rather than add a sibling RPC — same
-- authority check, one atomic INSERT, no duplicated logic. Postgres
-- identifies functions by name AND parameter types, so CREATE OR REPLACE
-- with an added parameter does NOT replace the existing 6-argument
-- function — it would create a second overload if the old signature isn't
-- dropped first. The old 6-argument signature is explicitly dropped below
-- (same pattern already used in migration 36 for chief_assign_user_role)
-- so exactly one platform_operator_create_tenant definition exists after
-- this migration.
--
-- TRANSITIONAL, E0-ERA DESIGN NOTE — read before ever re-enabling
-- platform-operator-subaccount: p_paystack_subaccount_code is accepted
-- here as a client-supplied string with NO independent verification that
-- Paystack actually issued it — this migration only adds verification of
-- the CALLER's operator authority, not of the subaccount code's
-- authenticity. That is the same trust level the previous (now-removed)
-- direct insert already had; this migration does not weaken or strengthen
-- it. Any future work that reassesses/lifts E0 containment must also
-- reassess server-side binding/verification of this payment-provider
-- metadata (e.g. having the Edge Function itself write the tenant row via
-- service-role after a verified Paystack response, rather than round-
-- tripping the code back through the client) — that redesign is
-- explicitly out of scope here.

DROP FUNCTION IF EXISTS public.platform_operator_create_tenant(text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.platform_operator_create_tenant(
  p_operator_code text,
  p_name text,
  p_short_code text,
  p_institution text DEFAULT NULL,
  p_department text DEFAULT NULL,
  p_plan_type text DEFAULT 'free_seeded',
  p_paystack_subaccount_code text DEFAULT NULL
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

  INSERT INTO tenants (name, short_code, institution, department, plan_type, paystack_subaccount_code)
  VALUES (trim(p_name), lower(p_short_code), p_institution, p_department, COALESCE(p_plan_type, 'free_seeded'), p_paystack_subaccount_code)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.platform_operator_create_tenant(text, text, text, text, text, text, text) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 62
-- ====================================================================
