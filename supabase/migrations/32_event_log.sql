-- ====================================================================
-- FM Roster - Migration 32: event_log (L3 Spine foundation, part 1 of 2)
-- ====================================================================
-- PREREQUISITE: migrations 01-31 already applied.
--
-- CONTEXT: docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md (the new governing
-- architecture spec) describes a 5-layer anatomy (L1-L5) with an event
-- vocabulary (§6, e.g. `member.provisioned`, `entry.submitted`,
-- `insight.generated`) that every layer is meant to emit into. This
-- migration adds ONLY the event log itself — a single append-only table —
-- as additive new schema. It does NOT migrate any existing data out of
-- `submissions`, `research_workspaces`, `casebook_workspaces`, etc. into a
-- new generic store; that would be a large, high-risk rewrite of live
-- production tables and was explicitly out of scope for this pass. See
-- src/modules/shared/lib/udr.ts for the read-only composition layer that
-- reads the EXISTING tables instead of migrating them.
--
-- NOT APPLIED LIVE: per instructions, this migration is written but not
-- run against the live database. The live DB is shared with several other
-- agents' in-flight migrations this session — a human will review and
-- apply the full pending batch, in order, after review.
--
-- DESIGN NOTES:
--   1. `event_type` is a free `text` column, deliberately NOT a CHECK-
--      constrained enum. This repo has already hit the exact pain of a
--      CHECK-constrained action/event taxonomy needing repeated widening
--      migrations (`ai_action_logs.action_type` — see migrations 14 and 16
--      in this same repo, and CLAUDE.md's "AI / Supabase Edge Functions"
--      section). The living-system spec's event vocabulary (§6) is
--      explicitly expected to grow as more of the 5-layer architecture is
--      built out; a CHECK constraint here would just recreate that same
--      migration churn. `src/modules/shared/lib/eventBus.ts` exports an
--      `EventType` string-literal union for editor autocomplete instead —
--      a compile-time nudge, not a database-level restriction.
--   2. RLS stays permissive (`USING (true) WITH CHECK (true)` for
--      anon/authenticated), matching every other table in this schema
--      since migration 01 — see CLAUDE.md's Security Notes section. This
--      is NOT a real security boundary; introducing a stricter policy only
--      on this one new table would be an inconsistent (and confusing)
--      posture relative to the rest of the app, and was explicitly not
--      asked for here.
--   3. `tenant_id` is nullable (some events — e.g. platform-operator
--      actions — are cross-tenant by nature, same reasoning as
--      `platform_operators` in migration 11 not being tenant-scoped).
-- ====================================================================

CREATE TABLE IF NOT EXISTS event_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id),
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  source text,
  agent_ref text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_event_log_tenant_type_created
  ON event_log (tenant_id, event_type, created_at DESC);

ALTER TABLE event_log ENABLE ROW LEVEL SECURITY;

-- Permissive posture matching every other table since migration 01 (see
-- CLAUDE.md Security Notes). No real tenant isolation, no write
-- restriction — this is an append-only audit/event stream, not a secret.
CREATE POLICY "event_log_select" ON event_log FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "event_log_insert" ON event_log FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "event_log_update" ON event_log FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Standard column-privilege grant, matching migration 02's established
-- allow-list pattern (Supabase's blanket `GRANT ALL ON ALL TABLES IN
-- SCHEMA public` already covers new tables by default; this GRANT is
-- explicit/defensive so event_log's privilege story is self-documenting
-- rather than relying on the schema-wide default).
GRANT SELECT (id, tenant_id, event_type, payload, source, agent_ref, created_at) ON event_log TO anon, authenticated;
GRANT INSERT (tenant_id, event_type, payload, source, agent_ref) ON event_log TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 32
-- ====================================================================
