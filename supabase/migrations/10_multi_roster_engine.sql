-- ====================================================================
-- FM Roster - Migration 10: Multi-Roster Engine & Chief HITL Merge
-- ====================================================================
-- PREREQUISITE: migrations 01-09 already applied.
--
-- WHAT THIS DOES:
--   1. `roster_types`: a small reference table (same `id text PRIMARY KEY`
--      pattern as `roles` in migration 01) naming the 5 UCH Family
--      Medicine roster document formats this module ingests.
--   2. `raw_roster_uploads`: an append-only import log — every pasted/
--      uploaded roster document, of any type, gets its own row. Re-pasting
--      a corrected version creates a new row rather than overwriting the
--      old one, so there's a history of what was imported and when.
--   3. `combined_master_rosters`: one row per monthly collection cycle,
--      carrying the Chief's four merged grids (GOP clinic, A&E emergency
--      call, supervision, satellite) through draft -> chief_review ->
--      published. Publishing this is what posts the pinned #Roster
--      announcement (see MultiRosterManagerView.tsx).
--   4. `workforce.on_floor`: a simple current-state flag (not tracked per
--      month) distinguishing residents currently posted in GOP from those
--      on an outside rotation. Already applied by an earlier draft of
--      this migration during the same session; included again here,
--      idempotently, so this file is a complete, standalone, re-runnable
--      record of what migration 10 does.
--   5. A `roster-documents` Storage bucket for uploaded roster files.
--
-- WHY NO RESIDENT-TO-SLOT ASSIGNMENT DATA: nothing anywhere in this
-- schema records which resident covers which consultant's clinic station,
-- A&E shift, supervision duty, or satellite outpost on which day — that
-- assignment doesn't exist as data, only as something a Chief decides.
-- combined_master_rosters' four grid columns are where the Chief's manual
-- drag-and-drop assignments actually get persisted; there is no automatic
-- inference of who goes where. The parser (uchRosterParser.ts) structures
-- what the consultant/admin documents already say; it does not invent
-- resident assignments that aren't in the source documents.
--
-- SECURITY POSTURE: same permissive-pending-real-auth pattern as every
-- table since migration 01 — no secrets live here. Publishing is a
-- Chief-only *workflow* (MultiRosterManagerView only renders inside the
-- Chief-gated dashboard), not a Chief-only *database* permission — same
-- trust model already used for collections/announcements, not a
-- regression from existing precedent.
-- ====================================================================

-- --------------------------------------------------
-- 1. WORKFORCE: on_floor flag
-- --------------------------------------------------

ALTER TABLE workforce ADD COLUMN IF NOT EXISTS on_floor boolean DEFAULT true NOT NULL;

-- IMPORTANT: migration 02 replaced workforce's default table-level grants
-- with an explicit column allow-list (to lock down resident_code). A new
-- column added after that point does NOT automatically inherit
-- SELECT/UPDATE privilege — it has to be granted explicitly, or it's
-- silently unreadable/unwritable via the anon key despite RLS allowing
-- the row. Confirmed live: without this grant, `select id,on_floor` on
-- workforce returns 401 even though the workforce_select RLS policy is
-- permissive. This is the same allow-list-vs-blocklist lesson as
-- migration 02 itself, just for a column added five migrations later.
GRANT SELECT (on_floor), UPDATE (on_floor) ON workforce TO anon, authenticated;

-- --------------------------------------------------
-- 2. ROSTER TYPES (reference table)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS roster_types (
  id text PRIMARY KEY,
  name text NOT NULL
);

INSERT INTO roster_types (id, name) VALUES
  ('combined_gop', 'Combined GOP Duty Roster'),
  ('consultant_gop', 'Consultant GOP Roster'),
  ('accident_emergency', 'A&E Emergency Call Roster'),
  ('afternoon_supervision', 'Afternoon/Priority/Saturday Supervision Roster'),
  ('satellite_outreach', 'Satellite Outposts Roster')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE roster_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "roster_types_select" ON roster_types;
CREATE POLICY "roster_types_select" ON roster_types FOR SELECT TO anon, authenticated USING (true);

-- --------------------------------------------------
-- 3. RAW ROSTER UPLOADS (append-only import log, all 5 types)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS raw_roster_uploads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  roster_type_id text NOT NULL REFERENCES roster_types(id),
  file_name text,
  file_url text,
  raw_text_content text,
  parsed_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  uploaded_by_workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_raw_roster_uploads_type_month_year ON raw_roster_uploads(roster_type_id, year, month);

ALTER TABLE raw_roster_uploads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "raw_roster_uploads_select" ON raw_roster_uploads;
CREATE POLICY "raw_roster_uploads_select" ON raw_roster_uploads FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "raw_roster_uploads_insert" ON raw_roster_uploads;
CREATE POLICY "raw_roster_uploads_insert" ON raw_roster_uploads FOR INSERT TO anon, authenticated WITH CHECK (true);

-- --------------------------------------------------
-- 4. COMBINED MASTER ROSTERS (Chief HITL merge workspace, one per collection)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS combined_master_rosters (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id uuid REFERENCES collections(id) ON DELETE CASCADE,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  year integer NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'chief_review', 'published')),
  gop_clinic_grid jsonb DEFAULT '{}'::jsonb NOT NULL,
  emergency_call_grid jsonb DEFAULT '{}'::jsonb NOT NULL,
  supervision_grid jsonb DEFAULT '{}'::jsonb NOT NULL,
  satellite_grid jsonb DEFAULT '{}'::jsonb NOT NULL,
  published_at timestamptz,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_combined_master_roster_per_collection UNIQUE (collection_id)
);

CREATE INDEX IF NOT EXISTS idx_combined_master_rosters_month_year ON combined_master_rosters(year, month);

ALTER TABLE combined_master_rosters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "combined_master_rosters_select" ON combined_master_rosters;
CREATE POLICY "combined_master_rosters_select" ON combined_master_rosters FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "combined_master_rosters_insert" ON combined_master_rosters;
CREATE POLICY "combined_master_rosters_insert" ON combined_master_rosters FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "combined_master_rosters_update" ON combined_master_rosters;
CREATE POLICY "combined_master_rosters_update" ON combined_master_rosters FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 5. STORAGE BUCKET FOR ROSTER DOCUMENTS
-- --------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'roster-documents',
  'roster-documents',
  true,
  10485760, -- 10MB
  ARRAY['application/pdf', 'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain', 'image/jpeg', 'image/jpg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow public read of roster documents" ON storage.objects;
CREATE POLICY "Allow public read of roster documents"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'roster-documents');

DROP POLICY IF EXISTS "Allow public upload of roster documents" ON storage.objects;
CREATE POLICY "Allow public upload of roster documents"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'roster-documents');

DROP POLICY IF EXISTS "Allow public update of roster documents" ON storage.objects;
CREATE POLICY "Allow public update of roster documents"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'roster-documents')
WITH CHECK (bucket_id = 'roster-documents');

DROP POLICY IF EXISTS "Allow public delete of roster documents" ON storage.objects;
CREATE POLICY "Allow public delete of roster documents"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'roster-documents');

-- ====================================================================
-- END OF MIGRATION 10
-- ====================================================================
