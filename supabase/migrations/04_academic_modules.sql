-- ====================================================================
-- FM Roster - Migration 04: Academic Modules
-- (Dissertation Assistant, Knowledge Library, Casebook Builder)
-- ====================================================================
-- PREREQUISITE: migrations 01-03 already applied.
--
-- WHAT THIS DOES:
--   1. `dissertations` + `dissertation_milestones`: tracks each resident's
--      WACP dissertation through a fixed stage pipeline. Inserting a
--      dissertation auto-seeds one milestone row per stage via trigger
--      (see section 2) — that's what "seed default WACP dissertation
--      stages" means here: the canonical stage list is defined once
--      (in the CHECK constraint + WACP_DISSERTATION_STAGES below) and
--      instantiated per-dissertation on creation, not as standalone rows
--      in an empty table.
--   2. `knowledge_packs`: department resource library (guidelines,
--      templates, sample dissertations, past questions).
--   3. `case_reports`: the 15 compulsory case management reports per
--      resident. "15 casebook placeholders" is realized in the UI
--      (CasebookBuilderView computes case_number 1-15 as slots and
--      cross-references existing rows), not as 15 pre-inserted rows per
--      resident — there's no resident-agnostic way to pre-seed per-
--      resident rows, and new residents added later would need the same
--      treatment anyway.
--   4. A new `academic-documents` Storage bucket for milestone/case
--      report file uploads (private-by-convention like leave-documents).
--
-- NOTE ON STAGE NAMES: the exact WACP Family Medicine dissertation stage
-- labels are a departmental/curriculum decision I'm not authoritative on.
-- The list below is a standard postgraduate-dissertation lifecycle
-- (topic -> proposal -> ethics -> data -> analysis -> writing -> review ->
-- defense -> submission) — confirm/rename against the actual WACP
-- curriculum before relying on the exact wording in production.
--
-- SECURITY POSTURE: same as rotations/announcements/file_uploads (RLS
-- enabled, permissive USING(true) policies) — this app still has no real
-- per-user auth, so these tables inherit the same known limitation already
-- documented in CLAUDE.md, not a new one. case_reports holds de-identified
-- patient initials (a standard medical-education de-identification
-- practice) rather than full patient identifiers, but should still move to
-- real per-resident RLS once Supabase Auth is integrated.
-- ====================================================================

-- --------------------------------------------------
-- 1. DISSERTATIONS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS dissertations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  stage text NOT NULL DEFAULT 'Topic Registration' CHECK (stage IN (
    'Topic Registration', 'Proposal Development', 'Ethical Clearance',
    'Data Collection', 'Data Analysis', 'Draft Writing',
    'Supervisor Review', 'Internal Defense', 'Final Submission'
  )),
  supervisor_name text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_dissertation_per_resident UNIQUE (workforce_id)
);

DROP TRIGGER IF EXISTS update_dissertations_updated_at ON dissertations;
CREATE TRIGGER update_dissertations_updated_at
BEFORE UPDATE ON dissertations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------
-- 2. DISSERTATION MILESTONES (one row per stage per dissertation)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS dissertation_milestones (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  dissertation_id uuid REFERENCES dissertations(id) ON DELETE CASCADE NOT NULL,
  stage text NOT NULL CHECK (stage IN (
    'Topic Registration', 'Proposal Development', 'Ethical Clearance',
    'Data Collection', 'Data Analysis', 'Draft Writing',
    'Supervisor Review', 'Internal Defense', 'Final Submission'
  )),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'approved')),
  document_url text,
  supervisor_feedback text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_stage_per_dissertation UNIQUE (dissertation_id, stage)
);

DROP TRIGGER IF EXISTS update_dissertation_milestones_updated_at ON dissertation_milestones;
CREATE TRIGGER update_dissertation_milestones_updated_at
BEFORE UPDATE ON dissertation_milestones
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- Auto-seed one milestone per WACP stage whenever a dissertation is created.
CREATE OR REPLACE FUNCTION public.seed_dissertation_milestones()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO dissertation_milestones (dissertation_id, stage, status)
  SELECT NEW.id, stage_name, 'draft'
  FROM unnest(ARRAY[
    'Topic Registration', 'Proposal Development', 'Ethical Clearance',
    'Data Collection', 'Data Analysis', 'Draft Writing',
    'Supervisor Review', 'Internal Defense', 'Final Submission'
  ]) AS stage_name
  ON CONFLICT (dissertation_id, stage) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS seed_milestones_on_dissertation_insert ON dissertations;
CREATE TRIGGER seed_milestones_on_dissertation_insert
AFTER INSERT ON dissertations
FOR EACH ROW
EXECUTE FUNCTION seed_dissertation_milestones();

-- --------------------------------------------------
-- 3. KNOWLEDGE PACKS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS knowledge_packs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL CHECK (category IN ('guidelines', 'templates', 'sample_dissertation', 'past_questions')),
  file_url text NOT NULL,
  description text,
  tags text[] DEFAULT '{}'::text[] NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_packs_category ON knowledge_packs(category);

-- --------------------------------------------------
-- 4. CASE REPORTS (15 compulsory case management reports per resident)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS case_reports (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE NOT NULL,
  case_number integer NOT NULL CHECK (case_number BETWEEN 1 AND 15),
  patient_initials text,
  diagnosis text,
  category text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_supervisor', 'approved')),
  document_url text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_case_number_per_resident UNIQUE (workforce_id, case_number)
);

DROP TRIGGER IF EXISTS update_case_reports_updated_at ON case_reports;
CREATE TRIGGER update_case_reports_updated_at
BEFORE UPDATE ON case_reports
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_case_reports_workforce ON case_reports(workforce_id);

-- --------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- --------------------------------------------------

ALTER TABLE dissertations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dissertation_milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "dissertations_select" ON dissertations;
CREATE POLICY "dissertations_select" ON dissertations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "dissertations_insert" ON dissertations;
CREATE POLICY "dissertations_insert" ON dissertations FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "dissertations_update" ON dissertations;
CREATE POLICY "dissertations_update" ON dissertations FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "dissertation_milestones_select" ON dissertation_milestones;
CREATE POLICY "dissertation_milestones_select" ON dissertation_milestones FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "dissertation_milestones_insert" ON dissertation_milestones;
CREATE POLICY "dissertation_milestones_insert" ON dissertation_milestones FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "dissertation_milestones_update" ON dissertation_milestones;
CREATE POLICY "dissertation_milestones_update" ON dissertation_milestones FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "knowledge_packs_select" ON knowledge_packs;
CREATE POLICY "knowledge_packs_select" ON knowledge_packs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "knowledge_packs_insert" ON knowledge_packs;
CREATE POLICY "knowledge_packs_insert" ON knowledge_packs FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "knowledge_packs_update" ON knowledge_packs;
CREATE POLICY "knowledge_packs_update" ON knowledge_packs FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "case_reports_select" ON case_reports;
CREATE POLICY "case_reports_select" ON case_reports FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "case_reports_insert" ON case_reports;
CREATE POLICY "case_reports_insert" ON case_reports FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "case_reports_update" ON case_reports;
CREATE POLICY "case_reports_update" ON case_reports FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 6. STORAGE BUCKET FOR ACADEMIC DOCUMENTS
-- --------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'academic-documents',
  'academic-documents',
  true,
  10485760, -- 10MB
  ARRAY['application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg', 'image/jpg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow public read of academic documents" ON storage.objects;
CREATE POLICY "Allow public read of academic documents"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'academic-documents');

DROP POLICY IF EXISTS "Allow public upload of academic documents" ON storage.objects;
CREATE POLICY "Allow public upload of academic documents"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'academic-documents');

DROP POLICY IF EXISTS "Allow public update of academic documents" ON storage.objects;
CREATE POLICY "Allow public update of academic documents"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'academic-documents')
WITH CHECK (bucket_id = 'academic-documents');

DROP POLICY IF EXISTS "Allow public delete of academic documents" ON storage.objects;
CREATE POLICY "Allow public delete of academic documents"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'academic-documents');

-- ====================================================================
-- END OF MIGRATION 04
-- ====================================================================
