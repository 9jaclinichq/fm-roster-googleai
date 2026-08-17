-- ====================================================================
-- FM Roster - Migration 57: extend doctor-ownership RLS to the newer
-- modules (Scheduling, Meetings, Clinical Writing, Scored Rubric)
-- ====================================================================
-- PREREQUISITE: migrations 01-56 already applied.
--
-- SCOPE, approved explicitly by the app owner after a confirmation
-- question (docs/LIVING_SYSTEM_GAP_AUDIT.md addendum, §2 finding): extend
-- the EXISTING doctor-ownership RLS pattern (migration 25 -> 31 -> 40 -> 51)
-- to the newer modules' doctor-owned rows only. Institutional
-- (tenant/workforce-owned) rows stay exactly as permissive as they are
-- today, completely unchanged. Institutional-table RLS (workforce,
-- submissions, collections, etc.) is explicitly OUT OF SCOPE -- the app
-- owner separately declined that as a much larger, separate initiative
-- needing a real auth architecture change (the plaintext-code login flow
-- has no auth.uid() to write a policy against at all).
--
-- THREE POLICY SHAPES USED BELOW, chosen per table based on its actual
-- ownership columns (verified against each table's own migration, not
-- assumed):
--
--   (a) DIRECT 3-STATE COLUMN CHECK -- for tables with their own
--       tenant_id/doctor_id where BOTH NULL is a valid, real state (a
--       global seed template -- scheduling_instances, meeting_series,
--       clinical_document_types, rubric_templates all have this shape,
--       confirmed via each one's own CHECK constraint or documented
--       ownership comment). Condition:
--         tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id
--       Reads as: institutional rows stay permissive; global rows (doctor_id
--       IS NULL, whether or not tenant_id is also null) stay permissive;
--       only a row that is BOTH non-institutional AND doctor-claimed
--       requires the matching auth.uid(). This is the migration 25 shape
--       (`tenant_id IS NOT NULL OR (doctor_id IS NOT NULL AND auth.uid() =
--       doctor_id)`) rewritten to also leave the global (both-null) state
--       untouched, which migration 25's own shape never had to handle since
--       research_workspaces/casebook_workspaces have no global-template
--       concept -- a naive copy of that exact condition would have made
--       every global seed template unreadable, the same visibility bug
--       already found and fixed for listSchedulingInstances/
--       listFormInstances earlier this session (commits 56878fd/c50d8ff).
--
--   (b) DENORMALIZED-CHILD DIRECT COLUMN CHECK -- for child tables that
--       carry their OWN denormalized tenant_id/doctor_id copied from their
--       parent for cheap filtering (scheduling_entries, meetings,
--       clinical_documents -- each one's own migration explicitly documents
--       this denormalization). Same 3-state-safe condition as (a) applied
--       directly to the child's own columns, rather than joining back to
--       the parent -- avoids an unnecessary join and matches why these
--       columns were denormalized in the first place.
--
--   (c) JOIN-BASED CHECK -- for genuine child tables with NO owner columns
--       of their own at all (rubric_sections, rubric_items), mirroring
--       migration 31's research_chapters/research_correction_logs pattern
--       exactly: EXISTS-join back to the owning parent and apply that
--       parent's own ownership condition.
--
-- rubric_instances gets a FOURTH, slightly different shape: it has
-- tenant_id AND *two* separate assessor columns (assessor_workforce_id,
-- assessor_doctor_id) with no ownership-exclusivity CHECK at all (a real
-- gap in migration 41, not introduced here) -- condition:
--   tenant_id IS NOT NULL OR assessor_workforce_id IS NOT NULL
--     OR (assessor_doctor_id IS NOT NULL AND auth.uid() = assessor_doctor_id)
-- Any institutional signal (tenant OR an institutional assessor) stays
-- permissive; only a row that is purely doctor-claimed (assessor_doctor_id
-- set, nothing institutional) requires the matching auth.uid().
--
-- EXPLICITLY NOT TOUCHED, flagged rather than forced:
--   - meeting_actions: has ONLY owner_workforce_id, no doctor_id column at
--     all -- there is no doctor-owned row shape to protect on this table
--     today. Left fully permissive, unchanged.
--   - scheduling_pipelines: keyed by instance_id with no owner columns of
--     its own and no doctor-owned pipeline concept exists yet (nothing in
--     the app creates one) -- out of the approved table list
--     ("scheduling/meetings/clinical-writing/rubric", i.e. instances +
--     entries/documents/rubric-instances, not pipelines) and left
--     permissive, unchanged.
--   - form_pipelines: same reasoning, and already out of scope per
--     migration 40's own header ("no doctor-owned pipeline concept exists
--     yet").
--
-- Applied live via .tmp-run-migration.cjs immediately after being written,
-- matching this session's established practice for every other migration.
-- ====================================================================

-- --------------------------------------------------
-- 1. SCHEDULING_INSTANCES (shape a) + SCHEDULING_ENTRIES (shape b)
-- --------------------------------------------------

DROP POLICY IF EXISTS "scheduling_instances_select" ON scheduling_instances;
CREATE POLICY "scheduling_instances_select" ON scheduling_instances FOR SELECT TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "scheduling_instances_insert" ON scheduling_instances;
CREATE POLICY "scheduling_instances_insert" ON scheduling_instances FOR INSERT TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "scheduling_instances_update" ON scheduling_instances;
CREATE POLICY "scheduling_instances_update" ON scheduling_instances FOR UPDATE TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id)
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);

DROP POLICY IF EXISTS "scheduling_entries_select" ON scheduling_entries;
CREATE POLICY "scheduling_entries_select" ON scheduling_entries FOR SELECT TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "scheduling_entries_insert" ON scheduling_entries;
CREATE POLICY "scheduling_entries_insert" ON scheduling_entries FOR INSERT TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "scheduling_entries_update" ON scheduling_entries;
CREATE POLICY "scheduling_entries_update" ON scheduling_entries FOR UPDATE TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id)
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);

-- --------------------------------------------------
-- 2. MEETING_SERIES (shape a) + MEETINGS (shape b)
--    meeting_actions explicitly NOT touched -- see header.
-- --------------------------------------------------

DROP POLICY IF EXISTS "meeting_series_select" ON meeting_series;
CREATE POLICY "meeting_series_select" ON meeting_series FOR SELECT TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "meeting_series_insert" ON meeting_series;
CREATE POLICY "meeting_series_insert" ON meeting_series FOR INSERT TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "meeting_series_update" ON meeting_series;
CREATE POLICY "meeting_series_update" ON meeting_series FOR UPDATE TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id)
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);

DROP POLICY IF EXISTS "meetings_select" ON meetings;
CREATE POLICY "meetings_select" ON meetings FOR SELECT TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "meetings_insert" ON meetings;
CREATE POLICY "meetings_insert" ON meetings FOR INSERT TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "meetings_update" ON meetings;
CREATE POLICY "meetings_update" ON meetings FOR UPDATE TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id)
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);

-- --------------------------------------------------
-- 3. CLINICAL_DOCUMENT_TYPES (shape a) + CLINICAL_DOCUMENTS (shape b)
-- --------------------------------------------------

DROP POLICY IF EXISTS "clinical_document_types_select" ON clinical_document_types;
CREATE POLICY "clinical_document_types_select" ON clinical_document_types FOR SELECT TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "clinical_document_types_insert" ON clinical_document_types;
CREATE POLICY "clinical_document_types_insert" ON clinical_document_types FOR INSERT TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "clinical_document_types_update" ON clinical_document_types;
CREATE POLICY "clinical_document_types_update" ON clinical_document_types FOR UPDATE TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id)
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);

DROP POLICY IF EXISTS "clinical_documents_select" ON clinical_documents;
CREATE POLICY "clinical_documents_select" ON clinical_documents FOR SELECT TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "clinical_documents_insert" ON clinical_documents;
CREATE POLICY "clinical_documents_insert" ON clinical_documents FOR INSERT TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "clinical_documents_update" ON clinical_documents;
CREATE POLICY "clinical_documents_update" ON clinical_documents FOR UPDATE TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id)
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);

-- --------------------------------------------------
-- 4. RUBRIC_TEMPLATES (shape a) + RUBRIC_SECTIONS/RUBRIC_ITEMS (shape c,
--    join-based) + RUBRIC_INSTANCES (own shape, see header)
-- --------------------------------------------------

DROP POLICY IF EXISTS "rubric_templates_select" ON rubric_templates;
CREATE POLICY "rubric_templates_select" ON rubric_templates FOR SELECT TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "rubric_templates_insert" ON rubric_templates;
CREATE POLICY "rubric_templates_insert" ON rubric_templates FOR INSERT TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "rubric_templates_update" ON rubric_templates;
CREATE POLICY "rubric_templates_update" ON rubric_templates FOR UPDATE TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id)
  WITH CHECK (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);
DROP POLICY IF EXISTS "rubric_templates_delete" ON rubric_templates;
CREATE POLICY "rubric_templates_delete" ON rubric_templates FOR DELETE TO anon, authenticated
  USING (tenant_id IS NOT NULL OR doctor_id IS NULL OR auth.uid() = doctor_id);

DROP POLICY IF EXISTS "rubric_sections_select" ON rubric_sections;
CREATE POLICY "rubric_sections_select" ON rubric_sections FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM rubric_templates t
    WHERE t.id = rubric_sections.rubric_template_id
      AND (t.tenant_id IS NOT NULL OR t.doctor_id IS NULL OR auth.uid() = t.doctor_id)
  ));
DROP POLICY IF EXISTS "rubric_sections_insert" ON rubric_sections;
CREATE POLICY "rubric_sections_insert" ON rubric_sections FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM rubric_templates t
    WHERE t.id = rubric_sections.rubric_template_id
      AND (t.tenant_id IS NOT NULL OR t.doctor_id IS NULL OR auth.uid() = t.doctor_id)
  ));
DROP POLICY IF EXISTS "rubric_sections_update" ON rubric_sections;
CREATE POLICY "rubric_sections_update" ON rubric_sections FOR UPDATE TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM rubric_templates t
    WHERE t.id = rubric_sections.rubric_template_id
      AND (t.tenant_id IS NOT NULL OR t.doctor_id IS NULL OR auth.uid() = t.doctor_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM rubric_templates t
    WHERE t.id = rubric_sections.rubric_template_id
      AND (t.tenant_id IS NOT NULL OR t.doctor_id IS NULL OR auth.uid() = t.doctor_id)
  ));
DROP POLICY IF EXISTS "rubric_sections_delete" ON rubric_sections;
CREATE POLICY "rubric_sections_delete" ON rubric_sections FOR DELETE TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM rubric_templates t
    WHERE t.id = rubric_sections.rubric_template_id
      AND (t.tenant_id IS NOT NULL OR t.doctor_id IS NULL OR auth.uid() = t.doctor_id)
  ));

DROP POLICY IF EXISTS "rubric_items_select" ON rubric_items;
CREATE POLICY "rubric_items_select" ON rubric_items FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM rubric_sections s JOIN rubric_templates t ON t.id = s.rubric_template_id
    WHERE s.id = rubric_items.rubric_section_id
      AND (t.tenant_id IS NOT NULL OR t.doctor_id IS NULL OR auth.uid() = t.doctor_id)
  ));
DROP POLICY IF EXISTS "rubric_items_insert" ON rubric_items;
CREATE POLICY "rubric_items_insert" ON rubric_items FOR INSERT TO anon, authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM rubric_sections s JOIN rubric_templates t ON t.id = s.rubric_template_id
    WHERE s.id = rubric_items.rubric_section_id
      AND (t.tenant_id IS NOT NULL OR t.doctor_id IS NULL OR auth.uid() = t.doctor_id)
  ));
DROP POLICY IF EXISTS "rubric_items_update" ON rubric_items;
CREATE POLICY "rubric_items_update" ON rubric_items FOR UPDATE TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM rubric_sections s JOIN rubric_templates t ON t.id = s.rubric_template_id
    WHERE s.id = rubric_items.rubric_section_id
      AND (t.tenant_id IS NOT NULL OR t.doctor_id IS NULL OR auth.uid() = t.doctor_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM rubric_sections s JOIN rubric_templates t ON t.id = s.rubric_template_id
    WHERE s.id = rubric_items.rubric_section_id
      AND (t.tenant_id IS NOT NULL OR t.doctor_id IS NULL OR auth.uid() = t.doctor_id)
  ));
DROP POLICY IF EXISTS "rubric_items_delete" ON rubric_items;
CREATE POLICY "rubric_items_delete" ON rubric_items FOR DELETE TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM rubric_sections s JOIN rubric_templates t ON t.id = s.rubric_template_id
    WHERE s.id = rubric_items.rubric_section_id
      AND (t.tenant_id IS NOT NULL OR t.doctor_id IS NULL OR auth.uid() = t.doctor_id)
  ));

DROP POLICY IF EXISTS "rubric_instances_select" ON rubric_instances;
CREATE POLICY "rubric_instances_select" ON rubric_instances FOR SELECT TO anon, authenticated
  USING (tenant_id IS NOT NULL OR assessor_workforce_id IS NOT NULL OR (assessor_doctor_id IS NOT NULL AND auth.uid() = assessor_doctor_id));
DROP POLICY IF EXISTS "rubric_instances_insert" ON rubric_instances;
CREATE POLICY "rubric_instances_insert" ON rubric_instances FOR INSERT TO anon, authenticated
  WITH CHECK (tenant_id IS NOT NULL OR assessor_workforce_id IS NOT NULL OR (assessor_doctor_id IS NOT NULL AND auth.uid() = assessor_doctor_id));
DROP POLICY IF EXISTS "rubric_instances_update" ON rubric_instances;
CREATE POLICY "rubric_instances_update" ON rubric_instances FOR UPDATE TO anon, authenticated
  USING (tenant_id IS NOT NULL OR assessor_workforce_id IS NOT NULL OR (assessor_doctor_id IS NOT NULL AND auth.uid() = assessor_doctor_id))
  WITH CHECK (tenant_id IS NOT NULL OR assessor_workforce_id IS NOT NULL OR (assessor_doctor_id IS NOT NULL AND auth.uid() = assessor_doctor_id));
DROP POLICY IF EXISTS "rubric_instances_delete" ON rubric_instances;
CREATE POLICY "rubric_instances_delete" ON rubric_instances FOR DELETE TO anon, authenticated
  USING (tenant_id IS NOT NULL OR assessor_workforce_id IS NOT NULL OR (assessor_doctor_id IS NOT NULL AND auth.uid() = assessor_doctor_id));

-- ====================================================================
-- END OF MIGRATION 57
-- ====================================================================
