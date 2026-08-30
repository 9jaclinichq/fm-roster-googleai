// Roster AI V1 -- Prompt-to-Patch Proposal Layer: the client compilation
// pipeline. See WORKSPC_ROSTER_AI_V1_PROMPT_TO_PATCH_DISCOVER_AND_PLAN_2026-08-30.md
// and WORKSPC_ROSTER_AI_V1_FINAL_PREIMPLEMENTATION_REVIEW_2026-08-30.md
// (Section 5) for the full reviewed design this file implements.
//
// Exact pipeline (per prompt1.txt's own instruction):
//   validated symbolic proposal
//   -> existing exact/unique identityResolver (UNCHANGED)
//   -> unresolved/ambiguous identities surfaced to Chief, never guessed
//   -> swap requests compiled through existing compileSwapToOperations (UNCHANGED)
//   -> canonical RosterPatchOperation[]
// Everything AFTER this file (applyRosterPatch, reconciliation, net diff,
// the pendingOperations queue) is the caller's existing, unmodified code --
// this file's only job is symbolic-name -> real-workforce_id compilation.
//
// Does NOT modify identityResolver.ts, rosterSwap.ts, or rosterPatch.ts.
// Does NOT add fuzzy identity resolution -- an ambiguous or unresolved name
// is surfaced as exactly that, never guessed at.

import type { WorkforceMember } from '../../../types';
import { RosterPatchOperation, RosterGrids } from './rosterPatch';
import { resolveParsedNameToWorkforceId } from './identityResolver';
import { compileSwapToOperations, SwapTarget } from './rosterSwap';
import type { SymbolicOperation } from './rosterPatchProposalService';

export interface UnresolvedNameDetail {
  name: string;
  status: 'ambiguous' | 'unresolved';
  // Resolved display names of every candidate, if ambiguous -- never an
  // auto-pick, purely for the Chief to recognize who was meant.
  candidateNames?: string[];
}

// One compiled entry per symbolic operation the model proposed. 'resolved'
// carries 1 real operation for assign/unassign/replace, or 2 for a
// successfully compiled swap (compileSwapToOperations' own shape,
// unchanged) -- both cases are "this symbolic operation, converted."
export type CompiledProposalOperation =
  | { status: 'resolved'; symbolic: SymbolicOperation; operations: RosterPatchOperation[] }
  | { status: 'unresolvable'; symbolic: SymbolicOperation; details: UnresolvedNameDetail[] }
  | { status: 'swap_rejected'; symbolic: SymbolicOperation; reason: string };

function resolveName(name: string, workforce: WorkforceMember[]): UnresolvedNameDetail | { workforceId: string } {
  const result = resolveParsedNameToWorkforceId(name, workforce);
  if (result.status === 'resolved') return { workforceId: result.workforceId };
  if (result.status === 'ambiguous') {
    const nameById = new Map(workforce.map((w) => [w.id, w.full_name]));
    return {
      name,
      status: 'ambiguous',
      candidateNames: result.candidateWorkforceIds.map((id) => nameById.get(id) ?? id),
    };
  }
  return { name, status: 'unresolved' };
}

function isResolved(v: UnresolvedNameDetail | { workforceId: string }): v is { workforceId: string } {
  return 'workforceId' in v;
}

export function compileProposalOperations(
  operations: SymbolicOperation[],
  currentGrids: RosterGrids,
  workforce: WorkforceMember[]
): CompiledProposalOperation[] {
  return operations.map((symbolic): CompiledProposalOperation => {
    if (symbolic.op === 'assign' || symbolic.op === 'unassign') {
      const resolved = resolveName(symbolic.subject_name, workforce);
      if (!isResolved(resolved)) return { status: 'unresolvable', symbolic, details: [resolved] };
      return {
        status: 'resolved',
        symbolic,
        operations: [
          symbolic.op === 'assign'
            ? { op: 'assign', section: symbolic.section, row_index: symbolic.row_index, field: symbolic.field, workforce_id: resolved.workforceId, reason: symbolic.reason }
            : { op: 'unassign', section: symbolic.section, row_index: symbolic.row_index, field: symbolic.field, workforce_id: resolved.workforceId, reason: symbolic.reason },
        ],
      };
    }

    if (symbolic.op === 'replace') {
      const from = resolveName(symbolic.from_subject_name, workforce);
      const to = resolveName(symbolic.to_subject_name, workforce);
      const details = [from, to].filter((r): r is UnresolvedNameDetail => !isResolved(r));
      if (details.length > 0) return { status: 'unresolvable', symbolic, details };
      return {
        status: 'resolved',
        symbolic,
        operations: [
          {
            op: 'replace',
            section: symbolic.section,
            row_index: symbolic.row_index,
            field: symbolic.field,
            from_workforce_id: (from as { workforceId: string }).workforceId,
            to_workforce_id: (to as { workforceId: string }).workforceId,
            reason: symbolic.reason,
          },
        ],
      };
    }

    // swap
    const a = resolveName(symbolic.subject_a_name, workforce);
    const b = resolveName(symbolic.subject_b_name, workforce);
    const details = [a, b].filter((r): r is UnresolvedNameDetail => !isResolved(r));
    if (details.length > 0) return { status: 'unresolvable', symbolic, details };

    const targetA: SwapTarget = { section: symbolic.target_a.section, row_index: symbolic.target_a.row_index, field: symbolic.target_a.field, workforce_id: (a as { workforceId: string }).workforceId };
    const targetB: SwapTarget = { section: symbolic.target_b.section, row_index: symbolic.target_b.row_index, field: symbolic.target_b.field, workforce_id: (b as { workforceId: string }).workforceId };
    const compiled = compileSwapToOperations(currentGrids, targetA, targetB, workforce, symbolic.reason);
    if (compiled.status === 'rejected') return { status: 'swap_rejected', symbolic, reason: compiled.reason };
    return { status: 'resolved', symbolic, operations: compiled.operations };
  });
}
