-- ====================================================================
-- FM Roster - Migration 37: insights (L3 Spine — first real agent output)
-- ====================================================================
-- PREREQUISITE: migrations 01-36 already applied, in particular 32
-- (event_log) and 34 (agent_manifests).
--
-- CONTEXT: docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §5 describes
-- `udr.insights[]` as "one insight anywhere is a `udr.insights[]` row" —
-- src/modules/shared/lib/udr.ts's `insights` field has been hardcoded `[]`
-- since it was written, because no agent has ever produced a real insight.
-- This migration adds the table that closes that gap: a persisted,
-- dismissible insight row, written by the first real rung-1 agent
-- ("Submission Chaser", src/modules/shared/lib/submissionChaserAgent.ts).
--
-- Reserved migration numbers this session: 32/34 (event_log/agent_manifests,
-- sibling stream), 33 (integrations layer, sibling stream), 35 (forms
-- generalization, sibling stream), 36 (org-defined groups, sibling stream).
-- This file only claims 37, per that stream's explicit reservation.
--
-- NOT APPLIED LIVE: per instructions, this migration is written but not run
-- against the live database. The live DB is shared with several other
-- agents' in-flight migrations this session — a human will review and apply
-- the full pending batch, in order, after review.
--
-- DESIGN NOTES:
--   1. `subject_ref` is a free-text pointer (e.g. 'collection:<uuid>' or
--      'workforce:<uuid>'), deliberately NOT a typed FK — a future insight
--      type (roster conflict, payment overdue, meeting action owed) will
--      point at a different kind of record entirely, and this repo has
--      already hit the pain of over-constraining a taxonomy column that
--      needs to grow (see event_log's `event_type`, migration 32's header).
--      Submission Chaser itself uses `'collection:<collection_id>:workforce:<workforce_id>'`
--      so the idempotency check (has an active insight already been raised
--      for this member in this collection?) is a single indexed-ish text
--      match rather than two separate FK joins.
--   2. `agent_key` IS a real FK into `agent_manifests(agent_key)` (unlike
--      event_log.agent_ref, which is free-text) — every insight in this
--      table is expected to trace back to a declared, rung-audited agent;
--      there is no "anonymous insight" concept per spec §4's rule that every
--      AI-touching component must declare its rung.
--   3. `cooldown_until` is the per-insight re-raise suppression window (spec
--      §4: "cooldowns live on the agent record, not the UI") — Submission
--      Chaser sets this 3 days out on insert so re-running the agent daily
--      doesn't spam a duplicate insight for the same pending member.
--   4. RLS stays permissive (`USING (true) WITH CHECK (true)` for
--      anon/authenticated), matching every other table in this schema since
--      migration 01 (see CLAUDE.md Security Notes) and both spine tables
--      from this same stream (event_log, agent_manifests). Not a real
--      security boundary; introducing a stricter policy only on this one
--      new table would be an inconsistent posture relative to the rest of
--      the app and was not asked for here.
-- ====================================================================

CREATE TABLE IF NOT EXISTS insights (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) NOT NULL,
  agent_key text NOT NULL REFERENCES agent_manifests(agent_key),
  rung smallint NOT NULL,
  text text NOT NULL,
  action jsonb DEFAULT '{}',
  workforce_id uuid REFERENCES workforce(id),
  subject_ref text,
  cooldown_until timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Backs "active insights for this tenant" (dismissed_at IS NULL), the only
-- query shape getActiveInsights()/InsightsStrip.tsx actually run.
CREATE INDEX IF NOT EXISTS idx_insights_tenant_dismissed
  ON insights (tenant_id, dismissed_at);

ALTER TABLE insights ENABLE ROW LEVEL SECURITY;

-- Permissive posture matching event_log/agent_manifests (migrations 32/34)
-- and every other table since migration 01 (see CLAUDE.md Security Notes).
CREATE POLICY "insights_select" ON insights FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "insights_insert" ON insights FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "insights_update" ON insights FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- Standard column-privilege grant, matching migrations 32/34's explicit/
-- defensive style. UPDATE is limited to the fields a dismiss/cooldown action
-- actually touches (dismissInsight only ever sets dismissed_at).
GRANT SELECT (id, tenant_id, agent_key, rung, text, action, workforce_id, subject_ref, cooldown_until, dismissed_at, created_at) ON insights TO anon, authenticated;
GRANT INSERT (tenant_id, agent_key, rung, text, action, workforce_id, subject_ref, cooldown_until) ON insights TO anon, authenticated;
GRANT UPDATE (dismissed_at, cooldown_until) ON insights TO anon, authenticated;

-- ====================================================================
-- Seed: agent_manifests row for Submission Chaser (BabsBrain-2, rung 1)
-- ====================================================================
-- The first agent_manifests row seeded by a stream OTHER than migration 34's
-- original 10 AI Copilot actions — and the first rung-1 "reasoning over
-- operational state" agent in this app (migration 34's own header notes none
-- of its 10 seeded rows qualify as that kind of agent). Submission Chaser
-- reads a tenant's open collection + submissions + active workforce and
-- reasons over which members are overdue — spec §4's own rung-1 example
-- ("detect a scheduling conflict... shown as suggestion").
INSERT INTO agent_manifests (agent_key, name, owner_engine, rung, description, gates, tenant_scope) VALUES
  ('babsbrain2_submission_chaser', 'Submission Chaser', 'babsbrain-2', 1,
   'Reads a tenant''s currently-open collection, its submissions, and its active workforce; for each active member who has not yet submitted, raises a persisted, dismissible insight naming them and the open collection. Idempotent per (collection, workforce member) via a 3-day cooldown, so re-running does not spam duplicate insights.',
   'Shown as a suggestion in InsightsStrip.tsx; no autonomous action taken — a human (org admin) reads the insight and decides whether to remind/reset the member''s code. Dismissing is a plain UPDATE, not a gated approval flow, since dismissal only silences a suggestion rather than executing anything.',
   'org')
ON CONFLICT (agent_key) DO NOTHING;

-- ====================================================================
-- END OF MIGRATION 37
-- ====================================================================
