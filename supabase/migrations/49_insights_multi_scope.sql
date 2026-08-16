-- ====================================================================
-- FM Roster - Migration 49: insights becomes multi-scope (org / doctor /
-- platform), closing a structural exclusion found by this session's
-- anatomy/physiology/biochemistry living-system audit.
-- ====================================================================
-- PREREQUISITE: migrations 01-48 already applied, in particular 37
-- (insights table) and 38 (its dedup unique index).
--
-- THE GAP THIS CLOSES: migration 37's `insights.tenant_id` was declared
-- `NOT NULL`. That's not just "nobody's wired it yet" — it's a hard schema
-- constraint that makes it IMPOSSIBLE to insert an insight for an
-- individual/unlinked doctor (no tenant_id, by definition — migration 18)
-- or for the Platform Operator (cross-tenant by design — migration 11,
-- `platform_operators` has no tenant_id at all). Confirmed by this
-- session's audit: `udr.ts`'s own header already documented "nothing in
-- this app raises insights against a bare doctor_id yet" as a scope note,
-- but the deeper reason was this NOT NULL constraint, not just a missing
-- agent.
--
-- SHAPE CHOSEN: the 3-way ownership convention already established in this
-- repo (migration 42 `form_instances`, migration 48
-- `clinical_document_types`) — NOT the earlier 2-way XOR doctor-ownership
-- pattern (migrations 25/31/40), which forces exactly one of two owners
-- and has no "belongs to neither" state. Insights genuinely need a third
-- state: a Platform-Operator-facing insight belongs to no single tenant
-- AND no single doctor. So:
--   - tenant_id SET, doctor_id NULL   -> an org-scoped insight (all
--     existing rows and Submission Chaser's own inserts stay in this
--     shape, completely unchanged)
--   - tenant_id NULL, doctor_id SET   -> a doctor-scoped insight, for an
--     individual/unlinked doctor
--   - tenant_id NULL, doctor_id NULL  -> a platform-wide insight, with no
--     single tenant or doctor as its subject (e.g. a future cross-tenant
--     operator-facing agent)
--   - tenant_id SET, doctor_id SET simultaneously is never valid — the
--     CHECK constraint below forbids it, same as the precedent migrations.
--
-- DEDUP INDEX FIX (migration 38's own index needs updating, not just
-- extending): a plain multi-column UNIQUE(tenant_id, doctor_id, ...) would
-- NOT actually dedup doctor-scoped or platform-scoped rows under Postgres's
-- default NULLS DISTINCT behavior -- every doctor-scoped row has
-- tenant_id = NULL, and by default two NULLs are never considered equal
-- for uniqueness purposes, so the old index's column set would silently
-- stop enforcing "at most one active insight per subject" for exactly the
-- two scopes this migration adds. Fixed with `UNIQUE NULLS NOT DISTINCT`
-- (Postgres 15+, available on Supabase) so NULL is compared as an ordinary
-- value here -- two doctor-scoped rows for the same doctor_id/agent_key/
-- subject_ref correctly collide, same as two org-scoped rows for the same
-- tenant_id/agent_key/subject_ref already did.
--
-- WHAT THIS MIGRATION DOES NOT DO (flagged, not silently skipped): no
-- agent in this app currently WRITES a doctor-scoped or platform-scoped
-- insight -- Submission Chaser remains org-only, unchanged. This migration
-- makes both scopes structurally possible and read-wires them into
-- udr.ts's doctor path (application-code change, same commit) so the fix
-- isn't immediately as dead as the gap it closes -- but a real agent that
-- reasons over an individual doctor's own data, or a platform-level agent,
-- is a separate, future task, not attempted here.
--
-- RLS stays fully permissive, unchanged from migration 37 -- same posture
-- as every other table in this schema (see CLAUDE.md Security Notes);
-- adding a stricter boundary here wasn't asked for and would be
-- inconsistent with this table's own established posture.
--
-- NOT APPLIED LIVE. Written for review; a human applies it afterward.
-- ====================================================================

ALTER TABLE insights ALTER COLUMN tenant_id DROP NOT NULL;

ALTER TABLE insights ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES doctor_profiles(id);

ALTER TABLE insights DROP CONSTRAINT IF EXISTS insights_scope_check;
ALTER TABLE insights ADD CONSTRAINT insights_scope_check CHECK (
  (tenant_id IS NOT NULL AND doctor_id IS NULL)
  OR (tenant_id IS NULL AND doctor_id IS NOT NULL)
  OR (tenant_id IS NULL AND doctor_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_insights_doctor_dismissed
  ON insights (doctor_id, dismissed_at);

-- Replaces migration 38's index (see header note above for why a plain
-- column addition wouldn't have worked).
DROP INDEX IF EXISTS idx_insights_dedup_active;
CREATE UNIQUE INDEX idx_insights_dedup_active
  ON insights (tenant_id, doctor_id, agent_key, subject_ref) NULLS NOT DISTINCT
  WHERE dismissed_at IS NULL;

-- Column-privilege grants (migration 37's own pattern) widened to include
-- the new column.
GRANT SELECT (id, tenant_id, doctor_id, agent_key, rung, text, action, workforce_id, subject_ref, cooldown_until, dismissed_at, created_at) ON insights TO anon, authenticated;
GRANT INSERT (tenant_id, doctor_id, agent_key, rung, text, action, workforce_id, subject_ref, cooldown_until) ON insights TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 49
-- ====================================================================
