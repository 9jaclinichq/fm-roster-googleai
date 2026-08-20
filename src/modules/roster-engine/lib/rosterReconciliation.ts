import {
  SubmissionWithWorkforce,
  WorkforceMember,
  Rotation,
  CombinedMasterRoster,
  ReconciliationIssue,
} from '../../../types';

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
// choice made here — Supervision matching is therefore exact full_name
// equality, which will silently stop matching if a member is renamed in
// `workforce` after a supervision assignment was made. Documented, not
// fixed, in this slice.
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
  for (const duty of masterRoster.supervision_grid?.duties || []) {
    if (duty.first_on_duty === member.full_name || duty.second_on_duty === member.full_name) {
      appearances.push({ gridLabel: 'Supervision Grid', dayName: duty.date_or_day });
    }
  }

  return appearances;
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

  return issues;
}
