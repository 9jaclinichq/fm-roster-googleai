import { supabase, DEFAULT_TENANT_ID } from '../databaseService';
import {
  RosterTypeId,
  RosterParseResult,
  GopClinicGrid,
  GopClinicSlot,
  ClinicType,
  EmergencyCallGrid,
  EmergencyShift,
  SupervisionGrid,
  SupervisionDuty,
  SatelliteGrid,
  SatellitePosting,
  WorkforceMember,
} from '../../types';

// Structures raw UCH Family Medicine roster documents (pasted text, or
// text extracted from an uploaded file) into the grid shapes used by
// MultiRosterManagerView.tsx. Tries the `roster-parser` Supabase Edge
// Function first (real LLM structuring, same OpenAI->Gemini chain as
// dissertation-copilot); falls back to a deterministic heuristic parser if
// the function isn't deployed/configured or fails for any reason.
//
// Both paths are Human-In-The-Loop by design: neither invents a resident,
// consultant, date, or assignment that isn't in the source text. Anything
// that can't be confidently parsed goes into `unparsed_notes` for the
// Chief to resolve by hand in the merge grid — this parser structures
// what the document says, it does not decide who works where.

const KNOWN_SATELLITE_FACILITIES = ['Ikolaba', 'Agbeke Mercy', 'Airport PHC', 'NYSC', 'Otunba Tunwase'];

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function splitNames(text: string): string[] {
  return text
    .split(/,|&|\band\b|;/i)
    .map(s => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i);
}

// A line is treated as a new "day" section header if it starts with a day
// name or looks like a date (e.g. "12/08", "August 12", "12th August").
function extractDayHeader(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const dayMatch = DAY_NAMES.find(d => new RegExp(`^${d}`, 'i').test(trimmed));
  if (dayMatch) return trimmed.replace(/[:\-]\s*$/, '');

  if (/^\d{1,2}[/\-]\d{1,2}([/\-]\d{2,4})?$/.test(trimmed)) return trimmed;
  if (/^\d{1,2}(st|nd|rd|th)?\s+[A-Za-z]+(\s+\d{4})?$/i.test(trimmed)) return trimmed.replace(/[:\-]\s*$/, '');

  return null;
}

function groupByDay(rawText: string): { day: string; lines: string[] }[] {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const groups: { day: string; lines: string[] }[] = [];
  let current: { day: string; lines: string[] } | null = null;

  for (const line of lines) {
    const header = extractDayHeader(line);
    if (header) {
      current = { day: header, lines: [] };
      groups.push(current);
    } else if (current) {
      current.lines.push(line);
    } else {
      // No day header seen yet — bucket under an "Unspecified" group so
      // nothing is silently dropped.
      if (!groups.length || groups[0].day !== 'Unspecified') {
        current = { day: 'Unspecified', lines: [] };
        groups.unshift(current);
      }
      current!.lines.push(line);
    }
  }
  return groups;
}

const CLINIC_TYPE_PATTERNS: { type: ClinicType; pattern: RegExp }[] = [
  { type: 'Triage', pattern: /\btriage\b/i },
  { type: 'Male Sorting', pattern: /\bmale\s*sorting\b/i },
  { type: 'Female Sorting', pattern: /\bfemale\s*sorting\b/i },
  { type: 'Children Sorting', pattern: /\bchildren'?s?\s*sorting\b/i },
  { type: 'Managed Care', pattern: /\bmanaged\s*care\b/i },
  { type: 'Annexe', pattern: /\bannex(e)?\b/i },
];

function parseGopLines(lines: string[], day: string, includeResidents: boolean, unparsed: string[]): GopClinicSlot[] {
  const slots: GopClinicSlot[] = [];
  for (const line of lines) {
    const match = CLINIC_TYPE_PATTERNS.find(c => c.pattern.test(line));
    if (!match) {
      unparsed.push(`[${day}] ${line}`);
      continue;
    }
    const afterLabel = line.replace(match.pattern, '').replace(/^[:\-\s]+/, '').trim();
    const names = splitNames(afterLabel);
    const slot: GopClinicSlot = { date_or_day: day, clinic_type: match.type, consultants: names };
    if (includeResidents) slot.residents = [];
    slots.push(slot);
  }
  return slots;
}

function parseEmergencyLines(lines: string[], day: string, unparsed: string[]): EmergencyShift[] {
  const shifts: EmergencyShift[] = [];
  for (const line of lines) {
    const isEvening = /4\s*pm.{0,4}10\s*pm|16:?00.{0,4}22:?00/i.test(line);
    const isNight = /10\s*pm.{0,4}8\s*am|22:?00.{0,4}0?8:?00/i.test(line);
    if (!isEvening && !isNight) {
      unparsed.push(`[${day}] ${line}`);
      continue;
    }
    const afterLabel = line.replace(/4\s*pm.{0,4}10\s*pm|16:?00.{0,4}22:?00|10\s*pm.{0,4}8\s*am|22:?00.{0,4}0?8:?00/i, '').replace(/^[:\-\s]+/, '').trim();
    shifts.push({ date_or_day: day, shift: isEvening ? '4pm-10pm' : '10pm-8am', on_call: splitNames(afterLabel) });
  }
  return shifts;
}

function parseSupervisionLines(lines: string[], day: string, unparsed: string[]): SupervisionDuty[] {
  let first: string | null = null;
  let second: string | null = null;
  let matchedAny = false;

  for (const line of lines) {
    const firstMatch = line.match(/1st\s*(on[\s-]?(duty|call))?\s*[:\-]?\s*(.+)/i);
    const secondMatch = line.match(/2nd\s*(on[\s-]?(duty|call))?\s*[:\-]?\s*(.+)/i);
    if (firstMatch) {
      first = firstMatch[3].trim();
      matchedAny = true;
    } else if (secondMatch) {
      second = secondMatch[3].trim();
      matchedAny = true;
    } else {
      unparsed.push(`[${day}] ${line}`);
    }
  }

  return matchedAny ? [{ date_or_day: day, first_on_duty: first, second_on_duty: second }] : [];
}

function parseSatelliteLines(lines: string[], day: string, unparsed: string[]): SatellitePosting[] {
  const postings: SatellitePosting[] = [];
  for (const line of lines) {
    const facility = KNOWN_SATELLITE_FACILITIES.find(f => line.toLowerCase().includes(f.toLowerCase()));
    if (!facility) {
      unparsed.push(`[${day}] ${line}`);
      continue;
    }
    const afterLabel = line.replace(new RegExp(facility, 'i'), '').replace(/^[:\-\s]+/, '').trim();
    postings.push({ facility, date_or_day: day === 'Unspecified' ? null : day, assigned: splitNames(afterLabel) });
  }
  return postings;
}

function heuristicParseGop(text: string, includeResidents: boolean): GopClinicGrid {
  const unparsed_notes: string[] = [];
  const slots: GopClinicSlot[] = [];
  for (const { day, lines } of groupByDay(text)) {
    slots.push(...parseGopLines(lines, day, includeResidents, unparsed_notes));
  }
  return { slots, unparsed_notes };
}

function heuristicParseEmergency(text: string): EmergencyCallGrid {
  const unparsed_notes: string[] = [];
  const shifts: EmergencyShift[] = [];
  for (const { day, lines } of groupByDay(text)) {
    shifts.push(...parseEmergencyLines(lines, day, unparsed_notes));
  }
  return { shifts, unparsed_notes };
}

function heuristicParseSupervision(text: string): SupervisionGrid {
  const unparsed_notes: string[] = [];
  const duties: SupervisionDuty[] = [];
  for (const { day, lines } of groupByDay(text)) {
    duties.push(...parseSupervisionLines(lines, day, unparsed_notes));
  }
  return { duties, unparsed_notes };
}

function heuristicParseSatellite(text: string): SatelliteGrid {
  const unparsed_notes: string[] = [];
  const postings: SatellitePosting[] = [];
  for (const { day, lines } of groupByDay(text)) {
    postings.push(...parseSatelliteLines(lines, day, unparsed_notes));
  }
  return { postings, unparsed_notes };
}

// Quota-exceeded (migration 11) is treated the same as any other Edge
// Function failure — falls through to the heuristic parser, consistent
// with academicCopilot.ts's identical choice not to surface a distinct
// paywall UI state in this pass.
async function callRosterParserEdgeFunction<T>(rosterType: RosterTypeId, text: string): Promise<{ data: T; provider: 'openai' | 'gemini' } | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('roster-parser', {
      body: { roster_type: rosterType, text, tenant_id: DEFAULT_TENANT_ID },
    });
    if (error) {
      console.warn(`Edge Function roster-parser (${rosterType}) failed, using heuristic fallback:`, error.message);
      return null;
    }
    if (!data || data.error || !data.result) {
      if (data?.error) console.warn(`Edge Function roster-parser (${rosterType}) returned an error, using heuristic fallback:`, data.error);
      return null;
    }
    return { data: data.result as T, provider: data.provider };
  } catch (err) {
    console.warn(`Edge Function roster-parser (${rosterType}) threw, using heuristic fallback:`, err);
    return null;
  }
}

export async function parseConsultantGop(text: string): Promise<RosterParseResult<GopClinicGrid>> {
  const edge = await callRosterParserEdgeFunction<GopClinicGrid>('consultant_gop', text);
  if (edge) return { data: edge.data, source: 'edge_function', provider: edge.provider };
  return { data: heuristicParseGop(text, false), source: 'heuristic_fallback' };
}

export async function parseCombinedGop(text: string): Promise<RosterParseResult<GopClinicGrid>> {
  const edge = await callRosterParserEdgeFunction<GopClinicGrid>('combined_gop', text);
  if (edge) return { data: edge.data, source: 'edge_function', provider: edge.provider };
  return { data: heuristicParseGop(text, true), source: 'heuristic_fallback' };
}

export async function parseEmergencyRoster(text: string): Promise<RosterParseResult<EmergencyCallGrid>> {
  const edge = await callRosterParserEdgeFunction<EmergencyCallGrid>('accident_emergency', text);
  if (edge) return { data: edge.data, source: 'edge_function', provider: edge.provider };
  return { data: heuristicParseEmergency(text), source: 'heuristic_fallback' };
}

export async function parseSupervisionRoster(text: string): Promise<RosterParseResult<SupervisionGrid>> {
  const edge = await callRosterParserEdgeFunction<SupervisionGrid>('afternoon_supervision', text);
  if (edge) return { data: edge.data, source: 'edge_function', provider: edge.provider };
  return { data: heuristicParseSupervision(text), source: 'heuristic_fallback' };
}

export async function parseSatelliteRoster(text: string): Promise<RosterParseResult<SatelliteGrid>> {
  const edge = await callRosterParserEdgeFunction<SatelliteGrid>('satellite_outreach', text);
  if (edge) return { data: edge.data, source: 'edge_function', provider: edge.provider };
  return { data: heuristicParseSatellite(text), source: 'heuristic_fallback' };
}

// Attaches an empty, ready-to-fill `residents` slot to every clinic slot
// that doesn't already have one (e.g. after parsing a consultant_gop-only
// document) so the merge grid has a place for the Chief to drag on-floor
// residents into. This does NOT decide who goes where — it only creates
// the structure. `onFloorResidents` is accepted as a parameter (rather
// than fetched here) so callers control exactly which resident list is
// considered "available" at merge time.
export function prepareGridForResidentAssignment(grid: GopClinicGrid, _onFloorResidents: WorkforceMember[]): GopClinicGrid {
  return {
    ...grid,
    slots: grid.slots.map(slot => ({ ...slot, residents: slot.residents ?? [] })),
  };
}
