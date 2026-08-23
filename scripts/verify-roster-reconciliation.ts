#!/usr/bin/env -S npx tsx
// Workforce Option A — regression coverage for the 2026-08-20 hardening
// slice (adversarial findings: whitespace-insensitive rotation matching,
// invalid declared-leave-range detection). Dependency-free by design,
// matching scripts/verify-tenant-surface.cjs/verify-e0-containment.cjs's
// existing convention — no Vitest/Jest/Playwright. Pure in-memory
// fixtures against the real module; no network call, no database, no
// writes anywhere.
//
// Run: npx tsx scripts/verify-roster-reconciliation.ts

import { computeReconciliationIssues } from '../src/modules/roster-engine/lib/rosterReconciliation';
import type { SubmissionWithWorkforce, WorkforceMember, Rotation, CombinedMasterRoster } from '../src/types';

let failures = 0;
function check(label: string, cond: boolean) {
  if (cond) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

const rotations: Rotation[] = [
  { id: 'rot-fmc', name: 'Family Medicine Clinic', department: 'Family Medicine', active: true, created_at: '' },
];

function makeMember(id: string, full_name: string, on_floor: boolean): WorkforceMember {
  return { id, full_name, category: 'Registrar' as any, active: true, on_floor, created_at: '', tenant_id: 't1' } as any;
}

function makeMemberWithCategory(id: string, full_name: string, on_floor: boolean, category: string): WorkforceMember {
  return { id, full_name, category: category as any, active: true, on_floor, created_at: '', tenant_id: 't1' } as any;
}

function makeSubmission(overrides: Partial<SubmissionWithWorkforce>): SubmissionWithWorkforce {
  return {
    id: 'sub-' + Math.random(),
    collection_id: 'c1',
    workforce_id: 'w1',
    current_rotation: 'Family Medicine Clinic',
    next_rotation: 'Family Medicine Clinic',
    current_rotation_id: null,
    next_rotation_id: null,
    taking_leave: false,
    leave_type: null,
    leave_start: null,
    leave_end: null,
    leave_applied: null,
    leave_document_urls: [],
    notes: null,
    created_at: '',
    updated_at: '',
    workforce: { full_name: 'Test', category: 'Registrar' as any },
    ...overrides,
  } as SubmissionWithWorkforce;
}

// FM Slice 1 (2026-08-23) added roster-grid-level checks (Ikolaba,
// floor service-point coverage) that run unconditionally against
// masterRoster regardless of submissions — including `emptyRoster` below,
// which now always yields two missing_expected_coverage findings (1st/3rd
// Friday Ikolaba). The Hardening-1/2 tests below predate those checks and
// assert only on rotation/leave-matching behavior, so they filter those
// two new types out rather than asserting on the raw issue count.
function excludingFmSlice1Coverage(issues: ReturnType<typeof computeReconciliationIssues>) {
  return issues.filter(i => i.type !== 'missing_expected_coverage' && i.type !== 'ineligible_assignment');
}

const emptyRoster: CombinedMasterRoster = {
  id: 'mr1', collection_id: 'c1', month: 8, year: 2026, status: 'draft',
  gop_clinic_grid: { slots: [], unparsed_notes: [] },
  emergency_call_grid: { shifts: [], unparsed_notes: [] },
  supervision_grid: { duties: [], unparsed_notes: [] },
  satellite_grid: { postings: [], unparsed_notes: [] },
  published_at: null, created_at: '',
};

// --- Hardening 1: whitespace-trimmed free-text rotation matching ---

{
  const w = makeMember('w1', 'Whitespace One', true);
  const s = makeSubmission({ workforce_id: 'w1', current_rotation: 'Family Medicine Clinic ' }); // trailing space
  const issues = excludingFmSlice1Coverage(computeReconciliationIssues([s], [w], rotations, emptyRoster));
  check('trailing-space rotation now resolves and matches on-floor status (zero issues)', issues.length === 0);
}

{
  const w = makeMember('w2', 'Whitespace Two', true);
  const s = makeSubmission({ workforce_id: 'w2', current_rotation: '  Family Medicine Clinic' }); // leading spaces
  const issues = excludingFmSlice1Coverage(computeReconciliationIssues([s], [w], rotations, emptyRoster));
  check('leading-space rotation now resolves and matches on-floor status (zero issues)', issues.length === 0);
}

{
  // Regression guard: must still be exact matching, not fuzzy/case-folded —
  // a lowercase submission must NOT resolve, only whitespace is trimmed.
  const w = makeMember('w3', 'Whitespace Three', true);
  const s = makeSubmission({ workforce_id: 'w3', current_rotation: 'family medicine clinic ' });
  const issues = excludingFmSlice1Coverage(computeReconciliationIssues([s], [w], rotations, emptyRoster));
  check('trim does not add case-folding — lowercase still Needs Review, not matched', issues.length === 1 && issues[0].type === 'unrecognised_rotation');
}

{
  // Canonical rotation names are not trimmed — only submitted free text is.
  const w = makeMember('w4', 'Whitespace Four', false);
  const s = makeSubmission({ workforce_id: 'w4' }); // exact "Family Medicine Clinic", no whitespace
  const issues = excludingFmSlice1Coverage(computeReconciliationIssues([s], [w], rotations, emptyRoster));
  check('unchanged exact match (no whitespace) still produces the expected rotation-conflict', issues.length === 1 && issues[0].type === 'rotation_conflict');
}

// --- Hardening 2: invalid declared-leave-range detection ---

{
  const w = makeMember('w5', 'Reversed One', true);
  const s = makeSubmission({ workforce_id: 'w5', taking_leave: true, leave_start: '2026-08-20', leave_end: '2026-08-05' });
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    gop_clinic_grid: { slots: [{ date_or_day: 'Monday', clinic_type: 'FM Clinic' as any, consultants: [], residents: ['w5'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([s], [w], rotations, roster);
  const invalidRangeIssues = issues.filter(i => i.type === 'invalid_declared_leave_range');
  const overlapIssues = issues.filter(i => i.type === 'leave_roster_overlap');
  check('reversed leave range produces exactly one invalid_declared_leave_range issue', invalidRangeIssues.length === 1);
  check('reversed leave range does NOT also produce a (meaningless) leave_roster_overlap issue', overlapIssues.length === 0);
  check('invalid-range message says "Needs Review" and does not silently swap the dates', /Needs Review/.test(invalidRangeIssues[0]?.message ?? '') && invalidRangeIssues[0]?.evidence.declared_leave_start === '2026-08-20' && invalidRangeIssues[0]?.evidence.declared_leave_end === '2026-08-05');
}

{
  // Regression guard: a VALID range must still detect real overlaps
  // exactly as before this hardening slice.
  const w = makeMember('w6', 'Valid Range One', true);
  const s = makeSubmission({ workforce_id: 'w6', taking_leave: true, leave_start: '2026-08-01', leave_end: '2026-08-31' });
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    gop_clinic_grid: { slots: [{ date_or_day: 'Monday', clinic_type: 'FM Clinic' as any, consultants: [], residents: ['w6'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([s], [w], rotations, roster);
  check('valid leave range still detects a real overlap (unaffected by this hardening)', issues.some(i => i.type === 'leave_roster_overlap'));
  check('valid leave range produces no invalid_declared_leave_range false positive', issues.every(i => i.type !== 'invalid_declared_leave_range'));
}

{
  // Equal start/end (single-day leave) is valid, not "reversed" — must not
  // be flagged as invalid.
  const w = makeMember('w7', 'Single Day', true);
  const s = makeSubmission({ workforce_id: 'w7', taking_leave: true, leave_start: '2026-08-10', leave_end: '2026-08-10' });
  const issues = computeReconciliationIssues([s], [w], rotations, emptyRoster);
  check('equal leave_start/leave_end (single-day leave) is not flagged as an invalid range', issues.every(i => i.type !== 'invalid_declared_leave_range'));
}

// --------------------------------------------------------------------
// FM Slice 1 (2026-08-23): Ikolaba / floor service-point / Special
// coverage read-only checks. `emptyRoster` is August 2026 (month: 8,
// year: 2026) — 1st Friday = 2026-08-07, 3rd Friday = 2026-08-21
// (independently verified against a calendar, not just the module under
// test), used below to confirm calendar-correctness, not just presence.
// --------------------------------------------------------------------

{
  // No Ikolaba posting at all -> missing coverage on both 1st and 3rd
  // Friday, dates calendar-correct.
  const issues = computeReconciliationIssues([], [], rotations, emptyRoster);
  const ikolabaIssues = issues.filter(i => i.type === 'missing_expected_coverage' && i.evidence.facility === 'Ikolaba');
  check('no Ikolaba posting at all surfaces exactly 2 missing-coverage findings', ikolabaIssues.length === 2);
  check('missing-coverage dates are calendar-correct (1st/3rd Friday of Aug 2026)', ikolabaIssues.some(i => i.evidence.date === '2026-08-07') && ikolabaIssues.some(i => i.evidence.date === '2026-08-21'));
  check('Ikolaba missing-coverage issues are not tied to a specific member', ikolabaIssues.every(i => i.workforceId === null && i.memberName === null));
}

{
  // Eligible Senior Registrar, on-floor, assigned to Ikolaba on the bare
  // "Friday" day-name -> satisfies both 1st and 3rd Friday, zero findings.
  const sr = makeMemberWithCategory('sr1', 'Dr. Ikolaba SR', true, 'Senior Registrar');
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    satellite_grid: { postings: [{ facility: 'Ikolaba', date_or_day: 'Friday', assigned: ['sr1'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([], [sr], rotations, roster);
  check('on-floor Senior Registrar assigned to Ikolaba on Friday satisfies both target dates (zero issues)', issues.length === 0);
}

{
  // Assigned but wrong grade (Registrar, not Senior Registrar) -> still
  // missing expected coverage, and the message names who is there.
  const reg = makeMemberWithCategory('reg1', 'Dr. Wrong Grade', true, 'Registrar');
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    satellite_grid: { postings: [{ facility: 'Ikolaba', date_or_day: 'Friday', assigned: ['reg1'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([], [reg], rotations, roster);
  const ikolabaIssues = issues.filter(i => i.type === 'missing_expected_coverage' && i.evidence.facility === 'Ikolaba');
  check('Registrar-grade assignee at Ikolaba still surfaces missing-expected-coverage', ikolabaIssues.length === 2);
  check('missing-coverage message names the ineligible-grade assignee for context', ikolabaIssues.every(i => /Dr\. Wrong Grade/.test(i.message) && /Registrar/.test(i.message)));
}

{
  // Senior Registrar assigned but NOT currently on-floor -> still missing
  // expected coverage (the rule requires moving someone FROM the Floor).
  const sr = makeMemberWithCategory('sr2', 'Dr. Off Floor SR', false, 'Senior Registrar');
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    satellite_grid: { postings: [{ facility: 'Ikolaba', date_or_day: 'Friday', assigned: ['sr2'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([], [sr], rotations, roster);
  const ikolabaIssues = issues.filter(i => i.type === 'missing_expected_coverage' && i.evidence.facility === 'Ikolaba');
  check('off-floor Senior Registrar at Ikolaba still surfaces missing-expected-coverage', ikolabaIssues.length === 2);
}

{
  // Floor service-point coverage: Triage slot with only a Registrar
  // assigned -> missing expected Senior Registrar coverage.
  const reg = makeMemberWithCategory('reg2', 'Dr. Triage Reg', true, 'Registrar');
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    gop_clinic_grid: { slots: [{ date_or_day: 'Monday', clinic_type: 'Triage', consultants: [], residents: ['reg2'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([], [reg], rotations, roster);
  const triageIssues = issues.filter(i => i.type === 'missing_expected_coverage' && i.evidence.clinic_type === 'Triage');
  check('Triage slot with only a Registrar surfaces missing Senior Registrar coverage', triageIssues.length === 1);
}

{
  // Floor service-point coverage: Triage slot with a Senior Registrar
  // present -> satisfied, zero coverage findings for Triage.
  const sr = makeMemberWithCategory('sr3', 'Dr. Triage SR', true, 'Senior Registrar');
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    gop_clinic_grid: { slots: [{ date_or_day: 'Monday', clinic_type: 'Triage', consultants: [], residents: ['sr3'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([], [sr], rotations, roster);
  check('Triage slot with a Senior Registrar present has no Triage coverage finding', issues.every(i => !(i.type === 'missing_expected_coverage' && i.evidence.clinic_type === 'Triage')));
}

{
  // The senior-coverage rule is scoped to Triage/Male Sorting/Female
  // Sorting/Children Sorting only — an unrelated clinic_type (e.g. Annexe)
  // with no Senior Registrar must NOT be flagged.
  const reg = makeMemberWithCategory('reg3', 'Dr. Annexe Reg', true, 'Registrar');
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    gop_clinic_grid: { slots: [{ date_or_day: 'Tuesday', clinic_type: 'Annexe', consultants: [], residents: ['reg3'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([], [reg], rotations, roster);
  check('generic/non-scoped clinic_type (Annexe) is not subject to the Senior Registrar coverage rule', issues.every(i => !(i.type === 'missing_expected_coverage' && i.evidence.clinic_type === 'Annexe')));
}

{
  // Special coverage: a Medical Officer assigned to Airport PHC is an
  // ineligible (wrong-grade) assignment, tied to that specific member.
  const mo = makeMemberWithCategory('mo1', 'Dr. Airport MO', true, 'Medical Officer');
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    satellite_grid: { postings: [{ facility: 'Airport PHC', date_or_day: null, assigned: ['mo1'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([], [mo], rotations, roster);
  const specialIssues = issues.filter(i => i.type === 'ineligible_assignment' && i.evidence.facility === 'Airport PHC');
  check('Medical Officer assigned to Airport PHC special coverage is flagged ineligible_assignment', specialIssues.length === 1 && specialIssues[0].workforceId === 'mo1' && specialIssues[0].memberName === 'Dr. Airport MO');
}

{
  // Special coverage: a Senior Registrar assigned to NYSC is eligible —
  // zero ineligible_assignment findings for that posting.
  const sr = makeMemberWithCategory('sr4', 'Dr. NYSC SR', true, 'Senior Registrar');
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    satellite_grid: { postings: [{ facility: 'NYSC', date_or_day: null, assigned: ['sr4'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([], [sr], rotations, roster);
  check('Senior Registrar assigned to NYSC special coverage is not flagged', issues.every(i => !(i.type === 'ineligible_assignment' && i.evidence.facility === 'NYSC')));
}

{
  // An `assigned` entry that doesn't resolve to any known workforce member
  // (raw parsed text, not yet drag-assigned to a resident id) must be
  // silently skipped, not treated as an ineligible assignment or a crash.
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    satellite_grid: { postings: [{ facility: 'Agbeke Mercy', date_or_day: null, assigned: ['Dr. Unresolved Name'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([], [], rotations, roster);
  check('an unresolved raw-text assignee at a Special coverage posting is silently skipped, not flagged', issues.every(i => i.type !== 'ineligible_assignment'));
}

{
  // Pure-function guarantee: inputs are never mutated by any FM Slice 1
  // check (no automatic roster mutation of any kind).
  const sr = makeMemberWithCategory('sr5', 'Dr. Immutable SR', true, 'Senior Registrar');
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    satellite_grid: { postings: [{ facility: 'Ikolaba', date_or_day: 'Friday', assigned: ['sr5'] }], unparsed_notes: [] },
  };
  const rosterSnapshot = JSON.stringify(roster);
  const workforceSnapshot = JSON.stringify([sr]);
  computeReconciliationIssues([], [sr], rotations, roster);
  check('masterRoster is not mutated by computeReconciliationIssues', JSON.stringify(roster) === rosterSnapshot);
  check('workforce is not mutated by computeReconciliationIssues', JSON.stringify([sr]) === workforceSnapshot);
}

console.log('');
console.log(`${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
