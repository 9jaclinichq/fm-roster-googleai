import { CasebookTemplate, PccmFramework } from '../../../types';

// Client-side mirror of supabase/functions/_shared/casebookRubric.ts's
// validators, for the Real-Time WACP 100-Point Scorecard in
// CasebookWorkspaceView (live gauges as a resident types — no network
// round-trip per keystroke). Same independent-implementation pattern as
// src/modules/research/lib/rubricEngine.ts vs. researchRubric.ts.

export interface ValidationResult {
  valid: boolean;
  message: string;
}

const VANCOUVER_NUMBERED_LINE = /^\s*\d+\.\s+\S/;
const FIGURE_STARTING_SENTENCE = /(^|[.!?]\s+)\s*\d+[\s,.]/;

export function validateReferenceFormatting(referencesText: string, template: CasebookTemplate | null): ValidationResult {
  const lines = referencesText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { valid: false, message: 'No references yet.' };

  const rules = template?.formatting_rules || {};

  if (rules.vancouver_references_required) {
    const malformed = lines.filter(l => !VANCOUVER_NUMBERED_LINE.test(l));
    if (malformed.length > 0) {
      return { valid: false, message: `${malformed.length} reference(s) aren't numbered Vancouver-style.` };
    }
  }

  const minReferences = Number(rules.min_references) || 0;
  if (minReferences && lines.length < minReferences) {
    return { valid: false, message: `${lines.length}/${minReferences} minimum references.` };
  }

  const maxAgeYears = Number(rules.max_reference_age_years) || 0;
  if (maxAgeYears) {
    const currentYear = new Date().getFullYear();
    const tooOld = lines.filter(l => {
      const match = l.match(/\b(19|20)\d{2}\b/);
      return match ? currentYear - Number(match[0]) > maxAgeYears : false;
    });
    if (tooOld.length > 0) {
      return { valid: false, message: `${tooOld.length} reference(s) older than ${maxAgeYears} years.` };
    }
  }

  return { valid: true, message: `${lines.length} references OK.` };
}

export function detectFigureStartingSentences(text: string): ValidationResult {
  if (!text.trim()) return { valid: true, message: 'No text yet.' };
  const matches = text.match(new RegExp(FIGURE_STARTING_SENTENCE, 'g')) || [];
  if (matches.length > 0) {
    return { valid: false, message: `${matches.length} sentence(s) start with a raw figure — spell out numbers.` };
  }
  return { valid: true, message: 'No sentences starting with a raw figure.' };
}

const PCCM_COMPONENTS = ['fife', 'common_ground', 'whole_person', 'health_promotion'] as const;

export function countPccmComponents(pccm: PccmFramework): ValidationResult {
  const filled = PCCM_COMPONENTS.filter(key => (pccm[key] || '').trim().length > 0).length;
  return {
    valid: filled === PCCM_COMPONENTS.length,
    message: `${filled}/${PCCM_COMPONENTS.length} PCCM components addressed.`,
  };
}

// Sums a case's rubric_scores against the active template's own
// scoring_rubric shape — a `steps` array means a pass/fail checklist (the
// WACP PMR-10 track today; any future template with the same shape gets the
// same treatment for free), a `domains` map means weighted points (WACP/
// NPMCN 15-Casebook tracks and the generic templates). The scoring MODE is
// determined by which shape the template's own data has, never by matching
// a specific framework_type name — see docs/LIVING_SYSTEM_GAP_AUDIT.md's
// addendum §8.1 for why this was hardcoded before (2026-08-17 fix,
// behavior-verified identical for every live template via
// .tmp-rubric-verify.cjs before merging).
export function summarizeRubricScore(rubricScores: Record<string, number>, template: CasebookTemplate | null): ValidationResult {
  if (!template) return { valid: false, message: 'Select a template to score against.' };

  const steps = (template.scoring_rubric as { steps?: string[] })?.steps;
  if (steps && steps.length > 0) {
    const met = steps.filter(s => rubricScores[s] >= 1).length;
    return { valid: met === steps.length, message: `${met}/${steps.length} PMR steps met.` };
  }

  const domains = ((template.scoring_rubric as { domains?: Record<string, number> })?.domains) || {};
  const maxTotal = Object.values(domains).reduce((sum, v) => sum + v, 0) || 100;
  const scored = Object.entries(domains).reduce((sum, [key, max]) => sum + Math.min(rubricScores[key] || 0, max), 0);
  return { valid: scored >= maxTotal * 0.5, message: `${scored}/${maxTotal} points.` };
}
