import { databaseService, supabase, DEFAULT_TENANT_ID } from '../../../lib/databaseService';
import { CasebookTemplate, ThematicArea } from '../../../types';
import { validateReferenceFormatting, detectFigureStartingSentences } from './caseRubricEngine';

// Client-side provider for the Casebook & Clinical Logbook Engine's AI-
// assisted actions. Same Edge-Function-first, heuristic-fallback-always
// architecture as academicCopilot.ts / researchCopilot.ts — every method
// tries supabase/functions/casebook-copilot first, and falls back to a
// deterministic local implementation if it's unavailable.

export type CasebookCopilotSource = 'edge_function' | 'heuristic_fallback';
export type CasebookCopilotProviderName = 'openai' | 'gemini';

export interface CaseAuditResult {
  scores: Record<string, number>;
  notes: string[];
  source: CasebookCopilotSource;
  provider?: CasebookCopilotProviderName;
}

export interface DefenseQuestion {
  question: string;
  recommended_answer: string;
}

export interface DefenseQuestionsResult {
  questions: DefenseQuestion[];
  source: CasebookCopilotSource;
  provider?: CasebookCopilotProviderName;
}

export interface ParsedLogbookStation {
  station_name: string;
  procedures: { procedure_or_competency: string; required_count: number }[];
}

export interface LogbookParseResult {
  stations: ParsedLogbookStation[];
  source: CasebookCopilotSource;
  provider?: CasebookCopilotProviderName;
}

function templatePayload(template: CasebookTemplate | null) {
  if (!template) return undefined;
  return {
    framework_type: template.framework_type,
    thematic_distribution: template.thematic_distribution,
    scoring_rubric: template.scoring_rubric,
    formatting_rules: template.formatting_rules,
  };
}

async function logAction(workforceId: string, actionType: 'casebook_audit' | 'defense_questions' | 'logbook_parse', input: string, output: unknown) {
  try {
    await databaseService.logAiAction(workforceId, actionType, input, output as Record<string, unknown>);
  } catch (err) {
    console.warn('Failed to log AI action:', err);
  }
}

interface EdgeFunctionSuccess<T> {
  result: T;
  provider: CasebookCopilotProviderName;
}

async function callEdgeFunction<T>(
  action: 'audit_case' | 'generate_defense_questions' | 'parse_logbook_curriculum',
  text: string,
  template: CasebookTemplate | null,
  workforceId: string
): Promise<EdgeFunctionSuccess<T> | null> {
  if (!supabase) return null;
  try {
    // workforce_id lets the server-side quota gate recognize THIS member's
    // own active Pro subscription (migration 22) — without it, a paying
    // resident could still get blocked by the tenant's shared free pool.
    const { data, error } = await supabase.functions.invoke('casebook-copilot', {
      body: { action, text, template: templatePayload(template), tenant_id: DEFAULT_TENANT_ID, workforce_id: workforceId },
    });
    if (error) {
      console.warn(`Edge Function casebook-copilot (${action}) failed, using heuristic fallback:`, error.message);
      return null;
    }
    if (!data || data.error || !data.result) {
      if (data?.error) console.warn(`Edge Function casebook-copilot (${action}) returned an error, using heuristic fallback:`, data.error);
      return null;
    }
    return { result: data.result as T, provider: data.provider as CasebookCopilotProviderName };
  } catch (err) {
    console.warn(`Edge Function casebook-copilot (${action}) threw, using heuristic fallback:`, err);
    return null;
  }
}

const GENERIC_DEFENSE_QUESTIONS: DefenseQuestion[] = [
  { question: 'Why did this case meet the threshold for the level of care described?', recommended_answer: 'Point to the specific findings in your presenting complaints/HPI that justified referral or admission at that level.' },
  { question: 'Walk me through your differential diagnosis and how you narrowed it down.', recommended_answer: 'Reference the key history/examination findings you used to include or exclude each differential.' },
  { question: 'How did the patient\'s family or social context shape your management plan?', recommended_answer: 'Draw on your PCCM/family tools findings (FIFE, genogram, Family APGAR) to show how they informed a specific decision.' },
  { question: 'What cost considerations did you factor into your management, and why?', recommended_answer: 'Name the specific investigations/treatments you weighed and the lower-cost alternative you considered, if any.' },
  { question: 'What would you do differently if you saw this patient again?', recommended_answer: 'Give one concrete change grounded in your discussion/lessons-learnt section, not a generic answer.' },
];

function heuristicAudit(title: string, content: string, references: string, template: CasebookTemplate | null): { scores: Record<string, number>; notes: string[] } {
  const notes: string[] = [];
  const scores: Record<string, number> = {};

  const figureCheck = detectFigureStartingSentences(content);
  notes.push(`Formatting: ${figureCheck.message}`);
  scores.formatting = figureCheck.valid ? 5 : 2;

  if (references.trim()) {
    const refCheck = validateReferenceFormatting(references, template);
    notes.push(`References: ${refCheck.message}`);
    scores.references = refCheck.valid ? 10 : 4;
  } else {
    notes.push('No references provided yet.');
    scores.references = 0;
  }

  notes.push(!title.trim() ? 'No case title set yet.' : `Title present: "${title}".`);
  notes.push(content.trim().length < 200 ? 'Write-up looks short for a full case — content-quality domains (diagnostic accuracy, discussion, PCCM) need a longer draft before a meaningful score is possible.' : 'Write-up length looks reasonable for a first-pass structural check.');
  notes.push('This is a structural check only (formatting, references) — content-quality domains (diagnostic accuracy, discussion, PCCM depth) require supervisor or AI review, not this heuristic.');

  return { scores, notes };
}

function heuristicDefenseQuestions(thematicArea: ThematicArea): DefenseQuestion[] {
  const areaLabel = thematicArea.replace(/_/g, ' ');
  return [
    { question: `Why does this case fall under ${areaLabel}, and what makes it a good teaching case for that area?`, recommended_answer: 'Reference the specific diagnosis/presentation that anchors it to this thematic area.' },
    ...GENERIC_DEFENSE_QUESTIONS,
  ];
}

// Best-effort line-based parsing: looks for "Station: X" headers and
// "- procedure (target: N)" bullet lines. Falls back to treating every
// non-empty line as its own single-procedure station if no headers are
// detected — organizes what was pasted, never invents curriculum content.
function heuristicParseLogbook(rawText: string): ParsedLogbookStation[] {
  const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
  const stations: ParsedLogbookStation[] = [];
  let current: ParsedLogbookStation | null = null;

  const stationHeader = /^(station|rotation)\s*[:\-]\s*(.+)$/i;
  const procedureLine = /^[-•*]?\s*(.+?)(?:\(?target\s*[:\-]?\s*(\d+)\)?)?$/i;

  for (const line of lines) {
    const headerMatch = line.match(stationHeader);
    if (headerMatch) {
      current = { station_name: headerMatch[2].trim(), procedures: [] };
      stations.push(current);
      continue;
    }
    const procMatch = line.match(procedureLine);
    const name = (procMatch?.[1] || line).replace(/\(?target.*$/i, '').trim();
    const count = procMatch?.[2] ? Number(procMatch[2]) : 1;
    if (!current) {
      current = { station_name: name, procedures: [] };
      stations.push(current);
    }
    current.procedures.push({ procedure_or_competency: name, required_count: count || 1 });
  }

  return stations;
}

export const casebookCopilot = {
  async auditCase(
    workforceId: string,
    title: string,
    content: string,
    references: string,
    template: CasebookTemplate | null
  ): Promise<CaseAuditResult> {
    const trimmed = content.trim();
    if (!trimmed) {
      const result: CaseAuditResult = { scores: {}, notes: ['Write or paste some case content first — nothing to audit yet.'], source: 'heuristic_fallback' };
      await logAction(workforceId, 'casebook_audit', content, result);
      return result;
    }

    const text = `Title: ${title || '(no title yet)'}\n\nCase Write-up:\n${trimmed}\n\nReferences:\n${references.trim() || '(none provided)'}`;
    const edgeResult = await callEdgeFunction<{ scores: Record<string, number>; overall_notes: string[] }>('audit_case', text, template, workforceId);

    let result: CaseAuditResult;
    if (edgeResult && edgeResult.result.scores) {
      result = { scores: edgeResult.result.scores, notes: edgeResult.result.overall_notes || [], source: 'edge_function', provider: edgeResult.provider };
    } else {
      const heuristic = heuristicAudit(title, content, references, template);
      result = { ...heuristic, source: 'heuristic_fallback' };
    }

    await logAction(workforceId, 'casebook_audit', text, result);
    return result;
  },

  async generateDefenseQuestions(
    workforceId: string,
    title: string,
    content: string,
    thematicArea: ThematicArea,
    template: CasebookTemplate | null
  ): Promise<DefenseQuestionsResult> {
    const trimmed = content.trim();
    if (!trimmed) {
      const result: DefenseQuestionsResult = { questions: [], source: 'heuristic_fallback' };
      await logAction(workforceId, 'defense_questions', content, result);
      return result;
    }

    const text = `Title: ${title || '(no title yet)'}\nThematic area: ${thematicArea}\n\nCase Write-up:\n${trimmed}`;
    const edgeResult = await callEdgeFunction<{ questions: DefenseQuestion[] }>('generate_defense_questions', text, template, workforceId);

    let result: DefenseQuestionsResult;
    if (edgeResult && Array.isArray(edgeResult.result.questions)) {
      result = { questions: edgeResult.result.questions, source: 'edge_function', provider: edgeResult.provider };
    } else {
      result = { questions: heuristicDefenseQuestions(thematicArea), source: 'heuristic_fallback' };
    }

    await logAction(workforceId, 'defense_questions', text, result);
    return result;
  },

  async parseLogbookCurriculum(workforceId: string, rawText: string): Promise<LogbookParseResult> {
    const trimmed = rawText.trim();
    if (!trimmed) {
      const result: LogbookParseResult = { stations: [], source: 'heuristic_fallback' };
      await logAction(workforceId, 'logbook_parse', rawText, result);
      return result;
    }

    const edgeResult = await callEdgeFunction<{ stations: ParsedLogbookStation[] }>('parse_logbook_curriculum', trimmed, null, workforceId);

    let result: LogbookParseResult;
    if (edgeResult && Array.isArray(edgeResult.result.stations)) {
      result = { stations: edgeResult.result.stations, source: 'edge_function', provider: edgeResult.provider };
    } else {
      result = { stations: heuristicParseLogbook(trimmed), source: 'heuristic_fallback' };
    }

    await logAction(workforceId, 'logbook_parse', trimmed, result);
    return result;
  },
};
