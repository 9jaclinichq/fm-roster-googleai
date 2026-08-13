-- Migration 18: individual doctor identity (real Supabase Auth, first in this app)
--
-- Backs the "individual doctor" registration/login track from the landing-page
-- UX review (item 7): a self-service email+password identity for doctors who
-- aren't part of any institution, additive alongside the existing Resident/
-- Chief shared-code flow (which is completely unchanged by this migration).
--
-- WHY REAL AUTH HERE, WHEN NOTHING ELSE IN THIS APP USES IT: self-service
-- signup means the credential is chosen by the user, not admin-issued — a
-- shared/plaintext 6-digit code model doesn't work for that. This is exactly
-- the "future real-auth migration" migration 01's header deferred (it left
-- `auth_user_id uuid REFERENCES auth.users(id)` / `auth.uid()` / `has_role()`
-- as dead scaffolding, explicitly unusable "until that migration happens").
-- It's also exactly what migration 13 (and 17, echoing it) anticipated by
-- leaving `research_workspaces.tenant_id` / `.workforce_id` nullable for "an
-- independent doctor... once that identity system exists" — this migration
-- builds that identity system. Hooking the nullable research/casebook/
-- subscription columns up to actually be usable by a bare doctor_id with no
-- workforce row is explicitly NOT done here — see this migration's own scope
-- note below; today a doctor only gains feature access once a Chief links
-- their account to a `workforce` row.
--
-- SCOPE: doctor_profiles is the FIRST table in this app with a real
-- row-level-security boundary tied to actual user credentials (auth.uid()).
-- Every other table's RLS remains the historical "allow all" posture (see
-- CLAUDE.md Security Notes) — this migration does not change any existing
-- table's policies. workforce.doctor_id is a nullable, additive link; every
-- existing workforce row is unaffected (doctor_id defaults to NULL).
--
-- NOT BUILT (flagged, not silent): standalone feature access for an
-- unlinked doctor (Research Engine / Casebook usable with no workforce row),
-- multi-organization membership UI (schema allows it — doctor_id isn't
-- unique — but the client only reads the most-recently-linked row), password
-- reset / email change flows.

-- --------------------------------------------------
-- 1. DOCTOR PROFILES (1:1 with auth.users)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS doctor_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  full_name text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-provisioned by trigger below rather than a client-side insert after
-- signUp() — sidesteps the timing gap when the Supabase project has "confirm
-- email" enabled (session is null until confirmation, but the auth.users row
-- exists immediately, so this fires regardless of that setting).
CREATE OR REPLACE FUNCTION public.handle_new_doctor_signup()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO doctor_profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_doctor ON auth.users;
CREATE TRIGGER on_auth_user_created_doctor
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_doctor_signup();

ALTER TABLE doctor_profiles ENABLE ROW LEVEL SECURITY;

-- A doctor can read/update only their own profile row. No anon access at
-- all (must hold a real Supabase Auth session), no cross-user SELECT, and
-- deliberately no INSERT policy — rows are only ever created by the
-- SECURITY DEFINER trigger above, never directly by a client insert.
DROP POLICY IF EXISTS "doctor_profiles_select_own" ON doctor_profiles;
CREATE POLICY "doctor_profiles_select_own" ON doctor_profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);

DROP POLICY IF EXISTS "doctor_profiles_update_own" ON doctor_profiles;
CREATE POLICY "doctor_profiles_update_own" ON doctor_profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- --------------------------------------------------
-- 2. WORKFORCE <-> DOCTOR LINK
-- --------------------------------------------------

ALTER TABLE workforce ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE SET NULL;

-- workforce uses an explicit column-privilege allowlist, not a blanket
-- table grant (see migration 02's REVOKE/GRANT lockdown, and migration
-- 10/11's on_floor/tenant_id follow-ups) — every new column needs its own
-- GRANT or it's invisible to anon/authenticated even with RLS satisfied.
-- SELECT only, matching resident_code's write-via-RPC-only pattern: writes
-- happen exclusively through the SECURITY DEFINER RPCs below, which bypass
-- column grants entirely (they run as the function owner), so no direct
-- client UPDATE grant is needed or given.
GRANT SELECT (doctor_id) ON workforce TO anon, authenticated;

-- --------------------------------------------------
-- 3. CHIEF-SIDE LINK/UNLINK RPCs
-- --------------------------------------------------
-- Same admin_access_code re-verification pattern as every other
-- chief-privileged RPC in migration 01 (verify_chief_login and friends) —
-- the Chief session itself is still just a shared code, not a real auth
-- session, so this stays consistent with that model rather than requiring
-- the Chief to also have a Supabase Auth identity.

CREATE OR REPLACE FUNCTION public.chief_link_doctor_by_email(
  p_admin_code text,
  p_workforce_id uuid,
  p_doctor_email text
)
RETURNS TABLE (workforce_id uuid, doctor_id uuid, doctor_full_name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_doctor_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE id = 1 AND admin_access_code = p_admin_code) THEN
    RAISE EXCEPTION 'Invalid admin access code';
  END IF;

  SELECT id INTO v_doctor_id FROM doctor_profiles WHERE email = lower(p_doctor_email);
  IF v_doctor_id IS NULL THEN
    RAISE EXCEPTION 'No registered doctor found with that email';
  END IF;

  UPDATE workforce SET doctor_id = v_doctor_id WHERE id = p_workforce_id;

  RETURN QUERY
    SELECT p_workforce_id, v_doctor_id, dp.full_name
    FROM doctor_profiles dp WHERE dp.id = v_doctor_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chief_link_doctor_by_email(text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_unlink_doctor(
  p_admin_code text,
  p_workforce_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE id = 1 AND admin_access_code = p_admin_code) THEN
    RAISE EXCEPTION 'Invalid admin access code';
  END IF;

  UPDATE workforce SET doctor_id = NULL WHERE id = p_workforce_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chief_unlink_doctor(text, uuid) TO anon, authenticated;
