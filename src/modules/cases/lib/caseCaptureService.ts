import { supabase } from '../../../lib/databaseService';

// Workspc Cases module — restricted source capture (slice 1, migration 81).
//
// This is the data-access boundary for `case_capture_records` /
// `case_capture_artifacts` and the PRIVATE `case-source-restricted` bucket.
// It exists to exercise the schema contract; there is no Cases UI yet.
//
// Kept as its own module slice rather than added to
// src/lib/databaseService.ts — same "additive, sits alongside" precedent as
// clinicalWritingService.ts / meetingsService.ts / schedulingService.ts, and
// because databaseService.ts is a declared protected surface
// (.workspc-engineering/protected-surfaces.json, `tenant-billing-surface`).
//
// FOUR INVARIANTS THIS FILE MUST KEEP, each of them asserted statically by
// scripts/verify-cases-capture-slice.cjs:
//
//   1. NO PUBLIC URLs. `getPublicUrl()` is never called here. The bucket is
//      `public = false`, so it would not resolve anyway, but the existing
//      `uploadCaseDocument()` in databaseService.ts (which does return
//      getPublicUrl(), into a public bucket) is exactly the pattern this
//      module must not copy. Reads go through `createSignedUrl`, which
//      mints a short-lived URL only for a caller the RLS policies already
//      admit.
//   2. NO AI / EDGE FUNCTION CALL. Nothing here imports a copilot or
//      invokes `supabase.functions`. The existing casebook copilot ships
//      full case text to an external provider and mirrors 500 characters
//      into `ai_action_logs`, whose SELECT policy is `USING (true)`. Raw
//      capture must not touch that path until an AI boundary is reviewed.
//   3. NO EXISTING SURFACE. Nothing here reads or writes `case_reports`,
//      `clinical_case_reports`, `casebook_*`, or any pre-existing bucket.
//   4. PATHS, NOT URLs, IN THE DATABASE. `storage_path` holds an object
//      path inside the private bucket. Migration 81 backs this with a CHECK
//      constraint rejecting anything matching '^https?://'.
//
// OWNERSHIP: slice 1 is authenticated-individual-doctor only.
// `doctor_id` is NOT NULL and equals `auth.uid()` (doctor_profiles.id IS
// auth.users.id, migration 18). Institutional/plaintext-code capture is out
// of scope — those flows have no `auth.uid()`, so strict RLS could not
// express them, and widening this to cover them is a reviewed
// auth-architecture change, not a column added in advance.

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

export const CASE_SOURCE_BUCKET = 'case-source-restricted';

// Reuse/portfolio intent only. Never consulted for access — access is
// decided solely by doctor_id/auth.uid(). A `shared_reference` case must
// never silently read as the doctor's own portfolio content.
export type CaseOwnershipStatus = 'personal' | 'shared_reference' | 'example_template';

// Candidate/follow-up lifecycle. Tolerates rejection at any stage
// ('dropped'), and is distinct from clinical_case_reports.status, which is
// a write-up review lifecycle.
export type CaseLifecycleStatus =
  | 'quick_capture'
  | 'candidate'
  | 'active_follow_up'
  | 'write_up_ready'
  | 'completed'
  | 'archived'
  | 'dropped';

export type CaseArtifactKind = 'note_page' | 'clinical_photo' | 'document';

// No 'ai_inferred_unconfirmed' — there is no AI path in this slice, and the
// migration's CHECK constraint does not admit it either.
export type CaseArtifactProvenance = 'source_observed' | 'patient_reported' | 'clinician_stated';

// Mirrors case_capture_records (migration 81). Metadata only: this row
// holds no clinical content and no direct identifiers. `subject_label` is a
// de-identified working label — never a patient name or hospital number.
export interface CaseCaptureRecord {
  id: string;
  doctor_id: string;
  captured_at: string;
  title: string | null;
  subject_label: string | null;
  ownership_status: CaseOwnershipStatus;
  lifecycle_status: CaseLifecycleStatus;
  // NULL means this capture occupies no Fellowship portfolio slot at all.
  // Free text following the subject_ref convention (migrations 32/37/41/48):
  // 'clinical_case_report:<uuid>'.
  portfolio_ref: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors case_capture_artifacts (migration 81). `storage_path` is an
// object path inside the private bucket, never a URL.
export interface CaseCaptureArtifact {
  id: string;
  record_id: string;
  sequence: number;
  artifact_kind: CaseArtifactKind;
  storage_path: string;
  captured_at: string;
  consent_note: string | null;
  source_provenance: CaseArtifactProvenance;
  created_at: string;
}

export interface CreateCaptureRecordInput {
  doctorId: string;
  title?: string | null;
  subjectLabel?: string | null;
  capturedAt?: string;
  ownershipStatus?: CaseOwnershipStatus;
  lifecycleStatus?: CaseLifecycleStatus;
}

export interface AddArtifactInput {
  recordId: string;
  artifactKind: CaseArtifactKind;
  storagePath: string;
  capturedAt?: string;
  consentNote?: string | null;
  sourceProvenance?: CaseArtifactProvenance;
}

// Postgres unique_violation. Used to detect two concurrent appends racing
// for the same sequence number — see appendArtifact().
const PG_UNIQUE_VIOLATION = '23505';
const APPEND_MAX_ATTEMPTS = 5;

// Signed-URL lifetime for raw source objects. The default is short because
// these handles point at patient-identifiable material; the maximum is a
// ceiling the caller cannot exceed, not a suggestion. See
// createArtifactSignedUrl().
export const DEFAULT_SIGNED_URL_SECONDS = 60;
export const MAX_SIGNED_URL_SECONDS = 300;

function assertNotAUrl(storagePath: string) {
  if (/^https?:\/\//i.test(storagePath)) {
    throw new Error(
      'case capture artifacts store an object path inside the private bucket, never a URL. ' +
      'Pass the value returned by buildArtifactObjectPath(), not a public or signed URL.'
    );
  }
}

// Object path convention: '<doctorId>/<recordId>/<file>'. The storage
// policies in migration 81 key off the FIRST segment, so the doctor id
// prefix is what confines a caller to their own objects — it is load-
// bearing, not cosmetic.
export function buildArtifactObjectPath(doctorId: string, recordId: string, fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return ext ? `${doctorId}/${recordId}/${stamp}.${ext}` : `${doctorId}/${recordId}/${stamp}`;
}

export const caseCaptureService = {
  // --- RECORDS ---

  async createCaptureRecord(input: CreateCaptureRecordInput): Promise<CaseCaptureRecord> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_capture_records')
      .insert([{
        doctor_id: input.doctorId,
        title: input.title ?? null,
        subject_label: input.subjectLabel ?? null,
        captured_at: input.capturedAt ?? new Date().toISOString(),
        ownership_status: input.ownershipStatus ?? 'personal',
        lifecycle_status: input.lifecycleStatus ?? 'quick_capture',
        // portfolio_ref is intentionally left unset. A capture starts
        // assigned to no Fellowship slot; assignment is a later, explicit
        // clinician action via assignPortfolioRef().
      }])
      .select()
      .single();

    if (error) throw error;
    return data as CaseCaptureRecord;
  },

  // RLS already restricts this to the caller's own rows; the explicit
  // doctor_id filter keeps the query honest when read locally and matches
  // how every other module service in this repo scopes its reads.
  async listCaptureRecords(doctorId: string): Promise<CaseCaptureRecord[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_capture_records')
      .select('*')
      .eq('doctor_id', doctorId)
      .order('captured_at', { ascending: false });

    if (error) throw error;
    return (data || []) as CaseCaptureRecord[];
  },

  async getCaptureRecord(recordId: string): Promise<CaseCaptureRecord | null> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_capture_records')
      .select('*')
      .eq('id', recordId)
      .maybeSingle();

    if (error) throw error;
    return (data as CaseCaptureRecord) || null;
  },

  async setLifecycleStatus(recordId: string, status: CaseLifecycleStatus): Promise<CaseCaptureRecord> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_capture_records')
      .update({ lifecycle_status: status })
      .eq('id', recordId)
      .select()
      .single();

    if (error) throw error;
    return data as CaseCaptureRecord;
  },

  // Assigning a portfolio slot is an explicit, reversible clinician action.
  // `clearPortfolioRef` exists because a case that stops being a good
  // portfolio candidate must be able to return to unassigned without being
  // deleted — the whole reason portfolio_ref is nullable free text rather
  // than the NOT NULL 1..15 integer the existing case tables use.
  async assignPortfolioRef(recordId: string, clinicalCaseReportId: string): Promise<CaseCaptureRecord> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_capture_records')
      .update({ portfolio_ref: `clinical_case_report:${clinicalCaseReportId}` })
      .eq('id', recordId)
      .select()
      .single();

    if (error) throw error;
    return data as CaseCaptureRecord;
  },

  async clearPortfolioRef(recordId: string): Promise<CaseCaptureRecord> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_capture_records')
      .update({ portfolio_ref: null })
      .eq('id', recordId)
      .select()
      .single();

    if (error) throw error;
    return data as CaseCaptureRecord;
  },

  // --- ARTIFACTS ---

  async listArtifacts(recordId: string): Promise<CaseCaptureArtifact[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_capture_artifacts')
      .select('*')
      .eq('record_id', recordId)
      .order('sequence', { ascending: true });

    if (error) throw error;
    return (data || []) as CaseCaptureArtifact[];
  },

  // Insert at an explicit position. Fails loudly on a duplicate sequence
  // rather than silently reordering the capture.
  async addArtifact(input: AddArtifactInput & { sequence: number }): Promise<CaseCaptureArtifact> {
    checkSupabase();
    assertNotAUrl(input.storagePath);

    const { data, error } = await supabase!
      .from('case_capture_artifacts')
      .insert([{
        record_id: input.recordId,
        sequence: input.sequence,
        artifact_kind: input.artifactKind,
        storage_path: input.storagePath,
        captured_at: input.capturedAt ?? new Date().toISOString(),
        consent_note: input.consentNote ?? null,
        source_provenance: input.sourceProvenance ?? 'source_observed',
      }])
      .select()
      .single();

    if (error) throw error;
    return data as CaseCaptureArtifact;
  },

  // Append to the end of the ordered set.
  //
  // Reading max(sequence) and then inserting is a check-then-write race —
  // one of the bug classes CLAUDE.md names explicitly. Two tabs uploading
  // note pages at once would both read the same max and collide. The
  // UNIQUE(record_id, sequence) constraint makes that collision a loud
  // error instead of a silent reorder, and this retry turns the loud error
  // into correct behaviour: on 23505 we re-read and try the next position.
  // Bounded so a genuinely broken state cannot spin.
  async appendArtifact(input: AddArtifactInput): Promise<CaseCaptureArtifact> {
    checkSupabase();
    assertNotAUrl(input.storagePath);

    let lastError: unknown = null;

    for (let attempt = 0; attempt < APPEND_MAX_ATTEMPTS; attempt += 1) {
      const { data: existing, error: readError } = await supabase!
        .from('case_capture_artifacts')
        .select('sequence')
        .eq('record_id', input.recordId)
        .order('sequence', { ascending: false })
        .limit(1);

      if (readError) throw readError;

      const nextSequence = existing && existing.length ? (existing[0] as { sequence: number }).sequence + 1 : 1;

      const { data, error } = await supabase!
        .from('case_capture_artifacts')
        .insert([{
          record_id: input.recordId,
          sequence: nextSequence,
          artifact_kind: input.artifactKind,
          storage_path: input.storagePath,
          captured_at: input.capturedAt ?? new Date().toISOString(),
          consent_note: input.consentNote ?? null,
          source_provenance: input.sourceProvenance ?? 'source_observed',
        }])
        .select()
        .single();

      if (!error) return data as CaseCaptureArtifact;

      if ((error as { code?: string }).code !== PG_UNIQUE_VIOLATION) throw error;
      lastError = error;
    }

    throw lastError;
  },

  // --- PRIVATE STORAGE ---

  // Uploads raw source material into the private bucket. Returns the object
  // PATH, which is what gets stored on the artifact row. There is no public
  // URL to return: the bucket is public = false.
  async uploadArtifactFile(doctorId: string, recordId: string, file: File): Promise<string> {
    checkSupabase();

    const objectPath = buildArtifactObjectPath(doctorId, recordId, file.name);

    const { error } = await supabase!.storage
      .from(CASE_SOURCE_BUCKET)
      .upload(objectPath, file, { upsert: false });

    if (error) throw error;
    return objectPath;
  },

  // Upload plus row insert as one operation, with the upload rolled back if
  // the insert fails.
  //
  // Calling uploadArtifactFile() and appendArtifact() separately leaves a
  // window where raw source material sits in the private bucket with no row
  // referencing it — an orphan nothing lists and nobody knows to delete,
  // which for PHI is the worst kind of leftover. Storage and Postgres cannot
  // share a transaction, so this compensates instead: on insert failure the
  // just-uploaded object is removed.
  //
  // The rollback is best-effort by necessity. If it also fails, the original
  // insert error is still what propagates — it is the more useful one — and
  // the orphan is at least confined to the caller's own
  // '<doctorId>/<recordId>/' prefix, so a later sweep can find it.
  // (Reported by Codex peer review, relay TURN 0005.)
  async captureArtifact(
    doctorId: string,
    recordId: string,
    file: File,
    meta: Omit<AddArtifactInput, 'recordId' | 'storagePath'>
  ): Promise<CaseCaptureArtifact> {
    checkSupabase();

    const storagePath = await caseCaptureService.uploadArtifactFile(doctorId, recordId, file);

    try {
      return await caseCaptureService.appendArtifact({ ...meta, recordId, storagePath });
    } catch (insertError) {
      try {
        await supabase!.storage.from(CASE_SOURCE_BUCKET).remove([storagePath]);
      } catch (rollbackError) {
        console.warn(
          'Case capture: artifact row insert failed AND rolling back the uploaded object failed. ' +
          `Orphaned object left at ${storagePath}.`,
          rollbackError
        );
      }
      throw insertError;
    }
  },

  // Short-lived signed URL for viewing one artifact. Supabase mints this
  // only for a caller the bucket policies admit, and it expires — unlike
  // getPublicUrl(), which is permanent and unauthenticated. Default 60s:
  // long enough to render an image, short enough that a leaked link is not
  // a durable exposure.
  //
  // The TTL is clamped rather than trusted. It is caller-supplied, and a
  // caller that passes a day's worth of seconds would turn a deliberately
  // ephemeral handle on raw PHI into something durable enough to paste
  // elsewhere. Clamped rather than rejected so a careless caller still gets
  // a working URL, just not a long-lived one.
  // (Reported by Codex peer review, relay TURN 0005.)
  async createArtifactSignedUrl(storagePath: string, expiresInSeconds = DEFAULT_SIGNED_URL_SECONDS): Promise<string> {
    checkSupabase();

    const requested = Number(expiresInSeconds);
    if (!Number.isFinite(requested) || requested < 1) {
      throw new Error('createArtifactSignedUrl requires a positive number of seconds.');
    }
    const ttlSeconds = Math.min(Math.floor(requested), MAX_SIGNED_URL_SECONDS);

    const { data, error } = await supabase!.storage
      .from(CASE_SOURCE_BUCKET)
      .createSignedUrl(storagePath, ttlSeconds);

    if (error) throw error;
    if (!data?.signedUrl) throw new Error('Supabase returned no signed URL for the requested case source artifact.');
    return data.signedUrl;
  },

  // Removes one artifact: its row and the object that row points at.
  //
  // Takes an id ONLY. The previous signature accepted an
  // `{ id, storage_path }` pair supplied by the caller, which RLS cannot
  // police: both halves can be inside the same doctor's scope while
  // referring to different artifacts, so a mismatched pair would delete
  // object B and row A — leaving row B pointing at nothing and A's object
  // orphaned. Ownership is not pair integrity. Re-reading the row under RLS
  // makes the path provably the one that row owns.
  // (Reported by Codex peer review, relay TURN 0005, as P1.)
  //
  // Object-first ordering is deliberate and retry-safe: if the row delete
  // fails afterwards, the row still names a now-absent object and a repeat
  // call converges (removing an already-absent object is not an error). The
  // reverse order would drop the only reference to a still-present file.
  // See migration 81's note on why owner delete is granted at all.
  async deleteArtifact(artifactId: string): Promise<void> {
    checkSupabase();

    const { data, error: readError } = await supabase!
      .from('case_capture_artifacts')
      .select('id, storage_path')
      .eq('id', artifactId)
      .maybeSingle();

    if (readError) throw readError;
    if (!data) {
      throw new Error(`Case capture artifact ${artifactId} was not found, or is not yours to delete.`);
    }

    const { storage_path: storagePath } = data as Pick<CaseCaptureArtifact, 'id' | 'storage_path'>;

    const { error: storageError } = await supabase!.storage
      .from(CASE_SOURCE_BUCKET)
      .remove([storagePath]);

    if (storageError) throw storageError;

    const { error } = await supabase!
      .from('case_capture_artifacts')
      .delete()
      .eq('id', artifactId);

    if (error) throw error;
  },
};
