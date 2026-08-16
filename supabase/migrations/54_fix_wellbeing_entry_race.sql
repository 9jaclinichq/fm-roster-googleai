-- ====================================================================
-- FM Roster - Migration 54: fix duplicate-entry race on wellbeing_entries
-- (found via adversarial QA, 2026-08-16)
-- ====================================================================
-- PREREQUISITE: migrations 01-53 already applied.
--
-- ROOT CAUSE: migration 51 created wellbeing_entries with entry_date as the
-- documented "one entry per person per day" natural key (see that
-- migration's own header and wellbeingService.ts's upsertTodaysEntry
-- comment), but never added a UNIQUE constraint enforcing it -- only plain
-- (owner, entry_date) indexes for query performance. upsertTodaysEntry
-- implements the "find or create" logic as a client-side
-- select-then-insert-or-update, same shape as the pre-migration-52
-- submitRoster race: two near-simultaneous saves (double-click Save
-- Check-In, a flaky-network retry) can both pass the "does today's entry
-- exist" check before either write lands, silently creating TWO rows for
-- the same person/day instead of one being rejected. Unlike submissions
-- (which has unique_resident_submission_per_collection and therefore at
-- least throws a loud 23505 on the losing side), this was SILENT -- no
-- error, just a duplicate row, surfacing later as a doubled entry in the
-- 14-day mood trend chart and Recent Entries list.
--
-- Reproduced directly against a disposable test workforce/entry_date pair
-- via two concurrent inserts through the real anon-key client; confirmed
-- two rows landed with no error on either side. Test rows cleaned up.
--
-- FIX: add the missing unique constraints (one per owner kind, since the
-- owner is exactly one of workforce_id/doctor_id per the table's own CHECK
-- constraint) so the database itself rejects the second write, and switch
-- upsertTodaysEntry (src/modules/shared/lib/wellbeingService.ts) to a real
-- atomic .upsert(..., { onConflict }) instead of select-then-branch.
--
-- Plain (non-partial) UNIQUE constraints, not partial unique indexes: a
-- first attempt used `CREATE UNIQUE INDEX ... WHERE workforce_id IS NOT
-- NULL`, but PostgREST's upsert(onConflict) infers a plain arbiter from
-- column names alone -- it cannot supply the partial index's WHERE
-- predicate, so every upsert failed with "no unique or exclusion
-- constraint matching ON CONFLICT" (caught live before this shipped). A
-- plain UNIQUE(workforce_id, entry_date) works instead: Postgres treats
-- NULL as distinct from every other NULL in a unique constraint, so
-- doctor-owned rows (workforce_id always NULL there) never collide with
-- each other on this constraint -- they're separately protected by the
-- doctor_id constraint below, exactly as intended.
-- ====================================================================

ALTER TABLE wellbeing_entries
  ADD CONSTRAINT uniq_wellbeing_entry_workforce_per_day UNIQUE (workforce_id, entry_date);

ALTER TABLE wellbeing_entries
  ADD CONSTRAINT uniq_wellbeing_entry_doctor_per_day UNIQUE (doctor_id, entry_date);

-- ====================================================================
-- END OF MIGRATION 54
-- ====================================================================
