import { databaseService, supabase, DEFAULT_TENANT_ID } from '../databaseService';
import { AiActionType } from '../../types';

// Client-side academic support actions for the Dissertation Assistant and
// Casebook Builder. Each action tries the `dissertation-copilot` Supabase
// Edge Function first (supabase/functions/dissertation-copilot/index.ts —
// renamed from academic-copilot 2026-08-15, see
// docs/MODULARIZATION_ARCHITECTURE.md), which
// holds a real LLM API key server-side — never in client code, since this
// app is a pure static SPA with no backend of its own to hold a secret
// safely. If the Edge Function isn't deployed, has no AI_API_KEY secret
// configured, or fails for any reason, every method falls back to the
// original deterministic heuristic implementation (structural checks,
// regex-based normalization, keyword search) so the UI never breaks.
//
// Every result carries a `source` field ('edge_function' | 'heuristic_fallback')
// so the UI — and the ai_action_logs audit trail — can distinguish
// real AI-generated output from the local heuristic. Neither path invents
// medical facts beyond what the resident already wrote; the Edge Function's
// prompts explicitly frame every response as an educational aid requiring
// supervisor review, never a diagnosis or grade.
//
// "Check Departmental Guidelines" additionally does real keyword-based
// retrieval against the Knowledge Pack library (see migration 08) — this
// is lexical full-text search (Postgres tsvector), not embedding-based
// semantic search. Calling it "RAG" would overclaim what it actually does.
// This retrieval step runs regardless of which path (Edge Function or
// heuristic) produced the structural/compliance notes.
//
// Every action is logged to ai_action_logs via databaseService.logAiAction
// for audit purposes.

export type AcademicCopilotSource = 'edge_function' | 'heuristic_fallback';
export type AcademicCopilotProviderName = 'openai' | 'gemini';

export interface GuidelineComplianceResult {
  configured: boolean;
  compliant: boolean | null;
  notes: string[];
  source: AcademicCopilotSource;
  provider?: AcademicCopilotProviderName;
}

export interface CitationFormatResult {
  configured: boolean;
  formatted: string | null;
  source: AcademicCopilotSource;
  provider?: AcademicCopilotProviderName;
}

export interface DifferentialDiagnosisResult {
  configured: boolean;
  candidates: string[];
  reasoning: string | null;
  source: AcademicCopilotSource;
  provider?: AcademicCopilotProviderName;
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

interface EdgeFunctionSuccess<T> {
  result: T;
  provider: AcademicCopilotProviderName;
}

// Calls the dissertation-copilot Edge Function (which itself tries OpenAI
// then Gemini — see supabase/functions/dissertation-copilot/index.ts).
// Returns null on ANY failure (function not deployed, neither secret
// configured, network error, malformed response, free-tier quota
// exhausted — see migration 11) so callers can fall back to the heuristic
// path uniformly. Quota-exceeded is deliberately treated the same as any
// other Edge Function failure, not surfaced as a distinct UI state —
// consistent with this app's existing "the AI tier is optional, the UI
// never breaks" design rather than a new user-facing paywall message in
// this pass.
async function callEdgeFunction<T>(action: 'vancouver_format' | 'methodology_check' | 'extract_ddx', text: string): Promise<EdgeFunctionSuccess<T> | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.functions.invoke('dissertation-copilot', {
      body: { action, text, tenant_id: DEFAULT_TENANT_ID },
    });
    if (error) {
      console.warn(`Edge Function dissertation-copilot (${action}) failed, using heuristic fallback:`, error.message);
      return null;
    }
    if (!data || data.error || !data.result) {
      if (data?.error) console.warn(`Edge Function dissertation-copilot (${action}) returned an error, using heuristic fallback:`, data.error);
      return null;
    }
    return { result: data.result as T, provider: data.provider as AcademicCopilotProviderName };
  } catch (err) {
    console.warn(`Edge Function dissertation-copilot (${action}) threw, using heuristic fallback:`, err);
    return null;
  }
}

class AcademicCopilotProviderImpl implements AcademicCopilotProvider {
  async checkGuidelineCompliance(workforceId: string, text: string): Promise<GuidelineComplianceResult> {
    const trimmed = text.trim();
    if (!trimmed) {
      const result: GuidelineComplianceResult = { configured: true, compliant: null, notes: ['Paste some text first — nothing to check yet.'], source: 'heuristic_fallback' };
      await logAction(workforceId, 'methodology_check', text, result);
      return result;
    }

    // Real keyword-based retrieval against indexed Knowledge Pack content —
    // runs regardless of which path produces the structural notes below.
    const kbNotes: string[] = [];
    try {
      const keywords = extractKeywords(trimmed);
      if (keywords.length > 0) {
        const hits = await databaseService.searchKnowledgePackItems(keywords.join(' '));
        if (hits.length > 0) {
          kbNotes.push(`Related content found in the Knowledge Pack library: ${hits.slice(0, 3).map(h => `"${h.title}"`).join(', ')}.`);
        } else {
          kbNotes.push('No related content found in the indexed Knowledge Packs yet — ask the Chief Resident to add relevant guideline documents.');
        }
      }
    } catch (err) {
      console.warn('Knowledge pack search failed during guideline check:', err);
    }

    const edgeResult = await callEdgeFunction<{ compliant: boolean; notes: string[] }>('methodology_check', trimmed);

    let result: GuidelineComplianceResult;
    if (edgeResult && Array.isArray(edgeResult.result.notes)) {
      result = {
        configured: true,
        compliant: !!edgeResult.result.compliant,
        notes: [...edgeResult.result.notes, ...kbNotes],
        source: 'edge_function',
        provider: edgeResult.provider,
      };
    } else {
      const missing = EXPECTED_SECTIONS.filter(s => !s.pattern.test(trimmed)).map(s => s.label);
      const notes: string[] = [];
      if (missing.length === 0) {
        notes.push('All standard proposal sections were detected (Background, Objectives, Methodology, Ethical Considerations, References).');
      } else {
        notes.push(`Missing or unclear section(s): ${missing.join(', ')}.`);
      }
      notes.push(...kbNotes);
      notes.push('This is a structural completeness check and a keyword search of indexed guidelines — not a full departmental review. A human supervisor sign-off is still required.');
      result = { configured: true, compliant: missing.length === 0, notes, source: 'heuristic_fallback' };
    }

    await logAction(workforceId, 'methodology_check', trimmed, result);
    return result;
  }

  async formatVancouverCitations(workforceId: string, references: string): Promise<CitationFormatResult> {
    const lines = references
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean);

    if (lines.length === 0) {
      const result: CitationFormatResult = { configured: true, formatted: null, source: 'heuristic_fallback' };
      await logAction(workforceId, 'vancouver_format', references, result);
      return result;
    }

    const edgeResult = await callEdgeFunction<{ formatted: string }>('vancouver_format', references);

    let result: CitationFormatResult;
    if (edgeResult && typeof edgeResult.result.formatted === 'string') {
      result = { configured: true, formatted: edgeResult.result.formatted, source: 'edge_function', provider: edgeResult.provider };
    } else {
      const normalized = lines.map((line, i) => {
        let cleaned = line
          .replace(/^\s*(\[\d+\]|\(\d+\)|\d+[.)]|[-•])\s*/, '') // strip existing numbering/bullets
          .replace(/\s+/g, ' ')
          .trim();
        if (!/[.!?]$/.test(cleaned)) cleaned += '.';
        return `${i + 1}. ${cleaned}`;
      });
      result = { configured: true, formatted: normalized.join('\n'), source: 'heuristic_fallback' };
    }

    await logAction(workforceId, 'vancouver_format', references, result);
    return result;
  }

  async extractDifferentialDiagnosis(workforceId: string, caseText: string): Promise<DifferentialDiagnosisResult> {
    const trimmed = caseText.trim();
    if (!trimmed) {
      const result: DifferentialDiagnosisResult = { configured: true, candidates: [], reasoning: 'Paste your case notes first — nothing to extract yet.', source: 'heuristic_fallback' };
      await logAction(workforceId, 'differential_extract', caseText, result);
      return result;
    }

    const edgeResult = await callEdgeFunction<{ candidates: string[]; reasoning: string }>('extract_ddx', trimmed);

    let result: DifferentialDiagnosisResult;
    if (edgeResult && Array.isArray(edgeResult.result.candidates)) {
      result = { configured: true, candidates: edgeResult.result.candidates, reasoning: edgeResult.result.reasoning || null, source: 'edge_function', provider: edgeResult.provider };
    } else {
      const triggerMatch = trimmed.match(/(differential[s]?(\s+diagnos[ie]s)?|ddx|consider(ing)?)\s*[:\-]\s*([\s\S]+)/i);

      let candidates: string[];
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

      result = { configured: true, candidates, reasoning, source: 'heuristic_fallback' };
    }

    await logAction(workforceId, 'differential_extract', trimmed, result);
    return result;
  }
}

// Swap this out (or extend it) for other Edge-Function-backed providers as
// needed — every call site goes through this single export.
export const academicCopilot: AcademicCopilotProvider = new AcademicCopilotProviderImpl();
