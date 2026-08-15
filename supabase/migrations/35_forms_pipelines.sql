-- ====================================================================
-- FM Roster - Migration 35: Forms module generalization (builder +
-- instances + pipelines scaffold)
-- ====================================================================
-- PREREQUISITE: migrations 01-31 already applied (34 and below reserved
-- for sibling agents in this same wave; not depended on here).
--
-- WHY: per docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7 ("module = a
-- capability, never a single use case; every module ships
-- builder/instances/data/pipelines/agent-hooks") and §10's backlog line
-- ("Forms module currently equals one monthly schedule form; generalise
-- into builder + instances + pipelines, with the current schedule-to-
-- roster flow kept as one pipeline among many"), the Forms module today
-- is ONE hardcoded form (ResidentFormView.tsx writing into `submissions`)
-- with no way for a Chief to define any other form. This migration adds
-- the generic scaffold alongside that live flow.
--
-- SCOPE DECISION — ADDITIVE ONLY, NOT A REPLACEMENT. Per this repo's own
-- precedent (CLAUDE.md's Casebook & Logbook Engine section: "sits
-- alongside the original Casebook Builder, not replacing it"), the
-- existing `submissions`/`collections` monthly-form flow is completely
-- untouched by this migration. `form_instances`/`form_entries`/
-- `form_pipelines` are a NEW, independent capability. The existing
-- schedule-to-roster flow is only DOCUMENTED here (via the seed row
-- below) as "one pipeline among many" — ResidentFormView.tsx is NOT
-- rewired to write into `form_entries`, and no code reads these new
-- tables yet. That rewire is a materially bigger follow-up (touches the
-- live submission path every resident depends on monthly) and is
-- deliberately out of scope for this pass — flagged, not silently
-- skipped.
--
-- SCHEMA SHAPE — kept deliberately minimal, not a full form-builder DSL:
--   1. `form_instances`: one row per defined form (name + a simple
--      field-definition list in `schema` jsonb: label/key/type/required).
--      Tenant-scoped, like every other org-content table since
--      migration 11.
--   2. `form_entries`: one row per submission against an instance, generic
--      `payload` jsonb rather than fixed columns — this is exactly what
--      lets a Chief define an arbitrary form without a schema migration
--      per form.
--   3. `form_pipelines`: what happens to entries once submitted. Free-text
--      `pipeline_type` (not a CHECK-constrained enum) — same reasoning as
--      elsewhere in this migration wave: avoid CHECK-constraint churn
--      while the set of real pipeline types is still being discovered.
--
-- RLS: permissive `USING (true) WITH CHECK (true)` on all three tables,
-- matching every table since migration 01 (see CLAUDE.md's Security
-- Notes) — consistency over introducing a new, inconsistent trust
-- boundary for a first-slice scaffold. No SECURITY DEFINER RPCs; this is
-- the same trust model as `research_templates` (migration 13), not the
-- newer RPC-gated pattern used by `viva_vignettes` (migration 28).
--
-- NOT APPLIED LIVE. Written for review alongside sibling migrations in
-- this wave (32-34, owned by other agents) — a human applies the whole
-- batch together afterward.
-- ====================================================================

-- --------------------------------------------------
-- 1. FORM INSTANCES — a defined form (the "builder" output)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS form_instances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) NOT NULL,
  name text NOT NULL,
  description text,
  -- Minimal field-definition list, e.g.:
  -- {"fields": [{"key": "current_rotation", "label": "Current Rotation", "type": "text", "required": true}]}
  -- Deliberately not a rich form-builder DSL (conditional logic, sections,
  -- validation rules) in this first pass — extend this shape later rather
  -- than redesigning it, since `form_entries.payload` just mirrors
  -- whatever keys are defined here.
  schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_workforce_id uuid REFERENCES workforce(id),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_instances_tenant ON form_instances(tenant_id);

ALTER TABLE form_instances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "form_instances_select" ON form_instances;
CREATE POLICY "form_instances_select" ON form_instances FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "form_instances_insert" ON form_instances;
CREATE POLICY "form_instances_insert" ON form_instances FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "form_instances_update" ON form_instances;
CREATE POLICY "form_instances_update" ON form_instances FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 2. FORM ENTRIES — a submission against an instance (the "data")
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS form_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id uuid REFERENCES form_instances(id) NOT NULL,
  tenant_id uuid REFERENCES tenants(id) NOT NULL,
  submitted_by_workforce_id uuid REFERENCES workforce(id),
  -- Free-form answers keyed by the owning instance's schema.fields[].key.
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text DEFAULT 'submitted',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_entries_instance ON form_entries(instance_id);
CREATE INDEX IF NOT EXISTS idx_form_entries_tenant ON form_entries(tenant_id);

ALTER TABLE form_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "form_entries_select" ON form_entries;
CREATE POLICY "form_entries_select" ON form_entries FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "form_entries_insert" ON form_entries;
CREATE POLICY "form_entries_insert" ON form_entries FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "form_entries_update" ON form_entries;
CREATE POLICY "form_entries_update" ON form_entries FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 3. FORM PIPELINES — what happens to an instance's entries (the
--    "pipelines" concept from §7/§10)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS form_pipelines (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  instance_id uuid REFERENCES form_instances(id) NOT NULL,
  -- Free text, not a CHECK-constrained enum — the seed row below uses
  -- 'schedule_to_roster' (documenting the existing live flow), but the
  -- set of real pipeline types (e.g. notify_on_submit, export_csv,
  -- ai_triage) is still being discovered; avoid CHECK-constraint churn
  -- per this migration's own header.
  pipeline_type text NOT NULL,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_pipelines_instance ON form_pipelines(instance_id);

ALTER TABLE form_pipelines ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "form_pipelines_select" ON form_pipelines;
CREATE POLICY "form_pipelines_select" ON form_pipelines FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "form_pipelines_insert" ON form_pipelines;
CREATE POLICY "form_pipelines_insert" ON form_pipelines FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "form_pipelines_update" ON form_pipelines;
CREATE POLICY "form_pipelines_update" ON form_pipelines FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 4. SEED — document the EXISTING monthly schedule form as one form
--    instance + one pipeline, for the seeded UCH tenant. This is
--    documentation of today's live flow inside the new generic model,
--    NOT a rewire — ResidentFormView.tsx keeps writing to `submissions`
--    exactly as before; nothing reads this seed row yet.
-- --------------------------------------------------

INSERT INTO form_instances (tenant_id, name, description, schema, is_active)
SELECT
  '00000000-0000-0000-0000-000000000001',
  'Monthly Rotation & Leave Schedule Form',
  'The existing live monthly resident submission form (current/next rotation + leave details). '
  || 'Documented here as the first form_instance per the Forms module generalization '
  || '(see PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §10) — the live flow itself still runs entirely '
  || 'through the submissions/collections tables and ResidentFormView.tsx, not through this row.',
  '{"fields": [
    {"key": "current_rotation", "label": "Current Rotation", "type": "text", "required": true},
    {"key": "next_rotation", "label": "Next Rotation", "type": "text", "required": true},
    {"key": "on_leave", "label": "On Leave This Month", "type": "boolean", "required": false},
    {"key": "leave_start_date", "label": "Leave Start Date", "type": "date", "required": false},
    {"key": "leave_end_date", "label": "Leave End Date", "type": "date", "required": false},
    {"key": "leave_documents", "label": "Leave Documents", "type": "file", "required": false}
  ]}'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM form_instances
  WHERE tenant_id = '00000000-0000-0000-0000-000000000001'
    AND name = 'Monthly Rotation & Leave Schedule Form'
);

INSERT INTO form_pipelines (instance_id, pipeline_type, config)
SELECT
  fi.id,
  'schedule_to_roster',
  '{"description": "The live pipeline: a resident submission (submissions table) feeds the monthly roster/compliance views once the collection closes. Implemented entirely outside this scaffold today (ResidentFormView.tsx + databaseService.ts submissions functions) — this row documents it as one pipeline among many, per the Forms module generalization backlog item, without rewiring the live code path."}'::jsonb
FROM form_instances fi
WHERE fi.tenant_id = '00000000-0000-0000-0000-000000000001'
  AND fi.name = 'Monthly Rotation & Leave Schedule Form'
  AND NOT EXISTS (
    SELECT 1 FROM form_pipelines fp
    WHERE fp.instance_id = fi.id AND fp.pipeline_type = 'schedule_to_roster'
  );

-- ====================================================================
-- END OF MIGRATION 35
-- ====================================================================
