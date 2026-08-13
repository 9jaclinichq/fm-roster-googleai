-- Migration 22: make the AI quota gate aware of individual Pro subscriptions
--
-- Found by an adversarial correctness audit: payment-checkout/payment-webhook
-- (migration 17) only ever write to user_subscriptions, keyed per workforce
-- member — they never touch tenants.plan_type. But
-- check_and_increment_tenant_ai_quota (migration 11), the RPC every AI
-- Copilot Edge Function calls as its AUTHORITATIVE server-side quota
-- backstop, only ever looks at tenants.plan_type. The result: a resident
-- who pays for "Pro Unlimited" (UpgradeCheckoutModal literally advertises
-- "Unlimited AI Copilot executions") still gets blocked with a 429 the
-- moment ANY member of the shared tenant exhausts the tenant-wide 50
-- actions/14-days free pool — the product cannot deliver what was sold.
--
-- This was never wrong on the client: useWorkspaceQuota
-- (src/lib/billing/useWorkspaceQuota.ts) already correctly reads each
-- member's OWN active subscription and shows them as unlimited. The gap was
-- purely server-side, and purely because the Edge Functions never told the
-- RPC which member was calling in the first place.
--
-- FIX: check_and_increment_tenant_ai_quota gains an optional p_workforce_id
-- parameter. If that specific member has an active, non-expired
-- pro_unlimited row in user_subscriptions, they're unlimited immediately —
-- without touching or being blocked by the tenant's shared free-tier
-- counter at all. A tenant-wide institutional upgrade (tenants.plan_type,
-- set by the Platform Operator, a separate and still-supported path) is
-- checked exactly as before for everyone else. Adding a parameter changes
-- the function's identity in Postgres (name + argument types), so the old
-- 3-arg version is dropped explicitly rather than left behind as a second,
-- still-broken overload.

DROP FUNCTION IF EXISTS public.check_and_increment_tenant_ai_quota(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.check_and_increment_tenant_ai_quota(
  p_tenant_id uuid,
  p_workforce_id uuid DEFAULT NULL,
  p_free_tier_limit integer DEFAULT 50,
  p_window_days integer DEFAULT 14
)
RETURNS TABLE (allowed boolean, remaining integer, resets_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan_type text;
  v_usage tenant_ai_usage;
BEGIN
  SELECT plan_type INTO v_plan_type FROM tenants WHERE id = p_tenant_id;
  IF v_plan_type IS NULL THEN
    RAISE EXCEPTION 'Unknown tenant_id: %', p_tenant_id;
  END IF;

  -- A specific member's own active Pro subscription grants THEM unlimited
  -- access without touching the tenant's shared free-tier counter — same
  -- "active, non-expired, pro_unlimited" check as the client's own
  -- getActiveSubscription() (src/lib/databaseService.ts), so client display
  -- and server enforcement agree.
  IF p_workforce_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM user_subscriptions
    WHERE workforce_id = p_workforce_id
      AND status = 'active'
      AND plan = 'pro_unlimited'
      AND current_period_end > now()
  ) THEN
    RETURN QUERY SELECT true, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;

  -- Only the free_seeded tier is quota-gated in this pass. Paid TENANT
  -- tiers (a separate, institution-wide upgrade path) are unlimited here —
  -- differentiated per-tier limits are a future task once there's a real
  -- paying tenant to calibrate against.
  IF v_plan_type <> 'free_seeded' THEN
    RETURN QUERY SELECT true, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO tenant_ai_usage (tenant_id)
  VALUES (p_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT * INTO v_usage FROM tenant_ai_usage WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF now() > v_usage.period_start + make_interval(days => p_window_days) THEN
    UPDATE tenant_ai_usage
    SET period_start = now(), action_count = 0, updated_at = now()
    WHERE tenant_id = p_tenant_id
    RETURNING * INTO v_usage;
  END IF;

  IF v_usage.action_count >= p_free_tier_limit THEN
    RETURN QUERY SELECT false, 0, v_usage.period_start + make_interval(days => p_window_days);
    RETURN;
  END IF;

  UPDATE tenant_ai_usage
  SET action_count = action_count + 1, updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO v_usage;

  RETURN QUERY SELECT true, (p_free_tier_limit - v_usage.action_count), v_usage.period_start + make_interval(days => p_window_days);
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_and_increment_tenant_ai_quota(uuid, uuid, integer, integer) TO anon, authenticated;
