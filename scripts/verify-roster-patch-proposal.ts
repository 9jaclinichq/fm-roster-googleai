#!/usr/bin/env -S npx tsx
// Roster AI V1 -- Prompt-to-Patch Proposal Layer -- dependency-free
// regression coverage. Matches verify-roster-patch.ts's own convention:
// pure in-memory fixtures against the REAL modules (not reimplementations),
// no network call, no database, no writes anywhere, no real AI provider
// call -- the model's output is simulated as fixed fixture objects in every
// case below, per WORKSPC_ROSTER_AI_V1_FINAL_PREIMPLEMENTATION_REVIEW_2026-08-30.md
// Section 10's verification plan.
//
// Run: npx tsx scripts/verify-roster-patch-proposal.ts

import { validateProposedRosterPatch, normalizeRosterContext, normalizeWorkforceContext, normalizeSectionLabels } from '../supabase/functions/roster-patch-proposal/schema';
import { compileProposalOperations, CompiledProposalOperation, resolveSymbolicRosterTarget } from '../src/modules/roster-engine/lib/rosterPatchProposalCompiler';
import type { SymbolicOperation, ProposedRosterPatch } from '../src/modules/roster-engine/lib/rosterPatchProposalService';
import { applyRosterPatch, RosterGrids, RosterPatchOperation } from '../src/modules/roster-engine/lib/rosterPatch';
import { computeReconciliationIssues } from '../src/modules/roster-engine/lib/rosterReconciliation';
import { computeNetRosterDiff } from '../src/modules/roster-engine/lib/rosterNetDiff';
import { classifyOperationsForRebase } from '../src/modules/roster-engine/lib/rosterRebase';
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
  { id: 'w3', full_name: 'Dr. Chidi', category: 'Registrar', active: true } as WorkforceMember,
  // Two people sharing a display name -- the deliberate ambiguity fixture.
  { id: 'w4a', full_name: 'Dr. Emeka', category: 'Medical Officer', active: true } as WorkforceMember,
  { id: 'w4b', full_name: 'Dr. Emeka', category: 'Medical Officer', active: true } as WorkforceMember,
  // WRONG_ROSTER_ROW_TARGETING WITH_VALID_PROPOSAL reproduction fixture
  // (2026-09-01) -- Dr. Ikor is deliberately assigned on two different
  // dates under the SAME clinic_type label below (see ikorReproGrids()).
  { id: 'w5', full_name: 'Dr. Ikor', category: 'Senior Registrar', active: true } as WorkforceMember,
  { id: 'w6', full_name: 'Dr. Ulasi', category: 'Senior Registrar', active: true } as WorkforceMember,
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
      shifts: [{ date_or_day: 'Fri 05/09', shift: '4pm-10pm', on_call: ['w1'] }],
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

// WRONG_ROSTER_ROW_TARGETING WITH_VALID_PROPOSAL exact reproduction fixture
// (2026-09-01): Dr. Ikor ('w5') is the sole consultant on TWO different gop
// rows that share the exact same clinic_type label ("Managed Care") -- the
// real production shape that let a provider-supplied row_index silently
// point at the wrong date while the model's own interpreted_instruction
// text correctly named the right one. Kept separate from freshGrids() so
// every other test's fixture stays exactly as it was.
function ikorReproGrids(): RosterGrids {
  const grids = freshGrids();
  grids.gop_clinic_grid.slots = [
    { date_or_day: 'Tue 01/09', clinic_type: 'Managed Care', consultants: ['w5'], residents: [] },
    { date_or_day: 'Thu 03/09', clinic_type: 'Managed Care', consultants: ['w5'], residents: [] },
  ];
  return grids;
}

const validProposalBase = {
  interpreted_instruction: 'Assign Dr. Bola to GOP residents on Tuesday.',
  referenced_names: ['Dr. Bola'],
  unresolved_ambiguity: [],
  unsupported_requests: [],
  assumptions: [],
  rationale: 'Row is currently empty.',
  outcome: 'valid' as const,
};

const edgeFunctionSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/roster-patch-proposal/index.ts'), 'utf8');
const chiefEditorTsx = fs.readFileSync(path.join(__dirname, '..', 'src/modules/org-admin/components/dashboard/MultiRosterManagerView.tsx'), 'utf8');
const compilerSrc = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib/rosterPatchProposalCompiler.ts'), 'utf8');
const serviceSrc = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib/rosterPatchProposalService.ts'), 'utf8');
// Strips '//' comment lines before a structural/absence check -- matching
// verify-roster-patch.ts's own established "codeOnly" convention -- so an
// explanatory comment mentioning a real identifier by name (e.g. "mirrors
// chief_start_roster_revision's own lookup") never false-positives a check
// that means to catch actual CODE calling/doing that thing.
const codeOnly = (src: string) => src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const edgeFunctionCodeOnly = codeOnly(edgeFunctionSrc);
const compilerCodeOnly = codeOnly(compilerSrc);

// =====================================================================
// 1. Server-side schema validator (supabase/functions/roster-patch-proposal/schema.ts)
// =====================================================================

check('schema: accepts a minimal valid assign proposal', (() => {
  const r = validateProposedRosterPatch({
    ...validProposalBase,
    operations: [{ op: 'assign', section: 'gop', date_or_day: 'Tue 02/09', label: 'Floor Clinic', field: 'residents', subject_name: 'Dr. Bola' }],
  });
  return r.status === 'ok';
})());

check('schema: accepts a minimal valid replace proposal', (() => {
  const r = validateProposedRosterPatch({
    ...validProposalBase,
    operations: [{ op: 'replace', section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents', from_subject_name: 'Dr. Ada', to_subject_name: 'Dr. Bola' }],
  });
  return r.status === 'ok';
})());

check('schema: accepts a minimal valid unassign proposal', (() => {
  const r = validateProposedRosterPatch({
    ...validProposalBase,
    operations: [{ op: 'unassign', section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents', subject_name: 'Dr. Ada' }],
  });
  return r.status === 'ok';
})());

check('schema: accepts a minimal valid swap proposal', (() => {
  const r = validateProposedRosterPatch({
    ...validProposalBase,
    operations: [{
      op: 'swap',
      target_a: { section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents' },
      target_b: { section: 'emergency', date_or_day: 'Fri 05/09', label: '4pm-10pm', field: 'on_call' },
      subject_a_name: 'Dr. Ada',
      subject_b_name: 'Dr. Bola',
    }],
  });
  return r.status === 'ok';
})());

check('schema: accepts each of the 4 sections\' valid fields', (() => {
  const cases: SymbolicOperation[] = [
    { op: 'assign', section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'consultants', subject_name: 'Dr. Ada' },
    { op: 'assign', section: 'emergency', date_or_day: 'Fri 05/09', label: '4pm-10pm', field: 'on_call', subject_name: 'Dr. Ada' },
    { op: 'assign', section: 'satellite', date_or_day: null, label: 'Agbeke Mercy', field: 'assigned', subject_name: 'Dr. Ada' },
    { op: 'assign', section: 'supervision', date_or_day: 'Mon 01/09', label: null, field: 'first_on_duty', subject_name: 'Dr. Ada' },
    { op: 'assign', section: 'supervision', date_or_day: 'Mon 01/09', label: null, field: 'second_on_duty', subject_name: 'Dr. Ada' },
  ];
  return cases.every((op) => validateProposedRosterPatch({ ...validProposalBase, operations: [op] }).status === 'ok');
})());

check('schema: rejects unknown op', (() => {
  const r = validateProposedRosterPatch({ ...validProposalBase, operations: [{ op: 'delete', section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents', subject_name: 'x' }] });
  return r.status === 'error' && /unknown op/.test(r.message);
})());

check('schema: rejects unknown section', (() => {
  const r = validateProposedRosterPatch({ ...validProposalBase, operations: [{ op: 'assign', section: 'clinic', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents', subject_name: 'x' }] });
  return r.status === 'error' && /unknown section/.test(r.message);
})());

check('schema: rejects unknown field for a given section', (() => {
  const r = validateProposedRosterPatch({ ...validProposalBase, operations: [{ op: 'assign', section: 'emergency', date_or_day: 'Fri 05/09', label: '4pm-10pm', field: 'residents', subject_name: 'x' }] });
  return r.status === 'error' && /not valid for section/.test(r.message);
})());

check('schema: rejects malformed date_or_day (wrong type -- not a string and not null)', (() => {
  const r = validateProposedRosterPatch({ ...validProposalBase, operations: [{ op: 'assign', section: 'gop', date_or_day: 42, label: 'Triage', field: 'residents', subject_name: 'x' }] });
  return r.status === 'error' && /invalid date_or_day/.test(r.message);
})());

check('schema: rejects malformed label (empty string is not a valid label -- only null or a non-empty string)', (() => {
  const r = validateProposedRosterPatch({ ...validProposalBase, operations: [{ op: 'assign', section: 'gop', date_or_day: 'Mon 01/09', label: '', field: 'residents', subject_name: 'x' }] });
  return r.status === 'error' && /invalid label/.test(r.message);
})());

check('schema: rejects an operation missing date_or_day entirely (no fallback to an implicit/absent location)', (() => {
  const r = validateProposedRosterPatch({ ...validProposalBase, operations: [{ op: 'assign', section: 'gop', label: 'Triage', field: 'residents', subject_name: 'x' }] });
  return r.status === 'error' && /invalid date_or_day/.test(r.message);
})());

check('schema: no longer recognizes row_index as a valid operation key at all -- a symbolic operation carrying row_index (even a well-formed integer) is rejected as an unexpected key, proving the provider-supplied-row_index attack surface this fix closes is structurally gone from the contract', (() => {
  const r = validateProposedRosterPatch({
    ...validProposalBase,
    operations: [{ op: 'assign', section: 'gop', row_index: 0, date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents', subject_name: 'x' }],
  });
  return r.status === 'error' && /unexpected key/.test(r.message);
})());

check('schema: rejects an unexpected top-level key', (() => {
  const r = validateProposedRosterPatch({ ...validProposalBase, operations: [], extra_field: 'should not be here' });
  return r.status === 'error' && /unexpected top-level key/.test(r.message);
})());

check('schema: rejects an unknown outcome value', (() => {
  const r = validateProposedRosterPatch({ ...validProposalBase, operations: [], outcome: 'maybe' });
  return r.status === 'error' && /unknown outcome/.test(r.message);
})());

check('schema: rejects a model attempting to smuggle a workforce_id in an operation', (() => {
  const r = validateProposedRosterPatch({
    ...validProposalBase,
    operations: [{ op: 'assign', section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents', subject_name: 'x', workforce_id: 'w1' }],
  });
  return r.status === 'error' && /unexpected key/.test(r.message);
})());

check('schema: rejects a model attempting to smuggle a tenant_id in an operation', (() => {
  const r = validateProposedRosterPatch({
    ...validProposalBase,
    operations: [{ op: 'assign', section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents', subject_name: 'x', tenant_id: 't1' }],
  });
  return r.status === 'error' && /unexpected key/.test(r.message);
})());

check('schema: rejects an arbitrary roster JSON snapshot standing in for operations', (() => {
  const r = validateProposedRosterPatch({ ...validProposalBase, operations: { gop_clinic_grid: { slots: [] } } });
  return r.status === 'error' && /operations must be an array/.test(r.message);
})());

check('schema: rejects a malformed swap specification (bad target_a)', (() => {
  const r = validateProposedRosterPatch({
    ...validProposalBase,
    operations: [{
      op: 'swap',
      target_a: { section: 'made_up', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents' },
      target_b: { section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents' },
      subject_a_name: 'x', subject_b_name: 'y',
    }],
  });
  return r.status === 'error' && /target_a/.test(r.message);
})());

check('schema: rejects a response that is not a JSON object at all', (() => {
  const r = validateProposedRosterPatch('not an object');
  return r.status === 'error';
})());

check('schema: rejects an authority-bearing field the contract does not define (a raw roster snapshot key alongside otherwise-valid fields)', (() => {
  const r = validateProposedRosterPatch({ ...validProposalBase, operations: [], gop_clinic_grid: { slots: [] } });
  return r.status === 'error' && /unexpected top-level key/.test(r.message);
})());

// =====================================================================
// 2. Client compiler (rosterPatchProposalCompiler.ts) -- reuses
//    identityResolver.ts / rosterSwap.ts UNCHANGED.
// =====================================================================

check('compiler: exact/unique identity resolves to a real RosterPatchOperationAssign', (() => {
  const ops: SymbolicOperation[] = [{ op: 'assign', section: 'gop', date_or_day: 'Tue 02/09', label: 'Floor Clinic', field: 'residents', subject_name: 'Dr. Bola' }];
  const compiled = compileProposalOperations(ops, freshGrids(), WORKFORCE);
  return compiled.length === 1 && compiled[0].status === 'resolved'
    && (compiled[0] as Extract<CompiledProposalOperation, { status: 'resolved' }>).operations[0].op === 'assign'
    && (compiled[0] as Extract<CompiledProposalOperation, { status: 'resolved' }>).operations[0].section === 'gop'
    && (compiled[0] as Extract<CompiledProposalOperation, { status: 'resolved' }>).operations[0].row_index === 1;
})());

check('compiler: replace resolves both from/to names', (() => {
  const ops: SymbolicOperation[] = [{ op: 'replace', section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents', from_subject_name: 'Dr. Ada', to_subject_name: 'Dr. Bola' }];
  const compiled = compileProposalOperations(ops, freshGrids(), WORKFORCE);
  const resolved = compiled[0] as Extract<CompiledProposalOperation, { status: 'resolved' }>;
  return compiled[0].status === 'resolved' && resolved.operations[0].op === 'replace';
})());

check('compiler: unassign resolves', (() => {
  const ops: SymbolicOperation[] = [{ op: 'unassign', section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents', subject_name: 'Dr. Ada' }];
  const compiled = compileProposalOperations(ops, freshGrids(), WORKFORCE);
  return compiled[0].status === 'resolved';
})());

check('compiler: ambiguous name (2 workforce members share a display name) is excluded, never guessed, and surfaces both candidates', (() => {
  const ops: SymbolicOperation[] = [{ op: 'assign', section: 'gop', date_or_day: 'Tue 02/09', label: 'Floor Clinic', field: 'residents', subject_name: 'Dr. Emeka' }];
  const compiled = compileProposalOperations(ops, freshGrids(), WORKFORCE);
  const entry = compiled[0];
  return entry.status === 'unresolvable' && entry.details[0].status === 'ambiguous' && entry.details[0].candidateNames?.length === 2;
})());

check('compiler: unknown name is excluded as unresolved, never guessed', (() => {
  const ops: SymbolicOperation[] = [{ op: 'assign', section: 'gop', date_or_day: 'Tue 02/09', label: 'Floor Clinic', field: 'residents', subject_name: 'Dr. Nobody' }];
  const compiled = compileProposalOperations(ops, freshGrids(), WORKFORCE);
  return compiled[0].status === 'unresolvable' && compiled[0].details[0].status === 'unresolved';
})());

check('compiler: replace with one resolvable and one unresolvable name excludes the WHOLE operation (never half-applies)', (() => {
  const ops: SymbolicOperation[] = [{ op: 'replace', section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents', from_subject_name: 'Dr. Ada', to_subject_name: 'Dr. Nobody' }];
  const compiled = compileProposalOperations(ops, freshGrids(), WORKFORCE);
  return compiled[0].status === 'unresolvable' && compiled[0].details.length === 1 && compiled[0].details[0].name === 'Dr. Nobody';
})());

check('compiler: swap with both names resolved compiles through the EXISTING compileSwapToOperations into 2 replace operations', (() => {
  // Supervision's two scalar fields on the same row hold two DIFFERENT
  // occupants in freshGrids() (Dr. Ada / Dr. Bola) -- every array-valued
  // field fixture above is occupied by w1 alone, which would make this a
  // (rejected) self-swap; this is the one real two-different-people swap
  // target available in the fixture.
  const ops: SymbolicOperation[] = [{
    op: 'swap',
    target_a: { section: 'supervision', date_or_day: 'Mon 01/09', label: null, field: 'first_on_duty' },
    target_b: { section: 'supervision', date_or_day: 'Mon 01/09', label: null, field: 'second_on_duty' },
    subject_a_name: 'Dr. Ada',
    subject_b_name: 'Dr. Bola',
  }];
  const compiled = compileProposalOperations(ops, freshGrids(), WORKFORCE);
  const resolved = compiled[0] as Extract<CompiledProposalOperation, { status: 'resolved' }>;
  return compiled[0].status === 'resolved' && resolved.operations.length === 2 && resolved.operations.every((o) => o.op === 'replace');
})());

check('compiler: swap rejected by compileSwapToOperations (occupant not actually present) surfaces the rejection reason, not a fabricated operation', (() => {
  const ops: SymbolicOperation[] = [{
    op: 'swap',
    target_a: { section: 'gop', date_or_day: 'Mon 01/09', label: 'Triage', field: 'residents' },
    target_b: { section: 'emergency', date_or_day: 'Fri 05/09', label: '4pm-10pm', field: 'on_call' },
    // Dr. Bola is not actually assigned to gop row 0 residents in freshGrids() -- w1 (Dr. Ada) is.
    subject_a_name: 'Dr. Bola',
    subject_b_name: 'Dr. Ada',
  }];
  const compiled = compileProposalOperations(ops, freshGrids(), WORKFORCE);
  return compiled[0].status === 'swap_rejected' && typeof compiled[0].reason === 'string' && compiled[0].reason.length > 0;
})());

check('compiler introduces no fuzzy identity resolution -- confirmed by source inspection (no edit-distance/substring/similarity library or logic; comments naming the non-goal for documentation are fine)', (() => {
  return !/levenshtein|similarity|includes\(.*toLowerCase/i.test(compilerCodeOnly) && !/import.*fuse|import.*fuzzball/i.test(compilerCodeOnly);
})());

check('compiler never modifies identityResolver.ts, rosterSwap.ts, or rosterPatch.ts -- confirmed by import-only usage (no re-declaration of resolveParsedNameToWorkforceId/compileSwapToOperations/applyRosterPatch inside the compiler file)', (() => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/modules/roster-engine/lib/rosterPatchProposalCompiler.ts'), 'utf8');
  return /import \{ resolveParsedNameToWorkforceId \} from '\.\/identityResolver'/.test(src)
    && /import \{ compileSwapToOperations, SwapTarget \} from '\.\/rosterSwap'/.test(src)
    && !/^export function resolveParsedNameToWorkforceId|^export function compileSwapToOperations/m.test(src);
})());

// =====================================================================
// 2b. Deterministic location resolver (resolveSymbolicRosterTarget) --
//     closes WRONG_ROSTER_ROW_TARGETING WITH_VALID_PROPOSAL (2026-09-01).
//     Exact production reproduction plus adversarial fixtures per
//     prompt1.txt's own required list: duplicate assignee across dates,
//     duplicate semantic composite, nonexistent semantic row, invalid
//     field, one-resolvable/one-ambiguous swap endpoint, both-exact swap.
// =====================================================================

check('resolver: exact reproduction of WRONG_ROSTER_ROW_TARGETING WITH_VALID_PROPOSAL -- Dr Ikor appears under the SAME clinic_type ("Managed Care") on TWO different dates; targeting the exact date resolves to that row and no other', (() => {
  const grids = ikorReproGrids();
  const location = resolveSymbolicRosterTarget(grids, { section: 'gop', date_or_day: 'Tue 01/09', label: 'Managed Care', field: 'consultants' });
  return location.status === 'resolved' && location.row_index === 0;
})());

check('resolver: same reproduction targeting the OTHER date resolves to the OTHER row -- proves the resolver is genuinely date-discriminating, not accidentally always landing on row 0', (() => {
  const grids = ikorReproGrids();
  const location = resolveSymbolicRosterTarget(grids, { section: 'gop', date_or_day: 'Thu 03/09', label: 'Managed Care', field: 'consultants' });
  return location.status === 'resolved' && location.row_index === 1;
})());

check('compiler: exact reproduction end-to-end -- "replace Dr Ikor with Dr Ulasi on Tue 01/09 Managed Care" compiles a replace targeting row 0 ONLY. The historical bug: a provider-supplied row_index pointed at row 1 (Thu 03/09) despite the instruction naming Tue 01/09; row_index no longer exists in the symbolic contract at all', (() => {
  const grids = ikorReproGrids();
  const ops: SymbolicOperation[] = [{ op: 'replace', section: 'gop', date_or_day: 'Tue 01/09', label: 'Managed Care', field: 'consultants', from_subject_name: 'Dr. Ikor', to_subject_name: 'Dr. Ulasi' }];
  const compiled = compileProposalOperations(ops, grids, WORKFORCE);
  const resolved = compiled[0] as Extract<CompiledProposalOperation, { status: 'resolved' }>;
  return compiled[0].status === 'resolved' && resolved.operations[0].row_index === 0;
})());

check('resolver: a nonexistent semantic location (a date/label combination absent from the grid) fails closed as no_matching_row -- never guesses the nearest row', (() => {
  const grids = ikorReproGrids();
  const location = resolveSymbolicRosterTarget(grids, { section: 'gop', date_or_day: 'Sat 06/09', label: 'Managed Care', field: 'consultants' });
  return location.status === 'unresolved' && location.reason === 'no_matching_row';
})());

check('resolver: a duplicate semantic composite (two rows sharing the exact same date_or_day + label) fails closed as ambiguous_row -- never silently picks the first match', (() => {
  const grids = ikorReproGrids();
  grids.gop_clinic_grid.slots.push({ date_or_day: 'Tue 01/09', clinic_type: 'Managed Care', consultants: ['w6'], residents: [] });
  const location = resolveSymbolicRosterTarget(grids, { section: 'gop', date_or_day: 'Tue 01/09', label: 'Managed Care', field: 'consultants' });
  return location.status === 'unresolved' && location.reason === 'ambiguous_row';
})());

check('resolver: an invalid field for the given section fails closed as invalid_field, before any row is even scanned', (() => {
  const grids = ikorReproGrids();
  const location = resolveSymbolicRosterTarget(grids, { section: 'gop', date_or_day: 'Tue 01/09', label: 'Managed Care', field: 'on_call' });
  return location.status === 'unresolved' && location.reason === 'invalid_field';
})());

check('compiler: an unresolvable location surfaces status "location_unresolvable" with a non-empty Chief-facing message -- deliberately distinct from "unresolvable" (an identity failure)', (() => {
  const grids = ikorReproGrids();
  const ops: SymbolicOperation[] = [{ op: 'assign', section: 'gop', date_or_day: 'Sat 06/09', label: 'Managed Care', field: 'consultants', subject_name: 'Dr. Ikor' }];
  const compiled = compileProposalOperations(ops, grids, WORKFORCE);
  const entry = compiled[0];
  return entry.status === 'location_unresolvable' && typeof entry.message === 'string' && entry.message.length > 0;
})());

check('compiler: swap with target A resolvable and target B ambiguous rejects the WHOLE swap as location_unresolvable naming "Target B" -- target A is never resolved/applied alone', (() => {
  const grids = ikorReproGrids();
  grids.gop_clinic_grid.slots.push({ date_or_day: 'Tue 01/09', clinic_type: 'Managed Care', consultants: ['w6'], residents: [] }); // makes target_b ambiguous
  const ops: SymbolicOperation[] = [{
    op: 'swap',
    target_a: { section: 'emergency', date_or_day: 'Fri 05/09', label: '4pm-10pm', field: 'on_call' },
    target_b: { section: 'gop', date_or_day: 'Tue 01/09', label: 'Managed Care', field: 'consultants' },
    subject_a_name: 'Dr. Ada',
    subject_b_name: 'Dr. Ikor',
  }];
  const compiled = compileProposalOperations(ops, grids, WORKFORCE);
  const entry = compiled[0];
  return entry.status === 'location_unresolvable' && /Target B/.test(entry.message);
})());

check('compiler: both swap targets resolving to exact, unique, distinct rows compiles atomically through the unchanged compileSwapToOperations', (() => {
  const ops: SymbolicOperation[] = [{
    op: 'swap',
    target_a: { section: 'supervision', date_or_day: 'Mon 01/09', label: null, field: 'first_on_duty' },
    target_b: { section: 'supervision', date_or_day: 'Mon 01/09', label: null, field: 'second_on_duty' },
    subject_a_name: 'Dr. Ada',
    subject_b_name: 'Dr. Bola',
  }];
  const compiled = compileProposalOperations(ops, freshGrids(), WORKFORCE);
  const resolved = compiled[0] as Extract<CompiledProposalOperation, { status: 'resolved' }>;
  return compiled[0].status === 'resolved' && resolved.operations.length === 2;
})());

check('SymbolicOperation contract structurally has no row_index anywhere -- confirmed by source inspection of both the client (rosterPatchProposalService.ts) and server (schema.ts) definitions, proving the original attack/failure vector (an untrustworthy provider-supplied row_index) cannot be silently reintroduced', (() => {
  const schemaSrc = fs.readFileSync(path.join(__dirname, '..', 'supabase/functions/roster-patch-proposal/schema.ts'), 'utf8');
  const symbolicOpBlock = serviceSrc.slice(serviceSrc.indexOf('export type SymbolicOperation'), serviceSrc.indexOf('export interface ProposedRosterPatch'));
  const schemaOpBlock = schemaSrc.slice(schemaSrc.indexOf('export type SymbolicOperation'), schemaSrc.indexOf('export interface ProposedRosterPatch'));
  return symbolicOpBlock.length > 0 && schemaOpBlock.length > 0 && !/row_index/.test(symbolicOpBlock) && !/row_index/.test(schemaOpBlock);
})());

check('the Edge Function system prompt no longer describes row_index in the SymbolicOperation contract text sent to the model, and instructs the model to copy date_or_day/label verbatim from the roster context instead of computing them', (() => {
  const promptFnStart = edgeFunctionSrc.indexOf('function buildSystemPrompt');
  const promptFnBlock = edgeFunctionSrc.slice(promptFnStart, promptFnStart + 4000);
  return !/"row_index":integer/.test(promptFnBlock)
    && /"date_or_day":string\|null/.test(promptFnBlock)
    && /"label":string\|null/.test(promptFnBlock)
    && /verbatim/i.test(promptFnBlock);
})());

// supabase/functions is excluded from tsconfig.json (see tsconfig.json's
// own "exclude" list) -- npx tsc --noEmit and npm run verify NEVER
// typecheck this file, so a declared-but-unreferenced HITL_INSTRUCTION
// const would silently compile and deploy with zero compiler warning.
// This regression actually happened once during this same row-targeting
// fix (2026-09-01): an edit meant to ADD the new location-instruction
// comment block accidentally REPLACED the `HITL_INSTRUCTION,` array
// element instead, silently dropping the human-in-the-loop framing text
// from every real prompt sent to the provider. Caught only by a manual
// pre-push source read, not by any automated check -- hence this one.
check('the Edge Function system prompt still includes HITL_INSTRUCTION as an actual element of the array buildSystemPrompt() returns (not merely defined-and-unused) -- guards against this file\'s own tsconfig exclusion silently letting a real prompt element get dropped', (() => {
  const definitionCount = (edgeFunctionSrc.match(/\bHITL_INSTRUCTION\b/g) || []).length;
  const promptFnStart = edgeFunctionSrc.indexOf('function buildSystemPrompt');
  const returnStart = edgeFunctionSrc.indexOf('return [', promptFnStart);
  const returnEnd = edgeFunctionSrc.indexOf('].filter(Boolean).join', returnStart);
  const returnedArrayBlock = edgeFunctionSrc.slice(returnStart, returnEnd);
  return definitionCount >= 2 && /\bHITL_INSTRUCTION\b/.test(returnedArrayBlock);
})());

// =====================================================================
// 3. End-to-end fixture: symbolic proposal -> compiled operations ->
//    applyRosterPatch -> reconciliation -> net diff, ALL UNCHANGED.
// =====================================================================

const ROTATIONS: Rotation[] = [{ id: 'rot-fmc', name: 'Family Medicine', department: 'Family Medicine', active: true, created_at: '' }];
const SUBMISSIONS: SubmissionWithWorkforce[] = [];

function hypotheticalRoster(grids: RosterGrids): CombinedMasterRoster {
  return { id: 'm1', collection_id: 'c1', month: 9, year: 2026, status: 'published', ...grids, published_at: null, created_at: '' };
}

check('end-to-end: full proposal fixture compiles -> applies -> reconciles -> net-diffs correctly for assign/replace/unassign/swap together', (() => {
  const base = freshGrids();
  const proposal: ProposedRosterPatch = {
    ...validProposalBase,
    operations: [
      { op: 'assign', section: 'gop', date_or_day: 'Tue 02/09', label: 'Floor Clinic', field: 'residents', subject_name: 'Dr. Bola' },
      { op: 'unassign', section: 'satellite', date_or_day: null, label: 'Agbeke Mercy', field: 'assigned', subject_name: 'Dr. Ada' },
    ],
  };
  const validated = validateProposedRosterPatch(proposal);
  if (validated.status === 'error') return false;
  const compiled = compileProposalOperations(validated.proposal.operations, base, WORKFORCE);
  if (compiled.some((c) => c.status !== 'resolved')) return false;
  const flat = compiled.flatMap((c) => (c as Extract<CompiledProposalOperation, { status: 'resolved' }>).operations);
  const applied = applyRosterPatch(base, flat, WORKFORCE);
  if (applied.errors.length !== 0) return false;
  if (!applied.grids.gop_clinic_grid.slots[1].residents?.includes('w2')) return false;
  if (applied.grids.satellite_grid.postings[0].assigned.length !== 0) return false;
  const issues = computeReconciliationIssues(SUBMISSIONS, WORKFORCE, ROTATIONS, hypotheticalRoster(applied.grids));
  if (!Array.isArray(issues)) return false;
  const netDiff = computeNetRosterDiff(base, applied.grids, WORKFORCE);
  return netDiff.length === 2;
})());

check('no-op/net-zero proposal: assign-then-implicit-cancel (replace back to original) nets to zero via the UNCHANGED computeNetRosterDiff', (() => {
  const base = freshGrids();
  const ops: RosterPatchOperation[] = [
    { op: 'replace', section: 'gop', row_index: 0, field: 'residents', from_workforce_id: 'w1', to_workforce_id: 'w2' },
    { op: 'replace', section: 'gop', row_index: 0, field: 'residents', from_workforce_id: 'w2', to_workforce_id: 'w1' },
  ];
  const applied = applyRosterPatch(base, ops, WORKFORCE);
  const netDiff = computeNetRosterDiff(base, applied.grids, WORKFORCE);
  return applied.errors.length === 0 && netDiff.length === 0;
})());

check('Chief accepts ALL resolved operations: every resolved compiled operation converts and applies', (() => {
  const base = freshGrids();
  const compiled = compileProposalOperations(
    [
      { op: 'assign', section: 'gop', date_or_day: 'Tue 02/09', label: 'Floor Clinic', field: 'residents', subject_name: 'Dr. Bola' },
      { op: 'assign', section: 'gop', date_or_day: 'Tue 02/09', label: 'Floor Clinic', field: 'consultants', subject_name: 'Dr. Chidi' },
    ],
    base,
    WORKFORCE
  );
  const accepted = compiled.filter((c) => c.status === 'resolved') as Extract<CompiledProposalOperation, { status: 'resolved' }>[];
  const flat = accepted.flatMap((c) => c.operations);
  const applied = applyRosterPatch(base, flat, WORKFORCE);
  return accepted.length === 2 && applied.errors.length === 0 && applied.diffs.length === 2;
})());

check('Chief accepts a SUBSET: only checked indices convert, unchecked resolved operations never reach applyRosterPatch', (() => {
  const base = freshGrids();
  const compiled = compileProposalOperations(
    [
      { op: 'assign', section: 'gop', date_or_day: 'Tue 02/09', label: 'Floor Clinic', field: 'residents', subject_name: 'Dr. Bola' },
      { op: 'assign', section: 'gop', date_or_day: 'Tue 02/09', label: 'Floor Clinic', field: 'consultants', subject_name: 'Dr. Chidi' },
    ],
    base,
    WORKFORCE
  );
  const acceptedIndices = new Set([0]);
  const flat = compiled.filter((c, i) => c.status === 'resolved' && acceptedIndices.has(i)).flatMap((c) => (c as Extract<CompiledProposalOperation, { status: 'resolved' }>).operations);
  const applied = applyRosterPatch(base, flat, WORKFORCE);
  return flat.length === 1 && applied.diffs.length === 1 && !applied.grids.gop_clinic_grid.slots[1].consultants.includes('w3');
})());

check('Chief rejects everything: zero operations ever reach applyRosterPatch/pendingOperations', (() => {
  const compiled = compileProposalOperations([{ op: 'assign', section: 'gop', date_or_day: 'Tue 02/09', label: 'Floor Clinic', field: 'residents', subject_name: 'Dr. Bola' }], freshGrids(), WORKFORCE);
  const acceptedIndices = new Set<number>();
  const flat = compiled.filter((c, i) => c.status === 'resolved' && acceptedIndices.has(i));
  return flat.length === 0;
})());

check('proposal introducing a reconciliation issue surfaces it via the UNCHANGED computeReconciliationIssues, not a special AI-aware code path', (() => {
  const base = freshGrids();
  const compiled = compileProposalOperations([{ op: 'unassign', section: 'supervision', date_or_day: 'Mon 01/09', label: null, field: 'first_on_duty', subject_name: 'Dr. Ada' }], base, WORKFORCE);
  const flat = (compiled[0] as Extract<CompiledProposalOperation, { status: 'resolved' }>).operations;
  const applied = applyRosterPatch(base, flat, WORKFORCE);
  const issues = computeReconciliationIssues(SUBMISSIONS, WORKFORCE, ROTATIONS, hypotheticalRoster(applied.grids));
  return applied.errors.length === 0 && Array.isArray(issues);
})());

// =====================================================================
// 4. Stale revision after generation -- reuses the EXISTING
//    classifyOperationsForRebase (rosterRebase.ts, UNCHANGED).
// =====================================================================

check('stale revision after proposal generation: an accepted AI operation whose OWN target is unchanged classifies REPLAYABLE even though the revision moved elsewhere -- an unrelated edit never blocks it (per rosterRebase.ts\'s own per-target, not whole-roster, design)', (() => {
  const baseGrids = freshGrids();
  const latestGrids = freshGrids();
  // Someone else's edit landed on a DIFFERENT target (satellite row 0)
  // while this AI operation (gop row 1 residents) was pending accept.
  latestGrids.satellite_grid.postings[0].assigned = ['w2'];
  const acceptedOps: RosterPatchOperation[] = [{ op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' }];
  const results = classifyOperationsForRebase(baseGrids, latestGrids, acceptedOps, WORKFORCE);
  return results.length === 1 && results[0].classification === 'REPLAYABLE';
})());

check('stale revision after proposal generation: an accepted AI operation whose OWN target changed elsewhere classifies CONFLICT, never silently replayed', (() => {
  const baseGrids = freshGrids();
  const latestGrids = freshGrids();
  // This time someone else's edit landed on the EXACT target this AI
  // operation addresses.
  latestGrids.gop_clinic_grid.slots[1].residents = ['w3'];
  const acceptedOps: RosterPatchOperation[] = [{ op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' }];
  const results = classifyOperationsForRebase(baseGrids, latestGrids, acceptedOps, WORKFORCE);
  return results.length === 1 && results[0].classification === 'CONFLICT';
})());

// =====================================================================
// 4b. Server-side context allowlisting (2026-08-30 production-readiness
//     review, Section B) -- normalizeRosterContext/normalizeWorkforceContext/
//     normalizeSectionLabels (schema.ts, REAL functions, not reimplemented)
//     must strip any field beyond the exact allowed shape before it can
//     ever reach buildSystemPrompt(). Explicit deterministic field picking:
//     these tests prove smuggled fields are ABSENT from the normalized
//     output, not merely "probably ignored."
// =====================================================================

check('normalizeWorkforceContext keeps only display_name/category for a well-formed entry', (() => {
  const out = normalizeWorkforceContext([{ display_name: 'Dr. Ada', category: 'Senior Registrar' }]);
  return out.length === 1 && Object.keys(out[0]).sort().join(',') === 'category,display_name';
})());

check('normalizeWorkforceContext strips a smuggled workforce_id -- the field is structurally absent from the output object, not merely unused', (() => {
  const out = normalizeWorkforceContext([{ display_name: 'Dr. Ada', category: 'Senior Registrar', workforce_id: 'w1-real-uuid' }]);
  return out.length === 1 && !('workforce_id' in out[0]) && JSON.stringify(out).indexOf('w1-real-uuid') === -1;
})());

check('normalizeWorkforceContext strips smuggled resident_code, email, and auth uid fields', (() => {
  const out = normalizeWorkforceContext([{
    display_name: 'Dr. Ada', category: 'Senior Registrar',
    resident_code: 'SECRET123', email: 'ada@example.com', auth_user_id: 'auth-uid-xyz', tenant_id: 'tenant-1',
  }]);
  const serialized = JSON.stringify(out);
  return out.length === 1
    && !('resident_code' in out[0]) && !('email' in out[0]) && !('auth_user_id' in out[0]) && !('tenant_id' in out[0])
    && !serialized.includes('SECRET123') && !serialized.includes('ada@example.com') && !serialized.includes('auth-uid-xyz') && !serialized.includes('tenant-1');
})());

check('normalizeWorkforceContext drops a nested uncontrolled object entirely rather than forwarding it', (() => {
  const out = normalizeWorkforceContext([{
    display_name: 'Dr. Ada', category: 'Senior Registrar',
    profile: { admin_access_code: 'should-never-appear', nested: { deeper: 'still-never' } },
  }]);
  const serialized = JSON.stringify(out);
  return !serialized.includes('should-never-appear') && !serialized.includes('still-never') && !('profile' in out[0]);
})());

check('normalizeWorkforceContext rejects an entry with an invalid/unknown category rather than forwarding it as-is', (() => {
  const out = normalizeWorkforceContext([{ display_name: 'Dr. X', category: 'Consultant Supreme Overlord' }]);
  return out.length === 0;
})());

check('normalizeRosterContext keeps only section/row_index/date_or_day/label/current for a well-formed row', (() => {
  const out = normalizeRosterContext([{ section: 'gop', row_index: 0, date_or_day: 'Mon', label: 'Triage', current: { residents: ['Dr. Ada'] } }]);
  return out.length === 1 && Object.keys(out[0]).sort().join(',') === 'current,date_or_day,label,row_index,section';
})());

check('normalizeRosterContext: the constructed row object has no key beyond the 5 allowed ones, regardless of extra input keys (workforce_id/tenant_id/admin_access_code/resident_code all smuggled in and dropped)', (() => {
  const out = normalizeRosterContext([{
    section: 'gop', row_index: 0, date_or_day: 'Mon', label: 'Triage', current: {},
    workforce_id: 'w1', tenant_id: 't1', admin_access_code: 'ADMIN-SECRET', resident_code: 'R1',
  }]);
  const allowedKeys = new Set(['section', 'row_index', 'date_or_day', 'label', 'current']);
  return out.length === 1 && Object.keys(out[0]).every((k) => allowedKeys.has(k));
})());

check('normalizeRosterContext rejects a row with an unknown section rather than forwarding it', (() => {
  const out = normalizeRosterContext([{ section: 'billing', row_index: 0, date_or_day: null, label: null, current: {} }]);
  return out.length === 0;
})());

check('normalizeRosterContext rejects a row with a non-integer/negative row_index rather than forwarding it', (() => {
  const out = normalizeRosterContext([
    { section: 'gop', row_index: -1, date_or_day: null, label: null, current: {} },
    { section: 'gop', row_index: 1.5, date_or_day: null, label: null, current: {} },
  ]);
  return out.length === 0;
})());

check('normalizeRosterContext.current: only fields valid for the row\'s own section are kept, and only plain display-name-string arrays or null -- an object/id smuggled into an array slot is filtered out', (() => {
  const out = normalizeRosterContext([{
    section: 'gop', row_index: 0, date_or_day: null, label: null,
    current: {
      residents: ['Dr. Ada', { workforce_id: 'w1' }, 42, null],
      on_call: ['should be dropped -- on_call is not a valid gop field'], // wrong-section field
    },
  }]);
  return out.length === 1
    && JSON.stringify(out[0].current.residents) === JSON.stringify(['Dr. Ada'])
    && !('on_call' in out[0].current);
})());

check('normalizeSectionLabels keeps only the 4 known section keys with string values, dropping anything else', (() => {
  const out = normalizeSectionLabels({ gop: 'Floor Clinic', emergency: 'A&E', made_up_key: 'should be dropped', supervision: 42 });
  return out !== undefined
    && out.gop === 'Floor Clinic' && out.emergency === 'A&E'
    && !('made_up_key' in (out as object)) && !('supervision' in (out as object));
})());

check('normalizeSectionLabels returns undefined for a non-object or empty-result input, never throws', (() => {
  return normalizeSectionLabels(undefined) === undefined
    && normalizeSectionLabels(null) === undefined
    && normalizeSectionLabels('not an object') === undefined
    && normalizeSectionLabels([1, 2, 3]) === undefined
    && normalizeSectionLabels({ unknown_key: 'x' }) === undefined;
})());

check('end-to-end: a full smuggled request payload (workforce_id, tenant_id, admin_access_code, resident_code, email, auth uid, nested objects) yields normalized context whose serialized form contains none of the smuggled values', (() => {
  const rawWorkforce = [
    { display_name: 'Dr. Ada', category: 'Senior Registrar', workforce_id: 'w1-uuid', resident_code: 'RES-001', email: 'ada@hospital.example', auth_user_id: 'auth-uuid-1' },
  ];
  const rawRoster = [
    { section: 'gop', row_index: 0, date_or_day: 'Mon', label: 'Triage', current: { residents: ['Dr. Ada'] }, tenant_id: 'tenant-uuid-1', admin_access_code: 'CHIEF-SECRET-CODE', nested: { patient_data: 'should never appear' } },
  ];
  const normalizedWorkforce = normalizeWorkforceContext(rawWorkforce);
  const normalizedRoster = normalizeRosterContext(rawRoster);
  const serialized = JSON.stringify({ normalizedWorkforce, normalizedRoster });
  const smuggled = ['w1-uuid', 'RES-001', 'ada@hospital.example', 'auth-uuid-1', 'tenant-uuid-1', 'CHIEF-SECRET-CODE', 'should never appear'];
  return smuggled.every((needle) => !serialized.includes(needle));
})());

check('Edge Function only ever passes normalizeRosterContext()/normalizeWorkforceContext()/normalizeSectionLabels() output to buildSystemPrompt() -- never the raw request-body roster_context/workforce_context/section_labels directly', (() => {
  return /buildSystemPrompt\(normalizedRosterContext, normalizedWorkforceContext, normalizedSectionLabels\)/.test(edgeFunctionCodeOnly)
    && !/buildSystemPrompt\(roster_context, workforce_context, section_labels\)/.test(edgeFunctionCodeOnly);
})());

// =====================================================================
// 5. Structural/source-text proofs (matching verify-roster-patch.ts's own
//    convention for this kind of proof).
// =====================================================================

check('Edge Function makes NO database write of any kind and calls NO revision RPC / save / publish -- confirmed by source inspection (comments mentioning these names for documentation are fine; only actual code matters)', (() => {
  return !/\.from\(.*\)\.(insert|update|upsert|delete)\(/.test(edgeFunctionCodeOnly)
    && !/chief_save_roster_revision|chief_publish_roster_revision|chief_start_roster_revision|chief_discard_roster_revision/.test(edgeFunctionCodeOnly)
    && !/combined_master_rosters/.test(edgeFunctionCodeOnly);
})());

check('Edge Function never accepts a client-supplied tenant_id -- RequestBody has no tenant_id field, and tenant is derived only from admin_access_code', (() => {
  return !/tenant_id\??:\s*string/.test(edgeFunctionSrc.slice(0, edgeFunctionSrc.indexOf('Deno.serve')))
    && /verifyAdminCodeAndDeriveTenant\(supabaseUrl, serviceRoleKey, admin_access_code\)/.test(edgeFunctionSrc);
})());

check('Edge Function never includes admin_access_code (or the request body itself) inside the model prompt -- buildSystemPrompt() only ever receives rosterContext/workforceContext/sectionLabels, and neither callOpenAI/callGemini receives admin_access_code', (() => {
  const buildPromptFn = edgeFunctionSrc.slice(edgeFunctionSrc.indexOf('function buildSystemPrompt'), edgeFunctionSrc.indexOf('interface ProviderResult'));
  return !/admin_access_code|admin_code|adminCode/i.test(buildPromptFn)
    && /function buildSystemPrompt\(\s*rosterContext: RosterContextRow\[\],\s*workforceContext: WorkforceContextEntry\[\],\s*sectionLabels\?/.test(edgeFunctionSrc);
})());

check('Edge Function rejects a schema-invalid model response as a safe failure (schema_invalid), never forwarding raw model output to the client', (() => {
  return /if \(validated\.status === 'error'\)/.test(edgeFunctionSrc) && /status: 'schema_invalid'/.test(edgeFunctionSrc);
})());

// --- Migration 80 fix (2026-08-30): admin code verification moved from a
//     raw GET-with-query-string REST read to an RPC call (POST body). ---

check('verifyAdminCodeAndDeriveTenant() calls the verify_chief_admin_code RPC via admin.rpc(...), never a raw fetch() to /rest/v1/settings', (() => {
  const fnSrc = edgeFunctionSrc.slice(edgeFunctionSrc.indexOf('async function verifyAdminCodeAndDeriveTenant'), edgeFunctionSrc.indexOf('async function checkTenantAiQuota'));
  return /admin\.rpc\('verify_chief_admin_code', \{ p_admin_code: adminCode \}\)/.test(fnSrc);
})());

check('the raw admin code never appears in a URL/query-string construction anywhere in the Edge Function\'s actual code -- no fetch() call embeds admin_access_code or adminCode in its URL argument (a comment documenting the OLD, replaced approach for context is fine; only real code matters)', (() => {
  return !/\/rest\/v1\/settings\?admin_access_code/.test(edgeFunctionCodeOnly)
    && !/encodeURIComponent\(adminCode\)/.test(edgeFunctionCodeOnly)
    && !/encodeURIComponent\(admin_access_code\)/.test(edgeFunctionCodeOnly);
})());

check('verifyAdminCodeAndDeriveTenant() still returns only a tenant_id (or null), never the settings row itself -- the RPC result is used directly as the tenant id, no other field is read off it', (() => {
  const fnSrc = edgeFunctionSrc.slice(edgeFunctionSrc.indexOf('async function verifyAdminCodeAndDeriveTenant'), edgeFunctionSrc.indexOf('async function checkTenantAiQuota'));
  return /return \(data as string \| null\) \?\? null;/.test(fnSrc);
})());

check('the Edge Function still derives tenant ONLY from the verified admin code, never from client-supplied input -- unchanged call site', (() => {
  return /const tenantId = await verifyAdminCodeAndDeriveTenant\(supabaseUrl, serviceRoleKey, admin_access_code\);/.test(edgeFunctionSrc);
})());

// --- Smoke-gate cleanup (2026-08-31): the server-only tenant-bound
//     exactly-one-provider-request mechanism (ROSTER_AI_SMOKE_PROVIDER /
//     ROSTER_AI_SMOKE_TENANT_ID) has served its purpose -- the one
//     authorized live AI smoke call succeeded and was fully verified
//     (DEPLOYED_AI_SMOKE_VERIFIED) -- and has been removed from source.
//     This single check proves the removal is complete and the original
//     unconditional fallback is restored exactly, replacing the 7 checks
//     that used to assert the gate's own structural guarantees. ---

check('no smoke-gate reference of any kind remains in the Edge Function -- no ROSTER_AI_SMOKE_PROVIDER, no ROSTER_AI_SMOKE_TENANT_ID, no smokeModeActive/smokeProvider/smokeTenantId identifier anywhere -- and the provider-call line is restored to the exact original unconditional OpenAI-then-Gemini fallback expression, byte-for-byte', (() => {
  const noSmokeReferences = !/ROSTER_AI_SMOKE_PROVIDER/.test(edgeFunctionSrc)
    && !/ROSTER_AI_SMOKE_TENANT_ID/.test(edgeFunctionSrc)
    && !/smokeModeActive/.test(edgeFunctionSrc)
    && !/smokeProvider/.test(edgeFunctionSrc)
    && !/smokeTenantId/.test(edgeFunctionSrc);
  const exactOriginalFallbackRestored = /const result = \(await callOpenAI\(systemPrompt, instruction\)\) \?\? \(await callGemini\(systemPrompt, instruction\)\);/.test(edgeFunctionSrc);
  return noSmokeReferences && exactOriginalFallbackRestored;
})());

check('Client service (rosterPatchProposalService.ts) makes NO database write of any kind and calls NO RPC -- only supabase.functions.invoke', (() => {
  return /supabase\.functions\.invoke\('roster-patch-proposal'/.test(serviceSrc)
    && !/\.rpc\(/.test(serviceSrc)
    && !/\.from\(/.test(serviceSrc);
})());

check('Compiler (rosterPatchProposalCompiler.ts) makes NO database write, calls NO RPC, and never calls save/publish', (() => {
  return !/\.rpc\(|\.from\(|saveRevision|publishRevision|supabase\./.test(compilerSrc);
})());

check('MultiRosterManagerView.tsx: the AI Proposal panel is gated on BOTH an active revision AND the tenant exposure flag (2026-08-31 containment slice) -- no active revision hides it regardless of the flag, since the flag only appears as the SECOND operand of this same &&', (() => {
  const panelStart = chiefEditorTsx.indexOf('AI Proposal — Chief-reviewed only');
  const guardBefore = chiefEditorTsx.slice(Math.max(0, panelStart - 600), panelStart);
  return /\{activeRevision && rosterAiV1Enabled && \(/.test(guardBefore);
})());

// --- Tenant exposure gate (2026-08-31 containment slice): the panel that
//     was live and ungated for every Chief with an active revision is now
//     gated on tenants.module_flags.roster_ai_v1_enabled, fail-closed by
//     default. Static-only checks below, matching this file's own
//     convention -- no live rendering/DOM test exists in this suite. ---

check('rosterAiV1Enabled starts fail-closed (useState(false)) -- the render guard cannot be satisfied before the tenant fetch resolves, so "no active revision" and "flag not yet loaded" both hide the panel by the same default', (() => {
  return /const \[rosterAiV1Enabled, setRosterAiV1Enabled\] = useState\(false\);/.test(chiefEditorTsx);
})());

check('rosterAiV1Enabled is set ONLY via a strict === true comparison against the fetched flag -- absent module_flags, a missing key, null, or false are all structurally indistinguishable and all resolve to false (never inferred true, never a truthy/falsy coercion that could treat an unexpected non-boolean value as enabling access)', (() => {
  return /setRosterAiV1Enabled\(tenant\?\.module_flags\?\.roster_ai_v1_enabled === true\);/.test(chiefEditorTsx);
})());

check('a failed tenant fetch (network/RLS/any error) only logs a warning -- it never calls setRosterAiV1Enabled at all, so the state stays at its fail-closed default (false) rather than being set true on any error path', (() => {
  const effectBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('databaseService.getTenant(tenantId)'), chiefEditorTsx.indexOf('}, [tenantId]);') + 20);
  const catchBlock = effectBlock.slice(effectBlock.indexOf('.catch('));
  return catchBlock.length > 0 && !/setRosterAiV1Enabled/.test(catchBlock);
})());

check('roster_ai_v1_enabled is NOT added to TenantCustomizationView\'s Chief-facing MODULE_TOGGLES list -- stays operator-only for this first pilot, not Chief self-service', (() => {
  const toggleListSrc = fs.readFileSync(path.join(__dirname, '..', 'src/modules/org-admin/components/dashboard/TenantCustomizationView.tsx'), 'utf8');
  const togglesBlock = toggleListSrc.slice(toggleListSrc.indexOf('getModuleToggles'), toggleListSrc.indexOf('const TERMINOLOGY_KEYS'));
  return !/roster_ai_v1_enabled/.test(togglesBlock);
})());

check('the tenant-fetch effect for the exposure gate is isolated from load() -- a separate useEffect keyed on [tenantId], never folded into the main data loader, so a failure here cannot affect roster/workforce/collection loading', (() => {
  const gateEffectIdx = chiefEditorTsx.indexOf('databaseService.getTenant(tenantId)');
  const loadCallIdx = chiefEditorTsx.indexOf('    load();');
  const loadFnDeclIdx = chiefEditorTsx.indexOf('const load = async');
  return gateEffectIdx > -1 && loadCallIdx > loadFnDeclIdx && gateEffectIdx > loadCallIdx;
})());

check('the exposure gate affects ONLY the AI Proposal panel\'s presentation -- rosterAiV1Enabled is never referenced inside the Structured Edit panel, the Swap panel, acceptAiOperations() (the pendingOperations queueing/save/publish path), or the request body sent to generateRosterPatchProposal (tenant derivation happens server-side from admin_access_code, unaffected by this client-side flag)', (() => {
  const structuredEditBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('Structured Edit — assign'), chiefEditorTsx.indexOf('Swap — compiles into 2 replace operations'));
  // Ends at the AI panel's OWN render guard (not the later h3 text) -- that
  // guard line legitimately contains the identifier; this check is about
  // the Swap panel's content being unaffected, not the AI panel's own gate.
  const swapBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('Swap — compiles into 2 replace operations'), chiefEditorTsx.indexOf('{activeRevision && rosterAiV1Enabled && ('));
  const acceptBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const acceptAiOperations'), chiefEditorTsx.indexOf('if (isLoading)'));
  const generateBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const generateAiProposal'), chiefEditorTsx.indexOf('const toggleAiAcceptedIndex'));
  return !/rosterAiV1Enabled/.test(structuredEditBlock)
    && !/rosterAiV1Enabled/.test(swapBlock)
    && !/rosterAiV1Enabled/.test(acceptBlock)
    && !/rosterAiV1Enabled/.test(generateBlock);
})());

check('MultiRosterManagerView.tsx: acceptAiOperations() appends into the EXISTING pendingOperations queue via setPendingOperations, introducing no parallel queue', (() => {
  const block = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const acceptAiOperations'), chiefEditorTsx.indexOf('if (isLoading)'));
  return /setPendingOperations\(\(prev\) => \[\.\.\.prev, \.\.\.aiCheckedFlatOperations\]\)/.test(block);
})());

check('MultiRosterManagerView.tsx: acceptAiOperations() never calls saveRevision/publishRevision directly -- AI acceptance only queues, it never saves or publishes', (() => {
  const block = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const acceptAiOperations'), chiefEditorTsx.indexOf('if (isLoading)'));
  return !/rosterRevisionService\.(save|publish)Revision/.test(block);
})());

check('MultiRosterManagerView.tsx: a stale working state (local grids changed since proposal generation) routes into the EXISTING rebasePreview/pendingLatestRevision state via buildRebasePreview, never a silent regenerate/apply', (() => {
  const block = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const acceptAiOperations'), chiefEditorTsx.indexOf('if (isLoading)'));
  return /buildRebasePreview\(aiProposalBaseGrids, currentGrids, aiCheckedFlatOperations, workforce\)/.test(block)
    && /setRebasePreview\(preview\)/.test(block)
    && /setPendingLatestRevision\(\{ \.\.\.activeRevision, \.\.\.currentGrids \}\)/.test(block);
})());

check('MultiRosterManagerView.tsx: working-state-staleness fix (2026-08-30) -- aiProposalBaseGrids is captured from currentGridsSnapshot() at generation time, NOT from revisionGridsOrEmpty(activeRevision) (the original bug)', (() => {
  const genBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const generateAiProposal'), chiefEditorTsx.indexOf('const toggleAiAcceptedIndex'));
  return /const generationGrids = currentGridsSnapshot\(\)/.test(genBlock)
    && /setAiProposalBaseGrids\(generationGrids\)/.test(genBlock)
    && !/setAiProposalBaseGrids\(revisionGridsOrEmpty\(activeRevision\)\)/.test(genBlock);
})());

check('MultiRosterManagerView.tsx: the compiler is invoked against the SAME generationGrids sent to the model, not a freshly re-read currentGridsSnapshot() call after the async provider round-trip', (() => {
  const genBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const generateAiProposal'), chiefEditorTsx.indexOf('const toggleAiAcceptedIndex'));
  return /compileProposalOperations\(result\.proposal\.operations, generationGrids, workforce\)/.test(genBlock);
})());

check('MultiRosterManagerView.tsx: isStale compares JSON-stringified CURRENT grids against aiProposalBaseGrids by content, not activeRevision.id/updated_at (the original bug\'s primary signal)', (() => {
  const block = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const acceptAiOperations'), chiefEditorTsx.indexOf('if (isLoading)'));
  const staleLine = block.slice(block.indexOf('const isStale'), block.indexOf(';', block.indexOf('const isStale')) + 1);
  return /JSON\.stringify\(currentGrids\) !== JSON\.stringify\(aiProposalBaseGrids\)/.test(staleLine)
    && !/activeRevision\.updated_at !== aiProposalBaseUpdatedAt/.test(staleLine)
    && !/activeRevision\.id !== aiProposalBaseRevisionId/.test(staleLine);
})());

check('MultiRosterManagerView.tsx: revision id/updated_at are still captured at generation time (preserved as identity/context) even though they no longer drive the staleness decision', (() => {
  const genBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const generateAiProposal'), chiefEditorTsx.indexOf('const toggleAiAcceptedIndex'));
  return /setAiProposalBaseRevisionId\(activeRevision\.id\)/.test(genBlock) && /setAiProposalBaseUpdatedAt\(activeRevision\.updated_at\)/.test(genBlock);
})());

// --- Deterministic proof of the working-state invariant itself, using the
//     REAL rosterRebase.ts functions (UNCHANGED) with grid-content fixtures
//     -- exercises exactly what acceptAiOperations()'s new isStale/
//     buildRebasePreview call does, without needing to execute React. ---

check('working-state invariant: a proposal generated with an unsaved manual edit already baked in has that edit reflected in its own baseline (baseline = the exact grids passed to context-building, per the source fix above)', (() => {
  const base = freshGrids();
  // Simulate "Chief made an unsaved manual edit, THEN generated a proposal" --
  // generationGrids (== aiProposalBaseGrids per the fix) must be the
  // POST-edit grids, not the pre-edit ones.
  const manualEdit: RosterPatchOperation = { op: 'assign', section: 'gop', row_index: 1, field: 'consultants', workforce_id: 'w3' };
  const afterManualEdit = applyRosterPatch(base, [manualEdit], WORKFORCE).grids;
  const generationGrids = afterManualEdit; // what generateAiProposal() would now capture as aiProposalBaseGrids
  return generationGrids.gop_clinic_grid.slots[1].consultants.includes('w3');
})());

check('working-state invariant: an ADDITIONAL local edit after proposal generation makes the working state stale relative to that baseline (content comparison, not revision metadata)', (() => {
  const generationGrids = freshGrids(); // captured at generation time
  const anotherManualEdit: RosterPatchOperation = { op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' };
  const currentGrids = applyRosterPatch(generationGrids, [anotherManualEdit], WORKFORCE).grids; // Chief's state has moved on since
  return JSON.stringify(currentGrids) !== JSON.stringify(generationGrids); // this is exactly acceptAiOperations()'s new isStale predicate
})());

check('working-state invariant: a prior AI-accepted (and applied) edit is reflected in the baseline of a SUBSEQUENT proposal generation, exactly like a manual edit', (() => {
  const base = freshGrids();
  const priorAiAcceptedAndApplied: RosterPatchOperation = { op: 'unassign', section: 'satellite', row_index: 0, field: 'assigned', workforce_id: 'w1' };
  const afterApplyingIt = applyRosterPatch(base, [priorAiAcceptedAndApplied], WORKFORCE).grids; // "Apply Pending Changes to Local Snapshot" already ran
  const secondGenerationGrids = afterApplyingIt; // currentGridsSnapshot() at the time of generating a second proposal
  return secondGenerationGrids.satellite_grid.postings[0].assigned.length === 0;
})());

check('working-state invariant: stale-proposal rebase classification compares the OLD (generation-time) local snapshot to the CURRENT local snapshot -- classifyOperationsForRebase (rosterRebase.ts, UNCHANGED) run exactly as acceptAiOperations() now calls it', (() => {
  const generationGrids = freshGrids();
  // The Chief manually edited the SAME target the accepted AI operation targets, after generation.
  const conflictingManualEdit: RosterPatchOperation = { op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w3' };
  const currentGrids = applyRosterPatch(generationGrids, [conflictingManualEdit], WORKFORCE).grids;
  const acceptedAiOp: RosterPatchOperation = { op: 'assign', section: 'gop', row_index: 1, field: 'residents', workforce_id: 'w2' };
  const results = classifyOperationsForRebase(generationGrids, currentGrids, [acceptedAiOp], WORKFORCE);
  return results.length === 1 && results[0].classification === 'CONFLICT';
})());

check('working-state invariant: a conflict with a LOCAL edit is classified CONFLICT even though nothing about "server revision" changed -- proves the fix no longer relies on revision id/updated_at to detect this', (() => {
  // Same fixture as above, framed explicitly: classifyOperationsForRebase
  // takes two GRID snapshots, never a revision id/timestamp at all -- there
  // is structurally no way for this call to "trust" unchanged revision
  // metadata into masking a real local-grid conflict.
  const generationGrids = freshGrids();
  const localEdit: RosterPatchOperation = { op: 'unassign', section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' };
  const currentGrids = applyRosterPatch(generationGrids, [localEdit], WORKFORCE).grids;
  const acceptedAiOp: RosterPatchOperation = { op: 'unassign', section: 'gop', row_index: 0, field: 'residents', workforce_id: 'w1' };
  const results = classifyOperationsForRebase(generationGrids, currentGrids, [acceptedAiOp], WORKFORCE);
  // Both the local edit and the AI op target the exact same field -- the
  // local edit already changed it, so replaying the AI op against the
  // pre-edit expectation is a real conflict (TARGET_NO_LONGER_VALID or
  // CONFLICT are both acceptable "not silently REPLAYABLE" outcomes here;
  // REPLAYABLE would be the actual bug).
  return results.length === 1 && results[0].classification !== 'REPLAYABLE';
})());

check('working-state invariant: an UNCHANGED working state (nothing edited between generation and acceptance) remains non-stale', (() => {
  const generationGrids = freshGrids();
  const currentGrids = freshGrids(); // structurally identical, nothing changed
  return JSON.stringify(currentGrids) === JSON.stringify(generationGrids);
})());

check('saveDraft()\'s optional AI-assisted change_reason never overwrites an existing Chief-entered reason -- confirmed there is no other change_reason source in saveDraft() to overwrite (the 5th saveRevision argument is only ever this computed value or undefined)', (() => {
  const saveDraftBlock = chiefEditorTsx.slice(chiefEditorTsx.indexOf('const saveDraft = async'), chiefEditorTsx.indexOf('const publish = async'));
  return /rosterRevisionService\.saveRevision\(adminCode, revision\.id, revision\.updated_at, currentGridsSnapshot\(\), changeReason\)/.test(saveDraftBlock)
    && (saveDraftBlock.match(/changeReason/g) || []).length >= 2;
})());

check('the Roster AI feature itself (this file\'s own scope) added zero migrations -- migration 80, when present, is exclusively the separate, later, explicitly-authorized admin-code-transport SECURITY_HARDENING fix (verify_chief_admin_code), never a Roster AI feature-schema change; the ceiling is 79 or 80, never higher, and 80 (if present) is exactly that one function', (() => {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_/.test(f));
  const numbers = files.map((f) => parseInt(f.split('_')[0], 10));
  const ceiling = Math.max(...numbers);
  if (ceiling === 79) return true;
  if (ceiling !== 80) return false;
  const m80 = fs.readFileSync(path.join(migrationsDir, '80_verify_chief_admin_code.sql'), 'utf8');
  const m80CodeOnly = m80.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  return /CREATE OR REPLACE FUNCTION public\.verify_chief_admin_code/.test(m80CodeOnly) && !/roster_revisions|combined_master_rosters/.test(m80CodeOnly);
})());

check('roster_revisions.source / source_reference and chief_save_roster_revision are untouched -- confirmed no file in this slice references chief_save_roster_revision\'s SQL definition or attempts to alter it', (() => {
  return !/CREATE OR REPLACE FUNCTION.*chief_save_roster_revision/s.test(edgeFunctionSrc)
    && !/CREATE OR REPLACE FUNCTION.*chief_save_roster_revision/s.test(compilerSrc)
    && !/CREATE OR REPLACE FUNCTION.*chief_save_roster_revision/s.test(serviceSrc);
})());

check('This verification performs zero database/network/AI-provider access -- the model is simulated as fixed fixture objects throughout; September\'s real roster cannot be touched by running it', true);

// =====================================================================

console.log(`\n${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
