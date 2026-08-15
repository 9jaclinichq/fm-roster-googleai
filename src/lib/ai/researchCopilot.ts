import { databaseService, supabase, DEFAULT_TENANT_ID } from '../databaseService';
import { ResearchTemplate, ResearchStudyDesign } from '../../types';
import { validatePicoTitle, validateWordCap, validateCitationSyntax } from '../research/rubricEngine';

// Client-side provider for the Universal Research Engine's AI Copilot
// Panel (ResearchWorkspaceView.tsx). Same "Edge-Function-first, heuristic-
// fallback-always" architecture as src/modules/dissertation/lib/academicCopilot.ts — every
// method tries supabase/functions/research-copilot first, and falls back
// to a deterministic local implementation if the function isn't deployed,
// has no provider secret configured, or fails for any reason. The UI never
// breaks just because the AI tier had a bad day.
//
// Every result carries a `source` field so the UI can badge real
// AI-generated output vs. the local heuristic, same convention as
// academicCopilot.ts.

export type ResearchCopilotSource = 'edge_function' | 'heuristic_fallback';
export type ResearchCopilotProviderName = 'openai' | 'gemini';

export interface DraftAuditResult {
  compliant: boolean | null;
  notes: string[];
  source: ResearchCopilotSource;
  provider?: ResearchCopilotProviderName;
}

export interface LiteratureMatrixRow {
  author_year: string;
  study_design: string;
  key_focus: string;
  gap_or_note: string;
}

export interface LiteratureMatrixResult {
  rows: LiteratureMatrixRow[];
  source: ResearchCopilotSource;
  provider?: ResearchCopilotProviderName;
}

export interface TableShell {
  title: string;
  columns_hint: string;
}

export interface TableShellsResult {
  tables: TableShell[];
  source: ResearchCopilotSource;
  provider?: ResearchCopilotProviderName;
}

function templatePayload(template: ResearchTemplate | null) {
  if (!template) return undefined;
  return {
    organization_or_body: template.organization_or_body,
    referencing_style: template.referencing_style,
    proposal_rubric: template.proposal_rubric,
    dissertation_rubric: template.dissertation_rubric,
    word_count_limits: template.word_count_limits,
  };
}

async function logAction(workforceId: string, actionType: 'research_audit' | 'literature_matrix' | 'table_shells', input: string, output: unknown) {
  try {
    await databaseService.logAiAction(workforceId, actionType, input, output as Record<string, unknown>);
  } catch (err) {
    console.warn('Failed to log AI action:', err);
  }
}

interface EdgeFunctionSuccess<T> {
  result: T;
  provider: ResearchCopilotProviderName;
}

// Returns null on ANY failure (function not deployed, no provider secret
// configured, network error, malformed response, free-tier quota
// exhausted) so callers can fall back to their heuristic path uniformly —
// same contract as academicCopilot.ts's callEdgeFunction.
async function callEdgeFunction<T>(
  action: 'audit_draft' | 'synthesize_literature_matrix' | 'generate_table_shells',
  text: string,
  template: ResearchTemplate | null,
  workforceId: string
): Promise<EdgeFunctionSuccess<T> | null> {
  if (!supabase) return null;
  try {
    // workforce_id lets the server-side quota gate recognize THIS member's
    // own active Pro subscription (migration 22) — without it, a paying
    // resident could still get blocked by the tenant's shared free pool.
    const { data, error } = await supabase.functions.invoke('research-copilot', {
      body: { action, text, template: templatePayload(template), tenant_id: DEFAULT_TENANT_ID, workforce_id: workforceId },
    });
    if (error) {
      console.warn(`Edge Function research-copilot (${action}) failed, using heuristic fallback:`, error.message);
      return null;
    }
    if (!data || data.error || !data.result) {
      if (data?.error) console.warn(`Edge Function research-copilot (${action}) returned an error, using heuristic fallback:`, data.error);
      return null;
    }
    return { result: data.result as T, provider: data.provider as ResearchCopilotProviderName };
  } catch (err) {
    console.warn(`Edge Function research-copilot (${action}) threw, using heuristic fallback:`, err);
    return null;
  }
}

// Deterministic dummy-table-shell suggestions keyed by study design — the
// same heuristic fallback used before this module existed, kept as the
// no-AI-configured path.
function heuristicTableShells(studyDesign: ResearchStudyDesign | null): TableShell[] {
  const common: TableShell[] = [{ title: 'Table 1: Socio-Demographic Characteristics of Respondents', columns_hint: 'Age, sex, marital status, occupation, education' }];
  switch (studyDesign) {
    case 'cross_sectional':
      return [
        ...common,
        { title: 'Table 2: Prevalence of [Outcome] by Demographic Category', columns_hint: 'Category, n, prevalence %' },
        { title: 'Table 3: Association Between [Exposure] and [Outcome]', columns_hint: 'Exposure, OR, 95% CI, p-value' },
        { title: 'Table 4: Multivariate Logistic Regression of Predictors of [Outcome]', columns_hint: 'Predictor, aOR, 95% CI, p-value' },
      ];
    case 'cohort':
      return [
        ...common,
        { title: 'Table 2: Baseline Characteristics by Exposure Group', columns_hint: 'Variable, exposed, unexposed, p-value' },
        { title: 'Table 3: Incidence of [Outcome] Over Follow-Up Period', columns_hint: 'Time point, at-risk, events, incidence rate' },
        { title: 'Table 4: Relative Risk of [Outcome] by Exposure Status', columns_hint: 'Exposure, RR, 95% CI' },
      ];
    case 'case_control':
      return [
        ...common,
        { title: 'Table 2: Characteristics of Cases vs. Controls', columns_hint: 'Variable, cases, controls, p-value' },
        { title: 'Table 3: Odds Ratios for Candidate Risk Factors', columns_hint: 'Risk factor, OR, 95% CI' },
        { title: 'Table 4: Multivariate Logistic Regression Model', columns_hint: 'Predictor, aOR, 95% CI, p-value' },
      ];
    case 'clinical_trial':
      return [
        { title: 'Table 1: CONSORT Participant Flow', columns_hint: 'Enrolled, randomized, analyzed, lost to follow-up' },
        { title: 'Table 2: Baseline Characteristics by Study Arm', columns_hint: 'Variable, arm A, arm B, p-value' },
        { title: 'Table 3: Primary and Secondary Outcomes by Arm', columns_hint: 'Outcome, arm A, arm B, effect size' },
        { title: 'Table 4: Adverse Events by Arm', columns_hint: 'Event, arm A, arm B' },
      ];
    case 'qualitative':
      return [
        { title: 'Table 1: Participant Characteristics', columns_hint: 'ID, age, sex, role' },
        { title: 'Table 2: Themes, Sub-Themes, and Illustrative Quotes', columns_hint: 'Theme, sub-theme, quote' },
      ];
    case 'systematic_review':
      return [
        { title: 'Table 1: Characteristics of Included Studies', columns_hint: 'Author/year, design, sample size, setting' },
        { title: 'Table 2: Risk of Bias Assessment', columns_hint: 'Study, domain 1..n, overall rating' },
        { title: 'Table 3: Summary of Findings / Pooled Estimates', columns_hint: 'Outcome, studies, pooled estimate, 95% CI' },
      ];
    case 'case_series':
      return [
        { title: 'Table 1: Summary of Case Characteristics', columns_hint: 'Case #, age, sex, presentation' },
        { title: 'Table 2: Presenting Features and Outcomes by Case', columns_hint: 'Case #, features, management, outcome' },
      ];
    default:
      return common;
  }
}

// Best-effort "Author, Year" extraction from a pasted reference — organizes
// what was already pasted into a matrix skeleton; never invents content.
function heuristicLiteratureMatrix(referenceList: string): LiteratureMatrixRow[] {
  return referenceList
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(raw => {
      const yearMatch = raw.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? yearMatch[0] : 'n/a';
      const authorSegment = yearMatch ? raw.slice(0, yearMatch.index).trim() : raw;
      const author = authorSegment.replace(/^\d+\.\s*/, '').replace(/[,.]\s*$/, '').slice(0, 60) || 'Unknown';
      return { author_year: `${author} (${year})`, study_design: 'unclear', key_focus: '', gap_or_note: '' };
    });
}

export const researchCopilot = {
  async auditDraft(workforceId: string, title: string, content: string, references: string, template: ResearchTemplate | null): Promise<DraftAuditResult> {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      const result: DraftAuditResult = { compliant: null, notes: ['Write or paste some draft content first — nothing to audit yet.'], source: 'heuristic_fallback' };
      await logAction(workforceId, 'research_audit', content, result);
      return result;
    }

    const text = `Title: ${title || '(no title yet)'}\n\nContent:\n${trimmedContent}\n\nReferences:\n${references.trim() || '(none provided)'}`;
    const edgeResult = await callEdgeFunction<{ compliant: boolean; notes: string[] }>('audit_draft', text, template, workforceId);

    let result: DraftAuditResult;
    if (edgeResult && Array.isArray(edgeResult.result.notes)) {
      result = { compliant: !!edgeResult.result.compliant, notes: edgeResult.result.notes, source: 'edge_function', provider: edgeResult.provider };
    } else {
      const notes: string[] = [];
      const titleCheck = validatePicoTitle(title, template);
      const wordCheck = validateWordCap('content', trimmedContent, template);
      notes.push(`Title: ${titleCheck.message}`);
      notes.push(`Length: ${wordCheck.message}`);
      if (references.trim()) {
        const citationCheck = validateCitationSyntax(references, template);
        notes.push(`Citations: ${citationCheck.message}`);
      } else {
        notes.push('No references provided yet to check citation syntax.');
      }
      notes.push('This is a structural/rubric check, not a full departmental review — a human supervisor sign-off is still required.');
      const compliant = titleCheck.valid && wordCheck.valid;
      result = { compliant, notes, source: 'heuristic_fallback' };
    }

    await logAction(workforceId, 'research_audit', text, result);
    return result;
  },

  async synthesizeLiteratureMatrix(workforceId: string, referenceList: string, template: ResearchTemplate | null): Promise<LiteratureMatrixResult> {
    const trimmed = referenceList.trim();
    if (!trimmed) {
      const result: LiteratureMatrixResult = { rows: [], source: 'heuristic_fallback' };
      await logAction(workforceId, 'literature_matrix', referenceList, result);
      return result;
    }

    const edgeResult = await callEdgeFunction<{ rows: LiteratureMatrixRow[] }>('synthesize_literature_matrix', trimmed, template, workforceId);

    let result: LiteratureMatrixResult;
    if (edgeResult && Array.isArray(edgeResult.result.rows)) {
      result = { rows: edgeResult.result.rows, source: 'edge_function', provider: edgeResult.provider };
    } else {
      result = { rows: heuristicLiteratureMatrix(trimmed), source: 'heuristic_fallback' };
    }

    await logAction(workforceId, 'literature_matrix', trimmed, result);
    return result;
  },

  async generateTableShells(workforceId: string, title: string, studyDesign: ResearchStudyDesign | null, template: ResearchTemplate | null): Promise<TableShellsResult> {
    const text = `Study title: ${title || '(untitled)'}\nStudy design: ${studyDesign || 'unspecified'}`;
    const edgeResult = await callEdgeFunction<{ tables: TableShell[] }>('generate_table_shells', text, template, workforceId);

    let result: TableShellsResult;
    if (edgeResult && Array.isArray(edgeResult.result.tables)) {
      result = { tables: edgeResult.result.tables, source: 'edge_function', provider: edgeResult.provider };
    } else {
      result = { tables: heuristicTableShells(studyDesign), source: 'heuristic_fallback' };
    }

    await logAction(workforceId, 'table_shells', text, result);
    return result;
  },
};
