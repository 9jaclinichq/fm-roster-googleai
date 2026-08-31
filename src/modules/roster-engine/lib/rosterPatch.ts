// Structured Chief roster editing — deterministic patch contract
// (assign / replace / unassign only, per
// WORKSPC_CHIEF_STRUCTURED_ROSTER_EDITING_DISCOVER_AND_PLAN_2026-08-28.md
// §2-3). This is the CORE INVARIANT the design doc calls out: a manual
// UI edit and a future AI-proposed edit must both produce this exact
// same RosterPatchOperation[] shape and flow through this exact same
// apply/validate function — nothing here knows or cares where a patch
// came from.
//
// ADDRESSING INVARIANT (explicit, load-bearing): row_index addressing is
// safe ONLY because this slice never inserts/deletes/reorders a row.
// applyRosterPatch() asserts every one of the 4 section arrays has the
// EXACT SAME LENGTH after applying as before, and never touches any row
// field other than the targeted assignee field — see the length/shape
// assertions at the end of applyRosterPatch(). A future slice that adds
// add/remove-slot must introduce a stable slot_id before it can safely
// coexist with row-index-addressed operations like these.
//
// NOT a fake universal slot abstraction: GOP has TWO independent
// assignee-bearing fields (consultants, residents) per row, A&E/
// Satellite have one each (on_call, assigned), and Supervision has two
// independent SCALAR fields (first_on_duty, second_on_duty) rather than
// an array. The `field` discriminator exists specifically so these are
// never collapsed into one generic "the slot's assignee."
import type { GopClinicGrid, EmergencyCallGrid, SupervisionGrid, SatelliteGrid, WorkforceMember } from '../../../types';
import { normalizeForComparison } from './identityResolver';

export type RosterSection = 'gop' | 'emergency' | 'supervision' | 'satellite';
export type ArrayAssigneeField = 'consultants' | 'residents' | 'on_call' | 'assigned';
export type SupervisionField = 'first_on_duty' | 'second_on_duty';
export type RosterPatchField = ArrayAssigneeField | SupervisionField;

export interface RosterPatchOperationAssign {
  op: 'assign';
  section: RosterSection;
  row_index: number;
  field: RosterPatchField;
  workforce_id: string;
  reason?: string;
}
export interface RosterPatchOperationReplace {
  op: 'replace';
  section: RosterSection;
  row_index: number;
  field: RosterPatchField;
  from_workforce_id: string;
  to_workforce_id: string;
  reason?: string;
}
export interface RosterPatchOperationUnassign {
  op: 'unassign';
  section: RosterSection;
  row_index: number;
  field: RosterPatchField;
  // Required for array-valued fields (which entry to remove). For
  // Supervision's scalar fields this still names who the Chief believes
  // currently occupies the field — required so a mismatch is REJECTED
  // rather than silently clearing whoever the concurrent live value
  // actually is (reject ambiguous operations rather than guessing).
  workforce_id: string;
  reason?: string;
}
export type RosterPatchOperation = RosterPatchOperationAssign | RosterPatchOperationReplace | RosterPatchOperationUnassign;

export interface RosterGrids {
  gop_clinic_grid: GopClinicGrid;
  emergency_call_grid: EmergencyCallGrid;
  supervision_grid: SupervisionGrid;
  satellite_grid: SatelliteGrid;
}

export interface PatchOperationDiff {
  operation: RosterPatchOperation;
  dateOrDay: string | null;
  fieldLabel: string;
  removedName: string | null;
  addedName: string | null;
}

export interface PatchOperationError {
  operation: RosterPatchOperation;
  message: string;
}

export interface ApplyPatchResult {
  grids: RosterGrids;
  diffs: PatchOperationDiff[];
  errors: PatchOperationError[];
}

const ARRAY_FIELDS_BY_SECTION: Record<RosterSection, RosterPatchField[]> = {
  gop: ['consultants', 'residents'],
  emergency: ['on_call'],
  satellite: ['assigned'],
  supervision: ['first_on_duty', 'second_on_duty'],
};

const SUPERVISION_SCALAR_FIELDS: RosterPatchField[] = ['first_on_duty', 'second_on_duty'];

export function fieldLabelFor(field: RosterPatchField): string {
  switch (field) {
    case 'consultants': return 'Consultants';
    case 'residents': return 'Residents';
    case 'on_call': return 'On Call';
    case 'assigned': return 'Assigned';
    case 'first_on_duty': return '1st On Duty';
    case 'second_on_duty': return '2nd On Duty';
    default: return field;
  }
}

// Human-readable row label for the UI's row picker — generic across
// sections, never presuming which field carries the "service point"
// text.
export function rowLabelFor(section: RosterSection, row: unknown): string {
  const r = row as Record<string, unknown>;
  const dateOrDay = (r.date_or_day as string | null) ?? 'Unspecified date';
  switch (section) {
    case 'gop': return `${dateOrDay} — ${r.clinic_type as string}`;
    case 'emergency': return `${dateOrDay} — ${r.shift as string}`;
    case 'satellite': return `${dateOrDay} — ${r.facility as string}`;
    case 'supervision': return `${dateOrDay}`;
  }
}

// The bare semantic "service point" label component alone (clinic_type /
// shift / facility), never combined with date_or_day like rowLabelFor()
// above -- this is the SAME field name/semantics the Roster AI context
// builder (buildRosterProposalContext in MultiRosterManagerView.tsx) and
// the deterministic location resolver (resolveSymbolicRosterTarget in
// rosterPatchProposalCompiler.ts) both use as one half of a roster row's
// location identity (the other half being date_or_day). Sharing this one
// function between "what we tell the model" and "how we resolve what it
// says back" is load-bearing: if those two ever computed the label
// differently, semantic location matching would silently never match
// anything (or, worse, match the wrong row) -- see
// resolveSymbolicRosterTarget()'s own header for the full invariant this
// protects (2026-09-01, WRONG_ROSTER_ROW_TARGETING WITH_VALID_PROPOSAL).
// null for 'supervision' -- date_or_day alone is already a unique row key
// for that section (confirmed: SupervisionDuty carries no other
// row-distinguishing field, src/types.ts).
export function rowSemanticLabelFor(section: RosterSection, row: unknown): string | null {
  const r = row as Record<string, unknown>;
  switch (section) {
    case 'gop': return (r.clinic_type as string | undefined) ?? null;
    case 'emergency': return (r.shift as string | undefined) ?? null;
    case 'satellite': return (r.facility as string | undefined) ?? null;
    case 'supervision': return null;
  }
}

export function fieldsForSection(section: RosterSection): RosterPatchField[] {
  return ARRAY_FIELDS_BY_SECTION[section];
}

export function rowsForSection(grids: RosterGrids, section: RosterSection): unknown[] {
  switch (section) {
    case 'gop': return grids.gop_clinic_grid.slots;
    case 'emergency': return grids.emergency_call_grid.shifts;
    case 'satellite': return grids.satellite_grid.postings;
    case 'supervision': return grids.supervision_grid.duties;
  }
}

export function validWorkforceIdSet(workforce: WorkforceMember[]): Set<string> {
  return new Set(workforce.filter((w) => w.active).map((w) => w.id));
}

export function workforceNameMap(workforce: WorkforceMember[]): Map<string, string> {
  return new Map(workforce.map((w) => [w.id, w.full_name]));
}

// Exported so rosterRebase.ts can re-check identity validity against a
// freshly-fetched workforce list without duplicating this switch.
export function operationWorkforceIds(op: RosterPatchOperation): string[] {
  if (op.op === 'replace') return [op.from_workforce_id, op.to_workforce_id];
  return [op.workforce_id];
}

// Exported so rosterNetDiff.ts / rosterRebase.ts can read a specific
// operation's own target field value without re-deriving the
// scalar-vs-array distinction a second time.
export function isSupervisionScalarField(section: RosterSection, field: RosterPatchField): boolean {
  return section === 'supervision' && SUPERVISION_SCALAR_FIELDS.includes(field);
}

// Deep-clones the 4 grids (so a caller always gets a fresh object it can
// diff against the original, and so a failed operation never partially
// mutates shared state), sequentially applies each operation (structural
// + identity validated per-operation, invalid ones rejected and
// skipped — never guessed), and returns the resulting grids plus a
// per-operation human-readable diff list and a per-operation error list.
export function applyRosterPatch(
  grids: RosterGrids,
  operations: RosterPatchOperation[],
  workforce: WorkforceMember[]
): ApplyPatchResult {
  const working: RosterGrids = JSON.parse(JSON.stringify(grids));
  const validIds = validWorkforceIdSet(workforce);
  const nameById = workforceNameMap(workforce);
  const diffs: PatchOperationDiff[] = [];
  const errors: PatchOperationError[] = [];

  // Duplicate-operation guard: two operations in the same batch that are
  // byte-identical are rejected rather than silently applied twice.
  const seenSignatures = new Set<string>();

  const originalLengths = {
    gop: grids.gop_clinic_grid.slots.length,
    emergency: grids.emergency_call_grid.shifts.length,
    satellite: grids.satellite_grid.postings.length,
    supervision: grids.supervision_grid.duties.length,
  };

  for (const operation of operations) {
    const signature = JSON.stringify(operation);
    if (seenSignatures.has(signature)) {
      errors.push({ operation, message: 'Duplicate operation — already queued once in this batch.' });
      continue;
    }
    seenSignatures.add(signature);

    const { section, row_index, field } = operation;

    if (!ARRAY_FIELDS_BY_SECTION[section] || !ARRAY_FIELDS_BY_SECTION[section].includes(field)) {
      errors.push({ operation, message: `Field "${field}" is not valid for section "${section}".` });
      continue;
    }

    const rows = rowsForSection(working, section) as Array<Record<string, unknown>>;
    if (!Number.isInteger(row_index) || row_index < 0 || row_index >= rows.length) {
      errors.push({ operation, message: `Row ${row_index} does not exist in section "${section}".` });
      continue;
    }

    const badWorkforceId = operationWorkforceIds(operation).find((id) => !validIds.has(id));
    if (badWorkforceId) {
      errors.push({ operation, message: `Workforce member "${badWorkforceId}" is not a recognized active member of this tenant.` });
      continue;
    }

    const row = rows[row_index];
    const dateOrDay = (row.date_or_day as string | null) ?? null;
    const isSupervisionScalar = section === 'supervision' && SUPERVISION_SCALAR_FIELDS.includes(field);

    if (isSupervisionScalar) {
      const currentName = (row[field] as string | null) ?? null;
      const currentNormalized = currentName ? normalizeForComparison(currentName) : null;

      if (operation.op === 'assign') {
        const newName = nameById.get(operation.workforce_id) as string;
        row[field] = newName;
        diffs.push({ operation, dateOrDay, fieldLabel: fieldLabelFor(field), removedName: currentName, addedName: newName });
      } else if (operation.op === 'replace') {
        const fromName = nameById.get(operation.from_workforce_id) as string;
        const toName = nameById.get(operation.to_workforce_id) as string;
        if (!currentName || currentNormalized !== normalizeForComparison(fromName)) {
          errors.push({ operation, message: `Cannot replace — "${fromName}" is not the current occupant of ${fieldLabelFor(field)} (found: ${currentName ?? 'nobody'}).` });
          continue;
        }
        row[field] = toName;
        diffs.push({ operation, dateOrDay, fieldLabel: fieldLabelFor(field), removedName: fromName, addedName: toName });
      } else {
        // unassign
        const expectedName = nameById.get(operation.workforce_id) as string;
        if (!currentName || currentNormalized !== normalizeForComparison(expectedName)) {
          errors.push({ operation, message: `Cannot unassign — "${expectedName}" is not the current occupant of ${fieldLabelFor(field)} (found: ${currentName ?? 'nobody'}).` });
          continue;
        }
        row[field] = null;
        diffs.push({ operation, dateOrDay, fieldLabel: fieldLabelFor(field), removedName: currentName, addedName: null });
      }
    } else {
      const arr = (row[field] as string[] | undefined) || [];

      if (operation.op === 'assign') {
        if (arr.includes(operation.workforce_id)) {
          errors.push({ operation, message: `${nameById.get(operation.workforce_id) ?? operation.workforce_id} is already assigned to ${fieldLabelFor(field)} on this row.` });
          continue;
        }
        row[field] = [...arr, operation.workforce_id];
        diffs.push({ operation, dateOrDay, fieldLabel: fieldLabelFor(field), removedName: null, addedName: nameById.get(operation.workforce_id) ?? operation.workforce_id });
      } else if (operation.op === 'replace') {
        if (!arr.includes(operation.from_workforce_id)) {
          errors.push({ operation, message: `Cannot replace — ${nameById.get(operation.from_workforce_id) ?? operation.from_workforce_id} is not currently assigned to ${fieldLabelFor(field)} on this row (may be stored as unresolved text — not addressable by workforce_id in this slice).` });
          continue;
        }
        if (arr.includes(operation.to_workforce_id)) {
          errors.push({ operation, message: `Cannot replace — ${nameById.get(operation.to_workforce_id) ?? operation.to_workforce_id} is already assigned to ${fieldLabelFor(field)} on this row.` });
          continue;
        }
        row[field] = arr.map((id) => (id === operation.from_workforce_id ? operation.to_workforce_id : id));
        diffs.push({ operation, dateOrDay, fieldLabel: fieldLabelFor(field), removedName: nameById.get(operation.from_workforce_id) ?? operation.from_workforce_id, addedName: nameById.get(operation.to_workforce_id) ?? operation.to_workforce_id });
      } else {
        // unassign
        if (!arr.includes(operation.workforce_id)) {
          errors.push({ operation, message: `Cannot unassign — ${nameById.get(operation.workforce_id) ?? operation.workforce_id} is not currently assigned to ${fieldLabelFor(field)} on this row.` });
          continue;
        }
        row[field] = arr.filter((id) => id !== operation.workforce_id);
        diffs.push({ operation, dateOrDay, fieldLabel: fieldLabelFor(field), removedName: nameById.get(operation.workforce_id) ?? operation.workforce_id, addedName: null });
      }
    }
  }

  // Addressing-invariant guard: this slice must never insert, delete, or
  // reorder a row. If any of these ever mismatch, something upstream
  // violated the invariant this whole design relies on — fail loudly
  // rather than silently returning corrupted structure.
  if (
    working.gop_clinic_grid.slots.length !== originalLengths.gop ||
    working.emergency_call_grid.shifts.length !== originalLengths.emergency ||
    working.satellite_grid.postings.length !== originalLengths.satellite ||
    working.supervision_grid.duties.length !== originalLengths.supervision
  ) {
    throw new Error('Internal error: applyRosterPatch mutated row count — this violates the row-index addressing invariant for this slice.');
  }

  return { grids: working, diffs, errors };
}
