-- Migration 19: fix ambiguous "id" column reference in two chief_* RPCs
--
-- Found while verifying migration 18's Workforce Registry changes:
-- chief_get_workforce_codes and chief_add_workforce_member both declare
-- `RETURNS TABLE(id uuid, ...)`, which implicitly creates a PL/pgSQL
-- variable named `id` scoped to the whole function body. Both functions'
-- admin-code guard clause then does `WHERE id = 1` against `settings`
-- (which also has an `id` column) without qualifying it, so Postgres can't
-- tell whether `id` means the OUT parameter or settings.id — every call to
-- either function fails immediately with "column reference \"id\" is
-- ambiguous" (42702), regardless of whether the admin code is valid.
--
-- Practical impact this had (both pre-existing, unrelated to migration 18):
--   * chief_get_workforce_codes: the Access Code column in the Chief's
--     Workforce Registry never populated (silently caught client-side).
--   * chief_add_workforce_member: "Add New Resident" was completely broken
--     — the admin-code check threw before the insert ever ran.
--
-- The other chief_* RPCs in migration 01/06 (chief_reset_resident_code,
-- chief_update_admin_code, chief_assign_user_role, chief_remove_user_role)
-- don't declare an `id`-named OUT parameter (RETURNS text/boolean/user_roles,
-- not RETURNS TABLE(id ...)), so they were never affected — confirmed by
-- inspection, not just guessed.
--
-- A SECOND, previously-invisible bug surfaced once the ambiguity fix let
-- these functions actually reach their RETURN QUERY: workforce.resident_code
-- is `varchar`, but both RETURNS TABLE(...) clauses declare it as `text`.
-- PL/pgSQL's RETURN QUERY requires an exact type match (not just an
-- implicitly-castable one), so this masked mismatch would have thrown
-- "structure of query does not match function result type" the moment the
-- first bug stopped hiding it. Fixed here by casting w.resident_code::text
-- in the SELECT rather than changing the declared TABLE column type (which
-- would require DROP + CREATE, not a same-signature CREATE OR REPLACE).
--
-- Fix: qualify both columns against the `settings` table explicitly, and
-- cast resident_code to text. This redefines the same two functions in
-- place (CREATE OR REPLACE), following this repo's fix-forward convention
-- rather than editing an already-applied migration file.

CREATE OR REPLACE FUNCTION public.chief_get_workforce_codes(p_admin_code text)
RETURNS TABLE(id uuid, resident_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE settings.id = 1 AND settings.admin_access_code = p_admin_code) THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY SELECT w.id, w.resident_code::text FROM workforce w;
END;
$$;

CREATE OR REPLACE FUNCTION public.chief_add_workforce_member(p_admin_code text, p_full_name text, p_category text)
RETURNS TABLE(id uuid, full_name text, category text, resident_code text, active boolean, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_code text;
  v_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE settings.id = 1 AND settings.admin_access_code = p_admin_code) THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  LOOP
    v_code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM workforce w WHERE w.resident_code = v_code);
  END LOOP;

  INSERT INTO workforce (full_name, category, resident_code, active)
  VALUES (p_full_name, p_category, v_code, true)
  RETURNING workforce.id INTO v_id;

  RETURN QUERY SELECT w.id, w.full_name, w.category, w.resident_code::text, w.active, w.created_at
  FROM workforce w WHERE w.id = v_id;
END;
$$;
