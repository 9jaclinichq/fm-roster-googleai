-- ====================================================================
-- FM Roster - Migration 03: Add 'Admin' announcement category
-- ====================================================================
-- Day 2 (ann_rot.txt) calls for four announcement categories in the UI
-- (#Roster, #Exam, #CME, #Admin), but migration 01 only allowed three.
-- This widens the CHECK constraint to include 'Admin'. Safe to re-run.
-- ====================================================================

ALTER TABLE announcements DROP CONSTRAINT IF EXISTS announcements_category_check;
ALTER TABLE announcements ADD CONSTRAINT announcements_category_check
  CHECK (category IN ('Roster', 'Exam', 'CME', 'Admin'));

-- ====================================================================
-- END OF MIGRATION 03
-- ====================================================================
