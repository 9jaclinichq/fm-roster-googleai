// Applies Slice 1's exact-match identity resolver to freshly-parsed roster
// grids at the exact seam MultiRosterManagerView.tsx's handleIngest calls
// into (September Ingestion Slice 2, 2026-08-25). Zero-dependency by
// design — only imports types and identityResolver.ts — so it can be
// exercised by the plain-tsx dependency-free verify harness, same
// reasoning as satelliteFacilities.ts/dayHeaderParsing.ts/identityResolver.ts.
//
// This is metadata enrichment, not roster correction: every function here
// is pure (never mutates its `grid` argument, always returns a new object)
// and only ever ADDS a workforce_id association for a name that resolves
// to exactly one workforce member. It never invents, removes, or changes
// an assignment, date, duty, or the roster's own original display text.
//
// Two different, deliberate strategies, matched to how each grid already
// stores names (confirmed during DISCOVER against the live
// MultiRosterManagerView.tsx and migration 67):
//
// - GOP clinic slots have a genuine dual-array shape: `consultants` (the
//   roster's raw parsed display text, never auto-populated with
//   residents) and `residents` (a workforce_id array, populated today only
//   by manual drag/tap-assign — see assignToGopSlot). Resolution ADDS a
//   resolved id to `residents` alongside the untouched `consultants` text,
//   exactly mirroring what a manual drag would have done — `consultants`
//   is never read from again after computing the resolution, so the
//   roster's original text is byte-for-byte preserved regardless of
//   outcome.
//
// - A&E `on_call` and Satellite `assigned` have only ONE array each, which
//   already mixes raw parsed text (pre-drag) and workforce_id (post-drag)
//   in the same array — confirmed by MultiRosterManagerView.tsx's
//   `residentName(id) => workforce.find(w => w.id === id)?.full_name ||
//   id`, which already falls back to displaying the raw string itself for
//   any entry that isn't a known workforce id. Replacing a resolved
//   entry's raw text with its id in place is therefore safe (the UI keeps
//   rendering a human-readable name, now derived from the workforce
//   record instead of stored verbatim) — ambiguous/unresolved entries are
//   left completely untouched, so their original text survives exactly.
//
// Ambiguous names are additionally surfaced via each grid's own,
// already-rendered `unparsed_notes` "Needs manual review" list — the
// LOCKED IDENTITY BEHAVIOR spec's "clearly mark/route it as needing human
// reconciliation," using an existing UI surface rather than inventing a
// new one. Unresolved names get no note: that is the expected, common
// case (consultants/external/free-text participants) and was already
// silently preserved before this slice.
//
// afternoon_supervision (SupervisionGrid) is deliberately NOT handled
// here. MultiRosterManagerView.tsx's assignToSupervisionDuty stores
// `residentName(residentId)` — a NAME STRING — into first_on_duty /
// second_on_duty, and migration 67's resident_get_current_assignment()
// matches that grid by full_name STRING EQUALITY ONLY, never workforce_id.
// Writing a resolved id into those fields would silently break, not
// establish, My Assignment compatibility for Supervision — a genuine
// structural limitation of that grid's data model (already flagged as an
// explicit non-goal in migration 67's own header), not something this
// slice introduces or is scoped to fix.

import {
  GopClinicGrid,
  EmergencyCallGrid,
  SatelliteGrid,
  WorkforceMember,
} from '../../../types';
import { resolveParsedNameToWorkforceId, resolveParsedNamesToWorkforceIds } from './identityResolver';

function ambiguousNote(name: string): string {
  return `Ambiguous name "${name}": matches multiple workforce members — needs manual reconciliation.`;
}

export function applyIdentityResolutionToGopGrid(grid: GopClinicGrid, workforce: WorkforceMember[]): GopClinicGrid {
  const extraNotes: string[] = [];
  const slots = grid.slots.map(slot => {
    // consultant_gop slots have no `residents` seam at all — nothing to
    // resolve into, and consultants[] there is Pipeline B's authoritative,
    // untouched content.
    if (!slot.residents) return slot;

    const { resolvedWorkforceIds, ambiguousNames } = resolveParsedNamesToWorkforceIds(slot.consultants, workforce);
    ambiguousNames.forEach(name => extraNotes.push(ambiguousNote(name)));

    if (!resolvedWorkforceIds.length) return slot;
    const residents = [...slot.residents];
    for (const id of resolvedWorkforceIds) {
      if (!residents.includes(id)) residents.push(id);
    }
    return { ...slot, residents };
  });

  return { slots, unparsed_notes: [...grid.unparsed_notes, ...extraNotes] };
}

export function applyIdentityResolutionToEmergencyGrid(grid: EmergencyCallGrid, workforce: WorkforceMember[]): EmergencyCallGrid {
  const extraNotes: string[] = [];
  const shifts = grid.shifts.map(shift => ({
    ...shift,
    on_call: shift.on_call.map(name => {
      const result = resolveParsedNameToWorkforceId(name, workforce);
      if (result.status === 'ambiguous') extraNotes.push(ambiguousNote(name));
      return result.status === 'resolved' ? result.workforceId : name;
    }),
  }));

  return { shifts, unparsed_notes: [...grid.unparsed_notes, ...extraNotes] };
}

export function applyIdentityResolutionToSatelliteGrid(grid: SatelliteGrid, workforce: WorkforceMember[]): SatelliteGrid {
  const extraNotes: string[] = [];
  const postings = grid.postings.map(posting => ({
    ...posting,
    assigned: posting.assigned.map(name => {
      const result = resolveParsedNameToWorkforceId(name, workforce);
      if (result.status === 'ambiguous') extraNotes.push(ambiguousNote(name));
      return result.status === 'resolved' ? result.workforceId : name;
    }),
  }));

  return { postings, unparsed_notes: [...grid.unparsed_notes, ...extraNotes] };
}
