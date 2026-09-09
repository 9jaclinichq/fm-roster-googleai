-- Institutional Account Linking V1.
-- Additive over the verified migration-85 production ceiling. This migration
-- has no dependency on migrations 82 or 83 and does not read or write their
-- objects.
--
-- The legacy institutional code remains a tenant/member entry credential for
-- existing basic flows. It is never sufficient to create this authenticated
-- link: a caller must also own a confirmed Supabase Auth email whose salted
-- fingerprint matches the member's independently-held identity contact, or
-- accept a single-use invitation sent to that contact.
--
-- ROLLBACK: disable account-link operations in workspc-gateway first. Keep
-- these evidence tables once any real invitation/link exists. The previous
-- claim_workforce_member body from migration 77 may be restored only if the
-- product is intentionally rolled back to its weaker resident-code claim
-- contract; do not drop membership rows or audit evidence.

CREATE OR REPLACE FUNCTION public._institutional_identity_email_fingerprint(
  p_workforce_id uuid,
  p_email text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public
AS $$
  SELECT encode(
    extensions.digest(
      'workspc-institutional-email-v1|' || p_workforce_id::text || '|' || lower(trim(p_email)),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION public._institutional_mask_email(p_email text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = public
AS $$
DECLARE
  v_local text := split_part(lower(trim(p_email)), '@', 1);
  v_domain text := split_part(lower(trim(p_email)), '@', 2);
  v_suffix text;
BEGIN
  IF v_local = '' OR v_domain = '' THEN RETURN 'Unavailable'; END IF;
  v_suffix := CASE WHEN position('.' IN v_domain) > 0
    THEN substring(v_domain FROM position('.' IN v_domain)) ELSE '' END;
  RETURN left(v_local, 1) || '***@' || left(v_domain, 1) || '***' || v_suffix;
END;
$$;

CREATE TABLE public.institutional_identity_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  workforce_id uuid NOT NULL REFERENCES public.workforce(id) ON DELETE RESTRICT,
  channel text NOT NULL CHECK (channel = 'EMAIL'),
  value_fingerprint text NOT NULL CHECK (value_fingerprint ~ '^[0-9a-f]{64}$'),
  masked_destination text NOT NULL CHECK (char_length(masked_destination) BETWEEN 5 AND 160),
  source text NOT NULL CHECK (source IN ('PREEXISTING_WORKFORCE_EMAIL', 'TENANT_ADMIN_CONFIRMED')),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUPERSEDED', 'REVOKED')),
  confirmed_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  superseded_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT institutional_identity_contact_unique UNIQUE (workforce_id, channel, value_fingerprint),
  CONSTRAINT institutional_identity_contact_state_check CHECK (
    (status = 'ACTIVE' AND superseded_at IS NULL AND revoked_at IS NULL)
    OR (status = 'SUPERSEDED' AND superseded_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX institutional_identity_contact_one_active
  ON public.institutional_identity_contacts(workforce_id, channel)
  WHERE status = 'ACTIVE';

CREATE TABLE public.institutional_account_link_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  workforce_id uuid NOT NULL REFERENCES public.workforce(id) ON DELETE RESTRICT,
  contact_id uuid REFERENCES public.institutional_identity_contacts(id) ON DELETE RESTRICT,
  token_digest text UNIQUE CHECK (token_digest IS NULL OR token_digest ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN (
    'ASSISTANCE_REQUESTED', 'BLOCKED_CONTACT', 'PENDING_DELIVERY', 'SENT',
    'DELIVERY_UNKNOWN', 'FAILED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED'
  )),
  issued_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  provider_message_id text,
  delivery_outcome text CHECK (delivery_outcome IS NULL OR delivery_outcome IN ('ACCEPTED', 'FAILED', 'UNKNOWN')),
  failure_classification text,
  send_count integer NOT NULL DEFAULT 0 CHECK (send_count BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  expires_at timestamptz NOT NULL,
  last_sent_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  expired_at timestamptz,
  revoked_at timestamptz,
  revoked_by_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT institutional_account_link_token_state CHECK (
    (token_digest IS NULL AND status IN ('ASSISTANCE_REQUESTED', 'BLOCKED_CONTACT', 'EXPIRED', 'REVOKED'))
    OR (token_digest IS NOT NULL AND status NOT IN ('ASSISTANCE_REQUESTED', 'BLOCKED_CONTACT'))
  ),
  CONSTRAINT institutional_account_link_terminal_state CHECK (
    (status = 'ACCEPTED' AND accepted_at IS NOT NULL)
    OR (status = 'REJECTED' AND rejected_at IS NOT NULL)
    OR (status = 'EXPIRED' AND expired_at IS NOT NULL)
    OR (status = 'REVOKED' AND revoked_at IS NOT NULL)
    OR status NOT IN ('ACCEPTED', 'REJECTED', 'EXPIRED', 'REVOKED')
  )
);

CREATE UNIQUE INDEX institutional_account_link_one_open_invitation
  ON public.institutional_account_link_invitations(workforce_id)
  WHERE status IN ('ASSISTANCE_REQUESTED', 'PENDING_DELIVERY', 'SENT', 'DELIVERY_UNKNOWN');
CREATE INDEX institutional_account_link_invitation_tenant_recent
  ON public.institutional_account_link_invitations(tenant_id, created_at DESC);

CREATE TABLE public.institutional_account_link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE CHECK (char_length(event_key) BETWEEN 8 AND 180),
  invitation_id uuid REFERENCES public.institutional_account_link_invitations(id) ON DELETE SET NULL,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  workforce_id uuid NOT NULL REFERENCES public.workforce(id) ON DELETE RESTRICT,
  actor_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'ASSISTANCE_REQUESTED', 'CONTACT_BLOCKED', 'INVITATION_PREPARED',
    'INVITATION_SENT', 'INVITATION_DELIVERY_FAILED', 'INVITATION_DELIVERY_UNKNOWN',
    'INVITATION_ACCEPTED', 'INVITATION_REJECTED', 'INVITATION_REVOKED',
    'INVITATION_EXPIRED', 'ACCOUNT_LINKED'
  )),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);
CREATE INDEX institutional_account_link_event_workforce_recent
  ON public.institutional_account_link_events(workforce_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._institutional_identity_tenant_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_tenant_id uuid;
BEGIN
  SELECT w.tenant_id INTO v_tenant_id FROM public.workforce w WHERE w.id = NEW.workforce_id;
  IF v_tenant_id IS NULL OR v_tenant_id <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Institutional identity tenant mismatch' USING ERRCODE = '42501';
  END IF;
  IF TG_TABLE_NAME = 'institutional_account_link_invitations' THEN
    IF NEW.contact_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.institutional_identity_contacts c
      WHERE c.id = NEW.contact_id AND c.workforce_id = NEW.workforce_id AND c.tenant_id = NEW.tenant_id
    ) THEN
      RAISE EXCEPTION 'Institutional identity contact mismatch' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER institutional_identity_contact_tenant_guard
BEFORE INSERT OR UPDATE ON public.institutional_identity_contacts
FOR EACH ROW EXECUTE FUNCTION public._institutional_identity_tenant_guard();
CREATE TRIGGER institutional_account_link_invitation_tenant_guard
BEFORE INSERT OR UPDATE ON public.institutional_account_link_invitations
FOR EACH ROW EXECUTE FUNCTION public._institutional_identity_tenant_guard();
CREATE TRIGGER institutional_account_link_event_tenant_guard
BEFORE INSERT OR UPDATE ON public.institutional_account_link_events
FOR EACH ROW EXECUTE FUNCTION public._institutional_identity_tenant_guard();

CREATE TRIGGER institutional_identity_contacts_updated_at
BEFORE UPDATE ON public.institutional_identity_contacts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER institutional_account_link_invitations_updated_at
BEFORE UPDATE ON public.institutional_account_link_invitations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.institutional_identity_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institutional_account_link_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.institutional_account_link_events ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'institutional_identity_contacts',
    'institutional_account_link_invitations',
    'institutional_account_link_events'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', v_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', v_table);
  END LOOP;
END $$;

-- Snapshot only the contact that predates this migration. Later code-only
-- edits to workforce.email cannot silently become account-link proof.
INSERT INTO public.institutional_identity_contacts(
  tenant_id, workforce_id, channel, value_fingerprint, masked_destination, source
)
SELECT
  w.tenant_id,
  w.id,
  'EMAIL',
  public._institutional_identity_email_fingerprint(w.id, w.email),
  public._institutional_mask_email(w.email),
  'PREEXISTING_WORKFORCE_EMAIL'
FROM public.workforce w
WHERE w.email IS NOT NULL
  AND trim(w.email) ~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$'
ON CONFLICT (workforce_id, channel, value_fingerprint) DO NOTHING;

CREATE OR REPLACE FUNCTION public.workspc_account_link_preflight(
  p_workforce_id uuid,
  p_resident_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workforce public.workforce%ROWTYPE;
  v_contact public.institutional_identity_contacts%ROWTYPE;
  v_tenant_name text;
BEGIN
  SELECT * INTO v_workforce
  FROM public.workforce w
  WHERE w.id = p_workforce_id AND w.resident_code = p_resident_code AND w.active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account linking is unavailable for these details' USING ERRCODE = '28000';
  END IF;
  SELECT t.name INTO v_tenant_name FROM public.tenants t WHERE t.id = v_workforce.tenant_id;
  SELECT * INTO v_contact
  FROM public.institutional_identity_contacts c
  WHERE c.workforce_id = v_workforce.id AND c.channel = 'EMAIL' AND c.status = 'ACTIVE';
  IF NOT FOUND OR v_workforce.email IS NULL
     OR v_contact.value_fingerprint <> public._institutional_identity_email_fingerprint(v_workforce.id, v_workforce.email) THEN
    RETURN jsonb_build_object(
      'state', 'CONTACT_CONFIRMATION_REQUIRED',
      'tenant_name', v_tenant_name,
      'member_name', v_workforce.full_name
    );
  END IF;
  RETURN jsonb_build_object(
    'state', 'CONTACT_READY',
    'tenant_name', v_tenant_name,
    'member_name', v_workforce.full_name,
    'masked_destination', v_contact.masked_destination
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_account_link_email_matches(
  p_workforce_id uuid,
  p_resident_code text,
  p_candidate_email text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_contact public.institutional_identity_contacts%ROWTYPE;
BEGIN
  IF p_candidate_email IS NULL OR trim(p_candidate_email) !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' THEN RETURN false; END IF;
  SELECT c.* INTO v_contact
  FROM public.workforce w
  JOIN public.institutional_identity_contacts c
    ON c.workforce_id = w.id AND c.channel = 'EMAIL' AND c.status = 'ACTIVE'
  WHERE w.id = p_workforce_id AND w.resident_code = p_resident_code AND w.active = true;
  IF NOT FOUND THEN RETURN false; END IF;
  RETURN v_contact.value_fingerprint = public._institutional_identity_email_fingerprint(p_workforce_id, p_candidate_email);
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_resident_login_by_code(
  p_tenant_id uuid,
  p_code text,
  p_email text DEFAULT NULL
)
RETURNS TABLE(id uuid, full_name text, category text, has_email boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.full_name, w.category, (w.email IS NOT NULL)
  FROM public.workforce w
  WHERE w.tenant_id = p_tenant_id
    AND w.resident_code = p_code
    AND w.active = true
    AND (w.email IS NULL OR lower(w.email) = lower(trim(coalesce(p_email, ''))))
    AND NOT EXISTS (
      SELECT 1 FROM public.organisation_memberships om
      WHERE om.workforce_id = w.id AND om.legacy_code_disabled_at IS NOT NULL
    );
$$;

CREATE OR REPLACE FUNCTION public._workspc_link_authenticated_workforce(
  p_auth_user_id uuid,
  p_workforce_id uuid,
  p_claim_method text
)
RETURNS public.organisation_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workforce public.workforce%ROWTYPE;
  v_existing public.organisation_memberships%ROWTYPE;
  v_result public.organisation_memberships%ROWTYPE;
BEGIN
  SELECT * INTO v_workforce FROM public.workforce w WHERE w.id = p_workforce_id AND w.active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workforce record is unavailable' USING ERRCODE = '22023'; END IF;

  SELECT * INTO v_existing
  FROM public.organisation_memberships om
  WHERE om.tenant_id = v_workforce.tenant_id AND om.auth_user_id = p_auth_user_id
  FOR UPDATE;
  IF FOUND AND v_existing.status <> 'active' THEN
    RAISE EXCEPTION 'This membership requires administrator review' USING ERRCODE = '42501';
  END IF;
  IF FOUND AND v_existing.workforce_id IS NOT NULL AND v_existing.workforce_id <> p_workforce_id THEN
    RAISE EXCEPTION 'This account is already linked to another member in this organisation' USING ERRCODE = '42501';
  END IF;

  BEGIN
    INSERT INTO public.organisation_memberships AS om(
      tenant_id, auth_user_id, workforce_id, is_workforce_member, is_tenant_admin,
      status, claimed_at, claim_method
    ) VALUES (
      v_workforce.tenant_id, p_auth_user_id, p_workforce_id, true, false,
      'active', timezone('utc'::text, now()), p_claim_method
    )
    ON CONFLICT (tenant_id, auth_user_id) DO UPDATE SET
      workforce_id = EXCLUDED.workforce_id,
      is_workforce_member = true,
      claimed_at = COALESCE(om.claimed_at, EXCLUDED.claimed_at),
      claim_method = COALESCE(om.claim_method, EXCLUDED.claim_method),
      updated_at = timezone('utc'::text, now())
    WHERE om.status = 'active'
      AND (om.workforce_id IS NULL OR om.workforce_id = EXCLUDED.workforce_id)
    RETURNING * INTO v_result;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This workforce profile is already linked to another account' USING ERRCODE = '23505';
  END;
  IF v_result.id IS NULL THEN
    RAISE EXCEPTION 'Account linking conflict' USING ERRCODE = '42501';
  END IF;
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_workforce_member(p_workforce_id uuid, p_resident_code text)
RETURNS TABLE (
  membership_id uuid,
  claim_tenant_id uuid,
  claim_workforce_id uuid,
  claim_is_workforce_member boolean,
  claim_is_tenant_admin boolean,
  claim_status text,
  claim_claimed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_email text;
  v_email_confirmed_at timestamptz;
  v_workforce public.workforce%ROWTYPE;
  v_contact public.institutional_identity_contacts%ROWTYPE;
  v_result public.organisation_memberships%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  SELECT u.email, u.email_confirmed_at INTO v_user_email, v_email_confirmed_at
  FROM auth.users u WHERE u.id = auth.uid();
  IF v_user_email IS NULL OR v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Confirm your account email before linking' USING ERRCODE = '28000';
  END IF;
  SELECT * INTO v_workforce
  FROM public.workforce w
  WHERE w.id = p_workforce_id AND w.resident_code = p_resident_code AND w.active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account linking is unavailable for these details' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_contact FROM public.institutional_identity_contacts c
  WHERE c.workforce_id = v_workforce.id AND c.channel = 'EMAIL' AND c.status = 'ACTIVE';
  IF NOT FOUND OR v_contact.value_fingerprint <> public._institutional_identity_email_fingerprint(v_workforce.id, v_user_email) THEN
    RAISE EXCEPTION 'Your confirmed account does not match the contact held for this member profile' USING ERRCODE = '28000';
  END IF;
  v_result := public._workspc_link_authenticated_workforce(auth.uid(), p_workforce_id, 'VERIFIED_WORKFORCE_EMAIL');
  INSERT INTO public.institutional_account_link_events(
    event_key, tenant_id, workforce_id, actor_auth_user_id, subject_auth_user_id, event_type
  ) VALUES (
    'account-link:' || v_result.id::text,
    v_result.tenant_id, p_workforce_id, auth.uid(), auth.uid(), 'ACCOUNT_LINKED'
  ) ON CONFLICT (event_key) DO NOTHING;
  RETURN QUERY SELECT v_result.id, v_result.tenant_id, v_result.workforce_id,
    v_result.is_workforce_member, v_result.is_tenant_admin, v_result.status, v_result.claimed_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_account_link_request_assistance(
  p_workforce_id uuid,
  p_resident_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_workforce public.workforce%ROWTYPE; v_invitation_id uuid;
BEGIN
  SELECT * INTO v_workforce FROM public.workforce w
  WHERE w.id = p_workforce_id AND w.resident_code = p_resident_code AND w.active = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account linking is unavailable for these details' USING ERRCODE = '28000'; END IF;
  SELECT i.id INTO v_invitation_id FROM public.institutional_account_link_invitations i
  WHERE i.workforce_id = p_workforce_id AND i.status IN ('ASSISTANCE_REQUESTED','PENDING_DELIVERY','SENT','DELIVERY_UNKNOWN');
  IF v_invitation_id IS NOT NULL THEN RETURN jsonb_build_object('state','ALREADY_REQUESTED'); END IF;
  INSERT INTO public.institutional_account_link_invitations(
    tenant_id, workforce_id, status, expires_at
  ) VALUES (
    v_workforce.tenant_id, p_workforce_id, 'ASSISTANCE_REQUESTED', timezone('utc'::text, now()) + interval '7 days'
  ) RETURNING id INTO v_invitation_id;
  INSERT INTO public.institutional_account_link_events(event_key, invitation_id, tenant_id, workforce_id, event_type)
  VALUES ('assistance:' || v_invitation_id::text, v_invitation_id, v_workforce.tenant_id, p_workforce_id, 'ASSISTANCE_REQUESTED');
  RETURN jsonb_build_object('state','ASSISTANCE_REQUESTED');
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_account_link_prepare_invitation(
  p_auth_user_id uuid,
  p_membership_id uuid,
  p_workforce_id uuid,
  p_token_digest text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin public.organisation_memberships%ROWTYPE;
  v_workforce public.workforce%ROWTYPE;
  v_contact public.institutional_identity_contacts%ROWTYPE;
  v_invitation_id uuid;
  v_recent integer;
BEGIN
  IF p_auth_user_id IS NULL OR p_token_digest !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Authenticated administrator required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_workforce FROM public.workforce w WHERE w.id = p_workforce_id AND w.active = true FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Workforce record is unavailable' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_admin FROM public.organisation_memberships om
  WHERE om.auth_user_id = p_auth_user_id AND om.tenant_id = v_workforce.tenant_id
    AND om.status = 'active' AND om.is_tenant_admin = true
    AND (p_membership_id IS NULL OR om.id = p_membership_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Authenticated tenant administrator required' USING ERRCODE = '42501'; END IF;
  SELECT count(*) INTO v_recent FROM public.institutional_account_link_invitations i
  WHERE i.issued_by_auth_user_id = p_auth_user_id AND i.created_at > timezone('utc'::text, now()) - interval '1 hour';
  IF v_recent >= 5 THEN RAISE EXCEPTION 'Invitation rate limit reached' USING ERRCODE = 'P0001'; END IF;

  WITH expired AS (
    UPDATE public.institutional_account_link_invitations i
    SET status = 'EXPIRED', expired_at = timezone('utc'::text, now())
    WHERE i.workforce_id = p_workforce_id AND i.expires_at <= timezone('utc'::text, now())
      AND i.status IN ('ASSISTANCE_REQUESTED','PENDING_DELIVERY','SENT','DELIVERY_UNKNOWN')
    RETURNING i.*
  ) INSERT INTO public.institutional_account_link_events(event_key,invitation_id,tenant_id,workforce_id,event_type)
    SELECT 'invite-expired:'||id::text,id,tenant_id,workforce_id,'INVITATION_EXPIRED' FROM expired
    ON CONFLICT(event_key) DO NOTHING;
  IF EXISTS (
    SELECT 1 FROM public.institutional_account_link_invitations i
    WHERE i.workforce_id = p_workforce_id AND i.last_sent_at > timezone('utc'::text, now()) - interval '60 seconds'
      AND i.status IN ('SENT','DELIVERY_UNKNOWN')
  ) THEN RAISE EXCEPTION 'Invitation resend cooldown is active' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_contact FROM public.institutional_identity_contacts c
  WHERE c.workforce_id = p_workforce_id AND c.channel = 'EMAIL' AND c.status = 'ACTIVE';
  IF NOT FOUND OR v_workforce.email IS NULL
     OR v_contact.value_fingerprint <> public._institutional_identity_email_fingerprint(p_workforce_id, v_workforce.email) THEN
    WITH revoked AS (
      UPDATE public.institutional_account_link_invitations i
      SET status = 'REVOKED', revoked_at = timezone('utc'::text, now()), revoked_by_auth_user_id = p_auth_user_id
      WHERE i.workforce_id = p_workforce_id
        AND i.status IN ('ASSISTANCE_REQUESTED','PENDING_DELIVERY','SENT','DELIVERY_UNKNOWN')
      RETURNING i.*
    ) INSERT INTO public.institutional_account_link_events(event_key,invitation_id,tenant_id,workforce_id,actor_auth_user_id,event_type)
      SELECT 'invite-revoked:'||id::text,id,tenant_id,workforce_id,p_auth_user_id,'INVITATION_REVOKED' FROM revoked
      ON CONFLICT(event_key) DO NOTHING;
    INSERT INTO public.institutional_account_link_invitations(
      tenant_id, workforce_id, status, issued_by_auth_user_id, delivery_outcome,
      failure_classification, expires_at
    ) VALUES (
      v_workforce.tenant_id, p_workforce_id, 'BLOCKED_CONTACT', p_auth_user_id,
      'FAILED', 'CONTACT_CONFIRMATION_REQUIRED', timezone('utc'::text, now()) + interval '7 days'
    ) RETURNING id INTO v_invitation_id;
    INSERT INTO public.institutional_account_link_events(event_key, invitation_id, tenant_id, workforce_id, actor_auth_user_id, event_type)
    VALUES ('contact-blocked:' || v_invitation_id::text, v_invitation_id, v_workforce.tenant_id, p_workforce_id, p_auth_user_id, 'CONTACT_BLOCKED');
    RETURN jsonb_build_object('state','CONTACT_CONFIRMATION_REQUIRED','invitation_id',v_invitation_id);
  END IF;

  WITH revoked AS (
    UPDATE public.institutional_account_link_invitations i
    SET status = 'REVOKED', revoked_at = timezone('utc'::text, now()), revoked_by_auth_user_id = p_auth_user_id
    WHERE i.workforce_id = p_workforce_id
      AND i.status IN ('ASSISTANCE_REQUESTED','PENDING_DELIVERY','SENT','DELIVERY_UNKNOWN')
    RETURNING i.*
  ) INSERT INTO public.institutional_account_link_events(event_key,invitation_id,tenant_id,workforce_id,actor_auth_user_id,event_type)
    SELECT 'invite-revoked:'||id::text,id,tenant_id,workforce_id,p_auth_user_id,'INVITATION_REVOKED' FROM revoked
    ON CONFLICT(event_key) DO NOTHING;
  INSERT INTO public.institutional_account_link_invitations(
    tenant_id, workforce_id, contact_id, token_digest, status,
    issued_by_auth_user_id, expires_at
  ) VALUES (
    v_workforce.tenant_id, p_workforce_id, v_contact.id, p_token_digest,
    'PENDING_DELIVERY', p_auth_user_id, timezone('utc'::text, now()) + interval '24 hours'
  ) RETURNING id INTO v_invitation_id;
  INSERT INTO public.institutional_account_link_events(event_key, invitation_id, tenant_id, workforce_id, actor_auth_user_id, event_type)
  VALUES ('invite-prepared:' || v_invitation_id::text, v_invitation_id, v_workforce.tenant_id, p_workforce_id, p_auth_user_id, 'INVITATION_PREPARED');
  RETURN jsonb_build_object(
    'state','PENDING_DELIVERY','invitation_id',v_invitation_id,
    'recipient',v_workforce.email,'masked_destination',v_contact.masked_destination,
    'expires_at',timezone('utc'::text, now()) + interval '24 hours'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_account_link_finish_invitation_delivery(
  p_invitation_id uuid,
  p_outcome text,
  p_provider_message_id text,
  p_failure_classification text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_invitation public.institutional_account_link_invitations%ROWTYPE; v_state text; v_event text;
BEGIN
  IF p_outcome NOT IN ('ACCEPTED','FAILED','UNKNOWN') THEN RAISE EXCEPTION 'Invalid delivery outcome'; END IF;
  v_state := CASE p_outcome WHEN 'ACCEPTED' THEN 'SENT' WHEN 'FAILED' THEN 'FAILED' ELSE 'DELIVERY_UNKNOWN' END;
  v_event := CASE p_outcome WHEN 'ACCEPTED' THEN 'INVITATION_SENT' WHEN 'FAILED' THEN 'INVITATION_DELIVERY_FAILED' ELSE 'INVITATION_DELIVERY_UNKNOWN' END;
  UPDATE public.institutional_account_link_invitations i
  SET status = v_state, delivery_outcome = p_outcome,
      provider_message_id = p_provider_message_id,
      failure_classification = p_failure_classification,
      last_sent_at = COALESCE(last_sent_at, timezone('utc'::text, now()))
  WHERE i.id = p_invitation_id AND i.status IN ('PENDING_DELIVERY','DELIVERY_UNKNOWN')
  RETURNING * INTO v_invitation;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation is not pending delivery'; END IF;
  INSERT INTO public.institutional_account_link_events(event_key, invitation_id, tenant_id, workforce_id, actor_auth_user_id, event_type)
  VALUES ('invite-delivery:' || v_invitation.id::text || ':' || p_outcome, v_invitation.id,
    v_invitation.tenant_id, v_invitation.workforce_id, v_invitation.issued_by_auth_user_id, v_event)
  ON CONFLICT (event_key) DO NOTHING;
  RETURN jsonb_build_object('state',v_state,'expires_at',v_invitation.expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_account_link_begin_invitation_delivery(p_invitation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invitation public.institutional_account_link_invitations%ROWTYPE;
BEGIN
  UPDATE public.institutional_account_link_invitations i
  SET status='DELIVERY_UNKNOWN',delivery_outcome='UNKNOWN',failure_classification='DISPATCH_OUTCOME_PENDING',
      send_count=send_count+1,last_sent_at=timezone('utc'::text,now())
  WHERE i.id=p_invitation_id AND i.status='PENDING_DELIVERY'
  RETURNING * INTO v_invitation;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation is not pending delivery'; END IF;
  INSERT INTO public.institutional_account_link_events(event_key,invitation_id,tenant_id,workforce_id,actor_auth_user_id,event_type)
  VALUES ('invite-delivery:'||v_invitation.id::text||':UNKNOWN',v_invitation.id,v_invitation.tenant_id,v_invitation.workforce_id,v_invitation.issued_by_auth_user_id,'INVITATION_DELIVERY_UNKNOWN')
  ON CONFLICT(event_key) DO NOTHING;
  RETURN jsonb_build_object('state','DELIVERY_UNKNOWN');
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_account_link_accept_invitation(
  p_auth_user_id uuid,
  p_token_digest text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation public.institutional_account_link_invitations%ROWTYPE;
  v_contact public.institutional_identity_contacts%ROWTYPE;
  v_workforce public.workforce%ROWTYPE;
  v_email text;
  v_email_confirmed_at timestamptz;
  v_membership public.organisation_memberships%ROWTYPE;
BEGIN
  IF p_auth_user_id IS NULL OR p_token_digest !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '28000'; END IF;
  SELECT * INTO v_invitation FROM public.institutional_account_link_invitations i
  WHERE i.token_digest = p_token_digest FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invalid invitation' USING ERRCODE = '28000'; END IF;
  IF v_invitation.status = 'ACCEPTED' AND v_invitation.accepted_by_auth_user_id = p_auth_user_id THEN
    RETURN jsonb_build_object('state','ALREADY_ACCEPTED','workforce_id',v_invitation.workforce_id);
  END IF;
  IF v_invitation.status NOT IN ('SENT','DELIVERY_UNKNOWN') THEN RAISE EXCEPTION 'Invitation is no longer available' USING ERRCODE = '28000'; END IF;
  IF v_invitation.expires_at <= timezone('utc'::text, now()) THEN
    UPDATE public.institutional_account_link_invitations SET status='EXPIRED',expired_at=timezone('utc'::text,now()) WHERE id=v_invitation.id;
    INSERT INTO public.institutional_account_link_events(event_key,invitation_id,tenant_id,workforce_id,event_type)
    VALUES ('invite-expired:'||v_invitation.id::text,v_invitation.id,v_invitation.tenant_id,v_invitation.workforce_id,'INVITATION_EXPIRED')
    ON CONFLICT(event_key) DO NOTHING;
    RETURN jsonb_build_object('state','EXPIRED');
  END IF;
  SELECT u.email,u.email_confirmed_at INTO v_email,v_email_confirmed_at FROM auth.users u WHERE u.id=p_auth_user_id;
  SELECT * INTO v_workforce FROM public.workforce w WHERE w.id=v_invitation.workforce_id AND w.active=true FOR UPDATE;
  SELECT * INTO v_contact FROM public.institutional_identity_contacts c WHERE c.id=v_invitation.contact_id AND c.status='ACTIVE';
  IF v_email IS NULL OR v_email_confirmed_at IS NULL OR v_workforce.id IS NULL OR v_contact.id IS NULL
     OR v_contact.value_fingerprint <> public._institutional_identity_email_fingerprint(v_invitation.workforce_id,v_email)
     OR v_workforce.email IS NULL
     OR v_contact.value_fingerprint <> public._institutional_identity_email_fingerprint(v_invitation.workforce_id,v_workforce.email) THEN
    RAISE EXCEPTION 'Invitation ownership proof did not match' USING ERRCODE = '28000';
  END IF;
  v_membership := public._workspc_link_authenticated_workforce(p_auth_user_id,v_invitation.workforce_id,'TENANT_ADMIN_INVITATION');
  UPDATE public.institutional_account_link_invitations
  SET status='ACCEPTED',accepted_by_auth_user_id=p_auth_user_id,accepted_at=timezone('utc'::text,now())
  WHERE id=v_invitation.id;
  INSERT INTO public.institutional_account_link_events(event_key,invitation_id,tenant_id,workforce_id,actor_auth_user_id,subject_auth_user_id,event_type)
  VALUES ('invite-accepted:'||v_invitation.id::text,v_invitation.id,v_invitation.tenant_id,v_invitation.workforce_id,p_auth_user_id,p_auth_user_id,'INVITATION_ACCEPTED')
  ON CONFLICT(event_key) DO NOTHING;
  INSERT INTO public.institutional_account_link_events(event_key,invitation_id,tenant_id,workforce_id,actor_auth_user_id,subject_auth_user_id,event_type)
  VALUES ('account-link:'||v_membership.id::text,v_invitation.id,v_invitation.tenant_id,v_invitation.workforce_id,p_auth_user_id,p_auth_user_id,'ACCOUNT_LINKED')
  ON CONFLICT(event_key) DO NOTHING;
  RETURN jsonb_build_object('state','ACCEPTED','membership_id',v_membership.id,'workforce_id',v_invitation.workforce_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_account_link_reject_invitation(p_auth_user_id uuid,p_token_digest text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invitation public.institutional_account_link_invitations%ROWTYPE; v_email text; v_confirmed timestamptz; v_contact public.institutional_identity_contacts%ROWTYPE;
BEGIN
  IF p_auth_user_id IS NULL OR p_token_digest !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid invitation' USING ERRCODE='28000'; END IF;
  SELECT * INTO v_invitation FROM public.institutional_account_link_invitations i WHERE i.token_digest=p_token_digest FOR UPDATE;
  IF NOT FOUND OR v_invitation.status NOT IN ('SENT','DELIVERY_UNKNOWN') THEN RAISE EXCEPTION 'Invitation is no longer available' USING ERRCODE='28000'; END IF;
  IF v_invitation.expires_at <= timezone('utc'::text,now()) THEN
    UPDATE public.institutional_account_link_invitations SET status='EXPIRED',expired_at=timezone('utc'::text,now()) WHERE id=v_invitation.id;
    INSERT INTO public.institutional_account_link_events(event_key,invitation_id,tenant_id,workforce_id,event_type)
    VALUES ('invite-expired:'||v_invitation.id::text,v_invitation.id,v_invitation.tenant_id,v_invitation.workforce_id,'INVITATION_EXPIRED')
    ON CONFLICT(event_key) DO NOTHING;
    RETURN jsonb_build_object('state','EXPIRED');
  END IF;
  SELECT u.email,u.email_confirmed_at INTO v_email,v_confirmed FROM auth.users u WHERE u.id=p_auth_user_id;
  SELECT * INTO v_contact FROM public.institutional_identity_contacts c WHERE c.id=v_invitation.contact_id;
  IF v_email IS NULL OR v_confirmed IS NULL OR v_contact.value_fingerprint <> public._institutional_identity_email_fingerprint(v_invitation.workforce_id,v_email) THEN
    RAISE EXCEPTION 'Invitation ownership proof did not match' USING ERRCODE='28000';
  END IF;
  UPDATE public.institutional_account_link_invitations SET status='REJECTED',rejected_at=timezone('utc'::text,now()) WHERE id=v_invitation.id;
  INSERT INTO public.institutional_account_link_events(event_key,invitation_id,tenant_id,workforce_id,actor_auth_user_id,subject_auth_user_id,event_type)
  VALUES ('invite-rejected:'||v_invitation.id::text,v_invitation.id,v_invitation.tenant_id,v_invitation.workforce_id,p_auth_user_id,p_auth_user_id,'INVITATION_REJECTED')
  ON CONFLICT(event_key) DO NOTHING;
  RETURN jsonb_build_object('state','REJECTED');
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_account_link_revoke_invitation(
  p_auth_user_id uuid,p_membership_id uuid,p_invitation_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invitation public.institutional_account_link_invitations%ROWTYPE;
BEGIN
  SELECT * INTO v_invitation FROM public.institutional_account_link_invitations i WHERE i.id=p_invitation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invitation not found' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organisation_memberships om WHERE om.auth_user_id=p_auth_user_id AND om.tenant_id=v_invitation.tenant_id AND om.status='active' AND om.is_tenant_admin=true AND (p_membership_id IS NULL OR om.id=p_membership_id)) THEN
    RAISE EXCEPTION 'Authenticated tenant administrator required' USING ERRCODE='42501';
  END IF;
  IF v_invitation.status IN ('ACCEPTED','REJECTED','EXPIRED','REVOKED','FAILED','BLOCKED_CONTACT') THEN
    RETURN jsonb_build_object('state',v_invitation.status);
  END IF;
  UPDATE public.institutional_account_link_invitations SET status='REVOKED',revoked_at=timezone('utc'::text,now()),revoked_by_auth_user_id=p_auth_user_id WHERE id=v_invitation.id;
  INSERT INTO public.institutional_account_link_events(event_key,invitation_id,tenant_id,workforce_id,actor_auth_user_id,event_type)
  VALUES ('invite-revoked:'||v_invitation.id::text,v_invitation.id,v_invitation.tenant_id,v_invitation.workforce_id,p_auth_user_id,'INVITATION_REVOKED')
  ON CONFLICT(event_key) DO NOTHING;
  RETURN jsonb_build_object('state','REVOKED');
END;
$$;

CREATE OR REPLACE FUNCTION public.workspc_account_link_admin_overview(p_auth_user_id uuid,p_membership_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin public.organisation_memberships%ROWTYPE;
BEGIN
  SELECT * INTO v_admin FROM public.organisation_memberships om
  WHERE om.auth_user_id=p_auth_user_id AND om.status='active' AND om.is_tenant_admin=true
    AND (p_membership_id IS NULL OR om.id=p_membership_id)
  ORDER BY om.created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Authenticated tenant administrator required' USING ERRCODE='42501'; END IF;
  WITH expired AS (
    UPDATE public.institutional_account_link_invitations i SET status='EXPIRED',expired_at=timezone('utc'::text,now())
    WHERE i.tenant_id=v_admin.tenant_id AND i.expires_at<=timezone('utc'::text,now()) AND i.status IN ('ASSISTANCE_REQUESTED','PENDING_DELIVERY','SENT','DELIVERY_UNKNOWN')
    RETURNING i.*
  ) INSERT INTO public.institutional_account_link_events(event_key,invitation_id,tenant_id,workforce_id,event_type)
    SELECT 'invite-expired:'||id::text,id,tenant_id,workforce_id,'INVITATION_EXPIRED' FROM expired
    ON CONFLICT(event_key) DO NOTHING;
  RETURN jsonb_build_object(
    'tenant_id',v_admin.tenant_id,
    'counts',jsonb_build_object(
      'unlinked',(SELECT count(*) FROM public.workforce w WHERE w.tenant_id=v_admin.tenant_id AND w.active=true AND NOT EXISTS(SELECT 1 FROM public.organisation_memberships om WHERE om.workforce_id=w.id AND om.status IN ('active','suspended'))),
      'invited',(SELECT count(*) FROM public.institutional_account_link_invitations i WHERE i.tenant_id=v_admin.tenant_id AND i.status IN ('PENDING_DELIVERY','SENT','DELIVERY_UNKNOWN')),
      'linked',(SELECT count(*) FROM public.organisation_memberships om WHERE om.tenant_id=v_admin.tenant_id AND om.workforce_id IS NOT NULL AND om.status='active'),
      'blocked',(SELECT count(*) FROM public.workforce w WHERE w.tenant_id=v_admin.tenant_id AND w.active=true AND NOT EXISTS(SELECT 1 FROM public.institutional_identity_contacts c WHERE c.workforce_id=w.id AND c.status='ACTIVE'))
    ),
    'invitations',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id',i.id,'workforce_id',i.workforce_id,'member_name',w.full_name,
      'masked_destination',c.masked_destination,'status',i.status,
      'expires_at',i.expires_at,'send_count',i.send_count,
      'issued_by',COALESCE(NULLIF(dp.full_name,''),'Authenticated administrator')
    ) ORDER BY i.created_at DESC)
      FROM public.institutional_account_link_invitations i
      JOIN public.workforce w ON w.id=i.workforce_id
      LEFT JOIN public.institutional_identity_contacts c ON c.id=i.contact_id
      LEFT JOIN public.doctor_profiles dp ON dp.id=i.issued_by_auth_user_id
      WHERE i.tenant_id=v_admin.tenant_id),'[]'::jsonb)
  );
END;
$$;

-- Direct browser access is limited to the non-enumerating preflight,
-- candidate-email match, legacy exact-code login, assistance request, and
-- the authenticated self-claim. All invitation token/delivery/admin RPCs are
-- service-role-only behind workspc-gateway.
DO $$
BEGIN
  REVOKE ALL ON FUNCTION public._institutional_identity_email_fingerprint(uuid,text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public._institutional_mask_email(text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public._workspc_link_authenticated_workforce(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.workspc_account_link_preflight(uuid,text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.workspc_account_link_email_matches(uuid,text,text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.verify_resident_login_by_code(uuid,text,text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.claim_workforce_member(uuid,text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.workspc_account_link_request_assistance(uuid,text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.workspc_account_link_prepare_invitation(uuid,uuid,uuid,text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.workspc_account_link_finish_invitation_delivery(uuid,text,text,text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.workspc_account_link_begin_invitation_delivery(uuid) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.workspc_account_link_accept_invitation(uuid,text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.workspc_account_link_reject_invitation(uuid,text) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.workspc_account_link_revoke_invitation(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
  REVOKE ALL ON FUNCTION public.workspc_account_link_admin_overview(uuid,uuid) FROM PUBLIC,anon,authenticated;
END $$;

GRANT EXECUTE ON FUNCTION public.workspc_account_link_preflight(uuid,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspc_account_link_email_matches(uuid,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.verify_resident_login_by_code(uuid,text,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workforce_member(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.workspc_account_link_request_assistance(uuid,text) TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.workspc_account_link_prepare_invitation(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspc_account_link_finish_invitation_delivery(uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspc_account_link_begin_invitation_delivery(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspc_account_link_accept_invitation(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspc_account_link_reject_invitation(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspc_account_link_revoke_invitation(uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspc_account_link_admin_overview(uuid,uuid) TO service_role;
