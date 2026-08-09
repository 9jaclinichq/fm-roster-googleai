-- ====================================================================
-- FM Roster - Migration 14: Research AI Action Types
-- ====================================================================
-- PREREQUISITE: migrations 01-13 already applied.
--
-- WHY: migration 08 created ai_action_logs with a CHECK constraint
-- restricting action_type to the 4 original academicCopilot actions
-- ('methodology_check', 'vancouver_format', 'mesh_suggest',
-- 'differential_extract'). The new research-copilot Edge Function
-- (supabase/functions/research-copilot) adds 3 more AI-assisted actions
-- for the Universal Research Engine — logging them the same way every
-- other AI action in this app is logged requires widening this
-- constraint first, or every insert would fail with a check violation.
-- Same "widen a bounded CHECK rather than remove it" approach as
-- migration 12's case_reports_case_number_check.
-- ====================================================================

ALTER TABLE ai_action_logs DROP CONSTRAINT IF EXISTS ai_action_logs_action_type_check;
ALTER TABLE ai_action_logs ADD CONSTRAINT ai_action_logs_action_type_check
  CHECK (action_type IN (
    'methodology_check', 'vancouver_format', 'mesh_suggest', 'differential_extract',
    'research_audit', 'literature_matrix', 'table_shells'
  ));

-- ====================================================================
-- END OF MIGRATION 14
-- ====================================================================
