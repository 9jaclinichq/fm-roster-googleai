-- ====================================================================
-- FM Roster - Migration 42: form_instances global-seed ownership shape +
-- generic Forms & pipelines seed templates (living-system §8.2)
-- ====================================================================
-- PREREQUISITE: migrations 01-40 already applied (41 and 43 reserved for
-- sibling agents in this same wave; not depended on here).
--
-- WHY: docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §8.2's "Forms & pipelines"
-- bullet list wants generic seed form templates (leave/absence request,
-- incident/audit report, etc.) available to every tenant out of the box --
-- the same "global template" convention research_templates (migration 13)
-- and casebook_templates (migration 15) already use (tenant_id IS NULL AND
-- created_by_workforce_id IS NULL = system-seeded, available everywhere).
-- form_instances (migration 35) has NO row-shape for this today: migration
-- 40's owner CHECK constraint forces EXACTLY one of tenant_id/doctor_id to
-- be set --
--   CHECK ((tenant_id IS NOT NULL AND doctor_id IS NULL) OR (tenant_id IS
--   NULL AND doctor_id IS NOT NULL))
-- -- verified against the live migration file text before writing this,
-- not assumed. There is no way to insert a both-NULL "global, owned by
-- neither" row, which blocks seeding anything per §8.2 without inventing a
-- fake tenant_id or a fake doctor_id owner. This migration adds that third
-- shape.
--
-- SCOPE DECISIONS MADE WHILE WRITING THIS (flagged per CLAUDE.md's
-- no-silent-scope-creep rule):
--
--   1. CHECK CONSTRAINT gets a third disjunct: (tenant_id IS NULL AND
--      doctor_id IS NULL). Institutional and doctor-owned shapes are
--      completely unchanged -- this is additive, not a loosening of the
--      existing two shapes.
--
--   2. SELECT RLS POLICY needs a matching third clause, or a global row
--      would be invisible to EVERYONE. Migration 40's current SELECT
--      policy is:
--        USING (tenant_id IS NOT NULL OR (doctor_id IS NOT NULL AND
--        auth.uid() = doctor_id))
--      For a both-NULL row, tenant_id IS NOT NULL is false, and doctor_id
--      IS NOT NULL is false, so the whole USING clause evaluates false --
--      the row would exist but nobody could ever SELECT it. Added
--      `OR (tenant_id IS NULL AND doctor_id IS NULL)` so a global row is
--      publicly readable, matching research_templates/casebook_templates'
--      own permissive-for-everyone posture on their global rows.
--
--   3. INSERT/UPDATE RLS: also given the matching third clause, rather
--      than left global-row-proof. Checked research_templates' (migration
--      13) ACTUAL insert/update policies before deciding, per this task's
--      own instruction not to invent a new stricter posture nobody asked
--      for -- they are FOR INSERT ... WITH CHECK (true) and FOR UPDATE ...
--      USING (true) WITH CHECK (true): fully open, no owner-based gate at
--      all, same as nearly every table in this schema (see CLAUDE.md's
--      Security Notes). form_instances' institutional/doctor-owned rows
--      are already effectively-open in practice too (tenant_id IS NOT NULL
--      is unconditionally true for any institutional insert/update; the
--      doctor branch requires auth.uid() = doctor_id, a REAL boundary
--      per migration 40, left completely untouched here). Adding the same
--      `OR (tenant_id IS NULL AND doctor_id IS NULL)` clause to INSERT and
--      UPDATE keeps a global row exactly as writable as research_templates'
--      global rows already are -- consistent with this repo's existing
--      trust model, not a new one. No SECURITY DEFINER gate was invented
--      for this pass.
--
--   4. NEW COLUMN: `is_system_default boolean NOT NULL DEFAULT false`.
--      Checked first -- form_instances had no existing way to distinguish
--      a seeded default row from something a real org/doctor typed in
--      (unlike org_groups/workforce_categories, migrations 36/39, which
--      both already carry this exact column+default for the same reason).
--      Added here for parity with that precedent so the 5 rows seeded
--      below (and any future global seed) are clearly marked, and so a
--      future delete/reset UI (mirroring chief_delete_casebook_template's
--      is_system_default guard, migration 27) has something to key off if
--      that's ever built. Not wired into any RPC/UI in this pass -- purely
--      a data-marking column, matching this task's write-only scope.
--
-- WHAT THIS SEEDS (global rows: tenant_id IS NULL AND doctor_id IS NULL,
-- is_system_default = true), per §8.2's "Forms & pipelines" bullet list
-- verbatim ("Leave/absence request, incident/audit report, feedback form,
-- membership/credential renewal, generic intake/checklist form"):
--   1. Leave / Absence Request
--   2. Incident / Audit Report
--   3. Feedback Form
--   4. Membership / Credential Renewal
--   5. Generic Intake / Checklist Form
--
-- NOT SEEDED, FLAGGED PER THIS TASK'S OWN INSTRUCTION (judgment call, not
-- an oversight): §8.2's "Clinical & professional writing" bullet list also
-- names "referral letter" and "SOP/protocol template". form_instances'
-- schema shape (a flat list of typed data-collection fields -- text/
-- textarea/number/date/boolean/select/file, see FormFieldDefinition in
-- src/types.ts) is a good conceptual fit for the 5 rows above, which are
-- genuinely "fill in these fields and submit" forms. A referral letter or
-- an SOP/protocol document is structurally different -- a long-form
-- document template with a body/sections/placeholders, not a discrete set
-- of typed fields to collect -- and forcing it into form_instances.schema
-- would misrepresent what it actually is (the same reasoning CLAUDE.md's
-- Casebook & Logbook Engine section used to keep clinical_case_reports
-- separate from case_reports rather than overload one shape for two
-- different things). "Clinical & professional writing" has no generic
-- instance table of its own yet -- DissertationAssistantView.tsx/
-- CasebookBuilderView.tsx/CasebookWorkspaceView.tsx are all specific,
-- non-generic features, not a builder+instances model like Forms. These
-- two seeds need that module's own generic document-template table
-- (something closer to a "content_blocks"/sections model) before they can
-- be seeded properly -- out of scope for this migration, flagged rather
-- than forced.
--
-- ALSO OUT OF SCOPE, PER THIS TASK'S EXPLICIT INSTRUCTION -- not touched
-- here, no new schema invented for either: Scheduling (no generic
-- instance table exists; this app's roster features --
-- combined_master_rosters/raw_roster_uploads -- are an admin document-
-- parsing pipeline, not an instance-based module) and Meetings & actions
-- (no Meetings table exists at all). Both need their own module-scoping
-- pass first.
--
-- NOT APPLIED LIVE. Per this task's security boundary, this migration is
-- written for review only -- a human applies it (and the rest of this
-- wave) to the live database afterward.
-- ====================================================================

-- --------------------------------------------------
-- 1. is_system_default column (parity with org_groups/workforce_categories,
--    migrations 36/39)
-- --------------------------------------------------

ALTER TABLE form_instances ADD COLUMN IF NOT EXISTS is_system_default boolean NOT NULL DEFAULT false;

-- --------------------------------------------------
-- 2. Owner CHECK constraint: add the third "global" shape
-- --------------------------------------------------

ALTER TABLE form_instances DROP CONSTRAINT IF EXISTS form_instances_owner_check;
ALTER TABLE form_instances ADD CONSTRAINT form_instances_owner_check CHECK (
  (tenant_id IS NOT NULL AND doctor_id IS NULL)
  OR (tenant_id IS NULL AND doctor_id IS NOT NULL)
  OR (tenant_id IS NULL AND doctor_id IS NULL)
);

-- --------------------------------------------------
-- 3. RLS: extend SELECT/INSERT/UPDATE with the global-row clause. Every
--    other clause here is copied verbatim from migration 40 -- only the
--    added `OR (tenant_id IS NULL AND doctor_id IS NULL)` is new.
-- --------------------------------------------------

DROP POLICY IF EXISTS "form_instances_select" ON form_instances;
CREATE POLICY "form_instances_select" ON form_instances FOR SELECT TO anon, authenticated
  USING (
    tenant_id IS NOT NULL
    OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id)
    OR (tenant_id IS NULL AND doctor_id IS NULL)
  );

DROP POLICY IF EXISTS "form_instances_insert" ON form_instances;
CREATE POLICY "form_instances_insert" ON form_instances FOR INSERT TO anon, authenticated
  WITH CHECK (
    tenant_id IS NOT NULL
    OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id)
    OR (tenant_id IS NULL AND doctor_id IS NULL)
  );

DROP POLICY IF EXISTS "form_instances_update" ON form_instances;
CREATE POLICY "form_instances_update" ON form_instances FOR UPDATE TO anon, authenticated
  USING (
    tenant_id IS NOT NULL
    OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id)
    OR (tenant_id IS NULL AND doctor_id IS NULL)
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id)
    OR (tenant_id IS NULL AND doctor_id IS NULL)
  );

-- --------------------------------------------------
-- 4. SEED -- 5 global generic form templates, one per §8.2 "Forms &
--    pipelines" bullet item. Field shape follows FormFieldDefinition
--    exactly (key/label/type/required/options), same convention migration
--    35's own seed row and FormsBuilderPanel.tsx already use.
-- --------------------------------------------------

-- 4a. Leave / Absence Request
INSERT INTO form_instances (tenant_id, doctor_id, name, description, schema, is_active, is_system_default)
SELECT
  NULL, NULL,
  'Leave / Absence Request',
  'Generic seed template for requesting leave or time away from work. Available to every organization '
  || 'as a starting point -- per PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §8.2''s Forms & pipelines list.',
  '{"fields": [
    {"key": "leave_type", "label": "Leave Type", "type": "select", "required": true, "options": ["Annual", "Sick", "Study", "Compassionate", "Maternity/Paternity", "Other"]},
    {"key": "start_date", "label": "Start Date", "type": "date", "required": true},
    {"key": "end_date", "label": "End Date", "type": "date", "required": true},
    {"key": "reason", "label": "Reason", "type": "textarea", "required": true},
    {"key": "covering_colleague", "label": "Covering Colleague", "type": "text", "required": false},
    {"key": "supporting_document", "label": "Supporting Document", "type": "file", "required": false}
  ]}'::jsonb,
  true, true
WHERE NOT EXISTS (
  SELECT 1 FROM form_instances
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Leave / Absence Request'
);

-- 4b. Incident / Audit Report
INSERT INTO form_instances (tenant_id, doctor_id, name, description, schema, is_active, is_system_default)
SELECT
  NULL, NULL,
  'Incident / Audit Report',
  'Generic seed template for reporting a clinical, safety, or administrative incident, or logging an '
  || 'audit finding. Available to every organization as a starting point.',
  '{"fields": [
    {"key": "incident_date", "label": "Date of Incident", "type": "date", "required": true},
    {"key": "incident_type", "label": "Incident Type", "type": "select", "required": true, "options": ["Clinical", "Administrative", "Safety", "Audit Finding", "Other"]},
    {"key": "severity", "label": "Severity", "type": "select", "required": true, "options": ["Low", "Medium", "High", "Critical"]},
    {"key": "location", "label": "Location", "type": "text", "required": true},
    {"key": "description", "label": "Description", "type": "textarea", "required": true},
    {"key": "immediate_action_taken", "label": "Immediate Action Taken", "type": "textarea", "required": false},
    {"key": "reported_by", "label": "Reported By", "type": "text", "required": false},
    {"key": "supporting_document", "label": "Supporting Document", "type": "file", "required": false}
  ]}'::jsonb,
  true, true
WHERE NOT EXISTS (
  SELECT 1 FROM form_instances
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Incident / Audit Report'
);

-- 4c. Feedback Form
INSERT INTO form_instances (tenant_id, doctor_id, name, description, schema, is_active, is_system_default)
SELECT
  NULL, NULL,
  'Feedback Form',
  'Generic seed template for general feedback, suggestions, or complaints. Available to every '
  || 'organization as a starting point.',
  '{"fields": [
    {"key": "feedback_type", "label": "Feedback Type", "type": "select", "required": true, "options": ["Suggestion", "Complaint", "Compliment", "General"]},
    {"key": "subject", "label": "Subject", "type": "text", "required": true},
    {"key": "details", "label": "Details", "type": "textarea", "required": true},
    {"key": "anonymous", "label": "Submit Anonymously", "type": "boolean", "required": false},
    {"key": "contact_email", "label": "Contact Email (optional)", "type": "text", "required": false}
  ]}'::jsonb,
  true, true
WHERE NOT EXISTS (
  SELECT 1 FROM form_instances
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Feedback Form'
);

-- 4d. Membership / Credential Renewal
INSERT INTO form_instances (tenant_id, doctor_id, name, description, schema, is_active, is_system_default)
SELECT
  NULL, NULL,
  'Membership / Credential Renewal',
  'Generic seed template for tracking renewal of a professional membership, license, or credential. '
  || 'Available to every organization as a starting point.',
  '{"fields": [
    {"key": "credential_type", "label": "Credential Type", "type": "select", "required": true, "options": ["Medical License", "Specialty Certification", "Professional Membership", "Other"]},
    {"key": "credential_number", "label": "Credential / Reference Number", "type": "text", "required": true},
    {"key": "issuing_body", "label": "Issuing Body", "type": "text", "required": false},
    {"key": "expiry_date", "label": "Current Expiry Date", "type": "date", "required": true},
    {"key": "renewal_submitted_date", "label": "Renewal Submitted Date", "type": "date", "required": false},
    {"key": "supporting_document", "label": "Supporting Document", "type": "file", "required": true},
    {"key": "notes", "label": "Notes", "type": "textarea", "required": false}
  ]}'::jsonb,
  true, true
WHERE NOT EXISTS (
  SELECT 1 FROM form_instances
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Membership / Credential Renewal'
);

-- 4e. Generic Intake / Checklist Form
INSERT INTO form_instances (tenant_id, doctor_id, name, description, schema, is_active, is_system_default)
SELECT
  NULL, NULL,
  'Generic Intake / Checklist Form',
  'Generic seed template for any simple intake or checklist need not covered by a more specific form. '
  || 'Available to every organization as a starting point.',
  '{"fields": [
    {"key": "full_name", "label": "Full Name", "type": "text", "required": true},
    {"key": "date", "label": "Date", "type": "date", "required": true},
    {"key": "checklist_items", "label": "Checklist Items / Notes", "type": "textarea", "required": true},
    {"key": "completed_by", "label": "Completed By", "type": "text", "required": false},
    {"key": "all_items_confirmed", "label": "All Items Confirmed", "type": "boolean", "required": false}
  ]}'::jsonb,
  true, true
WHERE NOT EXISTS (
  SELECT 1 FROM form_instances
  WHERE tenant_id IS NULL AND doctor_id IS NULL AND name = 'Generic Intake / Checklist Form'
);

-- ====================================================================
-- END OF MIGRATION 42
-- ====================================================================
