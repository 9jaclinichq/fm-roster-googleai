-- ====================================================================
-- FM Roster - Migration 13: Universal Research Engine
-- ====================================================================
-- PREREQUISITE: migrations 01-12 already applied.
--
-- SCOPE DECISIONS MADE WHILE WRITING THIS (flagged per CLAUDE.md's
-- no-silent-scope-creep rule, not left as silent deviations):
--
--   1. NUMBERED 13, NOT 12. The task spec that requested this
--      (research_engine.txt) asked for `12_universal_research_engine.sql`,
--      but migration 12 was already claimed by
--      `12_dynamic_case_target.sql` (uncommitted tenant-customization work
--      in progress at the time this was written). Renumbered to avoid a
--      collision rather than overwrite in-progress work.
--   2. NO `research_templates.created_by_user_id` / `research_workspaces
--      .workforce_id / user_id` AS A GENERIC "USER" COLUMN. The spec's
--      table design implies a unified identity that can be either an
--      institutional resident OR an unaffiliated "independent doctor" —
--      but this app has no such identity system. The only real identity
--      today is a `workforce` row (see CLAUDE.md's Role Model). Rather
--      than invent a fake FK to a users table that doesn't exist, both
--      tables use `created_by_workforce_id` / `workforce_id`, nullable,
--      referencing `workforce(id)`. `tenant_id` is ALSO nullable on
--      `research_workspaces` so the data model doesn't block a future
--      "independent doctor" identity (a workspace with NULL tenant_id and
--      NULL workforce_id would belong to such a user once that identity
--      system exists) — but that identity system, and any UI for it, is
--      NOT built in this migration. Today, every workspace created through
--      the UI is owned by a logged-in resident's workforce_id.
--   3. RLS IS PERMISSIVE, MATCHING EVERY TABLE SINCE MIGRATION 01. Same
--      client-enforced-only trust model documented in CLAUDE.md and
--      migration 11's header — tenant_id/workforce_id filtering happens in
--      databaseService.ts, not at the database layer. Not a real security
--      boundary; flagged, not hidden.
--   4. TEMPLATE FORKING HAS NO DEDICATED RPC. "Fork a template" is just
--      "read one row, insert a new row with is_public=false and
--      created_by_workforce_id set" — ordinary CRUD through the permissive
--      RLS above, done client-side in templateEngine.ts. No server-side
--      logic to protect (no shared secret, no cross-tenant authority
--      check), so no SECURITY DEFINER function is warranted here, unlike
--      e.g. migration 11's guest-review RPCs.
--
-- WHAT THIS DOES:
--   1. `research_templates`: seedable rubric/format templates (WACP,
--      NPMCN, ICMJE, STROBE, CONSORT, PRISMA, CARE, MSc), global
--      (tenant_id/created_by_workforce_id NULL) or forked into a
--      tenant/individual custom copy.
--   2. `research_workspaces`: one research project per resident (or,
--      once built, an independent doctor), linked to an active template.
--   3. `research_chapters`: the 6 structured sections (proposal + 5
--      dissertation chapters) per workspace, with word counts and
--      AI-audit history.
--   4. `research_correction_logs`: tabular tracker mapping
--      assessor/supervisor feedback to actions taken.
-- ====================================================================

-- --------------------------------------------------
-- 1. RESEARCH TEMPLATES
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS research_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- NULL = global template, available to every tenant.
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  -- NULL = system-seeded template. Set = a fork/custom template owned by
  -- whichever resident (or Chief, for a department-wide fork) created it.
  created_by_workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  name text NOT NULL,
  is_public boolean NOT NULL DEFAULT true,
  organization_or_body text NOT NULL DEFAULT 'Custom_Doctor'
    CHECK (organization_or_body IN ('WACP', 'NPMCN', 'ICMJE', 'CONSORT', 'STROBE', 'PRISMA', 'CARE', 'University_Thesis', 'Custom_Doctor')),
  specialty text,
  study_design text
    CHECK (study_design IS NULL OR study_design IN ('cross_sectional', 'cohort', 'case_control', 'clinical_trial', 'qualitative', 'systematic_review', 'case_series')),
  -- {"title_max_words": 25, "sections": {"background": {"weight": 20}, ...}}
  proposal_rubric jsonb NOT NULL DEFAULT '{}'::jsonb,
  dissertation_rubric jsonb NOT NULL DEFAULT '{}'::jsonb,
  referencing_style text NOT NULL DEFAULT 'vancouver' CHECK (referencing_style IN ('vancouver', 'apa7', 'harvard')),
  -- {"proposal_title": 25, "ch1_intro": 1500, "ch2_lit_review": 3000, ...}
  word_count_limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_templates_tenant ON research_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_research_templates_creator ON research_templates(created_by_workforce_id);

DROP TRIGGER IF EXISTS update_research_templates_updated_at ON research_templates;
CREATE TRIGGER update_research_templates_updated_at
BEFORE UPDATE ON research_templates
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE research_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "research_templates_select" ON research_templates;
CREATE POLICY "research_templates_select" ON research_templates FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "research_templates_insert" ON research_templates;
CREATE POLICY "research_templates_insert" ON research_templates FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "research_templates_update" ON research_templates;
CREATE POLICY "research_templates_update" ON research_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 2. EXHAUSTIVE SEED TEMPLATES (global, system-seeded)
-- --------------------------------------------------

INSERT INTO research_templates (name, is_public, organization_or_body, specialty, study_design, referencing_style, proposal_rubric, dissertation_rubric, word_count_limits)
SELECT * FROM (VALUES
  (
    'WACP Family Medicine Proposal (v5.0, May 2025)', true, 'WACP', 'Family Medicine', 'cross_sectional', 'vancouver',
    '{"title_max_words": 25, "min_african_literature_pct": 25, "sections": {"background": 20, "objectives": 10, "methodology": 30, "ethical_considerations": 15, "references": 10, "budget_timeline": 15}}'::jsonb,
    '{}'::jsonb,
    '{"proposal_title": 25, "proposal_total": 3000, "ch1_intro": 1500, "ch2_lit_review": 3500, "ch3_methods": 2500, "ch4_results": 2500, "ch5_discussion": 2500}'::jsonb
  ),
  (
    'WACP Fellowship Dissertation (v4.1, Aug 2022)', true, 'WACP', 'Family Medicine', NULL, 'vancouver',
    '{}'::jsonb,
    '{"title_max_words": 25, "min_african_literature_pct": 25, "sections": {"ch1_intro": 15, "ch2_lit_review": 20, "ch3_methods": 20, "ch4_results": 25, "ch5_discussion": 20}}'::jsonb,
    '{"ch1_intro": 2000, "ch2_lit_review": 4000, "ch3_methods": 3000, "ch4_results": 3000, "ch5_discussion": 3000}'::jsonb
  ),
  (
    'NPMCN Family Medicine Fellowship Proposal & Thesis', true, 'NPMCN', 'Family Medicine', NULL, 'vancouver',
    '{"title_max_words": 25, "min_african_literature_pct": 25, "sections": {"background": 20, "objectives": 10, "methodology": 30, "ethical_considerations": 15, "references": 10, "budget_timeline": 15}}'::jsonb,
    '{"sections": {"ch1_intro": 15, "ch2_lit_review": 20, "ch3_methods": 20, "ch4_results": 25, "ch5_discussion": 20}}'::jsonb,
    '{"proposal_title": 25, "proposal_total": 3000, "ch1_intro": 1800, "ch2_lit_review": 3500, "ch3_methods": 2500, "ch4_results": 2500, "ch5_discussion": 2500}'::jsonb
  ),
  (
    'ICMJE / Vancouver General Medical Manuscript', true, 'ICMJE', NULL, NULL, 'vancouver',
    '{"title_max_words": 20, "sections": {"introduction": 15, "methods": 30, "results": 30, "discussion": 25}}'::jsonb,
    '{}'::jsonb,
    '{"proposal_title": 20, "proposal_total": 4000}'::jsonb
  ),
  (
    'STROBE Cross-Sectional / Observational Study', true, 'STROBE', NULL, 'cross_sectional', 'vancouver',
    '{"title_max_words": 25, "sections": {"title_abstract": 5, "introduction": 15, "methods": 35, "results": 30, "discussion": 15}}'::jsonb,
    '{}'::jsonb,
    '{"proposal_title": 25, "proposal_total": 3000}'::jsonb
  ),
  (
    'CONSORT Randomized Controlled Trial Protocol', true, 'CONSORT', NULL, 'clinical_trial', 'vancouver',
    '{"title_max_words": 25, "sections": {"title_abstract": 5, "introduction": 10, "methods": 40, "results": 30, "discussion": 15}}'::jsonb,
    '{}'::jsonb,
    '{"proposal_title": 25, "proposal_total": 3500}'::jsonb
  ),
  (
    'PRISMA Systematic Review & Meta-Analysis', true, 'PRISMA', NULL, 'systematic_review', 'vancouver',
    '{"title_max_words": 25, "sections": {"title_abstract": 5, "introduction": 10, "methods": 35, "results": 35, "discussion": 15}}'::jsonb,
    '{}'::jsonb,
    '{"proposal_title": 25, "proposal_total": 3500}'::jsonb
  ),
  (
    'CARE Clinical Case Series & Case Report', true, 'CARE', NULL, 'case_series', 'vancouver',
    '{"title_max_words": 20, "sections": {"introduction": 10, "case_presentation": 50, "discussion": 30, "patient_perspective": 10}}'::jsonb,
    '{}'::jsonb,
    '{"proposal_title": 20, "proposal_total": 2000}'::jsonb
  ),
  (
    'Standard MSc / MPH Academic Thesis', true, 'University_Thesis', NULL, NULL, 'apa7',
    '{"title_max_words": 30, "sections": {"background": 15, "objectives": 10, "methodology": 30, "ethical_considerations": 15, "references": 15, "budget_timeline": 15}}'::jsonb,
    '{"sections": {"ch1_intro": 15, "ch2_lit_review": 25, "ch3_methods": 20, "ch4_results": 20, "ch5_discussion": 20}}'::jsonb,
    '{"proposal_title": 30, "proposal_total": 3500, "ch1_intro": 2000, "ch2_lit_review": 5000, "ch3_methods": 3000, "ch4_results": 3000, "ch5_discussion": 3000}'::jsonb
  )
) AS seed(name, is_public, organization_or_body, specialty, study_design, referencing_style, proposal_rubric, dissertation_rubric, word_count_limits)
WHERE NOT EXISTS (SELECT 1 FROM research_templates rt WHERE rt.name = seed.name AND rt.tenant_id IS NULL);

-- --------------------------------------------------
-- 3. RESEARCH WORKSPACES
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS research_workspaces (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Nullable: an independent doctor (not yet a built identity — see header)
  -- would have NULL here. Every workspace created through today's UI has a
  -- real tenant_id since it's always created by a logged-in resident.
  tenant_id uuid REFERENCES tenants(id) ON DELETE SET NULL,
  workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  title text NOT NULL,
  study_design text
    CHECK (study_design IS NULL OR study_design IN ('cross_sectional', 'cohort', 'case_control', 'clinical_trial', 'qualitative', 'systematic_review', 'case_series')),
  template_id uuid REFERENCES research_templates(id) ON DELETE SET NULL,
  pico_framework jsonb NOT NULL DEFAULT '{}'::jsonb,
  target_exam_date date,
  folder_tree jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'proposal_draft'
    CHECK (status IN ('proposal_draft', 'proposal_approved', 'data_collection', 'thesis_writeup', 'completed')),
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_workspaces_tenant ON research_workspaces(tenant_id);
CREATE INDEX IF NOT EXISTS idx_research_workspaces_workforce ON research_workspaces(workforce_id);
CREATE INDEX IF NOT EXISTS idx_research_workspaces_template ON research_workspaces(template_id);

ALTER TABLE research_workspaces ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "research_workspaces_select" ON research_workspaces;
CREATE POLICY "research_workspaces_select" ON research_workspaces FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "research_workspaces_insert" ON research_workspaces;
CREATE POLICY "research_workspaces_insert" ON research_workspaces FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "research_workspaces_update" ON research_workspaces;
CREATE POLICY "research_workspaces_update" ON research_workspaces FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 4. RESEARCH CHAPTERS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS research_chapters (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES research_workspaces(id) ON DELETE CASCADE,
  chapter_type text NOT NULL
    CHECK (chapter_type IN ('proposal', 'ch1_intro', 'ch2_lit_review', 'ch3_methods', 'ch4_results', 'ch5_discussion')),
  chapter_number integer NOT NULL CHECK (chapter_number BETWEEN 0 AND 5),
  title text,
  word_count integer NOT NULL DEFAULT 0,
  content_text text,
  section_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_audit_logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_chapter_per_workspace UNIQUE (workspace_id, chapter_type)
);

CREATE INDEX IF NOT EXISTS idx_research_chapters_workspace ON research_chapters(workspace_id);

DROP TRIGGER IF EXISTS update_research_chapters_updated_at ON research_chapters;
CREATE TRIGGER update_research_chapters_updated_at
BEFORE UPDATE ON research_chapters
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE research_chapters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "research_chapters_select" ON research_chapters;
CREATE POLICY "research_chapters_select" ON research_chapters FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "research_chapters_insert" ON research_chapters;
CREATE POLICY "research_chapters_insert" ON research_chapters FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "research_chapters_update" ON research_chapters;
CREATE POLICY "research_chapters_update" ON research_chapters FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 5. RESEARCH CORRECTION LOGS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS research_correction_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES research_workspaces(id) ON DELETE CASCADE,
  comment_source text NOT NULL
    CHECK (comment_source IN ('college_assessor', 'supervisor_round_1', 'supervisor_round_2', 'peer_reviewer')),
  section_topic text,
  original_comment text NOT NULL,
  action_taken text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'resolved')),
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_research_correction_logs_workspace ON research_correction_logs(workspace_id);

ALTER TABLE research_correction_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "research_correction_logs_select" ON research_correction_logs;
CREATE POLICY "research_correction_logs_select" ON research_correction_logs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "research_correction_logs_insert" ON research_correction_logs;
CREATE POLICY "research_correction_logs_insert" ON research_correction_logs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "research_correction_logs_update" ON research_correction_logs;
CREATE POLICY "research_correction_logs_update" ON research_correction_logs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- ====================================================================
-- END OF MIGRATION 13
-- ====================================================================
