-- ====================================================================
-- FM Roster - Migration 48: Clinical & Professional Writing module
-- (additive scaffold — referral letters / SOPs / clerking templates)
-- ====================================================================
-- PREREQUISITE: migrations 01-47 already applied.
--
-- WHY: docs/CLINICAL_WRITING_MODULE_SCOPING.md is the governing scoping
-- document for this migration (already reviewed and approved by the
-- product owner). It maps the living-system spec's Clinical & professional
-- writing capability (PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7 row 4 / §8.2)
-- against this app's two existing case-write-up systems
-- (`clinical_case_reports`/`CasebookWorkspaceView.tsx` and `case_reports`/
-- `CasebookBuilderView.tsx`) and against the Dissertation Assistant
-- (settled elsewhere, per ACADEMIC_TRACKS_GENERALIZATION_PROPOSAL.md, as
-- Academic Tracks, not Clinical Writing), and recommends path (b):
-- additive/parallel, covering ONLY the genuinely-missing document types —
-- referral letters, SOPs/protocols, and clerking templates. This migration
-- implements exactly that recommendation, per the scoping doc's §6
-- ("Minimum first slice for (b)").
--
-- SCOPE DECISION — PURELY ADDITIVE, ZERO EXISTING SURFACE TOUCHED. Per the
-- scoping doc's §5 recommendation and this repo's own established
-- precedent (migration 44 Scheduling, migration 45 Meetings, both landed
-- exactly this way in the same wave): `clinical_case_reports`,
-- `case_reports`, `casebook_templates`, `casebook_workspaces`,
-- `CasebookWorkspaceView.tsx`, `CasebookBuilderView.tsx`,
-- `DissertationAssistantView.tsx`, `dissertations`, and
-- `dissertation_milestones` are all completely untouched by this migration
-- and by this entire task — see the scoping doc's §3 for the full
-- reasoning behind keeping case write-ups owned by Casebook & Logbook
-- rather than folding them into this new module. This migration only adds
-- 2 new, independent tables that nothing else reads or writes yet.
--
-- SCHEMA SHAPE — field lists taken verbatim from the scoping doc's §2.2
-- (`clinical_document_types`) and §2.3 (`clinical_documents`), with the
-- first-slice narrowings from §6.1:
--   1. `clinical_document_versions` (§2.4) is explicitly SKIPPED in this
--      first slice — real clinical-governance value for SOPs/protocols
--      specifically, but no equivalent precedent yet built in this app
--      (Forms/Scheduling/Meetings all shipped their first slice without a
--      version-history table either). `clinical_documents.updated_at`
--      (plain overwrite-in-place) covers the first slice; version history
--      is flagged as a real, likely-needed follow-up, not silently
--      dropped.
--   2. `doctor_id` is added as a column on both tables from day one (cheap,
--      avoids a later ALTER TABLE, mirrors `scheduling_instances`'/
--      `meeting_series`' own precedent) but the doctor-owned path has NO
--      real RLS boundary and NO UI in this pass — flagged as explicitly
--      unbuilt, not silently omitted. See the RLS note below.
--   3. `document_kind` (on `clinical_document_types`), `block_kind`
--      (implicitly inside `body_template[]`), and `status` (on
--      `clinical_documents`) all stay free text — no CHECK enum, no lookup
--      table — same reasoning `scheduling_instances.schedule_kind` and
--      `form_pipelines.pipeline_type` already established: avoid
--      CHECK-constraint churn while the real vocabulary beyond the three
--      named seed kinds is still being discovered from usage.
--
-- OWNERSHIP SHAPE for `clinical_document_types` — same 3-shape convention
-- as `form_instances` post-migration-42 (read that migration's own header
-- before touching this one): tenant-owned (institutional), doctor-owned
-- (schema only, not yet functional — see RLS note), or both-NULL global
-- seed/template. CHECK constraint copies migration 42's exact three-way OR
-- verbatim (not the earlier two-way XOR migrations 25/31/40 used before
-- the global shape existed), per this task's explicit instruction.
--
-- RLS — deliberately simple, matching migrations 44/45's own explicit
-- first-slice choice. Per the scoping doc's §6.1 ("doctor_id columns exist
-- from day one on both tables, with no real auth.uid() = doctor_id RLS
-- boundary built yet"), this migration does NOT add an auth.uid()-based
-- branch at all. Both tables get plain `USING (true) WITH CHECK (true)`
-- for `anon, authenticated`, matching every table since migration 01 (see
-- CLAUDE.md's Security Notes) and matching migrations 44/45's own explicit
-- choice not to invent a stricter posture nobody asked for in a first
-- slice. A future pass that actually builds a doctor-scoped personal
-- clinical-writing UI should add the `auth.uid() = doctor_id` branch then,
-- copying migration 25/31/40's actual policy syntax rather than writing
-- new RLS from scratch — same guidance CLAUDE.md's Living-System section
-- already gives for this pattern.
--
-- `clinical_documents.tenant_id`/`doctor_id` are denormalized copies of the
-- parent type's owner columns (per §2.3's own field list, same precedent
-- `form_entries.tenant_id` already set) — cheap filtering without a join.
-- No ownership CHECK constraint on this child table (mirrors how
-- `form_entries` doesn't re-check ownership either) — just plain nullable
-- columns, and no FK-consistency trigger enforcing they match the parent
-- type in this first slice (flagged as a follow-up if that ever becomes a
-- real risk once a heavier write path exists).
--
-- NOT WIRED IN THIS PASS, PER THE SCOPING DOC'S EXPLICIT §6.1 INSTRUCTION:
-- the Scored Rubric primitive (migration 41) — it has zero consuming faces
-- anywhere in this app today, and making this module's first slice the
-- very first real consumer of two unvalidated pieces of schema at once
-- would compound risk for no corresponding near-term need. The attachment
-- point is cheap to add later and requires no schema change when it is: a
-- `rubric_instances` row with `subject_ref = 'clinical_document:<uuid>'`,
-- exactly the convention that column already documents.
--
-- WHERE THIS LIVES: `src/modules/clinical-writing/` (new module folder,
-- confirmed not already taken per the scoping doc's §6.3 folder listing).
--
-- NOT APPLIED LIVE. Per this task's explicit security boundary, this
-- migration is written for review only — a human applies it to the live
-- database afterward. No table was queried or written to produce this
-- file.
-- ====================================================================

-- --------------------------------------------------
-- 1. CLINICAL_DOCUMENT_TYPES — the "builder" output: a named, reusable
--    document type. Field list: scoping doc §2.2.
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS clinical_document_types (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Free text, not a CHECK enum — e.g. 'referral_letter', 'sop_protocol',
  -- 'clerking_template', 'custom' — the real vocabulary is still being
  -- discovered from usage, same reasoning as scheduling_instances.
  -- schedule_kind.
  document_kind text NOT NULL,
  description text,
  -- Ordered content_blocks: a list of {key, label, guidance_text,
  -- placeholder_text, block_kind}. block_kind distinguishes a
  -- heading/section-label from a free-text prose block from a short
  -- single-line field (e.g. a referral letter's "Urgency" might be a
  -- short field, not a paragraph) — a small, closed set interpreted by the
  -- drafting UI, not a foreign key, same free-text-interpreted-by-the-
  -- builder-UI precedent scheduling_instances.row_definitions[].row_kind
  -- already set.
  body_template jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Parity with org_groups/workforce_categories/form_instances' own column.
  is_system_default boolean NOT NULL DEFAULT false,
  created_by_workforce_id uuid REFERENCES workforce(id),
  created_at timestamptz DEFAULT now(),
  CONSTRAINT clinical_document_types_owner_check CHECK (
    (tenant_id IS NOT NULL AND doctor_id IS NULL)
    OR (tenant_id IS NULL AND doctor_id IS NOT NULL)
    OR (tenant_id IS NULL AND doctor_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_clinical_document_types_tenant ON clinical_document_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clinical_document_types_doctor ON clinical_document_types(doctor_id);

ALTER TABLE clinical_document_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinical_document_types_select" ON clinical_document_types;
CREATE POLICY "clinical_document_types_select" ON clinical_document_types FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "clinical_document_types_insert" ON clinical_document_types;
CREATE POLICY "clinical_document_types_insert" ON clinical_document_types FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "clinical_document_types_update" ON clinical_document_types;
CREATE POLICY "clinical_document_types_update" ON clinical_document_types FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 2. CLINICAL_DOCUMENTS — the "data": one row per actually-drafted
--    document. Field list: scoping doc §2.3.
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS clinical_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  document_type_id uuid NOT NULL REFERENCES clinical_document_types(id),
  -- Denormalized from the type, for cheap filtering without a join — same
  -- precedent form_entries.tenant_id / scheduling_entries.tenant_id /
  -- meetings.tenant_id all already set. No ownership CHECK needed on this
  -- child table, mirroring how form_entries doesn't re-check ownership
  -- either.
  tenant_id uuid,
  doctor_id uuid,
  -- Member-supplied, not derived — e.g. "Referral: J. Adewale, 14-Aug" or
  -- "Wound Dressing Change SOP v3".
  title text NOT NULL,
  -- Populated content_blocks, {key: value} shape matching the parent
  -- type's body_template keys.
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Free text (draft / final / signed), not a CHECK enum, consistent with
  -- this migration's other free-text fields and with scheduling_instances.
  -- status/meetings' own lifecycle fields.
  status text NOT NULL DEFAULT 'draft',
  -- Deliberately free text, mirroring rubric_instances.subject_ref's own
  -- documented convention (migration 41) — lets a referral letter or
  -- clerking template optionally reference a clinical_case_reports row or
  -- any other subject without inventing a typed FK to a patient/encounter
  -- concept this app doesn't have.
  subject_ref text,
  created_by_workforce_id uuid REFERENCES workforce(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_clinical_documents_type ON clinical_documents(document_type_id);
CREATE INDEX IF NOT EXISTS idx_clinical_documents_tenant ON clinical_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clinical_documents_doctor ON clinical_documents(doctor_id);
CREATE INDEX IF NOT EXISTS idx_clinical_documents_subject_ref ON clinical_documents(subject_ref);

DROP TRIGGER IF EXISTS update_clinical_documents_updated_at ON clinical_documents;
CREATE TRIGGER update_clinical_documents_updated_at
BEFORE UPDATE ON clinical_documents
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE clinical_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinical_documents_select" ON clinical_documents;
CREATE POLICY "clinical_documents_select" ON clinical_documents FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "clinical_documents_insert" ON clinical_documents;
CREATE POLICY "clinical_documents_insert" ON clinical_documents FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "clinical_documents_update" ON clinical_documents;
CREATE POLICY "clinical_documents_update" ON clinical_documents FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 3. SEED — 3 global clinical_document_types rows (tenant_id IS NULL AND
--    doctor_id IS NULL, is_system_default = true), per the scoping doc's
--    §0/§6.2 three named examples. Idempotency guard mirrors migration
--    46's pattern. No clinical_documents rows are seeded — that table only
--    fills up from real UI use, not seed data.
-- --------------------------------------------------

-- 3a. Referral Letter
INSERT INTO clinical_document_types (tenant_id, doctor_id, name, document_kind, description, body_template, is_system_default)
SELECT
  NULL, NULL,
  'Referral Letter',
  'referral_letter',
  'Generic seed template for referring a patient to another clinician or facility. Available to every '
  || 'organization and individual doctor as a starting point.',
  '[
    {"key": "referring_clinician", "label": "Referring Clinician", "guidance_text": "Name, designation, and contact details of the referring clinician.", "placeholder_text": "Dr. ... , Department of ...", "block_kind": "paragraph"},
    {"key": "receiving_facility", "label": "Receiving Facility", "guidance_text": "Name and department/unit of the facility or clinician the patient is being referred to.", "placeholder_text": "e.g. Department of Cardiology, ...", "block_kind": "paragraph"},
    {"key": "patient_summary", "label": "Patient Summary", "guidance_text": "Patient identifiers relevant to the referral (age, sex, brief context) — avoid identifiers not needed by the receiving clinician.", "placeholder_text": "Age, sex, relevant background...", "block_kind": "paragraph"},
    {"key": "clinical_summary", "label": "Clinical Summary", "guidance_text": "Presenting complaint, relevant history, examination findings, and investigations so far.", "placeholder_text": "Summarize the clinical picture...", "block_kind": "paragraph"},
    {"key": "reason_for_referral", "label": "Reason for Referral", "guidance_text": "What specifically is being asked of the receiving clinician (opinion, management, procedure)?", "placeholder_text": "State the specific request...", "block_kind": "paragraph"},
    {"key": "urgency", "label": "Urgency", "guidance_text": "e.g. Routine / Urgent / Emergency.", "placeholder_text": "Routine / Urgent / Emergency", "block_kind": "short_field"},
    {"key": "requested_action", "label": "Requested Action", "guidance_text": "Any specific action requested of the patient or receiving facility (e.g. appointment booking, investigation).", "placeholder_text": "Describe the requested action...", "block_kind": "paragraph"}
  ]'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM clinical_document_types
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Referral Letter'
);

-- 3b. SOP / Protocol Template
INSERT INTO clinical_document_types (tenant_id, doctor_id, name, document_kind, description, body_template, is_system_default)
SELECT
  NULL, NULL,
  'SOP / Protocol Template',
  'sop_protocol',
  'Generic seed template for a standard operating procedure or clinical protocol. Available to every '
  || 'organization and individual doctor as a starting point.',
  '[
    {"key": "purpose", "label": "Purpose", "guidance_text": "Why this procedure/protocol exists and what it aims to achieve.", "placeholder_text": "State the purpose...", "block_kind": "paragraph"},
    {"key": "scope", "label": "Scope", "guidance_text": "Who and what this SOP applies to (staff cadre, setting, patient population).", "placeholder_text": "Describe the scope...", "block_kind": "paragraph"},
    {"key": "equipment_required", "label": "Equipment Required", "guidance_text": "List all equipment/materials needed to carry out the procedure.", "placeholder_text": "List equipment/materials...", "block_kind": "paragraph"},
    {"key": "step_by_step_procedure", "label": "Step-by-Step Procedure", "guidance_text": "Number each step in the order it should be performed.", "placeholder_text": "1. ...\n2. ...\n3. ...", "block_kind": "paragraph"},
    {"key": "safety_notes", "label": "Safety Notes", "guidance_text": "Warnings, contraindications, and infection-control precautions.", "placeholder_text": "Note any safety considerations...", "block_kind": "paragraph"},
    {"key": "review_date", "label": "Review Date", "guidance_text": "Date this SOP is next due for review.", "placeholder_text": "YYYY-MM-DD", "block_kind": "short_field"}
  ]'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM clinical_document_types
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'SOP / Protocol Template'
);

-- 3c. General Clerking Template
INSERT INTO clinical_document_types (tenant_id, doctor_id, name, document_kind, description, body_template, is_system_default)
SELECT
  NULL, NULL,
  'General Clerking Template',
  'clerking_template',
  'Generic seed template for a general patient clerking. Available to every organization and individual '
  || 'doctor as a starting point.',
  '[
    {"key": "chief_complaint", "label": "Chief Complaint", "guidance_text": "The patient''s presenting complaint(s), in their own words where possible.", "placeholder_text": "Describe the chief complaint...", "block_kind": "paragraph"},
    {"key": "history_by_system", "label": "History by System", "guidance_text": "History of presenting complaint plus a systematic review of relevant systems.", "placeholder_text": "Document the history by system...", "block_kind": "paragraph"},
    {"key": "examination_by_system", "label": "Examination by System", "guidance_text": "Findings on examination, organized by system.", "placeholder_text": "Document examination findings by system...", "block_kind": "paragraph"},
    {"key": "impression", "label": "Impression", "guidance_text": "Working diagnosis or differential diagnoses.", "placeholder_text": "State the impression/differential...", "block_kind": "paragraph"},
    {"key": "plan", "label": "Plan", "guidance_text": "Investigations, management, and follow-up plan.", "placeholder_text": "Describe the management plan...", "block_kind": "paragraph"}
  ]'::jsonb,
  true
WHERE NOT EXISTS (
  SELECT 1 FROM clinical_document_types
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'General Clerking Template'
);

-- ====================================================================
-- END OF MIGRATION 48
-- ====================================================================
