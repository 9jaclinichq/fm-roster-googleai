-- ============================================================================
-- Workspc Secure Delivery, Verification and Payment Gateway V1
-- Migration 85 (additive; requires the verified migration-84 / migration-81
-- production lineage and deliberately has no dependency on migrations 82/83).
--
-- ACTIVATION
--   Apply this file transactionally only after disposable rehearsal. Deploy the
--   workspc-gateway Edge Function with all providers disabled first, then bind
--   server-side secret references and activate each provider independently.
--
-- ROLLBACK
--   Disable provider flags first. The new Edge Function can then be removed
--   without dropping durable evidence. Restore _communication_enqueue_event
--   from migration 84 if new events must return to PROVIDER_DISABLED. Do not
--   drop gateway tables after real attempts exist; they are audit evidence.
-- ============================================================================

ALTER TABLE communication_verification_requests
  DROP CONSTRAINT IF EXISTS communication_verification_requests_status_check;
ALTER TABLE communication_verification_requests
  ADD CONSTRAINT communication_verification_requests_status_check CHECK (status IN (
    'PENDING_PROVIDER', 'CHALLENGE_SENT', 'DELIVERY_UNKNOWN', 'VERIFIED',
    'EXPIRED', 'FAILED', 'SUPERSEDED'
  ));
ALTER TABLE communication_verification_requests
  ADD COLUMN requested_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN challenge_digest text,
  ADD COLUMN contact_value_fingerprint text,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 5,
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN resend_available_at timestamptz,
  ADD COLUMN consumed_at timestamptz,
  ADD COLUMN superseded_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE communication_verification_requests
  ADD CONSTRAINT communication_verification_digest_check CHECK (
    challenge_digest IS NULL OR challenge_digest ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT communication_verification_fingerprint_check CHECK (
    contact_value_fingerprint IS NULL OR contact_value_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  ADD CONSTRAINT communication_verification_attempts_check CHECK (
    max_attempts BETWEEN 1 AND 10 AND attempt_count BETWEEN 0 AND max_attempts
  ),
  ADD CONSTRAINT communication_verification_challenge_shape_check CHECK (
    challenge_digest IS NULL OR (
      contact_value_fingerprint IS NOT NULL
      AND requested_by_auth_user_id IS NOT NULL
      AND expires_at IS NOT NULL
      AND resend_available_at IS NOT NULL
    )
  ),
  ADD CONSTRAINT communication_verification_consumption_check CHECK (
    status <> 'VERIFIED' OR (consumed_at IS NOT NULL AND completed_at IS NOT NULL)
  ),
  ADD CONSTRAINT communication_verification_superseded_check CHECK (
    status <> 'SUPERSEDED' OR superseded_at IS NOT NULL
  );

CREATE INDEX communication_verification_contact_recent_idx
  ON communication_verification_requests(contact_point_id, requested_at DESC);
CREATE UNIQUE INDEX communication_verification_one_live_idx
  ON communication_verification_requests(contact_point_id)
  WHERE status IN ('PENDING_PROVIDER', 'CHALLENGE_SENT', 'DELIVERY_UNKNOWN')
    AND consumed_at IS NULL AND superseded_at IS NULL;

DROP TRIGGER IF EXISTS communication_verification_requests_updated_at ON communication_verification_requests;
CREATE TRIGGER communication_verification_requests_updated_at
BEFORE UPDATE ON communication_verification_requests
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_provider_adapter_check;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_provider_adapter_check CHECK (provider_adapter IN (
    'IN_APP', 'META_WHATSAPP_DISABLED', 'RESEND_EMAIL_DISABLED',
    'META_WHATSAPP', 'RESEND_EMAIL'
  ));
ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_outcome_check;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_outcome_check CHECK (outcome IN (
    'PENDING', 'SENT', 'ACCEPTED', 'DELIVERED', 'FAILED', 'UNKNOWN'
  ));
ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_terminal_check;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_terminal_check CHECK (
    (outcome = 'PENDING' AND terminal_at IS NULL)
    OR (outcome <> 'PENDING' AND terminal_at IS NOT NULL)
  );
ALTER TABLE notification_deliveries
  ADD COLUMN accepted_at timestamptz,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN provider_last_event_id text,
  ADD COLUMN provider_status text;
ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_delivery_acceptance_check CHECK (
    outcome NOT IN ('ACCEPTED', 'DELIVERED') OR (provider_message_id IS NOT NULL AND accepted_at IS NOT NULL)
  ),
  ADD CONSTRAINT notification_delivery_delivered_check CHECK (
    outcome <> 'DELIVERED' OR delivered_at IS NOT NULL
  );

CREATE TABLE communication_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('RESEND_EMAIL', 'META_WHATSAPP')),
  provider_event_id text NOT NULL,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 120),
  delivery_id uuid REFERENCES notification_deliveries(id) ON DELETE SET NULL,
  provider_message_id text,
  signature_verified boolean NOT NULL,
  provider_occurred_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT communication_provider_event_dedupe UNIQUE (provider, provider_event_id)
);

CREATE TABLE payment_gateway_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  workforce_id uuid NOT NULL REFERENCES workforce(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose = 'WORKFORCE_PRO_UNLIMITED'),
  plan text NOT NULL CHECK (plan = 'pro_unlimited'),
  provider text NOT NULL CHECK (provider = 'flutterwave'),
  provider_reference text NOT NULL UNIQUE CHECK (
    provider_reference ~ '^workspc-fw-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  provider_transaction_id text,
  amount_minor bigint NOT NULL CHECK (amount_minor = 1200000),
  currency text NOT NULL CHECK (currency = 'NGN'),
  status text NOT NULL CHECK (status IN (
    'INITIATED', 'CHECKOUT_CREATED', 'PENDING', 'VERIFIED_SUCCESS',
    'FAILED', 'CANCELLED', 'UNKNOWN', 'REFUNDED', 'DISPUTED'
  )),
  failure_classification text,
  initiated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  provider_verified_at timestamptz,
  terminal_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT payment_gateway_verified_check CHECK (
    status <> 'VERIFIED_SUCCESS'
    OR (provider_transaction_id IS NOT NULL AND provider_verified_at IS NOT NULL AND terminal_at IS NOT NULL)
  ),
  CONSTRAINT payment_gateway_terminal_check CHECK (
    (status IN ('INITIATED', 'CHECKOUT_CREATED', 'PENDING') AND terminal_at IS NULL)
    OR (status NOT IN ('INITIATED', 'CHECKOUT_CREATED', 'PENDING') AND terminal_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX payment_gateway_provider_transaction_unique
  ON payment_gateway_attempts(provider, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
CREATE INDEX payment_gateway_owner_recent_idx
  ON payment_gateway_attempts(auth_user_id, initiated_at DESC);

CREATE TABLE payment_gateway_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider = 'flutterwave'),
  provider_event_id text NOT NULL,
  event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 120),
  attempt_id uuid REFERENCES payment_gateway_attempts(id) ON DELETE SET NULL,
  provider_reference text,
  provider_transaction_id text,
  signature_verified boolean NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN (
    'NOT_REQUIRED', 'VERIFIED_MATCH', 'VERIFICATION_REJECTED', 'VERIFICATION_UNKNOWN'
  )),
  received_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT payment_gateway_event_dedupe UNIQUE (provider, provider_event_id)
);

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'communication_provider_events', 'payment_gateway_attempts', 'payment_gateway_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', v_table);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', v_table);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS payment_gateway_attempts_updated_at ON payment_gateway_attempts;
CREATE TRIGGER payment_gateway_attempts_updated_at
BEFORE UPDATE ON payment_gateway_attempts
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public.workspc_gateway_resolve_actor(
  p_auth_user_id uuid, p_membership_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_membership organisation_memberships%ROWTYPE;
  v_workforce workforce%ROWTYPE;
  v_doctor doctor_profiles%ROWTYPE;
  v_membership_count integer;
BEGIN
  IF p_auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated identity required' USING ERRCODE = '28000';
  END IF;

  IF p_membership_id IS NOT NULL THEN
    SELECT * INTO v_membership FROM organisation_memberships om
    WHERE om.id = p_membership_id AND om.auth_user_id = p_auth_user_id
      AND om.status = 'active' AND om.is_workforce_member = true AND om.workforce_id IS NOT NULL;
  ELSE
    SELECT count(*) INTO v_membership_count FROM organisation_memberships om
    WHERE om.auth_user_id = p_auth_user_id AND om.status = 'active'
      AND om.is_workforce_member = true AND om.workforce_id IS NOT NULL;
    IF v_membership_count = 1 THEN
      SELECT * INTO v_membership FROM organisation_memberships om
      WHERE om.auth_user_id = p_auth_user_id AND om.status = 'active'
        AND om.is_workforce_member = true AND om.workforce_id IS NOT NULL;
    ELSIF v_membership_count > 1 THEN
      RAISE EXCEPTION 'An explicit active membership is required' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_membership.id IS NOT NULL THEN
    SELECT * INTO v_workforce FROM workforce w
    WHERE w.id = v_membership.workforce_id AND w.tenant_id = v_membership.tenant_id AND w.active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active workforce identity not found' USING ERRCODE = '28000'; END IF;
    RETURN jsonb_build_object(
      'kind', 'WORKFORCE', 'id', v_workforce.id, 'tenant_id', v_workforce.tenant_id,
      'membership_id', v_membership.id, 'is_tenant_admin', v_membership.is_tenant_admin
    );
  END IF;

  SELECT * INTO v_doctor FROM doctor_profiles d WHERE d.id = p_auth_user_id;
  IF FOUND THEN
    RETURN jsonb_build_object(
      'kind', 'DOCTOR', 'id', v_doctor.id, 'tenant_id', NULL,
      'membership_id', NULL, 'is_tenant_admin', false
    );
  END IF;
  RAISE EXCEPTION 'No active Workspc owner identity for this account' USING ERRCODE = '28000';
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_gateway_begin_verification(
  p_auth_user_id uuid, p_membership_id uuid, p_channel text,
  p_challenge_digest text, p_contact_value_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor jsonb;
  v_contact communication_contact_points%ROWTYPE;
  v_latest communication_verification_requests%ROWTYPE;
  v_request_id uuid := gen_random_uuid();
  v_recent_count integer;
  v_now timestamptz := timezone('utc'::text, now());
BEGIN
  IF p_channel NOT IN ('EMAIL', 'WHATSAPP')
    OR p_challenge_digest !~ '^[0-9a-f]{64}$'
    OR p_contact_value_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid verification request' USING ERRCODE = '22023';
  END IF;
  v_actor := public.workspc_gateway_resolve_actor(p_auth_user_id, p_membership_id);
  SELECT * INTO v_contact FROM communication_contact_points c
  WHERE c.channel = p_channel AND (
    (v_actor->>'kind' = 'WORKFORCE' AND c.owner_workforce_id = (v_actor->>'id')::uuid)
    OR (v_actor->>'kind' = 'DOCTOR' AND c.owner_doctor_id = (v_actor->>'id')::uuid)
  ) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Save this contact before verification' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_latest FROM communication_verification_requests r
  WHERE r.contact_point_id = v_contact.id ORDER BY r.requested_at DESC LIMIT 1 FOR UPDATE;
  IF v_latest.id IS NOT NULL AND v_latest.resend_available_at > v_now
    AND v_latest.status IN ('PENDING_PROVIDER', 'CHALLENGE_SENT', 'DELIVERY_UNKNOWN') THEN
    RAISE EXCEPTION 'Verification resend cooldown is active' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_recent_count FROM communication_verification_requests r
  WHERE r.contact_point_id = v_contact.id AND r.requested_at > v_now - interval '1 hour';
  IF v_recent_count >= 5 THEN
    RAISE EXCEPTION 'Verification rate limit exceeded' USING ERRCODE = '55000';
  END IF;

  UPDATE communication_verification_requests SET
    status = 'SUPERSEDED', superseded_at = v_now, completed_at = v_now
  WHERE contact_point_id = v_contact.id
    AND status IN ('PENDING_PROVIDER', 'CHALLENGE_SENT', 'DELIVERY_UNKNOWN')
    AND consumed_at IS NULL AND superseded_at IS NULL;

  INSERT INTO communication_verification_requests(
    id, contact_point_id, provider_contract, status, requested_by_auth_user_id,
    challenge_digest, contact_value_fingerprint, attempt_count, max_attempts,
    expires_at, resend_available_at
  ) VALUES (
    v_request_id, v_contact.id,
    CASE WHEN p_channel = 'EMAIL' THEN 'RESEND_EMAIL' ELSE 'META_WHATSAPP' END,
    'PENDING_PROVIDER', p_auth_user_id, p_challenge_digest, p_contact_value_fingerprint,
    0, 5, v_now + interval '10 minutes', v_now + interval '60 seconds'
  );
  UPDATE communication_contact_points SET
    verification_state = 'PENDING_VERIFICATION', verified_at = NULL,
    verification_evidence_reference = NULL
  WHERE id = v_contact.id;

  RETURN jsonb_build_object(
    'request_id', v_request_id, 'contact_point_id', v_contact.id,
    'channel', v_contact.channel, 'value_canonical', v_contact.value_canonical,
    'expires_at', v_now + interval '10 minutes'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_gateway_finish_verification_dispatch(
  p_request_id uuid, p_outcome text, p_provider_message_id text, p_failure_classification text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_outcome NOT IN ('CHALLENGE_SENT', 'FAILED', 'DELIVERY_UNKNOWN') THEN
    RAISE EXCEPTION 'Invalid verification delivery outcome';
  END IF;
  UPDATE communication_verification_requests SET
    status = p_outcome,
    provider_message_id = CASE WHEN p_outcome = 'CHALLENGE_SENT' THEN p_provider_message_id ELSE NULL END,
    failure_classification = p_failure_classification,
    completed_at = CASE WHEN p_outcome = 'FAILED' THEN timezone('utc'::text, now()) ELSE NULL END
  WHERE id = p_request_id AND status = 'PENDING_PROVIDER';
  IF NOT FOUND THEN RAISE EXCEPTION 'Verification request is not dispatchable'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_gateway_complete_verification(
  p_auth_user_id uuid, p_membership_id uuid, p_channel text,
  p_submitted_digest text, p_contact_value_fingerprint text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor jsonb;
  v_contact communication_contact_points%ROWTYPE;
  v_request communication_verification_requests%ROWTYPE;
  v_now timestamptz := timezone('utc'::text, now());
  v_next_attempt integer;
BEGIN
  IF p_channel NOT IN ('EMAIL', 'WHATSAPP') OR p_submitted_digest !~ '^[0-9a-f]{64}$'
    OR p_contact_value_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('state', 'INVALID_INPUT');
  END IF;
  v_actor := public.workspc_gateway_resolve_actor(p_auth_user_id, p_membership_id);
  SELECT * INTO v_contact FROM communication_contact_points c
  WHERE c.channel = p_channel AND (
    (v_actor->>'kind' = 'WORKFORCE' AND c.owner_workforce_id = (v_actor->>'id')::uuid)
    OR (v_actor->>'kind' = 'DOCTOR' AND c.owner_doctor_id = (v_actor->>'id')::uuid)
  ) FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'NOT_FOUND'); END IF;

  SELECT * INTO v_request FROM communication_verification_requests r
  WHERE r.contact_point_id = v_contact.id AND r.status IN ('CHALLENGE_SENT', 'DELIVERY_UNKNOWN')
    AND r.consumed_at IS NULL AND r.superseded_at IS NULL
  ORDER BY r.requested_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'NOT_FOUND'); END IF;
  IF v_request.contact_value_fingerprint <> p_contact_value_fingerprint THEN
    UPDATE communication_verification_requests SET status = 'SUPERSEDED', superseded_at = v_now, completed_at = v_now
    WHERE id = v_request.id;
    RETURN jsonb_build_object('state', 'CONTACT_CHANGED');
  END IF;
  IF v_request.expires_at <= v_now THEN
    UPDATE communication_verification_requests SET status = 'EXPIRED', completed_at = v_now WHERE id = v_request.id;
    RETURN jsonb_build_object('state', 'EXPIRED');
  END IF;
  IF v_request.attempt_count >= v_request.max_attempts THEN
    RETURN jsonb_build_object('state', 'ATTEMPTS_EXCEEDED');
  END IF;

  v_next_attempt := v_request.attempt_count + 1;
  IF v_request.challenge_digest <> p_submitted_digest THEN
    UPDATE communication_verification_requests SET
      attempt_count = v_next_attempt,
      status = CASE WHEN v_next_attempt >= v_request.max_attempts THEN 'FAILED' ELSE status END,
      completed_at = CASE WHEN v_next_attempt >= v_request.max_attempts THEN v_now ELSE completed_at END,
      failure_classification = CASE WHEN v_next_attempt >= v_request.max_attempts THEN 'ATTEMPTS_EXCEEDED' ELSE 'CODE_MISMATCH' END
    WHERE id = v_request.id;
    RETURN jsonb_build_object(
      'state', CASE WHEN v_next_attempt >= v_request.max_attempts THEN 'ATTEMPTS_EXCEEDED' ELSE 'CODE_MISMATCH' END,
      'attempts_remaining', greatest(v_request.max_attempts - v_next_attempt, 0)
    );
  END IF;

  UPDATE communication_verification_requests SET
    attempt_count = v_next_attempt, status = 'VERIFIED', consumed_at = v_now,
    completed_at = v_now, failure_classification = NULL
  WHERE id = v_request.id;
  UPDATE communication_contact_points SET
    verification_state = 'VERIFIED', verified_at = v_now,
    verification_evidence_reference = 'verification:' || v_request.id::text
  WHERE id = v_contact.id;
  RETURN jsonb_build_object('state', 'VERIFIED', 'verified_at', v_now);
END;
$$;

CREATE OR REPLACE FUNCTION public._communication_enqueue_event(
  p_event_key text, p_recipient_workforce_id uuid, p_recipient_doctor_id uuid,
  p_purpose text, p_template_key text, p_safe_message_reference text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_channel text;
  v_contact_verified boolean;
BEGIN
  IF p_event_key IS NULL OR p_event_key !~ '^[a-z_]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR p_safe_message_reference IS NULL OR p_safe_message_reference !~ '^[a-z_]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'Unsafe delivery reference';
  END IF;
  IF p_template_key NOT IN (
    'support_conversation_opened', 'support_reply', 'review_invitation_created',
    'review_coordination_reply', 'announcements_manage_coordination',
    'meetings_manage_coordination', 'roster_coordinate_coordination',
    'knowledge_publish_coordination', 'review_coordinate_coordination',
    'member_support_coordination'
  ) THEN RAISE EXCEPTION 'Unsupported notification template'; END IF;

  FOR v_channel IN
    SELECT preference.channel FROM communication_preferences preference
    WHERE preference.purpose = p_purpose AND preference.enabled = true
      AND ((p_recipient_workforce_id IS NOT NULL AND preference.owner_workforce_id = p_recipient_workforce_id)
        OR (p_recipient_doctor_id IS NOT NULL AND preference.owner_doctor_id = p_recipient_doctor_id))
  LOOP
    IF v_channel = 'IN_APP' THEN
      INSERT INTO notification_deliveries(
        event_key, recipient_workforce_id, recipient_doctor_id, purpose, channel,
        provider_adapter, template_key, template_version, safe_message_reference,
        outcome, attempted_at, terminal_at, retry_eligible
      ) VALUES (
        p_event_key, p_recipient_workforce_id, p_recipient_doctor_id, p_purpose, v_channel,
        'IN_APP', p_template_key, 1, p_safe_message_reference,
        'SENT', timezone('utc'::text, now()), timezone('utc'::text, now()), false
      ) ON CONFLICT (event_key, recipient_owner_key, channel) DO NOTHING;
    ELSE
      SELECT EXISTS(
        SELECT 1 FROM communication_contact_points contact
        WHERE contact.channel = v_channel AND contact.verification_state = 'VERIFIED'
          AND ((p_recipient_workforce_id IS NOT NULL AND contact.owner_workforce_id = p_recipient_workforce_id)
            OR (p_recipient_doctor_id IS NOT NULL AND contact.owner_doctor_id = p_recipient_doctor_id))
      ) INTO v_contact_verified;
      INSERT INTO notification_deliveries(
        event_key, recipient_workforce_id, recipient_doctor_id, purpose, channel,
        provider_adapter, template_key, template_version, safe_message_reference,
        outcome, attempted_at, terminal_at, retry_eligible, failure_classification
      ) VALUES (
        p_event_key, p_recipient_workforce_id, p_recipient_doctor_id, p_purpose, v_channel,
        CASE WHEN v_channel = 'WHATSAPP' THEN 'META_WHATSAPP' ELSE 'RESEND_EMAIL' END,
        p_template_key, 1, p_safe_message_reference,
        CASE WHEN v_contact_verified THEN 'PENDING' ELSE 'FAILED' END,
        CASE WHEN v_contact_verified THEN NULL ELSE timezone('utc'::text, now()) END,
        CASE WHEN v_contact_verified THEN NULL ELSE timezone('utc'::text, now()) END,
        false, CASE WHEN v_contact_verified THEN NULL ELSE 'CONTACT_NOT_VERIFIED' END
      ) ON CONFLICT (event_key, recipient_owner_key, channel) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_gateway_begin_self_test(
  p_auth_user_id uuid, p_membership_id uuid, p_event_id uuid
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor jsonb; v_reference text;
BEGIN
  v_actor := public.workspc_gateway_resolve_actor(p_auth_user_id, p_membership_id);
  v_reference := 'self_test:' || p_event_id::text;
  PERFORM public._communication_enqueue_event(
    v_reference,
    CASE WHEN v_actor->>'kind' = 'WORKFORCE' THEN (v_actor->>'id')::uuid ELSE NULL END,
    CASE WHEN v_actor->>'kind' = 'DOCTOR' THEN (v_actor->>'id')::uuid ELSE NULL END,
    'SUPPORT_REPLIES', 'support_reply', v_reference
  );
  RETURN v_reference;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_gateway_claim_deliveries(
  p_auth_user_id uuid, p_membership_id uuid, p_safe_message_reference text
)
RETURNS TABLE(
  delivery_id uuid, channel text, value_canonical text, purpose text, template_key text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor jsonb;
  v_reference_id uuid;
  v_authorized boolean := false;
  v_recent_dispatch_count integer;
BEGIN
  IF p_safe_message_reference !~ '^(conversation|review_invitation|self_test):[0-9a-f-]{36}$' THEN
    RAISE EXCEPTION 'Unsupported delivery reference' USING ERRCODE = '22023';
  END IF;
  v_actor := public.workspc_gateway_resolve_actor(p_auth_user_id, p_membership_id);
  v_reference_id := split_part(p_safe_message_reference, ':', 2)::uuid;

  IF p_safe_message_reference LIKE 'self_test:%' THEN
    SELECT EXISTS(
      SELECT 1 FROM notification_deliveries d WHERE d.safe_message_reference = p_safe_message_reference
        AND ((v_actor->>'kind' = 'WORKFORCE' AND d.recipient_workforce_id = (v_actor->>'id')::uuid)
          OR (v_actor->>'kind' = 'DOCTOR' AND d.recipient_doctor_id = (v_actor->>'id')::uuid))
    ) INTO v_authorized;
  ELSIF p_safe_message_reference LIKE 'review_invitation:%' THEN
    SELECT EXISTS(
      SELECT 1 FROM review_invitations i
      WHERE i.id = v_reference_id AND v_actor->>'kind' = 'WORKFORCE'
        AND i.inviter_workforce_id = (v_actor->>'id')::uuid
    ) INTO v_authorized;
  ELSE
    SELECT EXISTS(
      SELECT 1 FROM communication_participants cp
      WHERE cp.conversation_id = v_reference_id AND cp.access_revoked_at IS NULL
        AND ((v_actor->>'kind' = 'WORKFORCE' AND cp.workforce_id = (v_actor->>'id')::uuid)
          OR (v_actor->>'kind' = 'DOCTOR' AND cp.doctor_id = (v_actor->>'id')::uuid))
    ) INTO v_authorized;
  END IF;
  IF NOT v_authorized THEN RAISE EXCEPTION 'Delivery dispatch is not authorized' USING ERRCODE = '42501'; END IF;

  SELECT count(*) INTO v_recent_dispatch_count FROM notification_deliveries d
  WHERE d.channel IN ('EMAIL', 'WHATSAPP')
    AND d.attempted_at > timezone('utc'::text, now()) - interval '1 hour'
    AND ((v_actor->>'kind' = 'WORKFORCE' AND d.recipient_workforce_id = (v_actor->>'id')::uuid)
      OR (v_actor->>'kind' = 'DOCTOR' AND d.recipient_doctor_id = (v_actor->>'id')::uuid));
  IF v_recent_dispatch_count >= 20 THEN
    RAISE EXCEPTION 'External delivery rate limit exceeded' USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  WITH claimed AS (
    UPDATE notification_deliveries d SET
      outcome = 'UNKNOWN', attempted_at = timezone('utc'::text, now()),
      terminal_at = timezone('utc'::text, now()), retry_eligible = false,
      failure_classification = 'DISPATCH_OUTCOME_PENDING'
    WHERE d.id IN (
      SELECT candidate.id FROM notification_deliveries candidate
      WHERE candidate.safe_message_reference = p_safe_message_reference
        AND candidate.channel IN ('EMAIL', 'WHATSAPP')
        AND candidate.outcome = 'PENDING' AND candidate.attempted_at IS NULL
      ORDER BY candidate.created_at FOR UPDATE SKIP LOCKED
    )
    RETURNING d.*
  )
  SELECT claimed.id, claimed.channel, contact.value_canonical, claimed.purpose, claimed.template_key
  FROM claimed JOIN communication_contact_points contact ON (
    contact.channel = claimed.channel AND contact.verification_state = 'VERIFIED'
    AND ((claimed.recipient_workforce_id IS NOT NULL AND contact.owner_workforce_id = claimed.recipient_workforce_id)
      OR (claimed.recipient_doctor_id IS NOT NULL AND contact.owner_doctor_id = claimed.recipient_doctor_id))
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_gateway_finish_delivery(
  p_delivery_id uuid, p_outcome text, p_provider_message_id text, p_failure_classification text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_outcome NOT IN ('ACCEPTED', 'FAILED', 'UNKNOWN') THEN RAISE EXCEPTION 'Invalid delivery outcome'; END IF;
  UPDATE notification_deliveries SET
    outcome = p_outcome,
    provider_message_id = CASE WHEN p_outcome = 'ACCEPTED' THEN p_provider_message_id ELSE provider_message_id END,
    accepted_at = CASE WHEN p_outcome = 'ACCEPTED' THEN timezone('utc'::text, now()) ELSE accepted_at END,
    failure_classification = p_failure_classification,
    retry_eligible = false
  WHERE id = p_delivery_id AND outcome = 'UNKNOWN' AND failure_classification = 'DISPATCH_OUTCOME_PENDING';
  IF NOT FOUND THEN RAISE EXCEPTION 'Delivery is not awaiting a provider result'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_gateway_record_provider_event(
  p_provider text, p_provider_event_id text, p_event_type text,
  p_provider_message_id text, p_delivered boolean, p_provider_occurred_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_delivery_id uuid; v_inserted_id uuid;
BEGIN
  SELECT d.id INTO v_delivery_id FROM notification_deliveries d
  WHERE d.provider_message_id = p_provider_message_id ORDER BY d.created_at DESC LIMIT 1;
  INSERT INTO communication_provider_events(
    provider, provider_event_id, event_type, delivery_id, provider_message_id,
    signature_verified, provider_occurred_at
  ) VALUES (
    p_provider, p_provider_event_id, p_event_type, v_delivery_id, p_provider_message_id,
    true, p_provider_occurred_at
  ) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id INTO v_inserted_id;
  IF v_inserted_id IS NULL THEN RETURN false; END IF;
  IF p_delivered AND v_delivery_id IS NOT NULL THEN
    UPDATE notification_deliveries SET
      outcome = 'DELIVERED', delivered_at = timezone('utc'::text, now()),
      terminal_at = timezone('utc'::text, now()), provider_last_event_id = p_provider_event_id,
      provider_status = p_event_type, failure_classification = NULL
    WHERE id = v_delivery_id AND outcome IN ('ACCEPTED', 'DELIVERED');
  ELSIF v_delivery_id IS NOT NULL THEN
    UPDATE notification_deliveries SET provider_last_event_id = p_provider_event_id, provider_status = p_event_type
    WHERE id = v_delivery_id;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_gateway_create_payment_attempt(
  p_auth_user_id uuid, p_membership_id uuid, p_provider_reference text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor jsonb; v_attempt_id uuid := gen_random_uuid();
BEGIN
  v_actor := public.workspc_gateway_resolve_actor(p_auth_user_id, p_membership_id);
  IF v_actor->>'kind' <> 'WORKFORCE' THEN
    RAISE EXCEPTION 'This payment purpose requires an active workforce membership' USING ERRCODE = '42501';
  END IF;
  IF EXISTS(
    SELECT 1 FROM user_subscriptions s WHERE s.workforce_id = (v_actor->>'id')::uuid
      AND s.plan = 'pro_unlimited' AND s.status = 'active'
      AND s.current_period_end > timezone('utc'::text, now())
  ) THEN RAISE EXCEPTION 'This owner already has an active plan' USING ERRCODE = '55000'; END IF;
  IF EXISTS(
    SELECT 1 FROM payment_gateway_attempts a WHERE a.auth_user_id = p_auth_user_id
      AND a.status IN ('INITIATED', 'CHECKOUT_CREATED', 'PENDING')
      AND a.initiated_at > timezone('utc'::text, now()) - interval '15 minutes'
  ) THEN RAISE EXCEPTION 'A recent payment attempt is already open' USING ERRCODE = '55000'; END IF;

  INSERT INTO payment_gateway_attempts(
    id, auth_user_id, tenant_id, workforce_id, purpose, plan, provider,
    provider_reference, amount_minor, currency, status
  ) VALUES (
    v_attempt_id, p_auth_user_id, (v_actor->>'tenant_id')::uuid, (v_actor->>'id')::uuid,
    'WORKFORCE_PRO_UNLIMITED', 'pro_unlimited', 'flutterwave',
    p_provider_reference, 1200000, 'NGN', 'INITIATED'
  );
  RETURN jsonb_build_object(
    'attempt_id', v_attempt_id, 'provider_reference', p_provider_reference,
    'amount_minor', 1200000, 'currency', 'NGN', 'purpose', 'WORKFORCE_PRO_UNLIMITED'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_gateway_finish_payment_checkout(
  p_attempt_id uuid, p_status text, p_failure_classification text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('CHECKOUT_CREATED', 'FAILED', 'UNKNOWN') THEN RAISE EXCEPTION 'Invalid checkout status'; END IF;
  UPDATE payment_gateway_attempts SET
    status = p_status, failure_classification = p_failure_classification,
    terminal_at = CASE WHEN p_status IN ('FAILED', 'UNKNOWN') THEN timezone('utc'::text, now()) ELSE NULL END
  WHERE id = p_attempt_id AND status = 'INITIATED';
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment attempt is not initializable'; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_gateway_apply_verified_payment(
  p_attempt_id uuid, p_provider_event_id text, p_event_type text,
  p_provider_transaction_id text, p_provider_reference text,
  p_amount_minor bigint, p_currency text, p_provider_status text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_attempt payment_gateway_attempts%ROWTYPE;
  v_event_id uuid;
  v_now timestamptz := timezone('utc'::text, now());
BEGIN
  SELECT * INTO v_attempt FROM payment_gateway_attempts a WHERE a.id = p_attempt_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'ATTEMPT_NOT_FOUND'); END IF;
  INSERT INTO payment_gateway_events(
    provider, provider_event_id, event_type, attempt_id, provider_reference,
    provider_transaction_id, signature_verified, verification_status
  ) VALUES (
    'flutterwave', p_provider_event_id, p_event_type, v_attempt.id, p_provider_reference,
    p_provider_transaction_id, true,
    CASE WHEN p_provider_reference = v_attempt.provider_reference
      AND p_amount_minor = v_attempt.amount_minor AND p_currency = v_attempt.currency
      AND lower(p_provider_status) = 'successful'
      AND p_provider_transaction_id IS NOT NULL AND p_provider_transaction_id <> ''
      AND (v_attempt.provider_transaction_id IS NULL OR p_provider_transaction_id = v_attempt.provider_transaction_id)
      THEN 'VERIFIED_MATCH' ELSE 'VERIFICATION_REJECTED' END
  ) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN
    RETURN jsonb_build_object('state', CASE WHEN v_attempt.status = 'VERIFIED_SUCCESS' THEN 'ALREADY_VERIFIED' ELSE 'DUPLICATE_EVENT' END);
  END IF;
  IF v_attempt.status = 'VERIFIED_SUCCESS' THEN
    IF p_provider_transaction_id = v_attempt.provider_transaction_id
      AND p_provider_reference = v_attempt.provider_reference
      AND p_amount_minor = v_attempt.amount_minor AND p_currency = v_attempt.currency
      AND lower(p_provider_status) = 'successful' THEN
      RETURN jsonb_build_object('state', 'ALREADY_VERIFIED');
    END IF;
    RETURN jsonb_build_object('state', 'VERIFICATION_REJECTED_EXISTING_UNCHANGED');
  END IF;
  IF p_provider_reference <> v_attempt.provider_reference OR p_amount_minor <> v_attempt.amount_minor
    OR p_currency <> v_attempt.currency OR lower(p_provider_status) <> 'successful'
    OR p_provider_transaction_id IS NULL OR p_provider_transaction_id = '' THEN
    UPDATE payment_gateway_attempts SET
      status = 'FAILED', terminal_at = v_now, failure_classification = 'PROVIDER_VERIFICATION_MISMATCH'
    WHERE id = v_attempt.id AND status <> 'VERIFIED_SUCCESS';
    RETURN jsonb_build_object('state', 'VERIFICATION_REJECTED');
  END IF;

  UPDATE payment_gateway_attempts SET
    status = 'VERIFIED_SUCCESS', provider_transaction_id = p_provider_transaction_id,
    provider_verified_at = v_now, terminal_at = v_now, failure_classification = NULL
  WHERE id = v_attempt.id;
  INSERT INTO user_subscriptions(
    tenant_id, workforce_id, scope, plan, status, provider, provider_reference,
    amount_ngn, current_period_start, current_period_end
  ) VALUES (
    v_attempt.tenant_id, v_attempt.workforce_id, 'workforce', 'pro_unlimited', 'active',
    'flutterwave', v_attempt.provider_reference, v_attempt.amount_minor::numeric / 100,
    v_now, v_now + interval '30 days'
  ) ON CONFLICT (provider_reference) DO UPDATE SET
    status = 'active', current_period_start = EXCLUDED.current_period_start,
    current_period_end = EXCLUDED.current_period_end,
    updated_at = v_now;
  RETURN jsonb_build_object('state', 'VERIFIED_SUCCESS');
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_gateway_record_payment_state(
  p_provider_event_id text, p_event_type text, p_provider_reference text,
  p_provider_transaction_id text, p_status text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_attempt payment_gateway_attempts%ROWTYPE; v_event_id uuid; v_now timestamptz := timezone('utc'::text, now());
BEGIN
  IF p_status NOT IN ('PENDING', 'FAILED', 'CANCELLED', 'UNKNOWN', 'REFUNDED', 'DISPUTED') THEN
    RAISE EXCEPTION 'Unsupported payment state';
  END IF;
  SELECT * INTO v_attempt FROM payment_gateway_attempts a
  WHERE a.provider_reference = p_provider_reference FOR UPDATE;
  INSERT INTO payment_gateway_events(
    provider, provider_event_id, event_type, attempt_id, provider_reference,
    provider_transaction_id, signature_verified, verification_status
  ) VALUES (
    'flutterwave', p_provider_event_id, p_event_type, v_attempt.id, p_provider_reference,
    p_provider_transaction_id, true, 'NOT_REQUIRED'
  ) ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN RETURN jsonb_build_object('state', 'DUPLICATE_EVENT'); END IF;
  IF v_attempt.id IS NULL THEN RETURN jsonb_build_object('state', 'ATTEMPT_NOT_FOUND'); END IF;
  IF v_attempt.status = 'VERIFIED_SUCCESS' AND p_status NOT IN ('REFUNDED', 'DISPUTED') THEN
    RETURN jsonb_build_object('state', 'VERIFIED_SUCCESS_UNCHANGED');
  END IF;
  UPDATE payment_gateway_attempts SET
    status = p_status,
    provider_transaction_id = COALESCE(p_provider_transaction_id, provider_transaction_id),
    terminal_at = CASE WHEN p_status = 'PENDING' THEN NULL ELSE v_now END,
    failure_classification = p_status
  WHERE id = v_attempt.id;
  IF p_status IN ('REFUNDED', 'DISPUTED') THEN
    UPDATE user_subscriptions SET status = 'cancelled', updated_at = v_now
    WHERE provider = 'flutterwave' AND provider_reference = v_attempt.provider_reference
      AND status = 'active';
  END IF;
  RETURN jsonb_build_object('state', p_status);
END;
$$;

DO $$
DECLARE v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'workspc_gateway_resolve_actor(uuid,uuid)',
    'workspc_gateway_begin_verification(uuid,uuid,text,text,text)',
    'workspc_gateway_finish_verification_dispatch(uuid,text,text,text)',
    'workspc_gateway_complete_verification(uuid,uuid,text,text,text)',
    'workspc_gateway_begin_self_test(uuid,uuid,uuid)',
    'workspc_gateway_claim_deliveries(uuid,uuid,text)',
    'workspc_gateway_finish_delivery(uuid,text,text,text)',
    'workspc_gateway_record_provider_event(text,text,text,text,boolean,timestamptz)',
    'workspc_gateway_create_payment_attempt(uuid,uuid,text)',
    'workspc_gateway_finish_payment_checkout(uuid,text,text)',
    'workspc_gateway_apply_verified_payment(uuid,text,text,text,text,bigint,text,text)',
    'workspc_gateway_record_payment_state(text,text,text,text,text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC', v_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM anon', v_signature);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM authenticated', v_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', v_signature);
  END LOOP;
END $$;

-- The internal enqueue helper remains callable only from trusted SECURITY
-- DEFINER communication functions. Browser roles never receive EXECUTE.
REVOKE ALL ON FUNCTION public._communication_enqueue_event(text, uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._communication_enqueue_event(text, uuid, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public._communication_enqueue_event(text, uuid, uuid, text, text, text) FROM authenticated;

-- REPLAY CONTRACT: migration 85 is intentionally non-idempotent. It must be
-- applied exactly once, transactionally, and tracked by its reviewed checksum.
-- A replay must fail rather than silently mutate already-live audit structures.
