// Abstraction wrapper for background LLM actions used by the Dissertation
// Assistant ("Check Departmental Guidelines", "Format Vancouver Citations")
// and, in future, case-report differential-diagnosis support.
//
// NOT WIRED TO A REAL MODEL YET. There is no LLM API key configured in this
// project (the previous @google/genai dependency was removed as unused —
// see CLAUDE.md). Just as important: this app is a pure static SPA with no
// backend (confirmed during the Phase 0 audit), so a real implementation
// must NOT call an LLM directly from client code with an embedded API key —
// that would ship the key to every visitor's browser, the same class of
// leak fixed for the Supabase service_role key elsewhere in this project.
// A real provider needs a small server-side proxy (a Supabase Edge
// Function is the natural fit here, since Supabase is already the backend)
// that holds the API key and the client calls instead.
//
// Until that exists, every method below returns a `configured: false`
// result rather than fabricating plausible-looking AI output — presenting
// fake guideline/citation/diagnosis analysis as real would be actively
// misleading for academic and clinical work.

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
  checkGuidelineCompliance(text: string): Promise<GuidelineComplianceResult>;
  formatVancouverCitations(references: string): Promise<CitationFormatResult>;
  extractDifferentialDiagnosis(caseText: string): Promise<DifferentialDiagnosisResult>;
}

const NOT_CONFIGURED_NOTE =
  'AI assistant is not connected yet. This action needs a server-side LLM proxy (e.g. a Supabase Edge Function) — see src/lib/ai/academicCopilot.ts.';

class StubAcademicCopilotProvider implements AcademicCopilotProvider {
  async checkGuidelineCompliance(_text: string): Promise<GuidelineComplianceResult> {
    return { configured: false, compliant: null, notes: [NOT_CONFIGURED_NOTE] };
  }

  async formatVancouverCitations(_references: string): Promise<CitationFormatResult> {
    return { configured: false, formatted: null };
  }

  async extractDifferentialDiagnosis(_caseText: string): Promise<DifferentialDiagnosisResult> {
    return { configured: false, candidates: [], reasoning: NOT_CONFIGURED_NOTE };
  }
}

// Swap this out for a real provider (calling your Edge Function) once one
// exists — every call site goes through this single export.
export const academicCopilot: AcademicCopilotProvider = new StubAcademicCopilotProvider();
