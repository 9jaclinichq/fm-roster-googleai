import { databaseService } from '../../../lib/databaseService';
import { ResearchTemplate, ResearchReferencingStyle } from '../../../types';

// Template customization/forking logic for the Universal Research Engine
// (migration 13). Kept separate from databaseService.ts's plain CRUD
// (getResearchTemplates/forkResearchTemplate/updateResearchTemplate) because
// forking has real business rules attached — what a fork is named, who owns
// it, and what "is_public" means for it — that don't belong mixed into a
// thin Supabase wrapper.

export interface TemplateForkOptions {
  // Personal fork: visible only to its creator (is_public=false, no
  // tenant_id). Tenant fork: visible department-wide (is_public=true,
  // tenant_id set) — typically created by a Chief/subadmin, but nothing
  // here enforces that; same client-enforced trust model as the rest of
  // this app (see CLAUDE.md's Security Notes).
  scope: 'personal' | 'tenant';
  newName: string;
  tenantId?: string;
}

// Loads every template a resident can currently choose from: system-seeded
// global templates (tenant_id NULL, created_by_workforce_id NULL), their
// tenant's department-wide custom templates, and their own personal forks.
export async function loadAvailableTemplates(tenantId: string, workforceId: string): Promise<ResearchTemplate[]> {
  const all = await databaseService.getResearchTemplates();
  return all.filter(t =>
    (t.tenant_id === null && t.created_by_workforce_id === null) || // global seed
    (t.tenant_id === tenantId && t.is_public) || // department-wide fork
    t.created_by_workforce_id === workforceId // personal fork
  );
}

export async function forkTemplate(
  sourceTemplateId: string,
  // Nullable since migration 27's Template Manager: a Chief authoring a
  // department-wide template has no workforce_id of their own to attribute
  // it to (the Chief role isn't a workforce row — see CLAUDE.md's Role
  // Model) — created_by_workforce_id is nullable precisely for this case.
  workforceId: string | null,
  options: TemplateForkOptions
): Promise<ResearchTemplate> {
  const source = await databaseService.getResearchTemplate(sourceTemplateId);
  if (!source) {
    throw new Error('Source template not found.');
  }

  return databaseService.createResearchTemplate({
    tenant_id: options.scope === 'tenant' ? (options.tenantId ?? source.tenant_id ?? null) : null,
    created_by_workforce_id: workforceId,
    name: options.newName,
    is_public: options.scope === 'tenant',
    organization_or_body: source.organization_or_body,
    specialty: source.specialty,
    study_design: source.study_design,
    proposal_rubric: source.proposal_rubric,
    dissertation_rubric: source.dissertation_rubric,
    referencing_style: source.referencing_style,
    word_count_limits: source.word_count_limits,
  });
}

export interface TemplateEditPayload {
  chapterTitles?: Record<string, string>; // merged into proposal_rubric.chapter_titles
  wordCaps?: Record<string, number>; // merged into word_count_limits
  rubricItems?: Record<string, unknown>; // merged into dissertation_rubric.sections
  referencingStyle?: ResearchReferencingStyle;
  customPromptRules?: string[]; // merged into proposal_rubric.custom_prompt_rules
}

// Applies a partial edit on top of an existing template's rubric/word-cap
// JSON blobs (shallow-merges each sub-object rather than replacing it
// wholesale, so editing one word cap doesn't wipe out the others).
export async function editTemplate(templateId: string, edits: TemplateEditPayload): Promise<ResearchTemplate> {
  const template = await databaseService.getResearchTemplate(templateId);
  if (!template) {
    throw new Error('Template not found.');
  }

  const proposalRubric = { ...(template.proposal_rubric as Record<string, unknown>) };
  if (edits.chapterTitles) {
    proposalRubric.chapter_titles = { ...(proposalRubric.chapter_titles as Record<string, string> | undefined), ...edits.chapterTitles };
  }
  if (edits.customPromptRules) {
    proposalRubric.custom_prompt_rules = edits.customPromptRules;
  }

  const dissertationRubric = { ...(template.dissertation_rubric as Record<string, unknown>) };
  if (edits.rubricItems) {
    dissertationRubric.sections = { ...(dissertationRubric.sections as Record<string, unknown> | undefined), ...edits.rubricItems };
  }

  const wordCountLimits = { ...template.word_count_limits, ...(edits.wordCaps || {}) };

  return databaseService.updateResearchTemplate(templateId, {
    proposal_rubric: proposalRubric,
    dissertation_rubric: dissertationRubric,
    word_count_limits: wordCountLimits,
    ...(edits.referencingStyle ? { referencing_style: edits.referencingStyle } : {}),
  });
}
