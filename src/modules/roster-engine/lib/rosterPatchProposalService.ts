// Roster AI V1 -- Prompt-to-Patch Proposal Layer: thin client wrapper for
// the roster-patch-proposal Edge Function. See
// WORKSPC_ROSTER_AI_V1_PROMPT_TO_PATCH_DISCOVER_AND_PLAN_2026-08-30.md and
// WORKSPC_ROSTER_AI_V1_FINAL_PREIMPLEMENTATION_REVIEW_2026-08-30.md for the
// full reviewed design. Matches rosterRevisionService.ts's own existing
// convention: no direct table access, a thin call wrapper only.
//
// Types below are DELIBERATELY duplicated from
// supabase/functions/roster-patch-proposal/schema.ts rather than imported
// across it -- that boundary is Deno vs. this project's Vite/tsc client
// build (supabase/functions is excluded from tsconfig.json, and no existing
// Edge Function in this repo is ever imported by client code or vice
// versa). Keep the two definitions in sync by hand if either changes.
//
// This service makes NO database write of any kind and calls no RPC --
// its only job is invoking the Edge Function and returning its typed
// response. Identity resolution, swap compilation, and all deterministic
// roster validation happen afterward in rosterPatchProposalCompiler.ts,
// completely separately.

import { supabase } from '../../../lib/databaseService';
import type { RosterSection, RosterPatchField } from './rosterPatch';

export type ProposalOutcome = 'valid' | 'ambiguous_identity' | 'unsupported_instruction' | 'needs_clarification';

// section + date_or_day + label + field is the sole location identity --
// mirrors supabase/functions/roster-patch-proposal/schema.ts's own
// LOAD-BEARING INVARIANT note exactly (2026-09-01,
// WRONG_ROSTER_ROW_TARGETING WITH_VALID_PROPOSAL containment/fix): the
// provider is never authoritative for row identity. There is
// deliberately no row_index here -- rosterPatchProposalCompiler.ts's
// resolveSymbolicRosterTarget() is the only place a row_index is ever
// derived, by deterministic matching against the current grid.
export interface SymbolicTarget {
  section: RosterSection;
  date_or_day: string | null;
  label: string | null;
  field: RosterPatchField;
}

export type SymbolicOperation =
  | { op: 'assign'; section: RosterSection; date_or_day: string | null; label: string | null; field: RosterPatchField; subject_name: string; reason?: string }
  | { op: 'unassign'; section: RosterSection; date_or_day: string | null; label: string | null; field: RosterPatchField; subject_name: string; reason?: string }
  | { op: 'replace'; section: RosterSection; date_or_day: string | null; label: string | null; field: RosterPatchField; from_subject_name: string; to_subject_name: string; reason?: string }
  | {
      op: 'swap';
      target_a: SymbolicTarget;
      target_b: SymbolicTarget;
      subject_a_name: string;
      subject_b_name: string;
      reason?: string;
    };

export interface ProposedRosterPatch {
  interpreted_instruction: string;
  operations: SymbolicOperation[];
  referenced_names: string[];
  unresolved_ambiguity: string[];
  unsupported_requests: string[];
  assumptions: string[];
  rationale: string;
  outcome: ProposalOutcome;
}

export interface RosterProposalContextRow {
  section: RosterSection;
  row_index: number;
  date_or_day: string | null;
  label: string | null;
  current: Partial<Record<RosterPatchField, string[] | null>>;
}

export interface RosterProposalWorkforceEntry {
  display_name: string;
  category: 'Registrar' | 'Senior Registrar' | 'Medical Officer';
}

export type RosterPatchProposalRequest = {
  admin_access_code: string;
  instruction: string;
  roster_context: RosterProposalContextRow[];
  workforce_context: RosterProposalWorkforceEntry[];
  section_labels?: Partial<Record<RosterSection, string>>;
};

export type RosterPatchProposalResult =
  | { status: 'ok'; proposal: ProposedRosterPatch; provider: 'openai' | 'gemini' }
  | { status: 'quota_exceeded'; message: string; resets_at: string | null }
  | { status: 'invalid_admin_code' }
  | { status: 'invalid_request'; message: string }
  | { status: 'schema_invalid'; message: string }
  | { status: 'provider_unavailable' };

// Never calls any RPC, never touches roster_revisions/combined_master_rosters
// in any way -- the Edge Function itself makes no database write (see its
// own header), and this wrapper does nothing beyond invoking it and
// returning its response.
export async function generateRosterPatchProposal(request: RosterPatchProposalRequest): Promise<RosterPatchProposalResult> {
  if (!supabase) return { status: 'provider_unavailable' };
  try {
    const { data, error } = await supabase.functions.invoke('roster-patch-proposal', { body: request });
    if (error) {
      console.warn('Edge Function roster-patch-proposal failed:', error.message);
      return { status: 'provider_unavailable' };
    }
    if (!data || typeof data.status !== 'string') {
      return { status: 'provider_unavailable' };
    }
    return data as RosterPatchProposalResult;
  } catch (err) {
    console.warn('Edge Function roster-patch-proposal threw:', err);
    return { status: 'provider_unavailable' };
  }
}
