// Roster AI V1 -- Prompt-to-Patch Proposal Layer: the client compilation
// pipeline. See WORKSPC_ROSTER_AI_V1_PROMPT_TO_PATCH_DISCOVER_AND_PLAN_2026-08-30.md
// and WORKSPC_ROSTER_AI_V1_FINAL_PREIMPLEMENTATION_REVIEW_2026-08-30.md
// (Section 5) for the full reviewed design this file implements.
//
// Exact pipeline (per prompt1.txt's own instruction):
//   validated symbolic proposal
//   -> deterministic LOCATION resolution (resolveSymbolicRosterTarget, below)
//   -> existing exact/unique identityResolver (UNCHANGED)
//   -> unresolved/ambiguous identities surfaced to Chief, never guessed
//   -> swap requests compiled through existing compileSwapToOperations (UNCHANGED)
//   -> canonical RosterPatchOperation[]
// Everything AFTER this file (applyRosterPatch, reconciliation, net diff,
// the pendingOperations queue) is the caller's existing, unmodified code --
// this file's only job is symbolic-location/name -> real-row_index/
// workforce_id compilation.
//
// Does NOT modify identityResolver.ts or rosterSwap.ts. rosterPatch.ts
// gained one small, additive, pure-function export (rowSemanticLabelFor)
// -- its own row-index-addressed RosterPatchOperation/applyRosterPatch
// contract is completely unchanged (that layer's row_index is always
// compiler-derived here, never AI-supplied -- see this file's own
// resolveSymbolicRosterTarget() below).
// Does NOT add fuzzy identity resolution -- an ambiguous or unresolved name
// is surfaced as exactly that, never guessed at.
//
// LOAD-BEARING INVARIANT (2026-09-01, WRONG_ROSTER_ROW_TARGETING
// WITH_VALID_PROPOSAL containment/fix): the provider is NEVER authoritative
// for roster row identity. See resolveSymbolicRosterTarget()'s own
// header immediately below for the full mechanism and the exact
// production incident this closes.

import type { WorkforceMember } from '../../../types';
import { RosterPatchOperation, RosterGrids, RosterSection, RosterPatchField, rowsForSection, rowSemanticLabelFor, fieldsForSection } from './rosterPatch';
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

// Why zero or multiple matches is EXACTLY as unsafe as one wrong match:
// a row-identity failure never has a "close enough" answer. Reasons are
// kept distinct (rather than a single boolean) so the Chief-facing
// message can say something more useful than "location not found."
export type LocationResolutionFailureReason = 'no_matching_row' | 'ambiguous_row' | 'invalid_field';

export type LocationResolution =
  | { status: 'resolved'; row_index: number }
  | { status: 'unresolved'; reason: LocationResolutionFailureReason };

// THE deterministic row resolver -- the ONLY place anywhere in this
// codebase that a row_index is ever derived from an AI-proposed
// operation. Matches a symbolic location (section + date_or_day + label
// + field, all copied by the model from the roster_context it was given
// -- see schema.ts's own LOAD-BEARING INVARIANT note) against the
// CURRENT authoritative grid, requiring an EXACT, UNIQUE match before
// ever producing a row_index. No fuzzy matching. No nearest match. No
// first-match fallback. No AI-supplied row_index is read anywhere (the
// symbolic schema no longer even carries one).
//
// This closes WRONG_ROSTER_ROW_TARGETING WITH_VALID_PROPOSAL (2026-09-01
// production pilot finding): a Chief instructed "replace Dr Ikor with Dr
// Ulasi on the Tue 01/09 Managed Care row"; the model's own
// interpreted_instruction text correctly echoed "Tue 01/09"; but under
// the PRIOR schema the model separately reported a raw row_index integer
// that actually pointed at a different date (Thu 03/09) sharing the same
// clinic_type label -- and every downstream layer (compiler, then
// applyRosterPatch) trusted that integer verbatim, because row_index
// carried no semantic meaning anything could cross-check it against. The
// Net Effect preview (rosterPatch.ts's own independent date_or_day
// re-derivation at apply time) was the only thing that exposed the
// mismatch, and only after the fact, on a proposal already marked
// "valid" with exact/unique identity resolution. Root-cause investigation
// (WORKSPC-equivalent findings, this same date) proved by exhaustive code
// review that every layer between the model's response and the Net
// Effect display is a pure, unmodified pass-through of whatever row_index
// the model returned -- so the wrong value could only have originated in
// the model's own output, not in any deterministic layer. This function
// is what makes that class of bug structurally impossible going forward:
// row_index is no longer provider-supplied at all.
export function resolveSymbolicRosterTarget(
  currentGrids: RosterGrids,
  location: { section: RosterSection; date_or_day: string | null; label: string | null; field: RosterPatchField }
): LocationResolution {
  if (!fieldsForSection(location.section).includes(location.field)) {
    return { status: 'unresolved', reason: 'invalid_field' };
  }
  const rows = rowsForSection(currentGrids, location.section);
  const matches: number[] = [];
  rows.forEach((row, index) => {
    const rowDateOrDay = ((row as Record<string, unknown>).date_or_day as string | null) ?? null;
    const rowLabel = rowSemanticLabelFor(location.section, row);
    if (rowDateOrDay === location.date_or_day && rowLabel === location.label) {
      matches.push(index);
    }
  });
  if (matches.length === 0) return { status: 'unresolved', reason: 'no_matching_row' };
  if (matches.length > 1) return { status: 'unresolved', reason: 'ambiguous_row' };
  return { status: 'resolved', row_index: matches[0] };
}

// Chief-facing message for a failed location resolution -- deliberately
// separate from UnresolvedNameDetail's messaging (an identity problem and
// a location problem are different failure classes, per this task's own
// explicit instruction to distinguish them "where useful").
function locationResolutionMessage(location: { section: RosterSection; date_or_day: string | null; label: string | null }, reason: LocationResolutionFailureReason): string {
  const where = [location.label, location.date_or_day].filter((x): x is string => !!x).join(' on ') || 'the specified location';
  if (reason === 'invalid_field') return `The proposed field is not valid for section "${location.section}".`;
  if (reason === 'no_matching_row') return `No roster row matches ${where} -- the AI may have described a location that does not exist in the current roster.`;
  return `More than one roster row matches ${where} -- the location is ambiguous and cannot be safely targeted.`;
}

// One compiled entry per symbolic operation the model proposed. 'resolved'
// carries 1 real operation for assign/unassign/replace, or 2 for a
// successfully compiled swap (compileSwapToOperations' own shape,
// unchanged) -- both cases are "this symbolic operation, converted."
// 'location_unresolvable' is deliberately distinct from 'unresolvable'
// (identity failure) -- see locationResolutionMessage() above.
export type CompiledProposalOperation =
  | { status: 'resolved'; symbolic: SymbolicOperation; operations: RosterPatchOperation[] }
  | { status: 'unresolvable'; symbolic: SymbolicOperation; details: UnresolvedNameDetail[] }
  | { status: 'location_unresolvable'; symbolic: SymbolicOperation; reason: LocationResolutionFailureReason; message: string }
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
      // Location resolved deterministically FIRST -- before any identity
      // work -- per this task's own required ordering. A location that
      // cannot be proven never becomes a checkable/acceptable operation,
      // regardless of whether the named person would otherwise resolve.
      const location = resolveSymbolicRosterTarget(currentGrids, symbolic);
      if (location.status === 'unresolved') {
        return { status: 'location_unresolvable', symbolic, reason: location.reason, message: locationResolutionMessage(symbolic, location.reason) };
      }
      const resolved = resolveName(symbolic.subject_name, workforce);
      if (!isResolved(resolved)) return { status: 'unresolvable', symbolic, details: [resolved] };
      return {
        status: 'resolved',
        symbolic,
        operations: [
          symbolic.op === 'assign'
            ? { op: 'assign', section: symbolic.section, row_index: location.row_index, field: symbolic.field, workforce_id: resolved.workforceId, reason: symbolic.reason }
            : { op: 'unassign', section: symbolic.section, row_index: location.row_index, field: symbolic.field, workforce_id: resolved.workforceId, reason: symbolic.reason },
        ],
      };
    }

    if (symbolic.op === 'replace') {
      const location = resolveSymbolicRosterTarget(currentGrids, symbolic);
      if (location.status === 'unresolved') {
        return { status: 'location_unresolvable', symbolic, reason: location.reason, message: locationResolutionMessage(symbolic, location.reason) };
      }
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
            row_index: location.row_index,
            field: symbolic.field,
            from_workforce_id: (from as { workforceId: string }).workforceId,
            to_workforce_id: (to as { workforceId: string }).workforceId,
            reason: symbolic.reason,
          },
        ],
      };
    }

    // swap -- BOTH endpoints must be independently and uniquely resolved
    // before any atomic swap operation is emitted (per this task's own
    // explicit requirement). Location resolution runs before identity
    // resolution here too, same ordering as the branches above.
    const locationA = resolveSymbolicRosterTarget(currentGrids, symbolic.target_a);
    const locationB = resolveSymbolicRosterTarget(currentGrids, symbolic.target_b);
    if (locationA.status === 'unresolved') {
      return { status: 'location_unresolvable', symbolic, reason: locationA.reason, message: `Target A: ${locationResolutionMessage(symbolic.target_a, locationA.reason)}` };
    }
    if (locationB.status === 'unresolved') {
      return { status: 'location_unresolvable', symbolic, reason: locationB.reason, message: `Target B: ${locationResolutionMessage(symbolic.target_b, locationB.reason)}` };
    }

    const a = resolveName(symbolic.subject_a_name, workforce);
    const b = resolveName(symbolic.subject_b_name, workforce);
    const details = [a, b].filter((r): r is UnresolvedNameDetail => !isResolved(r));
    if (details.length > 0) return { status: 'unresolvable', symbolic, details };

    const targetA: SwapTarget = { section: symbolic.target_a.section, row_index: locationA.row_index, field: symbolic.target_a.field, workforce_id: (a as { workforceId: string }).workforceId };
    const targetB: SwapTarget = { section: symbolic.target_b.section, row_index: locationB.row_index, field: symbolic.target_b.field, workforce_id: (b as { workforceId: string }).workforceId };
    const compiled = compileSwapToOperations(currentGrids, targetA, targetB, workforce, symbolic.reason);
    if (compiled.status === 'rejected') return { status: 'swap_rejected', symbolic, reason: compiled.reason };
    return { status: 'resolved', symbolic, operations: compiled.operations };
  });
}
