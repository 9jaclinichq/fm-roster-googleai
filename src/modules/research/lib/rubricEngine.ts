import { ResearchTemplate } from '../../../types';

// Client-side mirror of supabase/functions/_shared/researchRubric.ts's
// validators, for the Real-Time Rubric Scorecard in ResearchWorkspaceView
// (live gauges as a resident types — no network round-trip per keystroke).
// Same "independent heuristic implementation, not shared code across the
// Vite/Deno boundary" pattern already used by academicCopilot.ts vs
// dissertation-copilot/index.ts's SYSTEM_PROMPTS. Keep both in sync by hand
// if the rubric rules change.

const DEFAULT_TITLE_MAX_WORDS = 25;
const DEFAULT_AFRICAN_LITERATURE_MIN_PCT = 25;
const AFRICAN_LITERATURE_ORGS = new Set(['WACP', 'NPMCN']);

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

export interface ValidationResult {
  valid: boolean;
  message: string;
}

export function validatePicoTitle(title: string, template: ResearchTemplate | null): ValidationResult {
  const maxWords = Number(template?.proposal_rubric?.title_max_words) || DEFAULT_TITLE_MAX_WORDS;
  const count = wordCount(title);
  if (count === 0) return { valid: false, message: 'Title is empty.' };
  if (count > maxWords) return { valid: false, message: `${count} words — exceeds the ${maxWords}-word limit.` };
  return { valid: true, message: `${count}/${maxWords} words.` };
}

export function validateWordCap(sectionKey: string, text: string, template: ResearchTemplate | null): ValidationResult {
  const limit = template?.word_count_limits?.[sectionKey];
  const count = wordCount(text);
  if (!limit) return { valid: true, message: `${count} words (no cap set for this section).` };
  if (count > limit) return { valid: false, message: `${count} words — exceeds the ${limit}-word cap.` };
  return { valid: true, message: `${count}/${limit} words.` };
}

const VANCOUVER_NUMBERED_LINE = /^\s*\d+\.\s+\S/;
const AFRICAN_LITERATURE_HINT = /\b(nigeria|ghana|kenya|south africa|uganda|tanzania|ethiopia|senegal|rwanda|zambia|cameroon|african journal|west african|pan african|niger delta|ibadan|lagos|accra|nairobi)\b/i;
const AUTHOR_YEAR_HINT = /\(\s*(19|20)\d{2}\s*[a-z]?\s*\)/;

export interface CitationValidationResult extends ValidationResult {
  africanLiteraturePct?: number;
}

export function validateCitationSyntax(referenceList: string, template: ResearchTemplate | null): CitationValidationResult {
  const lines = referenceList.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { valid: false, message: 'No references yet.' };

  const style = template?.referencing_style || 'vancouver';

  if (style === 'vancouver') {
    const malformed = lines.filter(l => !VANCOUVER_NUMBERED_LINE.test(l));
    if (malformed.length > 0) {
      return { valid: false, message: `${malformed.length} reference(s) aren't numbered Vancouver-style ("1. Author AB. Title...").` };
    }

    if (template && AFRICAN_LITERATURE_ORGS.has(template.organization_or_body)) {
      const minPct = Number(template.proposal_rubric?.min_african_literature_pct) || DEFAULT_AFRICAN_LITERATURE_MIN_PCT;
      const africanCount = lines.filter(l => AFRICAN_LITERATURE_HINT.test(l)).length;
      const pct = Math.round((africanCount / lines.length) * 100);
      if (pct < minPct) {
        return { valid: false, message: `~${pct}% African-sourced — ${template.organization_or_body} requires ${minPct}%+.`, africanLiteraturePct: pct };
      }
      return { valid: true, message: `Vancouver OK. ~${pct}% African-sourced.`, africanLiteraturePct: pct };
    }

    return { valid: true, message: 'Vancouver numbered format OK.' };
  }

  const malformed = lines.filter(l => !AUTHOR_YEAR_HINT.test(l));
  if (malformed.length > 0) {
    return { valid: false, message: `${malformed.length} reference(s) don't show a clear "(Author, Year)" pattern.` };
  }
  return { valid: true, message: `${style.toUpperCase()} author-year format OK.` };
}
