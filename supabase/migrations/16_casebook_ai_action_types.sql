-- ====================================================================
-- FM Roster - Migration 16: Casebook AI Action Types
-- ====================================================================
-- PREREQUISITE: migrations 01-15 already applied.
--
-- WHY: same reasoning as migration 14 — the new casebook-copilot Edge
-- Function (supabase/functions/casebook-copilot) adds 3 AI-assisted
-- actions for the Casebook & Clinical Logbook Engine. Widening
-- ai_action_logs.action_type's CHECK constraint again so they're logged
-- the same way as every other AI action in this app.
-- ====================================================================

ALTER TABLE ai_action_logs DROP CONSTRAINT IF EXISTS ai_action_logs_action_type_check;
ALTER TABLE ai_action_logs ADD CONSTRAINT ai_action_logs_action_type_check
  CHECK (action_type IN (
    'methodology_check', 'vancouver_format', 'mesh_suggest', 'differential_extract',
    'research_audit', 'literature_matrix', 'table_shells',
    'casebook_audit', 'defense_questions', 'logbook_parse'
  ));

-- ====================================================================
-- END OF MIGRATION 16
-- ====================================================================
