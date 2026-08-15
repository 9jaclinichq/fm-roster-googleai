-- ====================================================================
-- FM Roster - Migration 44: generic Scheduling module (additive scaffold)
-- ====================================================================
-- PREREQUISITE: migrations 01-43 already applied.
--
-- WHY: docs/SCHEDULING_MODULE_SCOPING.md is the governing scoping document
-- for this migration (already reviewed and approved by the product owner).
-- It maps the living-system spec's Scheduling capability
-- (PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7 row 3 / §8.2) against this app's
-- existing UCH-specific, AI-assisted, HITL roster-parsing pipeline
-- (`raw_roster_uploads`/`combined_master_rosters`, migration 10,
-- `MultiRosterManagerView.tsx`, `uchRosterParser.ts`, the `roster-parser`
-- Edge Function) and recommends path (b): additive/parallel. This
-- migration implements exactly that recommendation, per the scoping doc's
-- §5 ("Minimum first slice for (b)").
--
-- SCOPE DECISION — PURELY ADDITIVE, ZERO EXISTING SURFACE TOUCHED. Per the
-- scoping doc's §4 recommendation and this repo's own established
-- precedent (Casebook Builder/Casebook Engine coexisting; the Forms
-- scaffold, migration 35): `raw_roster_uploads`, `combined_master_rosters`,
-- `roster_types`, `MultiRosterManagerView.tsx`, `uchRosterParser.ts`, and
-- the `roster-parser` Edge Function are completely untouched by this
-- migration and by this entire task. UCH's live, monthly, AI-assisted
-- roster-publishing workflow keeps running exactly as it does today. This
-- migration only adds 3 new, independent tables that nothing else reads or
-- writes yet.
--
-- SCHEMA SHAPE — field lists taken verbatim from the scoping doc's
-- §2.1 (`scheduling_instances`), §2.2 (`scheduling_entries`), and §2.3
-- (`scheduling_pipelines`), with the two explicit first-slice narrowings
-- from §5.1:
--   1. `doctor_id` is added as a column on `scheduling_instances` /
--      `scheduling_entries` now (cheap, avoids a later ALTER TABLE, mirrors
--      `research_workspaces`' original nullable-columns-before-the-feature-
--      exists precedent) but the doctor-owned path has NO real RLS
--      boundary and NO UI in this pass — flagged as explicitly unbuilt,
--      not silently omitted. See the RLS note below.
--   2. `row_kind` (on `scheduling_entries`, and implicitly inside
--      `scheduling_instances.row_definitions[]`), `schedule_kind`, and
--      `scheduling_pipelines.pipeline_type` all stay free text — no CHECK
--      enum, no lookup table — same reasoning migration 35 gave for
--      `form_pipelines.pipeline_type`: avoid CHECK-constraint churn while
--      the real vocabulary is still being discovered from usage.
--
-- OWNERSHIP SHAPE for `scheduling_instances` — same 3-shape convention as
-- `form_instances` post-migration-42 (read that migration's own header
-- before touching this one): tenant-owned (institutional), doctor-owned
-- (schema only, not yet functional — see RLS note), or both-NULL global
-- seed/template. CHECK constraint mirrors migration 42's three-way OR
-- verbatim (not the earlier two-way XOR migrations 25/31/40 used before
-- the global shape existed).
--
-- RLS — deliberately simpler than migration 40/42's doctor-aware policies.
-- Per the scoping doc's §5.1 second bullet ("a real auth.uid() = doctor_id
-- boundary on the doctor-owned shape only if and when that path is
-- actually built — mirroring migration 25's real boundary, not invented
-- speculatively here"), this migration does NOT add an auth.uid()-based
-- branch at all. All three tables get plain `USING (true) WITH CHECK
-- (true)` for `anon, authenticated`, matching every table since migration
-- 01 (see CLAUDE.md's Security Notes) and the plain-permissive precedent
-- `form_instances`/`form_entries`/`form_pipelines` themselves used before
-- migration 40 added a real doctor boundary. A future pass that actually
-- builds a doctor-scoped personal-scheduling UI should add the
-- `auth.uid() = doctor_id` branch then, copying migration 25/31/40's actual
-- policy syntax rather than writing new RLS from scratch — same guidance
-- CLAUDE.md's Living-System section already gives for this pattern.
--
-- `scheduling_entries.tenant_id`/`doctor_id` are denormalized copies of the
-- parent instance's owner columns (per §2.2's own field list) — cheap
-- filtering without a join, same precedent `form_entries.tenant_id`
-- already set. No FK-consistency trigger enforcing they match the parent
-- instance in this first slice (nothing writes these tables yet); flagged
-- as a follow-up if that ever becomes a real risk once a write path exists.
--
-- WHERE THIS LIVES: `src/modules/scheduling/` (new module folder — NOT
-- `roster-engine`, which is already taken by the UCH-specific AI-parsing
-- lib per the scoping doc's §5.3 and docs/REGISTRY.md's M11 entry).
--
-- NOT APPLIED LIVE. Per this task's explicit security boundary, this
-- migration is written for review only — a human applies it to the live
-- database afterward. No table was queried or written to produce this
-- file.
-- ====================================================================

-- --------------------------------------------------
-- 1. SCHEDULING_INSTANCES — one named schedule/roster for a period (the
--    "builder" output). Field list: scoping doc §2.1.
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduling_instances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Free text, not a CHECK enum — e.g. 'duty_roster', 'on_call',
  -- 'clinic_session', 'equipment_booking', 'room_booking',
  -- 'branch_coverage' — the real vocabulary is still being discovered.
  schedule_kind text NOT NULL,
  period_start date,
  period_end date,
  -- List of {key, label, row_kind} — row_kind is 'person' / 'resource' /
  -- 'category', a free-text string interpreted by the builder UI, not a
  -- foreign key (scoping doc §5.1).
  row_definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- List of {key, label} — a date, a named shift, a session slot.
  column_definitions jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Instance-specific extras that don't deserve their own column (colour-
  -- coding rules per cadre, closed station/facility name sets, etc.)
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- draft / chief_review / published — reused verbatim from
  -- combined_master_rosters' own proven 3-state HITL lifecycle (migration
  -- 10). Free text here too, not a CHECK enum, consistent with this
  -- migration's other free-text fields.
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  created_by_workforce_id uuid REFERENCES workforce(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduling_instances_owner_check CHECK (
    (tenant_id IS NOT NULL AND doctor_id IS NULL)
    OR (tenant_id IS NULL AND doctor_id IS NOT NULL)
    OR (tenant_id IS NULL AND doctor_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_scheduling_instances_tenant ON scheduling_instances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_instances_doctor ON scheduling_instances(doctor_id);

ALTER TABLE scheduling_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheduling_instances_select" ON scheduling_instances;
CREATE POLICY "scheduling_instances_select" ON scheduling_instances FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "scheduling_instances_insert" ON scheduling_instances;
CREATE POLICY "scheduling_instances_insert" ON scheduling_instances FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "scheduling_instances_update" ON scheduling_instances;
CREATE POLICY "scheduling_instances_update" ON scheduling_instances FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 2. SCHEDULING_ENTRIES — one row per assignment/cell (the "data"). Field
--    list: scoping doc §2.2. This is the crux design decision the scoping
--    doc reasons through explicitly (§2.2): one row per cell, not one big
--    jsonb blob per instance, so the data is actually queryable.
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduling_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id uuid REFERENCES scheduling_instances(id) NOT NULL,
  -- Denormalized from the owning instance, for cheap filtering without a
  -- join — same precedent as form_entries.tenant_id (migration 35/40).
  tenant_id uuid REFERENCES tenants(id),
  doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  -- Matches one row_definitions[].key on the owning instance.
  row_key text NOT NULL,
  -- Matches one column_definitions[].key on the owning instance.
  column_key text NOT NULL,
  -- Denormalized copy of that row's row_kind ('person'/'resource'/
  -- 'category'), for filtering without re-parsing row_definitions jsonb.
  row_kind text,
  -- Who/what is assigned: e.g. {"workforce_ids": ["..."]} for a duty slot,
  -- {"booked_by": "...", "notes": "..."} for a room booking, or free text.
  assignment jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 'manual' | 'ai_parsed' | 'imported' — free text, mirrors the
  -- source/provider badging pattern every AI Copilot panel in this app
  -- already uses. This first slice's UI only ever writes 'manual'.
  source text NOT NULL DEFAULT 'manual',
  -- Carries forward the AI-parser's unparsed_notes concept per-cell instead
  -- of per-grid, so a note can be resolved/cleared independently. Nothing
  -- writes this in this first slice (no AI parsing wired in) — reserved
  -- for a future import/parsing layer per scoping doc §2.4.
  unparsed_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduling_entries_instance ON scheduling_entries(instance_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_entries_tenant ON scheduling_entries(tenant_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_entries_doctor ON scheduling_entries(doctor_id);

ALTER TABLE scheduling_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheduling_entries_select" ON scheduling_entries;
CREATE POLICY "scheduling_entries_select" ON scheduling_entries FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "scheduling_entries_insert" ON scheduling_entries;
CREATE POLICY "scheduling_entries_insert" ON scheduling_entries FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "scheduling_entries_update" ON scheduling_entries;
CREATE POLICY "scheduling_entries_update" ON scheduling_entries FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 3. SCHEDULING_PIPELINES — derived outputs from an instance's existing
--    entries (the "pipelines" concept). Field list: scoping doc §2.3,
--    reused verbatim from form_pipelines' own shape (migration 35). A
--    pipeline is a read/compute over already-entered data, not an import
--    path — see scoping doc §2.4 for why the 5 UCH AI-parsed roster
--    formats are explicitly NOT modeled as pipelines here.
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS scheduling_pipelines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id uuid REFERENCES scheduling_instances(id) NOT NULL,
  -- Free text, not a CHECK-constrained enum — e.g.
  -- 'roster_to_priority_list' (scoping doc §2.3's own worked example,
  -- mapping §8.2's "priority/on-call/supervision list generated as a
  -- pipeline output from a duty roster's data"). Same reasoning as
  -- form_pipelines.pipeline_type: avoid CHECK-constraint churn while the
  -- real set is still being discovered.
  pipeline_type text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduling_pipelines_instance ON scheduling_pipelines(instance_id);

ALTER TABLE scheduling_pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "scheduling_pipelines_select" ON scheduling_pipelines;
CREATE POLICY "scheduling_pipelines_select" ON scheduling_pipelines FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "scheduling_pipelines_insert" ON scheduling_pipelines;
CREATE POLICY "scheduling_pipelines_insert" ON scheduling_pipelines FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "scheduling_pipelines_update" ON scheduling_pipelines;
CREATE POLICY "scheduling_pipelines_update" ON scheduling_pipelines FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- No seed data in this migration — per the task's explicit scope boundary,
-- no real UCH roster data is migrated or seeded here. This is schema +
-- (in application code) a generic manual builder only.

-- ====================================================================
-- END OF MIGRATION 44
-- ====================================================================
