// Exact-match name -> workforce_id resolution for parsed roster text
// (September Ingestion Slice 1, 2026-08-25). Zero-dependency by design —
// only imports the WorkforceMember type — so it can be exercised by the
// plain-tsx dependency-free verify harness, same reasoning as
// satelliteFacilities.ts and dayHeaderParsing.ts.
//
// NOT wired into any ingestion/admin-editing/publish path in this slice —
// this is a standalone, pure function only. Deliberately conservative:
// exact string match after narrow, harmless-presentation-only
// normalization. No fuzzy matching, no edit distance, no surname-only
// substring guessing, no automatic mapping of unmatched (consultant/
// free-text) names to any resident, no inferred identity from position in
// the roster, no persistent aliasing, no new schema. A name that cannot be
// resolved to exactly one workforce member is left unresolved (or flagged
// ambiguous) for a human to reconcile later — never guessed.

import { WorkforceMember } from '../../../types';

export type IdentityResolution =
  | { status: 'resolved'; workforceId: string }
  | { status: 'unresolved' }
  | { status: 'ambiguous'; candidateWorkforceIds: string[] };

// Normalization is intentionally narrow: whitespace trimming/collapsing
// and a leading "Dr"/"Dr."/"DR" prefix are the only "harmless presentation
// differences" the real source documents actually show (confirmed during
// DISCOVER — e.g. "Dr Onigbinde" in the Floor roster vs however
// workforce.full_name happens to be stored). Applied identically to both
// the parsed name and each workforce member's full_name, so either side
// having or lacking the prefix still compares correctly. Comparison itself
// is case-insensitive, matching this module's existing exact-match
// (never fuzzy) convention elsewhere in roster-engine.
function normalizeForComparison(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^dr\.?\s+/i, '')
    .toLowerCase();
}

// Resolves a single parsed roster name against the current workforce
// collection. Pure: never mutates `workforce`, never performs a lookup or
// network/database call. Callers are expected to pass in whichever
// workforce collection is appropriate for the caller's own scope (this
// function does not itself filter by `active` or `tenant_id` — same
// as-given convention already used by rosterReconciliation.ts).
export function resolveParsedNameToWorkforceId(
  parsedName: string,
  workforce: WorkforceMember[]
): IdentityResolution {
  const normalizedParsed = normalizeForComparison(parsedName);
  if (!normalizedParsed) return { status: 'unresolved' };

  const matches = workforce.filter(m => normalizeForComparison(m.full_name) === normalizedParsed);

  if (matches.length === 0) return { status: 'unresolved' };
  if (matches.length === 1) return { status: 'resolved', workforceId: matches[0].id };
  return { status: 'ambiguous', candidateWorkforceIds: matches.map(m => m.id) };
}
