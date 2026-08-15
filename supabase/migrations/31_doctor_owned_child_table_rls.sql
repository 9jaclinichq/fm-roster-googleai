-- Migration 31: close the doctor-owned child-table RLS gap migration 25
-- flagged in its own header.
--
-- Migration 25 tightened RLS on research_workspaces/casebook_workspaces so
-- a doctor-owned row (doctor_id IS NOT NULL) requires auth.uid() =
-- doctor_id, while institutional rows (workforce_id IS NOT NULL) keep the
-- existing permissive USING(true)/WITH CHECK(true) — not a real security
-- boundary for institutional data, consistent with every table since
-- migration 01 (see CLAUDE.md's Security Notes). But the actual CONTENT of
-- a doctor's research/casebook work lives in child tables keyed off
-- workspace_id, which stayed fully permissive: a doctor's real research
-- chapters, correction log, or clinical case write-ups were still
-- reachable by anyone holding the anon key via a direct REST call, even
-- though the parent workspace row was protected.
--
-- CORRECTION TO MIGRATION 25'S OWN HEADER: it named 5 child tables as
-- affected (research_chapters, clinical_case_reports, clinical_logbooks,
-- research_correction_logs, admin_logbook_parsing_queue). Re-checked
-- against the live schema and the client code (CasebookWorkspaceView.tsx's
-- own comments) before writing this migration: clinical_logbooks and
-- admin_logbook_parsing_queue are workforce_id-keyed only (no workspace_id
-- FK, no doctor_id column, and the client already hard-gates every write
-- to them behind `owner.kind === 'workforce'`) — a doctor-owned workspace
-- can never produce a row in either table today, so there is nothing to
-- fix there. Only 3 tables actually have a workspace_id path a doctor-owned
-- row can reach: research_chapters, research_correction_logs (both ->
-- research_workspaces), and clinical_case_reports (-> casebook_workspaces).
--
-- DESIGN: same shape as migration 25's parent-table policies, applied
-- through a join instead of a direct column check, since these tables have
-- no doctor_id of their own — only their parent workspace does:
--   institutional (parent.workforce_id IS NOT NULL) -> USING(true), unchanged
--   doctor-owned (parent.doctor_id IS NOT NULL)      -> requires auth.uid() = parent.doctor_id
-- No DELETE policy is added — none of these tables had one before this
-- migration either; this app has no delete flow for research/casebook
-- content anywhere.

DROP POLICY IF EXISTS "research_chapters_select" ON research_chapters;
CREATE POLICY "research_chapters_select" ON research_chapters FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM research_workspaces w
    WHERE w.id = research_chapters.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ));
DROP POLICY IF EXISTS "research_chapters_insert" ON research_chapters;
CREATE POLICY "research_chapters_insert" ON research_chapters FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM research_workspaces w
    WHERE w.id = research_chapters.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ));
DROP POLICY IF EXISTS "research_chapters_update" ON research_chapters;
CREATE POLICY "research_chapters_update" ON research_chapters FOR UPDATE TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM research_workspaces w
    WHERE w.id = research_chapters.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM research_workspaces w
    WHERE w.id = research_chapters.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ));

DROP POLICY IF EXISTS "research_correction_logs_select" ON research_correction_logs;
CREATE POLICY "research_correction_logs_select" ON research_correction_logs FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM research_workspaces w
    WHERE w.id = research_correction_logs.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ));
DROP POLICY IF EXISTS "research_correction_logs_insert" ON research_correction_logs;
CREATE POLICY "research_correction_logs_insert" ON research_correction_logs FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM research_workspaces w
    WHERE w.id = research_correction_logs.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ));
DROP POLICY IF EXISTS "research_correction_logs_update" ON research_correction_logs;
CREATE POLICY "research_correction_logs_update" ON research_correction_logs FOR UPDATE TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM research_workspaces w
    WHERE w.id = research_correction_logs.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM research_workspaces w
    WHERE w.id = research_correction_logs.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ));

DROP POLICY IF EXISTS "clinical_case_reports_select" ON clinical_case_reports;
CREATE POLICY "clinical_case_reports_select" ON clinical_case_reports FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM casebook_workspaces w
    WHERE w.id = clinical_case_reports.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ));
DROP POLICY IF EXISTS "clinical_case_reports_insert" ON clinical_case_reports;
CREATE POLICY "clinical_case_reports_insert" ON clinical_case_reports FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM casebook_workspaces w
    WHERE w.id = clinical_case_reports.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ));
DROP POLICY IF EXISTS "clinical_case_reports_update" ON clinical_case_reports;
CREATE POLICY "clinical_case_reports_update" ON clinical_case_reports FOR UPDATE TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM casebook_workspaces w
    WHERE w.id = clinical_case_reports.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM casebook_workspaces w
    WHERE w.id = clinical_case_reports.workspace_id
      AND (w.workforce_id IS NOT NULL OR (w.doctor_id IS NOT NULL AND auth.uid() = w.doctor_id))
  ));

-- ====================================================================
-- END OF MIGRATION 31
-- ====================================================================
