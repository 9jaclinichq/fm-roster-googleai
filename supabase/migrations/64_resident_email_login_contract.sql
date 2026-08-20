-- ====================================================================
-- Migration 64: resident email login contract + self-service email RPC
-- (Share-Ready Organisation Onboarding Polish — email/login slice)
-- ====================================================================
-- Closes the gap identified during this slice's own DISCOVER: the client
-- (ResidentLoginView.tsx) has an unconditional email requirement that the
-- server-side ratchet in verify_resident_login() never actually needed —
-- a member with no seeded workforce.email should never be blocked from
-- logging in with a valid access PIN. The server-side ratchet itself is
-- UNCHANGED by this migration (still: email absence never blocks login;
-- a seeded email must still match). What changes is that the client can
-- now learn, only after successful authentication, whether it should
-- offer a lightweight post-login email-capture prompt — without the RPC
-- ever returning the stored email value itself.
--
-- Postgres does not allow CREATE OR REPLACE FUNCTION to change a
-- RETURNS TABLE column shape — the old 3-column signature must be
-- explicitly dropped first (same pattern already used this session for
-- platform_operator_create_tenant, migration 62).

DROP FUNCTION IF EXISTS public.verify_resident_login(uuid, text, text);

CREATE OR REPLACE FUNCTION public.verify_resident_login(p_workforce_id uuid, p_code text, p_email text DEFAULT NULL)
RETURNS TABLE(id uuid, full_name text, category text, has_email boolean)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.full_name, w.category, (w.email IS NOT NULL) AS has_email
  FROM workforce w
  WHERE w.id = p_workforce_id
    AND w.resident_code = p_code
    AND w.active = true
    AND (w.email IS NULL OR lower(w.email) = lower(trim(coalesce(p_email, ''))));
$$;
GRANT EXECUTE ON FUNCTION public.verify_resident_login(uuid, text, text) TO anon, authenticated;

-- Self-service email capture for a member whose workforce.email is
-- currently NULL (also usable to change an already-set email, since the
-- access-code reverification below already proves the caller owns this
-- exact workforce row — no separate restriction is added for that case,
-- as none was requested and it would need its own review). Independently
-- reverifies workforce_id + resident_code + active status inline — never
-- trusts that the client already completed a login this session. This is
-- the ONLY write path for workforce.email: no raw column GRANT is
-- introduced (email has never had one — see migration 26's own header),
-- and no generic workforce-update endpoint is added.
CREATE OR REPLACE FUNCTION public.resident_set_email(p_workforce_id uuid, p_code text, p_email text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_normalized_email text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM workforce w
    WHERE w.id = p_workforce_id AND w.resident_code = p_code AND w.active = true
  ) THEN
    RAISE EXCEPTION 'Invalid access code' USING ERRCODE = '28000';
  END IF;

  v_normalized_email := lower(trim(p_email));

  IF v_normalized_email = '' THEN
    RAISE EXCEPTION 'Email is required';
  END IF;

  -- Deterministic basic format check only — no external validation
  -- service, no AI, matching this codebase's existing conventions for
  -- input validation inside SECURITY DEFINER RPCs.
  IF v_normalized_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Enter a valid email address';
  END IF;

  BEGIN
    UPDATE workforce SET email = v_normalized_email WHERE id = p_workforce_id;
  EXCEPTION WHEN unique_violation THEN
    -- idx_workforce_email_unique (migration 26) — preserved, not bypassed.
    RAISE EXCEPTION 'That email is already registered to another member' USING ERRCODE = '23505';
  END;

  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resident_set_email(uuid, text, text) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 64
-- ====================================================================
