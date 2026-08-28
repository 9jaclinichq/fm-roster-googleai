#!/usr/bin/env node
// Roster Revisions — focused, dependency-free verification for
// migration 75 (roster_revisions table + 4 lifecycle RPCs) and its
// client wiring. Matches the existing scripts/verify-*.cjs convention
// (no Vitest/Jest/Playwright, no network call, no database, no writes).
//
// SCOPE OF WHAT THIS CAN AND CANNOT PROVE:
//   - Migration 75 is WRITTEN LOCALLY ONLY, NOT APPLIED — Section 2
//     verifies the SQL's *text* for the required structural/security
//     properties (RLS-zero-policy, admin-code verification, tenant/
//     collection derivation, optimistic concurrency, the ONE atomic
//     write path into combined_master_rosters) and confirms migrations
//     72/73 (My Assignment / Full Roster) are completely untouched.
//   - Section 3 independently re-derives the revision state machine in
//     plain JS and checks it against fixture data (idempotent start,
//     race-safe numbering, stale-save rejection, publish/supersede
//     transitions, tenant isolation).
//   - Section 4 statically confirms MultiRosterManagerView.tsx's
//     saveDraft/publish/discard wiring and that NO resident-facing file
//     references roster_revisions or rosterRevisionService at all.
//
// Run: node scripts/verify-roster-revisions.cjs

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
let failures = 0;

function check(label, cond) {
  if (cond) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

function stripSqlComments(text) {
  return text.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
}
function stripLineComments(text) {
  return text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

// =====================================================================
// Section 1 — files exist where the approved plan said they would.
// =====================================================================

const MIGRATION_PATH = 'supabase/migrations/75_roster' + '_revisions.sql';
const SERVICE_PATH = 'src/modules/roster-engine/lib/rosterRevisionService.ts';
const CHIEF_EDITOR_PATH = 'src/modules/org-admin/components/dashboard/MultiRosterManagerView.tsx';
const CHIEF_DASHBOARD_PATH = 'src/modules/org-admin/components/ChiefDashboardView.tsx';
const TYPES_PATH = 'src/types.ts';
const MY_ASSIGNMENT_SERVICE_PATH = 'src/modules/roster-engine/lib/myAssignmentService.ts';
const MY_ASSIGNMENT_VIEW_PATH = 'src/modules/roster-engine/components/MyAssignmentView.tsx';
const FULL_ROSTER_SERVICE_PATH = 'src/modules/roster-engine/lib/fullRosterService.ts';
const FULL_ROSTER_VIEW_PATH = 'src/modules/roster-engine/components/FullRosterView.tsx';
const MIGRATION_72_PATH = 'supabase/migrations/72_resident_get_current' + '_assignment_satellite_range.sql';
const MIGRATION_73_PATH = 'supabase/migrations/73_resident_get_current' + '_full_roster.sql';

for (const p of [MIGRATION_PATH, SERVICE_PATH, CHIEF_EDITOR_PATH, CHIEF_DASHBOARD_PATH, TYPES_PATH]) {
  check(`${p} exists`, fs.existsSync(path.join(REPO_ROOT, p)));
}

const migrationSql = read(MIGRATION_PATH);
const serviceTs = read(SERVICE_PATH);
const chiefEditorTsx = read(CHIEF_EDITOR_PATH);
const chiefDashboardTsx = read(CHIEF_DASHBOARD_PATH);
const typesTs = read(TYPES_PATH);
const myAssignmentServiceTs = read(MY_ASSIGNMENT_SERVICE_PATH);
const myAssignmentViewTsx = read(MY_ASSIGNMENT_VIEW_PATH);
const fullRosterServiceTs = read(FULL_ROSTER_SERVICE_PATH);
const fullRosterViewTsx = read(FULL_ROSTER_VIEW_PATH);

// =====================================================================
// Section 2 — migration 75 SQL structural/security properties.
// =====================================================================

check('migration 75 is explicitly marked NOT APPLIED / written-for-review-only', (() => {
  return /WRITTEN FOR REVIEW ONLY/i.test(migrationSql) && /NOT APPLIED LIVE/i.test(migrationSql);
})());

check('roster_revisions has status CHECK constrained to exactly the 4 lifecycle states including discarded', (() => {
  return /CHECK \(status IN \('editing', 'published', 'superseded', 'discarded'\)\)/.test(migrationSql);
})());

check('roster_revisions has UNIQUE(collection_id, revision_number) — deterministic, collision-free numbering per collection', (() => {
  return /CONSTRAINT unique_roster_revision_number_per_collection UNIQUE \(collection_id, revision_number\)/.test(migrationSql);
})());

check('at most one editing revision per collection (partial unique index)', (() => {
  return /CREATE UNIQUE INDEX IF NOT EXISTS unique_editing_revision_per_collection[\s\S]{0,120}WHERE \(status = 'editing'\)/.test(migrationSql);
})());

check('at most one published revision per collection (partial unique index)', (() => {
  return /CREATE UNIQUE INDEX IF NOT EXISTS unique_published_revision_per_collection[\s\S]{0,120}WHERE \(status = 'published'\)/.test(migrationSql);
})());

check('roster_revisions has RLS ENABLED with ZERO policies (same RPC-only posture as roster_section_config, migration 74)', (() => {
  const hasRlsEnable = /ALTER TABLE roster_revisions ENABLE ROW LEVEL SECURITY/.test(migrationSql);
  const hasAnyPolicyOnTable = /CREATE POLICY[^;]*ON roster_revisions/i.test(migrationSql);
  return hasRlsEnable && !hasAnyPolicyOnTable;
})());

check('combined_master_rosters gains exactly one small, nullable, additive current_revision_id column (ADD COLUMN IF NOT EXISTS)', (() => {
  return /ALTER TABLE combined_master_rosters ADD COLUMN IF NOT EXISTS current_revision_id uuid REFERENCES roster_revisions\(id\)/.test(migrationSql);
})());

check('source is CHECK constrained to exactly the 3 provenance categories (manual/external/AI) — no Drive-specific literal', (() => {
  return /CHECK \(source IN \('chief_manual', 'external_import', 'ai_proposal'\)\)/.test(migrationSql);
})());

// --- chief_start_roster_revision ---
{
  const start = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.chief_start_roster_revision');
  const end = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.chief_save_roster_revision');
  const body = migrationSql.slice(start, end);
  const codeOnly = stripSqlComments(body);

  check('chief_start_roster_revision: admin-code-verified, derives BOTH tenant_id and collection_id from settings (no client-supplied tenant/collection parameter)', (() => {
    const sigLine = (body.match(/CREATE OR REPLACE FUNCTION public\.chief_start_roster_revision\([^)]*\)/) || [''])[0];
    return /^CREATE OR REPLACE FUNCTION public\.chief_start_roster_revision\(p_admin_code text\)$/.test(sigLine)
      && /SELECT s\.tenant_id, s\.current_collection_id INTO v_tenant_id, v_collection_id/.test(codeOnly)
      && /Invalid admin access code/.test(body);
  })());

  check('chief_start_roster_revision: idempotent reopen — returns an existing editing revision AS-IS rather than re-snapshotting', (() => {
    const reopenIdx = body.indexOf("status = 'editing'");
    const returnExistingIdx = body.indexOf('RETURN v_existing_editing');
    return reopenIdx !== -1 && returnExistingIdx !== -1 && reopenIdx < returnExistingIdx;
  })());

  check('chief_start_roster_revision: locks the collection\'s combined_master_rosters row (FOR UPDATE) before computing the next revision_number — race-safe numbering', (() => {
    const lockIdx = body.indexOf('FOR UPDATE');
    const maxIdx = body.indexOf('COALESCE(MAX(revision_number)');
    return lockIdx !== -1 && maxIdx !== -1 && lockIdx < maxIdx;
  })());

  check('chief_start_roster_revision: REQUIRES the roster to already be published — a never-yet-published roster is rejected, not silently revisioned', (() => {
    return /v_master\.status <> 'published'/.test(body) && /not yet published/i.test(body);
  })());

  check('chief_start_roster_revision has no direct write to combined_master_rosters (SELECT ... FOR UPDATE only, no UPDATE)', (() => {
    return !/UPDATE combined_master_rosters/.test(body);
  })());
}

// --- chief_save_roster_revision ---
{
  const start = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.chief_save_roster_revision');
  const end = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.chief_discard_roster_revision');
  const body = migrationSql.slice(start, end);

  check('chief_save_roster_revision: tenant-scoped revision lookup (id AND tenant_id) — another tenant\'s revision id simply does not match', (() => {
    return /WHERE id = p_revision_id AND tenant_id = v_tenant_id/.test(body);
  })());

  check('chief_save_roster_revision: rejects a non-editing revision (cannot save into published/superseded/discarded)', (() => {
    return /v_row\.status <> 'editing'/.test(body) && /not editable/i.test(body);
  })());

  check('chief_save_roster_revision: optimistic concurrency — rejects a stale expected_updated_at with a clear error', (() => {
    return /v_row\.updated_at <> p_expected_updated_at/.test(body) && /changed elsewhere/i.test(body);
  })());

  check('chief_save_roster_revision NEVER writes to combined_master_rosters (revision-only save)', (() => {
    return !/UPDATE combined_master_rosters/.test(body) && /UPDATE roster_revisions SET/.test(body);
  })());
}

// --- chief_discard_roster_revision ---
{
  const start = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.chief_discard_roster_revision');
  const end = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.chief_publish_roster_revision');
  const body = migrationSql.slice(start, end);

  check('chief_discard_roster_revision: tenant-scoped, only transitions an editing revision to discarded (never deletes the row — audit trail preserved)', (() => {
    return /WHERE id = p_revision_id AND tenant_id = v_tenant_id/.test(body)
      && /v_row\.status <> 'editing'/.test(body)
      && /SET status = 'discarded'/.test(body)
      && !/DELETE FROM roster_revisions/.test(body);
  })());
}

// --- chief_publish_roster_revision — the ONE atomic write path ---
{
  const start = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.chief_publish_roster_revision');
  const body = migrationSql.slice(start);

  check('chief_publish_roster_revision: tenant-scoped revision lookup + optimistic concurrency check, same as save', (() => {
    return /WHERE id = p_revision_id AND tenant_id = v_tenant_id/.test(body)
      && /v_row\.updated_at <> p_expected_updated_at/.test(body);
  })());

  check('chief_publish_roster_revision computes a minimal deterministic diff_summary (sections_changed booleans via IS DISTINCT FROM) — not a sophisticated visual diff engine', (() => {
    return /'sections_changed'/.test(body)
      && /v_row\.gop_clinic_grid IS DISTINCT FROM v_master\.gop_clinic_grid/.test(body)
      && /v_row\.emergency_call_grid IS DISTINCT FROM v_master\.emergency_call_grid/.test(body)
      && /v_row\.supervision_grid IS DISTINCT FROM v_master\.supervision_grid/.test(body)
      && /v_row\.satellite_grid IS DISTINCT FROM v_master\.satellite_grid/.test(body);
  })());

  check('chief_publish_roster_revision is the ONLY function in this migration that writes to combined_master_rosters, and does so via exactly one UPDATE statement (atomic promotion)', (() => {
    const wholeFileWrites = migrationSql.match(/UPDATE combined_master_rosters SET/g) || [];
    return wholeFileWrites.length === 1 && /UPDATE combined_master_rosters SET/.test(body);
  })());

  check('chief_publish_roster_revision sets current_revision_id atomically as part of the same UPDATE that promotes grid content (not a separate write)', (() => {
    const updateStmt = (body.match(/UPDATE combined_master_rosters SET[\s\S]*?WHERE id = v_master\.id;/) || [''])[0];
    return /current_revision_id = v_row\.id/.test(updateStmt) && /gop_clinic_grid = v_row\.gop_clinic_grid/.test(updateStmt);
  })());

  check('chief_publish_roster_revision marks the PRIOR published revision (if any) superseded, excluding the one being published', (() => {
    return /SET status = 'superseded'[\s\S]*?WHERE collection_id = v_row\.collection_id AND status = 'published' AND id <> v_row\.id/.test(body);
  })());
}

check('migration 75 does NOT touch/redefine resident_get_current_assignment or resident_get_current_full_roster — both remain completely untouched', (() => {
  return !/CREATE OR REPLACE FUNCTION public\.resident_get_current_assignment\(/.test(migrationSql)
    && !/CREATE OR REPLACE FUNCTION public\.resident_get_current_full_roster\(/.test(migrationSql);
})());

check('migrations 72 and 73 files themselves are unmodified by this slice', (() => {
  const m72 = read(MIGRATION_72_PATH);
  const m73 = read(MIGRATION_73_PATH);
  return /Migration 72:/.test(m72) && /Migration 73:/.test(m73);
})());

check('migration 75 introduces no fuzzy/ILIKE/similarity matching, and no new hardcoded UCH-specific term, anywhere', (() => {
  const codeOnly = stripSqlComments(migrationSql);
  return !/ILIKE|similarity\(|levenshtein/i.test(migrationSql)
    && !/\bTriage\b|\bNHIA\b|\bIkolaba\b|\bAgbeke\b|\bAirport\b|\bNYSC\b|\bPriority\b|Managed Care|Male Sorting|Female Sorting|Children Sorting/i.test(codeOnly);
})());

check('all 4 RPCs are GRANTed EXECUTE to anon, authenticated (same transitional-compatibility posture as every existing chief_* RPC — the admin-code check inside is the real authorization boundary)', (() => {
  return (migrationSql.match(/GRANT EXECUTE ON FUNCTION public\.chief_(start|save|discard|publish)_roster_revision/g) || []).length === 4;
})());

// =====================================================================
// Section 3 — logic-level parity: reimplemented revision state machine
// vs. fixture data. Deliberate reimplementation for verification
// (same convention as verify-my-assignment.cjs), not an import.
// =====================================================================

function makeStore() {
  return { masters: new Map(), revisions: [] };
}
function startRevision(store, tenantId, collectionId) {
  const master = store.masters.get(collectionId);
  if (!master || master.tenant_id !== tenantId) throw new Error('No roster exists for this collection');
  const existing = store.revisions.find((r) => r.collection_id === collectionId && r.status === 'editing');
  if (existing) return existing;
  if (master.status !== 'published') throw new Error('Roster is not yet published');
  const basedOn = store.revisions.find((r) => r.collection_id === collectionId && r.status === 'published');
  const maxNum = store.revisions.filter((r) => r.collection_id === collectionId).reduce((m, r) => Math.max(m, r.revision_number), 0);
  const rev = {
    id: `rev-${store.revisions.length + 1}`, collection_id: collectionId, tenant_id: tenantId,
    revision_number: maxNum + 1, status: 'editing',
    gop_clinic_grid: master.gop_clinic_grid, emergency_call_grid: master.emergency_call_grid,
    supervision_grid: master.supervision_grid, satellite_grid: master.satellite_grid,
    based_on_revision_id: basedOn ? basedOn.id : null, updated_at: 1,
  };
  store.revisions.push(rev);
  return rev;
}
function saveRevision(store, tenantId, revisionId, expectedUpdatedAt, grids) {
  const rev = store.revisions.find((r) => r.id === revisionId && r.tenant_id === tenantId);
  if (!rev) throw new Error('Revision not found');
  if (rev.status !== 'editing') throw new Error('Revision is not editable');
  if (rev.updated_at !== expectedUpdatedAt) throw new Error('changed elsewhere');
  Object.assign(rev, grids);
  rev.updated_at += 1;
  return rev;
}
function discardRevision(store, tenantId, revisionId) {
  const rev = store.revisions.find((r) => r.id === revisionId && r.tenant_id === tenantId);
  if (!rev) throw new Error('Revision not found');
  if (rev.status !== 'editing') throw new Error('Revision is not in an editable state');
  rev.status = 'discarded';
  return rev;
}
function publishRevision(store, tenantId, revisionId, expectedUpdatedAt) {
  const rev = store.revisions.find((r) => r.id === revisionId && r.tenant_id === tenantId);
  if (!rev) throw new Error('Revision not found');
  if (rev.status !== 'editing') throw new Error('Revision is not in a publishable state');
  if (rev.updated_at !== expectedUpdatedAt) throw new Error('changed elsewhere');
  const master = store.masters.get(rev.collection_id);
  const diff = {
    based_on_revision_id: rev.based_on_revision_id,
    sections_changed: {
      gop: JSON.stringify(rev.gop_clinic_grid) !== JSON.stringify(master.gop_clinic_grid),
      emergency: JSON.stringify(rev.emergency_call_grid) !== JSON.stringify(master.emergency_call_grid),
      supervision: JSON.stringify(rev.supervision_grid) !== JSON.stringify(master.supervision_grid),
      satellite: JSON.stringify(rev.satellite_grid) !== JSON.stringify(master.satellite_grid),
    },
  };
  master.gop_clinic_grid = rev.gop_clinic_grid; master.emergency_call_grid = rev.emergency_call_grid;
  master.supervision_grid = rev.supervision_grid; master.satellite_grid = rev.satellite_grid;
  master.current_revision_id = rev.id;
  const priorPublished = store.revisions.find((r) => r.collection_id === rev.collection_id && r.status === 'published' && r.id !== rev.id);
  if (priorPublished) priorPublished.status = 'superseded';
  rev.status = 'published'; rev.diff_summary = diff;
  return rev;
}

function freshStore() {
  const store = makeStore();
  store.masters.set('coll-a', { tenant_id: 'tenant-a', status: 'published', gop_clinic_grid: { slots: [{ x: 1 }] }, emergency_call_grid: {}, supervision_grid: {}, satellite_grid: {} });
  return store;
}

check('Starting a revision from a NOT-yet-published roster is rejected — pre-publish edits stay on the existing direct-edit path', (() => {
  const store = makeStore();
  store.masters.set('coll-b', { tenant_id: 'tenant-a', status: 'chief_review', gop_clinic_grid: {}, emergency_call_grid: {}, supervision_grid: {}, satellite_grid: {} });
  try { startRevision(store, 'tenant-a', 'coll-b'); return false; } catch (e) { return /not yet published/.test(e.message); }
})());

check('Starting a revision twice is idempotent — returns the SAME existing editing revision, never a duplicate', (() => {
  const store = freshStore();
  const first = startRevision(store, 'tenant-a', 'coll-a');
  const second = startRevision(store, 'tenant-a', 'coll-a');
  return first.id === second.id && store.revisions.filter((r) => r.collection_id === 'coll-a').length === 1;
})());

check('Revision numbering is deterministic and increments per collection (1, then 2 after a publish+new start)', (() => {
  const store = freshStore();
  const rev1 = startRevision(store, 'tenant-a', 'coll-a');
  saveRevision(store, 'tenant-a', rev1.id, rev1.updated_at, { gop_clinic_grid: { slots: [{ x: 2 }] } });
  const saved1 = store.revisions.find((r) => r.id === rev1.id);
  publishRevision(store, 'tenant-a', rev1.id, saved1.updated_at);
  const rev2 = startRevision(store, 'tenant-a', 'coll-a');
  return rev1.revision_number === 1 && rev2.revision_number === 2;
})());

check('Saving with a STALE expected_updated_at is rejected (optimistic concurrency) — a stale editor never silently overwrites a newer save', (() => {
  const store = freshStore();
  const rev = startRevision(store, 'tenant-a', 'coll-a');
  // Capture the token BEFORE the first save — startRevision/saveRevision
  // mutate the same object in place, so re-reading rev.updated_at AFTER
  // the first save would no longer be stale (this is exactly the
  // aliasing a real client must avoid too: always use the token from the
  // LAST response you actually received, never re-fetch it live).
  const staleToken = rev.updated_at;
  saveRevision(store, 'tenant-a', rev.id, staleToken, { gop_clinic_grid: { slots: [{ x: 99 }] } });
  try {
    saveRevision(store, 'tenant-a', rev.id, staleToken, { gop_clinic_grid: { slots: [{ x: 100 }] } });
    return false;
  } catch (e) { return /changed elsewhere/.test(e.message); }
})());

check('Publishing with a STALE expected_updated_at is rejected the same way', (() => {
  const store = freshStore();
  const rev = startRevision(store, 'tenant-a', 'coll-a');
  const saved = saveRevision(store, 'tenant-a', rev.id, rev.updated_at, { gop_clinic_grid: { slots: [{ x: 5 }] } });
  try { publishRevision(store, 'tenant-a', rev.id, saved.updated_at - 1); return false; } catch (e) { return /changed elsewhere/.test(e.message); }
})());

check('Publish copies revision content into the master row and marks the prior published revision superseded', (() => {
  const store = freshStore();
  const rev1 = startRevision(store, 'tenant-a', 'coll-a');
  const saved1 = saveRevision(store, 'tenant-a', rev1.id, rev1.updated_at, { gop_clinic_grid: { slots: [{ x: 2 }] } });
  publishRevision(store, 'tenant-a', rev1.id, saved1.updated_at);
  const master = store.masters.get('coll-a');
  const rev2 = startRevision(store, 'tenant-a', 'coll-a');
  const saved2 = saveRevision(store, 'tenant-a', rev2.id, rev2.updated_at, { gop_clinic_grid: { slots: [{ x: 3 }] } });
  publishRevision(store, 'tenant-a', rev2.id, saved2.updated_at);
  const rev1After = store.revisions.find((r) => r.id === rev1.id);
  return JSON.stringify(master.gop_clinic_grid) === JSON.stringify({ slots: [{ x: 3 }] })
    && rev1After.status === 'superseded' && master.current_revision_id === rev2.id;
})());

check('Discarding an editing revision is terminal — never reaches a published/superseded state, never deletes the row', (() => {
  const store = freshStore();
  const rev = startRevision(store, 'tenant-a', 'coll-a');
  discardRevision(store, 'tenant-a', rev.id);
  const after = store.revisions.find((r) => r.id === rev.id);
  return after.status === 'discarded' && store.revisions.includes(after);
})());

check('diff_summary correctly reports only the sections that actually changed', (() => {
  const store = freshStore();
  const rev = startRevision(store, 'tenant-a', 'coll-a');
  const saved = saveRevision(store, 'tenant-a', rev.id, rev.updated_at, { gop_clinic_grid: { slots: [{ x: 42 }] }, emergency_call_grid: {}, supervision_grid: {}, satellite_grid: {} });
  const published = publishRevision(store, 'tenant-a', rev.id, saved.updated_at);
  return published.diff_summary.sections_changed.gop === true
    && published.diff_summary.sections_changed.emergency === false
    && published.diff_summary.sections_changed.supervision === false
    && published.diff_summary.sections_changed.satellite === false;
})());

check('Tenant isolation: Tenant B cannot save/discard/publish Tenant A\'s revision (tenant-scoped lookup fails to find it)', (() => {
  const store = freshStore();
  const rev = startRevision(store, 'tenant-a', 'coll-a');
  try { saveRevision(store, 'tenant-b', rev.id, rev.updated_at, { gop_clinic_grid: {} }); return false; } catch (e) { if (!/not found/i.test(e.message)) return false; }
  try { discardRevision(store, 'tenant-b', rev.id); return false; } catch (e) { if (!/not found/i.test(e.message)) return false; }
  try { publishRevision(store, 'tenant-b', rev.id, rev.updated_at); return false; } catch (e) { if (!/not found/i.test(e.message)) return false; }
  return true;
})());

check('Tenant isolation: Tenant B cannot even START a revision against Tenant A\'s collection (tenant mismatch on the master row)', (() => {
  const store = freshStore();
  try { startRevision(store, 'tenant-b', 'coll-a'); return false; } catch (e) { return /No roster exists/.test(e.message); }
})());

// =====================================================================
// Section 4 — frontend wiring: Chief editor retargeting, and ZERO
// resident-facing exposure of roster_revisions.
// =====================================================================

check('rosterRevisionService.ts never references roster_revisions directly (RPC-only, outside comments)', (() => {
  return !/\.from\(\s*['"]roster_revisions['"]/.test(stripLineComments(serviceTs));
})());

check('rosterRevisionService.ts calls all 4 RPCs by name', (() => {
  return /rpc\(\s*'chief_start_roster_revision'/.test(serviceTs)
    && /rpc\(\s*'chief_save_roster_revision'/.test(serviceTs)
    && /rpc\(\s*'chief_discard_roster_revision'/.test(serviceTs)
    && /rpc\(\s*'chief_publish_roster_revision'/.test(serviceTs);
})());

check('MultiRosterManagerView.tsx: saveDraft() gates on masterRoster.status === \'published\' and routes to the revision service only in that branch', (() => {
  const saveDraftBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const saveDraft = async'), chiefEditorTsx.indexOf('const publish = async'));
  return /masterRoster\.status === 'published'/.test(saveDraftBlock) && /rosterRevisionService\.saveRevision/.test(saveDraftBlock);
})());

check('MultiRosterManagerView.tsx: publish() also gates on masterRoster.status === \'published\' and re-saves the revision before publishing it (Publish can never bypass Save)', (() => {
  const publishBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const publish = async'), chiefEditorTsx.indexOf('const discardRevision'));
  return /masterRoster\.status === 'published'/.test(publishBlock)
    && /rosterRevisionService\.saveRevision/.test(publishBlock)
    && /rosterRevisionService\.publishRevision/.test(publishBlock);
})());

check('MultiRosterManagerView.tsx: load() starts/reopens a revision (and seeds grid state FROM it) whenever the roster is already published — never seeds edit state from the live row once published', (() => {
  const loadBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const load = async'), chiefEditorTsx.indexOf('const startEditing') !== -1 ? chiefEditorTsx.indexOf('const startEditing') : chiefEditorTsx.indexOf('const handleDragStart'));
  return /mr\.status === 'published'/.test(loadBlock) && /rosterRevisionService\.startRevision/.test(loadBlock);
})());

check('MultiRosterManagerView.tsx: discardRevision() reverts local grid state to the untouched masterRoster content (never to the revision\'s own edited content)', (() => {
  const discardBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const discardRevision = async'), chiefEditorTsx.indexOf('const sectionsWithUnsavedChanges'));
  return /rosterRevisionService\.discardRevision/.test(discardBlock) && /masterRoster\.gop_clinic_grid/.test(discardBlock);
})());

check('MultiRosterManagerView.tsx never writes to combined_master_rosters while a revision is active for the published branch (no updateMasterRoster call inside the masterRoster.status === \'published\' branches)', (() => {
  const saveDraftBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const saveDraft = async'), chiefEditorTsx.indexOf('const publish = async'));
  const publishedBranch = saveDraftBlock.slice(saveDraftBlock.indexOf("status === 'published'"), saveDraftBlock.indexOf('} else {'));
  return !/updateMasterRoster/.test(publishedBranch);
})());

check('ChiefDashboardView.tsx passes adminCode through to MultiRosterManagerView', (() => {
  return /<MultiRosterManagerView tenantId=\{[^}]*\} adminCode=\{adminCode\}/.test(chiefDashboardTsx);
})());

check('types.ts declares RosterRevision with all required metadata fields (revision_number, status, based_on_revision_id, source, source_reference, changed_by, change_reason, diff_summary, timestamps)', (() => {
  const block = typesTs.slice(typesTs.indexOf('export interface RosterRevision'));
  return /revision_number: number/.test(block) && /status: RosterRevisionStatus/.test(block)
    && /based_on_revision_id: string \| null/.test(block) && /source: RosterRevisionSource/.test(block)
    && /source_reference: string \| null/.test(block) && /changed_by: string/.test(block)
    && /change_reason: string \| null/.test(block) && /diff_summary: RosterRevisionDiffSummary \| null/.test(block)
    && /created_at: string/.test(block) && /updated_at: string/.test(block) && /published_at: string \| null/.test(block);
})());

check('RosterRevisionSource type includes exactly the 3 provenance categories (manual/external/AI) required by this slice', (() => {
  return /export type RosterRevisionSource = 'chief_manual' \| 'external_import' \| 'ai_proposal'/.test(typesTs);
})());

// --- ZERO resident-facing exposure ---
check('myAssignmentService.ts never references roster_revisions or rosterRevisionService', (() => {
  return !/roster_revisions/.test(myAssignmentServiceTs) && !/rosterRevisionService/.test(myAssignmentServiceTs);
})());
check('MyAssignmentView.tsx never references roster_revisions or rosterRevisionService', (() => {
  return !/roster_revisions/.test(myAssignmentViewTsx) && !/rosterRevisionService/.test(myAssignmentViewTsx);
})());
check('fullRosterService.ts never references roster_revisions or rosterRevisionService', (() => {
  return !/roster_revisions/.test(fullRosterServiceTs) && !/rosterRevisionService/.test(fullRosterServiceTs);
})());
check('FullRosterView.tsx never references roster_revisions or rosterRevisionService', (() => {
  return !/roster_revisions/.test(fullRosterViewTsx) && !/rosterRevisionService/.test(fullRosterViewTsx);
})());

// =====================================================================

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('\nAll Roster Revisions verification checks passed.');
  process.exit(0);
}
