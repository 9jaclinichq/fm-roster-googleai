-- ====================================================================
-- FM Roster - Migration 08: Knowledge Pack Items & AI Action Logs
-- ====================================================================
-- PREREQUISITE: migrations 01-07 already applied.
--
-- WHAT THIS DOES:
--   1. `knowledge_pack_items`: individual documents/sections that live
--      inside a `knowledge_packs` row (e.g. the "WACP Guidelines" pack can
--      contain several chapter PDFs, each indexed separately). A
--      BEFORE INSERT/UPDATE trigger keeps a `search_vector` tsvector
--      column in sync with each item's title + extracted_text_content.
--   2. `ai_action_logs`: an audit trail of every academicCopilot action a
--      resident runs (methodology_check, vancouver_format, mesh_suggest,
--      differential_extract), storing the input and structured output.
--
-- NOTE ON "RAG search": this is lexical full-text search (Postgres
-- to_tsvector/GIN), not embedding-based semantic search — there is no
-- vector store or embedding model wired into this project. It's real,
-- functional keyword retrieval over indexed knowledge pack content, which
-- is what academicCopilot.ts's "Check Departmental Guidelines" action
-- uses to surface relevant excerpts. Calling it more than that would be
-- overclaiming.
--
-- extracted_text_content is populated manually (pasted in via the
-- Knowledge Pack Manager UI) — there is no OCR/PDF-text-extraction
-- pipeline in this project, so "indexing" a document means a human copies
-- its searchable text in alongside the upload.
--
-- SECURITY POSTURE: same permissive-pending-real-auth pattern as every
-- table since migration 01 — no secrets live here.
-- ====================================================================

-- --------------------------------------------------
-- 1. KNOWLEDGE PACK ITEMS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS knowledge_pack_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  pack_id uuid REFERENCES knowledge_packs(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  document_url text,
  extracted_text_content text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  search_vector tsvector,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_knowledge_pack_items_pack ON knowledge_pack_items(pack_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_pack_items_search ON knowledge_pack_items USING GIN(search_vector);

CREATE OR REPLACE FUNCTION public.index_knowledge_pack_item()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector := to_tsvector('english', coalesce(NEW.title, '') || ' ' || coalesce(NEW.extracted_text_content, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_index_knowledge_pack_item ON knowledge_pack_items;
CREATE TRIGGER trg_index_knowledge_pack_item
BEFORE INSERT OR UPDATE ON knowledge_pack_items
FOR EACH ROW
EXECUTE FUNCTION index_knowledge_pack_item();

ALTER TABLE knowledge_pack_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "knowledge_pack_items_select" ON knowledge_pack_items;
CREATE POLICY "knowledge_pack_items_select" ON knowledge_pack_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "knowledge_pack_items_insert" ON knowledge_pack_items;
CREATE POLICY "knowledge_pack_items_insert" ON knowledge_pack_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "knowledge_pack_items_update" ON knowledge_pack_items;
CREATE POLICY "knowledge_pack_items_update" ON knowledge_pack_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 2. AI ACTION LOGS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS ai_action_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN ('methodology_check', 'vancouver_format', 'mesh_suggest', 'differential_extract')),
  input_summary text,
  output_result jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_action_logs_workforce ON ai_action_logs(workforce_id);
CREATE INDEX IF NOT EXISTS idx_ai_action_logs_action_type ON ai_action_logs(action_type);

ALTER TABLE ai_action_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_action_logs_select" ON ai_action_logs;
CREATE POLICY "ai_action_logs_select" ON ai_action_logs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "ai_action_logs_insert" ON ai_action_logs;
CREATE POLICY "ai_action_logs_insert" ON ai_action_logs FOR INSERT TO anon, authenticated WITH CHECK (true);

-- ====================================================================
-- END OF MIGRATION 08
-- ====================================================================
