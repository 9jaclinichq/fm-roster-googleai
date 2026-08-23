// Single source of truth for known UCH Family Medicine satellite outpost
// names, shared by uchRosterParser.ts (text parsing) and
// rosterReconciliation.ts (Option A read-only checks). Deliberately kept
// as its own zero-dependency file: uchRosterParser.ts imports the
// Supabase client (via databaseService.ts, which reads Vite-only
// `import.meta.env`), and rosterReconciliation.ts must stay importable
// under plain `tsx`/Node (scripts/verify-roster-reconciliation.ts runs it
// with no network/database, per docs/TESTING_AND_VERIFICATION.md) —
// importing uchRosterParser.ts directly from rosterReconciliation.ts was
// tried and confirmed to break that script (import.meta.env is undefined
// outside Vite).
export const KNOWN_SATELLITE_FACILITIES = ['Ikolaba', 'Agbeke Mercy', 'Airport PHC', 'NYSC', 'Otunba Tunwase'];
