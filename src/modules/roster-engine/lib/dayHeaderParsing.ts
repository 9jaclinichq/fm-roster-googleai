// Day-header recognition for pasted/uploaded UCH Family Medicine roster
// text — extracted out of uchRosterParser.ts (September Ingestion Slice 1,
// 2026-08-25) into its own zero-dependency file for the same reason
// satelliteFacilities.ts exists: uchRosterParser.ts imports the Supabase
// client (via databaseService.ts, which reads Vite-only import.meta.env),
// so anything meant to be exercised by the plain-tsx dependency-free
// verify harness (scripts/verify-roster-reconciliation.ts) must live
// somewhere that file can import without pulling that in. Confirmed by
// the same failure mode found and fixed in the prior slice.
//
// A line is treated as a new "day" section header if it starts with a
// full day name, a bare numeric date, an ordinal-plus-month-name, an
// abbreviated day name plus a numeric date, or an ordinal day-of-month
// with a parenthesized abbreviated day name. Deterministic only — no
// fuzzy matching, no invented dates. Every new format added here was
// confirmed present in the actual September/August source documents
// during DISCOVER, not guessed.

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Longest-to-shortest days-per-month, permissive on February (29, the
// leap-year bound) since no month/year context reaches this function —
// rejecting a real Feb 29 in a leap year would be worse than occasionally
// accepting one in a non-leap year. This only rejects genuinely impossible
// combinations (e.g. 30 February, 31 April), not ambiguous ones.
const MAX_DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isPlausibleDayMonth(dayStr: string, monthStr: string): boolean {
  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10);
  if (!(month >= 1 && month <= 12)) return false;
  return day >= 1 && day <= MAX_DAYS_IN_MONTH[month - 1];
}

// Matches `token` as a case-insensitive abbreviation of one of the 7 day
// names — i.e. the full day name starts with `token` — rather than a
// hardcoded list of specific abbreviations. This is why "Tue", "Thu", and
// the real source documents' inconsistent "THUR" (4 letters, seen in the
// August Priority roster) all resolve correctly without enumerating every
// variant. Minimum length 3 (never 2) specifically because every pair of
// day names is already unambiguous at 2 letters (Mo/Tu/We/Th/Fr/Sa/Su),
// but allowing a 2-letter match would make ordinary text starting with
// "We" or "Su" a false positive — exactly the "unrelated text" risk this
// function must avoid. Maximum length 4, since no real abbreviation seen
// exceeds that.
function matchDayAbbreviation(token: string): string | null {
  const lower = token.toLowerCase();
  if (lower.length < 3 || lower.length > 4) return null;
  return DAY_NAMES.find(d => d.toLowerCase().startsWith(lower)) ?? null;
}

export function extractDayHeader(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const dayMatch = DAY_NAMES.find(d => new RegExp(`^${d}`, 'i').test(trimmed));
  if (dayMatch) return trimmed.replace(/[:\-]\s*$/, '');

  if (/^\d{1,2}[/\-]\d{1,2}([/\-]\d{2,4})?$/.test(trimmed)) return trimmed;
  if (/^\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]+(\s+\d{4})?$/i.test(trimmed)) return trimmed.replace(/[:\-]\s*$/, '');

  // New (Slice 1, 2026-08-25): abbreviated day name + numeric date, e.g.
  // "Tue 01/09", "THUR 06/08/26" (both confirmed in the real source
  // documents). Requires the numeric part to be a plausible day/month
  // pair, not just any two numbers — rejects e.g. "Sat 15/20" (month 20)
  // rather than guessing, and never matches ordinary prose (the
  // 3-4-letter-then-whitespace-then-digit shape practically never occurs
  // outside a real date header, and the day-name-prefix + plausible-date
  // double check narrows it further).
  const abbrevDateMatch = trimmed.match(/^([A-Za-z]{3,4})\s+(\d{1,2})[/\-](\d{1,2})(?:[/\-]\d{2,4})?\b/);
  if (abbrevDateMatch) {
    const dayName = matchDayAbbreviation(abbrevDateMatch[1]);
    if (dayName && isPlausibleDayMonth(abbrevDateMatch[2], abbrevDateMatch[3])) {
      return trimmed.replace(/[:\-]\s*$/, '');
    }
  }

  // New (Slice 1, 2026-08-25): ordinal day-of-month + parenthesized
  // abbreviated day name, e.g. "1st (Tue)" (the real A&E document's own
  // format). The day-of-month is range-checked (1-31); the parenthesized
  // token must resolve to a real day-name abbreviation, same rule as above.
  const ordinalDayMatch = trimmed.match(/^(\d{1,2})(?:st|nd|rd|th)\s*\(([A-Za-z]{3,4})\)/i);
  if (ordinalDayMatch) {
    const dayOfMonth = parseInt(ordinalDayMatch[1], 10);
    const dayName = matchDayAbbreviation(ordinalDayMatch[2]);
    if (dayName && dayOfMonth >= 1 && dayOfMonth <= 31) {
      return trimmed.replace(/[:\-]\s*$/, '');
    }
  }

  return null;
}
