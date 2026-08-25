// GOP clinic-type line matching, extracted from uchRosterParser.ts (Slice
// 2B, 2026-08-25) for the same reason satelliteFacilities.ts/
// dayHeaderParsing.ts/identityResolver.ts were extracted: uchRosterParser.ts
// transitively imports databaseService.ts, whose Vite-only import.meta.env
// crashes under the plain-tsx dependency-free verify harness. Pure
// relocation — the patterns/order are unchanged from the pre-Slice-2B file,
// plus the one new Floor Clinic entry this slice adds.
//
// `import type` for ClinicType is erased at compile time, so importing it
// from types.ts here never pulls in that file's runtime code (harmless
// regardless of what else types.ts contains).

import type { ClinicType } from '../../../types';

export const CLINIC_TYPE_PATTERNS: { type: ClinicType; pattern: RegExp }[] = [
  { type: 'Triage', pattern: /\btriage\b/i },
  { type: 'Male Sorting', pattern: /\bmale\s*sorting\b/i },
  { type: 'Female Sorting', pattern: /\bfemale\s*sorting\b/i },
  { type: 'Children Sorting', pattern: /\bchildren'?s?\s*sorting\b/i },
  // The real final Combined Floor roster has a "Floor Clinic" column that
  // this list never recognized, so every Floor Clinic line silently fell
  // into unparsed_notes instead of becoming a structured slot (found by
  // the September dry-run preflight). Matched before Managed Care/Annexe
  // since neither of those patterns overlaps it.
  { type: 'Floor Clinic', pattern: /\bfloor\s*clinic\b/i },
  { type: 'Managed Care', pattern: /\bmanaged\s*care\b/i },
  { type: 'Annexe', pattern: /\bannex(e)?\b/i },
];
