// Roster AI V1 -- Prompt-to-Patch Proposal Layer: the locked symbolic
// proposal contract and its server-side structured-output validator. See
// the repo root's two dated 2026-08-30 WORKSPC_ROSTER_AI_V1_*.md documents
// (the DISCOVER+PLAN doc, Section 6, and its final pre-implementation
// review, Sections 3-4) for the full reviewed design this file implements.
//
// DELIBERATELY ZERO IMPORTS: this file duplicates rosterPatch.ts's small
// section/field-validity table rather than importing it, so the exact same
// file can run unmodified both inside the Deno Edge Function
// (supabase/functions/roster-patch-proposal/index.ts) and under Node/tsx in
// scripts/verify-roster-patch-proposal.ts -- the real validator under test,
// never a reimplementation. supabase/functions is excluded from
// tsconfig.json and has no build-time link to src/ anywhere in this repo
// (every existing Edge Function already duplicates its own small constants
// rather than reaching across that boundary) -- see the design doc's
// Section 4 for why this duplication is the deliberate choice here.
//
// validateProposedRosterPatch() rejects (never coerces/repairs) anything
// outside the exact shape below -- unknown operation types, unknown
// sections, unknown fields for a given section, malformed/out-of-range-type
// row indexes, unknown top-level or per-operation keys, and therefore any
// workforce_id/tenant_id/other authority-bearing field a model might
// hallucinate, since no such key is ever in any allowed-key set here. A
// response that fails this validator becomes a safe proposal-generation
// failure (schema_invalid), never a partial patch.

export type RosterSection = 'gop' | 'emergency' | 'supervision' | 'satellite';
export type RosterPatchField = 'consultants' | 'residents' | 'on_call' | 'assigned' | 'first_on_duty' | 'second_on_duty';

const VALID_FIELDS_BY_SECTION: Record<RosterSection, RosterPatchField[]> = {
  gop: ['consultants', 'residents'],
  emergency: ['on_call'],
  satellite: ['assigned'],
  supervision: ['first_on_duty', 'second_on_duty'],
};

export type ProposalOutcome = 'valid' | 'ambiguous_identity' | 'unsupported_instruction' | 'needs_clarification';
const VALID_OUTCOMES: ProposalOutcome[] = ['valid', 'ambiguous_identity', 'unsupported_instruction', 'needs_clarification'];

export interface SymbolicTarget {
  section: RosterSection;
  row_index: number;
  field: RosterPatchField;
}

export type SymbolicOperation =
  | { op: 'assign'; section: RosterSection; row_index: number; field: RosterPatchField; subject_name: string; reason?: string }
  | { op: 'unassign'; section: RosterSection; row_index: number; field: RosterPatchField; subject_name: string; reason?: string }
  | { op: 'replace'; section: RosterSection; row_index: number; field: RosterPatchField; from_subject_name: string; to_subject_name: string; reason?: string }
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

// Discriminant is a string literal (`status`), not a boolean -- this
// repo's tsconfig.json has no "strict"/strictNullChecks, and under that
// setting TypeScript's control-flow narrowing on a boolean discriminant
// (e.g. `ok: true | false`) silently fails to narrow the union at all
// (documented precedent: rosterSwap.ts's own CompileSwapResult header).
export type SchemaValidationResult =
  | { status: 'ok'; proposal: ProposedRosterPatch }
  | { status: 'error'; message: string };

const TOP_LEVEL_KEYS = new Set([
  'interpreted_instruction', 'operations', 'referenced_names', 'unresolved_ambiguity',
  'unsupported_requests', 'assumptions', 'rationale', 'outcome',
]);
const ASSIGN_UNASSIGN_KEYS = new Set(['op', 'section', 'row_index', 'field', 'subject_name', 'reason']);
const REPLACE_KEYS = new Set(['op', 'section', 'row_index', 'field', 'from_subject_name', 'to_subject_name', 'reason']);
const SWAP_KEYS = new Set(['op', 'target_a', 'target_b', 'subject_a_name', 'subject_b_name', 'reason']);
const TARGET_KEYS = new Set(['section', 'row_index', 'field']);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}
function hasOnlyKeys(obj: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(obj).every((k) => allowed.has(k));
}
function isValidSection(v: unknown): v is RosterSection {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(VALID_FIELDS_BY_SECTION, v);
}
function isValidRowIndex(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}
function isValidFieldForSection(section: RosterSection, field: unknown): field is RosterPatchField {
  return typeof field === 'string' && VALID_FIELDS_BY_SECTION[section].includes(field as RosterPatchField);
}

function validateTarget(v: unknown): string | null {
  if (!isPlainObject(v)) return 'must be an object';
  if (!hasOnlyKeys(v, TARGET_KEYS)) return 'has an unexpected key';
  if (!isValidSection(v.section)) return `unknown section "${String(v.section)}"`;
  if (!isValidRowIndex(v.row_index)) return 'invalid row_index';
  if (!isValidFieldForSection(v.section, v.field)) return `field "${String(v.field)}" is not valid for section "${v.section}"`;
  return null;
}

function validateOperation(v: unknown, index: number): string | null {
  if (!isPlainObject(v)) return `operation ${index} is not an object`;
  const op = (v as Record<string, unknown>).op;

  if (op === 'assign' || op === 'unassign') {
    if (!hasOnlyKeys(v, ASSIGN_UNASSIGN_KEYS)) return `operation ${index} (${op}) has an unexpected key`;
    if (!isValidSection(v.section)) return `operation ${index}: unknown section "${String(v.section)}"`;
    if (!isValidRowIndex(v.row_index)) return `operation ${index}: invalid row_index`;
    if (!isValidFieldForSection(v.section, v.field)) return `operation ${index}: field "${String(v.field)}" is not valid for section "${v.section}"`;
    if (!isNonEmptyString(v.subject_name)) return `operation ${index}: subject_name must be a non-empty string`;
    if (v.reason !== undefined && typeof v.reason !== 'string') return `operation ${index}: reason must be a string if present`;
    return null;
  }

  if (op === 'replace') {
    if (!hasOnlyKeys(v, REPLACE_KEYS)) return `operation ${index} (replace) has an unexpected key`;
    if (!isValidSection(v.section)) return `operation ${index}: unknown section "${String(v.section)}"`;
    if (!isValidRowIndex(v.row_index)) return `operation ${index}: invalid row_index`;
    if (!isValidFieldForSection(v.section, v.field)) return `operation ${index}: field "${String(v.field)}" is not valid for section "${v.section}"`;
    if (!isNonEmptyString(v.from_subject_name)) return `operation ${index}: from_subject_name must be a non-empty string`;
    if (!isNonEmptyString(v.to_subject_name)) return `operation ${index}: to_subject_name must be a non-empty string`;
    if (v.reason !== undefined && typeof v.reason !== 'string') return `operation ${index}: reason must be a string if present`;
    return null;
  }

  if (op === 'swap') {
    if (!hasOnlyKeys(v, SWAP_KEYS)) return `operation ${index} (swap) has an unexpected key`;
    const targetAErr = validateTarget(v.target_a);
    if (targetAErr) return `operation ${index}: target_a -- ${targetAErr}`;
    const targetBErr = validateTarget(v.target_b);
    if (targetBErr) return `operation ${index}: target_b -- ${targetBErr}`;
    if (!isNonEmptyString(v.subject_a_name)) return `operation ${index}: subject_a_name must be a non-empty string`;
    if (!isNonEmptyString(v.subject_b_name)) return `operation ${index}: subject_b_name must be a non-empty string`;
    if (v.reason !== undefined && typeof v.reason !== 'string') return `operation ${index}: reason must be a string if present`;
    return null;
  }

  return `operation ${index}: unknown op "${String(op)}"`;
}

export function validateProposedRosterPatch(raw: unknown): SchemaValidationResult {
  if (!isPlainObject(raw)) return { status: 'error', message: 'response is not a JSON object' };
  if (!hasOnlyKeys(raw, TOP_LEVEL_KEYS)) return { status: 'error', message: 'response has an unexpected top-level key' };
  if (!isNonEmptyString(raw.interpreted_instruction)) return { status: 'error', message: 'interpreted_instruction must be a non-empty string' };
  if (!Array.isArray(raw.operations)) return { status: 'error', message: 'operations must be an array' };

  for (let i = 0; i < raw.operations.length; i++) {
    const err = validateOperation(raw.operations[i], i);
    if (err) return { status: 'error', message: err };
  }

  if (!isStringArray(raw.referenced_names)) return { status: 'error', message: 'referenced_names must be an array of strings' };
  if (!isStringArray(raw.unresolved_ambiguity)) return { status: 'error', message: 'unresolved_ambiguity must be an array of strings' };
  if (!isStringArray(raw.unsupported_requests)) return { status: 'error', message: 'unsupported_requests must be an array of strings' };
  if (!isStringArray(raw.assumptions)) return { status: 'error', message: 'assumptions must be an array of strings' };
  if (typeof raw.rationale !== 'string') return { status: 'error', message: 'rationale must be a string' };
  if (!VALID_OUTCOMES.includes(raw.outcome as ProposalOutcome)) return { status: 'error', message: `unknown outcome "${String(raw.outcome)}"` };

  return {
    status: 'ok',
    proposal: {
      interpreted_instruction: raw.interpreted_instruction,
      operations: raw.operations as SymbolicOperation[],
      referenced_names: raw.referenced_names,
      unresolved_ambiguity: raw.unresolved_ambiguity,
      unsupported_requests: raw.unsupported_requests,
      assumptions: raw.assumptions,
      rationale: raw.rationale,
      outcome: raw.outcome as ProposalOutcome,
    },
  };
}
