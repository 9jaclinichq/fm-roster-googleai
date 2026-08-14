-- Migration 25: unlinked individual-doctor personal workspaces
--
-- Review annotation (workspc.pdf, page 4): an unaffiliated/"not affiliated"
-- individual doctor should get real tools, not the bare waiting-room screen
-- DoctorHomeView has shown since migration 18. No dependency on migrations
-- 23/24 — this can ship independently.
--
-- WHY RESEARCH + CASEBOOK, NOT THE ROSTER FORM: `submissions` (the monthly
-- rotation/leave form) has a NOT NULL workforce_id and no doctor_id path at
-- all — a rotation submission is inherently tied to an org's collection
-- cycle, so "let an unaffiliated doctor fill the roster form" doesn't have
-- a coherent meaning. research_workspaces and casebook_workspaces, by
-- contrast, already have nullable tenant_id/workforce_id (migrations 13/15)
-- built anticipating exactly this — see each of those migrations' headers:
-- "a workspace with NULL tenant_id and NULL workforce_id would belong to
-- such a user once that identity system exists."
--
-- RLS: TIGHTENED FOR THE DOCTOR-OWNED SUBSET ONLY — a real, called-out
-- change, not silently expanded scope. Institutional rows (workforce_id
-- NOT NULL) keep exactly today's permissive USING(true)/WITH CHECK(true).
-- Doctor-owned rows (doctor_id NOT NULL) require auth.uid() = doctor_id.
-- Justification: doctor_profiles (migration 18) already established that a
-- real auth.uid() boundary applies to anything doctor-identity-owned; a
-- personal research/casebook workspace is private notes, not a shared
-- institutional record — leaving it USING(true) would mean anyone holding
-- the anon key could read or edit any doctor's personal workspace directly
-- via the REST API. This is the app's third real RLS boundary, after
-- doctor_profiles itself and the deny-then-RPC pattern on
-- platform_operators/guest_review_invites.
--
-- NOT FIXED HERE, FLAGGED EXPLICITLY: child tables (research_chapters,
-- clinical_case_reports, clinical_logbooks, research_correction_logs,
-- admin_logbook_parsing_queue) key off workspace_id, not doctor_id, and
-- stay fully permissive — a doctor's actual case/chapter CONTENT rows
-- remain reachable via direct REST call even though the parent workspace
-- row is now protected. Closing that means adding a doctor-aware join
-- policy to five more tables; a follow-up, not attempted in this pass.
--
-- ALSO NOT DONE HERE: AI Copilot access for these workspaces. The quota
-- machinery (user_subscriptions.workforce_id NOT NULL,
-- check_and_increment_tenant_ai_quota requiring a real tenant_id) has no
-- doctor-only path — a personal-quota model is a separate task. Everything
-- client-side in each workspace view (PICO framework, chapters, rubric
-- scorecard, genogram/Family APGAR tools) works unchanged for a doctor
-- owner; only the AI Copilot panel is left disabled for doctor-owned rows
-- (enforced client-side, not by this migration).

ALTER TABLE research_workspaces ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE;
ALTER TABLE casebook_workspaces ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_research_workspaces_doctor ON research_workspaces(doctor_id);
CREATE INDEX IF NOT EXISTS idx_casebook_workspaces_doctor ON casebook_workspaces(doctor_id);

DROP POLICY IF EXISTS "research_workspaces_select" ON research_workspaces;
CREATE POLICY "research_workspaces_select" ON research_workspaces FOR SELECT TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "research_workspaces_insert" ON research_workspaces;
CREATE POLICY "research_workspaces_insert" ON research_workspaces FOR INSERT TO anon, authenticated
  WITH CHECK (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "research_workspaces_update" ON research_workspaces;
CREATE POLICY "research_workspaces_update" ON research_workspaces FOR UPDATE TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id))
  WITH CHECK (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));

DROP POLICY IF EXISTS "casebook_workspaces_select" ON casebook_workspaces;
CREATE POLICY "casebook_workspaces_select" ON casebook_workspaces FOR SELECT TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "casebook_workspaces_insert" ON casebook_workspaces;
CREATE POLICY "casebook_workspaces_insert" ON casebook_workspaces FOR INSERT TO anon, authenticated
  WITH CHECK (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "casebook_workspaces_update" ON casebook_workspaces;
CREATE POLICY "casebook_workspaces_update" ON casebook_workspaces FOR UPDATE TO anon, authenticated
  USING (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id))
  WITH CHECK (workforce_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));

-- ====================================================================
-- END OF MIGRATION 25
-- ====================================================================
