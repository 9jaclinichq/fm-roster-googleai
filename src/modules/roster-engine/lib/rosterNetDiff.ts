// Net roster diff — base snapshot vs. final (post-batch) snapshot.
// Per the reviewed "roster batch/swap/stale-revision" design doc (WORKSPC,
// dated 2026-08-28):
// "Compute: base snapshot -> apply ordered patch batch -> final snapshot
// -> semantic diff(base, final)." This is a pure before/after comparison
// with NO awareness of the operations that produced `final` — it is this
// unawareness that makes cancel-out sequences (assign then unassign,
// replace then replace back) collapse to "no change" automatically,
// without any special-casing of specific operation sequences.
import type { WorkforceMember, ReconciliationIssue } from '../../../types';
import {
  RosterSection,
  RosterPatchField,
  RosterGrids,
  fieldsForSection,
  fieldLabelFor,
  rowsForSection,
  isSupervisionScalarField,
  workforceNameMap,
} from './rosterPatch';
import { normalizeForComparison } from './identityResolver';

const ALL_SECTIONS: RosterSection[] = ['gop', 'emergency', 'supervision', 'satellite'];

export interface NetDiffEntry {
  section: RosterSection;
  row_index: number;
  dateOrDay: string | null;
  field: RosterPatchField;
  fieldLabel: string;
  // Resolved, human-readable names — never raw workforce_id/unresolved
  // text swapped in silently.
  removedNames: string[];
  addedNames: string[];
}

// Row-index alignment between base/final is safe for the exact same
// reason applyRosterPatch()'s own addressing invariant is safe: this
// slice has no operation capable of inserting/deleting/reordering a row,
// so base and final always have identical row counts/order per section.
export function computeNetRosterDiff(
  base: RosterGrids,
  final: RosterGrids,
  workforce: WorkforceMember[]
): NetDiffEntry[] {
  const nameById = workforceNameMap(workforce);
  const resolve = (idOrText: string) => nameById.get(idOrText) ?? idOrText;
  const entries: NetDiffEntry[] = [];

  for (const section of ALL_SECTIONS) {
    const baseRows = rowsForSection(base, section) as Array<Record<string, unknown>>;
    const finalRows = rowsForSection(final, section) as Array<Record<string, unknown>>;
    const rowCount = Math.min(baseRows.length, finalRows.length);

    for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
      const dateOrDay = (baseRows[rowIndex].date_or_day as string | null) ?? null;

      for (const field of fieldsForSection(section)) {
        if (isSupervisionScalarField(section, field)) {
          const baseVal = (baseRows[rowIndex][field] as string | null) ?? null;
          const finalVal = (finalRows[rowIndex][field] as string | null) ?? null;
          const baseNorm = baseVal ? normalizeForComparison(baseVal) : null;
          const finalNorm = finalVal ? normalizeForComparison(finalVal) : null;

          if (baseNorm === finalNorm) continue; // naturally collapses any cancel-out sequence

          entries.push({
            section,
            row_index: rowIndex,
            dateOrDay,
            field,
            fieldLabel: fieldLabelFor(field),
            removedNames: baseVal ? [baseVal] : [],
            addedNames: finalVal ? [finalVal] : [],
          });
        } else {
          const baseArr = (baseRows[rowIndex][field] as string[] | undefined) || [];
          const finalArr = (finalRows[rowIndex][field] as string[] | undefined) || [];
          const baseSet = new Set(baseArr);
          const finalSet = new Set(finalArr);
          const removed = baseArr.filter((id) => !finalSet.has(id));
          const added = finalArr.filter((id) => !baseSet.has(id));

          if (removed.length === 0 && added.length === 0) continue;

          entries.push({
            section,
            row_index: rowIndex,
            dateOrDay,
            field,
            fieldLabel: fieldLabelFor(field),
            removedNames: removed.map(resolve),
            addedNames: added.map(resolve),
          });
        }
      }
    }
  }

  return entries;
}

export interface NetReconciliationIssues {
  // Present in base AND final — pre-existing, unaffected by this batch.
  unaffected: ReconciliationIssue[];
  // Present in final only — this batch introduced them.
  introducedByBatch: ReconciliationIssue[];
  // Present in base only — this batch resolved them.
  resolvedByBatch: ReconciliationIssue[];
}

// Deliberately dumb/structural (type + workforceId + message), not a
// reinterpretation of what computeReconciliationIssues() means — this
// function never recomputes or relabels an issue, it only classifies
// ALREADY-COMPUTED issue lists (one run against base grids, one against
// final grids, both via the caller's own unmodified
// computeReconciliationIssues() call) by set membership. FM-specific vs.
// generic labeling stays exactly where it already lives (the issue's own
// `type`), never collapsed here.
function issueKey(issue: ReconciliationIssue): string {
  return JSON.stringify([issue.type, issue.workforceId, issue.message]);
}

export function computeNetReconciliationIssues(
  baseIssues: ReconciliationIssue[],
  finalIssues: ReconciliationIssue[]
): NetReconciliationIssues {
  const baseKeys = new Set(baseIssues.map(issueKey));
  const finalKeys = new Set(finalIssues.map(issueKey));
  return {
    unaffected: finalIssues.filter((issue) => baseKeys.has(issueKey(issue))),
    introducedByBatch: finalIssues.filter((issue) => !baseKeys.has(issueKey(issue))),
    resolvedByBatch: baseIssues.filter((issue) => !finalKeys.has(issueKey(issue))),
  };
}
