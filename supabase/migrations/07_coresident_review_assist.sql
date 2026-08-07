-- ====================================================================
-- FM Roster - Migration 07: Co-Resident Review Assist
-- ====================================================================
-- PREREQUISITE: migrations 01-06 already applied.
--
-- Extends submit_consultant_review() so any other active resident (a
-- "co-resident") can assist in reviewing a peer's dissertation milestone
-- or case report — not just hod/rtc/cme_coord/consultant/super_admin.
--
-- DELIBERATE RESTRICTION: a co-resident (i.e. a reviewer who does NOT hold
-- one of the subadmin roles) can only submit 'revisions_requested', never
-- 'approved'. Reason: ExamReadinessView already treats a milestone/case
-- report's status='approved' as satisfying real exam-eligibility
-- requirements (Proposal & Ethics score, 15-Casebook completion count).
-- If any co-resident could grant final approval, residents could get a
-- friend to rubber-stamp their own eligibility. Final approval stays
-- reserved for an actual supervisor/consultant role. Self-review (the
-- resident reviewing their own submission) is blocked for everyone,
-- regardless of role.
--
-- Also adds `reviewer_role` to consultant_reviews so the audit trail
-- distinguishes a peer review from an official consultant/supervisor one.
-- ====================================================================

ALTER TABLE consultant_reviews ADD COLUMN IF NOT EXISTS reviewer_role text;

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
  v_owner_workforce_id uuid;
  v_reviewer_subadmin_role text;
BEGIN
  IF p_target_type NOT IN ('dissertation_milestone', 'case_report') THEN
    RAISE EXCEPTION 'Invalid target_type: %', p_target_type;
  END IF;
  IF p_status NOT IN ('approved', 'revisions_requested') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  IF p_target_type = 'dissertation_milestone' THEN
    SELECT d.workforce_id INTO v_owner_workforce_id
    FROM dissertation_milestones dm
    JOIN dissertations d ON d.id = dm.dissertation_id
    WHERE dm.id = p_target_id;
  ELSE
    SELECT cr.workforce_id INTO v_owner_workforce_id
    FROM case_reports cr
    WHERE cr.id = p_target_id;
  END IF;

  IF v_owner_workforce_id IS NULL THEN
    RAISE EXCEPTION 'Review target not found';
  END IF;

  IF p_reviewer_workforce_id = v_owner_workforce_id THEN
    RAISE EXCEPTION 'You cannot review your own submission' USING ERRCODE = '42501';
  END IF;

  -- Highest-priority subadmin role held by the reviewer, if any.
  SELECT role_id INTO v_reviewer_subadmin_role
  FROM user_roles
  WHERE workforce_id = p_reviewer_workforce_id
    AND role_id IN ('hod', 'rtc', 'cme_coord', 'consultant', 'super_admin')
  LIMIT 1;

  IF v_reviewer_subadmin_role IS NULL THEN
    -- Co-resident peer-assist path: must be a real, active workforce member.
    IF NOT EXISTS (SELECT 1 FROM workforce WHERE id = p_reviewer_workforce_id AND active = true) THEN
      RAISE EXCEPTION 'Reviewer is not a recognized active workforce member' USING ERRCODE = '42501';
    END IF;
    IF p_status = 'approved' THEN
      RAISE EXCEPTION 'Only a supervisor/consultant role can grant final approval — co-residents can request revisions' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO consultant_reviews (target_type, target_id, reviewer_workforce_id, status, feedback_notes, reviewer_role)
  VALUES (p_target_type, p_target_id, p_reviewer_workforce_id, p_status, p_feedback_notes, COALESCE(v_reviewer_subadmin_role, 'resident'))
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
-- END OF MIGRATION 07
-- ====================================================================
