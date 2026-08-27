import {
  SubmissionWithWorkforce,
  WorkforceMember,
  Rotation,
  CombinedMasterRoster,
  ReconciliationIssue,
  ClinicType,
} from '../../../types';
import { KNOWN_SATELLITE_FACILITIES } from './satelliteFacilities';
import { normalizeForComparison } from './identityResolver';

// Workforce Option A — read-only reconciliation. See
// docs/WORKFORCE_V1_RECOVERY_SPEC.md for the full design and locked
// decisions. Pure computation only: no network calls, no writes, no side
// effects. Consumed by MultiRosterManagerView.tsx.
//
// SCOPE (locked): reconciles the active-workforce population already
// loaded by MultiRosterManagerView against that same collection cycle's
// submissions and roster grids. Inactive-member reconciliation and
// missing-submission chasing are explicitly out of scope for this slice
// (Decisions 1/2) — a submission whose workforce_id isn't found in the
// (already active-only) `workforce` array passed in is silently skipped,
// not flagged as an error.

// --------------------------------------------------------------------
// Tenant-specific rotation/on-floor compatibility adapter (UCH Family
// Medicine V1 only — NOT a universal Workspc rule; see spec §4).
// --------------------------------------------------------------------
//
// Decision 3 (locked): "not in the on-floor list" must NOT be treated as
// automatically meaning off-floor. The adapter distinguishes four cases:
//   1. Rotation name in `onFloor`             -> expected on_floor = true
//   2. Rotation name in `offFloor`             -> expected on_floor = false
//   3. Rotation resolves to a known global
//      rotation but is in neither list         -> Needs Review / Unknown
//   4. Rotation does not resolve at all
//      (unrecognised/free-text drift)          -> Needs Review / Unknown
//
// `offFloor` is intentionally empty for UCH V1: there is no existing
// evidence in this codebase classifying any specific rotation as
// "definitely off-floor" (workforce.on_floor is a manually-toggled
// boolean with no declared mapping from rotation name to off-floor
// status) — inventing one would violate the "preserve only classifications
// actually supported by existing evidence" constraint. Only
// "Family Medicine Clinic" is confidently known to mean on-floor, per
// the existing product usage of workforce.on_floor for GOP/A&E/satellite
// duty eligibility.
interface RotationOnFloorAdapter {
  onFloor: string[];
  offFloor: string[];
}

export const UCH_FAMILY_MEDICINE_ON_FLOOR_ADAPTER: RotationOnFloorAdapter = {
  onFloor: ['Family Medicine Clinic'],
  offFloor: [],
};

type RotationExpectation = 'expected_on_floor' | 'expected_off_floor' | 'unclassified';

// Resolves a submission's rotation to an exact rotation name, or null if
// it cannot be resolved. Deterministic only — no fuzzy matching, no
// case-folding, no aliasing. current_rotation_id is used when present
// (whether or not it actually resolves against the current rotations
// list — no fallback in that case, per the locked spec); the free-text
// current_rotation column is only consulted when current_rotation_id is
// null (covers submissions that predate the FK backfill).
//
// Hardening (adversarial finding, 2026-08-20): the free-text side is
// trimmed of leading/trailing whitespace before the exact-string
// comparison — a submission of "Family Medicine Clinic " (trailing
// space, e.g. from copy-paste) was previously misclassified as Needs
// Review instead of resolving. This is whitespace normalization only —
// still an exact match, still no case-folding/fuzzy/alias/AI matching.
// Canonical rotation names (`rotations.name`) are not trimmed — they are
// controlled, seeded data, not user input.
function resolveRotationName(submission: SubmissionWithWorkforce, rotations: Rotation[]): string | null {
  if (submission.current_rotation_id) {
    return rotations.find(r => r.id === submission.current_rotation_id)?.name ?? null;
  }
  return rotations.find(r => r.name === submission.current_rotation.trim())?.name ?? null;
}

function classifyRotation(rotationName: string, adapter: RotationOnFloorAdapter): RotationExpectation {
  if (adapter.onFloor.includes(rotationName)) return 'expected_on_floor';
  if (adapter.offFloor.includes(rotationName)) return 'expected_off_floor';
  return 'unclassified';
}

const DAY_NAME_TO_WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

// Roster grid slots record only a weekday name (e.g. "Monday"), never an
// actual calendar date — confirmed against uchRosterParser.ts's own
// DAY_NAMES-based day-header parsing, which is the sole producer of
// date_or_day values. Resolves every calendar date in the given
// month/year that falls on that weekday (deterministic — a weekday name
// is genuinely ambiguous within a month, so every matching date is
// returned, not a guessed single one).
function resolveWeekdayNameToDatesInMonth(dayName: string, month: number, year: number): string[] {
  const weekdayIndex = DAY_NAME_TO_WEEKDAY_INDEX[dayName];
  if (weekdayIndex === undefined) return [];
  const daysInMonth = new Date(year, month, 0).getDate();
  const dates: string[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month - 1, day).getDay() === weekdayIndex) {
      dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
  }
  return dates;
}

function dateInRange(date: string, start: string, end: string): boolean {
  // YYYY-MM-DD strings compare lexically identically to chronologically.
  return date >= start && date <= end;
}

// GOP/Emergency/Satellite grids record assignments by workforce_id;
// Supervision records them by full_name string instead (confirmed against
// MultiRosterManagerView.tsx's own assignToSupervisionDuty, which stores
// residentName(residentId) rather than the id). This is a real,
// transitional inconsistency in the existing grid data model, not a
// choice made here.
//
// Supervision matching (2026-08-27 fix): parser/AI-derived duty text
// preserves the source document's own title form (every real September
// document writes "Dr Muibi", no period), while a manual drag/tap
// assignment writes the live workforce.full_name value directly (e.g.
// "Dr. Muibi", with period) via assignToSupervisionDuty's
// residentName(id) call — so the same field can hold either form for the
// same person. Comparison now reuses identityResolver.ts's canonical,
// already-tested normalizeForComparison() (trim, collapse whitespace,
// case-insensitive, strip only a leading "Dr"/"Dr." prefix) instead of
// bare string equality, so "Dr Muibi" and "Dr. Muibi" correctly identify
// the same member — still exact identity matching after that narrow
// title normalization, never fuzzy/surname-only. A member whose
// normalized full_name doesn't exactly match either duty field still
// silently misses (e.g. a genuine rename beyond title punctuation), same
// documented limitation as before, just narrower now.
interface GridAppearance {
  gridLabel: string;
  dayName: string;
}

function findGridAppearancesForMember(
  member: WorkforceMember,
  masterRoster: CombinedMasterRoster
): GridAppearance[] {
  const appearances: GridAppearance[] = [];

  for (const slot of masterRoster.gop_clinic_grid?.slots || []) {
    if ((slot.residents || []).includes(member.id)) {
      appearances.push({ gridLabel: 'GOP Clinic Grid', dayName: slot.date_or_day });
    }
  }
  for (const shift of masterRoster.emergency_call_grid?.shifts || []) {
    if (shift.on_call.includes(member.id)) {
      appearances.push({ gridLabel: 'A&E Emergency Grid', dayName: shift.date_or_day });
    }
  }
  for (const posting of masterRoster.satellite_grid?.postings || []) {
    if (posting.date_or_day && posting.assigned.includes(member.id)) {
      appearances.push({ gridLabel: 'Satellite Grid', dayName: posting.date_or_day });
    }
  }
  const normalizedMemberName = normalizeForComparison(member.full_name);
  for (const duty of masterRoster.supervision_grid?.duties || []) {
    const matchesFirst = duty.first_on_duty !== null && normalizeForComparison(duty.first_on_duty) === normalizedMemberName;
    const matchesSecond = duty.second_on_duty !== null && normalizeForComparison(duty.second_on_duty) === normalizedMemberName;
    if (matchesFirst || matchesSecond) {
      appearances.push({ gridLabel: 'Supervision Grid', dayName: duty.date_or_day });
    }
  }

  return appearances;
}

// --------------------------------------------------------------------
// UCH Family Medicine V1 — Slice 1 read-only roster-rule intelligence
// (2026-08-23). See WORKSPC_RECONCILIATION_REVIEW_2026-08-23_SEPTEMBER_CYCLE.md
// §G Slice 3 for the DISCOVER classification this implements. NOT universal
// Workspc rules — same FM-only-adapter boundary as
// UCH_FAMILY_MEDICINE_ON_FLOOR_ADAPTER above. Every check here is read-only,
// non-blocking decision support: it surfaces "missing expected coverage" or
// "conflicting/ineligible assignment" for the Chief to review, it never
// assigns anyone, approves leave, or decides the final roster.
//
// Classified during DISCOVER and deliberately NOT implemented in this
// slice (see the review doc for the full reasoning):
//   - Priority coverage (triage/weekend-eligible set) — the Supervision
//     grid's assignees are matched by full_name string, not workforce_id
//     (see the existing, documented "real, transitional inconsistency" in
//     findGridAppearancesForMember above); cross-referencing that against
//     GOP-grid Triage-slot residents (matched by id) would risk false
//     conflict signals on a known-fragile join, not a deterministic check.
//   - NHIA staffing — the note's "NHIA" has no confirmed mapping to any
//     existing `ClinicType`/facility value in this codebase (`Managed
//     Care` is a plausible but UNCONFIRMED guess); inventing that mapping
//     would violate the same "preserve only classifications actually
//     supported by existing evidence" constraint documented above for the
//     on-floor adapter. Needs explicit human confirmation first.
//   - Special coverage "exactly one Senior Registrar total" headcount —
//     ambiguous whether that means one person total across all three
//     facilities or one per facility; only the per-assignment grade
//     eligibility (below) is confidently deterministic from the note.
//   - Chief academic-off-days, fairness, automatic assignment/leave
//     approval, A/E carry-forward — explicitly deferred per the task's own
//     scope boundary, unrelated to what current data supports.

// Only "Family Medicine Clinic" on-floor rotations are ever expected to
// supply Ikolaba/Special-coverage/service-point staffing — mirrors the
// same on-floor adapter's own conservatism (§ above): grade + on_floor are
// checked, never a specific rotation name.
const UCH_FM_SENIOR_REGISTRAR_CATEGORY = 'Senior Registrar';

// Directly named in the note ("1 sr in triage at least, same for male
// sorting, female sorting, children sorting") and confirmed to match
// `ClinicType` exactly (src/types.ts) — no guessing involved, unlike NHIA.
const UCH_FM_FLOOR_SENIOR_COVERAGE_CLINIC_TYPES: ClinicType[] = [
  'Triage', 'Male Sorting', 'Female Sorting', 'Children Sorting',
];

const UCH_FM_IKOLABA_FACILITY = 'Ikolaba';
// "Special coverage" facilities, per the note ("Agbeke/Airport/NYSC") —
// every KNOWN_SATELLITE_FACILITIES entry except Ikolaba, which has its own
// day-specific rule below. Derived rather than re-listed so this can never
// drift from uchRosterParser.ts's own facility spelling.
const UCH_FM_SPECIAL_COVERAGE_FACILITIES = KNOWN_SATELLITE_FACILITIES.filter(f => f !== UCH_FM_IKOLABA_FACILITY);

function resolveAssignedMembers(assignedIds: string[], workforceById: Map<string, WorkforceMember>): WorkforceMember[] {
  // Entries that don't resolve to a known active workforce member are raw
  // parsed text (not yet drag-assigned to a resident) or reference someone
  // outside this reconciliation's active-workforce population — silently
  // skipped, same as Decision 1's submission-population scoping above, not
  // treated as an error since we cannot verify anything about them.
  return assignedIds.map(id => workforceById.get(id)).filter((m): m is WorkforceMember => !!m);
}

// Ikolaba rule (locked in the note): on the 1st and 3rd Friday of the
// month only, one Senior Registrar is moved to Ikolaba from the Floor.
// Grid slots record only a day name (see resolveWeekdayNameToDatesInMonth
// above) — every month has at least 4 Fridays, so the 1st/3rd always exist.
// A bare "Friday" posting (rather than a specific calendar date) is
// necessarily treated as covering every Friday, including the 1st/3rd —
// this cannot distinguish "assigned only on the 2nd/4th Friday" from
// "assigned every Friday", which is a real, documented limitation of the
// existing day-name-only grid data model (same limitation the leave-overlap
// check above already lives with), not something this check can fix.
function checkIkolabaCoverage(
  workforceById: Map<string, WorkforceMember>,
  masterRoster: CombinedMasterRoster | null
): ReconciliationIssue[] {
  if (!masterRoster) return [];
  const issues: ReconciliationIssue[] = [];
  const fridays = resolveWeekdayNameToDatesInMonth('Friday', masterRoster.month, masterRoster.year);
  const targetDates = [fridays[0], fridays[2]];
  const ikolabaPostings = (masterRoster.satellite_grid?.postings || []).filter(p => p.facility === UCH_FM_IKOLABA_FACILITY);

  for (const targetDate of targetDates) {
    const matchingPostings = ikolabaPostings.filter(p => {
      if (!p.date_or_day) return false;
      return resolveWeekdayNameToDatesInMonth(p.date_or_day, masterRoster.month, masterRoster.year).includes(targetDate);
    });
    const assignedMembers = matchingPostings.flatMap(p => resolveAssignedMembers(p.assigned || [], workforceById));
    const hasEligibleSR = assignedMembers.some(m => m.category === UCH_FM_SENIOR_REGISTRAR_CATEGORY && m.on_floor);

    if (!hasEligibleSR) {
      const named = assignedMembers.map(m => `${m.full_name} (${m.category}${m.on_floor ? '' : ', not on-floor'})`).join(', ');
      issues.push({
        type: 'missing_expected_coverage',
        workforceId: null,
        memberName: null,
        message: `Missing expected coverage: Ikolaba on ${targetDate} (1st/3rd Friday convention) has no confirmed Senior Registrar moved from the Floor.${named ? ` Currently assigned: ${named}.` : ' No one is currently assigned.'}`,
        evidence: { facility: UCH_FM_IKOLABA_FACILITY, date: targetDate, currently_assigned: named || 'none' },
      });
    }
  }
  return issues;
}

// "You can see the pattern on the floor... 1 sr in triage at least, same
// for male sorting, female sorting, children sorting" — read as a soft,
// "as permissible" convention (the note's own words), so this is surfaced
// as review-worthy decision support, never a hard failure.
function checkFloorServicePointSeniorCoverage(
  workforceById: Map<string, WorkforceMember>,
  masterRoster: CombinedMasterRoster | null
): ReconciliationIssue[] {
  if (!masterRoster) return [];
  const issues: ReconciliationIssue[] = [];
  const slots = (masterRoster.gop_clinic_grid?.slots || []).filter(s => UCH_FM_FLOOR_SENIOR_COVERAGE_CLINIC_TYPES.includes(s.clinic_type));

  for (const slot of slots) {
    const residents = resolveAssignedMembers(slot.residents || [], workforceById);
    const hasSR = residents.some(m => m.category === UCH_FM_SENIOR_REGISTRAR_CATEGORY);
    if (!hasSR) {
      const named = residents.map(m => `${m.full_name} (${m.category})`).join(', ');
      issues.push({
        type: 'missing_expected_coverage',
        workforceId: null,
        memberName: null,
        message: `Missing expected coverage: no Senior Registrar assigned to ${slot.clinic_type} on ${slot.date_or_day} (Family Medicine convention expects at least one Senior Registrar at this service point, as permissible).${named ? ` Currently assigned: ${named}.` : ' No one is currently assigned.'}`,
        evidence: { clinic_type: slot.clinic_type, date_or_day: slot.date_or_day, currently_assigned: named || 'none' },
      });
    }
  }
  return issues;
}

// Special coverage (Agbeke Mercy/Airport PHC/NYSC): the note says "one
// Senior registrar from the workforce goes to" these facilities. Only the
// per-assignment grade check is implemented (deterministic); whether that
// means exactly one person total across the three facilities is ambiguous
// and deliberately deferred (see the file-header note above) — this only
// flags a *named, specific* assignment whose grade doesn't match, which is
// why it produces `ineligible_assignment` (tied to a real member) rather
// than `missing_expected_coverage` (tied to none).
function checkSpecialCoverageEligibility(
  workforceById: Map<string, WorkforceMember>,
  masterRoster: CombinedMasterRoster | null
): ReconciliationIssue[] {
  if (!masterRoster) return [];
  const issues: ReconciliationIssue[] = [];
  const postings = (masterRoster.satellite_grid?.postings || []).filter(p => UCH_FM_SPECIAL_COVERAGE_FACILITIES.includes(p.facility));

  for (const posting of postings) {
    for (const member of resolveAssignedMembers(posting.assigned || [], workforceById)) {
      if (member.category !== UCH_FM_SENIOR_REGISTRAR_CATEGORY) {
        issues.push({
          type: 'ineligible_assignment',
          workforceId: member.id,
          memberName: member.full_name,
          message: `Conflicting/ineligible assignment: ${member.full_name} is assigned to ${posting.facility} special coverage but is a ${member.category}, not a Senior Registrar (Family Medicine convention expects a Senior Registrar for this posting).`,
          evidence: { facility: posting.facility, member_category: member.category },
        });
      }
    }
  }
  return issues;
}

export function computeReconciliationIssues(
  submissions: SubmissionWithWorkforce[],
  workforce: WorkforceMember[],
  rotations: Rotation[],
  masterRoster: CombinedMasterRoster | null
): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];
  const workforceById = new Map(workforce.map(w => [w.id, w]));

  for (const submission of submissions) {
    // Active-workforce-only population (Decision 1) — a submission whose
    // member isn't in the already-active-filtered `workforce` array is
    // silently out of scope for this slice, not an error.
    const member = workforceById.get(submission.workforce_id);
    if (!member) continue;

    // --- Issue types 1 & 2: rotation vs. workforce status ---
    const rotationName = resolveRotationName(submission, rotations);
    if (rotationName === null) {
      issues.push({
        type: 'unrecognised_rotation',
        workforceId: member.id,
        memberName: member.full_name,
        message: `Needs Review: ${member.full_name}'s submitted rotation "${submission.current_rotation}" could not be matched to a known rotation for this organisation.`,
        evidence: { submitted_rotation: submission.current_rotation },
      });
    } else {
      const expectation = classifyRotation(rotationName, UCH_FAMILY_MEDICINE_ON_FLOOR_ADAPTER);
      if (expectation === 'unclassified') {
        issues.push({
          type: 'unrecognised_rotation',
          workforceId: member.id,
          memberName: member.full_name,
          message: `Needs Review: ${member.full_name}'s submitted rotation "${rotationName}" is a recognised rotation, but this organisation has not classified whether it is on-floor or not.`,
          evidence: { submitted_rotation: rotationName },
        });
      } else if (expectation === 'expected_on_floor' && !member.on_floor) {
        issues.push({
          type: 'rotation_conflict',
          workforceId: member.id,
          memberName: member.full_name,
          message: `Submitted rotation conflicts with current workforce status: ${member.full_name} submitted "${rotationName}" but is marked not on-floor.`,
          evidence: { submitted_rotation: rotationName, workforce_on_floor: 'false' },
        });
      } else if (expectation === 'expected_off_floor' && member.on_floor) {
        issues.push({
          type: 'rotation_conflict',
          workforceId: member.id,
          memberName: member.full_name,
          message: `Submitted rotation conflicts with current workforce status: ${member.full_name} submitted "${rotationName}" but is marked on-floor.`,
          evidence: { submitted_rotation: rotationName, workforce_on_floor: 'true' },
        });
      }
      // expectation matches workforce.on_floor -> no issue.
    }

    // --- Issue type 3: declared leave overlapping a grid appearance ---
    if (submission.taking_leave && submission.leave_start && submission.leave_end && masterRoster) {
      // Hardening (adversarial finding, 2026-08-20): a reversed range
      // (leave_start after leave_end — a data-entry error) previously
      // made the overlap check below mathematically unsatisfiable,
      // silently producing zero findings even when a real overlap
      // existed. Surfaced explicitly instead — never silently swapped,
      // never silently suppressed. Overlap detection is skipped for this
      // submission once flagged, since computing "overlap" against an
      // invalid range would be meaningless.
      if (submission.leave_start > submission.leave_end) {
        issues.push({
          type: 'invalid_declared_leave_range',
          workforceId: member.id,
          memberName: member.full_name,
          message: `Needs Review: ${member.full_name}'s declared leave range is invalid — start date (${submission.leave_start}) is after end date (${submission.leave_end}).`,
          evidence: { declared_leave_start: submission.leave_start, declared_leave_end: submission.leave_end },
        });
      } else {
        const appearances = findGridAppearancesForMember(member, masterRoster);
        for (const appearance of appearances) {
          const candidateDates = resolveWeekdayNameToDatesInMonth(appearance.dayName, masterRoster.month, masterRoster.year);
          for (const date of candidateDates) {
            if (dateInRange(date, submission.leave_start, submission.leave_end)) {
              issues.push({
                type: 'leave_roster_overlap',
                workforceId: member.id,
                memberName: member.full_name,
                message: `Leave period overlaps a draft roster assignment: ${member.full_name} declared leave ${submission.leave_start}–${submission.leave_end}; appears in the ${appearance.gridLabel} on ${date} (${appearance.dayName}).`,
                evidence: {
                  declared_leave_start: submission.leave_start,
                  declared_leave_end: submission.leave_end,
                  grid: appearance.gridLabel,
                  overlapping_date: date,
                },
              });
            }
          }
        }
      }
    }
  }

  // FM Slice 1 checks — independent of submissions, purely roster-grid +
  // workforce-grade based, so they run once regardless of submission count.
  issues.push(...checkIkolabaCoverage(workforceById, masterRoster));
  issues.push(...checkFloorServicePointSeniorCoverage(workforceById, masterRoster));
  issues.push(...checkSpecialCoverageEligibility(workforceById, masterRoster));

  return issues;
}

// Slice 1B (2026-08-24): pure display-grouping helper for
// MultiRosterManagerView.tsx. Does NOT change what issues are computed or
// their semantics — computeReconciliationIssues above is untouched. This
// exists only so the UI's member-vs-roster-level split can be verified by
// the same dependency-free harness (scripts/verify-roster-reconciliation.ts)
// that already exercises this file, instead of duplicating the split logic
// inline inside MultiRosterManagerView.tsx where it would be untestable
// without importing React/databaseService (the same import.meta.env risk
// documented above for satelliteFacilities.ts).
//
// missing_expected_coverage issues carry workforceId = null by design (no
// one appropriate is assigned, so there is no member to file the issue
// under) — every other issue type, including ineligible_assignment, always
// carries a real member. Splitting on workforceId === null, rather than on
// issue.type, is deliberate: it is the general rule ("no member => roster
// level"), not a hardcoded list of which types are which, so a future issue
// type automatically groups correctly without this function needing to
// know its name.
export interface GroupedReconciliationIssues {
  byMember: Map<string, { memberName: string; issues: ReconciliationIssue[] }>;
  rosterLevel: ReconciliationIssue[];
}

export function groupReconciliationIssuesForDisplay(issues: ReconciliationIssue[]): GroupedReconciliationIssues {
  const byMember = new Map<string, { memberName: string; issues: ReconciliationIssue[] }>();
  const rosterLevel: ReconciliationIssue[] = [];

  for (const issue of issues) {
    if (issue.workforceId === null) {
      rosterLevel.push(issue);
      continue;
    }
    const entry = byMember.get(issue.workforceId);
    if (entry) {
      entry.issues.push(issue);
    } else {
      byMember.set(issue.workforceId, { memberName: issue.memberName ?? issue.workforceId, issues: [issue] });
    }
  }

  return { byMember, rosterLevel };
}
