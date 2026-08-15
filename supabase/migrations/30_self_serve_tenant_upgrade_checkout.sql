-- Migration 30: self-serve tenant-level Pro upgrade checkout
--
-- Migration 29 gated Template Manager / Viva Vignette org-content creation
-- behind tenants.plan_type, but flagged a real gap in its own header: there
-- was no self-serve way for a Chief to actually change that plan_type — it
-- only moved via the Platform Operator Console's manual updateTenantPlan.
-- This migration closes that gap by extending the EXISTING per-resident
-- billing machinery (migration 17) to also support an ORGANIZATION-level
-- checkout, rather than building a second parallel table.
--
-- WHY EXTEND user_subscriptions INSTEAD OF A NEW tenant_subscriptions
-- TABLE: payment-checkout/payment-webhook already have one lookup-by-
-- provider_reference code path; a second table would mean two lookups (or
-- guessing which table to check) on every webhook delivery. A `scope`
-- discriminator keeps one audit trail, one webhook code path, one RLS
-- policy set — the same "extend, don't duplicate" precedent this app has
-- followed before (see migration 11's guest_review_invites extending
-- consultant_reviews rather than forking it).
--
-- SHAPE: workforce_id becomes nullable; a CHECK enforces exactly one owner
-- shape per scope so a row can never be ambiguously both/neither:
--   scope='workforce' -> workforce_id required, tenant_id optional (unchanged)
--   scope='tenant'     -> workforce_id NULL, tenant_id required
--
-- PRICING: same flat Pro price as the per-resident checkout (see
-- src/config/tiers.ts / payment-checkout's PLAN_AMOUNT_NGN) — no separate
-- "org tier" price exists; the user's Phase 5 decision was one flat price
-- for everything, not per-scope pricing.
--
-- SAFETY ON ACTIVATION: the webhook only promotes plan_type FROM
-- 'free_seeded' TO 'tier_1' — it will never downgrade or silently overwrite
-- a tenant an operator has manually placed on tier_2/enterprise (a custom/
-- negotiated deal). See payment-webhook/index.ts for the guard.
--
-- NOT part of this migration: tenant deletion/cancellation flows (no
-- "cancel my org's Pro plan" self-serve exists either, matching the
-- per-resident subscription's own scope — cancellation was never built
-- there either, migration 17).

ALTER TABLE user_subscriptions ALTER COLUMN workforce_id DROP NOT NULL;

ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'workforce';

ALTER TABLE user_subscriptions DROP CONSTRAINT IF EXISTS user_subscriptions_scope_check;
ALTER TABLE user_subscriptions ADD CONSTRAINT user_subscriptions_scope_check
  CHECK (scope IN ('workforce', 'tenant'));

ALTER TABLE user_subscriptions DROP CONSTRAINT IF EXISTS user_subscriptions_scope_shape_check;
ALTER TABLE user_subscriptions ADD CONSTRAINT user_subscriptions_scope_shape_check
  CHECK (
    (scope = 'workforce' AND workforce_id IS NOT NULL)
    OR
    (scope = 'tenant' AND workforce_id IS NULL AND tenant_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_tenant_scope
  ON user_subscriptions(tenant_id, scope, status, current_period_end);

-- ====================================================================
-- END OF MIGRATION 30
-- ====================================================================
