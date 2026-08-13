-- Migration 21: close the deactivated-resident access-control bypass in the
-- individual-doctor identity track (migration 18)
--
-- Found by an adversarial correctness audit: code-based Resident login
-- (verify_resident_login, migration 01) correctly requires active = true.
-- The doctor-link path added in migration 18 never carried that check over
-- in either direction:
--   1. chief_link_doctor_by_email would happily link a doctor account to a
--      workforce row a Chief had already deactivated (or a new hire's
--      account to an old, deactivated row being reused).
--   2. getLinkedWorkforceForDoctor (src/lib/databaseService.ts) — the query
--      that converges a doctor's session into a full resident session in
--      src/App.tsx — never re-checked active either, so even a workforce
--      row deactivated AFTER a legitimate link would keep granting full
--      resident access on every subsequent doctor login, forever.
--
-- FIX: (1) chief_link_doctor_by_email now refuses to link an inactive
-- workforce row at all. (2) getLinkedWorkforceForDoctor's active filter is
-- the more important half — it's re-evaluated on every login, so a row
-- deactivated after a legitimate link now correctly stops converging into
-- a resident session immediately, without needing to also revoke the link
-- itself (re-activating the row later resumes access, matching how
-- code-based login already behaves for a reactivated resident).

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

  IF NOT EXISTS (SELECT 1 FROM workforce WHERE id = p_workforce_id AND active = true) THEN
    RAISE EXCEPTION 'Cannot link a doctor account to an inactive workforce member';
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
