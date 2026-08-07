-- ====================================================================
-- FM Roster - Migration 01: RBAC, Rotations, File Uploads, Announcements
-- ====================================================================
-- PREREQUISITE: /supabase/schema.sql must already have been run once
--               (creates workforce, collections, submissions, settings).
--
-- WHAT THIS DOES:
--   1. Adds `roles` + `user_roles` (super_admin, hod, rtc, cme_coord,
--      consultant, resident) as RBAC scaffolding for a future Supabase
--      Auth integration.
--   2. Adds `rotations` reference table, links it to `submissions` via
--      new nullable FK columns, and backfills from existing free-text data.
--   3. Adds `file_uploads` metadata table and backfills it from the
--      existing `submissions.leave_document_urls` array.
--   4. Adds `announcements` + `announcement_reads` (categories: Roster,
--      Exam, CME; pinned posts; per-resident read receipts).
--   5. Closes the credential-leak found in the Phase 0 audit: residents'
--      `resident_code` and the shared `admin_access_code` are no longer
--      readable/writable by the anon key at all (previously exposed via
--      plain `select *` on `workforce` / `settings`, which is how the now
--      dev-gated DevHelper panel — and the login pages themselves — could
--      read every code). Login and all code-touching admin actions now go
--      through SECURITY DEFINER RPC functions that verify the shared code
--      server-side and never return it to a client that doesn't already
--      know it.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--   It does not remove the general public-read/write posture of
--   `workforce` / `collections` / `submissions` (rows are still visible to
--   anyone holding the anon key; there's no way to tell "resident A" apart
--   from "resident B" or from an anonymous visitor at the Postgres layer).
--   True per-row RBAC (e.g. "a resident can only edit their own
--   submission") requires migrating login to real Supabase Auth so RLS can
--   check auth.uid() — that is a separate, larger follow-up and is NOT
--   included here. The `has_role()` helper and the RLS on `roles` /
--   `user_roles` below are written against that future auth.uid() model
--   and are effectively inert (nobody can satisfy them) until that
--   migration happens.
--
-- This script is safe to re-run (idempotent), matching the style of
-- schema.sql.
-- ====================================================================


-- --------------------------------------------------
-- 1. ROLES & USER_ROLES
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS roles (
  id text PRIMARY KEY,
  label text NOT NULL,
  description text
);

INSERT INTO roles (id, label, description) VALUES
  ('super_admin', 'Super Admin', 'Full system access across all departments.'),
  ('hod', 'Head of Department', 'Department-wide oversight and approval authority.'),
  ('rtc', 'Rotation/Training Coordinator', 'Manages rotation schedules and postings.'),
  ('cme_coord', 'CME Coordinator', 'Manages continuing medical education announcements and records.'),
  ('consultant', 'Consultant', 'Supervising consultant with review access.'),
  ('resident', 'Resident', 'Standard resident submitting monthly postings/leave.')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_roles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- Real Supabase Auth identity (populated once Auth is integrated).
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Ties a role to an existing workforce (resident) record where applicable.
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES roles(id),
  email text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT user_roles_identity_check CHECK (auth_user_id IS NOT NULL OR workforce_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS unique_user_role_auth
  ON user_roles (auth_user_id, role_id) WHERE auth_user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS unique_user_role_workforce
  ON user_roles (workforce_id, role_id) WHERE workforce_id IS NOT NULL;

-- Every existing resident gets the baseline 'resident' role so user_roles
-- is populated from day one (harmless no-op once Auth exists too).
INSERT INTO user_roles (workforce_id, role_id)
SELECT w.id, 'resident' FROM workforce w
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles ur WHERE ur.workforce_id = w.id AND ur.role_id = 'resident'
);

-- Role-check helper for future Supabase-Auth-based RLS. Returns false for
-- every current request because the app does not yet authenticate via
-- supabase.auth — see header note above.
CREATE OR REPLACE FUNCTION public.has_role(required_roles text[])
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles ur
    WHERE ur.auth_user_id = auth.uid() AND ur.role_id = ANY(required_roles)
  );
$$;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_select" ON roles;
CREATE POLICY "roles_select" ON roles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "roles_mutate" ON roles;
CREATE POLICY "roles_mutate" ON roles FOR ALL TO authenticated
  USING (has_role(ARRAY['super_admin'])) WITH CHECK (has_role(ARRAY['super_admin']));

DROP POLICY IF EXISTS "user_roles_select" ON user_roles;
CREATE POLICY "user_roles_select" ON user_roles FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid() OR has_role(ARRAY['super_admin', 'hod']));
DROP POLICY IF EXISTS "user_roles_mutate" ON user_roles;
CREATE POLICY "user_roles_mutate" ON user_roles FOR ALL TO authenticated
  USING (has_role(ARRAY['super_admin'])) WITH CHECK (has_role(ARRAY['super_admin']));


-- --------------------------------------------------
-- 2. ROTATIONS (reference table + link to submissions)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS rotations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  department text,
  active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Seed a starter set of standard Family Medicine postings.
INSERT INTO rotations (name, department) VALUES
  ('Family Medicine Clinic', 'Family Medicine'),
  ('Internal Medicine', 'Internal Medicine'),
  ('Paediatrics', 'Paediatrics'),
  ('Obstetrics & Gynaecology', 'O&G'),
  ('Surgery', 'Surgery'),
  ('Emergency Medicine (A&E)', 'A&E'),
  ('Community Health', 'Community Health'),
  ('Psychiatry', 'Psychiatry'),
  ('Geriatrics', 'Family Medicine'),
  ('Orthopedics', 'Orthopedics')
ON CONFLICT (name) DO NOTHING;

-- Link submissions to rotations without dropping the existing free-text
-- columns (the resident form still writes free text; these FKs let a
-- future dropdown-based form standardize entries going forward).
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS current_rotation_id uuid REFERENCES rotations(id) ON DELETE SET NULL;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS next_rotation_id uuid REFERENCES rotations(id) ON DELETE SET NULL;

-- Backfill: capture any existing free-text rotation names not already seeded.
INSERT INTO rotations (name)
SELECT DISTINCT trim(current_rotation) FROM submissions
WHERE current_rotation IS NOT NULL AND trim(current_rotation) <> ''
ON CONFLICT (name) DO NOTHING;

INSERT INTO rotations (name)
SELECT DISTINCT trim(next_rotation) FROM submissions
WHERE next_rotation IS NOT NULL AND trim(next_rotation) <> ''
ON CONFLICT (name) DO NOTHING;

-- Backfill: link existing submissions to their matching rotation row.
UPDATE submissions s SET current_rotation_id = r.id
FROM rotations r WHERE r.name = trim(s.current_rotation) AND s.current_rotation_id IS NULL;

UPDATE submissions s SET next_rotation_id = r.id
FROM rotations r WHERE r.name = trim(s.next_rotation) AND s.next_rotation_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_rotations_active ON rotations(active);

ALTER TABLE rotations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rotations_select" ON rotations;
CREATE POLICY "rotations_select" ON rotations FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rotations_mutate" ON rotations;
CREATE POLICY "rotations_mutate" ON rotations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
-- NOTE: rotations carry no secret, so this stays at the same "public,
-- app-level trust" posture as collections/submissions rather than being
-- gated behind has_role() (which nothing can satisfy pre-Auth).


-- --------------------------------------------------
-- 3. FILE UPLOADS (metadata for Storage objects)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS file_uploads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  file_name text NOT NULL,
  storage_path text NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  submission_id uuid REFERENCES submissions(id) ON DELETE CASCADE,
  mime_type text,
  file_size integer,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_file_uploads_submission ON file_uploads(submission_id);
CREATE INDEX IF NOT EXISTS idx_file_uploads_workforce ON file_uploads(workforce_id);

-- Backfill metadata rows from the existing leave_document_urls arrays so
-- historical uploads show up in file_uploads too.
INSERT INTO file_uploads (file_name, storage_path, workforce_id, submission_id, created_at)
SELECT
  split_part(url, '/', array_length(string_to_array(url, '/'), 1)) AS file_name,
  substring(url FROM 'leave-documents/(.*)$') AS storage_path,
  s.workforce_id,
  s.id,
  s.created_at
FROM submissions s, unnest(s.leave_document_urls) AS url
WHERE s.leave_document_urls IS NOT NULL
  AND array_length(s.leave_document_urls, 1) > 0
  AND substring(url FROM 'leave-documents/(.*)$') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM file_uploads fu
    WHERE fu.submission_id = s.id
      AND fu.storage_path = substring(url FROM 'leave-documents/(.*)$')
  );

ALTER TABLE file_uploads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "file_uploads_select" ON file_uploads;
CREATE POLICY "file_uploads_select" ON file_uploads FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "file_uploads_insert" ON file_uploads;
CREATE POLICY "file_uploads_insert" ON file_uploads FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "file_uploads_delete" ON file_uploads;
CREATE POLICY "file_uploads_delete" ON file_uploads FOR DELETE TO anon, authenticated USING (true);


-- --------------------------------------------------
-- 4. ANNOUNCEMENTS + READ RECEIPTS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS announcements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  -- Stored without the '#' — that's a display-layer prefix, not data.
  category text NOT NULL CHECK (category IN ('Roster', 'Exam', 'CME')),
  pinned boolean DEFAULT false NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

DROP TRIGGER IF EXISTS update_announcements_updated_at ON announcements;
CREATE TRIGGER update_announcements_updated_at
BEFORE UPDATE ON announcements
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE IF NOT EXISTS announcement_reads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  announcement_id uuid REFERENCES announcements(id) ON DELETE CASCADE NOT NULL,
  workforce_id uuid REFERENCES workforce(id) ON DELETE CASCADE NOT NULL,
  read_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_read_per_resident UNIQUE (announcement_id, workforce_id)
);

CREATE INDEX IF NOT EXISTS idx_announcements_category ON announcements(category);
CREATE INDEX IF NOT EXISTS idx_announcements_pinned ON announcements(pinned);

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcements_select" ON announcements;
CREATE POLICY "announcements_select" ON announcements FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "announcements_mutate" ON announcements;
CREATE POLICY "announcements_mutate" ON announcements FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "announcement_reads_select" ON announcement_reads;
CREATE POLICY "announcement_reads_select" ON announcement_reads FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "announcement_reads_insert" ON announcement_reads;
CREATE POLICY "announcement_reads_insert" ON announcement_reads FOR INSERT TO anon, authenticated WITH CHECK (true);


-- --------------------------------------------------
-- 5. CREDENTIAL-LEAK FIX: lock down resident_code / admin_access_code
-- --------------------------------------------------
-- These two columns are the only real secrets in the schema. Everything
-- else above stays at the app's existing "anyone with the anon key" trust
-- level (a known, documented limitation — see header). These two are
-- fixed for real: the anon/authenticated roles can no longer SELECT or
-- UPDATE them directly. All legitimate access goes through the
-- SECURITY DEFINER functions in section 6, which re-verify the caller
-- already knows a valid code before doing anything.

REVOKE SELECT (resident_code), UPDATE (resident_code) ON workforce FROM anon, authenticated;
REVOKE SELECT (admin_access_code), UPDATE (admin_access_code) ON settings FROM anon, authenticated;

-- Replace the old blanket "FOR ALL ... USING (true)" policies (which made
-- the narrower SELECT-only policies pointless, since Postgres OR's
-- permissive policies together) with precise, per-operation policies.
-- Row-level access is unchanged (still permissive pending real Auth); this
-- only removes the redundant catch-alls and adds an explicit INSERT policy
-- for collections that the old ALL policy had been silently covering.

DROP POLICY IF EXISTS "Allow public select of active residents" ON workforce;
DROP POLICY IF EXISTS "Allow full access to workforce" ON workforce;
DROP POLICY IF EXISTS "workforce_select" ON workforce;
CREATE POLICY "workforce_select" ON workforce FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "workforce_update" ON workforce;
CREATE POLICY "workforce_update" ON workforce FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
-- Intentionally no INSERT policy: new workforce rows (which must set
-- resident_code) can only be created via chief_add_workforce_member()
-- below, which bypasses RLS as a SECURITY DEFINER function.

DROP POLICY IF EXISTS "Allow public select of collections" ON collections;
DROP POLICY IF EXISTS "Allow full access to collections" ON collections;
DROP POLICY IF EXISTS "collections_select" ON collections;
CREATE POLICY "collections_select" ON collections FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "collections_insert" ON collections;
CREATE POLICY "collections_insert" ON collections FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "collections_update" ON collections;
CREATE POLICY "collections_update" ON collections FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);


-- --------------------------------------------------
-- 6. SECURITY DEFINER RPCs (server-side code verification)
-- --------------------------------------------------
-- Each function re-checks the supplied code against the database before
-- doing anything. Because they run as SECURITY DEFINER, they can read/
-- write resident_code and admin_access_code even though those columns are
-- now locked out for anon/authenticated directly.

-- Resident login: verifies the code without ever returning it.
CREATE OR REPLACE FUNCTION public.verify_resident_login(p_workforce_id uuid, p_code text)
RETURNS TABLE(id uuid, full_name text, category text)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT w.id, w.full_name, w.category
  FROM workforce w
  WHERE w.id = p_workforce_id AND w.resident_code = p_code AND w.active = true;
$$;
GRANT EXECUTE ON FUNCTION public.verify_resident_login(uuid, text) TO anon, authenticated;

-- Chief login: only tells the caller yes/no, never the code itself.
CREATE OR REPLACE FUNCTION public.verify_chief_login(p_code text)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM settings WHERE id = 1 AND admin_access_code = p_code);
$$;
GRANT EXECUTE ON FUNCTION public.verify_chief_login(text) TO anon, authenticated;

-- Chief dashboard: bulk-fetch resident codes, gated on already knowing the
-- current admin code (same trust boundary the app has always had for the
-- Chief role — now enforced server-side instead of leaking to anyone).
CREATE OR REPLACE FUNCTION public.chief_get_workforce_codes(p_admin_code text)
RETURNS TABLE(id uuid, resident_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE id = 1 AND admin_access_code = p_admin_code) THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY SELECT w.id, w.resident_code FROM workforce w;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_get_workforce_codes(text) TO anon, authenticated;

-- Chief dashboard: add a workforce member with a server-generated,
-- guaranteed-unique 6-digit code.
CREATE OR REPLACE FUNCTION public.chief_add_workforce_member(p_admin_code text, p_full_name text, p_category text)
RETURNS TABLE(id uuid, full_name text, category text, resident_code text, active boolean, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE id = 1 AND admin_access_code = p_admin_code) THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  LOOP
    v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM workforce w WHERE w.resident_code = v_code);
  END LOOP;

  INSERT INTO workforce (full_name, category, resident_code, active)
  VALUES (p_full_name, p_category, v_code, true)
  RETURNING workforce.id INTO v_id;

  RETURN QUERY SELECT w.id, w.full_name, w.category, w.resident_code, w.active, w.created_at
  FROM workforce w WHERE w.id = v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_add_workforce_member(text, text, text) TO anon, authenticated;

-- Chief dashboard: regenerate a resident's code.
CREATE OR REPLACE FUNCTION public.chief_reset_resident_code(p_admin_code text, p_workforce_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE id = 1 AND admin_access_code = p_admin_code) THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  LOOP
    v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM workforce w WHERE w.resident_code = v_code);
  END LOOP;

  UPDATE workforce SET resident_code = v_code WHERE id = p_workforce_id;
  RETURN v_code;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_reset_resident_code(text, uuid) TO anon, authenticated;

-- Chief dashboard: change the shared admin code (requires knowing the
-- current one).
CREATE OR REPLACE FUNCTION public.chief_update_admin_code(p_admin_code text, p_new_code text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE id = 1 AND admin_access_code = p_admin_code) THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  UPDATE settings SET admin_access_code = p_new_code WHERE id = 1;
  RETURN true;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_update_admin_code(text, text) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 01
-- ====================================================================
