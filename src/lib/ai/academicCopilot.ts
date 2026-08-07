import { databaseService } from '../databaseService';
import { AiActionType } from '../../types';

// Client-side academic support actions for the Dissertation Assistant and
// Casebook Builder. IMPORTANT — these are deterministic text-processing
// heuristics, NOT calls to an LLM: there is no LLM API key configured in
// this project, and (as noted when this file was first stubbed out) this
// app is a pure static SPA with no backend, so an API key could never be
// held safely on the client anyway. Every function here does real,
// functional work — structural checks, regex-based normalization, keyword
// search — but none of it is AI-generated content, and none of it invents
// medical facts or diagnoses that weren't already present in the
// resident's own input. Where the input doesn't give enough to work with,
// each function says so explicitly rather than guessing.
//
// "Check Departmental Guidelines" additionally does real keyword-based
// retrieval against the Knowledge Pack library (see migration 08) — this
// is lexical full-text search (Postgres tsvector), not embedding-based
// semantic search. Calling it "RAG" would overclaim what it actually does.
//
// Every action is logged to ai_action_logs via databaseService.logAiAction
// for audit purposes.

export interface GuidelineComplianceResult {
  configured: boolean;
  compliant: boolean | null;
  notes: string[];
}

export interface CitationFormatResult {
  configured: boolean;
  formatted: string | null;
}

export interface DifferentialDiagnosisResult {
  configured: boolean;
  candidates: string[];
  reasoning: string | null;
}

export interface AcademicCopilotProvider {
  checkGuidelineCompliance(workforceId: string, text: string): Promise<GuidelineComplianceResult>;
  formatVancouverCitations(workforceId: string, references: string): Promise<CitationFormatResult>;
  extractDifferentialDiagnosis(workforceId: string, caseText: string): Promise<DifferentialDiagnosisResult>;
}

const EXPECTED_SECTIONS: { label: string; pattern: RegExp }[] = [
  { label: 'Background/Introduction', pattern: /\b(background|introduction)\b/i },
  { label: 'Objectives/Aims', pattern: /\b(objective|aim|hypothesis)s?\b/i },
  { label: 'Methodology', pattern: /\b(methodology|method|study design|data collection)\b/i },
  { label: 'Ethical Considerations', pattern: /\b(ethic(al|s)|informed consent)\b/i },
  { label: 'References', pattern: /\b(references?|bibliography)\b/i },
];

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'will',
  'their', 'which', 'were', 'been', 'about', 'into', 'over', 'such',
  'these', 'those', 'shall', 'should', 'would', 'could', 'each', 'when',
  'where', 'while', 'study', 'patient', 'patients',
]);

function extractKeywords(text: string, max = 8): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 4 && !STOPWORDS.has(w));

  const freq = new Map<string, number>();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);

  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([w]) => w);
}

async function logAction(workforceId: string, actionType: AiActionType, input: string, output: unknown) {
  try {
    await databaseService.logAiAction(workforceId, actionType, input, output as Record<string, unknown>);
  } catch (err) {
    // Logging failure shouldn't block the resident from seeing their result.
    console.warn('Failed to log AI action:', err);
  }
}

class HeuristicAcademicCopilotProvider implements AcademicCopilotProvider {
  async checkGuidelineCompliance(workforceId: string, text: string): Promise<GuidelineComplianceResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      const result = { configured: true, compliant: null, notes: ['Paste some text first — nothing to check yet.'] };
      await logAction(workforceId, 'methodology_check', text, result);
      return result;
    }

    const missing = EXPECTED_SECTIONS.filter(s => !s.pattern.test(trimmed)).map(s => s.label);
    const notes: string[] = [];

    if (missing.length === 0) {
      notes.push('All standard proposal sections were detected (Background, Objectives, Methodology, Ethical Considerations, References).');
    } else {
      notes.push(`Missing or unclear section(s): ${missing.join(', ')}.`);
    }

    // Real keyword-based retrieval against indexed Knowledge Pack content.
    try {
      const keywords = extractKeywords(trimmed);
      if (keywords.length > 0) {
        const hits = await databaseService.searchKnowledgePackItems(keywords.join(' '));
        if (hits.length > 0) {
          notes.push(`Related content found in the Knowledge Pack library: ${hits.slice(0, 3).map(h => `"${h.title}"`).join(', ')}.`);
        } else {
          notes.push('No related content found in the indexed Knowledge Packs yet — ask the Chief Resident to add relevant guideline documents.');
        }
      }
    } catch (err) {
      console.warn('Knowledge pack search failed during guideline check:', err);
      notes.push('Could not search the Knowledge Pack library right now.');
    }

    notes.push('This is a structural completeness check and a keyword search of indexed guidelines — not a full departmental review. A human supervisor sign-off is still required.');

    const result = { configured: true, compliant: missing.length === 0, notes };
    await logAction(workforceId, 'methodology_check', trimmed, result);
    return result;
  }

  async formatVancouverCitations(workforceId: string, references: string): Promise<CitationFormatResult> {
    const lines = references
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      const result = { configured: true, formatted: null };
      await logAction(workforceId, 'vancouver_format', references, result);
      return result;
    }

    const normalized = lines.map((line, i) => {
      let cleaned = line
        .replace(/^\s*(\[\d+\]|\(\d+\)|\d+[.)]|[-•])\s*/, '') // strip existing numbering/bullets
        .replace(/\s+/g, ' ')
        .trim();
      if (!/[.!?]$/.test(cleaned)) cleaned += '.';
      return `${i + 1}. ${cleaned}`;
    });

    const result = { configured: true, formatted: normalized.join('\n') };
    await logAction(workforceId, 'vancouver_format', references, result);
    return result;
  }

  async extractDifferentialDiagnosis(workforceId: string, caseText: string): Promise<DifferentialDiagnosisResult> {
    const trimmed = caseText.trim();
    if (!trimmed) {
      const result = { configured: true, candidates: [], reasoning: 'Paste your case notes first — nothing to extract yet.' };
      await logAction(workforceId, 'differential_extract', caseText, result);
      return result;
    }

    const triggerMatch = trimmed.match(/(differential[s]?(\s+diagnos[ie]s)?|ddx|consider(ing)?)\s*[:\-]\s*([\s\S]+)/i);

    let candidates: string[] = [];
    let reasoning: string;

    if (triggerMatch) {
      const listText = triggerMatch[4];
      candidates = listText
        .split(/\n|;|(?:,\s*(?:and|or)\s*)|(?:\d+[.)])/i)
        .map(s => s.replace(/^[\s\-•]+/, '').trim())
        .filter(s => s.length > 1)
        .filter((s, i, arr) => arr.findIndex(x => x.toLowerCase() === s.toLowerCase()) === i)
        .slice(0, 12);
      reasoning = `Extracted ${candidates.length} item(s) from your differential diagnosis list.`;
    } else {
      candidates = trimmed
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 10)
        .slice(0, 6);
      reasoning = "No explicit differential list detected (looked for phrases like \"differential diagnosis:\" or \"DDx:\") — showing a sentence-level breakdown of your case notes instead. Add a clear \"Differentials:\" section for more precise extraction.";
    }

    const result = { configured: true, candidates, reasoning };
    await logAction(workforceId, 'differential_extract', trimmed, result);
    return result;
  }
}

// Swap this out for a real LLM-backed provider (calling a server-side proxy
// — e.g. a Supabase Edge Function — never a client-embedded API key) if
// one is ever built. Every call site goes through this single export.
export const academicCopilot: AcademicCopilotProvider = new HeuristicAcademicCopilotProvider();
