-- ====================================================================
-- FM Roster - Migration 15: Casebook & Clinical Logbook Engine
-- ====================================================================
-- PREREQUISITE: migrations 01-14 already applied.
--
-- SCOPE DECISIONS MADE WHILE WRITING THIS (flagged per CLAUDE.md's
-- no-silent-scope-creep rule):
--
--   1. RENUMBERED 15, NOT 14. The task spec (casebook_logbook.txt) asked
--      for `14_casebook_logbook_engine.sql`, but migration 14 was already
--      claimed by `14_research_ai_action_types.sql` (merged as part of
--      the Universal Research Engine, PR #8). Renumbered to avoid a
--      collision, same reasoning as migration 13's renumbering.
--   2. NO GENERIC "USER" IDENTITY, SAME AS MIGRATION 13. `created_by_user_id`
--      / `uploaded_by_user_id` / `user_id`-or-`workforce_id` columns in the
--      spec all become `created_by_workforce_id` / `uploaded_by_workforce_id`
--      / `workforce_id` here, nullable, referencing `workforce(id)` — this
--      app still has no identity system beyond `workforce` rows (see
--      Role Model in CLAUDE.md). Same rationale as migration 13's header;
--      not repeated in full here.
--   3. `thematic_area` CHECK ADDS `'accident_emergency'`, WHICH THE SPEC'S
--      OWN ENUM LIST OMITTED. Section 2b's seed template text for the
--      WACP PMR 10-case track explicitly requires "1 A&E" case, but
--      section 2d's `thematic_area` enum list has no A&E-shaped value
--      (only `trauma_orthopaedics`, which is a distinct rotation). Folding
--      A&E into `trauma_orthopaedics` would make the PMR template's own
--      seeded distribution silently misrepresent its curriculum. Added
--      `accident_emergency` as a 12th enum value to resolve this
--      inconsistency correctly rather than picking a lossy workaround.
--   4. `admin_logbook_parsing_queue` GETS A `raw_text_content` COLUMN NOT
--      IN THE SPEC'S LITERAL COLUMN LIST. Mirrors `raw_roster_uploads`
--      (migration 10): `file_url` is a Storage reference for audit/
--      re-download, but the actual text that gets sent for AI curriculum
--      extraction is pasted/extracted text, not real server-side PDF/DOCX
--      parsing (this app has no document-parsing backend — see
--      MultiRosterManagerView.tsx's identical ingest-text-alongside-file
--      pattern). Without this column there would be nothing durable to
--      re-run parsing against.
--   5. THIS SITS ALONGSIDE THE EXISTING CASEBOOK BUILDER, NOT REPLACING
--      IT. `case_reports` (migration 04) + `CasebookBuilderView.tsx` +
--      `/resident/casebook` are a simpler, already-live 15-slot MVP.
--      `clinical_case_reports` here is a materially richer clinical
--      write-up model (WACP/PMR rubric fields, family medicine tools,
--      PCCM framework) for a DIFFERENT route (`/resident/casebook-logbook`)
--      and nav tab — an explicit choice made with the user rather than
--      silently colliding two "casebook" concepts or migrating existing
--      resident data. Both remain live and independent.
--   6. RLS IS PERMISSIVE, MATCHING EVERY TABLE SINCE MIGRATION 01 — same
--      client-enforced-only trust model documented throughout this repo.
--
-- WHAT THIS DOES:
--   1. `casebook_templates`: seedable framework/rubric templates (WACP PMR
--      10-case, WACP 15-Casebook, NPMCN 15-Casebook, Generic 10-Case),
--      each with a thematic case-distribution, scoring rubric, and
--      formatting rules.
--   2. `casebook_workspaces`: one candidate's casebook/PMR portfolio per
--      resident, linked to an active template.
--   3. `clinical_case_reports`: one row per case (1-15) per workspace —
--      full clinical write-up (history, examination, PCCM, family tools,
--      management, discussion, references) plus rubric scores and
--      AI-generated defense questions.
--   4. `clinical_logbooks`: per-resident procedure/competency/station
--      tracking with supervisor sign-offs.
--   5. `admin_logbook_parsing_queue`: Chief/Admin-uploaded raw logbook
--      documents queued for AI curriculum extraction into structured
--      station/procedure targets.
-- ====================================================================

-- --------------------------------------------------
-- 1. CASEBOOK TEMPLATES
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS casebook_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  name text NOT NULL,
  framework_type text NOT NULL DEFAULT 'GENERIC_10'
    CHECK (framework_type IN ('WACP_PMR_10', 'WACP_CASEBOOK_15', 'NPMCN_CASEBOOK_15', 'GENERIC_10', 'CUSTOM_CLINICAL')),
  -- e.g. {"maternal_health": 1, "internal_medicine": 2, ...} for a fixed-
  -- distribution track, or {"total_cases": 15, "min_specialties": 10} for
  -- a looser one — shape depends on framework_type, not rigidly typed.
  thematic_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- WACP tracks: {"domains": {"relevance_to_care": 10, ...}} (sums to 100).
  -- PMR track: {"steps": ["interest_in_patient", ...]} (pass/fail checklist,
  -- not point-weighted — see casebookRubric.ts).
  scoring_rubric jsonb NOT NULL DEFAULT '{}'::jsonb,
  formatting_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_casebook_templates_tenant ON casebook_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_casebook_templates_creator ON casebook_templates(created_by_workforce_id);

ALTER TABLE casebook_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "casebook_templates_select" ON casebook_templates;
CREATE POLICY "casebook_templates_select" ON casebook_templates FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "casebook_templates_insert" ON casebook_templates;
CREATE POLICY "casebook_templates_insert" ON casebook_templates FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "casebook_templates_update" ON casebook_templates;
CREATE POLICY "casebook_templates_update" ON casebook_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 2. EXHAUSTIVE SEED TEMPLATES (global, system-seeded)
-- --------------------------------------------------

INSERT INTO casebook_templates (name, framework_type, thematic_distribution, scoring_rubric, formatting_rules)
SELECT * FROM (VALUES
  (
    'WACP Family Medicine PMR 10-Case Track (2022 Curriculum: 1 Maternal, 1 Gynae, 2 Int Med, 2 Child Care, 2 Surgery, 1 Mental Health, 1 A&E)',
    'WACP_PMR_10',
    '{"maternal_health": 1, "gynaecology": 1, "internal_medicine": 2, "child_health": 2, "surgery": 2, "mental_health": 1, "accident_emergency": 1}'::jsonb,
    '{"steps": ["interest_in_patient", "clinical_area", "evidence_used", "family_social_context", "future_illness_impact", "fm_tools_used", "fm_interventions"]}'::jsonb,
    '{"vancouver_references_required": true, "no_figures_starting_sentences": true, "bold_headings": true}'::jsonb
  ),
  (
    'WACP Family Medicine 15-Casebook Track (2017 Curriculum: 15 cases covering 10-12 specialties + 1 Family Case Study)',
    'WACP_CASEBOOK_15',
    '{"total_cases": 15, "min_specialties": 10, "max_specialties": 12, "family_case_study_required": 1}'::jsonb,
    '{"domains": {"relevance_to_care": 10, "diagnostic_accuracy": 15, "cost_considerations": 5, "procedural_skills": 10, "psychosocial_determinants": 10, "pccm_components": 15, "discussion": 15, "references": 10, "formatting": 5, "logical_sequencing": 5}}'::jsonb,
    '{"vancouver_references_required": true, "min_references": 10, "max_reference_age_years": 10, "no_figures_starting_sentences": true, "bold_headings": true}'::jsonb
  ),
  (
    'NPMCN Family Medicine 15-Casebook Track',
    'NPMCN_CASEBOOK_15',
    '{"total_cases": 15, "min_specialties": 10, "max_specialties": 12, "family_case_study_required": 1}'::jsonb,
    '{"domains": {"relevance_to_care": 10, "diagnostic_accuracy": 15, "cost_considerations": 5, "procedural_skills": 10, "psychosocial_determinants": 10, "pccm_components": 15, "discussion": 15, "references": 10, "formatting": 5, "logical_sequencing": 5}}'::jsonb,
    '{"vancouver_references_required": true, "min_references": 10, "max_reference_age_years": 10, "no_figures_starting_sentences": true, "bold_headings": true}'::jsonb
  ),
  (
    'Generic 10-Case Clinical Portfolio',
    'GENERIC_10',
    '{"total_cases": 10}'::jsonb,
    '{"domains": {"relevance_to_care": 10, "diagnostic_accuracy": 20, "procedural_skills": 15, "psychosocial_determinants": 15, "discussion": 20, "references": 10, "formatting": 5, "logical_sequencing": 5}}'::jsonb,
    '{"vancouver_references_required": false, "no_figures_starting_sentences": true, "bold_headings": true}'::jsonb
  )
) AS seed(name, framework_type, thematic_distribution, scoring_rubric, formatting_rules)
WHERE NOT EXISTS (SELECT 1 FROM casebook_templates ct WHERE ct.name = seed.name AND ct.tenant_id IS NULL);

-- --------------------------------------------------
-- 3. CASEBOOK WORKSPACES
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS casebook_workspaces (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  title text NOT NULL,
  framework_type text NOT NULL DEFAULT 'GENERIC_10'
    CHECK (framework_type IN ('WACP_PMR_10', 'WACP_CASEBOOK_15', 'NPMCN_CASEBOOK_15', 'GENERIC_10', 'CUSTOM_CLINICAL')),
  template_id uuid REFERENCES casebook_templates(id) ON DELETE SET NULL,
  candidate_name text,
  exam_date date,
  preliminary_pages jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- e.g. {"min_pages": 80, "max_pages": 120} — PMR: 80-120p; Casebook: 80-140p.
  page_count_target jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'under_review', 'completed')),
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_casebook_workspaces_tenant ON casebook_workspaces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_casebook_workspaces_workforce ON casebook_workspaces(workforce_id);
CREATE INDEX IF NOT EXISTS idx_casebook_workspaces_template ON casebook_workspaces(template_id);

ALTER TABLE casebook_workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "casebook_workspaces_select" ON casebook_workspaces;
CREATE POLICY "casebook_workspaces_select" ON casebook_workspaces FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "casebook_workspaces_insert" ON casebook_workspaces;
CREATE POLICY "casebook_workspaces_insert" ON casebook_workspaces FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "casebook_workspaces_update" ON casebook_workspaces;
CREATE POLICY "casebook_workspaces_update" ON casebook_workspaces FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 4. CLINICAL CASE REPORTS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS clinical_case_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES casebook_workspaces(id) ON DELETE CASCADE,
  case_number integer NOT NULL CHECK (case_number BETWEEN 1 AND 15),
  -- 'accident_emergency' added beyond the task spec's literal enum list —
  -- see this migration's header, point 3.
  thematic_area text NOT NULL DEFAULT 'custom'
    CHECK (thematic_area IN ('maternal_health', 'gynaecology', 'internal_medicine', 'child_health', 'surgery', 'mental_health', 'trauma_orthopaedics', 'accident_emergency', 'ent', 'ophthalmology', 'family_case_study', 'custom')),
  title text,
  -- De-identified only, same convention as case_reports.patient_initials
  -- (migration 04) — never the full patient name.
  patient_initials text,
  hospital_number text,
  age integer,
  gender text,
  point_of_care text,
  presenting_complaints text,
  hpi_text text,
  -- {"ros": "...", "past_med_surg": "...", "gynae_obs": "...", "drug_allergy": "...", "personal": "...", "family_social": "..."}
  history_notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"general": "...", "systems": "...", "local_specialized": "..."}
  examination_notes jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"fife": "...", "common_ground": "...", "whole_person": "...", "health_promotion": "..."}
  pccm_framework jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"nodes": [...], "relationships": [...], "disease_keys": [...]} — see
  -- src/lib/clinical/familyTools.ts for the shape this is built from.
  genogram_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"family_apgar": {...}, "ecomap": {...}, "family_circle": {...}, "duvall_stage": "..."}
  family_tools_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- {"resuscitation": "...", "definitive": "...", "post_op_follow_up": "...", "cost_considerations": "..."}
  management_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  discussion_text text,
  references_text text,
  -- 100-point domain breakdown, shape matches the active template's
  -- scoring_rubric.domains keys — see casebookRubric.ts.
  rubric_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  defense_questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'supervisor_review', 'approved')),
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_case_per_workspace UNIQUE (workspace_id, case_number)
);

CREATE INDEX IF NOT EXISTS idx_clinical_case_reports_workspace ON clinical_case_reports(workspace_id);

DROP TRIGGER IF EXISTS update_clinical_case_reports_updated_at ON clinical_case_reports;
CREATE TRIGGER update_clinical_case_reports_updated_at
BEFORE UPDATE ON clinical_case_reports
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE clinical_case_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinical_case_reports_select" ON clinical_case_reports;
CREATE POLICY "clinical_case_reports_select" ON clinical_case_reports FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "clinical_case_reports_insert" ON clinical_case_reports;
CREATE POLICY "clinical_case_reports_insert" ON clinical_case_reports FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "clinical_case_reports_update" ON clinical_case_reports;
CREATE POLICY "clinical_case_reports_update" ON clinical_case_reports FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 5. CLINICAL LOGBOOKS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS clinical_logbooks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  station_name text NOT NULL,
  procedure_or_competency text NOT NULL,
  required_count integer NOT NULL DEFAULT 1,
  completed_count integer NOT NULL DEFAULT 0,
  -- [{"signed_by_workforce_id": "...", "signed_by_name": "...", "date": "...", "note": "..."}]
  supervisor_signoffs jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_logbook_entry UNIQUE (workforce_id, station_name, procedure_or_competency)
);

CREATE INDEX IF NOT EXISTS idx_clinical_logbooks_tenant ON clinical_logbooks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_clinical_logbooks_workforce ON clinical_logbooks(workforce_id);

DROP TRIGGER IF EXISTS update_clinical_logbooks_updated_at ON clinical_logbooks;
CREATE TRIGGER update_clinical_logbooks_updated_at
BEFORE UPDATE ON clinical_logbooks
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE clinical_logbooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "clinical_logbooks_select" ON clinical_logbooks;
CREATE POLICY "clinical_logbooks_select" ON clinical_logbooks FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "clinical_logbooks_insert" ON clinical_logbooks;
CREATE POLICY "clinical_logbooks_insert" ON clinical_logbooks FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "clinical_logbooks_update" ON clinical_logbooks;
CREATE POLICY "clinical_logbooks_update" ON clinical_logbooks FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 6. ADMIN LOGBOOK PARSING QUEUE
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_logbook_parsing_queue (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  uploaded_by_workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  file_url text,
  -- Not in the task spec's literal column list — see this migration's
  -- header, point 4, for why it's needed alongside file_url.
  raw_text_content text,
  parsed_status text NOT NULL DEFAULT 'pending' CHECK (parsed_status IN ('pending', 'processing', 'completed', 'failed')),
  extracted_curriculum jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_logbook_parsing_queue_tenant ON admin_logbook_parsing_queue(tenant_id);

ALTER TABLE admin_logbook_parsing_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_logbook_parsing_queue_select" ON admin_logbook_parsing_queue;
CREATE POLICY "admin_logbook_parsing_queue_select" ON admin_logbook_parsing_queue FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "admin_logbook_parsing_queue_insert" ON admin_logbook_parsing_queue;
CREATE POLICY "admin_logbook_parsing_queue_insert" ON admin_logbook_parsing_queue FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "admin_logbook_parsing_queue_update" ON admin_logbook_parsing_queue;
CREATE POLICY "admin_logbook_parsing_queue_update" ON admin_logbook_parsing_queue FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ====================================================================
-- END OF MIGRATION 15
-- ====================================================================
