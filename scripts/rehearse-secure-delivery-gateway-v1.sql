\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.assert_true(p_condition boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT COALESCE(p_condition, false) THEN RAISE EXCEPTION 'REHEARSAL ASSERTION FAILED: %', p_message; END IF;
END;
$$;

INSERT INTO auth.users(id, email) VALUES
  ('10000000-0000-4000-8000-000000000001', 'owner-one@example.test'),
  ('10000000-0000-4000-8000-000000000002', 'owner-two@example.test');
INSERT INTO tenants(id, name, short_code) VALUES
  ('20000000-0000-4000-8000-000000000001', 'Synthetic Tenant One', 'SYN1'),
  ('20000000-0000-4000-8000-000000000002', 'Synthetic Tenant Two', 'SYN2');
INSERT INTO workforce(id, tenant_id, full_name, category, resident_code, email) VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Synthetic Owner One', 'Registrar', 'tst001', 'owner-one@example.test'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Synthetic Owner Two', 'Registrar', 'tst002', 'owner-two@example.test');
INSERT INTO organisation_memberships(
  id, tenant_id, auth_user_id, workforce_id, is_workforce_member, status, claimed_at, claim_method
) VALUES
  ('40000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', true, 'active', timezone('utc'::text, now()), 'synthetic_rehearsal'),
  ('40000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', true, 'active', timezone('utc'::text, now()), 'synthetic_rehearsal');

SELECT pg_temp.assert_true(
  public.workspc_gateway_resolve_actor('10000000-0000-4000-8000-000000000001', NULL)->>'id'
    = '30000000-0000-4000-8000-000000000001',
  'authenticated owner must derive the linked workforce identity'
);
DO $$
BEGIN
  PERFORM public.workspc_gateway_resolve_actor(
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000002'
  );
  RAISE EXCEPTION 'cross-tenant membership was accepted';
EXCEPTION WHEN SQLSTATE '28000' THEN NULL;
END $$;

INSERT INTO communication_contact_points(tenant_id, owner_workforce_id, channel, value_canonical) VALUES
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'EMAIL', 'owner-one@example.test'),
  ('20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'WHATSAPP', '+2348000000001'),
  ('20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', 'EMAIL', 'owner-two@example.test');

SELECT public.workspc_gateway_begin_verification(
  '10000000-0000-4000-8000-000000000001', NULL, 'EMAIL', repeat('a', 64), repeat('b', 64)
);
DO $$
BEGIN
  PERFORM public.workspc_gateway_begin_verification(
    '10000000-0000-4000-8000-000000000001', NULL, 'EMAIL', repeat('c', 64), repeat('b', 64)
  );
  RAISE EXCEPTION 'verification cooldown was bypassed';
EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
END $$;
SELECT public.workspc_gateway_finish_verification_dispatch(
  (SELECT id FROM communication_verification_requests WHERE contact_point_id =
    (SELECT id FROM communication_contact_points WHERE owner_workforce_id = '30000000-0000-4000-8000-000000000001' AND channel = 'EMAIL')
    ORDER BY requested_at DESC LIMIT 1),
  'CHALLENGE_SENT', 'synthetic-provider-message-1', NULL
);
SELECT pg_temp.assert_true(
  public.workspc_gateway_complete_verification(
    '10000000-0000-4000-8000-000000000001', NULL, 'EMAIL', repeat('f', 64), repeat('b', 64)
  )->>'state' = 'CODE_MISMATCH',
  'wrong OTP digest must be rejected and counted'
);
SELECT pg_temp.assert_true(
  (SELECT attempt_count = 1 FROM communication_verification_requests WHERE provider_message_id = 'synthetic-provider-message-1'),
  'wrong OTP attempt must persist atomically'
);
SELECT pg_temp.assert_true(
  public.workspc_gateway_complete_verification(
    '10000000-0000-4000-8000-000000000001', NULL, 'EMAIL', repeat('a', 64), repeat('b', 64)
  )->>'state' = 'VERIFIED',
  'correct live OTP digest must verify once'
);
SELECT pg_temp.assert_true(
  (SELECT verification_state = 'VERIFIED' AND verification_evidence_reference LIKE 'verification:%'
   FROM communication_contact_points WHERE owner_workforce_id = '30000000-0000-4000-8000-000000000001' AND channel = 'EMAIL'),
  'verified contact must retain non-secret evidence reference'
);
SELECT pg_temp.assert_true(
  public.workspc_gateway_complete_verification(
    '10000000-0000-4000-8000-000000000001', NULL, 'EMAIL', repeat('a', 64), repeat('b', 64)
  )->>'state' = 'NOT_FOUND',
  'verification challenge must be one-time consumption'
);

SELECT public.workspc_gateway_begin_verification(
  '10000000-0000-4000-8000-000000000002', NULL, 'EMAIL', repeat('c', 64), repeat('d', 64)
);
UPDATE communication_verification_requests SET expires_at = timezone('utc'::text, now()) - interval '1 second'
WHERE contact_point_id = (SELECT id FROM communication_contact_points WHERE owner_workforce_id = '30000000-0000-4000-8000-000000000002');
SELECT public.workspc_gateway_finish_verification_dispatch(
  (SELECT id FROM communication_verification_requests WHERE contact_point_id =
    (SELECT id FROM communication_contact_points WHERE owner_workforce_id = '30000000-0000-4000-8000-000000000002') ORDER BY requested_at DESC LIMIT 1),
  'CHALLENGE_SENT', 'synthetic-provider-message-2', NULL
);
SELECT pg_temp.assert_true(
  public.workspc_gateway_complete_verification(
    '10000000-0000-4000-8000-000000000002', NULL, 'EMAIL', repeat('c', 64), repeat('d', 64)
  )->>'state' = 'EXPIRED',
  'expired challenge must never verify'
);

UPDATE communication_verification_requests SET requested_at = timezone('utc'::text, now()) - interval '2 minutes',
  resend_available_at = timezone('utc'::text, now()) - interval '1 minute'
WHERE contact_point_id = (SELECT id FROM communication_contact_points WHERE owner_workforce_id = '30000000-0000-4000-8000-000000000002');
SELECT public.workspc_gateway_begin_verification(
  '10000000-0000-4000-8000-000000000002', NULL, 'EMAIL', repeat('e', 64), repeat('d', 64)
);
SELECT public.workspc_gateway_finish_verification_dispatch(
  (SELECT id FROM communication_verification_requests WHERE contact_point_id =
    (SELECT id FROM communication_contact_points WHERE owner_workforce_id = '30000000-0000-4000-8000-000000000002') ORDER BY requested_at DESC LIMIT 1),
  'CHALLENGE_SENT', 'synthetic-provider-message-3', NULL
);
SELECT public.workspc_gateway_complete_verification('10000000-0000-4000-8000-000000000002', NULL, 'EMAIL', repeat('f', 64), repeat('d', 64));
SELECT public.workspc_gateway_complete_verification('10000000-0000-4000-8000-000000000002', NULL, 'EMAIL', repeat('f', 64), repeat('d', 64));
SELECT public.workspc_gateway_complete_verification('10000000-0000-4000-8000-000000000002', NULL, 'EMAIL', repeat('f', 64), repeat('d', 64));
SELECT public.workspc_gateway_complete_verification('10000000-0000-4000-8000-000000000002', NULL, 'EMAIL', repeat('f', 64), repeat('d', 64));
SELECT pg_temp.assert_true(
  public.workspc_gateway_complete_verification(
    '10000000-0000-4000-8000-000000000002', NULL, 'EMAIL', repeat('f', 64), repeat('d', 64)
  )->>'state' = 'ATTEMPTS_EXCEEDED',
  'fifth incorrect challenge attempt must close the challenge'
);
SELECT pg_temp.assert_true(
  (SELECT attempt_count = max_attempts AND status = 'FAILED' FROM communication_verification_requests
   WHERE provider_message_id = 'synthetic-provider-message-3'),
  'attempt cap must persist as a terminal failure'
);

SELECT public.workspc_gateway_begin_verification(
  '10000000-0000-4000-8000-000000000001', NULL, 'WHATSAPP', repeat('1', 64), repeat('2', 64)
);
SELECT public.workspc_gateway_finish_verification_dispatch(
  (SELECT id FROM communication_verification_requests WHERE contact_point_id =
    (SELECT id FROM communication_contact_points WHERE owner_workforce_id = '30000000-0000-4000-8000-000000000001' AND channel = 'WHATSAPP') ORDER BY requested_at DESC LIMIT 1),
  'CHALLENGE_SENT', 'synthetic-provider-message-4', NULL
);
SELECT public.communication_save_contact(
  '30000000-0000-4000-8000-000000000001', 'tst001', NULL, 'WHATSAPP', '+2348000000099'
);
SELECT pg_temp.assert_true(
  public.workspc_gateway_complete_verification(
    '10000000-0000-4000-8000-000000000001', NULL, 'WHATSAPP', repeat('1', 64), repeat('3', 64)
  )->>'state' = 'CONTACT_CHANGED',
  'changing a contact must invalidate its earlier challenge'
);

INSERT INTO communication_verification_requests(
  contact_point_id, provider_contract, status, completed_at, failure_classification
)
SELECT (SELECT id FROM communication_contact_points WHERE owner_workforce_id = '30000000-0000-4000-8000-000000000002'),
  'RESEND_EMAIL', 'FAILED', timezone('utc'::text, now()), 'SYNTHETIC_RATE_LIMIT'
FROM generate_series(1, 3);
DO $$
BEGIN
  PERFORM public.workspc_gateway_begin_verification(
    '10000000-0000-4000-8000-000000000002', NULL, 'EMAIL', repeat('4', 64), repeat('d', 64)
  );
  RAISE EXCEPTION 'hourly verification rate limit was bypassed';
EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
END $$;

INSERT INTO communication_preferences(tenant_id, owner_workforce_id, purpose, channel, enabled)
SELECT '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'SUPPORT_REPLIES', channel, true
FROM unnest(ARRAY['IN_APP', 'EMAIL', 'WHATSAPP']) AS channel;
UPDATE communication_contact_points SET verification_state = 'VERIFIED', verified_at = timezone('utc'::text, now()),
  verification_evidence_reference = 'synthetic:verified'
WHERE owner_workforce_id = '30000000-0000-4000-8000-000000000001';
SELECT public.workspc_gateway_begin_self_test(
  '10000000-0000-4000-8000-000000000001', NULL, '50000000-0000-4000-8000-000000000001'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 3 FROM notification_deliveries WHERE safe_message_reference = 'self_test:50000000-0000-4000-8000-000000000001'),
  'self-test must enqueue one deduplicated delivery per enabled channel'
);
DO $$
BEGIN
  PERFORM * FROM public.workspc_gateway_claim_deliveries(
    '10000000-0000-4000-8000-000000000002', NULL, 'self_test:50000000-0000-4000-8000-000000000001'
  );
  RAISE EXCEPTION 'cross-tenant actor claimed another owner delivery';
EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
END $$;
CREATE TEMP TABLE claimed_delivery_ids AS
SELECT * FROM public.workspc_gateway_claim_deliveries(
  '10000000-0000-4000-8000-000000000001', NULL, 'self_test:50000000-0000-4000-8000-000000000001'
);
SELECT pg_temp.assert_true((SELECT count(*) = 2 FROM claimed_delivery_ids), 'only external deliveries must be claimed');
SELECT pg_temp.assert_true(
  NOT EXISTS(SELECT 1 FROM public.workspc_gateway_claim_deliveries(
    '10000000-0000-4000-8000-000000000001', NULL, 'self_test:50000000-0000-4000-8000-000000000001'
  )),
  'a claimed delivery must not be claimable twice'
);
SELECT public.workspc_gateway_finish_delivery(
  (SELECT delivery_id FROM claimed_delivery_ids WHERE channel = 'EMAIL'),
  'ACCEPTED', 'synthetic-resend-id', NULL
);
SELECT public.workspc_gateway_finish_delivery(
  (SELECT delivery_id FROM claimed_delivery_ids WHERE channel = 'WHATSAPP'),
  'UNKNOWN', NULL, 'PROVIDER_OUTCOME_UNKNOWN'
);
SELECT pg_temp.assert_true(
  (SELECT outcome = 'UNKNOWN' AND retry_eligible = false FROM notification_deliveries
   WHERE id = (SELECT delivery_id FROM claimed_delivery_ids WHERE channel = 'WHATSAPP')),
  'UNKNOWN delivery must remain terminal and non-retryable'
);
SELECT pg_temp.assert_true(public.workspc_gateway_record_provider_event(
  'RESEND_EMAIL', 'synthetic-resend-event-1', 'email.delivered', 'synthetic-resend-id', true, timezone('utc'::text, now())
), 'first signed provider event must be recorded');
SELECT pg_temp.assert_true(NOT public.workspc_gateway_record_provider_event(
  'RESEND_EMAIL', 'synthetic-resend-event-1', 'email.delivered', 'synthetic-resend-id', true, timezone('utc'::text, now())
), 'duplicate provider event must be ignored');
SELECT pg_temp.assert_true(
  (SELECT outcome = 'DELIVERED' FROM notification_deliveries WHERE provider_message_id = 'synthetic-resend-id'),
  'provider delivery evidence must transition ACCEPTED to DELIVERED'
);
WITH synthetic_attempts AS (
  SELECT gen_random_uuid() AS id FROM generate_series(1, 20)
)
INSERT INTO notification_deliveries(
  event_key, recipient_workforce_id, purpose, channel, provider_adapter,
  template_key, template_version, safe_message_reference, outcome,
  attempted_at, terminal_at, retry_eligible, failure_classification
)
SELECT 'self_test:' || id::text, '30000000-0000-4000-8000-000000000001',
  'SUPPORT_REPLIES', 'EMAIL', 'RESEND_EMAIL', 'support_reply', 1,
  'self_test:' || id::text, 'FAILED', timezone('utc'::text, now()),
  timezone('utc'::text, now()), false, 'SYNTHETIC_RATE_LIMIT'
FROM synthetic_attempts;
SELECT public.workspc_gateway_begin_self_test(
  '10000000-0000-4000-8000-000000000001', NULL, '50000000-0000-4000-8000-000000000003'
);
DO $$
BEGIN
  PERFORM * FROM public.workspc_gateway_claim_deliveries(
    '10000000-0000-4000-8000-000000000001', NULL,
    'self_test:50000000-0000-4000-8000-000000000003'
  );
  RAISE EXCEPTION 'external delivery rate limit was bypassed';
EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
END $$;
DO $$
BEGIN
  PERFORM public._communication_enqueue_event(
    'invalid_template:50000000-0000-4000-8000-000000000002',
    '30000000-0000-4000-8000-000000000001', NULL, 'SUPPORT_REPLIES', 'arbitrary_body',
    'self_test:50000000-0000-4000-8000-000000000002'
  );
  RAISE EXCEPTION 'arbitrary notification template was accepted';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'arbitrary notification template was accepted' THEN RAISE; END IF;
END $$;

SELECT public.workspc_gateway_create_payment_attempt(
  '10000000-0000-4000-8000-000000000001', NULL,
  'workspc-fw-60000000-0000-4000-8000-000000000001'
);
SELECT public.workspc_gateway_finish_payment_checkout(
  (SELECT id FROM payment_gateway_attempts WHERE provider_reference = 'workspc-fw-60000000-0000-4000-8000-000000000001'),
  'CHECKOUT_CREATED', NULL
);
SELECT pg_temp.assert_true(
  public.workspc_gateway_apply_verified_payment(
    (SELECT id FROM payment_gateway_attempts WHERE provider_reference = 'workspc-fw-60000000-0000-4000-8000-000000000001'),
    'synthetic-payment-event-mismatch', 'charge.completed', '7000001',
    'workspc-fw-60000000-0000-4000-8000-000000000001', 1199900, 'NGN', 'successful'
  )->>'state' = 'VERIFICATION_REJECTED',
  'amount mismatch must be rejected'
);
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM user_subscriptions), 'mismatched payment must not activate entitlement');

SELECT public.workspc_gateway_create_payment_attempt(
  '10000000-0000-4000-8000-000000000001', NULL,
  'workspc-fw-60000000-0000-4000-8000-000000000002'
);
SELECT public.workspc_gateway_finish_payment_checkout(
  (SELECT id FROM payment_gateway_attempts WHERE provider_reference = 'workspc-fw-60000000-0000-4000-8000-000000000002'),
  'CHECKOUT_CREATED', NULL
);
SELECT pg_temp.assert_true(
  public.workspc_gateway_apply_verified_payment(
    (SELECT id FROM payment_gateway_attempts WHERE provider_reference = 'workspc-fw-60000000-0000-4000-8000-000000000002'),
    'synthetic-payment-event-success', 'charge.completed', '7000002',
    'workspc-fw-60000000-0000-4000-8000-000000000002', 1200000, 'NGN', 'successful'
  )->>'state' = 'VERIFIED_SUCCESS',
  'exact provider verification must activate the intended plan'
);
SELECT pg_temp.assert_true(
  (SELECT count(*) = 1 FROM user_subscriptions s
    JOIN payment_gateway_attempts a ON a.provider_reference = s.provider_reference
    WHERE s.workforce_id = '30000000-0000-4000-8000-000000000001'
      AND s.tenant_id = '20000000-0000-4000-8000-000000000001'
      AND s.plan = 'pro_unlimited' AND s.status = 'active' AND s.amount_ngn = 12000
      AND a.status = 'VERIFIED_SUCCESS' AND a.currency = 'NGN'
      AND a.provider_transaction_id = '7000002'),
  'verified payment must activate only the authenticated owner entitlement'
);
SELECT pg_temp.assert_true(
  public.workspc_gateway_apply_verified_payment(
    (SELECT id FROM payment_gateway_attempts WHERE provider_reference = 'workspc-fw-60000000-0000-4000-8000-000000000002'),
    'synthetic-payment-event-success', 'charge.completed', '7000002',
    'workspc-fw-60000000-0000-4000-8000-000000000002', 1200000, 'NGN', 'successful'
  )->>'state' = 'ALREADY_VERIFIED',
  'duplicate verified payment webhook must be idempotent'
);
SELECT pg_temp.assert_true(
  public.workspc_gateway_apply_verified_payment(
    (SELECT id FROM payment_gateway_attempts WHERE provider_reference = 'workspc-fw-60000000-0000-4000-8000-000000000002'),
    'synthetic-payment-event-semantic-duplicate', 'charge.completed', '7000002',
    'workspc-fw-60000000-0000-4000-8000-000000000002', 1200000, 'NGN', 'successful'
  )->>'state' = 'ALREADY_VERIFIED',
  'a semantically duplicated success event must not extend entitlement again'
);
SELECT pg_temp.assert_true(
  public.workspc_gateway_record_payment_state(
    'synthetic-payment-event-refund', 'charge.refunded',
    'workspc-fw-60000000-0000-4000-8000-000000000002', '7000002', 'REFUNDED'
  )->>'state' = 'REFUNDED',
  'refund event must be durably classified'
);
SELECT pg_temp.assert_true(
  (SELECT status = 'cancelled' FROM user_subscriptions WHERE provider_reference = 'workspc-fw-60000000-0000-4000-8000-000000000002'),
  'refund must revoke the associated entitlement'
);

SELECT pg_temp.assert_true(NOT has_table_privilege('anon', 'communication_provider_events', 'SELECT'), 'anon must not read provider events');
SELECT pg_temp.assert_true(NOT has_table_privilege('authenticated', 'payment_gateway_attempts', 'INSERT'), 'browser must not create payment attempts');
SELECT pg_temp.assert_true(NOT has_function_privilege('anon', 'workspc_gateway_create_payment_attempt(uuid,uuid,text)', 'EXECUTE'), 'anon must not execute payment RPCs');
SELECT pg_temp.assert_true(has_function_privilege('service_role', 'workspc_gateway_create_payment_attempt(uuid,uuid,text)', 'EXECUTE'), 'only the service gateway must execute payment RPCs');
SELECT pg_temp.assert_true(to_regclass('public.case_continuity_actions') IS NULL, 'migration 83 must remain absent');

ROLLBACK;
\echo 'secure delivery gateway disposable SQL rehearsal passed'
