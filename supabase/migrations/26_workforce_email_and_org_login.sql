-- Migration 26: institutional login gets org-selection + registered-email
-- verification; workforce gains an optional email column.
--
-- USER REQUEST (2026-08-14): unify the individual-doctor and institutional
-- login experience — both should feel like "identify yourself, enter a
-- PIN". For the institutional side specifically: pick your organization
-- from a dropdown, pick your name, enter your PIN (existing resident_code),
-- and now also enter your registered email as an anti-guessing check
-- before access is granted. This is independent of, and does not require,
-- migrations 23-25 (per-tenant admin code / self-serve org creation /
-- doctor personal workspaces) — it only touches workforce and
-- verify_resident_login.
--
-- GRACEFUL ROLLOUT, NOT A BREAKING CHANGE: only ONE workforce member has an
-- email seeded as of this migration (see the seed section below) — the
-- other ~30 will be seeded later by the user or the UCH Chief admin, who
-- has the real email list. Making email strictly REQUIRED right now would
-- lock every other current resident out of the live app immediately. So
-- verify_resident_login's email check is a RATCHET: if workforce.email IS
-- NULL, login behaves exactly as it always has (name + PIN only); once an
-- admin seeds a member's email, that member's login starts requiring a
-- matching email from that point on. The email column itself is NOT
-- SELECT-granted to the client (same lockdown posture as resident_code) —
-- the login form always asks for the email regardless of whether the
-- selected member has one seeded yet, so the UI can't be used to enumerate
-- who has a seeded email and who doesn't.
--
-- verify_resident_login's signature changes (2-arg -> 3-arg with a
-- DEFAULT), so the OLD 2-arg overload is explicitly dropped first --
-- otherwise Postgres would keep both overloads live, and a client calling
-- with only {p_workforce_id, p_code} would silently resolve to the old
-- unguarded overload, defeating the whole point of this migration.

ALTER TABLE workforce ADD COLUMN IF NOT EXISTS email text;

-- Prevents the same email being seeded onto two workforce rows (which
-- would make the "does this email match this name+PIN" check ambiguous
-- about who someone actually is).
CREATE UNIQUE INDEX IF NOT EXISTS idx_workforce_email_unique
  ON workforce (lower(email)) WHERE email IS NOT NULL;

-- email is deliberately NOT added to the client SELECT allowlist (compare
-- migration 02's REVOKE/GRANT lockdown of admin_access_code/resident_code)
-- — it's write-only from the client's perspective, read only inside this
-- SECURITY DEFINER RPC.

DROP FUNCTION IF EXISTS public.verify_resident_login(uuid, text);

CREATE OR REPLACE FUNCTION public.verify_resident_login(p_workforce_id uuid, p_code text, p_email text DEFAULT NULL)
RETURNS TABLE(id uuid, full_name text, category text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.full_name, w.category
  FROM workforce w
  WHERE w.id = p_workforce_id
    AND w.resident_code = p_code
    AND w.active = true
    AND (w.email IS NULL OR lower(w.email) = lower(trim(coalesce(p_email, ''))));
$$;
GRANT EXECUTE ON FUNCTION public.verify_resident_login(uuid, text, text) TO anon, authenticated;

-- --------------------------------------------------
-- SEED: the one account requested for this build's verification
-- --------------------------------------------------
-- doc.ola.john@gmail.com <-> "Dr. Olanipekun" (Senior Registrar,
-- 5e3491aa-dfbd-430a-a131-89a5a8e4a704, UCH Family Medicine) — the rest of
-- the current ~31-member workforce is intentionally NOT seeded here; the
-- user will provide the remaining real emails later, or the Chief admin
-- will add them via the Workforce Registry.
UPDATE workforce
SET email = 'doc.ola.john@gmail.com'
WHERE id = '5e3491aa-dfbd-430a-a131-89a5a8e4a704';

-- ====================================================================
-- END OF MIGRATION 26
-- ====================================================================
