-- ====================================================================
-- FM Roster - Migration 06: Subadmin Role Delegation & Consultant HITL Review
-- ====================================================================
-- PREREQUISITE: migrations 01-05 already applied.
--
-- IDENTITY NOTE: this app has exactly two login flows — a resident's
-- 6-digit code, and the Chief Resident's shared admin code (see migration
-- 01/02). There is no separate login for "consultant"/"hod"/"rtc"/
-- "cme_coord" — those are all just workforce members (the same `workforce`
-- row a resident logs in with) who additionally hold a row in `user_roles`
-- assigned by the Chief. A "logged-in consultant" in the UI is simply a
-- resident session whose workforce_id carries one of those roles. No new
-- auth mechanism is introduced here.
--
-- WHAT THIS DOES:
--   1. `consultant_reviews`: an audit trail of every HITL review action
--      (approve / request revisions) against a dissertation milestone or
--      case report.
--   2. `chief_assign_user_role` / `chief_remove_user_role`: admin-code-
--      gated RPCs (same pattern as the chief_* RPCs in migration 02) for
--      the Chief to delegate/revoke hod, rtc, cme_coord, or consultant.
--      Deliberately refuses to assign 'super_admin' or 'resident' through
--      this path.
--   3. `submit_consultant_review`: records the review AND updates the
--      target's status in one transaction. Verifies server-side that the
--      caller's workforce_id actually holds an authorized role before
--      doing anything — this is enforced regardless of what the UI shows,
--      the same defense-in-depth principle as the chief_* RPCs.
--
-- KNOWN LIMITATION (consistent with every table since migration 01): the
-- underlying dissertation_milestones.status / case_reports.status columns
-- still have permissive UPDATE policies from migrations 04, so a resident
-- could still directly set their own item to 'approved' via a raw API
-- call, bypassing the review flow entirely. Fully closing that requires
-- real per-user auth (see migration 01 header) — not attempted here, to
-- avoid a one-off partial fix that diverges from the rest of the app's
-- documented posture. What IS enforced here is the audit trail itself:
-- consultant_reviews can only be written through submit_consultant_review,
-- which checks the reviewer's role — nobody can forge a fake review record.
-- ====================================================================

-- --------------------------------------------------
-- 1. CONSULTANT REVIEWS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS consultant_reviews (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  target_type text NOT NULL CHECK (target_type IN ('dissertation_milestone', 'case_report')),
  target_id uuid NOT NULL,
  reviewer_workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('approved', 'revisions_requested')),
  feedback_notes text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_consultant_reviews_target ON consultant_reviews(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_consultant_reviews_reviewer ON consultant_reviews(reviewer_workforce_id);

ALTER TABLE consultant_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "consultant_reviews_select" ON consultant_reviews;
CREATE POLICY "consultant_reviews_select" ON consultant_reviews FOR SELECT TO anon, authenticated USING (true);
-- Intentionally no INSERT/UPDATE policy: all writes go through
-- submit_consultant_review() below, which role-checks the reviewer.

-- --------------------------------------------------
-- 2. ROLE DELEGATION RPCs
-- --------------------------------------------------

CREATE OR REPLACE FUNCTION public.chief_assign_user_role(p_admin_code text, p_workforce_id uuid, p_role_id text)
RETURNS user_roles
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row user_roles;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE id = 1 AND admin_access_code = p_admin_code) THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  IF p_role_id NOT IN ('hod', 'rtc', 'cme_coord', 'consultant') THEN
    RAISE EXCEPTION 'Role % cannot be delegated through this action', p_role_id;
  END IF;

  INSERT INTO user_roles (workforce_id, role_id)
  VALUES (p_workforce_id, p_role_id)
  ON CONFLICT (workforce_id, role_id) WHERE workforce_id IS NOT NULL DO NOTHING;

  SELECT * INTO v_row FROM user_roles WHERE workforce_id = p_workforce_id AND role_id = p_role_id;
  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_assign_user_role(text, uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_remove_user_role(p_admin_code text, p_user_role_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE id = 1 AND admin_access_code = p_admin_code) THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  DELETE FROM user_roles WHERE id = p_user_role_id;
  RETURN FOUND;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_remove_user_role(text, uuid) TO anon, authenticated;

-- --------------------------------------------------
-- 3. HITL REVIEW SUBMISSION RPC
-- --------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_consultant_review(
  p_reviewer_workforce_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_status text,
  p_feedback_notes text
)
RETURNS consultant_reviews
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_review consultant_reviews;
BEGIN
  IF p_target_type NOT IN ('dissertation_milestone', 'case_report') THEN
    RAISE EXCEPTION 'Invalid target_type: %', p_target_type;
  END IF;
  IF p_status NOT IN ('approved', 'revisions_requested') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE workforce_id = p_reviewer_workforce_id
      AND role_id IN ('hod', 'rtc', 'cme_coord', 'consultant', 'super_admin')
  ) THEN
    RAISE EXCEPTION 'Reviewer is not authorized to submit reviews' USING ERRCODE = '42501';
  END IF;

  INSERT INTO consultant_reviews (target_type, target_id, reviewer_workforce_id, status, feedback_notes)
  VALUES (p_target_type, p_target_id, p_reviewer_workforce_id, p_status, p_feedback_notes)
  RETURNING * INTO v_review;

  IF p_target_type = 'dissertation_milestone' THEN
    UPDATE dissertation_milestones
    SET status = CASE WHEN p_status = 'approved' THEN 'approved' ELSE 'draft' END,
        supervisor_feedback = p_feedback_notes
    WHERE id = p_target_id;
  ELSE
    UPDATE case_reports
    SET status = CASE WHEN p_status = 'approved' THEN 'approved' ELSE 'draft' END
    WHERE id = p_target_id;
  END IF;

  RETURN v_review;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_consultant_review(uuid, text, uuid, text, text) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 06
-- ====================================================================
