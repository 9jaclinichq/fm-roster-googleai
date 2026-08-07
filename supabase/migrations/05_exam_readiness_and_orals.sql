-- ====================================================================
-- FM Roster - Migration 05: Exam Readiness Scorecard & Mock Viva Orals
-- ====================================================================
-- PREREQUISITE: migrations 01-04 already applied.
--
-- WHAT THIS DOES:
--   1. `exam_readiness`: one row per resident holding the fields that
--      can't be derived from other tables (Evidemy module progress, fee
--      payment, physical logbook sign-off, college forms). The
--      dissertation/casebook/roster pillars of the scorecard are computed
--      client-side from existing tables (dissertations, case_reports,
--      submissions) rather than duplicated here.
--   2. `viva_simulations`: one row per completed mock-viva practice
--      session, with a jsonb scoring breakdown across the four domains
--      (Diagnostic Reasoning, Management, Safety, Communication).
--   3. A trigger that keeps `exam_readiness.oral_practice_score` in sync
--      with the resident's average viva score whenever a new simulation
--      is recorded — mirrors the auto-seeding trigger pattern from
--      migration 04 (dissertation milestones).
--
-- SECURITY POSTURE: same permissive-pending-real-auth pattern as every
-- other table added since migration 01 (see that file's header) — RLS
-- enabled, USING(true) policies. No secrets live in these tables.
-- ====================================================================

-- --------------------------------------------------
-- 1. EXAM READINESS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS exam_readiness (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE NOT NULL,
  evidemy_completed_count integer NOT NULL DEFAULT 0,
  evidemy_total_required integer NOT NULL DEFAULT 0,
  physical_logbook_verified boolean NOT NULL DEFAULT false,
  exam_fees_paid boolean NOT NULL DEFAULT false,
  college_forms_submitted boolean NOT NULL DEFAULT false,
  oral_practice_score numeric(5,2),
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_exam_readiness_per_resident UNIQUE (workforce_id),
  CONSTRAINT evidemy_count_non_negative CHECK (evidemy_completed_count >= 0 AND evidemy_total_required >= 0)
);

DROP TRIGGER IF EXISTS update_exam_readiness_updated_at ON exam_readiness;
CREATE TRIGGER update_exam_readiness_updated_at
BEFORE UPDATE ON exam_readiness
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------
-- 2. VIVA SIMULATIONS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS viva_simulations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE NOT NULL,
  case_title text NOT NULL,
  category text,
  duration_seconds integer,
  -- Expected shape: {"diagnostic_reasoning": 0-100, "management": 0-100,
  -- "safety": 0-100, "communication": 0-100} — self-scored practice, not
  -- an AI or examiner grade (no grading model is wired up in this app).
  scoring_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  feedback_summary text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_viva_simulations_workforce ON viva_simulations(workforce_id);

-- Keep exam_readiness.oral_practice_score as the resident's running average
-- composite score (mean of the four scoring_breakdown domains, averaged
-- again across all their recorded sessions).
CREATE OR REPLACE FUNCTION public.sync_oral_practice_score()
RETURNS TRIGGER AS $$
DECLARE
  v_avg numeric(5,2);
BEGIN
  SELECT avg(
    (
      COALESCE((vs.scoring_breakdown->>'diagnostic_reasoning')::numeric, 0) +
      COALESCE((vs.scoring_breakdown->>'management')::numeric, 0) +
      COALESCE((vs.scoring_breakdown->>'safety')::numeric, 0) +
      COALESCE((vs.scoring_breakdown->>'communication')::numeric, 0)
    ) / 4.0
  ) INTO v_avg
  FROM viva_simulations vs
  WHERE vs.workforce_id = NEW.workforce_id;

  INSERT INTO exam_readiness (workforce_id, oral_practice_score)
  VALUES (NEW.workforce_id, v_avg)
  ON CONFLICT (workforce_id) DO UPDATE SET oral_practice_score = v_avg;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS sync_oral_score_on_viva_insert ON viva_simulations;
CREATE TRIGGER sync_oral_score_on_viva_insert
AFTER INSERT ON viva_simulations
FOR EACH ROW
EXECUTE FUNCTION sync_oral_practice_score();

-- --------------------------------------------------
-- 3. ROW LEVEL SECURITY
-- --------------------------------------------------

ALTER TABLE exam_readiness ENABLE ROW LEVEL SECURITY;
ALTER TABLE viva_simulations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "exam_readiness_select" ON exam_readiness;
CREATE POLICY "exam_readiness_select" ON exam_readiness FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "exam_readiness_insert" ON exam_readiness;
CREATE POLICY "exam_readiness_insert" ON exam_readiness FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "exam_readiness_update" ON exam_readiness;
CREATE POLICY "exam_readiness_update" ON exam_readiness FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "viva_simulations_select" ON viva_simulations;
CREATE POLICY "viva_simulations_select" ON viva_simulations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "viva_simulations_insert" ON viva_simulations;
CREATE POLICY "viva_simulations_insert" ON viva_simulations FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ====================================================================
-- END OF MIGRATION 05
-- ====================================================================
