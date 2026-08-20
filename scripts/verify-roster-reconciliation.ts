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
  const issues = computeReconciliationIssues([s], [w], rotations, emptyRoster);
  check('trailing-space rotation now resolves and matches on-floor status (zero issues)', issues.length === 0);
}

{
  const w = makeMember('w2', 'Whitespace Two', true);
  const s = makeSubmission({ workforce_id: 'w2', current_rotation: '  Family Medicine Clinic' }); // leading spaces
  const issues = computeReconciliationIssues([s], [w], rotations, emptyRoster);
  check('leading-space rotation now resolves and matches on-floor status (zero issues)', issues.length === 0);
}

{
  // Regression guard: must still be exact matching, not fuzzy/case-folded —
  // a lowercase submission must NOT resolve, only whitespace is trimmed.
  const w = makeMember('w3', 'Whitespace Three', true);
  const s = makeSubmission({ workforce_id: 'w3', current_rotation: 'family medicine clinic ' });
  const issues = computeReconciliationIssues([s], [w], rotations, emptyRoster);
  check('trim does not add case-folding — lowercase still Needs Review, not matched', issues.length === 1 && issues[0].type === 'unrecognised_rotation');
}

{
  // Canonical rotation names are not trimmed — only submitted free text is.
  const w = makeMember('w4', 'Whitespace Four', false);
  const s = makeSubmission({ workforce_id: 'w4' }); // exact "Family Medicine Clinic", no whitespace
  const issues = computeReconciliationIssues([s], [w], rotations, emptyRoster);
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

console.log('');
console.log(`${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
