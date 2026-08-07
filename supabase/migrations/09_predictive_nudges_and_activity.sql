-- ====================================================================
-- FM Roster - Migration 09: Predictive Nudges & Activity Graph
-- ====================================================================
-- PREREQUISITE: migrations 01-08 already applied.
--
-- WHAT THIS DOES:
--   1. `resident_activity_logs`: one row per meaningful action a resident
--      takes (roster submission, dissertation milestone touched, case
--      report saved, viva practice completed, announcement read). Rows
--      are populated ENTIRELY by triggers on the underlying tables
--      (submissions, dissertation_milestones, case_reports,
--      viva_simulations, announcement_reads) — there is deliberately NO
--      client INSERT policy on this table, so a resident cannot fabricate
--      their own contribution-graph activity by writing to it directly.
--      This also means the log stays accurate regardless of which UI
--      code path triggered the underlying change, rather than depending
--      on every call site remembering to log activity itself.
--   2. `get_resident_activity_matrix(p_workforce_id)`: returns one row per
--      day for the last 365 days (including zero-activity days) with an
--      activity count, ready for a GitHub-style contribution grid.
--   3. `compliance_nudges`: persisted nudges so a resident's dismissal
--      ("resolved") survives across sessions. The app computes the
--      current set of applicable nudges client-side from live data
--      (dissertation/casebook/exam-readiness state — the same data
--      ExamReadinessView already reads) and reconciles it into this
--      table: upsert nudges that still apply (keeping `resolved` as-is),
--      delete rows whose condition no longer holds.
--
-- SECURITY POSTURE: same permissive-pending-real-auth pattern as every
-- table since migration 01, EXCEPT resident_activity_logs which has no
-- INSERT policy at all (trigger-only, see above — a deliberate departure
-- from the usual pattern because this table's integrity as an activity
-- record actually matters).
-- ====================================================================

-- --------------------------------------------------
-- 1. RESIDENT ACTIVITY LOGS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS resident_activity_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE NOT NULL,
  activity_type text NOT NULL CHECK (activity_type IN (
    'roster_submission', 'dissertation_milestone', 'case_report', 'viva_simulation', 'announcement_read'
  )),
  activity_date date NOT NULL DEFAULT (timezone('utc'::text, now()))::date,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_workforce_date ON resident_activity_logs(workforce_id, activity_date);

ALTER TABLE resident_activity_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "resident_activity_logs_select" ON resident_activity_logs;
CREATE POLICY "resident_activity_logs_select" ON resident_activity_logs FOR SELECT TO anon, authenticated USING (true);
-- Intentionally no INSERT/UPDATE/DELETE policy — only the trigger
-- functions below (SECURITY DEFINER) may write to this table.

-- --------------------------------------------------
-- 2. ACTIVITY-LOGGING TRIGGERS
-- --------------------------------------------------

CREATE OR REPLACE FUNCTION public.log_activity_submission()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO resident_activity_logs (workforce_id, activity_type, metadata)
  VALUES (NEW.workforce_id, 'roster_submission', jsonb_build_object('submission_id', NEW.id));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_log_activity_submission ON submissions;
CREATE TRIGGER trg_log_activity_submission
AFTER INSERT OR UPDATE ON submissions
FOR EACH ROW EXECUTE FUNCTION log_activity_submission();

CREATE OR REPLACE FUNCTION public.log_activity_dissertation_milestone()
RETURNS TRIGGER AS $$
DECLARE
  v_workforce_id uuid;
BEGIN
  SELECT workforce_id INTO v_workforce_id FROM dissertations WHERE id = NEW.dissertation_id;
  IF v_workforce_id IS NOT NULL THEN
    INSERT INTO resident_activity_logs (workforce_id, activity_type, metadata)
    VALUES (v_workforce_id, 'dissertation_milestone', jsonb_build_object('milestone_id', NEW.id, 'stage', NEW.stage, 'status', NEW.status));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_log_activity_dissertation_milestone ON dissertation_milestones;
CREATE TRIGGER trg_log_activity_dissertation_milestone
AFTER INSERT OR UPDATE ON dissertation_milestones
FOR EACH ROW EXECUTE FUNCTION log_activity_dissertation_milestone();

CREATE OR REPLACE FUNCTION public.log_activity_case_report()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO resident_activity_logs (workforce_id, activity_type, metadata)
  VALUES (NEW.workforce_id, 'case_report', jsonb_build_object('case_report_id', NEW.id, 'case_number', NEW.case_number, 'status', NEW.status));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_log_activity_case_report ON case_reports;
CREATE TRIGGER trg_log_activity_case_report
AFTER INSERT OR UPDATE ON case_reports
FOR EACH ROW EXECUTE FUNCTION log_activity_case_report();

CREATE OR REPLACE FUNCTION public.log_activity_viva_simulation()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO resident_activity_logs (workforce_id, activity_type, metadata)
  VALUES (NEW.workforce_id, 'viva_simulation', jsonb_build_object('viva_id', NEW.id, 'case_title', NEW.case_title));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_log_activity_viva_simulation ON viva_simulations;
CREATE TRIGGER trg_log_activity_viva_simulation
AFTER INSERT ON viva_simulations
FOR EACH ROW EXECUTE FUNCTION log_activity_viva_simulation();

CREATE OR REPLACE FUNCTION public.log_activity_announcement_read()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO resident_activity_logs (workforce_id, activity_type, metadata)
  VALUES (NEW.workforce_id, 'announcement_read', jsonb_build_object('announcement_id', NEW.announcement_id));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS trg_log_activity_announcement_read ON announcement_reads;
CREATE TRIGGER trg_log_activity_announcement_read
AFTER INSERT ON announcement_reads
FOR EACH ROW EXECUTE FUNCTION log_activity_announcement_read();

-- --------------------------------------------------
-- 3. ACTIVITY MATRIX FUNCTION (365-day contribution grid)
-- --------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_resident_activity_matrix(p_workforce_id uuid)
RETURNS TABLE(activity_date date, activity_count integer)
LANGUAGE sql STABLE AS $$
  SELECT d::date AS activity_date, COALESCE(a.cnt, 0)::integer AS activity_count
  FROM generate_series((timezone('utc'::text, now()))::date - interval '364 days', (timezone('utc'::text, now()))::date, interval '1 day') AS d
  LEFT JOIN (
    SELECT activity_date, count(*) AS cnt
    FROM resident_activity_logs
    WHERE workforce_id = p_workforce_id
    GROUP BY activity_date
  ) a ON a.activity_date = d::date
  ORDER BY d;
$$;
GRANT EXECUTE ON FUNCTION public.get_resident_activity_matrix(uuid) TO anon, authenticated;

-- --------------------------------------------------
-- 4. COMPLIANCE NUDGES
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS compliance_nudges (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE NOT NULL,
  nudge_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('high', 'medium', 'info')),
  title text NOT NULL,
  action_link text,
  resolved boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_nudge_per_resident UNIQUE (workforce_id, nudge_type)
);

CREATE INDEX IF NOT EXISTS idx_compliance_nudges_workforce ON compliance_nudges(workforce_id);

ALTER TABLE compliance_nudges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "compliance_nudges_select" ON compliance_nudges;
CREATE POLICY "compliance_nudges_select" ON compliance_nudges FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "compliance_nudges_insert" ON compliance_nudges;
CREATE POLICY "compliance_nudges_insert" ON compliance_nudges FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "compliance_nudges_update" ON compliance_nudges;
CREATE POLICY "compliance_nudges_update" ON compliance_nudges FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "compliance_nudges_delete" ON compliance_nudges;
CREATE POLICY "compliance_nudges_delete" ON compliance_nudges FOR DELETE TO anon, authenticated USING (true);

-- ====================================================================
-- END OF MIGRATION 09
-- ====================================================================
