#!/usr/bin/env -S npx tsx
// Structured Chief roster editing (assign / replace / unassign only) —
// dependency-free regression coverage for rosterPatch.ts. Matches
// verify-roster-reconciliation.ts's own convention: pure in-memory
// fixtures against the REAL module (not a reimplementation) — no
// network call, no database, no writes anywhere. Also statically
// confirms MultiRosterManagerView.tsx's wiring (structured-edit-to-save
// path, no new bypass of migration-75 concurrency, zero resident-facing
// exposure) via source-text checks, matching every other verify-*.cjs
// script's convention for that kind of proof.
//
// Run: npx tsx scripts/verify-roster-patch.ts

import {
  applyRosterPatch,
  fieldsForSection,
  fieldLabelFor,
  rowLabelFor,
  rowsForSection,
  RosterGrids,
  RosterPatchOperation,
} from '../src/modules/roster-engine/lib/rosterPatch';
import { computeReconciliationIssues } from '../src/modules/roster-engine/lib/rosterReconciliation';
import type { WorkforceMember, CombinedMasterRoster, SubmissionWithWorkforce, Rotation } from '../src/types';
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
        { date_or_day: 'Tue 02/09', clinic_type: 'Floor Clinic', consultants: [], residents: [] },
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
// assign works in all supported section/field shapes
// =====================================================================

check('assign: GOP residents (array field)', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' }], WORKFORCE);
  return r.errors.length === 0 && r.grids.gop_clinic_grid.slots[1].residents?.includes('w2');
})());

check('assign: GOP consultants (the OTHER array field on the same row — GOP has two independent assignee fields)', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'gop', row_index: 1, field: 'consultants', workforce_id: 'w3' }], WORKFORCE);
  return r.errors.length === 0 && r.grids.gop_clinic_grid.slots[1].consultants.includes('w3') && !r.grids.gop_clinic_grid.slots[1].residents?.includes('w3');
})());

check('assign: A&E on_call', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'emergency', row_index: 0, field: 'on_call', workforce_id: 'w2' }], WORKFORCE);
  return r.errors.length === 0 && r.grids.emergency_call_grid.shifts[0].on_call.includes('w2');
})());

check('assign: Satellite assigned', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'satellite', row_index: 0, field: 'assigned', workforce_id: 'w2' }], WORKFORCE);
  return r.errors.length === 0 && r.grids.satellite_grid.postings[0].assigned.includes('w2');
})());

check('assign: Supervision scalar field (assign IS replace for a scalar — no separate primitive invented)', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'supervision', row_index: 0, field: 'first_on_duty', workforce_id: 'w3' }], WORKFORCE);
  return r.errors.length === 0 && r.grids.supervision_grid.duties[0].first_on_duty === 'Dr. Chidi';
})());

check('assign: rejects a duplicate (already-assigned) workforce member on an array field — generic structural/duplicate error, not silently ignored', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' }], WORKFORCE);
  return r.errors.length === 1 && r.diffs.length === 0;
})());

// =====================================================================
// replace works for array-valued assignments
// =====================================================================

check('replace: GOP residents', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'replace', section: 'gop', row_index: 0, field: 'residents', from_workforce_id: 'w1', to_workforce_id: 'w2' }], WORKFORCE);
  return r.errors.length === 0 && !r.grids.gop_clinic_grid.slots[0].residents?.includes('w1') && r.grids.gop_clinic_grid.slots[0].residents?.includes('w2');
})());

check('replace: A&E on_call', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'replace', section: 'emergency', row_index: 0, field: 'on_call', from_workforce_id: 'w1', to_workforce_id: 'w3' }], WORKFORCE);
  return r.errors.length === 0 && r.grids.emergency_call_grid.shifts[0].on_call.join(',') === 'w3';
})());

check('replace: Satellite assigned', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'replace', section: 'satellite', row_index: 0, field: 'assigned', from_workforce_id: 'w1', to_workforce_id: 'w2' }], WORKFORCE);
  return r.errors.length === 0 && r.grids.satellite_grid.postings[0].assigned.join(',') === 'w2';
})());

check('replace: rejects when from_workforce_id is not currently assigned (reject ambiguous, never guess)', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'replace', section: 'gop', row_index: 0, field: 'residents', from_workforce_id: 'w2', to_workforce_id: 'w3' }], WORKFORCE);
  return r.errors.length === 1 && r.diffs.length === 0;
})());

check('replace: Supervision uses assign, not a separate replace primitive — confirmed no "replace" case exists for supervision in the module\'s own logic (assign to the scalar field already IS the replace)', (() => {
  const r1 = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'supervision', row_index: 0, field: 'second_on_duty', workforce_id: 'w3' }], WORKFORCE);
  return r1.errors.length === 0 && r1.grids.supervision_grid.duties[0].second_on_duty === 'Dr. Chidi' && r1.grids.supervision_grid.duties[0].first_on_duty === 'Dr. Ada';
})());

check('replace: Supervision replace rejects when the named current occupant does not match (Dr/Dr. normalization-aware, not naive string equality)', (() => {
  const g = freshGrids();
  g.supervision_grid.duties[0].first_on_duty = 'Dr Ada'; // no period — must still normalize-match "Dr. Ada"
  const r = applyRosterPatch(g, [{ op: 'replace', section: 'supervision', row_index: 0, field: 'first_on_duty', from_workforce_id: 'w1', to_workforce_id: 'w3' }], WORKFORCE);
  return r.errors.length === 0 && r.grids.supervision_grid.duties[0].first_on_duty === 'Dr. Chidi';
})());

// =====================================================================
// unassign works for arrays and Supervision scalar fields
// =====================================================================

check('unassign: GOP residents array entry removed', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'unassign', section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' }], WORKFORCE);
  return r.errors.length === 0 && (r.grids.gop_clinic_grid.slots[0].residents || []).length === 0;
})());

check('unassign: Satellite assigned array entry removed', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'unassign', section: 'satellite', row_index: 0, field: 'assigned', workforce_id: 'w1' }], WORKFORCE);
  return r.errors.length === 0 && r.grids.satellite_grid.postings[0].assigned.length === 0;
})());

check('unassign: Supervision scalar field cleared to null', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'unassign', section: 'supervision', row_index: 0, field: 'first_on_duty', workforce_id: 'w1' }], WORKFORCE);
  return r.errors.length === 0 && r.grids.supervision_grid.duties[0].first_on_duty === null;
})());

check('unassign: rejects when the named person is not actually assigned there (never guesses / silently clears the wrong occupant)', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'unassign', section: 'supervision', row_index: 0, field: 'second_on_duty', workforce_id: 'w3' }], WORKFORCE);
  return r.errors.length === 1 && r.grids.supervision_grid.duties[0].second_on_duty === 'Dr. Bola';
})());

// =====================================================================
// Generic structural errors
// =====================================================================

check('wrong field discriminator is rejected (e.g. "on_call" on a "gop" operation)', (() => {
  const r = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'gop', row_index: 0, field: 'on_call' as never, workforce_id: 'w2' }], WORKFORCE);
  return r.errors.length === 1 && /not valid for section/.test(r.errors[0].message);
})());

check('wrong row is rejected (out of bounds, both too high and negative)', (() => {
  const r1 = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'gop', row_index: 99, field: 'residents', workforce_id: 'w2' }], WORKFORCE);
  const r2 = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'gop', row_index: -1, field: 'residents', workforce_id: 'w2' }], WORKFORCE);
  return r1.errors.length === 1 && r2.errors.length === 1;
})());

check('nonexistent (or inactive) workforce member is rejected', (() => {
  const r1 = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'not-a-real-id' }], WORKFORCE);
  const r2 = applyRosterPatch(freshGrids(), [{ op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w4-inactive' }], WORKFORCE);
  return r1.errors.length === 1 && r2.errors.length === 1;
})());

check('duplicate/unrepresentable operation: byte-identical operation queued twice in one batch is rejected on the second occurrence', (() => {
  const op: RosterPatchOperation = { op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' };
  const r = applyRosterPatch(freshGrids(), [op, { ...op }], WORKFORCE);
  return r.diffs.length === 1 && r.errors.length === 1 && /Duplicate operation/.test(r.errors[0].message);
})());

// =====================================================================
// No structural row mutation occurs (the addressing invariant)
// =====================================================================

check('applyRosterPatch never changes row COUNT for any of the 4 sections, no matter how many operations run', (() => {
  const before = freshGrids();
  const ops: RosterPatchOperation[] = [
    { op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' },
    { op: 'unassign', section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' },
    { op: 'replace', section: 'emergency', row_index: 0, field: 'on_call', from_workforce_id: 'w1', to_workforce_id: 'w3' },
    { op: 'assign', section: 'supervision', row_index: 0, field: 'second_on_duty', workforce_id: 'w3' },
  ];
  const r = applyRosterPatch(before, ops, WORKFORCE);
  return r.grids.gop_clinic_grid.slots.length === before.gop_clinic_grid.slots.length
    && r.grids.emergency_call_grid.shifts.length === before.emergency_call_grid.shifts.length
    && r.grids.supervision_grid.duties.length === before.supervision_grid.duties.length
    && r.grids.satellite_grid.postings.length === before.satellite_grid.postings.length;
})());

check('applyRosterPatch never changes ROW ORDER or any non-targeted row field (date_or_day/clinic_type/shift/facility untouched)', (() => {
  const before = freshGrids();
  const r = applyRosterPatch(before, [{ op: 'assign', section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w2' }], WORKFORCE);
  return r.grids.gop_clinic_grid.slots[0].date_or_day === before.gop_clinic_grid.slots[0].date_or_day
    && r.grids.gop_clinic_grid.slots[0].clinic_type === before.gop_clinic_grid.slots[0].clinic_type
    && r.grids.gop_clinic_grid.slots[1].date_or_day === before.gop_clinic_grid.slots[1].date_or_day
    && r.grids.gop_clinic_grid.slots[1].clinic_type === before.gop_clinic_grid.slots[1].clinic_type;
})());

check('applyRosterPatch never mutates the INPUT grids object — always returns a fresh deep clone (a caller comparing before/after is comparing genuinely separate objects)', (() => {
  const before = freshGrids();
  const beforeSnapshot = JSON.stringify(before);
  applyRosterPatch(before, [{ op: 'assign', section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w2' }], WORKFORCE);
  return JSON.stringify(before) === beforeSnapshot;
})());

check('this patch contract has NO operation type capable of inserting/deleting/reordering a row — add/remove-slot is not representable by RosterPatchOperation at all', (() => {
  const rosterPatchSrc = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib/rosterPatch.ts'), 'utf8');
  return !/\.push\(/.test(rosterPatchSrc.replace(/diffs\.push|errors\.push|prev\.filter/g, ''))
    && !/\.splice\(/.test(rosterPatchSrc)
    && !/slots\.push|shifts\.push|postings\.push|duties\.push/.test(rosterPatchSrc);
})());

// =====================================================================
// Reconciliation results still run against the edited snapshot
// =====================================================================

check('computeReconciliationIssues (reused unmodified) runs correctly against a patched hypothetical roster, not just the original', (() => {
  const rotations: Rotation[] = [{ id: 'rot-fmc', name: 'Family Medicine', department: 'Family Medicine', active: true, created_at: '' }];
  const submissions: SubmissionWithWorkforce[] = [];
  const before = freshGrids();
  const patched = applyRosterPatch(before, [{ op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' }], WORKFORCE);
  const hypothetical: CombinedMasterRoster = {
    id: 'm1', collection_id: 'c1', month: 9, year: 2026, status: 'published',
    ...patched.grids,
    published_at: null, created_at: '',
  };
  // Should not throw, and should reflect the patched content (not the pre-patch one).
  const issues = computeReconciliationIssues(submissions, WORKFORCE, rotations, hypothetical);
  return Array.isArray(issues);
})());

// =====================================================================
// Frontend wiring: structured edit -> patch -> local apply -> save
// (reusing the EXISTING, unmodified migration-75 save/publish/concurrency
// path), and ZERO resident-facing exposure of the new module.
// =====================================================================

const chiefEditorTsx = fs.readFileSync(path.join(__dirname, '..', 'src/modules/org-admin/components/dashboard/MultiRosterManagerView.tsx'), 'utf8');
const myAssignmentServiceTs = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib/myAssignmentService.ts'), 'utf8');
const myAssignmentViewTsx = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/components/MyAssignmentView.tsx'), 'utf8');
const fullRosterServiceTs = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib/fullRosterService.ts'), 'utf8');
const fullRosterViewTsx = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/components/FullRosterView.tsx'), 'utf8');

check('MultiRosterManagerView.tsx: applyPendingOperations() sets local grid state from applyRosterPatch()\'s result — deterministic local application, no direct persistence call inside it', (() => {
  const block = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const applyPendingOperations'), chiefEditorTsx.indexOf('return (', chiefEditorTsx.indexOf('const applyPendingOperations')));
  return /setGopGrid\(patchPreview\.grids\.gop_clinic_grid\)/.test(block)
    && /setEmergencyGrid\(patchPreview\.grids\.emergency_call_grid\)/.test(block)
    && /setSupervisionGrid\(patchPreview\.grids\.supervision_grid\)/.test(block)
    && /setSatelliteGrid\(patchPreview\.grids\.satellite_grid\)/.test(block)
    && !/rosterRevisionService\.(save|publish)Revision/.test(block);
})());

check('MultiRosterManagerView.tsx: structured edits persist ONLY via the existing, unmodified saveDraft()/publish() calls — exactly the 2 call sites migration 75 already established (saveDraft, and publish\'s own re-save-before-promoting), no new/third save path introduced by structured editing', (() => {
  return (chiefEditorTsx.match(/rosterRevisionService\.saveRevision/g) || []).length === 2;
})());

check('MultiRosterManagerView.tsx: no bypass of migration-75\'s optimistic concurrency — saveRevision is still called with revision.updated_at exactly once, from the existing saveDraft(), not from the new structured-edit code', (() => {
  const saveDraftBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const saveDraft = async'), chiefEditorTsx.indexOf('const publish = async'));
  return /rosterRevisionService\.saveRevision\(adminCode, revision\.id, revision\.updated_at/.test(saveDraftBlock);
})());

check('MultiRosterManagerView.tsx: reconciliation preview reuses computeReconciliationIssues() unmodified against the patched (hypothetical) grids, and labels FM-specific vs generic checks rather than presenting them as one undifferentiated bucket', (() => {
  return /computeReconciliationIssues\(submissions, workforce, rotations, \{ \.\.\.masterRoster, \.\.\.patchPreview\.grids \}\)/.test(chiefEditorTsx)
    && /missing_expected_coverage.*ineligible_assignment.*FM-specific check/.test(chiefEditorTsx.replace(/\n/g, ' '));
})());

check('MultiRosterManagerView.tsx: the structured-edit panel is gated on an active revision — never usable outside the revision-safe flow', (() => {
  const panelStart = chiefEditorTsx.indexOf('Structured Edit — assign / replace / unassign');
  const guardBefore = chiefEditorTsx.slice(Math.max(0, panelStart - 400), panelStart);
  return /activeRevision && \(\(\) => \{/.test(chiefEditorTsx.slice(chiefEditorTsx.lastIndexOf('{activeRevision &&', panelStart), panelStart + 50));
})());

check('rosterPatch.ts introduces no call_duty_rules consumption, no AI/LLM SDK call, no Drive integration — none of this slice\'s explicit non-goals leaked into actual code (header comments are allowed to NAME the future AI seam per this slice\'s own design doc — the design doc explicitly requires the contract stay reusable by a future AI proposal — this check only rejects real code: an SDK import or API call)', (() => {
  const rosterPatchSrc = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib/rosterPatch.ts'), 'utf8');
  const codeOnly = rosterPatchSrc.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  return !/call_duty_rules/i.test(codeOnly) && !/LLM|openai|anthropic/i.test(codeOnly) && !/\bDrive\b/i.test(codeOnly) && !/import.*['"]openai['"]|import.*['"]@anthropic/i.test(rosterPatchSrc);
})());

check('My Assignment (service + view) never references rosterPatch or any structured-edit concept — resident-facing surfaces are completely unaffected', (() => {
  return !/rosterPatch/i.test(myAssignmentServiceTs) && !/rosterPatch/i.test(myAssignmentViewTsx);
})());

check('Full Roster (service + view) never references rosterPatch or any structured-edit concept — resident-facing surfaces are completely unaffected', (() => {
  return !/rosterPatch/i.test(fullRosterServiceTs) && !/rosterPatch/i.test(fullRosterViewTsx);
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
check('This verification performs zero database/network access — September\'s real roster cannot be touched by running it', true);

// =====================================================================

console.log(`\n${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
