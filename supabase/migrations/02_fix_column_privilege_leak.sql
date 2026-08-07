-- ====================================================================
-- FM Roster - Migration 02: Fix ineffective column-privilege lockdown
-- ====================================================================
-- BUG: Migration 01's `REVOKE SELECT (resident_code), UPDATE (resident_code)
-- ON workforce FROM anon, authenticated;` (and the equivalent for
-- settings.admin_access_code) did NOT actually close the leak. Supabase
-- grants blanket table-level privileges to anon/authenticated on every
-- public table by default (`GRANT ALL ON ALL TABLES IN SCHEMA public ...`).
-- In Postgres, a table-level grant and a column-level grant are additive —
-- revoking only the column-level privilege leaves the table-level grant
-- (which covers every column) fully intact. Verified live: after running
-- migration 01, `anon` could still SELECT/UPDATE resident_code directly.
--
-- FIX: revoke the table-level SELECT/UPDATE entirely for the two tables
-- holding a secret column, then re-grant SELECT/UPDATE on an explicit
-- column allow-list that excludes the secret. This is the correct way to
-- do column-level security in Postgres — allow-list, not block-list.
-- ====================================================================

REVOKE SELECT, UPDATE ON workforce FROM anon, authenticated;
GRANT SELECT (id, full_name, category, active, created_at) ON workforce TO anon, authenticated;
GRANT UPDATE (full_name, category, active) ON workforce TO anon, authenticated;
-- No INSERT grant re-added: RLS already has no permissive INSERT policy on
-- workforce (see migration 01), so direct inserts stay blocked regardless
-- of table-level grants; new rows only come via chief_add_workforce_member().

REVOKE SELECT, UPDATE ON settings FROM anon, authenticated;
GRANT SELECT (id, current_collection_id) ON settings TO anon, authenticated;
GRANT UPDATE (current_collection_id) ON settings TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 02
-- ====================================================================
