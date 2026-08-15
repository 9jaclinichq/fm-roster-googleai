-- ====================================================================
-- FM Roster - Migration 34: agent_manifests (L3 Spine foundation, part 2 of 2)
-- ====================================================================
-- PREREQUISITE: migrations 01-32 already applied. Migration 33 is
-- intentionally skipped here — reserved for a sibling agent's
-- integrations-layer migration running in parallel this session.
--
-- CONTEXT: same as migration 32's header — this is the "agent rung"
-- registry from docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §4 (the
-- intelligence ladder / agent rungs) and §7 (component registry). Purely
-- additive: a new lookup/registry table describing the AI-assisted actions
-- that already exist in this app today, so future rung-1+ agent work has
-- a real place to register itself instead of every module inventing its
-- own ad hoc "is this AI-assisted" flag.
--
-- NOT APPLIED LIVE: written but not run against the live database, same
-- as migration 32 — a human will apply the full pending batch after
-- review.
--
-- SEED DATA: the 10 seed rows below are the AI Copilot actions that
-- already exist and are deployed today (see CLAUDE.md's "AI / Supabase
-- Edge Functions" section). Action-key strings are taken verbatim from
-- each Edge Function's own request-body `ActionType`/`RosterType`
-- contract (supabase/functions/dissertation-copilot/index.ts,
-- research-copilot/index.ts, casebook-copilot/index.ts,
-- roster-parser/index.ts) — NOT invented names. Note these differ
-- slightly from the (older, more abbreviated) `ai_action_logs.action_type`
-- strings logged client-side (e.g. edge function action `audit_draft` is
-- logged to ai_action_logs as `research_audit`) — the two are separate
-- vocabularies serving separate purposes (request contract vs. audit
-- log), and this table intentionally mirrors the former since that's what
-- a future orchestrator would actually call.
--
--   owner_engine: `dissertation-copilot`, `research-copilot`, and
--   `casebook-copilot` are grouped under 'privybrain-2' (clinical/academic
--   reasoning engine); `roster-parser` is grouped under 'babsbrain-2'
--   (operational/scheduling engine) — this split is asserted per the
--   task brief that requested this seed data, not independently derived
--   from the living-system spec (which was unavailable in this worktree —
--   see this migration's accompanying commit message for the flag).
--
--   rung: 0 = simple structural/formatting/extraction assist with no
--   cross-record synthesis (methodology_check, vancouver_format,
--   extract_ddx, roster structuring). 1 = actions that reason over a
--   larger body of the resident's own work product (audit/scoring/
--   synthesis actions spanning a whole draft, casebook, or logbook).
--   Matches the task brief's own examples (rung 0 for guideline/citation-
--   style checks and roster parsing; rung 1 for audit_draft/audit_case).
--
--   tenant_scope: 'any' for all seed rows — every one of these actions is
--   invoked per-request by whichever resident/tenant is using it today;
--   none of them are platform-operator-only or individual-doctor-only in
--   their current implementation.
-- ====================================================================

CREATE TABLE IF NOT EXISTS agent_manifests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_key text UNIQUE NOT NULL,
  name text NOT NULL,
  owner_engine text NOT NULL CHECK (owner_engine IN ('privybrain-2', 'babsbrain-2', 'none')),
  rung smallint NOT NULL CHECK (rung BETWEEN 0 AND 4),
  description text,
  gates text,
  tenant_scope text NOT NULL DEFAULT 'any' CHECK (tenant_scope IN ('platform', 'org', 'individual', 'any')),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE agent_manifests ENABLE ROW LEVEL SECURITY;

-- Permissive posture matching event_log (migration 32) and every other
-- table since migration 01 (see CLAUDE.md Security Notes) — this is a
-- registry/reference table, not a secret.
CREATE POLICY "agent_manifests_select" ON agent_manifests FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "agent_manifests_insert" ON agent_manifests FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "agent_manifests_update" ON agent_manifests FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

GRANT SELECT (id, agent_key, name, owner_engine, rung, description, gates, tenant_scope, created_at) ON agent_manifests TO anon, authenticated;
GRANT INSERT (agent_key, name, owner_engine, rung, description, gates, tenant_scope) ON agent_manifests TO anon, authenticated;
GRANT UPDATE (name, owner_engine, rung, description, gates, tenant_scope) ON agent_manifests TO anon, authenticated;

INSERT INTO agent_manifests (agent_key, name, owner_engine, rung, description, gates, tenant_scope) VALUES
  ('dissertation_copilot_methodology_check', 'Dissertation Guideline/Methodology Check', 'privybrain-2', 0,
   'Checks a dissertation/proposal draft''s structure and methodology framing against expected sections; backs the Dissertation Assistant''s "Check Departmental Guidelines" action.',
   'tenant_ai_usage quota (check_and_increment_tenant_ai_quota)', 'any'),
  ('dissertation_copilot_vancouver_format', 'Vancouver Citation Formatter', 'privybrain-2', 0,
   'Reformats a resident-supplied reference list into Vancouver citation style.',
   'tenant_ai_usage quota (check_and_increment_tenant_ai_quota)', 'any'),
  ('dissertation_copilot_extract_ddx', 'Differential Diagnosis Extractor', 'privybrain-2', 0,
   'Extracts candidate differential diagnoses (educational aid only, never a diagnosis) from a resident-authored case narrative.',
   'tenant_ai_usage quota (check_and_increment_tenant_ai_quota)', 'any'),
  ('research_copilot_audit_draft', 'Research Draft AI Audit', 'privybrain-2', 1,
   'Audits a research chapter/proposal draft against the workspace''s active research_templates rubric (WACP/NPMCN/ICMJE/etc.).',
   'tenant_ai_usage quota; requires an active research_workspaces row', 'any'),
  ('research_copilot_synthesize_literature_matrix', 'Literature Matrix Synthesizer', 'privybrain-2', 1,
   'Synthesizes a structured literature matrix from a resident-supplied reference list.',
   'tenant_ai_usage quota; requires an active research_workspaces row', 'any'),
  ('research_copilot_generate_table_shells', 'Results Table Shell Generator', 'privybrain-2', 1,
   'Generates dummy/placeholder results-table shells appropriate to the workspace''s study design.',
   'tenant_ai_usage quota; requires an active research_workspaces row', 'any'),
  ('casebook_copilot_audit_case', 'Casebook WACP/PMR Rubric Audit', 'privybrain-2', 1,
   'Scores a clinical case write-up against the WACP 100-point rubric or PMR 7-step checklist, per the workspace''s active casebook_templates framework.',
   'tenant_ai_usage quota; requires an active casebook_workspaces row', 'any'),
  ('casebook_copilot_generate_defense_questions', 'Casebook Viva Defense Question Generator', 'privybrain-2', 1,
   'Generates viva/defense-prep questions grounded in the resident''s own case write-up.',
   'tenant_ai_usage quota; requires an active casebook_workspaces row', 'any'),
  ('casebook_copilot_parse_logbook_curriculum', 'Logbook Curriculum Parser', 'privybrain-2', 1,
   'Structures raw pasted logbook curriculum text into stations/procedures/required-counts for clinical_logbooks. Subadmin-role-gated in the UI.',
   'tenant_ai_usage quota; subadmin role required client-side', 'org'),
  ('roster_parser_structure_roster', 'Roster Document Structurer', 'babsbrain-2', 0,
   'Structures one of the 5 UCH roster document formats (Combined GOP, Consultant GOP, A&E Emergency Call, Afternoon/Priority/Saturday Supervision, Satellite Outposts) from pasted raw text into a typed grid.',
   'tenant_ai_usage quota (check_and_increment_tenant_ai_quota)', 'org')
ON CONFLICT (agent_key) DO NOTHING;

-- ====================================================================
-- END OF MIGRATION 34
-- ====================================================================
