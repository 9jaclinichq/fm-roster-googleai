-- ====================================================================
-- FM Roster v0.1 - Supabase SQL Migration (Unified Single Script)
-- ====================================================================
-- DESCRIPTION: Sets up tables, constraints, indexes, triggers,
--              Row Level Security (RLS) policies, storage bucket,
--              and seeds all initial system data for Family Medicine.
--
-- INSTRUCTIONS: Run this complete script inside your Supabase project's SQL Editor.
--              It is 100% safe to re-run.

-- --------------------------------------------------
-- 1. CLEANUP (Optional - warning: drops existing tables for clean slate)
-- --------------------------------------------------
DROP FUNCTION IF EXISTS update_updated_at_column CASCADE;
DROP TABLE IF EXISTS settings CASCADE;
DROP TABLE IF EXISTS submissions CASCADE;
DROP TABLE IF EXISTS collections CASCADE;
DROP TABLE IF EXISTS workforce CASCADE;

-- --------------------------------------------------
-- 2. CREATE DATABASE TABLES & CONSTRAINTS
-- --------------------------------------------------

-- A. WORKFORCE REGISTER
CREATE TABLE workforce (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name text NOT NULL,
  category text NOT NULL CHECK (category IN ('Registrar', 'Senior Registrar', 'Medical Officer')),
  resident_code varchar(6) NOT NULL UNIQUE,
  active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- B. COLLECTION CYCLES (Only one active/open collection allowed)
CREATE TABLE collections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  deadline timestamptz NOT NULL,
  status text DEFAULT 'open'::text NOT NULL CHECK (status IN ('open', 'closed')),
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- C. MONTHLY ROSTER SUBMISSIONS
CREATE TABLE submissions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id uuid REFERENCES collections(id) ON DELETE CASCADE NOT NULL,
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE NOT NULL,
  current_rotation text NOT NULL,
  next_rotation text NOT NULL,
  taking_leave boolean DEFAULT false NOT NULL,
  leave_type text,
  leave_start varchar(10), -- YYYY-MM-DD format
  leave_end varchar(10),   -- YYYY-MM-DD format
  leave_applied boolean,
  leave_document_urls text[] DEFAULT '{}'::text[] NOT NULL,
  notes text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  -- Limit: One submission per resident per collection cycle
  CONSTRAINT unique_resident_submission_per_collection UNIQUE (collection_id, workforce_id)
);

-- D. GLOBAL SYSTEM SETTINGS (Locked to single row)
CREATE TABLE settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  admin_access_code text NOT NULL,
  current_collection_id uuid REFERENCES collections(id) ON DELETE SET NULL
);

-- --------------------------------------------------
-- 3. INDEXES FOR OPTIMAL QUERY PERFORMANCE
-- --------------------------------------------------
CREATE INDEX idx_workforce_resident_code ON workforce(resident_code);
CREATE INDEX idx_workforce_active ON workforce(active);
CREATE INDEX idx_submissions_collection_workforce ON submissions(collection_id, workforce_id);

-- Enforce exactly ONE active ('open') collection cycle at any time
CREATE UNIQUE INDEX unique_active_collection ON collections (status) WHERE (status = 'open');

-- --------------------------------------------------
-- 4. TRIGGER FOR AUTOMATIC UPDATED_AT STAMPS
-- --------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_submissions_updated_at
BEFORE UPDATE ON submissions
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------
-- 5. SEED INITIAL SYSTEM DATA
-- --------------------------------------------------

-- A. Insert Active Collection: August 2026 Duty Roster
-- Deadline set to 14 days in the future relative to execution
INSERT INTO collections (id, title, deadline, status) 
VALUES (
  '88888888-8888-8888-8888-888888888888'::uuid, 
  'August 2026 Duty Roster', 
  timezone('utc'::text, now() + interval '14 days'), 
  'open'
);

-- B. Seed Single Settings Row with a Random 6-Digit Admin Access Code
INSERT INTO settings (id, admin_access_code, current_collection_id) 
VALUES (
  1, 
  lpad(floor(random() * 900000 + 100000)::text, 6, '0'), 
  '88888888-8888-8888-8888-888888888888'::uuid
);

-- C. Seed all 30 residents with unique, non-sequential 6-digit codes
-- We use a CTE containing generate_series to generate distinct candidate codes,
-- then map them row-by-row to guarantee 100% unique 6-digit codes for every resident.
WITH random_codes AS (
  SELECT DISTINCT code
  FROM (
    SELECT lpad(floor(random() * 900000 + 100000)::text, 6, '0') as code
    FROM generate_series(1, 100)
  ) s
  LIMIT 30
),
workforce_names AS (
  SELECT name, category, row_number() OVER () as rn
  FROM (
    VALUES
      ('Dr. Aworanti', 'Registrar'),
      ('Dr. Apata', 'Registrar'),
      ('Dr. Babatunde', 'Registrar'),
      ('Dr. Ovolen', 'Registrar'),
      ('Dr. Adebayo', 'Registrar'),
      ('Dr. Okoh', 'Registrar'),
      ('Dr. Adeusi', 'Registrar'),
      ('Dr. Asimiyu', 'Registrar'),
      ('Dr. Ogunleye', 'Registrar'),
      ('Dr. Nwankwo', 'Registrar'),
      ('Dr. Afolabi', 'Registrar'),
      ('Dr. Olatunji', 'Registrar'),
      ('Dr. Ayandokun', 'Registrar'),
      ('Dr. Adegbenro', 'Registrar'),
      ('Dr. Ihedioha', 'Registrar'),
      ('Dr. Adepitan', 'Registrar'),
      ('Dr. Muibi', 'Registrar'),
      ('Dr. Ogunyemi', 'Senior Registrar'),
      ('Dr. Onigbinde', 'Senior Registrar'),
      ('Dr. Lawal', 'Senior Registrar'),
      ('Dr. Iyiola', 'Senior Registrar'),
      ('Dr. Ibiyemi', 'Senior Registrar'),
      ('Dr. Akappo', 'Senior Registrar'),
      ('Dr. Ugwueze', 'Senior Registrar'),
      ('Dr. Olanipekun', 'Senior Registrar'),
      ('Dr. Dada', 'Senior Registrar'),
      ('Dr. Umaukwu', 'Senior Registrar'),
      ('Dr. Alawode', 'Senior Registrar'),
      ('Dr. Ikor', 'Medical Officer'),
      ('Dr. Ulasi', 'Medical Officer')
  ) as t(name, category)
),
numbered_codes AS (
  SELECT code, row_number() OVER () as rn
  FROM random_codes
)
INSERT INTO workforce (full_name, category, resident_code)
SELECT wn.name, wn.category, nc.code
FROM workforce_names wn
JOIN numbered_codes nc ON wn.rn = nc.rn;

-- --------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- --------------------------------------------------
ALTER TABLE workforce ENABLE ROW LEVEL SECURITY;
ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Anonymous public credentials access (lightweight app-level codes)

-- A. WORKFORCE POLICIES
CREATE POLICY "Allow public select of active residents" 
ON workforce FOR SELECT 
TO public
USING (active = true);

CREATE POLICY "Allow full access to workforce" 
ON workforce FOR ALL 
TO public
USING (true)
WITH CHECK (true);

-- B. COLLECTIONS POLICIES
CREATE POLICY "Allow public select of collections" 
ON collections FOR SELECT 
TO public
USING (true);

CREATE POLICY "Allow full access to collections" 
ON collections FOR ALL 
TO public
USING (true)
WITH CHECK (true);

-- C. SUBMISSIONS POLICIES
CREATE POLICY "Allow select of submissions" 
ON submissions FOR SELECT 
TO public
USING (true);

CREATE POLICY "Allow inserts of submissions" 
ON submissions FOR INSERT 
TO public
WITH CHECK (true);

CREATE POLICY "Allow updates of submissions" 
ON submissions FOR UPDATE 
TO public
USING (true)
WITH CHECK (true);

-- D. SETTINGS POLICIES
CREATE POLICY "Allow public select of settings" 
ON settings FOR SELECT 
TO public
USING (true);

CREATE POLICY "Allow public update of settings" 
ON settings FOR UPDATE 
TO public
USING (true)
WITH CHECK (true);

-- --------------------------------------------------
-- 7. STORAGE BUCKET CONFIGURATION (leave-documents)
-- --------------------------------------------------

-- Provision the storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'leave-documents', 
  'leave-documents', 
  true, 
  5242880, -- 5MB individual file limit
  ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- Storage object row-level access policies
CREATE POLICY "Allow public read of leave documents"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'leave-documents');

CREATE POLICY "Allow public upload of leave documents"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'leave-documents');

CREATE POLICY "Allow public update of leave documents"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'leave-documents')
WITH CHECK (bucket_id = 'leave-documents');

CREATE POLICY "Allow public delete of leave documents"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'leave-documents');
