-- Tenant administrator bootstrap and Tenant Setup & Vocabulary V1.
--
-- Canonical authority remains organisation_memberships.is_tenant_admin.
-- Display terminology remains data in tenants.terminology_overrides and can
-- never grant authority. This migration does not read or change a shared
-- administrator code and does not alter migrations 82/83.

CREATE TABLE public.tenant_admin_authority_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  membership_id uuid NOT NULL REFERENCES public.organisation_memberships(id),
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id),
  target_auth_user_id uuid NOT NULL REFERENCES auth.users(id),
  action text NOT NULL CHECK (action IN ('GRANTED', 'REVOKED')),
  capability text NOT NULL CHECK (capability = 'TENANT_ADMIN'),
  authorization_reference text NOT NULL CHECK (char_length(authorization_reference) BETWEEN 8 AND 160),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 500),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 16 AND 160),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX tenant_admin_authority_events_membership_created_idx
  ON public.tenant_admin_authority_events(membership_id, created_at DESC);

ALTER TABLE public.tenant_admin_authority_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_admin_authority_events FROM PUBLIC, anon, authenticated;

CREATE TABLE public.tenant_configuration_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id),
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 8 AND 500),
  idempotency_key text NOT NULL UNIQUE CHECK (char_length(idempotency_key) BETWEEN 16 AND 160),
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX tenant_configuration_audit_tenant_created_idx
  ON public.tenant_configuration_audit(tenant_id, created_at DESC);

ALTER TABLE public.tenant_configuration_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tenant_configuration_audit FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._workspc_current_tenant_admin()
RETURNS public.organisation_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_membership public.organisation_memberships%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated tenant administrator required' USING ERRCODE = '42501';
  END IF;

  SELECT om.* INTO v_membership
  FROM public.organisation_memberships om
  JOIN public.tenants t ON t.id = om.tenant_id AND t.status = 'active'
  WHERE om.auth_user_id = auth.uid()
    AND om.status = 'active'
    AND om.is_tenant_admin = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active tenant-administrator membership required' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organisation_memberships om
    JOIN public.tenants t ON t.id = om.tenant_id AND t.status = 'active'
    WHERE om.auth_user_id = auth.uid() AND om.status = 'active' AND om.is_tenant_admin = true
      AND om.id <> v_membership.id
  ) THEN
    RAISE EXCEPTION 'Choose an organisation before administering it' USING ERRCODE = '42501';
  END IF;

  RETURN v_membership;
END;
$$;

REVOKE ALL ON FUNCTION public._workspc_current_tenant_admin() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.workspc_bootstrap_tenant_admin(
  p_actor_auth_user_id uuid,
  p_target_membership_id uuid,
  p_expected_tenant_id uuid,
  p_authorization_reference text,
  p_reason text,
  p_idempotency_key text
)
RETURNS TABLE (
  audit_event_id uuid,
  membership_id uuid,
  tenant_id uuid,
  is_tenant_admin boolean,
  membership_status text,
  changed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target public.organisation_memberships%ROWTYPE;
  v_existing public.tenant_admin_authority_events%ROWTYPE;
  v_event_id uuid;
  v_changed boolean := false;
BEGIN
  IF p_authorization_reference IS NULL OR char_length(trim(p_authorization_reference)) NOT BETWEEN 8 AND 160
    OR p_reason IS NULL OR char_length(trim(p_reason)) NOT BETWEEN 8 AND 500
    OR p_idempotency_key IS NULL OR char_length(trim(p_idempotency_key)) NOT BETWEEN 16 AND 160 THEN
    RAISE EXCEPTION 'Complete authorization, reason and idempotency evidence is required';
  END IF;

  SELECT * INTO v_existing FROM public.tenant_admin_authority_events
  WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.action <> 'GRANTED'
      OR v_existing.actor_auth_user_id <> p_actor_auth_user_id
      OR v_existing.membership_id <> p_target_membership_id
      OR v_existing.tenant_id <> p_expected_tenant_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different authority event';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.membership_id, v_existing.tenant_id,
      (SELECT om.is_tenant_admin FROM public.organisation_memberships om WHERE om.id = v_existing.membership_id),
      (SELECT om.status FROM public.organisation_memberships om WHERE om.id = v_existing.membership_id), false;
    RETURN;
  END IF;

  SELECT * INTO v_target FROM public.organisation_memberships
  WHERE id = p_target_membership_id FOR UPDATE;
  IF NOT FOUND OR v_target.tenant_id <> p_expected_tenant_id OR v_target.status <> 'active'
    OR v_target.is_workforce_member <> true OR v_target.workforce_id IS NULL THEN
    RAISE EXCEPTION 'Target must be one active workforce membership in the expected tenant' USING ERRCODE = '42501';
  END IF;
  IF v_target.auth_user_id <> p_actor_auth_user_id THEN
    RAISE EXCEPTION 'This bootstrap only permits the authorized person to bootstrap their own linked membership' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.organisation_memberships om
    WHERE om.tenant_id = p_expected_tenant_id AND om.status = 'active'
      AND om.is_tenant_admin = true AND om.id <> p_target_membership_id
  ) THEN
    RAISE EXCEPTION 'This organisation already has a different active tenant administrator' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workforce w
    WHERE w.id = v_target.workforce_id AND w.tenant_id = p_expected_tenant_id AND w.active = true
  ) THEN
    RAISE EXCEPTION 'Linked workforce record is not active in the expected tenant' USING ERRCODE = '42501';
  END IF;

  IF NOT v_target.is_tenant_admin THEN
    UPDATE public.organisation_memberships SET is_tenant_admin = true
    WHERE id = p_target_membership_id;
    v_changed := true;
  END IF;

  INSERT INTO public.tenant_admin_authority_events(
    tenant_id, membership_id, actor_auth_user_id, target_auth_user_id,
    action, capability, authorization_reference, reason, idempotency_key
  ) VALUES (
    p_expected_tenant_id, p_target_membership_id, p_actor_auth_user_id, v_target.auth_user_id,
    'GRANTED', 'TENANT_ADMIN', trim(p_authorization_reference), trim(p_reason), trim(p_idempotency_key)
  ) RETURNING id INTO v_event_id;

  RETURN QUERY SELECT v_event_id, p_target_membership_id, p_expected_tenant_id,
    true, 'active'::text, v_changed;
END;
$$;

REVOKE ALL ON FUNCTION public.workspc_bootstrap_tenant_admin(uuid,uuid,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspc_bootstrap_tenant_admin(uuid,uuid,uuid,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.workspc_revoke_tenant_admin(
  p_actor_auth_user_id uuid,
  p_target_membership_id uuid,
  p_expected_tenant_id uuid,
  p_authorization_reference text,
  p_reason text,
  p_idempotency_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target public.organisation_memberships%ROWTYPE;
  v_existing public.tenant_admin_authority_events%ROWTYPE;
  v_event_id uuid;
BEGIN
  SELECT * INTO v_existing FROM public.tenant_admin_authority_events WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.action <> 'REVOKED' OR v_existing.membership_id <> p_target_membership_id
      OR v_existing.tenant_id <> p_expected_tenant_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different authority event';
    END IF;
    RETURN v_existing.id;
  END IF;

  SELECT * INTO v_target FROM public.organisation_memberships
  WHERE id = p_target_membership_id AND tenant_id = p_expected_tenant_id FOR UPDATE;
  IF NOT FOUND OR v_target.status <> 'active' OR v_target.is_tenant_admin <> true THEN
    RAISE EXCEPTION 'Active tenant-administrator membership not found' USING ERRCODE = '42501';
  END IF;

  IF v_target.is_workforce_member THEN
    UPDATE public.organisation_memberships SET is_tenant_admin = false WHERE id = v_target.id;
  ELSE
    UPDATE public.organisation_memberships SET status = 'revoked' WHERE id = v_target.id;
  END IF;

  INSERT INTO public.tenant_admin_authority_events(
    tenant_id, membership_id, actor_auth_user_id, target_auth_user_id,
    action, capability, authorization_reference, reason, idempotency_key
  ) VALUES (
    p_expected_tenant_id, p_target_membership_id, p_actor_auth_user_id, v_target.auth_user_id,
    'REVOKED', 'TENANT_ADMIN', trim(p_authorization_reference), trim(p_reason), trim(p_idempotency_key)
  ) RETURNING id INTO v_event_id;
  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.workspc_revoke_tenant_admin(uuid,uuid,uuid,text,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspc_revoke_tenant_admin(uuid,uuid,uuid,text,text,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.workspc_tenant_admin_get_dashboard()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin public.organisation_memberships%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
BEGIN
  v_admin := public._workspc_current_tenant_admin();
  SELECT * INTO STRICT v_tenant FROM public.tenants WHERE id = v_admin.tenant_id;

  RETURN jsonb_build_object(
    'membership_id', v_admin.id,
    'tenant_id', v_tenant.id,
    'tenant_name', v_tenant.name,
    'plan_type', v_tenant.plan_type,
    'terminology_overrides', v_tenant.terminology_overrides,
    'module_flags', v_tenant.module_flags,
    'counts', jsonb_build_object(
      'active_members', (SELECT count(*) FROM public.workforce w WHERE w.tenant_id = v_tenant.id AND w.active = true),
      'open_collections', (SELECT count(*) FROM public.collections c WHERE c.tenant_id = v_tenant.id AND c.status = 'open'),
      'active_admins', (SELECT count(*) FROM public.organisation_memberships om WHERE om.tenant_id = v_tenant.id AND om.status = 'active' AND om.is_tenant_admin = true)
    ),
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', w.id, 'full_name', w.full_name, 'category', w.category, 'active', w.active) ORDER BY w.full_name)
      FROM public.workforce w WHERE w.tenant_id = v_tenant.id
    ), '[]'::jsonb),
    'latest_configuration_audit_id', (
      SELECT a.id FROM public.tenant_configuration_audit a WHERE a.tenant_id = v_tenant.id ORDER BY a.created_at DESC LIMIT 1
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workspc_tenant_admin_get_dashboard() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspc_tenant_admin_get_dashboard() TO authenticated;

CREATE OR REPLACE FUNCTION public.workspc_tenant_admin_update_setup(
  p_expected_tenant_id uuid,
  p_name text,
  p_overrides jsonb,
  p_module_flags_patch jsonb,
  p_reason text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin public.organisation_memberships%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
  v_existing public.tenant_configuration_audit%ROWTYPE;
  v_key text;
  v_value jsonb;
  v_allowed_keys text[] := ARRAY[
    'org_name','org_short_name','tenant_type','member','members','admin','admin_dashboard',
    'senior_reviewer','senior_reviewers','schedule','assignment','rotation','submission',
    'collection_cycle','professional_development','dissertation','case_report','viva'
  ];
  v_allowed_modules text[] := ARRAY[
    'viva_simulator_enabled','dissertation_module_enabled','exam_readiness_enabled'
  ];
  v_before jsonb;
  v_after jsonb;
  v_audit_id uuid;
BEGIN
  v_admin := public._workspc_current_tenant_admin();
  IF v_admin.tenant_id <> p_expected_tenant_id THEN
    RAISE EXCEPTION 'Cross-tenant configuration is not allowed' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_existing FROM public.tenant_configuration_audit WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing.tenant_id <> p_expected_tenant_id OR v_existing.actor_auth_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different configuration action';
    END IF;
    RETURN jsonb_build_object('audit_id', v_existing.id, 'tenant_id', v_existing.tenant_id, 'changed', false, 'state', v_existing.after_state);
  END IF;

  IF p_name IS NULL OR char_length(trim(p_name)) NOT BETWEEN 2 AND 100
    OR trim(p_name) ~ '[<>]' OR trim(p_name) ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Organisation name must be 2-100 plain-text characters';
  END IF;
  IF jsonb_typeof(p_overrides) <> 'object' OR jsonb_typeof(p_module_flags_patch) <> 'object'
    OR p_reason IS NULL OR char_length(trim(p_reason)) NOT BETWEEN 8 AND 500
    OR p_idempotency_key IS NULL OR char_length(trim(p_idempotency_key)) NOT BETWEEN 16 AND 160 THEN
    RAISE EXCEPTION 'Valid configuration, reason and idempotency evidence is required';
  END IF;

  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_overrides) LOOP
    IF NOT (v_key = ANY(v_allowed_keys)) OR jsonb_typeof(v_value) <> 'string'
      OR char_length(trim(v_value #>> '{}')) NOT BETWEEN 1 AND 64
      OR trim(v_value #>> '{}') ~ '[<>]' OR trim(v_value #>> '{}') ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION 'Unsupported or unsafe terminology value for %', v_key;
    END IF;
  END LOOP;
  FOR v_key, v_value IN SELECT key, value FROM jsonb_each(p_module_flags_patch) LOOP
    IF NOT (v_key = ANY(v_allowed_modules)) OR jsonb_typeof(v_value) <> 'boolean' THEN
      RAISE EXCEPTION 'Unsupported module visibility value for %', v_key;
    END IF;
  END LOOP;

  SELECT * INTO STRICT v_tenant FROM public.tenants WHERE id = p_expected_tenant_id FOR UPDATE;
  v_before := jsonb_build_object('name',v_tenant.name,'terminology_overrides',v_tenant.terminology_overrides,'module_flags',v_tenant.module_flags);

  UPDATE public.tenants SET
    name = trim(p_name),
    terminology_overrides = p_overrides,
    module_flags = module_flags || p_module_flags_patch
  WHERE id = p_expected_tenant_id
  RETURNING * INTO v_tenant;

  v_after := jsonb_build_object('name',v_tenant.name,'terminology_overrides',v_tenant.terminology_overrides,'module_flags',v_tenant.module_flags);
  INSERT INTO public.tenant_configuration_audit(tenant_id,actor_auth_user_id,before_state,after_state,reason,idempotency_key)
  VALUES (v_tenant.id,auth.uid(),v_before,v_after,trim(p_reason),trim(p_idempotency_key))
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object('audit_id',v_audit_id,'tenant_id',v_tenant.id,'changed',v_before IS DISTINCT FROM v_after,'state',v_after);
END;
$$;

REVOKE ALL ON FUNCTION public.workspc_tenant_admin_update_setup(uuid,text,jsonb,jsonb,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspc_tenant_admin_update_setup(uuid,text,jsonb,jsonb,text,text) TO authenticated;
