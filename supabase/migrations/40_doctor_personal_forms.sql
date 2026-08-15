-- Migration 40: doctor-owned personal Forms instances
--
-- Extends the established doctor-ownership pattern (migration 25:
-- research_workspaces/casebook_workspaces; migration 31: their child
-- content tables) to the Forms module (migration 35's form_instances/
-- form_entries/form_pipelines), per
-- docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7's "Individual customisation"
-- line: "create and edit their own instances (personal forms, personal
-- research tracks, personal scheduling) ... Both toolsets are UI over the
-- same registry-backed instance model -- there is one customisation
-- engine, exposed with different scopes (tenant scope: org vs tenant
-- scope: individual)." Today form_instances/form_entries are org-only
-- (tenant_id NOT NULL) -- an unaffiliated doctor (migration 18/25,
-- DoctorHomeView.tsx) has no way to build a personal form.
--
-- SCOPE / SHAPE DECISION -- form_instances vs. form_entries are NOT treated
-- the same way, and that's deliberate:
--
--   1. form_instances is a PARENT/owning row, exactly like
--      research_workspaces/casebook_workspaces in migration 25 -- it gets
--      the same treatment: tenant_id becomes nullable, a new doctor_id
--      column is added (FK to doctor_profiles, same as migration 25), a
--      CHECK enforces exactly one owner, and RLS gets a direct
--      auth.uid() = doctor_id branch for doctor-owned rows.
--
--   2. form_entries is a CHILD table keyed by instance_id, not a second
--      parent -- the same relationship research_chapters/
--      research_correction_logs/clinical_case_reports have to their own
--      parent workspace table (see migration 31). Per migration 31's own
--      precedent, a child table does NOT get its own doctor_id column;
--      ownership is derived by joining back to the parent and checking
--      THAT row's tenant_id/doctor_id split. Concretely for form_entries:
--        - form_entries.tenant_id becomes nullable. It has to: an entry
--          submitted against a doctor-owned (tenant_id-NULL) instance
--          would otherwise be impossible to insert at all under the
--          existing NOT NULL constraint.
--        - No form_entries.doctor_id column is added. That value is
--          already fully knowable via
--          form_entries.instance_id -> form_instances.doctor_id, and
--          duplicating it onto every entry risks the two disagreeing
--          (e.g. an entry's doctor_id column pointing at a different
--          doctor than its own instance) with nothing to keep them in
--          sync. A join-based policy, identical in shape to migration 31's
--          three child-table policies, is both simpler and can't drift out
--          of sync with its parent.
--
-- form_pipelines is NOT touched here -- no doctor-owned pipeline concept
-- exists yet (DoctorFormsBuilderPanel.tsx does not create pipelines, and
-- nothing in this pass needs one). Flagged as a future follow-up if a
-- personal-form auto-action need ever comes up, same as every other
-- explicitly-flagged non-scope item in this codebase's migrations.
--
-- RLS: institutional rows (tenant_id IS NOT NULL, on form_instances; or,
-- for form_entries, an instance whose tenant_id IS NOT NULL) keep today's
-- permissive USING(true)/WITH CHECK(true) behavior, completely unchanged.
-- Doctor-owned rows require auth.uid() = doctor_id (directly on
-- form_instances, or via the form_instances join for form_entries) -- a
-- REAL, non-permissive RLS boundary, same as migration 25/31. Policy
-- syntax below is copied from migration 25 (direct doctor_id branch) and
-- migration 31 (join-based child-table branch), not written from scratch.
--
-- NOT APPLIED LIVE. Per this task's security boundary, this migration is
-- written for review only -- a human applies it (and the rest of this
-- wave) to the live database afterward.
-- ====================================================================

-- --------------------------------------------------
-- 1. FORM_INSTANCES -- add doctor ownership path (parent table, same
--    shape as migration 25's research_workspaces/casebook_workspaces)
-- --------------------------------------------------

ALTER TABLE form_instances ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE form_instances ADD COLUMN IF NOT EXISTS doctor_id uuid REFERENCES doctor_profiles(id) ON DELETE CASCADE;

ALTER TABLE form_instances DROP CONSTRAINT IF EXISTS form_instances_owner_check;
ALTER TABLE form_instances ADD CONSTRAINT form_instances_owner_check CHECK (
  (tenant_id IS NOT NULL AND doctor_id IS NULL) OR (tenant_id IS NULL AND doctor_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_form_instances_doctor ON form_instances(doctor_id);

DROP POLICY IF EXISTS "form_instances_select" ON form_instances;
CREATE POLICY "form_instances_select" ON form_instances FOR SELECT TO anon, authenticated
  USING (tenant_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "form_instances_insert" ON form_instances;
CREATE POLICY "form_instances_insert" ON form_instances FOR INSERT TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));
DROP POLICY IF EXISTS "form_instances_update" ON form_instances;
CREATE POLICY "form_instances_update" ON form_instances FOR UPDATE TO anon, authenticated
  USING (tenant_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id))
  WITH CHECK (tenant_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() = doctor_id));

-- --------------------------------------------------
-- 2. FORM_ENTRIES -- child table; tenant_id becomes nullable so an entry
--    against a doctor-owned instance can exist at all. Ownership is
--    derived via a join to form_instances (same pattern as migration 31's
--    child-table policies) -- no new doctor_id column added here, see the
--    header above for why.
-- --------------------------------------------------

ALTER TABLE form_entries ALTER COLUMN tenant_id DROP NOT NULL;

DROP POLICY IF EXISTS "form_entries_select" ON form_entries;
CREATE POLICY "form_entries_select" ON form_entries FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM form_instances fi
    WHERE fi.id = form_entries.instance_id
      AND (fi.tenant_id IS NOT NULL OR (fi.doctor_id IS NOT NULL AND auth.uid() = fi.doctor_id))
  ));
DROP POLICY IF EXISTS "form_entries_insert" ON form_entries;
CREATE POLICY "form_entries_insert" ON form_entries FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM form_instances fi
    WHERE fi.id = form_entries.instance_id
      AND (fi.tenant_id IS NOT NULL OR (fi.doctor_id IS NOT NULL AND auth.uid() = fi.doctor_id))
  ));
DROP POLICY IF EXISTS "form_entries_update" ON form_entries;
CREATE POLICY "form_entries_update" ON form_entries FOR UPDATE TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM form_instances fi
    WHERE fi.id = form_entries.instance_id
      AND (fi.tenant_id IS NOT NULL OR (fi.doctor_id IS NOT NULL AND auth.uid() = fi.doctor_id))
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM form_instances fi
    WHERE fi.id = form_entries.instance_id
      AND (fi.tenant_id IS NOT NULL OR (fi.doctor_id IS NOT NULL AND auth.uid() = fi.doctor_id))
  ));

-- ====================================================================
-- END OF MIGRATION 40
-- ====================================================================
