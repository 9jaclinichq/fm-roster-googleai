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

// LOAD-BEARING INVARIANT (2026-09-01, WRONG_ROSTER_ROW_TARGETING WITH_VALID_PROPOSAL
// containment/fix): the provider is NEVER authoritative for roster row
// identity. A symbolic operation locates its target using ONLY the
// semantic attributes already present in the roster_context sent to the
// model -- section, date_or_day, label (clinic_type/shift/facility,
// null for supervision), and field -- never a raw array index. There is
// deliberately no row_index anywhere in this file's operation/target
// shapes: src/modules/roster-engine/lib/rosterPatchProposalCompiler.ts's
// resolveSymbolicRosterTarget() is the ONLY place a row_index is ever
// derived, by deterministically matching these exact semantic fields
// against the CURRENT authoritative grid -- requiring exactly one match,
// never guessing/nearest-matching. See that function's own header for
// why (the bug this closes: the model correctly stated "Tue 01/09" in
// its own interpreted_instruction text while a since-removed row_index
// field silently pointed at a different date entirely -- nothing
// downstream could catch this because row_index carried no semantic
// meaning to cross-check against).

// Exported so index.ts's request-context normalizer (Section B, 2026-08-30
// working-state/context-allowlisting fix) can validate roster_context field
// names against this exact same table instead of a third duplicate copy.
export const VALID_FIELDS_BY_SECTION: Record<RosterSection, RosterPatchField[]> = {
  gop: ['consultants', 'residents'],
  emergency: ['on_call'],
  satellite: ['assigned'],
  supervision: ['first_on_duty', 'second_on_duty'],
};

export type ProposalOutcome = 'valid' | 'ambiguous_identity' | 'unsupported_instruction' | 'needs_clarification';
const VALID_OUTCOMES: ProposalOutcome[] = ['valid', 'ambiguous_identity', 'unsupported_instruction', 'needs_clarification'];

// section + date_or_day + label + field is the sole location identity --
// see the LOAD-BEARING INVARIANT note above. date_or_day/label are
// nullable to match RosterContextRow's own shape exactly (label is
// always null for 'supervision', date_or_day can be null for a
// non-day-specific 'satellite' posting) -- the model is instructed to
// copy these two fields verbatim from the context row it means, never
// compute or invent a value.
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
const ASSIGN_UNASSIGN_KEYS = new Set(['op', 'section', 'date_or_day', 'label', 'field', 'subject_name', 'reason']);
const REPLACE_KEYS = new Set(['op', 'section', 'date_or_day', 'label', 'field', 'from_subject_name', 'to_subject_name', 'reason']);
const SWAP_KEYS = new Set(['op', 'target_a', 'target_b', 'subject_a_name', 'subject_b_name', 'reason']);
const TARGET_KEYS = new Set(['section', 'date_or_day', 'label', 'field']);

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
// date_or_day/label: either exactly null, or a non-empty string -- never
// an empty string, never a number/object. Shared by both target fields
// since both are nullable-string location attributes with identical
// validity rules.
function isValidNullableString(v: unknown): v is string | null {
  return v === null || isNonEmptyString(v);
}
function isValidFieldForSection(section: RosterSection, field: unknown): field is RosterPatchField {
  return typeof field === 'string' && VALID_FIELDS_BY_SECTION[section].includes(field as RosterPatchField);
}

function validateTarget(v: unknown): string | null {
  if (!isPlainObject(v)) return 'must be an object';
  if (!hasOnlyKeys(v, TARGET_KEYS)) return 'has an unexpected key';
  if (!isValidSection(v.section)) return `unknown section "${String(v.section)}"`;
  if (!isValidNullableString(v.date_or_day)) return 'invalid date_or_day';
  if (!isValidNullableString(v.label)) return 'invalid label';
  if (!isValidFieldForSection(v.section, v.field)) return `field "${String(v.field)}" is not valid for section "${v.section}"`;
  return null;
}

function validateOperation(v: unknown, index: number): string | null {
  if (!isPlainObject(v)) return `operation ${index} is not an object`;
  const op = (v as Record<string, unknown>).op;

  if (op === 'assign' || op === 'unassign') {
    if (!hasOnlyKeys(v, ASSIGN_UNASSIGN_KEYS)) return `operation ${index} (${op}) has an unexpected key`;
    if (!isValidSection(v.section)) return `operation ${index}: unknown section "${String(v.section)}"`;
    if (!isValidNullableString(v.date_or_day)) return `operation ${index}: invalid date_or_day`;
    if (!isValidNullableString(v.label)) return `operation ${index}: invalid label`;
    if (!isValidFieldForSection(v.section, v.field)) return `operation ${index}: field "${String(v.field)}" is not valid for section "${v.section}"`;
    if (!isNonEmptyString(v.subject_name)) return `operation ${index}: subject_name must be a non-empty string`;
    if (v.reason !== undefined && typeof v.reason !== 'string') return `operation ${index}: reason must be a string if present`;
    return null;
  }

  if (op === 'replace') {
    if (!hasOnlyKeys(v, REPLACE_KEYS)) return `operation ${index} (replace) has an unexpected key`;
    if (!isValidSection(v.section)) return `operation ${index}: unknown section "${String(v.section)}"`;
    if (!isValidNullableString(v.date_or_day)) return `operation ${index}: invalid date_or_day`;
    if (!isValidNullableString(v.label)) return `operation ${index}: invalid label`;
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

// ---------------------------------------------------------------------
// Server-side request-context allowlisting (2026-08-30 production-
// readiness review, Section B). Privacy of what reaches the model must be
// enforced HERE, not merely by the browser client's own (correct, but
// unenforceable-server-side) convention of only sending display_name/
// category. Explicit deterministic field picking, never generic recursive
// sanitization: every function below reads ONLY the exact named fields it
// expects off an `unknown` input and builds a brand-new, exactly-shaped
// object -- an unexpected/extra key on the caller's payload (resident_code,
// email, an auth uid, a raw workforce_id/tenant_id/admin_access_code
// echoed back, a nested object, a function, anything) is never copied
// forward because nothing here ever spreads or forwards the input object
// itself. A value that fails its own type/shape check is simply omitted
// (an invalid roster_context row) or the whole entry is dropped (an
// invalid workforce_context entry), never coerced or passed through.
//
// Lives here (not index.ts) for the same zero-Deno-dependency reason the
// rest of this file does -- so scripts/verify-roster-patch-proposal.ts can
// import and test these exact functions directly under Node/tsx.
// ---------------------------------------------------------------------

export interface RosterContextRow {
  section: RosterSection;
  row_index: number;
  date_or_day: string | null;
  label: string | null;
  current: Partial<Record<RosterPatchField, string[] | null>>;
}

export interface WorkforceContextEntry {
  display_name: string;
  category: 'Registrar' | 'Senior Registrar' | 'Medical Officer';
}

const VALID_SECTIONS: RosterSection[] = ['gop', 'emergency', 'supervision', 'satellite'];
const VALID_CATEGORIES = ['Registrar', 'Senior Registrar', 'Medical Officer'] as const;

export function normalizeWorkforceContext(raw: unknown): WorkforceContextEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkforceContextEntry[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.display_name !== 'string' || !e.display_name.trim()) continue;
    if (typeof e.category !== 'string' || !(VALID_CATEGORIES as readonly string[]).includes(e.category)) continue;
    // Exactly these 2 fields, nothing else off `e` is ever read or copied --
    // any other key present on the caller's object (workforce_id,
    // resident_code, email, active, on_floor, category_id, anything) is
    // structurally impossible to smuggle through this object literal.
    out.push({ display_name: e.display_name.slice(0, 200), category: e.category as WorkforceContextEntry['category'] });
  }
  return out;
}

export function normalizeRosterContextRow(raw: unknown): RosterContextRow | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.section !== 'string' || !(VALID_SECTIONS as string[]).includes(r.section)) return null;
  const section = r.section as RosterSection;
  if (!Number.isInteger(r.row_index) || (r.row_index as number) < 0) return null;
  const date_or_day = typeof r.date_or_day === 'string' ? r.date_or_day.slice(0, 100) : null;
  const label = typeof r.label === 'string' ? r.label.slice(0, 100) : null;

  const validFields = VALID_FIELDS_BY_SECTION[section];
  const rawCurrent = (typeof r.current === 'object' && r.current !== null && !Array.isArray(r.current)) ? r.current as Record<string, unknown> : {};
  const current: Partial<Record<RosterPatchField, string[] | null>> = {};
  for (const field of validFields) {
    const value = rawCurrent[field];
    if (value === null) {
      current[field] = null;
    } else if (Array.isArray(value)) {
      // Plain display-name strings only -- an object/id/nested structure in
      // this array position is dropped, never forwarded.
      current[field] = value.filter((v): v is string => typeof v === 'string').map((v) => v.slice(0, 200));
    }
    // Any other shape (a bare string, a number, an object) for this field
    // is simply omitted from `current` -- never coerced, never forwarded.
  }

  // Exactly these 5 fields are ever constructed here, regardless of what
  // other keys `raw` actually carried.
  return { section, row_index: r.row_index as number, date_or_day, label, current };
}

export function normalizeRosterContext(raw: unknown): RosterContextRow[] {
  if (!Array.isArray(raw)) return [];
  const out: RosterContextRow[] = [];
  for (const entry of raw) {
    const normalized = normalizeRosterContextRow(entry);
    if (normalized) out.push(normalized);
  }
  return out;
}

export function normalizeSectionLabels(raw: unknown): Partial<Record<RosterSection, string>> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const out: Partial<Record<RosterSection, string>> = {};
  for (const section of VALID_SECTIONS) {
    const value = r[section];
    if (typeof value === 'string' && value.trim()) out[section] = value.slice(0, 100);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
