import type { Dissertation, DissertationMilestone, DissertationStage } from '../../../types';

export interface DissertationDocumentLink {
  id: string;
  stage: DissertationStage;
  status: DissertationMilestone['status'];
  updatedAt: string;
  url: string;
}

export interface DissertationCommandCentreProjection {
  title: string;
  currentStage: DissertationStage;
  supervisorName: string | null;
  latestMilestone: DissertationMilestone | null;
  currentMilestone: DissertationMilestone | null;
  proposalApproved: boolean;
  safeDocuments: DissertationDocumentLink[];
  invalidDocumentCount: number;
  nextAction: string;
  nextActionRoute: string | null;
}

export const DISSERTATION_COMMAND_ROUTES = {
  dissertation: '/workspace/dissertation',
  research: '/workspace/research',
  library: '/workspace/library',
  review: '/workspace/consultant-review',
} as const;

export function isSafeExternalDocumentUrl(value: string | null): value is string {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function newestMilestone(milestones: DissertationMilestone[]): DissertationMilestone | null {
  return [...milestones].sort((a, b) => {
    const byDate = Date.parse(b.updated_at) - Date.parse(a.updated_at);
    if (Number.isFinite(byDate) && byDate !== 0) return byDate;
    return a.stage.localeCompare(b.stage);
  })[0] ?? null;
}

export function projectDissertationCommandCentre(
  dissertation: Dissertation,
  milestones: DissertationMilestone[]
): DissertationCommandCentreProjection {
  const currentMilestone = milestones.find((milestone) => milestone.stage === dissertation.stage) ?? null;
  const latestMilestone = newestMilestone(milestones);
  const proposalApproved = milestones.some(
    (milestone) => milestone.stage === 'Proposal Development' && milestone.status === 'approved'
  );
  const documentMilestones = milestones.filter((milestone) => !!milestone.document_url);
  const safeDocuments = documentMilestones
    .filter((milestone) => isSafeExternalDocumentUrl(milestone.document_url))
    .map((milestone) => ({
      id: milestone.id,
      stage: milestone.stage,
      status: milestone.status,
      updatedAt: milestone.updated_at,
      url: milestone.document_url!,
    }))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

  let nextAction = 'Continue dissertation drafting';
  let nextActionRoute: string | null = DISSERTATION_COMMAND_ROUTES.research;

  if (!currentMilestone) {
    nextAction = 'Review dissertation milestone setup';
    nextActionRoute = DISSERTATION_COMMAND_ROUTES.dissertation;
  } else if (currentMilestone.supervisor_feedback && currentMilestone.status !== 'approved') {
    nextAction = 'Review supervisor feedback';
    nextActionRoute = DISSERTATION_COMMAND_ROUTES.review;
  } else if (currentMilestone.document_url && isSafeExternalDocumentUrl(currentMilestone.document_url)) {
    nextAction = 'Open current milestone document';
    nextActionRoute = currentMilestone.document_url;
  } else if (currentMilestone.status === 'draft') {
    nextAction = 'Complete or submit the current milestone';
    nextActionRoute = DISSERTATION_COMMAND_ROUTES.dissertation;
  } else if (proposalApproved) {
    nextAction = 'Prepare fieldwork readiness evidence';
    nextActionRoute = DISSERTATION_COMMAND_ROUTES.dissertation;
  }

  return {
    title: dissertation.title,
    currentStage: dissertation.stage,
    supervisorName: dissertation.supervisor_name,
    latestMilestone,
    currentMilestone,
    proposalApproved,
    safeDocuments,
    invalidDocumentCount: documentMilestones.length - safeDocuments.length,
    nextAction,
    nextActionRoute,
  };
}
