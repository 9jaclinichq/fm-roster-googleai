\set ON_ERROR_STOP on
DO $$
DECLARE v jsonb; v_token text := repeat('a',64); v_inv uuid;
BEGIN
  v := public.workspc_account_link_preflight('30000000-0000-4000-8000-000000000001','111111');
  IF v->>'state' <> 'CONTACT_READY' OR v ? 'recipient' THEN RAISE EXCEPTION 'preflight leaked or failed'; END IF;
  v := public.workspc_account_link_preflight('30000000-0000-4000-8000-000000000003','333333');
  IF v->>'state' <> 'CONTACT_CONFIRMATION_REQUIRED' THEN RAISE EXCEPTION 'missing contact did not fail closed'; END IF;
  IF NOT public.workspc_account_link_email_matches('30000000-0000-4000-8000-000000000001','111111','MEMBER.ONE@example.test') THEN RAISE EXCEPTION 'contact match failed'; END IF;
  IF public.workspc_account_link_email_matches('30000000-0000-4000-8000-000000000001','111111','wrong@example.test') THEN RAISE EXCEPTION 'wrong contact matched'; END IF;

  PERFORM set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000001',true);
  PERFORM public.claim_workforce_member('30000000-0000-4000-8000-000000000001','111111');
  PERFORM public.claim_workforce_member('30000000-0000-4000-8000-000000000001','111111');
  IF NOT EXISTS (SELECT 1 FROM public.organisation_memberships WHERE auth_user_id='40000000-0000-4000-8000-000000000001' AND workforce_id='30000000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'verified claim missing'; END IF;
  IF EXISTS (SELECT 1 FROM public.organisation_memberships WHERE auth_user_id='40000000-0000-4000-8000-000000000001' AND is_tenant_admin) THEN RAISE EXCEPTION 'link escalated role'; END IF;
  IF EXISTS (SELECT 1 FROM public.verify_resident_login_by_code('20000000-0000-4000-8000-000000000002','111111',null)) THEN RAISE EXCEPTION 'wrong tenant resolved member'; END IF;
  BEGIN
    PERFORM public.workspc_account_link_preflight('30000000-0000-4000-8000-000000000001','999999');
    RAISE EXCEPTION 'wrong member identifier passed';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000002',true);
  BEGIN
    PERFORM public.claim_workforce_member('30000000-0000-4000-8000-000000000002','222222');
    RAISE EXCEPTION 'wrong confirmed email linked';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
  BEGIN
    PERFORM public._workspc_link_authenticated_workforce('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002','SYNTHETIC_TEST');
    RAISE EXCEPTION 'account linked to a second member in tenant';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public._workspc_link_authenticated_workforce('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','SYNTHETIC_TEST');
    RAISE EXCEPTION 'workforce linked to a second account';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  PERFORM set_config('request.jwt.claim.sub','40000000-0000-4000-8000-000000000003',true);
  BEGIN
    PERFORM public.claim_workforce_member('30000000-0000-4000-8000-000000000002','222222');
    RAISE EXCEPTION 'unconfirmed email linked';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;

  v := public.workspc_account_link_prepare_invitation(
    '40000000-0000-4000-8000-000000000004',null,
    '30000000-0000-4000-8000-000000000002',v_token);
  v_inv := (v->>'invitation_id')::uuid;
  IF v->>'state' <> 'PENDING_DELIVERY' THEN RAISE EXCEPTION 'invite not prepared'; END IF;
  PERFORM public.workspc_account_link_begin_invitation_delivery(v_inv);
  v := public.workspc_account_link_finish_invitation_delivery(v_inv,'ACCEPTED','provider-test-id',null);
  IF v->>'state' <> 'SENT' THEN RAISE EXCEPTION 'delivery outcome not durable'; END IF;
  BEGIN
    PERFORM public.workspc_account_link_accept_invitation('40000000-0000-4000-8000-000000000002',v_token);
    RAISE EXCEPTION 'wrong invitation owner accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
  v := public.workspc_account_link_accept_invitation('40000000-0000-4000-8000-000000000006',v_token);
  IF v->>'state' <> 'ACCEPTED' THEN RAISE EXCEPTION 'invite acceptance failed'; END IF;
  v := public.workspc_account_link_accept_invitation('40000000-0000-4000-8000-000000000006',v_token);
  IF v->>'state' <> 'ALREADY_ACCEPTED' THEN RAISE EXCEPTION 'replay not idempotent'; END IF;
  BEGIN
    PERFORM public.workspc_account_link_prepare_invitation('40000000-0000-4000-8000-000000000005',null,'30000000-0000-4000-8000-000000000003',repeat('b',64));
    RAISE EXCEPTION 'cross-tenant admin issued invitation';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

DO $$
DECLARE v jsonb; v_inv uuid;
BEGIN
  v := public.workspc_account_link_prepare_invitation('40000000-0000-4000-8000-000000000005',null,'30000000-0000-4000-8000-000000000004',repeat('c',64));
  v_inv := (v->>'invitation_id')::uuid;
  PERFORM public.workspc_account_link_begin_invitation_delivery(v_inv);
  PERFORM public.workspc_account_link_finish_invitation_delivery(v_inv,'ACCEPTED','provider-expiry-test',null);
  UPDATE public.institutional_account_link_invitations SET expires_at=now()-interval '1 minute' WHERE id=v_inv;
  v := public.workspc_account_link_accept_invitation('40000000-0000-4000-8000-000000000009',repeat('c',64));
  IF v->>'state' <> 'EXPIRED' OR NOT EXISTS(SELECT 1 FROM public.institutional_account_link_events WHERE invitation_id=v_inv AND event_type='INVITATION_EXPIRED') THEN
    RAISE EXCEPTION 'expiry was not durable';
  END IF;
  v := public.workspc_account_link_prepare_invitation('40000000-0000-4000-8000-000000000005',null,'30000000-0000-4000-8000-000000000004',repeat('d',64));
  v_inv := (v->>'invitation_id')::uuid;
  PERFORM public.workspc_account_link_begin_invitation_delivery(v_inv);
  PERFORM public.workspc_account_link_finish_invitation_delivery(v_inv,'ACCEPTED','provider-revoke-test',null);
  v := public.workspc_account_link_revoke_invitation('40000000-0000-4000-8000-000000000005',null,v_inv);
  IF v->>'state' <> 'REVOKED' THEN RAISE EXCEPTION 'revocation failed'; END IF;
  BEGIN
    PERFORM public.workspc_account_link_accept_invitation('40000000-0000-4000-8000-000000000009',repeat('d',64));
    RAISE EXCEPTION 'revoked invitation was accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
END $$;

DO $$ BEGIN
  IF has_table_privilege('anon','public.institutional_identity_contacts','SELECT') THEN RAISE EXCEPTION 'anon contact read granted'; END IF;
  IF has_table_privilege('authenticated','public.institutional_account_link_invitations','SELECT') THEN RAISE EXCEPTION 'authenticated invitation read granted'; END IF;
  IF NOT has_function_privilege('authenticated','public.claim_workforce_member(uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'claim grant missing'; END IF;
  IF has_function_privilege('authenticated','public.workspc_account_link_prepare_invitation(uuid,uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'admin RPC exposed'; END IF;
  IF EXISTS (SELECT 1 FROM public.institutional_identity_contacts WHERE masked_destination LIKE '%member.one%') THEN RAISE EXCEPTION 'masked contact leaked'; END IF;
  IF (SELECT value FROM public.unrelated_sentinel WHERE id=1) <> 'unchanged' THEN RAISE EXCEPTION 'unrelated state changed'; END IF;
  IF (SELECT count(*) FROM public.institutional_account_link_events WHERE event_type='ACCOUNT_LINKED') <> 2 THEN RAISE EXCEPTION 'link audit count wrong'; END IF;
END $$;

SELECT 'INSTITUTIONAL_ACCOUNT_LINKING_REHEARSAL_PASSED' AS result;
