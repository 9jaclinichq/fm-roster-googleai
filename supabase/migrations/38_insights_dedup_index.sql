-- ====================================================================
-- Migration 38: partial unique index on insights, closing a real
-- duplicate-insert race found while wiring InsightsStrip into the
-- dashboard (2026-08-15).
-- ====================================================================
-- PREREQUISITE: migration 37 (insights table) already applied.
--
-- BUG: submissionChaserAgent.ts's dedup check was a plain
-- "SELECT existing, then decide whether to INSERT" — two near-simultaneous
-- runs (observed in practice: a fast page reload remounting InsightsStrip
-- before the first run's insert was visible to the second run's dedup
-- SELECT) could both pass the dedup check and each insert a row for the
-- same (tenant_id, agent_key, subject_ref), producing exact duplicate
-- insight cards. Confirmed live: 18 rows for 9 actually-pending residents.
--
-- FIX: enforce "at most one non-dismissed insight per subject" at the
-- database level via a partial unique index, and switch the agent's insert
-- to an upsert with `ignoreDuplicates: true` against this same conflict
-- target — the loser of a race becomes a silent no-op instead of a
-- duplicate row, with no application-level retry logic needed.
-- ====================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_insights_dedup_active
  ON insights (tenant_id, agent_key, subject_ref)
  WHERE dismissed_at IS NULL;

-- ====================================================================
-- END OF MIGRATION 38
-- ====================================================================
