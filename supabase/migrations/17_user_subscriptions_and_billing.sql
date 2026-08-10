-- Migration 17: per-member subscriptions + payment webhook event log
--
-- Backs the Paystack/Flutterwave AI Copilot feature-gating pass:
--   * `user_subscriptions` — one row per checkout/subscription for a
--     workforce member. "user" here means a `workforce` row: this app has
--     no standalone user identity outside workforce (see Role Model in
--     CLAUDE.md), same scope decision as migration 13's research
--     workspaces. Rows are created 'pending' by the payment-checkout Edge
--     Function when a checkout is initiated, and flipped to 'active' by
--     the payment-webhook Edge Function once the provider confirms payment
--     (Paystack charge.success / Flutterwave charge.completed).
--   * `payment_events` — raw webhook receipt log, primarily for
--     idempotency (the UNIQUE constraint makes replayed webhook deliveries
--     no-ops) and audit.
--
-- SPEC DEVIATION (flagged, not silent): the task brief calls the table
-- "user_subscriptions" keyed on users; it is keyed on workforce_id +
-- tenant_id here for the reason above.
--
-- RLS posture (matching every migration since 01 — see CLAUDE.md Security
-- Notes; not a real security boundary):
--   * user_subscriptions gets the same permissive-read policy as sibling
--     tables so the client can show subscription state. Writes are NOT
--     granted to public — only the Edge Functions (service role, which
--     bypasses RLS) create/activate subscriptions, so an anon-key holder
--     can't grant themselves Pro by inserting a row via REST. This is the
--     same deliberately-narrower-than-siblings choice as migration 11's
--     guest_review_invites.
--   * payment_events gets NO policies at all: service-role-only, since raw
--     provider payloads have no business being client-readable.

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  workforce_id uuid NOT NULL REFERENCES workforce(id) ON DELETE CASCADE,
  plan text NOT NULL DEFAULT 'pro_unlimited' CHECK (plan IN ('free', 'pro_unlimited')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'cancelled', 'expired')),
  provider text NOT NULL CHECK (provider IN ('paystack', 'flutterwave')),
  -- Paystack `reference` / Flutterwave `tx_ref` — the join key the webhook
  -- uses to find the pending row it should activate.
  provider_reference text NOT NULL UNIQUE,
  amount_ngn numeric,
  customer_email text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_workforce
  ON user_subscriptions(workforce_id, status, current_period_end);

CREATE TABLE IF NOT EXISTS payment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('paystack', 'flutterwave')),
  event_type text NOT NULL,
  -- Provider-side reference (Paystack reference / Flutterwave tx_ref).
  reference text NOT NULL,
  signature_valid boolean NOT NULL,
  payload jsonb,
  processed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_events_dedupe UNIQUE (provider, event_type, reference)
);

ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_events ENABLE ROW LEVEL SECURITY;

-- Read-only for the anon key; writes go through service-role Edge Functions.
DROP POLICY IF EXISTS "user_subscriptions_select" ON user_subscriptions;
CREATE POLICY "user_subscriptions_select" ON user_subscriptions
  FOR SELECT TO public USING (true);

-- payment_events: deliberately NO policies — service-role only.
