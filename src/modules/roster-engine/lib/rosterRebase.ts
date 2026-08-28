// Stale-revision rebase classification.
// Per the reviewed "roster batch/swap/stale-revision" design doc (WORKSPC,
// dated 2026-08-28):
// on a stale-save rejection (migration 75's optimistic-concurrency check,
// unchanged and still authoritative — see rosterRevisionService.ts), the
// Chief's pending patch must be classified against what actually changed
// at EACH operation's own addressed (section, row_index, field) target,
// never against whole-roster inequality — an edit anywhere else in the
// roster must never block an unrelated patch.
import type { WorkforceMember } from '../../../types';
import {
  RosterPatchOperation,
  RosterGrids,
  operationWorkforceIds,
  validWorkforceIdSet,
  workforceNameMap,
  rowsForSection,
  isSupervisionScalarField,
  applyRosterPatch,
} from './rosterPatch';
import { computeNetRosterDiff, NetDiffEntry } from './rosterNetDiff';
import { normalizeForComparison } from './identityResolver';

export type RebaseClassification = 'REPLAYABLE' | 'CONFLICT' | 'TARGET_NO_LONGER_VALID';

export interface RebaseOperationResult {
  operation: RosterPatchOperation;
  classification: RebaseClassification;
  reason: string;
  // Resolved names currently occupying the operation's target in the
  // LATEST revision — what the Chief would be overwriting/building on.
  latestValue: string[] | string | null;
}

function fieldValueAt(
  grids: RosterGrids,
  operation: RosterPatchOperation
): { value: string[] | string | null; rowExists: boolean } {
  const rows = rowsForSection(grids, operation.section) as Array<Record<string, unknown>>;
  if (operation.row_index < 0 || operation.row_index >= rows.length) {
    return { value: null, rowExists: false };
  }
  const row = rows[operation.row_index];
  if (isSupervisionScalarField(operation.section, operation.field)) {
    return { value: (row[operation.field] as string | null) ?? null, rowExists: true };
  }
  return { value: (row[operation.field] as string[] | undefined) || [], rowExists: true };
}

function valuesEqual(section: RosterPatchOperation['section'], field: RosterPatchOperation['field'], a: string[] | string | null, b: string[] | string | null): boolean {
  if (isSupervisionScalarField(section, field)) {
    const an = a ? normalizeForComparison(a as string) : null;
    const bn = b ? normalizeForComparison(b as string) : null;
    return an === bn;
  }
  const arrA = (a as string[]) || [];
  const arrB = (b as string[]) || [];
  if (arrA.length !== arrB.length) return false;
  const setA = new Set(arrA);
  return arrB.every((id) => setA.has(id));
}

// Classifies each pending operation by comparing the EXACT field value at
// its own target between `baseGrids` (what the Chief was editing against)
// and `latestGrids` (the revision as it actually is now, fetched fresh).
// Workforce-identity invalidity (a referenced member deactivated since)
// is checked first and always wins as TARGET_NO_LONGER_VALID — a
// classification "the target field didn't change" would be misleading if
// the operation itself can no longer be applied at all.
export function classifyOperationsForRebase(
  baseGrids: RosterGrids,
  latestGrids: RosterGrids,
  operations: RosterPatchOperation[],
  workforce: WorkforceMember[]
): RebaseOperationResult[] {
  const validIds = validWorkforceIdSet(workforce);
  const nameById = workforceNameMap(workforce);
  const resolve = (id: string) => nameById.get(id) ?? id;

  return operations.map((operation): RebaseOperationResult => {
    const badId = operationWorkforceIds(operation).find((id) => !validIds.has(id));
    if (badId) {
      return {
        operation,
        classification: 'TARGET_NO_LONGER_VALID',
        reason: `${resolve(badId)} is no longer a recognized active workforce member.`,
        latestValue: null,
      };
    }

    const latest = fieldValueAt(latestGrids, operation);
    if (!latest.rowExists) {
      return {
        operation,
        classification: 'TARGET_NO_LONGER_VALID',
        reason: `Row ${operation.row_index} no longer exists in section "${operation.section}" in the latest revision.`,
        latestValue: null,
      };
    }

    const base = fieldValueAt(baseGrids, operation);
    const resolvedLatest = isSupervisionScalarField(operation.section, operation.field)
      ? (latest.value as string | null)
      : (latest.value as string[]).map(resolve);

    if (valuesEqual(operation.section, operation.field, base.value, latest.value)) {
      return {
        operation,
        classification: 'REPLAYABLE',
        reason: 'This exact target is unchanged since you started editing.',
        latestValue: resolvedLatest,
      };
    }

    return {
      operation,
      classification: 'CONFLICT',
      reason: 'This exact target changed elsewhere since you started editing.',
      latestValue: resolvedLatest,
    };
  });
}

export interface RebasePreview {
  results: RebaseOperationResult[];
  replayableOperations: RosterPatchOperation[];
  // What would change if the Chief confirms replaying only the
  // REPLAYABLE operations onto latestGrids — never guessed, never
  // auto-applied; purely a preview for the Chief-confirmation gate.
  netDiffIfReplayed: NetDiffEntry[];
}

export function buildRebasePreview(
  baseGrids: RosterGrids,
  latestGrids: RosterGrids,
  operations: RosterPatchOperation[],
  workforce: WorkforceMember[]
): RebasePreview {
  const results = classifyOperationsForRebase(baseGrids, latestGrids, operations, workforce);
  const replayableOperations = results.filter((r) => r.classification === 'REPLAYABLE').map((r) => r.operation);
  const replayed = applyRosterPatch(latestGrids, replayableOperations, workforce);
  return {
    results,
    replayableOperations,
    netDiffIfReplayed: computeNetRosterDiff(latestGrids, replayed.grids, workforce),
  };
}
