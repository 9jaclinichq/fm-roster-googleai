-- ====================================================================
-- Migration 66: rubric_instances assessor-exclusivity CHECK constraint
-- (closes the known gap named in migration 41's own header and analyzed
-- in full in docs/RUBRIC_ASSESSOR_OWNERSHIP_SPEC.md)
-- ====================================================================
-- PREREQUISITE: migrations 01-65 already applied.
--
-- SCOPE, per docs/RUBRIC_ASSESSOR_OWNERSHIP_SPEC.md's locked decisions
-- (human-approved 2026-08-21): rubric_instances remains a self-assessment-
-- only primitive; any future supervisor/consultant/examiner assessment is a
-- separate external-assessment primitive, not layered onto this table (out
-- of scope here). This migration adds ONLY the smallest safe integrity
-- constraint: a row may never have BOTH assessor_workforce_id AND
-- assessor_doctor_id set at the same time. It deliberately does NOT add
-- exactly-one-of (a row with neither assessor set remains legal — see the
-- spec's "Constraint options" section for why that stronger shape is
-- explicitly deferred, not rejected), does NOT add NOT NULL to either
-- column, does NOT add any subject/external-assessor column, and does NOT
-- touch RLS, the rubric UI, or scoredRubricEngine.ts.
--
-- RLS IMPACT: none. Migration 57's rubric_instances policies already read
--   tenant_id IS NOT NULL OR assessor_workforce_id IS NOT NULL
--     OR (assessor_doctor_id IS NOT NULL AND auth.uid() = assessor_doctor_id)
-- which already assumes the at-most-one-of shape informally (a row with
-- both columns set is treated as institutional-permissive today, same as
-- before this migration). This CHECK constraint does not change what rows
-- are visible to whom; it only prevents a new class of row from being
-- written at all.
--
-- TENANT-SCOPE IMPACT: none. tenant_id is untouched by this constraint;
-- institutional (tenant-scoped) rows are unaffected regardless of which
-- assessor column, if any, they carry.
--
-- LIVE DATA (verified via a scoped, read-only aggregate-count query,
-- documented in docs/RUBRIC_ASSESSOR_OWNERSHIP_SPEC.md's "Live verification
-- results" section -- no row content, IDs, or PII read):
--   total = 5, workforce_only = 5, doctor_only = 0, both_set = 0,
--   neither_set = 0.
-- All 5 existing live rows already satisfy this constraint; no data
-- remediation is required before this migration could be safely applied.
--
-- ROLLBACK: `ALTER TABLE rubric_instances DROP CONSTRAINT
-- rubric_instances_assessor_not_both;` fully reverses this migration with
-- no data loss, since the constraint carries no data of its own.
--
-- VERIFICATION PLAN (to run after applying, disposable data only):
--   1. Confirm the constraint exists:
--        SELECT conname FROM pg_constraint
--        WHERE conname = 'rubric_instances_assessor_not_both';
--   2. Confirm a disposable INSERT with both assessor columns set is
--      rejected, then delete the failed/rolled-back attempt's residue
--      (none expected, since a violating INSERT never commits):
--        INSERT INTO rubric_instances (rubric_template_id, assessor_workforce_id, assessor_doctor_id)
--        VALUES ('<any existing rubric_templates.id>', '<any workforce.id>', '<any doctor_profiles.id>');
--      Expect: constraint violation, no row written.
--   3. Confirm a disposable INSERT with exactly one assessor column set
--      still succeeds (then delete the disposable row):
--        INSERT INTO rubric_instances (rubric_template_id, assessor_workforce_id)
--        VALUES ('<any existing rubric_templates.id>', '<any workforce.id>')
--        RETURNING id; -- then: DELETE FROM rubric_instances WHERE id = '<returned id>';
--
-- NOT APPLIED LIVE. This file exists locally only; separate human approval
-- is required before running it against any live database.
-- ====================================================================

ALTER TABLE rubric_instances
  ADD CONSTRAINT rubric_instances_assessor_not_both
  CHECK (
    NOT (
      assessor_workforce_id IS NOT NULL
      AND assessor_doctor_id IS NOT NULL
    )
  );

-- ====================================================================
-- END OF MIGRATION 66
-- ====================================================================
