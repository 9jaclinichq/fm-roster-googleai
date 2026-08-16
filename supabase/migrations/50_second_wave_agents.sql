-- ====================================================================
-- FM Roster - Migration 50: agent_manifests seed rows for the second
-- wave of real rung-1 agents (bridging the "harness gap" this session's
-- anatomy/physiology/biochemistry audit found: exactly one real agent,
-- reaching one module, one user type).
-- ====================================================================
-- PREREQUISITE: migrations 01-49 already applied, in particular 34
-- (agent_manifests) and 49 (insights.doctor_id — the second agent below
-- is the first real writer of a doctor-scoped insight).
--
-- Reserved here (schema only) so the two application-code build tasks
-- that implement these agents don't need to touch a migration at all —
-- avoids a migration-number collision between two parallel worktree
-- tasks, same precedent as reserving migration numbers ahead of parallel
-- work elsewhere this session.
--
-- Two new agents, both rung 1 ("shown as suggestion," per spec §4 — same
-- rung as Submission Chaser, deliberately not attempting rung 2 in this
-- pass; see the chat context this migration was authored under for why
-- climbing the rung ladder is being deferred to its own explicit
-- go-ahead):
--
--   1. `babsbrain2_meeting_action_chaser` — same "engine" (BabsBrain-2)
--      and shape as Submission Chaser: reads meeting_actions past their
--      due_date for a tenant, raises a dismissible insight per overdue
--      action. Closes the Meetings & Actions module's "zero intelligence"
--      gap the audit found (meetingsService.ts even had a dead, commented-
--      out emitEvent call sitting there for this exact purpose).
--   2. `privybrain2_rubric_compliance_chaser` — PrivyBrain-2 engine
--      (matching the spec's own Clinical & Professional Writing / academic
--      module engine assignment), reads scored rubric_instances (migration
--      41/46) whose recommendation is 'review_required' or
--      'recommend_revise', raises a dismissible insight naming the
--      workspace/case. Runs in two modes: an org-wide sweep (tenant_id +
--      workforce_id both set on the resulting insight, so it reaches BOTH
--      the Chief via InsightsStrip AND the resident via their own
--      UnifiedRecordView) and a doctor-scoped sweep (doctor_id set,
--      tenant_id null) — the FIRST real producer of a doctor-scoped
--      insight, closing the other half of the gap migration 49 made
--      structurally possible but didn't itself populate.
--
-- NOT APPLIED LIVE. Written for review; a human applies it afterward.
-- ====================================================================

INSERT INTO agent_manifests (agent_key, name, owner_engine, rung, description, gates, tenant_scope) VALUES
  ('babsbrain2_meeting_action_chaser', 'Meeting Action Chaser', 'babsbrain-2', 1,
   'Reads a tenant''s meeting_actions (migration 45) with status open/in_progress and a due_date in the past; for each, raises a persisted, dismissible insight naming the action and how overdue it is. Idempotent per action via the same dedup convention as Submission Chaser.',
   'Shown as a suggestion in InsightsStrip.tsx; no autonomous action taken — a human reads the insight and follows up manually. Dismissing is a plain UPDATE.',
   'org'),
  ('privybrain2_rubric_compliance_chaser', 'Rubric Compliance Chaser', 'privybrain-2', 1,
   'Reads scored rubric_instances (migration 41, seeded with real WACP content in migration 46) whose recommendation is review_required or recommend_revise; raises a dismissible insight per instance, naming the workspace/case and the recommendation. Runs as an org-wide sweep (insight reaches both the Chief and the resident it is about) and as a doctor-scoped sweep for unlinked individual doctors (migration 49''s doctor_id column).',
   'Shown as a suggestion in InsightsStrip.tsx (org sweep) and UnifiedRecordView.tsx (doctor sweep); no autonomous action taken. Dismissing is a plain UPDATE.',
   'any')
ON CONFLICT (agent_key) DO NOTHING;

-- ====================================================================
-- END OF MIGRATION 50
-- ====================================================================
