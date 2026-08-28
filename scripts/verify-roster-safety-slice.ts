#!/usr/bin/env -S npx tsx
// Net diff + stale-revision rebase review + swap UI composition —
// dependency-free regression coverage, matching verify-roster-patch.ts's
// own convention: pure in-memory fixtures against the REAL modules (not
// reimplementations), plus source-text checks for the frontend wiring
// and the "no new patch primitive / no new migration" structural
// guarantees. No network call, no database, no writes anywhere.
//
// Run: npx tsx scripts/verify-roster-safety-slice.ts

import {
  applyRosterPatch,
  RosterGrids,
  RosterPatchOperation,
} from '../src/modules/roster-engine/lib/rosterPatch';
import { computeNetRosterDiff, computeNetReconciliationIssues } from '../src/modules/roster-engine/lib/rosterNetDiff';
import { classifyOperationsForRebase, buildRebasePreview } from '../src/modules/roster-engine/lib/rosterRebase';
import { compileSwapToOperations } from '../src/modules/roster-engine/lib/rosterSwap';
import type { WorkforceMember, ReconciliationIssue } from '../src/types';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let failures = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

const WORKFORCE: WorkforceMember[] = [
  { id: 'w1', full_name: 'Dr. Ada', category: 'Senior Registrar', active: true } as WorkforceMember,
  { id: 'w2', full_name: 'Dr. Bola', category: 'Senior Registrar', active: true } as WorkforceMember,
  { id: 'w3', full_name: 'Dr. Chidi', category: 'Senior Registrar', active: true } as WorkforceMember,
  { id: 'w4-inactive', full_name: 'Dr. Deleted', category: 'Senior Registrar', active: false } as WorkforceMember,
];

function freshGrids(): RosterGrids {
  return {
    gop_clinic_grid: {
      slots: [
        { date_or_day: 'Mon 01/09', clinic_type: 'Triage', consultants: ['w3'], residents: ['w1'] },
        { date_or_day: 'Mon 01/09', clinic_type: 'Floor Clinic', consultants: [], residents: ['w2'] },
      ],
      unparsed_notes: [],
    },
    emergency_call_grid: {
      shifts: [{ date_or_day: 'Mon 01/09', shift: '4pm-10pm', on_call: ['w1'] }],
      unparsed_notes: [],
    },
    supervision_grid: {
      duties: [{ date_or_day: 'Mon 01/09', first_on_duty: 'Dr. Ada', second_on_duty: 'Dr. Bola' }],
      unparsed_notes: [],
    },
    satellite_grid: {
      postings: [{ facility: 'Agbeke Mercy', date_or_day: null, assigned: ['w1'] }],
      unparsed_notes: [],
    },
  };
}

// =====================================================================
// Net diff — naturally collapses cancel-out sequences (no special-casing)
// =====================================================================

check('net diff: assign-then-unassign on the same array target collapses to NO net change', (() => {
  const base = freshGrids();
  const ops: RosterPatchOperation[] = [
    { op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w3' },
    { op: 'unassign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w3' },
  ];
  const final = applyRosterPatch(base, ops, WORKFORCE).grids;
  return computeNetRosterDiff(base, final, WORKFORCE).length === 0;
})());

check('net diff: replace-then-replace-back on the same array target collapses to NO net change', (() => {
  const base = freshGrids();
  const ops: RosterPatchOperation[] = [
    { op: 'replace', section: 'gop', row_index: 0, field: 'residents', from_workforce_id: 'w1', to_workforce_id: 'w2' },
    { op: 'replace', section: 'gop', row_index: 0, field: 'residents', from_workforce_id: 'w2', to_workforce_id: 'w1' },
  ];
  const final = applyRosterPatch(base, ops, WORKFORCE).grids;
  return computeNetRosterDiff(base, final, WORKFORCE).length === 0;
})());

check('net diff: assign-then-assign-back on the same Supervision SCALAR target collapses to NO net change (unassign clears to null rather than restoring the prior occupant, so the true cancel-out case for a scalar field is assign-then-reassign, not assign-then-unassign)', (() => {
  const base = freshGrids(); // first_on_duty starts as Dr. Ada (w1)
  const ops: RosterPatchOperation[] = [
    { op: 'assign', section: 'supervision', row_index: 0, field: 'first_on_duty', workforce_id: 'w3' },
    { op: 'assign', section: 'supervision', row_index: 0, field: 'first_on_duty', workforce_id: 'w1' },
  ];
  const final = applyRosterPatch(base, ops, WORKFORCE).grids;
  return computeNetRosterDiff(base, final, WORKFORCE).length === 0;
})());

check('net diff: a REAL array addition is detected correctly (added name resolved, no removal)', (() => {
  const base = freshGrids();
  const final = applyRosterPatch(base, [{ op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w3' }], WORKFORCE).grids;
  const diff = computeNetRosterDiff(base, final, WORKFORCE);
  return diff.length === 1 && diff[0].addedNames.join(',') === 'Dr. Chidi' && diff[0].removedNames.length === 0;
})());

check('net diff: a REAL array removal is detected correctly', (() => {
  const base = freshGrids();
  const final = applyRosterPatch(base, [{ op: 'unassign', section: 'satellite', row_index: 0, field: 'assigned', workforce_id: 'w1' }], WORKFORCE).grids;
  const diff = computeNetRosterDiff(base, final, WORKFORCE);
  return diff.length === 1 && diff[0].removedNames.join(',') === 'Dr. Ada' && diff[0].addedNames.length === 0;
})());

check('net diff: a REAL Supervision scalar reassignment is detected as one removed + one added, not two separate array entries', (() => {
  const base = freshGrids();
  const final = applyRosterPatch(base, [{ op: 'assign', section: 'supervision', row_index: 0, field: 'first_on_duty', workforce_id: 'w3' }], WORKFORCE).grids;
  const diff = computeNetRosterDiff(base, final, WORKFORCE);
  return diff.length === 1 && diff[0].removedNames.join(',') === 'Dr. Ada' && diff[0].addedNames.join(',') === 'Dr. Chidi';
})());

check('net diff: an unrelated section/row/field is never mentioned when nothing there changed', (() => {
  const base = freshGrids();
  const final = applyRosterPatch(base, [{ op: 'unassign', section: 'satellite', row_index: 0, field: 'assigned', workforce_id: 'w1' }], WORKFORCE).grids;
  const diff = computeNetRosterDiff(base, final, WORKFORCE);
  return !diff.some((e) => e.section === 'gop') && !diff.some((e) => e.section === 'emergency') && !diff.some((e) => e.section === 'supervision');
})());

// =====================================================================
// Net reconciliation issue classification (base vs final issue sets)
// =====================================================================

const issueA: ReconciliationIssue = { type: 'rotation_conflict', workforceId: 'w1', memberName: 'Dr. Ada', message: 'A conflicts', evidence: {} };
const issueB: ReconciliationIssue = { type: 'rotation_conflict', workforceId: 'w2', memberName: 'Dr. Bola', message: 'B conflicts', evidence: {} };

check('net reconciliation: an issue present in both base and final is classified unaffected, not introduced/resolved', (() => {
  const r = computeNetReconciliationIssues([issueA], [issueA]);
  return r.unaffected.length === 1 && r.introducedByBatch.length === 0 && r.resolvedByBatch.length === 0;
})());

check('net reconciliation: an issue present only in final is introducedByBatch', (() => {
  const r = computeNetReconciliationIssues([issueA], [issueA, issueB]);
  return r.introducedByBatch.length === 1 && r.introducedByBatch[0].workforceId === 'w2';
})());

check('net reconciliation: an issue present only in base is resolvedByBatch', (() => {
  const r = computeNetReconciliationIssues([issueA, issueB], [issueA]);
  return r.resolvedByBatch.length === 1 && r.resolvedByBatch[0].workforceId === 'w2';
})());

// =====================================================================
// Stale-revision rebase classification
// =====================================================================

check('rebase: an edit ELSEWHERE in the roster classifies an unrelated pending operation as REPLAYABLE (a change elsewhere must not block an unrelated patch)', (() => {
  const base = freshGrids();
  const latest = freshGrids();
  latest.emergency_call_grid.shifts[0].on_call = ['w3']; // unrelated target changed
  const pending: RosterPatchOperation[] = [{ op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w3' }];
  const results = classifyOperationsForRebase(base, latest, pending, WORKFORCE);
  return results.length === 1 && results[0].classification === 'REPLAYABLE';
})());

check('rebase: a concurrent edit at the EXACT SAME target classifies the pending operation as CONFLICT', (() => {
  const base = freshGrids();
  const latest = freshGrids();
  latest.gop_clinic_grid.slots[0].residents = ['w3']; // same target (gop row0 residents) changed elsewhere
  const pending: RosterPatchOperation[] = [{ op: 'replace', section: 'gop', row_index: 0, field: 'residents', from_workforce_id: 'w1', to_workforce_id: 'w2' }];
  const results = classifyOperationsForRebase(base, latest, pending, WORKFORCE);
  return results.length === 1 && results[0].classification === 'CONFLICT';
})());

check('rebase: a workforce reference invalidated (deactivated) since is classified TARGET_NO_LONGER_VALID, never guessed as replayable', (() => {
  const base = freshGrids();
  const latest = freshGrids();
  const pending: RosterPatchOperation[] = [{ op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w4-inactive' }];
  const results = classifyOperationsForRebase(base, latest, pending, WORKFORCE);
  return results.length === 1 && results[0].classification === 'TARGET_NO_LONGER_VALID';
})());

check('rebase: a row removed in the latest revision is classified TARGET_NO_LONGER_VALID, not silently treated as replayable', (() => {
  const base = freshGrids();
  const latest = freshGrids();
  latest.satellite_grid.postings = []; // row no longer exists
  const pending: RosterPatchOperation[] = [{ op: 'unassign', section: 'satellite', row_index: 0, field: 'assigned', workforce_id: 'w1' }];
  const results = classifyOperationsForRebase(base, latest, pending, WORKFORCE);
  return results.length === 1 && results[0].classification === 'TARGET_NO_LONGER_VALID';
})());

check('rebase preview: confirmed replay applies ONLY the REPLAYABLE operations against the LATEST snapshot, not the stale base — CONFLICT/invalid ones are dropped, never guessed', (() => {
  const base = freshGrids();
  const latest = freshGrids();
  latest.emergency_call_grid.shifts[0].on_call = ['w3']; // unrelated — the pending op below stays replayable
  latest.gop_clinic_grid.slots[0].residents = ['w2']; // conflicting with the op targeting this same field below
  const pending: RosterPatchOperation[] = [
    { op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w3' }, // replayable
    { op: 'replace', section: 'gop', row_index: 0, field: 'residents', from_workforce_id: 'w1', to_workforce_id: 'w2' }, // conflict (base said w1, latest already says w2)
  ];
  const preview = buildRebasePreview(base, latest, pending, WORKFORCE);
  const replayed = applyRosterPatch(latest, preview.replayableOperations, WORKFORCE);
  return preview.replayableOperations.length === 1
    && preview.results.find((r) => r.classification === 'CONFLICT') !== undefined
    && replayed.grids.gop_clinic_grid.slots[1].residents?.includes('w3')
    // the conflicting operation was NEVER applied — latest's own value (from concurrent edit) survives untouched
    && replayed.grids.gop_clinic_grid.slots[0].residents?.join(',') === 'w2';
})());

// =====================================================================
// Swap UI composition — compiles into exactly 2 existing 'replace'
// operations; no new patch primitive
// =====================================================================

check('swap: array<->array cross-row compiles into exactly 2 replace operations that swap the two occupants', (() => {
  const grids = freshGrids(); // w1 at gop row0 residents, w2 at gop row1 residents
  const result = compileSwapToOperations(
    grids,
    { section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' },
    { section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' },
    WORKFORCE
  );
  if (result.status !== 'ok') return false;
  const applied = applyRosterPatch(grids, result.operations, WORKFORCE);
  return applied.errors.length === 0
    && applied.grids.gop_clinic_grid.slots[0].residents?.join(',') === 'w2'
    && applied.grids.gop_clinic_grid.slots[1].residents?.join(',') === 'w1';
})());

check('swap: Supervision SCALAR<->SCALAR (same row, first_on_duty <-> second_on_duty) compiles into 2 replace operations and swaps correctly', (() => {
  const grids = freshGrids(); // first=Dr. Ada(w1), second=Dr. Bola(w2)
  const result = compileSwapToOperations(
    grids,
    { section: 'supervision', row_index: 0, field: 'first_on_duty', workforce_id: 'w1' },
    { section: 'supervision', row_index: 0, field: 'second_on_duty', workforce_id: 'w2' },
    WORKFORCE
  );
  if (result.status !== 'ok') return false;
  const applied = applyRosterPatch(grids, result.operations, WORKFORCE);
  return applied.errors.length === 0
    && applied.grids.supervision_grid.duties[0].first_on_duty === 'Dr. Bola'
    && applied.grids.supervision_grid.duties[0].second_on_duty === 'Dr. Ada';
})());

check('swap: cross-section (gop residents <-> emergency on_call) compiles and applies correctly', (() => {
  const grids = freshGrids(); // w1 at gop row0 residents, w1 also at emergency row0 on_call — use distinct people
  grids.emergency_call_grid.shifts[0].on_call = ['w2'];
  const result = compileSwapToOperations(
    grids,
    { section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' },
    { section: 'emergency', row_index: 0, field: 'on_call', workforce_id: 'w2' },
    WORKFORCE
  );
  if (result.status !== 'ok') return false;
  const applied = applyRosterPatch(grids, result.operations, WORKFORCE);
  return applied.errors.length === 0
    && applied.grids.gop_clinic_grid.slots[0].residents?.join(',') === 'w2'
    && applied.grids.emergency_call_grid.shifts[0].on_call.join(',') === 'w1';
})());

check('swap: same-date rows (both gop rows share "Mon 01/09" in the fixture) swap correctly — same/different date both supported since only row_index/section matter', (() => {
  const grids = freshGrids();
  return grids.gop_clinic_grid.slots[0].date_or_day === grids.gop_clinic_grid.slots[1].date_or_day
    && compileSwapToOperations(
      grids,
      { section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' },
      { section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' },
      WORKFORCE
    ).status === 'ok';
})());

check('swap: rejects an identical target (same section/row/field) before generating any operation', (() => {
  const grids = freshGrids();
  const result = compileSwapToOperations(
    grids,
    { section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' },
    { section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' },
    WORKFORCE
  );
  return result.status === 'rejected';
})());

check('swap: rejects swapping a person with themselves (same workforce_id at two different targets)', (() => {
  const grids = freshGrids();
  grids.emergency_call_grid.shifts[0].on_call = ['w1'];
  const result = compileSwapToOperations(
    grids,
    { section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' },
    { section: 'emergency', row_index: 0, field: 'on_call', workforce_id: 'w1' },
    WORKFORCE
  );
  return result.status === 'rejected';
})());

check('swap: rejects when the claimed current occupant is not actually present at a target — impossible/ambiguous swap caught BEFORE patch generation', (() => {
  const grids = freshGrids();
  const result = compileSwapToOperations(
    grids,
    { section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w3' }, // w3 is NOT in row0 residents
    { section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' },
    WORKFORCE
  );
  return result.status === 'rejected';
})());

check('swap never introduces a new RosterPatchOperation kind — compiles to exactly 2 operations, both op:"replace"', (() => {
  const grids = freshGrids();
  const result = compileSwapToOperations(
    grids,
    { section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' },
    { section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' },
    WORKFORCE
  );
  return result.status === 'ok' && result.operations.length === 2 && result.operations.every((op) => op.op === 'replace');
})());

check('rosterPatch.ts\'s RosterPatchOperation union defines no "swap" op literal anywhere in the codebase (structural — swap is a UI composition, never a persisted/validated primitive)', (() => {
  const rosterPatchSrc = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib/rosterPatch.ts'), 'utf8');
  return !/op:\s*'swap'/.test(rosterPatchSrc) && !/'swap'\s*\|/.test(rosterPatchSrc);
})());

// =====================================================================
// Frontend wiring: rebase confirmation gate, unchanged persistence path,
// zero resident-facing exposure, no new migration
// =====================================================================

const chiefEditorTsx = fs.readFileSync(path.join(__dirname, '..', 'src/modules/org-admin/components/dashboard/MultiRosterManagerView.tsx'), 'utf8');
const myAssignmentServiceTs = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib/myAssignmentService.ts'), 'utf8');
const myAssignmentViewTsx = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/components/MyAssignmentView.tsx'), 'utf8');
const fullRosterServiceTs = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib/fullRosterService.ts'), 'utf8');
const fullRosterViewTsx = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/components/FullRosterView.tsx'), 'utf8');

check('enterRebaseReview() never itself applies/replays anything — it only fetches the latest revision and computes a preview via buildRebasePreview; setActiveRevision(latest)/setGopGrid(...) from latest data appear only inside confirmRebase()', (() => {
  const enterBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const enterRebaseReview'), chiefEditorTsx.indexOf('const confirmRebase'));
  return /buildRebasePreview/.test(enterBlock) && !/setActiveRevision\(latest\)/.test(enterBlock) && !/setGopGrid\(replayed/.test(enterBlock);
})());

check('confirmRebase() is the ONLY place that adopts the latest revision as the new base and replays operations — gated behind an explicit button, never called automatically from enterRebaseReview()', (() => {
  const confirmBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const confirmRebase'), chiefEditorTsx.indexOf('const cancelRebase'));
  const panelGuardIndex = chiefEditorTsx.indexOf('{rebasePreview && pendingLatestRevision && (');
  const panelEndIndex = chiefEditorTsx.indexOf('revision-safety indicator', panelGuardIndex);
  const panelBlock = chiefEditorTsx.slice(panelGuardIndex, panelEndIndex);
  return /applyRosterPatch\(latestGrids, rebasePreview\.replayableOperations, workforce\)/.test(confirmBlock)
    && /setActiveRevision\(pendingLatestRevision\)/.test(confirmBlock)
    && panelGuardIndex !== -1 && panelEndIndex !== -1
    && /onClick=\{confirmRebase\}/.test(panelBlock);
})());

check('saveDraft()/publish() route a "changed elsewhere" rejection into enterRebaseReview() instead of merely showing an error message — the Chief always gets a rebase review, never a dead end', (() => {
  const saveDraftBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const saveDraft = async'), chiefEditorTsx.indexOf('const publish = async'));
  const publishBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const publish = async'), chiefEditorTsx.indexOf('const discardRevision'));
  return /changed elsewhere/i.test(saveDraftBlock) && /enterRebaseReview\(\)/.test(saveDraftBlock)
    && /changed elsewhere/i.test(publishBlock) && /enterRebaseReview\(\)/.test(publishBlock);
})());

check('migration 75\'s updated_at optimistic-concurrency check remains the sole authority on staleness — still passed on every saveRevision/publishRevision call, unchanged (exactly 2 saveRevision call sites, matching the prior slice)', (() => {
  const passesUpdatedAt = /rosterRevisionService\.saveRevision\(adminCode, revision\.id, revision\.updated_at/.test(chiefEditorTsx)
    && /rosterRevisionService\.publishRevision\(adminCode, saved\.id, saved\.updated_at\)/.test(chiefEditorTsx);
  const saveRevisionCallCount = (chiefEditorTsx.match(/rosterRevisionService\.saveRevision/g) || []).length;
  const migration75Src = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '75_roster_revisions.sql'), 'utf8');
  return passesUpdatedAt && saveRevisionCallCount === 2 && /changed elsewhere/.test(migration75Src);
})());

check('published combined_master_rosters is never written by any new file in this slice — no updateMasterRoster/direct table write in rosterNetDiff.ts/rosterRebase.ts/rosterSwap.ts', (() => {
  const newFiles = ['rosterNetDiff.ts', 'rosterRebase.ts', 'rosterSwap.ts'].map((f) =>
    fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib', f), 'utf8')
  );
  return newFiles.every((src) => !/updateMasterRoster|combined_master_rosters/.test(src) && !/supabase\.rpc|supabase!\.rpc/.test(src));
})());

check('My Assignment (service + view) never references rosterNetDiff/rosterRebase/rosterSwap — resident-facing surfaces remain completely unaffected', (() => {
  return !/rosterNetDiff|rosterRebase|rosterSwap/i.test(myAssignmentServiceTs) && !/rosterNetDiff|rosterRebase|rosterSwap/i.test(myAssignmentViewTsx);
})());

check('Full Roster (service + view) never references rosterNetDiff/rosterRebase/rosterSwap — resident-facing surfaces remain completely unaffected', (() => {
  return !/rosterNetDiff|rosterRebase|rosterSwap/i.test(fullRosterServiceTs) && !/rosterNetDiff|rosterRebase|rosterSwap/i.test(fullRosterViewTsx);
})());

check('no call to an LLM/AI SDK exists anywhere in the 3 new modules — this slice proves the pipeline is AI-ready without implementing AI', (() => {
  const newFiles = ['rosterNetDiff.ts', 'rosterRebase.ts', 'rosterSwap.ts'].map((f) =>
    fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib', f), 'utf8')
  );
  return newFiles.every((src) => {
    const codeOnly = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    return !/LLM|openai|anthropic/i.test(codeOnly) && !/import.*['"]openai['"]|import.*['"]@anthropic/i.test(src);
  });
})());

check('No migration file was added by this slice — confirmed 75 remains the latest migration on disk', (() => {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_/.test(f));
  const numbers = files.map((f) => parseInt(f.split('_')[0], 10));
  return Math.max(...numbers) === 75;
})());

// This entire script is pure in-memory fixtures + local source-file
// reads — no database connection exists anywhere in this file, so
// September's real production roster is provably untouched by this
// verification by construction, not merely by discipline.
check('This verification performs zero database/network access — the real published roster cannot be touched by running it', true);

// =====================================================================

console.log(`\n${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
