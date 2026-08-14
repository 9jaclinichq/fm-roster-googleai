-- Migration 24: self-serve "create new organization" flow
--
-- Builds on migration 23 (per-tenant Chief admin code) — this could not
-- ship safely before that landed, since a new organization needs its own
-- admin code, not UCH Family Medicine's shared one.
--
-- WHY AN RPC INSTEAD OF A RAW CLIENT INSERT: `tenants` already has
-- permissive client-INSERT RLS (`tenants_insert ... WITH CHECK (true)`,
-- migration 11) — SaaSOperatorConsoleView's existing createTenant() already
-- does a direct `.insert()`. This RPC is not a new security boundary; it
-- exists for atomicity (a tenant row with no matching settings/admin-code
-- row would be an org nobody can administer) and so the plaintext admin
-- code is generated server-side and returned exactly once, never
-- client-visible before that — same write-once-readable posture as
-- chief_add_workforce_member's resident codes (migration 01).
--
-- ABUSE SURFACE, STATED PLAINLY: this is a fully public, unauthenticated
-- RPC — anyone holding the anon key can call it repeatedly to create
-- tenant/settings row pairs. No rate-limiting infrastructure exists in
-- this app (no auth to key a limiter off — see CLAUDE.md Security Notes).
-- Mitigated only by short_code format validation + the existing UNIQUE
-- constraint, plus a client-side honeypot field in the new UI form (out of
-- scope for this migration). Explicitly NOT doing IP throttling, CAPTCHA,
-- or email verification here — flagged as a known gap, not silently solved,
-- consistent with every other "allow all" RLS table in this app.

CREATE OR REPLACE FUNCTION public.create_tenant_with_admin(
  p_name text,
  p_short_code text,
  p_institution text DEFAULT NULL,
  p_department text DEFAULT NULL
)
RETURNS TABLE (tenant_id uuid, tenant_name text, admin_access_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_code text;
BEGIN
  IF trim(p_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  IF p_short_code !~ '^[a-z0-9_]{3,32}$' THEN
    RAISE EXCEPTION 'short_code must be 3-32 lowercase letters, digits, or underscores';
  END IF;

  BEGIN
    INSERT INTO tenants (name, short_code, institution, department, plan_type)
    VALUES (trim(p_name), lower(p_short_code), p_institution, p_department, 'free_seeded')
    RETURNING id INTO v_tenant_id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'That short code is already taken';
  END;

  -- Same collision-checked generation pattern as chief_add_workforce_member
  -- / chief_reset_resident_code — kept here rather than reused via a shared
  -- helper function since none exists yet and this is the only other
  -- call site.
  LOOP
    v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    -- Qualified with the `s` alias: RETURNS TABLE's `admin_access_code`
    -- output column is an implicit PL/pgSQL variable in this function's
    -- scope, and an unqualified reference is ambiguous against it — same
    -- bug class migration 19 fixed for chief_get_workforce_codes/
    -- chief_add_workforce_member.
    EXIT WHEN NOT EXISTS (SELECT 1 FROM settings s WHERE s.admin_access_code = v_code);
  END LOOP;

  INSERT INTO settings (tenant_id, admin_access_code) VALUES (v_tenant_id, v_code);

  RETURN QUERY SELECT v_tenant_id, trim(p_name), v_code;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tenant_with_admin(text, text, text, text) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 24
-- ====================================================================
