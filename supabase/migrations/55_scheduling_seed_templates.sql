-- ====================================================================
-- FM Roster - Migration 55: generic Scheduling seed templates
-- (living-system §8.2, closing a gap found in the 2026-08-17 re-audit)
-- ====================================================================
-- PREREQUISITE: migrations 01-54 already applied.
--
-- WHY: docs/LIVING_SYSTEM_GAP_AUDIT.md's Addendum (2026-08-17) found
-- scheduling_instances (migration 44) has real, working schema+UI, but
-- contains exactly one row, literally named "Wiring verification test" --
-- the actual seed-content task from PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md
-- §8.2's Scheduling bullet list was never completed.
--
-- SCOPE BOUNDARY, taken directly from the spec's own §11 backlog item:
-- "Seed the duty-roster template's configurability (colour coding,
-- per-row rules, month realignment pipeline) from known roster-building
-- rules, without entering any specific month's roster as seed data."
-- Every row below is STRUCTURE ONLY -- row_definitions/column_definitions
-- are both empty arrays (a Chief/individual defines their own actual
-- people/dates when they use the template), and `config` holds only
-- generic, reusable CONFIGURATION (colour-coding-by-row_kind convention,
-- weekday/weekend rule flags, a special-coverage row-kind flag). No real
-- person's name, no real month's dates, no fabricated roster content.
--
-- OWNERSHIP SHAPE: global template rows (tenant_id IS NULL AND doctor_id
-- IS NULL), same convention research_templates/casebook_templates/
-- form_instances (migration 42) already use for a system-seeded row
-- available to every tenant.
--
-- is_system_default COLUMN: scheduling_instances has no way to mark a
-- seeded row today (unlike form_instances, which got this column in
-- migration 42). Added here for parity, same reasoning migration 42 gives
-- for its own is_system_default addition.
--
-- WHAT THIS SEEDS, per §8.2's Scheduling bullet list verbatim:
--   1. Duty Roster (multi-band/cadre grid, colour-coding config, weekday/
--      weekend rule config, special-coverage row-kind)
--   2. Priority / On-Call / Supervision List (flagged pipeline-output,
--      not manual entry -- config.derived_from_pipeline = true)
--   3. Emergency / Urgent-Coverage Roster
--   4. Satellite / Outstation Coverage Roster
--   5. Clinic / Session Allocation Roster (non-emergency)
--
-- Applied live via .tmp-run-migration.cjs immediately after being written.
-- ====================================================================

-- --------------------------------------------------
-- 1. is_system_default column (parity with form_instances, migration 42)
-- --------------------------------------------------

ALTER TABLE scheduling_instances ADD COLUMN IF NOT EXISTS is_system_default boolean NOT NULL DEFAULT false;

-- --------------------------------------------------
-- 2. SEED -- 5 global generic scheduling templates
-- --------------------------------------------------

-- 2a. Duty Roster
INSERT INTO scheduling_instances (tenant_id, doctor_id, name, schedule_kind, row_definitions, column_definitions, config, status, is_system_default)
SELECT
  NULL, NULL,
  'Duty Roster (Template)',
  'duty_roster',
  '[]'::jsonb,
  '[]'::jsonb,
  '{
    "description": "A combined duty roster covering multiple staff bands/cadres on one grid. Colour-code rows by row_kind/cadre, define weekday-vs-weekend/holiday rules per row, and add extra rows for outstation or satellite coverage as needed -- start from this template and define your own rows/columns/dates.",
    "colour_coding_by_row_kind": true,
    "weekday_weekend_rules_supported": true,
    "special_coverage_rows_supported": true,
    "realign_from_prior_period_supported": false
  }'::jsonb,
  'draft', true
WHERE NOT EXISTS (
  SELECT 1 FROM scheduling_instances
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Duty Roster (Template)'
);

-- 2b. Priority / On-Call / Supervision List
INSERT INTO scheduling_instances (tenant_id, doctor_id, name, schedule_kind, row_definitions, column_definitions, config, status, is_system_default)
SELECT
  NULL, NULL,
  'Priority / On-Call / Supervision List (Template)',
  'on_call',
  '[]'::jsonb,
  '[]'::jsonb,
  '{
    "description": "A priority/on-call/supervision list. Per living-system spec section 8.2, this is meant to be generated as a pipeline output from a duty roster''s data rather than entered separately -- use this template as the manual-entry fallback until that pipeline exists, or as the target shape for one.",
    "derived_from_pipeline": true,
    "source_pipeline_type": "roster_to_priority_list"
  }'::jsonb,
  'draft', true
WHERE NOT EXISTS (
  SELECT 1 FROM scheduling_instances
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Priority / On-Call / Supervision List (Template)'
);

-- 2c. Emergency / Urgent-Coverage Roster
INSERT INTO scheduling_instances (tenant_id, doctor_id, name, schedule_kind, row_definitions, column_definitions, config, status, is_system_default)
SELECT
  NULL, NULL,
  'Emergency / Urgent-Coverage Roster (Template)',
  'emergency_coverage',
  '[]'::jsonb,
  '[]'::jsonb,
  '{
    "description": "Emergency or urgent-coverage roster, realignable period to period from a prior period''s pattern.",
    "colour_coding_by_row_kind": true,
    "realign_from_prior_period_supported": true
  }'::jsonb,
  'draft', true
WHERE NOT EXISTS (
  SELECT 1 FROM scheduling_instances
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Emergency / Urgent-Coverage Roster (Template)'
);

-- 2d. Satellite / Outstation Coverage Roster
INSERT INTO scheduling_instances (tenant_id, doctor_id, name, schedule_kind, row_definitions, column_definitions, config, status, is_system_default)
SELECT
  NULL, NULL,
  'Satellite / Outstation Coverage Roster (Template)',
  'satellite_coverage',
  '[]'::jsonb,
  '[]'::jsonb,
  '{
    "description": "Coverage roster for a satellite or outstation site, realignable period to period from a prior period''s pattern.",
    "special_coverage_rows_supported": true,
    "realign_from_prior_period_supported": true
  }'::jsonb,
  'draft', true
WHERE NOT EXISTS (
  SELECT 1 FROM scheduling_instances
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Satellite / Outstation Coverage Roster (Template)'
);

-- 2e. Clinic / Session Allocation Roster (non-emergency)
INSERT INTO scheduling_instances (tenant_id, doctor_id, name, schedule_kind, row_definitions, column_definitions, config, status, is_system_default)
SELECT
  NULL, NULL,
  'Clinic / Session Allocation Roster (Template)',
  'clinic_session',
  '[]'::jsonb,
  '[]'::jsonb,
  '{
    "description": "Non-emergency clinic or session allocation roster -- also usable for a booking/room roster (row_kind: resource).",
    "colour_coding_by_row_kind": true,
    "weekday_weekend_rules_supported": true
  }'::jsonb,
  'draft', true
WHERE NOT EXISTS (
  SELECT 1 FROM scheduling_instances
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Clinic / Session Allocation Roster (Template)'
);

-- ====================================================================
-- END OF MIGRATION 55
-- ====================================================================
