-- ====================================================================
-- Workspc Cases - Migration 81: restricted source capture (slice 1)
-- ====================================================================
-- PREREQUISITE: migrations 01-80. Note that migrations 1-57 are UNKNOWN
-- live status in .workspc-engineering/migration-evidence.json, so before
-- ANY live apply of this file, separately verify live existence of
-- `doctor_profiles` (migration 18) and `update_updated_at_column()`
-- (migration 01). Migration-file existence is not proof of live state.
--
-- NOT APPLIED LIVE. Authored under Harness task t-008850fa
-- (DATABASE_MIGRATION) while the deployment freeze is ACTIVE. File-only.
--
-- REVISED IN PLACE under task t-fe6f0f2c after Codex's peer review (relay
-- TURN 0005) — the storage object policies gained an owned-parent-record
-- check. Editing an existing migration is normally forbidden, and the
-- exception is narrow: this file has never been applied anywhere. Freeze is
-- ACTIVE, it was authored in the same session, migration-evidence records 81
-- as UNKNOWN (no apply claimed), and the commit that introduced it is
-- NOT_PUSHED. Shipping an 82 whose only job was to rewrite 81's own policies
-- would leave a reader reconstructing the real shape from two files. If this
-- file is ever applied anywhere, that exception is spent and every later
-- change must be a new migration.
--
-- WHY THIS EXISTS: the 2026-08-31 live-clinic Cases findings require
-- image-first intake where one encounter owns several ordered source
-- artifacts, captured before any parsing, with raw PHI kept restricted.
-- The repo's two existing case systems cannot represent that:
--   * `case_reports` (mig 04) and `clinical_case_reports` (mig 15) both
--     carry `case_number integer NOT NULL CHECK (BETWEEN 1 AND 15)` plus
--     a per-workspace uniqueness constraint, so a case cannot exist
--     without occupying a numbered Fellowship portfolio slot.
--   * neither has an artifact table, an ordering column, a candidate/
--     follow-up lifecycle, or a provenance concept.
--   * every existing Storage bucket is `public = true` with a
--     `TO public` read policy (migs 04/10/11), and `uploadCaseDocument`
--     returns `getPublicUrl()`, so today's upload path would publish
--     clinical photographs at an unauthenticated URL.
-- This migration is therefore additive and touches nothing above.
--
-- ZERO EXISTING SURFACES TOUCHED. `case_reports`, `clinical_case_reports`,
-- `casebook_templates`, `casebook_workspaces`, `clinical_logbooks`,
-- `admin_logbook_parsing_queue`, the `academic-documents` /
-- `roster-documents` / `guest-signatures` buckets and all of their
-- policies are untouched by this file, exactly as migrations 44/45/48
-- landed their own first slices.
--
-- SCOPE DECISIONS MADE WHILE WRITING THIS (flagged per AGENTS.md's
-- no-silent-scope-creep rule):
--
--   1. DOCTOR-OWNED ONLY, AND `doctor_id` IS `NOT NULL`. Relay TURN 0002
--      (Codex) listed `tenant_id`/`workforce_id` columns alongside
--      `doctor_id`. They are deliberately NOT added here, which is a
--      considered divergence from that review, not an oversight:
--      docs/DATABASE_AND_SECURITY.md records that institutional/
--      plaintext-code flows have no `auth.uid()`, so a nullable
--      `workforce_id` on a PHI-bearing table would be an ownership path
--      that strict RLS cannot express — and the next person to need it
--      would widen the policy to cover NULL owners. That is precisely the
--      `USING (true)` drift migration 25's header already documents on
--      the existing case-content tables. `doctor_id NOT NULL` makes the
--      predicate total: there is no row this policy cannot decide.
--      An institutional capture path is a reviewed auth-architecture
--      change with its own migration, not a column reserved in advance.
--
--   2. NO DE-IDENTIFIED DERIVATIVE TABLE, AND NO `phi_class` COLUMN.
--      Everything these two tables hold is raw/restricted by
--      construction. If a de-identified academic derivative is ever
--      needed it goes in a physically separate child table carrying no
--      identifiers and no storage paths (relay TURN 0002's recommendation,
--      adopted). A `phi_class` enum on a shared table would put raw and
--      de-identified rows behind one policy, which is the weaker boundary.
--
--   3. NO `ai_inferred_unconfirmed` PROVENANCE VALUE. There is no AI path
--      in this slice, so the enum admits only the three provenances a
--      human capture can actually produce. Adding the AI value later is
--      an `ALTER ... DROP/ADD CONSTRAINT` alongside a reviewed AI
--      boundary, and having it absent means no row can claim it today.
--
--   4. `storage_path` CARRIES A CHECK THAT REJECTS URLs. The product rule
--      "store storage paths only, never public URLs" is enforced in the
--      schema (`storage_path !~* '^https?://'`) rather than trusted to
--      application code, because the existing `document_url` columns on
--      `case_reports` show how easily a public URL becomes the stored
--      value.
--
--   5. `ownership_status` DESCRIBES REUSE INTENT ONLY. It answers "is this
--      my case, a shared reference, or a teaching example" for portfolio
--      purposes. It is never consulted by any policy — access is decided
--      solely by `doctor_id`/`auth.uid()`. Recorded because the 31 Aug
--      findings raise ownership as a privacy-adjacent concern and the two
--      concepts must not be conflated.
--
--   6. RLS IS STRICT AND `TO authenticated` ONLY, BREAKING THIS REPO'S
--      PERMISSIVE PRECEDENT ON PURPOSE. Every table since migration 01
--      uses `TO anon, authenticated USING (true)`. These are the first
--      tables intended to hold real patient-identifiable source material,
--      so they get owner-derived predicates and an explicit
--      `REVOKE ... FROM anon` (migration 02's precedent for
--      `workforce`/`settings`) so the anon role cannot reach them even if
--      a future policy is written carelessly.
--
--   7. OWNER DELETE IS GRANTED. The relay lists "deleting/mutating source
--      clinical evidence" as a RED action, which governs *agents and
--      operators*, not the capturing clinician. A doctor who photographs
--      the wrong chart needs to remove it; withholding DELETE would make
--      a mis-capture permanent, which is the worse privacy outcome. Delete
--      is owner-scoped by the same predicate as every other verb.
-- ====================================================================

-- --------------------------------------------------
-- 1. CASE_CAPTURE_RECORDS — metadata-only owning parent
-- --------------------------------------------------
-- Holds NO clinical content and NO direct identifiers. It exists to own
-- artifacts, carry lifecycle/ownership intent, and hold an optional
-- portfolio reference. Clinical source material lives exclusively in
-- case_capture_artifacts (as files in a private bucket).

CREATE TABLE IF NOT EXISTS case_capture_records (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Slice-1 ownership: authenticated individual doctor only. NOT NULL by
  -- design — see scope decision 1. doctor_profiles.id IS auth.users.id
  -- (migration 18), so `doctor_id = auth.uid()` is a real identity check,
  -- the same boundary migration 25 established for personal workspaces.
  doctor_id uuid NOT NULL REFERENCES doctor_profiles(id) ON DELETE CASCADE,

  -- When the clinical encounter/source material was captured, which is
  -- not when the row was created (photographs are frequently entered
  -- later the same day).
  captured_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  -- Clinician's own working label. Must stay de-identified: no patient
  -- name, no hospital number. Enforced by convention and by UI copy, not
  -- by a constraint — a CHECK cannot recognise a name.
  title text,
  subject_label text,

  -- Reuse/portfolio intent ONLY. Never consulted by any RLS policy — see
  -- scope decision 5. 'personal' is Dr Olanipekun's own case;
  -- 'shared_reference' is material shared for reference that must never
  -- silently become his portfolio content; 'example_template' is teaching
  -- material.
  ownership_status text NOT NULL DEFAULT 'personal'
    CHECK (ownership_status IN ('personal', 'shared_reference', 'example_template')),

  -- The candidate/follow-up lifecycle the 31 Aug findings require, which
  -- must tolerate rejection at any stage. Distinct from
  -- clinical_case_reports.status (draft/supervisor_review/approved), which
  -- is a write-up *review* lifecycle, not a candidacy one.
  lifecycle_status text NOT NULL DEFAULT 'quick_capture'
    CHECK (lifecycle_status IN (
      'quick_capture', 'candidate', 'active_follow_up',
      'write_up_ready', 'completed', 'archived', 'dropped'
    )),

  -- Optional, deliberately free text, following the subject_ref convention
  -- documented in migrations 32/37/41/48. Convention:
  -- 'clinical_case_report:<uuid>'. NULL means this capture occupies no
  -- Fellowship slot at all — which is the entire point: it lets a case be
  -- captured and worked up without being forced into portfolio slot 1-15
  -- the way case_reports/clinical_case_reports require.
  portfolio_ref text,

  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_case_capture_records_doctor ON case_capture_records(doctor_id);
CREATE INDEX IF NOT EXISTS idx_case_capture_lifecycle ON case_capture_records(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_case_capture_portfolio ON case_capture_records(portfolio_ref);

DROP TRIGGER IF EXISTS set_case_capture_updated_at ON case_capture_records;
CREATE TRIGGER set_case_capture_updated_at
BEFORE UPDATE ON case_capture_records
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- --------------------------------------------------
-- 2. CASE_CAPTURE_ARTIFACTS — ordered raw/restricted source artifacts
-- --------------------------------------------------
-- One encounter owns many ordered artifacts (31 Aug finding #2): serial
-- limb photographs plus several pages of contemporaneous notes are one
-- capture, not several independent uploads.

CREATE TABLE IF NOT EXISTS case_capture_artifacts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,

  record_id uuid NOT NULL REFERENCES case_capture_records(id) ON DELETE CASCADE,

  -- 1-based capture order within the record. The UNIQUE below is the
  -- deterministic ordering invariant: two artifacts can never claim the
  -- same position, so page 2 of a note set cannot silently become page 3.
  sequence integer NOT NULL CHECK (sequence >= 1),

  artifact_kind text NOT NULL
    CHECK (artifact_kind IN ('note_page', 'clinical_photo', 'document')),

  -- Object path inside the PRIVATE case-source-restricted bucket, e.g.
  -- '<doctor_id>/<record_id>/<uuid>.jpg'. Never a URL — see scope
  -- decision 4. The CHECK is the enforcement, not a comment.
  storage_path text NOT NULL
    CHECK (storage_path <> '' AND storage_path !~* '^https?://'),

  captured_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  -- Clinical governance for images (31 Aug finding #9). Free text in this
  -- slice: the real consent vocabulary is not yet known from usage, same
  -- reasoning migration 48 applied to its own free-text status fields.
  consent_note text,

  -- Epistemic provenance of the artifact's content (31 Aug finding #3).
  -- 'ai_inferred_unconfirmed' is deliberately absent — see scope
  -- decision 3.
  source_provenance text NOT NULL DEFAULT 'source_observed'
    CHECK (source_provenance IN ('source_observed', 'patient_reported', 'clinician_stated')),

  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT unique_artifact_sequence UNIQUE (record_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_case_artifact_record ON case_capture_artifacts(record_id);

-- --------------------------------------------------
-- 3. ROW LEVEL SECURITY — strict, owner-derived, authenticated only
-- --------------------------------------------------
-- Deliberately unlike every other table in this schema. See scope
-- decision 6. There is no USING (true) anywhere below and no policy
-- granted to anon.

ALTER TABLE case_capture_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_capture_artifacts ENABLE ROW LEVEL SECURITY;

-- Belt and braces alongside the policies: Supabase grants a blanket
-- table-level GRANT to anon/authenticated by default, and
-- docs/DATABASE_AND_SECURITY.md records that `tenants` is readable today
-- precisely because that GRANT was never revoked. Revoking here means the
-- anon role cannot reach these tables even if a future policy is written
-- carelessly. Same mechanism migration 02 used for workforce/settings.
REVOKE ALL ON case_capture_records FROM anon;
REVOKE ALL ON case_capture_artifacts FROM anon;

-- --- case_capture_records: direct owner predicate ---

DROP POLICY IF EXISTS "case_capture_records_select" ON case_capture_records;
CREATE POLICY "case_capture_records_select" ON case_capture_records
  FOR SELECT TO authenticated
  USING (doctor_id = auth.uid());

DROP POLICY IF EXISTS "case_capture_records_insert" ON case_capture_records;
CREATE POLICY "case_capture_records_insert" ON case_capture_records
  FOR INSERT TO authenticated
  WITH CHECK (doctor_id = auth.uid());

DROP POLICY IF EXISTS "case_capture_records_update" ON case_capture_records;
CREATE POLICY "case_capture_records_update" ON case_capture_records
  FOR UPDATE TO authenticated
  USING (doctor_id = auth.uid())
  WITH CHECK (doctor_id = auth.uid());

DROP POLICY IF EXISTS "case_capture_records_delete" ON case_capture_records;
CREATE POLICY "case_capture_records_delete" ON case_capture_records
  FOR DELETE TO authenticated
  USING (doctor_id = auth.uid());

-- --- case_capture_artifacts: access derived through the parent ---
-- docs/DATABASE_AND_SECURITY.md: "Child rows derive ownership through the
-- parent when possible." The artifact table carries no owner column of its
-- own, so there is no second copy of ownership to drift out of sync with
-- the parent, and no way to reach an artifact whose record you do not own.

DROP POLICY IF EXISTS "case_capture_artifacts_select" ON case_capture_artifacts;
CREATE POLICY "case_capture_artifacts_select" ON case_capture_artifacts
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM case_capture_records r
    WHERE r.id = case_capture_artifacts.record_id
      AND r.doctor_id = auth.uid()
  ));

DROP POLICY IF EXISTS "case_capture_artifacts_insert" ON case_capture_artifacts;
CREATE POLICY "case_capture_artifacts_insert" ON case_capture_artifacts
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM case_capture_records r
    WHERE r.id = case_capture_artifacts.record_id
      AND r.doctor_id = auth.uid()
  ));

DROP POLICY IF EXISTS "case_capture_artifacts_update" ON case_capture_artifacts;
CREATE POLICY "case_capture_artifacts_update" ON case_capture_artifacts
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM case_capture_records r
    WHERE r.id = case_capture_artifacts.record_id
      AND r.doctor_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM case_capture_records r
    WHERE r.id = case_capture_artifacts.record_id
      AND r.doctor_id = auth.uid()
  ));

DROP POLICY IF EXISTS "case_capture_artifacts_delete" ON case_capture_artifacts;
CREATE POLICY "case_capture_artifacts_delete" ON case_capture_artifacts
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM case_capture_records r
    WHERE r.id = case_capture_artifacts.record_id
      AND r.doctor_id = auth.uid()
  ));

-- --------------------------------------------------
-- 4. PRIVATE STORAGE BUCKET FOR RAW CLINICAL SOURCE
-- --------------------------------------------------
-- The first non-public bucket in this repo. `public = false` means
-- getPublicUrl() cannot serve these objects at all; access is by signed
-- URL, minted only for a caller the policies below already admit.
--
-- Object path convention is '<doctor_id>/<record_id>/<file>'. The policies
-- key off the FIRST segment, so a doctor can only reach objects under their
-- own auth.uid() prefix, AND (for read/write) off the SECOND segment, which
-- must name a capture record that doctor actually owns.
--
-- WHY THE SECOND-SEGMENT CHECK (added after Codex peer review, relay TURN
-- 0005, P2). The owner-prefix check alone already prevented cross-doctor
-- access, so this is not a confidentiality fix. It closes a lifecycle hole:
-- without it a doctor could store raw clinical source anywhere under their
-- own prefix, belonging to no capture record — material that no listing
-- surfaces, no lifecycle_status governs, and no audit reaches. Requiring an
-- owned parent means every object in this bucket is reachable from a row.
--
-- The comparison is `r.id::text = (storage.foldername(name))[2]`, casting the
-- uuid to text rather than the path segment to uuid: a malformed or missing
-- segment then compares unequal instead of raising invalid-input-syntax, and
-- a NULL segment (a path with too few parts) makes EXISTS false. Denial, not
-- an error.
--
-- DELETE IS DELIBERATELY EXEMPT — it keeps only the owner-prefix check. This
-- is a considered divergence from the peer recommendation, which proposed
-- tightening the path invariant without qualifying by verb. Deleting a
-- `case_capture_records` row cascades its artifact rows away but NOT its
-- storage objects. If DELETE also demanded an existing owned parent, then the
-- moment a record was deleted its objects would become permanently
-- undeletable by the only person entitled to remove them — raw PHI stranded
-- in the bucket forever. That is a worse privacy outcome than the hole being
-- closed, so the owner keeps an unconditional path to erase their own
-- objects.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'case-source-restricted',
  'case-source-restricted',
  false,
  26214400, -- 25MB; phone photographs of note pages are larger than the
            -- 10MB the older academic-documents bucket allows.
  ARRAY['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Note the contrast with every existing bucket policy in this repo
-- (migrations 04/10/11), which are all `TO public`. None of the four
-- below grants anything to anon or public.

DROP POLICY IF EXISTS "case_source_restricted_select" ON storage.objects;
CREATE POLICY "case_source_restricted_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'case-source-restricted'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM case_capture_records r
    WHERE r.doctor_id = auth.uid()
      AND r.id::text = (storage.foldername(name))[2]
  )
);

DROP POLICY IF EXISTS "case_source_restricted_insert" ON storage.objects;
CREATE POLICY "case_source_restricted_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'case-source-restricted'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM case_capture_records r
    WHERE r.doctor_id = auth.uid()
      AND r.id::text = (storage.foldername(name))[2]
  )
);

DROP POLICY IF EXISTS "case_source_restricted_update" ON storage.objects;
CREATE POLICY "case_source_restricted_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'case-source-restricted'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM case_capture_records r
    WHERE r.doctor_id = auth.uid()
      AND r.id::text = (storage.foldername(name))[2]
  )
)
WITH CHECK (
  bucket_id = 'case-source-restricted'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM case_capture_records r
    WHERE r.doctor_id = auth.uid()
      AND r.id::text = (storage.foldername(name))[2]
  )
);

-- Owner-prefix only, on purpose. Do not "tighten" this to require an owned
-- parent record to match the other three — see the header note above: it
-- would strand a deleted record's objects in the bucket permanently.
DROP POLICY IF EXISTS "case_source_restricted_delete" ON storage.objects;
CREATE POLICY "case_source_restricted_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'case-source-restricted'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- ====================================================================
-- ROLLBACK (before any real capture data exists — additive and clean):
--   DROP POLICY ... ON storage.objects  (the four case_source_restricted_*)
--   DELETE FROM storage.buckets WHERE id = 'case-source-restricted';
--   DROP TABLE case_capture_artifacts;
--   DROP TABLE case_capture_records;
-- Once real artifacts exist this stops being a clean rollback and becomes
-- a data-retention decision about clinical evidence. Do not treat the
-- statements above as a routine undo after that point.
--
-- END OF MIGRATION 81
-- ====================================================================
