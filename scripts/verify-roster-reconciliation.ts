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

import { computeReconciliationIssues, groupReconciliationIssuesForDisplay } from '../src/modules/roster-engine/lib/rosterReconciliation';
import { extractDayHeader } from '../src/modules/roster-engine/lib/dayHeaderParsing';
import { resolveParsedNameToWorkforceId, normalizeForComparison } from '../src/modules/roster-engine/lib/identityResolver';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { CLINIC_TYPE_PATTERNS } from '../src/modules/roster-engine/lib/clinicTypeMatching';
import {
  applyIdentityResolutionToGopGrid,
  applyIdentityResolutionToEmergencyGrid,
  applyIdentityResolutionToSatelliteGrid,
} from '../src/modules/roster-engine/lib/rosterIdentityIngest';
import type { SubmissionWithWorkforce, WorkforceMember, Rotation, CombinedMasterRoster, ReconciliationIssue, GopClinicGrid, EmergencyCallGrid, SatelliteGrid } from '../src/types';

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

// --------------------------------------------------------------------
// Slice 1B (2026-08-24): groupReconciliationIssuesForDisplay — the pure
// helper MultiRosterManagerView.tsx uses to split member-specific issues
// from roster-level (workforceId = null) ones. Tested here directly since
// the .tsx component itself can't be imported by this dependency-free
// script (it transitively pulls in databaseService.ts's import.meta.env,
// same reasoning as satelliteFacilities.ts above).
// --------------------------------------------------------------------

function makeIssue(overrides: Partial<ReconciliationIssue>): ReconciliationIssue {
  return {
    type: 'rotation_conflict',
    workforceId: 'w1',
    memberName: 'Test Member',
    message: 'test message',
    evidence: {},
    ...overrides,
  };
}

{
  // A missing_expected_coverage issue (workforceId null) must land in
  // rosterLevel, never silently collapse into an unlabeled byMember entry.
  const issue = makeIssue({ type: 'missing_expected_coverage', workforceId: null, memberName: null, message: 'Missing expected coverage: no Senior Registrar at Ikolaba.' });
  const grouped = groupReconciliationIssuesForDisplay([issue]);
  check('a null-workforceId issue is placed in rosterLevel, not byMember', grouped.rosterLevel.length === 1 && grouped.byMember.size === 0);
  check('rosterLevel issue does not disappear — its message is preserved verbatim', grouped.rosterLevel[0]?.message === issue.message);
}

{
  // An ineligible_assignment issue (workforceId present) must still land
  // under its named member, exactly like every pre-existing issue type.
  const issue = makeIssue({ type: 'ineligible_assignment', workforceId: 'mo1', memberName: 'Dr. Airport MO', message: 'Conflicting/ineligible assignment: Dr. Airport MO is a Medical Officer, not a Senior Registrar.' });
  const grouped = groupReconciliationIssuesForDisplay([issue]);
  check('an ineligible_assignment issue groups under its real member, not rosterLevel', grouped.rosterLevel.length === 0 && grouped.byMember.has('mo1'));
  check('the grouped entry keeps the correct memberName and message', grouped.byMember.get('mo1')?.memberName === 'Dr. Airport MO' && grouped.byMember.get('mo1')?.issues[0]?.message === issue.message);
}

{
  // Mixed list: pre-existing member-specific types (rotation_conflict,
  // unrecognised_rotation, leave_roster_overlap, invalid_declared_leave_range)
  // remain unchanged in shape/behavior — they group by member exactly as
  // before this slice, alongside a roster-level issue in the same batch.
  const rotationIssue = makeIssue({ type: 'rotation_conflict', workforceId: 'w1', memberName: 'Dr. One' });
  const secondIssueSameMember = makeIssue({ type: 'unrecognised_rotation', workforceId: 'w1', memberName: 'Dr. One', message: 'second issue' });
  const otherMemberIssue = makeIssue({ type: 'leave_roster_overlap', workforceId: 'w2', memberName: 'Dr. Two' });
  const coverageIssue = makeIssue({ type: 'missing_expected_coverage', workforceId: null, memberName: null, message: 'roster-level finding' });
  const grouped = groupReconciliationIssuesForDisplay([rotationIssue, secondIssueSameMember, otherMemberIssue, coverageIssue]);
  check('existing member-specific issue types still group correctly (2 members, one with 2 issues)', grouped.byMember.size === 2 && grouped.byMember.get('w1')?.issues.length === 2 && grouped.byMember.get('w2')?.issues.length === 1);
  check('the roster-level issue in the same batch is isolated correctly', grouped.rosterLevel.length === 1 && grouped.rosterLevel[0].message === 'roster-level finding');
}

{
  // No issues at all -> both buckets empty, no crash.
  const grouped = groupReconciliationIssuesForDisplay([]);
  check('empty issue list produces empty byMember and rosterLevel', grouped.byMember.size === 0 && grouped.rosterLevel.length === 0);
}

{
  // Pure-function guarantee: the input array is never mutated.
  const issues = [makeIssue({ workforceId: null, memberName: null, type: 'missing_expected_coverage' })];
  const snapshot = JSON.stringify(issues);
  groupReconciliationIssuesForDisplay(issues);
  check('groupReconciliationIssuesForDisplay does not mutate its input', JSON.stringify(issues) === snapshot);
}

// --------------------------------------------------------------------
// September Ingestion Slice 1 (2026-08-25): day-header parsing for the
// real September/August roster document formats, and the new exact-match
// identity resolver. Neither is wired into any ingestion/admin/publish
// path yet — these are standalone-function tests only. Fixtures below are
// sanitized/shaped like the real documents, not the actual individuals.
// --------------------------------------------------------------------

// --- Day-header parsing ---

check('new format: abbreviated day + numeric date ("Tue 01/09")', extractDayHeader('Tue 01/09') === 'Tue 01/09');
check('new format: 4-letter abbreviation seen in real source ("THUR 06/08/26")', extractDayHeader('THUR 06/08/26') === 'THUR 06/08/26');
check('new format: ordinal + parenthesized abbreviated day ("1st (Tue)")', extractDayHeader('1st (Tue)') === '1st (Tue)');
check('already-supported: full day name + comma + date ("Tuesday, 01/09")', extractDayHeader('Tuesday, 01/09') === 'Tuesday, 01/09');
check('already-supported: bare day name ("Monday")', extractDayHeader('Monday') === 'Monday');
check('already-supported: bare numeric date ("12/08")', extractDayHeader('12/08') === '12/08');
check('already-supported: ordinal + month name ("12th August")', extractDayHeader('12th August') === '12th August');

check('rejects impossible month ("Sat 15/20" — month 20 does not exist)', extractDayHeader('Sat 15/20 patients discharged') === null);
check('rejects impossible day-of-month for the given month ("Wed 30/02" — Feb never has 30 days)', extractDayHeader('Wed 30/02') === null);
check('rejects ordinary prose that happens to start with a day-abbreviation-like token ("Satisfactory outcome noted")', extractDayHeader('Satisfactory outcome noted') === null);
check('rejects ordinary prose with a number but no date shape ("Sat 15 patients seen")', extractDayHeader('Sat 15 patients seen') === null);
check('rejects a 2-letter prefix that would otherwise collide with "Wednesday"/"Sunday" ("We need extra cover")', extractDayHeader('We need extra cover') === null);
check('accepts a real leap-permissive boundary ("Thu 29/02" — Feb 29 is plausible without year context)', extractDayHeader('Thu 29/02') === 'Thu 29/02');

// --- Identity resolution ---

const sampleWorkforce: WorkforceMember[] = [
  { id: 'w-onigbinde', full_name: 'Dr. Onigbinde', category: 'Senior Registrar' as any, active: true, on_floor: true, created_at: '', tenant_id: 't1' } as any,
  { id: 'w-alawode', full_name: 'Alawode', category: 'Senior Registrar' as any, active: true, on_floor: true, created_at: '', tenant_id: 't1' } as any,
  { id: 'w-dup-1', full_name: 'Sample Duplicate', category: 'Registrar' as any, active: true, on_floor: true, created_at: '', tenant_id: 't1' } as any,
  { id: 'w-dup-2', full_name: 'Sample Duplicate', category: 'Registrar' as any, active: true, on_floor: true, created_at: '', tenant_id: 't1' } as any,
];

{
  const r = resolveParsedNameToWorkforceId('Onigbinde', sampleWorkforce);
  check('exact unique match after Dr-prefix normalization ("Onigbinde" vs stored "Dr. Onigbinde")', r.status === 'resolved' && r.workforceId === 'w-onigbinde');
}
{
  const r = resolveParsedNameToWorkforceId('dr onigbinde', sampleWorkforce);
  check('case-insensitive + DR (no period) prefix variation resolves the same', r.status === 'resolved' && r.workforceId === 'w-onigbinde');
}
{
  const r = resolveParsedNameToWorkforceId('  Alawode  ', sampleWorkforce);
  check('extra surrounding/collapsed whitespace resolves correctly', r.status === 'resolved' && r.workforceId === 'w-alawode');
}
{
  const r = resolveParsedNameToWorkforceId('Dr.    Alawode', sampleWorkforce);
  check('collapsed repeated internal whitespace resolves correctly', r.status === 'resolved' && r.workforceId === 'w-alawode');
}
{
  const r = resolveParsedNameToWorkforceId('Dr. Salam', sampleWorkforce);
  check('consultant/free-text name absent from workforce is preserved unresolved, not guessed', r.status === 'unresolved');
}
{
  const r = resolveParsedNameToWorkforceId('Sample Duplicate', sampleWorkforce);
  check('duplicate full_name across two workforce rows resolves ambiguous, not guessed', r.status === 'ambiguous' && r.candidateWorkforceIds?.length === 2);
}
{
  // A bare surname where the stored full_name is longer must not be
  // guessed as a match, even though it reads as "the same person" to a
  // human — this resolver only ever does exact full-string comparison.
  const workforceWithFullName: WorkforceMember[] = [
    { id: 'w-uma', full_name: 'Uma Ukwu', category: 'Senior Registrar' as any, active: true, on_floor: true, created_at: '', tenant_id: 't1' } as any,
  ];
  const r = resolveParsedNameToWorkforceId('Uma', workforceWithFullName);
  check('surname-only source against a longer stored full_name resolves unresolved, never guessed', r.status === 'unresolved');
}
{
  const r = resolveParsedNameToWorkforceId('', sampleWorkforce);
  check('empty/whitespace-only input resolves unresolved without throwing', r.status === 'unresolved');
}

// --- A&E "FM – Dr <Surname>" identity normalization (Slice 2B) ---

const aeWorkforce: WorkforceMember[] = [
  { id: 'w-ihedioha', full_name: 'Ihedioha', category: 'Registrar' as any, active: true, on_floor: true, created_at: '', tenant_id: 't1' } as any,
  { id: 'w-ovolen', full_name: 'Ovolen', category: 'Registrar' as any, active: true, on_floor: true, created_at: '', tenant_id: 't1' } as any,
];

{
  const r = resolveParsedNameToWorkforceId('FM – Dr Ihedioha', aeWorkforce);
  check('real A&E shape "FM – Dr Ihedioha" (en-dash) resolves to the correct unique workforce member', r.status === 'resolved' && r.workforceId === 'w-ihedioha');
}
{
  const r1 = resolveParsedNameToWorkforceId('FM- Dr Ihedioha', aeWorkforce);
  const r2 = resolveParsedNameToWorkforceId('fm — DR IHEDIOHA', aeWorkforce);
  check('evidenced dash/case variations ("FM- Dr X", "fm — DR X") resolve the same', r1.status === 'resolved' && r1.workforceId === 'w-ihedioha' && r2.status === 'resolved' && r2.workforceId === 'w-ihedioha');
}
{
  const r = resolveParsedNameToWorkforceId('FM – Dr Somebody', aeWorkforce);
  check('unknown "FM – Dr <name>" not present in workforce is preserved unresolved, not guessed', r.status === 'unresolved');
}
{
  // Real evidenced spelling drift: the actual A&E document spells this
  // Registrar's surname "Ovonlen"; workforce.full_name stores "Ovolen".
  // Must remain unresolved — never auto-corrected.
  const r = resolveParsedNameToWorkforceId('FM – Dr Ovonlen', aeWorkforce);
  check('real spelling drift ("Ovonlen" vs stored "Ovolen") remains unresolved, never corrected', r.status === 'unresolved');
}
{
  const r = resolveParsedNameToWorkforceId('Family Medicine Dr Ihedioha', aeWorkforce);
  check('the FM strip is anchored to "FM" + dash only — "Family Medicine" prefix is not stripped and does not resolve', r.status === 'unresolved');
}
{
  const before = JSON.stringify(aeWorkforce);
  resolveParsedNameToWorkforceId('FM – Dr Ihedioha', aeWorkforce);
  check('FM-prefix resolution does not mutate its workforce input', JSON.stringify(aeWorkforce) === before);
}
{
  const snapshot = JSON.stringify(sampleWorkforce);
  resolveParsedNameToWorkforceId('Onigbinde', sampleWorkforce);
  check('resolveParsedNameToWorkforceId does not mutate its workforce input', JSON.stringify(sampleWorkforce) === snapshot);
}

// --- Ingest-seam identity resolution (September Ingestion Slice 2) ---
// Fixtures shaped like the real September combined roster: a mixed cell
// listing tracked residents alongside a consultant/untracked name, plus a
// duplicate-full_name case, in the same slot/shift/posting — exactly what
// the actual source documents do (one comma-separated name list per cell,
// with no structural distinction between resident and consultant text).

{
  const grid: GopClinicGrid = {
    slots: [
      // combined_gop slot: mixed resident + untracked + ambiguous names.
      { date_or_day: 'Tue 01/09', clinic_type: 'Triage', consultants: ['Dr Onigbinde', 'Alawode', 'Dr Salam', 'Sample Duplicate'], residents: [] },
      // consultant_gop slot: no residents seam at all.
      { date_or_day: 'Tue 01/09', clinic_type: 'Male Sorting', consultants: ['Dr Onigbinde'] },
    ],
    unparsed_notes: ['pre-existing note'],
  };
  const before = JSON.stringify(grid);
  const resolved = applyIdentityResolutionToGopGrid(grid, sampleWorkforce);

  check('GOP: unique resident name resolves and is added to residents[]', resolved.slots[0].residents!.includes('w-onigbinde') && resolved.slots[0].residents!.includes('w-alawode'));
  check('GOP: consultants[] (original display text) is preserved byte-for-byte, including unresolved/ambiguous names', JSON.stringify(resolved.slots[0].consultants) === JSON.stringify(grid.slots[0].consultants));
  check('GOP: unresolved consultant name ("Dr Salam") does not appear in residents[]', !resolved.slots[0].residents!.some(r => r.toLowerCase().includes('salam')));
  check('GOP: ambiguous name is never added to residents[] and does not masquerade as resolved', !resolved.slots[0].residents!.includes('w-dup-1') && !resolved.slots[0].residents!.includes('w-dup-2'));
  check('GOP: ambiguous name is routed to unparsed_notes for manual reconciliation, pre-existing notes preserved', resolved.unparsed_notes.includes('pre-existing note') && resolved.unparsed_notes.some(n => n.includes('Sample Duplicate') && n.includes('Ambiguous')));
  check('GOP: consultant_gop-shaped slot with no residents field at all is left completely untouched', resolved.slots[1].residents === undefined && JSON.stringify(resolved.slots[1]) === JSON.stringify(grid.slots[1]));
  check('GOP: applyIdentityResolutionToGopGrid does not mutate its input grid', JSON.stringify(grid) === before);
}

{
  // Re-running resolution over an already-resolved slot (residents[]
  // already contains a manually drag-assigned id) must not duplicate it.
  const grid: GopClinicGrid = {
    slots: [{ date_or_day: 'Wed 02/09', clinic_type: 'Female Sorting', consultants: ['Dr Onigbinde'], residents: ['w-onigbinde'] }],
    unparsed_notes: [],
  };
  const resolved = applyIdentityResolutionToGopGrid(grid, sampleWorkforce);
  check('GOP: resolving a name already present (manually assigned) in residents[] does not duplicate the id', resolved.slots[0].residents!.filter(r => r === 'w-onigbinde').length === 1);
}

{
  const grid: EmergencyCallGrid = {
    shifts: [{ date_or_day: 'Tue 01/09', shift: '4pm-10pm', on_call: ['Dr Onigbinde', 'Dr Salam', 'Sample Duplicate'] }],
    unparsed_notes: [],
  };
  const before = JSON.stringify(grid);
  const resolved = applyIdentityResolutionToEmergencyGrid(grid, sampleWorkforce);

  check('A&E: unique resident name is replaced in place with its workforce_id', resolved.shifts[0].on_call[0] === 'w-onigbinde');
  check('A&E: unresolved consultant/free-text name survives unchanged', resolved.shifts[0].on_call[1] === 'Dr Salam');
  check('A&E: ambiguous name is left as original text, not replaced with either candidate id', resolved.shifts[0].on_call[2] === 'Sample Duplicate');
  check('A&E: ambiguous name is routed to unparsed_notes', resolved.unparsed_notes.some(n => n.includes('Sample Duplicate') && n.includes('Ambiguous')));
  check('A&E: applyIdentityResolutionToEmergencyGrid does not mutate its input grid', JSON.stringify(grid) === before);
}

{
  const grid: SatelliteGrid = {
    postings: [{ facility: 'Ikolaba', date_or_day: 'Fri 04/09', assigned: ['Dr Onigbinde', 'Dr Salam'] }],
    unparsed_notes: [],
  };
  const before = JSON.stringify(grid);
  const resolved = applyIdentityResolutionToSatelliteGrid(grid, sampleWorkforce);

  check('Satellite: unique resident name is replaced in place with its workforce_id', resolved.postings[0].assigned[0] === 'w-onigbinde');
  check('Satellite: unresolved consultant/free-text name survives unchanged', resolved.postings[0].assigned[1] === 'Dr Salam');
  check('Satellite: applyIdentityResolutionToSatelliteGrid does not mutate its input grid', JSON.stringify(grid) === before);
}

{
  // No mutation of assignment/date/duty content — only residents[]/on_call/
  // assigned membership changes; date_or_day, clinic_type, facility, and
  // shift labels are never touched by identity resolution.
  const grid: GopClinicGrid = {
    slots: [{ date_or_day: 'Tue 01/09', clinic_type: 'Triage', consultants: ['Dr Onigbinde'], residents: [] }],
    unparsed_notes: [],
  };
  const resolved = applyIdentityResolutionToGopGrid(grid, sampleWorkforce);
  check('GOP: identity resolution never changes date_or_day or clinic_type', resolved.slots[0].date_or_day === 'Tue 01/09' && resolved.slots[0].clinic_type === 'Triage');
}

// --- Floor Clinic parsing + existing-type regression (Slice 2B) ---

function matchClinicLine(line: string) {
  return CLINIC_TYPE_PATTERNS.find(c => c.pattern.test(line));
}

{
  const match = matchClinicLine('Floor Clinic: Dr Ihedioha');
  check('real Floor Clinic line is recognized as a clinic type (previously unrecognized, fell to unparsed_notes)', match?.type === 'Floor Clinic');
  const afterLabel = match ? 'Floor Clinic: Dr Ihedioha'.replace(match.pattern, '').replace(/^[:\-\s]+/, '').trim() : null;
  check('Floor Clinic label strips correctly, leaving only the name', afterLabel === 'Dr Ihedioha');
}
{
  // Regression: the 4 pre-existing recognized types must still match
  // correctly and must NOT be confused with the new Floor Clinic pattern.
  check('Triage still matches, not Floor Clinic', matchClinicLine('Triage: Dr Salam')?.type === 'Triage');
  check('Male Sorting still matches, not Floor Clinic', matchClinicLine('Male Sorting: Dr Alawode')?.type === 'Male Sorting');
  check('Female Sorting still matches, not Floor Clinic', matchClinicLine('Female Sorting: Dr Olujitan')?.type === 'Female Sorting');
  check('Children Sorting still matches, not Floor Clinic', matchClinicLine('Children Sorting: Dr Uma')?.type === 'Children Sorting');
  check('Managed Care still matches, not Floor Clinic', matchClinicLine('Managed Care: Dr Ikor')?.type === 'Managed Care');
  check('Annexe still matches, not Floor Clinic', matchClinicLine('Annexe: Dr Ulasi')?.type === 'Annexe');
  check('a Floor Clinic line does not accidentally match any pre-existing type', matchClinicLine('Floor Clinic: Dr Muibi')?.type === 'Floor Clinic');
}
{
  // End-to-end: a Floor Clinic slot flows through identity resolution
  // exactly like any other clinic_type — same consultants[]/residents[]
  // representation, same My Assignment compatibility (migration 67's GOP
  // match has no clinic_type filter).
  const grid: GopClinicGrid = {
    slots: [{ date_or_day: 'Tue 01/09', clinic_type: 'Floor Clinic', consultants: ['Dr Ihedioha'], residents: [] }],
    unparsed_notes: [],
  };
  const resolved = applyIdentityResolutionToGopGrid(grid, [
    { id: 'w-ihedioha2', full_name: 'Ihedioha', category: 'Registrar' as any, active: true, on_floor: true, created_at: '', tenant_id: 't1' } as any,
  ]);
  check('Floor Clinic slot resolves through the existing GOP identity-resolution seam like any other clinic type', resolved.slots[0].residents?.includes('w-ihedioha2') === true);
  check('Floor Clinic slot: date_or_day/clinic_type/consultants are unchanged by resolution', resolved.slots[0].date_or_day === 'Tue 01/09' && resolved.slots[0].clinic_type === 'Floor Clinic' && JSON.stringify(resolved.slots[0].consultants) === JSON.stringify(['Dr Ihedioha']));
}
{
  // Real A&E shape flowing through the same on_call ingest seam used by
  // Slice 2, confirming the FM-prefix fix actually reaches resolution
  // (not just the standalone resolver function tested above).
  const grid: EmergencyCallGrid = {
    shifts: [{ date_or_day: 'Tue 01/09', shift: '4pm-10pm', on_call: ['FM – Dr Ihedioha', 'FM – Dr Ovonlen'] }],
    unparsed_notes: [],
  };
  const resolved = applyIdentityResolutionToEmergencyGrid(grid, [
    { id: 'w-ihedioha3', full_name: 'Ihedioha', category: 'Registrar' as any, active: true, on_floor: true, created_at: '', tenant_id: 't1' } as any,
    { id: 'w-ovolen', full_name: 'Ovolen', category: 'Registrar' as any, active: true, on_floor: true, created_at: '', tenant_id: 't1' } as any,
  ]);
  check('A&E ingest seam: "FM – Dr Ihedioha" resolves to a workforce_id in on_call[]', resolved.shifts[0].on_call[0] === 'w-ihedioha3');
  check('A&E ingest seam: real spelling drift ("FM – Dr Ovonlen" vs stored "Ovolen") survives as unresolved free text, never corrected', resolved.shifts[0].on_call[1] === 'FM – Dr Ovonlen');
}

// --- Supervision Dr-vs-Dr. title normalization (2026-08-27 fix) ---
// Real defect evidenced by the September ingest: every real Supervision
// duty is written "Dr <Surname>" (no period, source-document form), while
// workforce.full_name is stored "Dr. <Surname>" (with period). Both
// rosterReconciliation.ts's findGridAppearancesForMember() and migration
// 70's resident_get_current_assignment() now reuse the same canonical
// normalizeForComparison() semantic to fix this — verified here from both
// the direct-normalization angle and end-to-end via
// computeReconciliationIssues()'s leave_roster_overlap check.

check('normalizeForComparison: "Dr Muibi" and "Dr. Muibi" normalize identically', normalizeForComparison('Dr Muibi') === normalizeForComparison('Dr. Muibi'));
check('normalizeForComparison: reversed direction ("Dr. Muibi" vs "Dr Muibi") also normalizes identically', normalizeForComparison('Dr. Muibi') === normalizeForComparison('Dr Muibi'));
check('normalizeForComparison: case and extra whitespace variations normalize identically to the canonical form', normalizeForComparison('  DR.   Muibi  ') === normalizeForComparison('Dr Muibi'));
check('normalizeForComparison: a genuinely different name does NOT normalize the same', normalizeForComparison('Dr Onigbinde') !== normalizeForComparison('Dr Muibi'));
check('normalizeForComparison: "Uma" vs an unrelated name does not become a fuzzy match', normalizeForComparison('Dr Uma') !== normalizeForComparison('Dr Umaru'));

{
  // End-to-end: Supervision leave-overlap now sees the intended member
  // despite the Dr/Dr. mismatch between the duty text and workforce.full_name.
  const w = makeMember('w-sup-1', 'Dr. Muibi', true);
  const s = makeSubmission({ workforce_id: 'w-sup-1', taking_leave: true, leave_start: '2026-08-01', leave_end: '2026-08-31' });
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    supervision_grid: { duties: [{ date_or_day: 'Monday', first_on_duty: 'Dr Muibi', second_on_duty: null }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([s], [w], rotations, roster);
  check('Supervision leave-overlap fires for "Dr Muibi" duty text against workforce "Dr. Muibi" (previously silently missed)', issues.some(i => i.type === 'leave_roster_overlap'));
}
{
  // Reverse direction: manually-assigned duty text (which stores the live
  // full_name verbatim, i.e. WITH the period) must still match.
  const w = makeMember('w-sup-2', 'Dr. Alawode', true);
  const s = makeSubmission({ workforce_id: 'w-sup-2', taking_leave: true, leave_start: '2026-08-01', leave_end: '2026-08-31' });
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    supervision_grid: { duties: [{ date_or_day: 'Monday', first_on_duty: null, second_on_duty: 'Dr. Alawode' }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([s], [w], rotations, roster);
  check('Supervision leave-overlap fires for "Dr. Alawode" (with period) duty text against workforce "Dr. Alawode"', issues.some(i => i.type === 'leave_roster_overlap'));
}
{
  // A genuinely different/unrelated person in the duty slot must never match.
  const w = makeMember('w-sup-3', 'Dr. Onigbinde', true);
  const s = makeSubmission({ workforce_id: 'w-sup-3', taking_leave: true, leave_start: '2026-08-01', leave_end: '2026-08-31' });
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    supervision_grid: { duties: [{ date_or_day: 'Monday', first_on_duty: 'Dr Muibi', second_on_duty: null }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([s], [w], rotations, roster);
  check('Supervision leave-overlap does NOT fire for an unrelated member ("Dr Muibi" duty vs workforce "Dr. Onigbinde")', issues.every(i => i.type !== 'leave_roster_overlap'));
}
{
  // GOP/A&E/Satellite id-based matching (also reachable via
  // findGridAppearancesForMember) must remain completely unaffected by
  // the Supervision-only normalization change.
  const w = makeMember('w-sup-4', 'Dr. Regression', true);
  const s = makeSubmission({ workforce_id: 'w-sup-4', taking_leave: true, leave_start: '2026-08-01', leave_end: '2026-08-31' });
  const roster: CombinedMasterRoster = {
    ...emptyRoster,
    gop_clinic_grid: { slots: [{ date_or_day: 'Monday', clinic_type: 'FM Clinic' as any, consultants: [], residents: ['w-sup-4'] }], unparsed_notes: [] },
    emergency_call_grid: { shifts: [{ date_or_day: 'Monday', shift: '4pm-10pm', on_call: ['w-sup-4'] }], unparsed_notes: [] },
    satellite_grid: { postings: [{ facility: 'Ikolaba', date_or_day: 'Monday', assigned: ['w-sup-4'] }], unparsed_notes: [] },
  };
  const issues = computeReconciliationIssues([s], [w], rotations, roster);
  const overlaps = issues.filter(i => i.type === 'leave_roster_overlap');
  const gridsSeen = new Set(overlaps.map(i => (i.evidence as any)?.grid));
  check('GOP/A&E/Satellite id-based leave-overlap matching still fires (unaffected by the Supervision normalization fix)', overlaps.length >= 1);
  check('GOP/A&E/Satellite id-based leave-overlap matching covers all 3 grids (not just one)', gridsSeen.has('GOP Clinic Grid') && gridsSeen.has('A&E Emergency Grid') && gridsSeen.has('Satellite Grid'));
}

// --- Migration 70 structural review: preserves everything except the
// Supervision comparison contract ---
{
  const migration67Path = path.join(__dirname, '..', 'supabase', 'migrations', '67_resident_get_current_assignment.sql');
  const migration70Path = path.join(__dirname, '..', 'supabase', 'migrations', '70_resident_get_current_assignment_title_normalization.sql');
  const m67 = fs.readFileSync(migration67Path, 'utf8');
  const m70 = fs.readFileSync(migration70Path, 'utf8');

  check('migration 70 file exists at the expected next-available number (70)', fs.existsSync(migration70Path));

  const preservedFragments = [
    "LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$",
    "RAISE EXCEPTION 'Invalid access code' USING ERRCODE = '28000';",
    "SELECT s.current_collection_id INTO v_current_collection_id",
    "AND cmr.status = 'published';",
    "-- GOP Clinic Grid — workforce_id match.",
    "'grid_label', 'GOP Clinic Grid',",
    "-- A&E Emergency Grid — workforce_id match.",
    "'grid_label', 'A&E Emergency Grid',",
    "nullif(v_slot->>'date_or_day', '') IS NOT NULL AND EXISTS (",
    "'grid_label', 'Satellite Grid',",
    "RETURN QUERY SELECT 'published_no_assignment'::text, v_roster.month, v_roster.year, '[]'::jsonb;",
    "RETURN QUERY SELECT 'published_with_assignment'::text, v_roster.month, v_roster.year, v_assignments;",
    "GRANT EXECUTE ON FUNCTION public.resident_get_current_assignment(uuid, text) TO anon, authenticated;",
  ];
  for (const fragment of preservedFragments) {
    check(`migration 67 and 70 share preserved fragment verbatim: ${JSON.stringify(fragment.slice(0, 48))}...`, m67.includes(fragment) && m70.includes(fragment));
  }

  check('migration 70 changes the Supervision comparison to use a normalization helper (no longer bare string equality)', !m70.includes("(v_slot->>'first_on_duty') = v_full_name") && m70.includes('_normalize_supervision_name'));
  check('migration 67 (unchanged, still on disk) still shows the original bare-equality Supervision comparison', m67.includes("(v_slot->>'first_on_duty') = v_full_name"));
  check('migration 70 does not modify migration 67\'s file', fs.existsSync(migration67Path) && m67.includes("-- Migration 67:"));
}

// --- Migration 71 structural review: preserves everything from 70 except
// adding assignment_detail to each of the 4 result-builders (My
// Assignment Slice A, 2026-08-27) ---
{
  const migration70Path = path.join(__dirname, '..', 'supabase', 'migrations', '70_resident_get_current_assignment_title_normalization.sql');
  const migration71Path = path.join(__dirname, '..', 'supabase', 'migrations', '71_resident_get_current_assignment_detail.sql');
  const m70 = fs.readFileSync(migration70Path, 'utf8');
  const m71 = fs.readFileSync(migration71Path, 'utf8');

  check('migration 71 file exists at the expected next-available number (71)', fs.existsSync(migration71Path));

  const preservedFragments70to71 = [
    "LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$",
    "RAISE EXCEPTION 'Invalid access code' USING ERRCODE = '28000';",
    "SELECT s.current_collection_id INTO v_current_collection_id",
    "AND cmr.status = 'published';",
    "'grid_label', 'GOP Clinic Grid',",
    "'grid_label', 'A&E Emergency Grid',",
    "nullif(v_slot->>'date_or_day', '') IS NOT NULL AND EXISTS (",
    "'grid_label', 'Satellite Grid',",
    "RETURN QUERY SELECT 'published_no_assignment'::text, v_roster.month, v_roster.year, '[]'::jsonb;",
    "RETURN QUERY SELECT 'published_with_assignment'::text, v_roster.month, v_roster.year, v_assignments;",
    "GRANT EXECUTE ON FUNCTION public.resident_get_current_assignment(uuid, text) TO anon, authenticated;",
    "public._normalize_supervision_name(v_slot->>'first_on_duty') = public._normalize_supervision_name(v_full_name)",
    "public._normalize_supervision_name(v_slot->>'second_on_duty') = public._normalize_supervision_name(v_full_name)",
  ];
  for (const fragment of preservedFragments70to71) {
    check(`migration 70 and 71 share preserved fragment verbatim: ${JSON.stringify(fragment.slice(0, 48))}...`, m70.includes(fragment) && m71.includes(fragment));
  }

  check('migration 71 does NOT redefine _normalize_supervision_name (reuses migration 70\'s helper as-is)', !m71.includes('CREATE OR REPLACE FUNCTION public._normalize_supervision_name'));

  check('migration 71 adds assignment_detail to the GOP result (v_slot clinic_type, pass-through)', m71.includes("'assignment_detail', v_slot->>'clinic_type'") && !m70.includes("'assignment_detail'"));
  check('migration 71 adds assignment_detail to the A&E result (v_slot shift, pass-through)', m71.includes("'assignment_detail', v_slot->>'shift'"));
  check('migration 71 adds assignment_detail to the Satellite result (v_slot facility, pass-through)', m71.includes("'assignment_detail', v_slot->>'facility'"));
  check('migration 71 adds assignment_detail to the Supervision result using the two generic duty labels only', m71.includes("'assignment_detail', '1st On Duty'") && m71.includes("'assignment_detail', '2nd On Duty'"));

  check('migration 71 restructures Supervision matching as IF/ELSIF (was IF/OR in migration 70) — which slots match is unchanged, only which label attaches', !m70.includes('ELSIF') && m71.includes('ELSIF'));

  check('migration 70 (unchanged, still on disk) has no assignment_detail key anywhere', !m70.includes('assignment_detail'));
  check('migration 71 does not modify migration 70\'s file', fs.existsSync(migration70Path) && m70.includes('-- Migration 70:'));
}

console.log('');
console.log(`${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
