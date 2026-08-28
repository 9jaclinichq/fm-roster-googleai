-- ====================================================================
-- Migration 75: roster_revisions — minimum revision-safe Chief roster
-- editing lifecycle (Start / Save / Discard / Publish Revision)
-- ====================================================================
-- WRITTEN FOR REVIEW ONLY. NOT APPLIED LIVE. Do not run this against the
-- live database until a human explicitly lifts the current deployment
-- freeze and applies it (same discipline as migrations 66-74).
--
-- WHY THIS EXISTS: MultiRosterManagerView.tsx's saveDraft() (unchanged,
-- confirmed by fresh re-read) currently writes
-- `status: masterRoster.status === 'published' ? 'published' : 'chief_review'`
-- — i.e. if a roster is already published, clicking "Save Draft" silently
-- overwrites the live, resident-facing combined_master_rosters row while
-- leaving status/published_at/announcement state untouched. This
-- migration adds the smallest schema that closes that gap: an explicit,
-- auditable, publishable revision lifecycle, WITHOUT changing what
-- residents read at all.
--
-- CRITICAL INVARIANT, PROVEN NOT ASSUMED: combined_master_rosters remains
-- the exact resident-facing projection it is today. This migration adds
-- new tables/functions and exactly ONE additive, nullable column to
-- combined_master_rosters (current_revision_id) — it does not touch, and
-- cannot affect, resident_get_current_assignment() (migrations 67/70/71/
-- 72) or resident_get_current_full_roster() (migration 73), neither of
-- which is redefined anywhere in this file. Both will be shown
-- byte-identical before/after at apply time, same discipline as every
-- prior migration in this series.
--
-- SCHEMA RECONCILIATION (per explicit instruction to reconcile field
-- names/types against current schema before writing this migration):
-- roster_revisions' 4 grid columns
-- (gop_clinic_grid/emergency_call_grid/supervision_grid/satellite_grid)
-- are the EXACT same column names/types as combined_master_rosters
-- itself (migration 10) — not a bundled `grids` jsonb wrapper (an earlier
-- sketch's shape) — so a revision row and the live row are structurally
-- symmetric: copying one into the other at Start/Publish time is a
-- straight column-to-column copy, and
-- rosterReconciliation.ts's computeReconciliationIssues() (which already
-- accepts a plain object with these exact 4 field names, see that
-- file's CombinedMasterRoster-shaped parameter) can validate a
-- revision's content with zero reshaping, reused as-is in a later slice.
--
-- STATUSES: 'editing' (the Chief's current in-progress working copy —
-- AT MOST ONE per collection, enforced by a partial unique index, so a
-- second "Start Revision" click idempotently reopens the same row rather
-- than forking a duplicate), 'published' (the currently-live content —
-- AT MOST ONE per collection, also partial-unique-indexed; copied into
-- combined_master_rosters the moment it becomes published; never edited
-- again after that), 'superseded' (a formerly-published revision,
-- permanent audit history, never mutated again), 'discarded' (an
-- 'editing' revision the Chief abandoned without publishing — a real,
-- necessary terminal state, not a delete, so the audit trail this table
-- exists to provide is never destroyed by an abandoned edit).
--
-- REVISION NUMBER ALLOCATION, RACE-SAFE: chief_start_roster_revision()
-- below locks the collection's own combined_master_rosters row
-- (`SELECT ... FOR UPDATE`) BEFORE computing
-- `COALESCE(MAX(revision_number), 0) + 1` for that collection — reusing
-- the row that already, uniquely, exists per collection (migration 10's
-- own UNIQUE(collection_id) constraint) as a natural per-collection
-- mutex, rather than inventing a new lock primitive or sequence. This
-- closes the race a bare MAX+1 would otherwise have between two
-- near-simultaneous "Start Revision" calls.
--
-- PROVENANCE: `source` distinguishes, at minimum conceptually per this
-- slice's explicit scope: 'chief_manual' (a human Chief edit — the only
-- value ANY RPC in this migration actually produces), 'external_import'
-- (a future imported/external-document-sourced revision — e.g. Drive,
-- though nothing Drive-specific is named here), and 'ai_proposal' (a
-- future AI-proposed revision). `source_reference` is a free, optional
-- text pointer (a future Drive doc id/URL or AI proposal id) — opaque,
-- never consulted by any validation/business logic, never authoritative.
-- NEITHER 'external_import' NOR 'ai_proposal' IS PRODUCED BY ANYTHING IN
-- THIS MIGRATION — no Drive integration, no AI/LLM call, no agent
-- event, no automatic edit execution exists anywhere here. This is
-- schema headroom for a future seam, not a built feature.
--
-- `changed_by` is a coarse, deterministic role-level attribution
-- ('chief') — NOT a per-individual verified identity. This app's Chief
-- login model is a single shared, per-tenant admin_access_code (same
-- credential every existing chief_* RPC already verifies) with no
-- linkage to a specific workforce member's identity; inventing a finer-
-- grained attribution scheme is out of scope for this slice and would be
-- a new identity system, not a revision-lifecycle concern. A plain text
-- column can be widened to something finer later with no migration
-- needed to the column itself.
--
-- DIFF: `diff_summary` stores a MINIMAL, deterministic structural
-- indicator — which of the 4 sections actually differ from the revision
-- this one is based on (`gop`/`emergency`/`supervision`/`satellite`
-- booleans) — computed once, at publish time, via plain jsonb equality
-- (`IS DISTINCT FROM`). This is deliberately NOT the full semantic-diff
-- (already built and proven this session for the September re-ingestion,
-- and reusable later) — "enough deterministic before/after information
-- to establish the later diff-review seam," per this slice's explicit
-- scope, not "a sophisticated visual diff engine."
--
-- CONCURRENCY: `updated_at` is the optimistic-concurrency token.
-- chief_save_roster_revision() and chief_publish_roster_revision() both
-- require the caller to pass back the `updated_at` it last read
-- (`p_expected_updated_at`) and reject with a clear error if it no longer
-- matches the live row — a stale browser/editor can never silently
-- overwrite a newer save. No pessimistic cross-request locking is
-- introduced (this app's Chief login model is single-admin-per-tenant;
-- optimistic locking is the smallest sufficient mechanism, not a
-- generic versioning framework).
--
-- SECURITY: roster_revisions has RLS ENABLED with ZERO policies —
-- IDENTICAL posture to roster_section_config (migration 74, already
-- live-verified: a live SET LOCAL ROLE anon test there confirmed SELECT
-- returns 0 rows and INSERT is rejected with 42501 despite ambient
-- Supabase-default table grants). No 'editing'/'discarded'/'superseded'
-- revision is ever reachable by a resident session under any
-- circumstance. All 4 new RPCs are SECURITY DEFINER, re-verify the
-- caller via settings.admin_access_code (identical pattern to every
-- existing chief_* RPC — chief_update_tenant_terminology, migration 59;
-- chief_upsert_roster_section_config, migration 74), and derive BOTH
-- tenant_id AND the operative collection_id only from that verified
-- code (via settings.current_collection_id, the exact same derivation
-- resident_get_current_assignment/resident_get_current_full_roster
-- already use for their own tenant's current collection) — no RPC in
-- this migration accepts a client-supplied tenant_id OR collection_id
-- parameter at all, so there is nothing for a caller to supply that
-- would let them target another organisation's collection or revision.
-- A revision id IS a client-supplied parameter (save/discard/publish
-- must know which revision to act on) but every lookup filters by
-- `tenant_id = v_tenant_id` in the same query — another tenant's
-- revision id simply does not match any row, exactly like every other
-- tenant-scoped RPC in this schema.
--
-- MULTI-TENANCY: no UCH Family Medicine-specific term or clinical
-- assumption appears anywhere in this migration's actual SQL code — the
-- 4 section columns are the same pre-existing generic storage shape
-- already used everywhere else in this app.
-- ====================================================================

CREATE TABLE IF NOT EXISTS roster_revisions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES collections(id),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  revision_number integer NOT NULL,
  status text NOT NULL CHECK (status IN ('editing', 'published', 'superseded', 'discarded')),
  gop_clinic_grid jsonb NOT NULL DEFAULT '{}'::jsonb,
  emergency_call_grid jsonb NOT NULL DEFAULT '{}'::jsonb,
  supervision_grid jsonb NOT NULL DEFAULT '{}'::jsonb,
  satellite_grid jsonb NOT NULL DEFAULT '{}'::jsonb,
  based_on_revision_id uuid REFERENCES roster_revisions(id),
  source text NOT NULL DEFAULT 'chief_manual' CHECK (source IN ('chief_manual', 'external_import', 'ai_proposal')),
  source_reference text,
  changed_by text NOT NULL DEFAULT 'chief',
  change_reason text,
  diff_summary jsonb,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  published_at timestamptz,
  CONSTRAINT unique_roster_revision_number_per_collection UNIQUE (collection_id, revision_number)
);

-- At most one 'editing' revision per collection at any time.
CREATE UNIQUE INDEX IF NOT EXISTS unique_editing_revision_per_collection
  ON roster_revisions (collection_id) WHERE (status = 'editing');

-- At most one 'published' revision per collection at any time.
CREATE UNIQUE INDEX IF NOT EXISTS unique_published_revision_per_collection
  ON roster_revisions (collection_id) WHERE (status = 'published');

CREATE INDEX IF NOT EXISTS idx_roster_revisions_collection ON roster_revisions (collection_id);

ALTER TABLE roster_revisions ENABLE ROW LEVEL SECURITY;
-- Deliberately NO POLICIES — same RPC-only posture as roster_section_config
-- (migration 74). Every read/write goes through a SECURITY DEFINER RPC.

-- One small, additive, nullable pointer — Chief/audit-tooling metadata
-- only. No resident-facing RPC reads this column; it exists purely so a
-- future Chief/audit UI can answer "which revision is this row's current
-- content" without a separate lookup query. Existing rows (published
-- before this model existed) simply have this NULL until their next
-- revision-based publish.
ALTER TABLE combined_master_rosters ADD COLUMN IF NOT EXISTS current_revision_id uuid REFERENCES roster_revisions(id);

-- ====================================================================
-- chief_start_roster_revision(): begin (or idempotently reopen) an
-- editing revision for the Chief's own tenant's current collection.
-- Requires the collection's roster to already be published — a roster
-- that has never been published yet has nothing to "revise"; it keeps
-- using the existing direct-edit saveDraft()/publish() flow unchanged.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.chief_start_roster_revision(p_admin_code text)
RETURNS roster_revisions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_collection_id uuid;
  v_master combined_master_rosters%ROWTYPE;
  v_existing_editing roster_revisions%ROWTYPE;
  v_based_on_id uuid;
  v_next_number integer;
  v_row roster_revisions%ROWTYPE;
BEGIN
  SELECT s.tenant_id, s.current_collection_id INTO v_tenant_id, v_collection_id
  FROM settings s WHERE s.admin_access_code = p_admin_code;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;
  IF v_collection_id IS NULL THEN
    RAISE EXCEPTION 'No current collection cycle is open for this tenant' USING ERRCODE = 'P0001';
  END IF;

  -- Idempotent reopen: return the existing editing revision AS-IS
  -- (never re-snapshot — that would silently discard in-progress edits).
  SELECT * INTO v_existing_editing FROM roster_revisions
  WHERE collection_id = v_collection_id AND status = 'editing';
  IF FOUND THEN
    RETURN v_existing_editing;
  END IF;

  -- Lock the collection's one existing combined_master_rosters row —
  -- the natural per-collection mutex for race-safe revision_number
  -- allocation (see this migration's header).
  SELECT * INTO v_master FROM combined_master_rosters
  WHERE collection_id = v_collection_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No roster exists yet for this collection' USING ERRCODE = 'P0001';
  END IF;
  IF v_master.status <> 'published' THEN
    RAISE EXCEPTION 'Roster is not yet published — edit it directly until its first publish' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_based_on_id FROM roster_revisions
  WHERE collection_id = v_collection_id AND status = 'published';

  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_number
  FROM roster_revisions WHERE collection_id = v_collection_id;

  INSERT INTO roster_revisions (
    collection_id, tenant_id, revision_number, status,
    gop_clinic_grid, emergency_call_grid, supervision_grid, satellite_grid,
    based_on_revision_id, source, changed_by
  ) VALUES (
    v_collection_id, v_tenant_id, v_next_number, 'editing',
    v_master.gop_clinic_grid, v_master.emergency_call_grid, v_master.supervision_grid, v_master.satellite_grid,
    v_based_on_id, 'chief_manual', 'chief'
  ) RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_start_roster_revision(text) TO anon, authenticated;

-- ====================================================================
-- chief_save_roster_revision(): persist the Chief's in-progress edits
-- into an 'editing' revision only — combined_master_rosters is never
-- touched by this function under any circumstance.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.chief_save_roster_revision(
  p_admin_code text,
  p_revision_id uuid,
  p_expected_updated_at timestamptz,
  p_gop_clinic_grid jsonb,
  p_emergency_call_grid jsonb,
  p_supervision_grid jsonb,
  p_satellite_grid jsonb,
  p_change_reason text DEFAULT NULL
)
RETURNS roster_revisions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row roster_revisions%ROWTYPE;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM roster_revisions
  WHERE id = p_revision_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revision not found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status <> 'editing' THEN
    RAISE EXCEPTION 'Revision is not editable' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'This revision was changed elsewhere — reload before saving again' USING ERRCODE = '40001';
  END IF;

  UPDATE roster_revisions SET
    gop_clinic_grid = p_gop_clinic_grid,
    emergency_call_grid = p_emergency_call_grid,
    supervision_grid = p_supervision_grid,
    satellite_grid = p_satellite_grid,
    change_reason = COALESCE(p_change_reason, change_reason),
    updated_at = timezone('utc'::text, now())
  WHERE id = p_revision_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_save_roster_revision(text, uuid, timestamptz, jsonb, jsonb, jsonb, jsonb, text) TO anon, authenticated;

-- ====================================================================
-- chief_discard_roster_revision(): abandon an in-progress editing
-- revision without publishing it. Terminal, auditable — never a delete.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.chief_discard_roster_revision(p_admin_code text, p_revision_id uuid)
RETURNS roster_revisions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row roster_revisions%ROWTYPE;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM roster_revisions
  WHERE id = p_revision_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revision not found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status <> 'editing' THEN
    RAISE EXCEPTION 'Revision is not in an editable state' USING ERRCODE = 'P0001';
  END IF;

  UPDATE roster_revisions SET status = 'discarded', updated_at = timezone('utc'::text, now())
  WHERE id = p_revision_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_discard_roster_revision(text, uuid) TO anon, authenticated;

-- ====================================================================
-- chief_publish_roster_revision(): the ONLY function that ever writes to
-- combined_master_rosters as part of the revision lifecycle. Atomically
-- promotes one revision's content into the live row, marks the prior
-- published revision (if any) superseded, and stores a minimal
-- deterministic diff_summary. resident_get_current_assignment() and
-- resident_get_current_full_roster() are read entirely unaware of any of
-- this — they only ever see combined_master_rosters' own columns, updated
-- exactly once, atomically, by this single UPDATE.
-- ====================================================================
CREATE OR REPLACE FUNCTION public.chief_publish_roster_revision(
  p_admin_code text,
  p_revision_id uuid,
  p_expected_updated_at timestamptz
)
RETURNS roster_revisions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row roster_revisions%ROWTYPE;
  v_master combined_master_rosters%ROWTYPE;
  v_diff jsonb;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_row FROM roster_revisions
  WHERE id = p_revision_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revision not found' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.status <> 'editing' THEN
    RAISE EXCEPTION 'Revision is not in a publishable state' USING ERRCODE = 'P0001';
  END IF;
  IF v_row.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'This revision was changed elsewhere — reload before publishing' USING ERRCODE = '40001';
  END IF;

  SELECT * INTO v_master FROM combined_master_rosters
  WHERE collection_id = v_row.collection_id AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No roster exists for this collection' USING ERRCODE = 'P0001';
  END IF;

  -- Minimal deterministic diff: which sections actually differ from the
  -- currently-published content (not yet the full semantic diff — see
  -- this migration's header).
  v_diff := jsonb_build_object(
    'based_on_revision_id', v_row.based_on_revision_id,
    'sections_changed', jsonb_build_object(
      'gop', v_row.gop_clinic_grid IS DISTINCT FROM v_master.gop_clinic_grid,
      'emergency', v_row.emergency_call_grid IS DISTINCT FROM v_master.emergency_call_grid,
      'supervision', v_row.supervision_grid IS DISTINCT FROM v_master.supervision_grid,
      'satellite', v_row.satellite_grid IS DISTINCT FROM v_master.satellite_grid
    )
  );

  -- The ONE atomic write to the live, resident-facing row. Status is
  -- already 'published' (chief_start_roster_revision only starts from an
  -- already-published roster) — only content, current_revision_id, and
  -- published_at change.
  UPDATE combined_master_rosters SET
    gop_clinic_grid = v_row.gop_clinic_grid,
    emergency_call_grid = v_row.emergency_call_grid,
    supervision_grid = v_row.supervision_grid,
    satellite_grid = v_row.satellite_grid,
    current_revision_id = v_row.id,
    published_at = timezone('utc'::text, now())
  WHERE id = v_master.id;

  -- Supersede whatever was previously published for this collection
  -- (there is at most one, by the partial unique index).
  UPDATE roster_revisions SET status = 'superseded', updated_at = timezone('utc'::text, now())
  WHERE collection_id = v_row.collection_id AND status = 'published' AND id <> v_row.id;

  UPDATE roster_revisions SET
    status = 'published',
    published_at = timezone('utc'::text, now()),
    updated_at = timezone('utc'::text, now()),
    diff_summary = v_diff
  WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_publish_roster_revision(text, uuid, timestamptz) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 75
-- ====================================================================
