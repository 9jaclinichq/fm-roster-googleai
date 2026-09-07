-- ====================================================================
-- Workspc Communication Hub V1 - migration 84 (LOCAL / UNAPPLIED)
-- ====================================================================
-- Live evidence records migration 81 as the production ceiling. Local
-- migrations 82 and 83 are unapplied. This additive migration is numbered
-- after the local ceiling but depends only on schema available through 81;
-- it does not reference or require either 82 or 83.
--
-- All new tables are deny-by-default: anon/authenticated receive no direct
-- table privileges and no table policies. The browser can operate only via
-- the SECURITY DEFINER RPCs below, each of which derives or re-verifies its
-- actor server-side. External adapters are deliberately absent/disabled.
-- ====================================================================

CREATE TABLE communication_contact_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  owner_workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE,
  owner_doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('WHATSAPP', 'EMAIL')),
  value_canonical text NOT NULL,
  verification_state text NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (verification_state IN ('UNVERIFIED', 'PENDING_VERIFICATION', 'VERIFIED')),
  verified_at timestamptz,
  verification_evidence_reference text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT communication_contact_owner_check CHECK (
    (owner_workforce_id IS NOT NULL AND owner_doctor_id IS NULL AND tenant_id IS NOT NULL)
    OR (owner_workforce_id IS NULL AND owner_doctor_id IS NOT NULL AND tenant_id IS NULL)
  ),
  CONSTRAINT communication_contact_verified_evidence_check CHECK (
    (verification_state = 'VERIFIED' AND verified_at IS NOT NULL AND verification_evidence_reference IS NOT NULL)
    OR (verification_state <> 'VERIFIED' AND verified_at IS NULL AND verification_evidence_reference IS NULL)
  ),
  CONSTRAINT communication_contact_value_check CHECK (
    (channel = 'WHATSAPP' AND value_canonical ~ '^\+[1-9][0-9]{7,14}$')
    OR (channel = 'EMAIL' AND value_canonical = lower(value_canonical)
      AND value_canonical ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
  )
);
CREATE UNIQUE INDEX communication_contact_workforce_channel_unique
  ON communication_contact_points(owner_workforce_id, channel) WHERE owner_workforce_id IS NOT NULL;
CREATE UNIQUE INDEX communication_contact_doctor_channel_unique
  ON communication_contact_points(owner_doctor_id, channel) WHERE owner_doctor_id IS NOT NULL;

CREATE TABLE communication_verification_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_point_id uuid NOT NULL REFERENCES communication_contact_points(id) ON DELETE CASCADE,
  provider_contract text NOT NULL CHECK (provider_contract IN ('META_WHATSAPP', 'RESEND_EMAIL')),
  status text NOT NULL DEFAULT 'PENDING_PROVIDER'
    CHECK (status IN ('PENDING_PROVIDER', 'CHALLENGE_SENT', 'VERIFIED', 'EXPIRED', 'FAILED')),
  provider_message_id text,
  requested_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  completed_at timestamptz,
  failure_classification text,
  CONSTRAINT communication_verification_no_fake_success CHECK (
    status <> 'VERIFIED' OR (completed_at IS NOT NULL AND provider_message_id IS NOT NULL)
  )
);

CREATE TABLE communication_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  owner_workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE,
  owner_doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN (
    'ROSTER', 'ANNOUNCEMENTS', 'MEETINGS', 'REVIEW_INVITATIONS',
    'KNOWLEDGE_PUBLICATIONS', 'PRODUCT_RELEASES', 'SUPPORT_REPLIES'
  )),
  channel text NOT NULL CHECK (channel IN ('IN_APP', 'WHATSAPP', 'EMAIL')),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT communication_preference_owner_check CHECK (
    (owner_workforce_id IS NOT NULL AND owner_doctor_id IS NULL AND tenant_id IS NOT NULL)
    OR (owner_workforce_id IS NULL AND owner_doctor_id IS NOT NULL AND tenant_id IS NULL)
  )
);
CREATE UNIQUE INDEX communication_preference_workforce_unique
  ON communication_preferences(owner_workforce_id, purpose, channel) WHERE owner_workforce_id IS NOT NULL;
CREATE UNIQUE INDEX communication_preference_doctor_unique
  ON communication_preferences(owner_doctor_id, purpose, channel) WHERE owner_doctor_id IS NOT NULL;

CREATE TABLE tenant_capability_delegations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workforce_id uuid NOT NULL REFERENCES workforce(id) ON DELETE CASCADE,
  capability text NOT NULL CHECK (capability IN (
    'ANNOUNCEMENTS_MANAGE', 'MEETINGS_MANAGE', 'ROSTER_COORDINATE',
    'KNOWLEDGE_PUBLISH', 'REVIEW_COORDINATE', 'MEMBER_SUPPORT'
  )),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED')),
  grantor_authority text NOT NULL CHECK (grantor_authority IN ('TENANT_ADMIN_CODE', 'AUTHENTICATED_TENANT_ADMIN')),
  grantor_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  revoked_at timestamptz,
  CONSTRAINT tenant_capability_delegation_lifecycle_check CHECK (
    (status = 'ACTIVE' AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX tenant_capability_one_active_unique
  ON tenant_capability_delegations(tenant_id, workforce_id, capability) WHERE status = 'ACTIVE';

CREATE TABLE communication_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('SUPPORT', 'COORDINATION', 'REVIEW')),
  notification_purpose text NOT NULL CHECK (notification_purpose IN (
    'ROSTER', 'ANNOUNCEMENTS', 'MEETINGS', 'REVIEW_INVITATIONS',
    'KNOWLEDGE_PUBLICATIONS', 'PRODUCT_RELEASES', 'SUPPORT_REPLIES'
  )),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 120),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  created_by_workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  created_by_doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  closed_at timestamptz,
  CONSTRAINT communication_conversation_creator_check CHECK (
    (created_by_workforce_id IS NOT NULL AND created_by_doctor_id IS NULL AND tenant_id IS NOT NULL)
    OR (created_by_workforce_id IS NULL AND created_by_doctor_id IS NOT NULL AND tenant_id IS NULL)
  ),
  CONSTRAINT communication_conversation_lifecycle_check CHECK (
    (status = 'OPEN' AND closed_at IS NULL) OR (status = 'CLOSED' AND closed_at IS NOT NULL)
  )
);

CREATE TABLE communication_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES communication_conversations(id) ON DELETE CASCADE,
  workforce_id uuid REFERENCES workforce(id) ON DELETE RESTRICT,
  doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE RESTRICT,
  participant_role text NOT NULL CHECK (participant_role IN ('MEMBER', 'SUPPORT', 'COORDINATOR', 'REVIEWER')),
  joined_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  last_read_at timestamptz,
  access_revoked_at timestamptz,
  CONSTRAINT communication_participant_owner_check CHECK (
    (workforce_id IS NOT NULL AND doctor_id IS NULL) OR (workforce_id IS NULL AND doctor_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX communication_participant_workforce_unique
  ON communication_participants(conversation_id, workforce_id) WHERE workforce_id IS NOT NULL;
CREATE UNIQUE INDEX communication_participant_doctor_unique
  ON communication_participants(conversation_id, doctor_id) WHERE doctor_id IS NOT NULL;

CREATE TABLE communication_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES communication_conversations(id) ON DELETE RESTRICT,
  sender_workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  sender_doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE SET NULL,
  sender_kind text NOT NULL CHECK (sender_kind IN ('WORKFORCE', 'DOCTOR', 'SYSTEM')),
  sender_name text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  safe_route text CHECK (safe_route IS NULL OR (safe_route ~ '^/(workspace|doctor)/[a-zA-Z0-9/_?=&-]+$' AND safe_route !~ '://')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT communication_message_sender_check CHECK (
    (sender_kind = 'WORKFORCE' AND sender_workforce_id IS NOT NULL AND sender_doctor_id IS NULL)
    OR (sender_kind = 'DOCTOR' AND sender_doctor_id IS NOT NULL AND sender_workforce_id IS NULL)
    OR (sender_kind = 'SYSTEM' AND sender_workforce_id IS NULL AND sender_doctor_id IS NULL)
  )
);

CREATE TABLE support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL UNIQUE REFERENCES communication_conversations(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN (
    'TECHNICAL_PROBLEM', 'ROSTER_ASSIGNMENT', 'ACCOUNT_ACCESS',
    'FEATURE_FEEDBACK', 'KNOWLEDGE_RESEARCH', 'OTHER'
  )),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 120),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
  reporter_workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  reporter_doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE SET NULL,
  assigned_workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  closed_at timestamptz,
  CONSTRAINT support_ticket_reporter_check CHECK (
    (reporter_workforce_id IS NOT NULL AND reporter_doctor_id IS NULL AND tenant_id IS NOT NULL)
    OR (reporter_workforce_id IS NULL AND reporter_doctor_id IS NOT NULL AND tenant_id IS NULL)
  )
);

CREATE TABLE review_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL UNIQUE REFERENCES communication_conversations(id) ON DELETE RESTRICT,
  inviter_workforce_id uuid NOT NULL REFERENCES workforce(id) ON DELETE RESTRICT,
  invitee_workforce_id uuid NOT NULL REFERENCES workforce(id) ON DELETE RESTRICT,
  artifact_type text NOT NULL CHECK (artifact_type IN ('DISSERTATION_MILESTONE', 'RESEARCH_WORKSPACE')),
  artifact_id uuid NOT NULL,
  safe_label text NOT NULL CHECK (char_length(safe_label) BETWEEN 3 AND 120),
  safe_route text NOT NULL CHECK (safe_route ~ '^/workspace/[a-zA-Z0-9/_?=&-]+$' AND safe_route !~ '://'),
  permission_state text NOT NULL DEFAULT 'PENDING_OWNER_PERMISSION'
    CHECK (permission_state IN ('AVAILABLE', 'PENDING_OWNER_PERMISSION')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED', 'COMPLETED')),
  due_date date,
  accepted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT review_invitation_not_self_check CHECK (inviter_workforce_id <> invitee_workforce_id)
);
CREATE UNIQUE INDEX review_invitation_active_unique
  ON review_invitations(tenant_id, inviter_workforce_id, invitee_workforce_id, artifact_type, artifact_id)
  WHERE status IN ('PENDING', 'ACCEPTED');

CREATE TABLE notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  recipient_workforce_id uuid REFERENCES workforce(id) ON DELETE RESTRICT,
  recipient_doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE RESTRICT,
  recipient_owner_key text GENERATED ALWAYS AS (
    CASE WHEN recipient_workforce_id IS NOT NULL THEN 'W:' || recipient_workforce_id::text
         ELSE 'D:' || recipient_doctor_id::text END
  ) STORED,
  purpose text NOT NULL CHECK (purpose IN (
    'ROSTER', 'ANNOUNCEMENTS', 'MEETINGS', 'REVIEW_INVITATIONS',
    'KNOWLEDGE_PUBLICATIONS', 'PRODUCT_RELEASES', 'SUPPORT_REPLIES'
  )),
  channel text NOT NULL CHECK (channel IN ('IN_APP', 'WHATSAPP', 'EMAIL')),
  provider_adapter text NOT NULL CHECK (provider_adapter IN ('IN_APP', 'META_WHATSAPP_DISABLED', 'RESEND_EMAIL_DISABLED')),
  template_key text NOT NULL,
  template_version integer NOT NULL CHECK (template_version > 0),
  safe_message_reference text NOT NULL,
  provider_message_id text,
  outcome text NOT NULL CHECK (outcome IN ('PENDING', 'SENT', 'FAILED', 'UNKNOWN')),
  attempted_at timestamptz,
  terminal_at timestamptz,
  retry_eligible boolean NOT NULL DEFAULT false,
  failure_classification text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT notification_delivery_owner_check CHECK (
    (recipient_workforce_id IS NOT NULL AND recipient_doctor_id IS NULL)
    OR (recipient_workforce_id IS NULL AND recipient_doctor_id IS NOT NULL)
  ),
  CONSTRAINT notification_unknown_no_retry_check CHECK (outcome <> 'UNKNOWN' OR retry_eligible = false),
  CONSTRAINT notification_terminal_check CHECK (
    (outcome = 'PENDING' AND terminal_at IS NULL) OR (outcome <> 'PENDING' AND terminal_at IS NOT NULL)
  ),
  CONSTRAINT notification_delivery_dedup UNIQUE (event_key, recipient_owner_key, channel)
);

CREATE TABLE privydoc_identity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE,
  owner_doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('NOT_LINKED', 'ELIGIBLE', 'PENDING', 'LINKED')),
  evidence_reference text,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT privydoc_identity_owner_check CHECK (
    (owner_workforce_id IS NOT NULL AND owner_doctor_id IS NULL)
    OR (owner_workforce_id IS NULL AND owner_doctor_id IS NOT NULL)
  ),
  CONSTRAINT privydoc_link_evidence_check CHECK (
    state <> 'LINKED' OR (evidence_reference IS NOT NULL AND verified_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX privydoc_identity_workforce_unique ON privydoc_identity_links(owner_workforce_id) WHERE owner_workforce_id IS NOT NULL;
CREATE UNIQUE INDEX privydoc_identity_doctor_unique ON privydoc_identity_links(owner_doctor_id) WHERE owner_doctor_id IS NOT NULL;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'communication_contact_points', 'communication_verification_requests', 'communication_preferences',
    'tenant_capability_delegations', 'communication_conversations', 'communication_participants',
    'communication_messages', 'support_tickets', 'review_invitations', 'notification_deliveries',
    'privydoc_identity_links'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM anon', v_table);
    EXECUTE format('REVOKE ALL ON TABLE %I FROM authenticated', v_table);
  END LOOP;
END;
$$;

CREATE TRIGGER communication_contact_points_updated_at BEFORE UPDATE ON communication_contact_points
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER communication_preferences_updated_at BEFORE UPDATE ON communication_preferences
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER tenant_capability_delegations_updated_at BEFORE UPDATE ON tenant_capability_delegations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER communication_conversations_updated_at BEFORE UPDATE ON communication_conversations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER support_tickets_updated_at BEFORE UPDATE ON support_tickets
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER review_invitations_updated_at BEFORE UPDATE ON review_invitations
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER notification_deliveries_updated_at BEFORE UPDATE ON notification_deliveries
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER privydoc_identity_links_updated_at BEFORE UPDATE ON privydoc_identity_links
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION public._communication_safe_overview_label(p_value text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT char_length(trim(coalesce(p_value, ''))) BETWEEN 3 AND 120
    AND p_value !~* 'https?://'
    AND p_value !~* '[[:alnum:]._%+-]+@[[:alnum:].-]+\.[[:alpha:]]{2,}'
    AND p_value !~* '(^|[^0-9])(\+?[0-9][0-9 ()-]{7,})([^0-9]|$)'
    AND p_value !~* '(otp|token|secret|service[_ -]?role|password)[[:space:]]*[:=]';
$$;
REVOKE ALL ON FUNCTION public._communication_safe_overview_label(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._communication_safe_overview_label(text) FROM anon;
REVOKE ALL ON FUNCTION public._communication_safe_overview_label(text) FROM authenticated;

CREATE OR REPLACE FUNCTION public._communication_actor_context(
  p_workforce_id uuid, p_resident_code text, p_doctor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_workforce workforce%ROWTYPE;
  v_doctor doctor_profiles%ROWTYPE;
  v_strong_match boolean := false;
BEGIN
  IF (p_workforce_id IS NULL) = (p_doctor_id IS NULL) THEN
    RAISE EXCEPTION 'Exactly one communication actor is required' USING ERRCODE = '28000';
  END IF;
  IF p_workforce_id IS NOT NULL THEN
    SELECT * INTO v_workforce FROM workforce WHERE id = p_workforce_id AND active = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active member not found' USING ERRCODE = '28000'; END IF;
    v_strong_match := auth.uid() IS NOT NULL AND (
      public._resident_authenticated_membership_match(p_workforce_id)
      OR v_workforce.doctor_id = auth.uid()
    );
    IF NOT v_strong_match AND NOT (
      v_workforce.resident_code = p_resident_code
      AND NOT EXISTS (
        SELECT 1 FROM organisation_memberships om
        WHERE om.workforce_id = v_workforce.id AND om.legacy_code_disabled_at IS NOT NULL
      )
    ) THEN
      RAISE EXCEPTION 'Invalid member access code' USING ERRCODE = '28000';
    END IF;
    RETURN jsonb_build_object(
      'kind', 'WORKFORCE', 'id', v_workforce.id, 'tenant_id', v_workforce.tenant_id,
      'name', v_workforce.full_name, 'category', v_workforce.category
    );
  END IF;
  IF auth.uid() IS NULL OR auth.uid() <> p_doctor_id THEN
    RAISE EXCEPTION 'Authenticated doctor session required' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_doctor FROM doctor_profiles WHERE id = p_doctor_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Doctor profile not found' USING ERRCODE = '28000'; END IF;
  RETURN jsonb_build_object(
    'kind', 'DOCTOR', 'id', v_doctor.id, 'tenant_id', NULL,
    'name', COALESCE(NULLIF(v_doctor.full_name, ''), 'Doctor'), 'category', 'Individual Doctor'
  );
END;
$$;
REVOKE ALL ON FUNCTION public._communication_actor_context(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._communication_actor_context(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._communication_actor_context(uuid, text, uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public._communication_has_capability(p_workforce_id uuid, p_tenant_id uuid, p_capability text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM tenant_capability_delegations d
    WHERE d.workforce_id = p_workforce_id AND d.tenant_id = p_tenant_id
      AND d.capability = p_capability AND d.status = 'ACTIVE'
  );
$$;
REVOKE ALL ON FUNCTION public._communication_has_capability(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._communication_has_capability(uuid, uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public._communication_has_capability(uuid, uuid, text) FROM authenticated;

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
  IF p_event_key IS NULL OR p_event_key = '' OR p_event_key ~* '(https?://|@|\+?[0-9][0-9 ()-]{7,})' THEN
    RAISE EXCEPTION 'Unsafe delivery event key';
  END IF;
  IF p_safe_message_reference IS NULL OR p_safe_message_reference !~ '^[a-z_]+:[0-9a-f-]{36}$' THEN
    RAISE EXCEPTION 'Unsafe message reference';
  END IF;
  FOR v_channel IN
    SELECT preference.channel FROM communication_preferences preference
    WHERE preference.purpose = p_purpose AND preference.enabled = true
      AND ((p_recipient_workforce_id IS NOT NULL AND preference.owner_workforce_id = p_recipient_workforce_id)
        OR (p_recipient_doctor_id IS NOT NULL AND preference.owner_doctor_id = p_recipient_doctor_id))
  LOOP
    IF v_channel = 'IN_APP' THEN
      INSERT INTO notification_deliveries (
        event_key, recipient_workforce_id, recipient_doctor_id, purpose, channel,
        provider_adapter, template_key, template_version, safe_message_reference,
        outcome, attempted_at, terminal_at, retry_eligible
      ) VALUES (
        p_event_key, p_recipient_workforce_id, p_recipient_doctor_id, p_purpose, v_channel,
        'IN_APP', p_template_key, 1, p_safe_message_reference,
        'SENT', timezone('utc'::text, now()), timezone('utc'::text, now()), false
      ) ON CONFLICT (event_key, recipient_owner_key, channel) DO NOTHING;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM communication_contact_points contact
        WHERE contact.channel = v_channel AND contact.verification_state = 'VERIFIED'
          AND ((p_recipient_workforce_id IS NOT NULL AND contact.owner_workforce_id = p_recipient_workforce_id)
            OR (p_recipient_doctor_id IS NOT NULL AND contact.owner_doctor_id = p_recipient_doctor_id))
      ) INTO v_contact_verified;
      INSERT INTO notification_deliveries (
        event_key, recipient_workforce_id, recipient_doctor_id, purpose, channel,
        provider_adapter, template_key, template_version, safe_message_reference,
        outcome, attempted_at, terminal_at, retry_eligible, failure_classification
      ) VALUES (
        p_event_key, p_recipient_workforce_id, p_recipient_doctor_id, p_purpose, v_channel,
        CASE WHEN v_channel = 'WHATSAPP' THEN 'META_WHATSAPP_DISABLED' ELSE 'RESEND_EMAIL_DISABLED' END,
        p_template_key, 1, p_safe_message_reference,
        'FAILED', timezone('utc'::text, now()), timezone('utc'::text, now()), false,
        CASE WHEN v_contact_verified THEN 'PROVIDER_DISABLED' ELSE 'CONTACT_NOT_VERIFIED' END
      ) ON CONFLICT (event_key, recipient_owner_key, channel) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._communication_enqueue_event(text, uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._communication_enqueue_event(text, uuid, uuid, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public._communication_enqueue_event(text, uuid, uuid, text, text, text) FROM authenticated;

CREATE OR REPLACE FUNCTION public.communication_get_hub(p_workforce_id uuid, p_resident_code text, p_doctor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor jsonb;
  v_kind text;
  v_id uuid;
  v_tenant_id uuid;
BEGIN
  v_actor := public._communication_actor_context(p_workforce_id, p_resident_code, p_doctor_id);
  v_kind := v_actor->>'kind';
  v_id := (v_actor->>'id')::uuid;
  v_tenant_id := NULLIF(v_actor->>'tenant_id', '')::uuid;
  RETURN jsonb_build_object(
    'actor', v_actor,
    'contacts', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'channel', c.channel,
        'masked_value', CASE WHEN c.channel = 'EMAIL'
          THEN left(split_part(c.value_canonical, '@', 1), 1) || '***@' || split_part(c.value_canonical, '@', 2)
          ELSE left(c.value_canonical, 4) || '••••' || right(c.value_canonical, 3) END,
        'verification_state', c.verification_state, 'verified_at', c.verified_at, 'updated_at', c.updated_at
      ) ORDER BY c.channel)
      FROM communication_contact_points c
      WHERE (v_kind = 'WORKFORCE' AND c.owner_workforce_id = v_id)
         OR (v_kind = 'DOCTOR' AND c.owner_doctor_id = v_id)
    ), '[]'::jsonb),
    'preferences', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('purpose', p.purpose, 'channel', p.channel, 'enabled', p.enabled, 'updated_at', p.updated_at))
      FROM communication_preferences p
      WHERE (v_kind = 'WORKFORCE' AND p.owner_workforce_id = v_id)
         OR (v_kind = 'DOCTOR' AND p.owner_doctor_id = v_id)
    ), '[]'::jsonb),
    'capabilities', CASE WHEN v_kind = 'WORKFORCE' THEN COALESCE((
      SELECT jsonb_agg(d.capability ORDER BY d.capability)
      FROM tenant_capability_delegations d
      WHERE d.workforce_id = v_id AND d.tenant_id = v_tenant_id AND d.status = 'ACTIVE'
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'conversations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'subject', c.subject, 'status', c.status,
        'unread_count', (SELECT count(*) FROM communication_messages unread
          WHERE unread.conversation_id = c.id
            AND unread.created_at > COALESCE(cp.last_read_at, '-infinity'::timestamptz)
            AND NOT ((v_kind = 'WORKFORCE' AND unread.sender_workforce_id = v_id)
              OR (v_kind = 'DOCTOR' AND unread.sender_doctor_id = v_id))),
        'created_at', c.created_at, 'updated_at', c.updated_at,
        'messages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'id', m.id, 'sender_name', m.sender_name, 'sender_kind', m.sender_kind,
          'body', m.body, 'safe_route', m.safe_route, 'created_at', m.created_at
        ) ORDER BY m.created_at) FROM communication_messages m WHERE m.conversation_id = c.id), '[]'::jsonb)
      ) ORDER BY c.updated_at DESC)
      FROM communication_participants cp
      JOIN communication_conversations c ON c.id = cp.conversation_id
      WHERE cp.access_revoked_at IS NULL
        AND ((v_kind = 'WORKFORCE' AND cp.workforce_id = v_id)
          OR (v_kind = 'DOCTOR' AND cp.doctor_id = v_id))
    ), '[]'::jsonb),
    'invitations', CASE WHEN v_kind = 'WORKFORCE' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'conversation_id', i.conversation_id, 'artifact_type', i.artifact_type,
        'artifact_id', i.artifact_id, 'safe_label', i.safe_label, 'safe_route', i.safe_route,
        'permission_state', i.permission_state, 'inviter_name', inviter.full_name,
        'invitee_name', invitee.full_name,
        'viewer_role', CASE WHEN i.inviter_workforce_id = v_id THEN 'INVITER' ELSE 'INVITEE' END,
        'status', i.status, 'due_date', i.due_date, 'accepted_at', i.accepted_at,
        'completed_at', i.completed_at, 'created_at', i.created_at, 'updated_at', i.updated_at
      ) ORDER BY i.updated_at DESC)
      FROM review_invitations i
      JOIN workforce inviter ON inviter.id = i.inviter_workforce_id
      JOIN workforce invitee ON invitee.id = i.invitee_workforce_id
      WHERE i.tenant_id = v_tenant_id AND (i.inviter_workforce_id = v_id OR i.invitee_workforce_id = v_id)
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'reviewable_artifacts', CASE WHEN v_kind = 'WORKFORCE' THEN COALESCE((
      SELECT jsonb_agg(a ORDER BY a->>'safe_label') FROM (
        SELECT jsonb_build_object(
          'artifact_type', 'DISSERTATION_MILESTONE', 'artifact_id', dm.id,
          'safe_label', 'Dissertation milestone: ' || dm.stage,
          'safe_route', '/workspace/consultant-review', 'permission_state', 'PENDING_OWNER_PERMISSION'
        ) AS a
        FROM dissertation_milestones dm JOIN dissertations d ON d.id = dm.dissertation_id
        WHERE d.workforce_id = v_id
        UNION ALL
        SELECT jsonb_build_object(
          'artifact_type', 'RESEARCH_WORKSPACE', 'artifact_id', rw.id,
          'safe_label', 'Research workspace', 'safe_route', '/workspace/research',
          'permission_state', 'PENDING_OWNER_PERMISSION'
        ) AS a
        FROM research_workspaces rw WHERE rw.workforce_id = v_id AND rw.tenant_id = v_tenant_id
      ) artifacts
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'eligible_members', CASE WHEN v_kind = 'WORKFORCE' THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object('workforce_id', w.id, 'full_name', w.full_name, 'category', w.category) ORDER BY w.full_name)
      FROM workforce w WHERE w.tenant_id = v_tenant_id AND w.active = true AND w.id <> v_id
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'deliveries', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'channel', recent.channel, 'outcome', recent.outcome,
        'failure_classification', recent.failure_classification, 'updated_at', recent.updated_at
      ) ORDER BY recent.updated_at DESC)
      FROM (SELECT * FROM notification_deliveries nd
        WHERE (v_kind = 'WORKFORCE' AND nd.recipient_workforce_id = v_id)
           OR (v_kind = 'DOCTOR' AND nd.recipient_doctor_id = v_id)
        ORDER BY nd.updated_at DESC LIMIT 20) recent
    ), '[]'::jsonb),
    'privydoc_linkage', COALESCE((
      SELECT jsonb_build_object('state', l.state, 'evidence_reference', l.evidence_reference)
      FROM privydoc_identity_links l
      WHERE (v_kind = 'WORKFORCE' AND l.owner_workforce_id = v_id)
         OR (v_kind = 'DOCTOR' AND l.owner_doctor_id = v_id)
      LIMIT 1
    ), jsonb_build_object('state', 'ELIGIBLE', 'evidence_reference', NULL)),
    'external_delivery', jsonb_build_object('whatsapp', 'DISABLED', 'email', 'DISABLED')
  );
END;
$$;
REVOKE ALL ON FUNCTION public.communication_get_hub(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_get_hub(uuid, text, uuid) TO anon, authenticated;

-- Contact and preference mutations. Account email is never copied here;
-- only an explicit owner action creates a contact or consent row preference.
CREATE OR REPLACE FUNCTION public.communication_save_contact(
  p_workforce_id uuid, p_resident_code text, p_doctor_id uuid, p_channel text, p_value text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor jsonb; v_kind text; v_id uuid; v_tenant_id uuid; v_value text;
BEGIN
  v_actor := public._communication_actor_context(p_workforce_id, p_resident_code, p_doctor_id);
  v_kind := v_actor->>'kind'; v_id := (v_actor->>'id')::uuid;
  v_tenant_id := NULLIF(v_actor->>'tenant_id', '')::uuid;
  IF p_channel NOT IN ('WHATSAPP', 'EMAIL') THEN RAISE EXCEPTION 'Unsupported contact channel'; END IF;
  v_value := CASE WHEN p_channel = 'EMAIL' THEN lower(trim(p_value))
    ELSE regexp_replace(trim(p_value), '[[:space:]().-]', '', 'g') END;
  IF left(v_value, 2) = '00' THEN v_value := '+' || substring(v_value from 3); END IF;
  IF (p_channel = 'WHATSAPP' AND v_value !~ '^\+[1-9][0-9]{7,14}$')
    OR (p_channel = 'EMAIL' AND v_value !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') THEN
    RAISE EXCEPTION 'Invalid contact value';
  END IF;
  IF v_kind = 'WORKFORCE' THEN
    INSERT INTO communication_contact_points(tenant_id, owner_workforce_id, channel, value_canonical)
    VALUES (v_tenant_id, v_id, p_channel, v_value)
    ON CONFLICT (owner_workforce_id, channel) WHERE owner_workforce_id IS NOT NULL
    DO UPDATE SET value_canonical = EXCLUDED.value_canonical,
      verification_state = CASE WHEN communication_contact_points.value_canonical = EXCLUDED.value_canonical
        THEN communication_contact_points.verification_state ELSE 'UNVERIFIED' END,
      verified_at = CASE WHEN communication_contact_points.value_canonical = EXCLUDED.value_canonical
        THEN communication_contact_points.verified_at ELSE NULL END,
      verification_evidence_reference = CASE WHEN communication_contact_points.value_canonical = EXCLUDED.value_canonical
        THEN communication_contact_points.verification_evidence_reference ELSE NULL END;
  ELSE
    INSERT INTO communication_contact_points(owner_doctor_id, channel, value_canonical)
    VALUES (v_id, p_channel, v_value)
    ON CONFLICT (owner_doctor_id, channel) WHERE owner_doctor_id IS NOT NULL
    DO UPDATE SET value_canonical = EXCLUDED.value_canonical,
      verification_state = CASE WHEN communication_contact_points.value_canonical = EXCLUDED.value_canonical
        THEN communication_contact_points.verification_state ELSE 'UNVERIFIED' END,
      verified_at = CASE WHEN communication_contact_points.value_canonical = EXCLUDED.value_canonical
        THEN communication_contact_points.verified_at ELSE NULL END,
      verification_evidence_reference = CASE WHEN communication_contact_points.value_canonical = EXCLUDED.value_canonical
        THEN communication_contact_points.verification_evidence_reference ELSE NULL END;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.communication_save_contact(uuid, text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_save_contact(uuid, text, uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.communication_request_verification(
  p_workforce_id uuid, p_resident_code text, p_doctor_id uuid, p_channel text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor jsonb; v_kind text; v_id uuid; v_contact_id uuid;
BEGIN
  v_actor := public._communication_actor_context(p_workforce_id, p_resident_code, p_doctor_id);
  v_kind := v_actor->>'kind'; v_id := (v_actor->>'id')::uuid;
  SELECT id INTO v_contact_id FROM communication_contact_points
  WHERE channel = p_channel AND ((v_kind = 'WORKFORCE' AND owner_workforce_id = v_id)
    OR (v_kind = 'DOCTOR' AND owner_doctor_id = v_id));
  IF v_contact_id IS NULL THEN RAISE EXCEPTION 'Save this contact before requesting verification'; END IF;
  INSERT INTO communication_verification_requests(contact_point_id, provider_contract, status, failure_classification)
  VALUES (v_contact_id, CASE WHEN p_channel = 'WHATSAPP' THEN 'META_WHATSAPP' ELSE 'RESEND_EMAIL' END,
    'PENDING_PROVIDER', 'PROVIDER_DISABLED');
  UPDATE communication_contact_points SET verification_state = 'PENDING_VERIFICATION',
    verified_at = NULL, verification_evidence_reference = NULL WHERE id = v_contact_id;
END;
$$;
REVOKE ALL ON FUNCTION public.communication_request_verification(uuid, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_request_verification(uuid, text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.communication_set_preference(
  p_workforce_id uuid, p_resident_code text, p_doctor_id uuid,
  p_purpose text, p_channel text, p_enabled boolean
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor jsonb; v_kind text; v_id uuid; v_tenant_id uuid;
BEGIN
  v_actor := public._communication_actor_context(p_workforce_id, p_resident_code, p_doctor_id);
  v_kind := v_actor->>'kind'; v_id := (v_actor->>'id')::uuid;
  v_tenant_id := NULLIF(v_actor->>'tenant_id', '')::uuid;
  IF p_purpose NOT IN ('ROSTER', 'ANNOUNCEMENTS', 'MEETINGS', 'REVIEW_INVITATIONS',
      'KNOWLEDGE_PUBLICATIONS', 'PRODUCT_RELEASES', 'SUPPORT_REPLIES')
    OR p_channel NOT IN ('IN_APP', 'WHATSAPP', 'EMAIL') THEN RAISE EXCEPTION 'Unsupported preference'; END IF;
  IF v_kind = 'WORKFORCE' THEN
    INSERT INTO communication_preferences(tenant_id, owner_workforce_id, purpose, channel, enabled)
    VALUES (v_tenant_id, v_id, p_purpose, p_channel, p_enabled)
    ON CONFLICT (owner_workforce_id, purpose, channel) WHERE owner_workforce_id IS NOT NULL
    DO UPDATE SET enabled = EXCLUDED.enabled;
  ELSE
    INSERT INTO communication_preferences(owner_doctor_id, purpose, channel, enabled)
    VALUES (v_id, p_purpose, p_channel, p_enabled)
    ON CONFLICT (owner_doctor_id, purpose, channel) WHERE owner_doctor_id IS NOT NULL
    DO UPDATE SET enabled = EXCLUDED.enabled;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.communication_set_preference(uuid, text, uuid, text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_set_preference(uuid, text, uuid, text, text, boolean) TO anon, authenticated;

-- Support is persisted as a ticket plus a participant-scoped conversation.
CREATE OR REPLACE FUNCTION public.communication_start_support(
  p_workforce_id uuid, p_resident_code text, p_doctor_id uuid,
  p_category text, p_subject text, p_message text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor jsonb; v_kind text; v_id uuid; v_tenant_id uuid;
  v_conversation_id uuid := gen_random_uuid(); v_support_id uuid; v_assigned uuid;
BEGIN
  v_actor := public._communication_actor_context(p_workforce_id, p_resident_code, p_doctor_id);
  v_kind := v_actor->>'kind'; v_id := (v_actor->>'id')::uuid;
  v_tenant_id := NULLIF(v_actor->>'tenant_id', '')::uuid;
  IF p_category NOT IN ('TECHNICAL_PROBLEM', 'ROSTER_ASSIGNMENT', 'ACCOUNT_ACCESS',
    'FEATURE_FEEDBACK', 'KNOWLEDGE_RESEARCH', 'OTHER') THEN RAISE EXCEPTION 'Unsupported support category'; END IF;
  IF NOT public._communication_safe_overview_label(p_subject) THEN
    RAISE EXCEPTION 'Use a concise subject without contact details, URLs, tokens or secrets';
  END IF;
  IF char_length(trim(coalesce(p_message, ''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Support message is required'; END IF;

  INSERT INTO communication_conversations(
    id, tenant_id, kind, notification_purpose, subject, created_by_workforce_id, created_by_doctor_id
  ) VALUES (
    v_conversation_id, v_tenant_id, 'SUPPORT', 'SUPPORT_REPLIES', trim(p_subject),
    CASE WHEN v_kind = 'WORKFORCE' THEN v_id ELSE NULL END,
    CASE WHEN v_kind = 'DOCTOR' THEN v_id ELSE NULL END
  );
  INSERT INTO communication_participants(conversation_id, workforce_id, doctor_id, participant_role, last_read_at)
  VALUES (v_conversation_id,
    CASE WHEN v_kind = 'WORKFORCE' THEN v_id ELSE NULL END,
    CASE WHEN v_kind = 'DOCTOR' THEN v_id ELSE NULL END,
    'MEMBER', timezone('utc'::text, now()));
  INSERT INTO communication_messages(
    conversation_id, sender_workforce_id, sender_doctor_id, sender_kind, sender_name, body
  ) VALUES (
    v_conversation_id,
    CASE WHEN v_kind = 'WORKFORCE' THEN v_id ELSE NULL END,
    CASE WHEN v_kind = 'DOCTOR' THEN v_id ELSE NULL END,
    v_kind, v_actor->>'name', trim(p_message)
  );

  IF v_tenant_id IS NOT NULL THEN
    SELECT d.workforce_id INTO v_assigned FROM tenant_capability_delegations d
    JOIN workforce w ON w.id = d.workforce_id AND w.active = true
    WHERE d.tenant_id = v_tenant_id AND d.capability = 'MEMBER_SUPPORT' AND d.status = 'ACTIVE'
      AND d.workforce_id <> v_id
    ORDER BY d.granted_at LIMIT 1;
    FOR v_support_id IN
      SELECT d.workforce_id FROM tenant_capability_delegations d
      JOIN workforce w ON w.id = d.workforce_id AND w.active = true
      WHERE d.tenant_id = v_tenant_id AND d.capability = 'MEMBER_SUPPORT' AND d.status = 'ACTIVE'
        AND d.workforce_id <> v_id
    LOOP
      INSERT INTO communication_participants(conversation_id, workforce_id, participant_role)
      VALUES (v_conversation_id, v_support_id, 'SUPPORT') ON CONFLICT DO NOTHING;
      PERFORM public._communication_enqueue_event(
        'support:' || v_conversation_id::text, v_support_id, NULL,
        'SUPPORT_REPLIES', 'support_conversation_opened', 'conversation:' || v_conversation_id::text
      );
    END LOOP;
  END IF;
  INSERT INTO support_tickets(
    tenant_id, conversation_id, category, subject, reporter_workforce_id, reporter_doctor_id, assigned_workforce_id
  ) VALUES (
    v_tenant_id, v_conversation_id, p_category, trim(p_subject),
    CASE WHEN v_kind = 'WORKFORCE' THEN v_id ELSE NULL END,
    CASE WHEN v_kind = 'DOCTOR' THEN v_id ELSE NULL END,
    v_assigned
  );
  RETURN v_conversation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.communication_start_support(uuid, text, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_start_support(uuid, text, uuid, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.communication_reply(
  p_workforce_id uuid, p_resident_code text, p_doctor_id uuid,
  p_conversation_id uuid, p_message text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor jsonb; v_kind text; v_id uuid; v_participant communication_participants%ROWTYPE;
  v_conversation communication_conversations%ROWTYPE; v_message_id uuid := gen_random_uuid(); v_recipient record;
BEGIN
  v_actor := public._communication_actor_context(p_workforce_id, p_resident_code, p_doctor_id);
  v_kind := v_actor->>'kind'; v_id := (v_actor->>'id')::uuid;
  SELECT * INTO v_participant FROM communication_participants cp
  WHERE cp.conversation_id = p_conversation_id AND cp.access_revoked_at IS NULL
    AND ((v_kind = 'WORKFORCE' AND cp.workforce_id = v_id) OR (v_kind = 'DOCTOR' AND cp.doctor_id = v_id));
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation access denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_conversation FROM communication_conversations WHERE id = p_conversation_id;
  IF v_conversation.status <> 'OPEN' THEN RAISE EXCEPTION 'Conversation is closed'; END IF;
  IF v_participant.participant_role = 'SUPPORT' AND NOT public._communication_has_capability(v_id, v_conversation.tenant_id, 'MEMBER_SUPPORT') THEN
    RAISE EXCEPTION 'Member Support capability is not active' USING ERRCODE = '42501';
  END IF;
  IF v_participant.participant_role = 'COORDINATOR' AND NOT public._communication_has_capability(
    v_id,
    v_conversation.tenant_id,
    CASE v_conversation.notification_purpose
      WHEN 'ANNOUNCEMENTS' THEN 'ANNOUNCEMENTS_MANAGE'
      WHEN 'MEETINGS' THEN 'MEETINGS_MANAGE'
      WHEN 'ROSTER' THEN 'ROSTER_COORDINATE'
      WHEN 'KNOWLEDGE_PUBLICATIONS' THEN 'KNOWLEDGE_PUBLISH'
      WHEN 'REVIEW_INVITATIONS' THEN 'REVIEW_COORDINATE'
      ELSE 'NO_MATCH'
    END
  ) THEN
    RAISE EXCEPTION 'Coordinator capability is not active' USING ERRCODE = '42501';
  END IF;
  IF char_length(trim(coalesce(p_message, ''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Reply is required'; END IF;
  INSERT INTO communication_messages(
    id, conversation_id, sender_workforce_id, sender_doctor_id, sender_kind, sender_name, body
  ) VALUES (
    v_message_id, p_conversation_id,
    CASE WHEN v_kind = 'WORKFORCE' THEN v_id ELSE NULL END,
    CASE WHEN v_kind = 'DOCTOR' THEN v_id ELSE NULL END,
    v_kind, v_actor->>'name', trim(p_message)
  );
  UPDATE communication_conversations SET updated_at = timezone('utc'::text, now()) WHERE id = p_conversation_id;
  UPDATE communication_participants SET last_read_at = timezone('utc'::text, now()) WHERE id = v_participant.id;
  FOR v_recipient IN
    SELECT cp.workforce_id, cp.doctor_id FROM communication_participants cp
    WHERE cp.conversation_id = p_conversation_id AND cp.access_revoked_at IS NULL
      AND NOT ((v_kind = 'WORKFORCE' AND cp.workforce_id = v_id) OR (v_kind = 'DOCTOR' AND cp.doctor_id = v_id))
  LOOP
    PERFORM public._communication_enqueue_event(
      'message:' || v_message_id::text, v_recipient.workforce_id, v_recipient.doctor_id,
      v_conversation.notification_purpose,
      CASE WHEN v_conversation.kind = 'SUPPORT' THEN 'support_reply'
        WHEN v_conversation.kind = 'REVIEW' THEN 'review_coordination_reply' ELSE 'coordination_reply' END,
      'conversation:' || p_conversation_id::text
    );
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.communication_reply(uuid, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_reply(uuid, text, uuid, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.communication_mark_read(
  p_workforce_id uuid, p_resident_code text, p_doctor_id uuid, p_conversation_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor jsonb; v_kind text; v_id uuid;
BEGIN
  v_actor := public._communication_actor_context(p_workforce_id, p_resident_code, p_doctor_id);
  v_kind := v_actor->>'kind'; v_id := (v_actor->>'id')::uuid;
  UPDATE communication_participants SET last_read_at = timezone('utc'::text, now())
  WHERE conversation_id = p_conversation_id AND access_revoked_at IS NULL
    AND ((v_kind = 'WORKFORCE' AND workforce_id = v_id) OR (v_kind = 'DOCTOR' AND doctor_id = v_id));
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation access denied' USING ERRCODE = '42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.communication_mark_read(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_mark_read(uuid, text, uuid, uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.communication_close_conversation(
  p_workforce_id uuid, p_resident_code text, p_doctor_id uuid, p_conversation_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor jsonb; v_kind text; v_id uuid;
BEGIN
  v_actor := public._communication_actor_context(p_workforce_id, p_resident_code, p_doctor_id);
  v_kind := v_actor->>'kind'; v_id := (v_actor->>'id')::uuid;
  IF NOT EXISTS (SELECT 1 FROM communication_participants cp
    WHERE cp.conversation_id = p_conversation_id AND cp.access_revoked_at IS NULL
      AND ((v_kind = 'WORKFORCE' AND cp.workforce_id = v_id) OR (v_kind = 'DOCTOR' AND cp.doctor_id = v_id))) THEN
    RAISE EXCEPTION 'Conversation access denied' USING ERRCODE = '42501';
  END IF;
  UPDATE communication_conversations SET status = 'CLOSED', closed_at = timezone('utc'::text, now())
  WHERE id = p_conversation_id AND status = 'OPEN';
  UPDATE support_tickets SET status = 'CLOSED', closed_at = timezone('utc'::text, now())
  WHERE conversation_id = p_conversation_id AND status = 'OPEN';
END;
$$;
REVOKE ALL ON FUNCTION public.communication_close_conversation(uuid, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_close_conversation(uuid, text, uuid, uuid) TO anon, authenticated;

-- Review invitations are same-tenant and owner-created. Both supported
-- artifact types remain PENDING_OWNER_PERMISSION because the existing
-- institutional artifact tables do not yet expose an owner-safe reviewer
-- read seam. Accepting an invitation therefore never broadens table reads.
CREATE OR REPLACE FUNCTION public.communication_create_review_invitation(
  p_workforce_id uuid, p_resident_code text, p_doctor_id uuid,
  p_invitee_workforce_id uuid, p_artifact_type text, p_artifact_id uuid, p_due_date date
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor jsonb; v_id uuid; v_tenant_id uuid; v_safe_label text; v_safe_route text;
  v_conversation_id uuid := gen_random_uuid(); v_invitation_id uuid := gen_random_uuid();
BEGIN
  v_actor := public._communication_actor_context(p_workforce_id, p_resident_code, p_doctor_id);
  IF v_actor->>'kind' <> 'WORKFORCE' THEN RAISE EXCEPTION 'Tenant membership is required' USING ERRCODE = '42501'; END IF;
  v_id := (v_actor->>'id')::uuid; v_tenant_id := (v_actor->>'tenant_id')::uuid;
  IF p_invitee_workforce_id = v_id OR NOT EXISTS (
    SELECT 1 FROM workforce w WHERE w.id = p_invitee_workforce_id AND w.tenant_id = v_tenant_id AND w.active = true
  ) THEN RAISE EXCEPTION 'Reviewer must be another active member of this tenant' USING ERRCODE = '42501'; END IF;

  IF p_artifact_type = 'DISSERTATION_MILESTONE' THEN
    SELECT 'Dissertation milestone: ' || dm.stage INTO v_safe_label
    FROM dissertation_milestones dm
    JOIN dissertations d ON d.id = dm.dissertation_id
    JOIN workforce w ON w.id = d.workforce_id
    WHERE dm.id = p_artifact_id AND d.workforce_id = v_id AND w.tenant_id = v_tenant_id;
    v_safe_route := '/workspace/consultant-review';
  ELSIF p_artifact_type = 'RESEARCH_WORKSPACE' THEN
    SELECT 'Research workspace' INTO v_safe_label FROM research_workspaces rw
    WHERE rw.id = p_artifact_id AND rw.workforce_id = v_id AND rw.tenant_id = v_tenant_id;
    v_safe_route := '/workspace/research';
  ELSE
    RAISE EXCEPTION 'Unsupported review artifact type';
  END IF;
  IF v_safe_label IS NULL THEN RAISE EXCEPTION 'Review artifact is unavailable or not owned by the inviter' USING ERRCODE = '42501'; END IF;

  INSERT INTO communication_conversations(
    id, tenant_id, kind, notification_purpose, subject, created_by_workforce_id
  ) VALUES (v_conversation_id, v_tenant_id, 'REVIEW', 'REVIEW_INVITATIONS', 'Review invitation', v_id);
  INSERT INTO communication_participants(conversation_id, workforce_id, participant_role, last_read_at)
  VALUES (v_conversation_id, v_id, 'MEMBER', timezone('utc'::text, now())),
    (v_conversation_id, p_invitee_workforce_id, 'REVIEWER', NULL);
  INSERT INTO communication_messages(conversation_id, sender_kind, sender_name, body, safe_route)
  VALUES (v_conversation_id, 'SYSTEM', 'Workspc',
    'A review invitation was created. Opening this conversation does not accept or complete the review.',
    '/workspace/communication?invitation=' || v_invitation_id::text);
  INSERT INTO review_invitations(
    id, tenant_id, conversation_id, inviter_workforce_id, invitee_workforce_id,
    artifact_type, artifact_id, safe_label, safe_route, permission_state, due_date
  ) VALUES (
    v_invitation_id, v_tenant_id, v_conversation_id, v_id, p_invitee_workforce_id,
    p_artifact_type, p_artifact_id, v_safe_label, v_safe_route, 'PENDING_OWNER_PERMISSION', p_due_date
  );
  PERFORM public._communication_enqueue_event(
    'review_invitation:' || v_invitation_id::text, p_invitee_workforce_id, NULL,
    'REVIEW_INVITATIONS', 'review_invitation_created', 'review_invitation:' || v_invitation_id::text
  );
  RETURN v_invitation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.communication_create_review_invitation(uuid, text, uuid, uuid, text, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_create_review_invitation(uuid, text, uuid, uuid, text, uuid, date) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.communication_respond_review_invitation(
  p_workforce_id uuid, p_resident_code text, p_doctor_id uuid, p_invitation_id uuid, p_status text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor jsonb; v_id uuid; v_invitation review_invitations%ROWTYPE;
BEGIN
  v_actor := public._communication_actor_context(p_workforce_id, p_resident_code, p_doctor_id);
  IF v_actor->>'kind' <> 'WORKFORCE' THEN RAISE EXCEPTION 'Tenant membership is required' USING ERRCODE = '42501'; END IF;
  v_id := (v_actor->>'id')::uuid;
  SELECT * INTO v_invitation FROM review_invitations WHERE id = p_invitation_id;
  IF NOT FOUND OR v_invitation.tenant_id <> (v_actor->>'tenant_id')::uuid THEN
    RAISE EXCEPTION 'Invitation not found in this tenant' USING ERRCODE = '42501';
  END IF;
  IF p_status = 'ACCEPTED' AND v_id = v_invitation.invitee_workforce_id AND v_invitation.status = 'PENDING' THEN
    UPDATE review_invitations SET status = 'ACCEPTED', accepted_at = timezone('utc'::text, now()) WHERE id = p_invitation_id;
  ELSIF p_status = 'DECLINED' AND v_id = v_invitation.invitee_workforce_id AND v_invitation.status = 'PENDING' THEN
    UPDATE review_invitations SET status = 'DECLINED' WHERE id = p_invitation_id;
  ELSIF p_status = 'CANCELLED' AND v_id = v_invitation.inviter_workforce_id AND v_invitation.status IN ('PENDING', 'ACCEPTED') THEN
    UPDATE review_invitations SET status = 'CANCELLED' WHERE id = p_invitation_id;
  ELSIF p_status = 'COMPLETED' AND v_id = v_invitation.invitee_workforce_id
    AND v_invitation.status = 'ACCEPTED' AND v_invitation.permission_state = 'AVAILABLE' THEN
    UPDATE review_invitations SET status = 'COMPLETED', completed_at = timezone('utc'::text, now()) WHERE id = p_invitation_id;
  ELSE
    RAISE EXCEPTION 'Invitation transition is not allowed' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.communication_respond_review_invitation(uuid, text, uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_respond_review_invitation(uuid, text, uuid, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.communication_start_coordination(
  p_workforce_id uuid, p_resident_code text, p_doctor_id uuid,
  p_target_workforce_id uuid, p_capability text, p_subject text, p_message text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor jsonb; v_id uuid; v_tenant_id uuid; v_purpose text; v_conversation_id uuid := gen_random_uuid();
BEGIN
  v_actor := public._communication_actor_context(p_workforce_id, p_resident_code, p_doctor_id);
  IF v_actor->>'kind' <> 'WORKFORCE' THEN RAISE EXCEPTION 'Tenant membership is required' USING ERRCODE = '42501'; END IF;
  v_id := (v_actor->>'id')::uuid; v_tenant_id := (v_actor->>'tenant_id')::uuid;
  IF p_capability NOT IN ('ANNOUNCEMENTS_MANAGE', 'MEETINGS_MANAGE', 'ROSTER_COORDINATE', 'KNOWLEDGE_PUBLISH', 'REVIEW_COORDINATE')
    OR NOT public._communication_has_capability(v_id, v_tenant_id, p_capability) THEN
    RAISE EXCEPTION 'Required delegated capability is not active' USING ERRCODE = '42501';
  END IF;
  IF p_target_workforce_id = v_id OR NOT EXISTS (
    SELECT 1 FROM workforce w WHERE w.id = p_target_workforce_id AND w.tenant_id = v_tenant_id AND w.active = true
  ) THEN RAISE EXCEPTION 'Target must be another active member of this tenant' USING ERRCODE = '42501'; END IF;
  IF NOT public._communication_safe_overview_label(p_subject) THEN
    RAISE EXCEPTION 'Use a concise subject without contact details, URLs, tokens or secrets';
  END IF;
  IF char_length(trim(coalesce(p_message, ''))) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'Coordination message is required'; END IF;
  v_purpose := CASE p_capability WHEN 'ANNOUNCEMENTS_MANAGE' THEN 'ANNOUNCEMENTS'
    WHEN 'MEETINGS_MANAGE' THEN 'MEETINGS' WHEN 'ROSTER_COORDINATE' THEN 'ROSTER'
    WHEN 'KNOWLEDGE_PUBLISH' THEN 'KNOWLEDGE_PUBLICATIONS' ELSE 'REVIEW_INVITATIONS' END;
  INSERT INTO communication_conversations(
    id, tenant_id, kind, notification_purpose, subject, created_by_workforce_id
  ) VALUES (v_conversation_id, v_tenant_id, 'COORDINATION', v_purpose, trim(p_subject), v_id);
  INSERT INTO communication_participants(conversation_id, workforce_id, participant_role, last_read_at)
  VALUES (v_conversation_id, v_id, 'COORDINATOR', timezone('utc'::text, now())),
    (v_conversation_id, p_target_workforce_id, 'MEMBER', NULL);
  INSERT INTO communication_messages(conversation_id, sender_workforce_id, sender_kind, sender_name, body)
  VALUES (v_conversation_id, v_id, 'WORKFORCE', v_actor->>'name', trim(p_message));
  PERFORM public._communication_enqueue_event(
    'coordination:' || v_conversation_id::text, p_target_workforce_id, NULL,
    v_purpose, lower(p_capability) || '_coordination', 'conversation:' || v_conversation_id::text
  );
  RETURN v_conversation_id;
END;
$$;
REVOKE ALL ON FUNCTION public.communication_start_coordination(uuid, text, uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.communication_start_coordination(uuid, text, uuid, uuid, text, text, text) TO anon, authenticated;

-- Chief-only capability administration returns badges and delivery
-- eligibility states, never raw contact values or conversation content.
CREATE OR REPLACE FUNCTION public.chief_get_communication_admin(p_admin_code text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant_id uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000'; END IF;
  RETURN jsonb_build_object(
    'delegations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', d.id, 'workforce_id', d.workforce_id, 'workforce_name', w.full_name,
        'capability', d.capability, 'status', d.status, 'granted_at', d.granted_at,
        'revoked_at', d.revoked_at, 'grantor_authority', d.grantor_authority
      ) ORDER BY d.updated_at DESC)
      FROM tenant_capability_delegations d JOIN workforce w ON w.id = d.workforce_id
      WHERE d.tenant_id = v_tenant_id
    ), '[]'::jsonb),
    'member_delivery_eligibility', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'workforce_id', w.id, 'workforce_name', w.full_name,
        'whatsapp_state', COALESCE((SELECT c.verification_state FROM communication_contact_points c
          WHERE c.owner_workforce_id = w.id AND c.channel = 'WHATSAPP'), 'NOT_PROVIDED'),
        'email_state', COALESCE((SELECT c.verification_state FROM communication_contact_points c
          WHERE c.owner_workforce_id = w.id AND c.channel = 'EMAIL'), 'NOT_PROVIDED')
      ) ORDER BY w.full_name)
      FROM workforce w WHERE w.tenant_id = v_tenant_id AND w.active = true
    ), '[]'::jsonb)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.chief_get_communication_admin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chief_get_communication_admin(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_grant_tenant_capability(
  p_admin_code text, p_workforce_id uuid, p_capability text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant_id uuid; v_grantor_auth_user_id uuid; v_grantor_authority text;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000'; END IF;
  IF p_capability NOT IN ('ANNOUNCEMENTS_MANAGE', 'MEETINGS_MANAGE', 'ROSTER_COORDINATE',
    'KNOWLEDGE_PUBLISH', 'REVIEW_COORDINATE', 'MEMBER_SUPPORT') THEN RAISE EXCEPTION 'Unsupported capability'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workforce w WHERE w.id = p_workforce_id AND w.tenant_id = v_tenant_id AND w.active = true) THEN
    RAISE EXCEPTION 'Member not found in this tenant' USING ERRCODE = '42501';
  END IF;
  SELECT om.auth_user_id INTO v_grantor_auth_user_id FROM organisation_memberships om
  WHERE om.auth_user_id = auth.uid() AND om.tenant_id = v_tenant_id
    AND om.is_tenant_admin = true AND om.status = 'active' LIMIT 1;
  IF EXISTS (SELECT 1 FROM organisation_memberships om
    WHERE om.auth_user_id = auth.uid() AND om.tenant_id = v_tenant_id
      AND om.workforce_id = p_workforce_id AND om.status = 'active') THEN
    RAISE EXCEPTION 'A tenant member cannot grant themselves a capability' USING ERRCODE = '42501';
  END IF;
  v_grantor_authority := CASE WHEN v_grantor_auth_user_id IS NULL
    THEN 'TENANT_ADMIN_CODE' ELSE 'AUTHENTICATED_TENANT_ADMIN' END;
  IF EXISTS (SELECT 1 FROM tenant_capability_delegations d
    WHERE d.tenant_id = v_tenant_id AND d.workforce_id = p_workforce_id
      AND d.capability = p_capability AND d.status = 'ACTIVE') THEN
    RAISE EXCEPTION 'This member already has that capability';
  END IF;
  INSERT INTO tenant_capability_delegations(
    tenant_id, workforce_id, capability, status, grantor_auth_user_id, grantor_authority
  ) VALUES (v_tenant_id, p_workforce_id, p_capability, 'ACTIVE', v_grantor_auth_user_id, v_grantor_authority);
  IF p_capability = 'MEMBER_SUPPORT' THEN
    INSERT INTO communication_participants(conversation_id, workforce_id, participant_role)
    SELECT c.id, p_workforce_id, 'SUPPORT' FROM communication_conversations c
    WHERE c.tenant_id = v_tenant_id AND c.kind = 'SUPPORT' AND c.status = 'OPEN'
      AND c.created_by_workforce_id <> p_workforce_id
    ON CONFLICT (conversation_id, workforce_id) WHERE workforce_id IS NOT NULL
    DO UPDATE SET participant_role = 'SUPPORT', access_revoked_at = NULL;
    UPDATE support_tickets SET assigned_workforce_id = p_workforce_id
    WHERE tenant_id = v_tenant_id AND status = 'OPEN' AND assigned_workforce_id IS NULL;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chief_grant_tenant_capability(text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chief_grant_tenant_capability(text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_revoke_tenant_capability(p_admin_code text, p_delegation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant_id uuid; v_delegation tenant_capability_delegations%ROWTYPE;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_delegation FROM tenant_capability_delegations d
  WHERE d.id = p_delegation_id AND d.tenant_id = v_tenant_id AND d.status = 'ACTIVE';
  IF NOT FOUND THEN RAISE EXCEPTION 'Active delegation not found in this tenant' USING ERRCODE = '42501'; END IF;
  UPDATE tenant_capability_delegations SET status = 'REVOKED', revoked_at = timezone('utc'::text, now())
  WHERE id = p_delegation_id;
  IF v_delegation.capability = 'MEMBER_SUPPORT' THEN
    UPDATE communication_participants cp SET access_revoked_at = timezone('utc'::text, now())
    FROM communication_conversations c
    WHERE cp.conversation_id = c.id AND cp.workforce_id = v_delegation.workforce_id
      AND cp.participant_role = 'SUPPORT' AND c.tenant_id = v_tenant_id AND c.kind = 'SUPPORT';
    UPDATE support_tickets SET assigned_workforce_id = NULL
    WHERE tenant_id = v_tenant_id AND assigned_workforce_id = v_delegation.workforce_id AND status = 'OPEN';
  ELSE
    UPDATE communication_participants cp SET access_revoked_at = timezone('utc'::text, now())
    FROM communication_conversations c
    WHERE cp.conversation_id = c.id AND cp.workforce_id = v_delegation.workforce_id
      AND cp.participant_role = 'COORDINATOR' AND c.tenant_id = v_tenant_id
      AND c.kind = 'COORDINATION'
      AND c.notification_purpose = CASE v_delegation.capability
        WHEN 'ANNOUNCEMENTS_MANAGE' THEN 'ANNOUNCEMENTS'
        WHEN 'MEETINGS_MANAGE' THEN 'MEETINGS'
        WHEN 'ROSTER_COORDINATE' THEN 'ROSTER'
        WHEN 'KNOWLEDGE_PUBLISH' THEN 'KNOWLEDGE_PUBLICATIONS'
        WHEN 'REVIEW_COORDINATE' THEN 'REVIEW_INVITATIONS'
        ELSE 'NO_MATCH'
      END;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.chief_revoke_tenant_capability(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.chief_revoke_tenant_capability(text, uuid) TO anon, authenticated;

-- ACTIVATION: keep unapplied until migration 84 receives a separate SQL/
-- RLS review, the live ceiling is re-verified, and a disposable behavioral
-- matrix proves cross-tenant, participant, grant/revoke, deduplication and
-- provider-disabled behavior. Do not configure Meta or Resend as part of
-- applying this migration; there is no sending adapter in this file.
--
-- ROLLBACK BEFORE REAL DATA: drop the public RPCs above, then internal
-- helpers, then the eleven new tables in reverse dependency order. After
-- real conversations/invitations exist this is a retention decision, not a
-- routine rollback: export required audit evidence and obtain owner review.
-- Existing tables, policies and functions are never changed by this file.

-- ====================================================================
-- END OF MIGRATION 84
-- ====================================================================
