// Swap UI composition — a convenience form ONLY. Per the reviewed
// "roster batch/swap/stale-revision" design doc (WORKSPC, dated
// 2026-08-28): "If implemented in this slice, swap is a convenience form
// only. Compile it into existing deterministic operations... No
// persistence or schema knows about swap." This file introduces NO new
// RosterPatchOperation kind — a swap always compiles to exactly two
// 'replace' operations,
// which applyRosterPatch() already knows how to validate and apply for
// BOTH array-valued fields (gop/emergency/satellite) and Supervision's
// scalar fields (first_on_duty/second_on_duty) — 'replace' is already the
// correct primitive for "substitute one specific current occupant with
// another" in every section, so no field-type branching is needed here
// beyond the occupancy pre-check below.
import type { WorkforceMember } from '../../../types';
import {
  RosterSection,
  RosterPatchField,
  RosterPatchOperationReplace,
  RosterGrids,
  rowsForSection,
  isSupervisionScalarField,
  workforceNameMap,
} from './rosterPatch';
import { normalizeForComparison } from './identityResolver';

export interface SwapTarget {
  section: RosterSection;
  row_index: number;
  field: RosterPatchField;
  // The person the Chief believes currently occupies this target — swap
  // is only ever "substitute one specific occupant for another," never a
  // guess at who is there.
  workforce_id: string;
}

// Discriminant is a string literal (`status`), not a boolean — this
// project's tsconfig.json has no "strict"/strictNullChecks, and under
// that setting TypeScript's control-flow narrowing on a `ok: true|false`
// boolean discriminant silently fails to narrow the union at all
// (confirmed empirically against this exact tsconfig), which would make
// every `result.reason`/`result.operations` access below either a type
// error or, worse, silently unchecked. A string-literal discriminant
// narrows correctly under this project's actual compiler settings.
export type CompileSwapResult =
  | { status: 'ok'; operations: [RosterPatchOperationReplace, RosterPatchOperationReplace] }
  | { status: 'rejected'; reason: string };

function occupantPresentAtTarget(grids: RosterGrids, target: SwapTarget, expectedName: string): boolean {
  const rows = rowsForSection(grids, target.section) as Array<Record<string, unknown>>;
  if (target.row_index < 0 || target.row_index >= rows.length) return false;
  const row = rows[target.row_index];
  if (isSupervisionScalarField(target.section, target.field)) {
    const current = (row[target.field] as string | null) ?? null;
    return !!current && normalizeForComparison(current) === normalizeForComparison(expectedName);
  }
  const arr = (row[target.field] as string[] | undefined) || [];
  return arr.includes(target.workforce_id);
}

// Rejects every impossible/ambiguous case BEFORE generating any
// operation — identical targets, self-swap, an absent/unset scalar
// target, or an occupant who isn't actually present at the target in the
// CURRENT grid state (a friendlier, swap-specific rejection than letting
// applyRosterPatch's own generic 'replace' validation catch it later,
// though that validation still applies as a second, authoritative check
// when the operations are actually applied).
export function compileSwapToOperations(
  grids: RosterGrids,
  targetA: SwapTarget,
  targetB: SwapTarget,
  workforce: WorkforceMember[],
  reason?: string
): CompileSwapResult {
  if (
    targetA.section === targetB.section &&
    targetA.row_index === targetB.row_index &&
    targetA.field === targetB.field
  ) {
    return { status: 'rejected', reason: 'Cannot swap a target with itself — choose two different targets.' };
  }
  if (!targetA.workforce_id || !targetB.workforce_id) {
    return { status: 'rejected', reason: 'Both swap targets must have a current occupant to swap.' };
  }
  if (targetA.workforce_id === targetB.workforce_id) {
    return { status: 'rejected', reason: 'Cannot swap a person with themselves — choose two different people.' };
  }

  const nameById = workforceNameMap(workforce);
  const nameA = nameById.get(targetA.workforce_id) ?? targetA.workforce_id;
  const nameB = nameById.get(targetB.workforce_id) ?? targetB.workforce_id;

  if (!occupantPresentAtTarget(grids, targetA, nameA)) {
    return { status: 'rejected', reason: `${nameA} is not currently at the first chosen target — reload or choose a different target.` };
  }
  if (!occupantPresentAtTarget(grids, targetB, nameB)) {
    return { status: 'rejected', reason: `${nameB} is not currently at the second chosen target — reload or choose a different target.` };
  }

  return {
    status: 'ok',
    operations: [
      { op: 'replace', section: targetA.section, row_index: targetA.row_index, field: targetA.field, from_workforce_id: targetA.workforce_id, to_workforce_id: targetB.workforce_id, reason },
      { op: 'replace', section: targetB.section, row_index: targetB.row_index, field: targetB.field, from_workforce_id: targetB.workforce_id, to_workforce_id: targetA.workforce_id, reason },
    ],
  };
}
