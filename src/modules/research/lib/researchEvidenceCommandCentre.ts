import type { ResearchStudyDesign, ResearchWorkspace, ResearchWorkspaceStatus } from '../../../types';

export const RESEARCH_EVIDENCE_ROUTES = {
  research: {
    workforce: '/workspace/research',
    doctor: '/doctor/research',
  },
  library: '/workspace/library',
  review: '/workspace/consultant-review',
  dissertation: '/workspace/dissertation',
} as const;

export interface ResearchEvidenceOwnerScope {
  ownerId: string;
  ownerKind: 'workforce' | 'doctor';
  tenantId: string | null;
}

export interface ResearchEvidenceWorkspaceSummary {
  id: string;
  title: string;
  status: ResearchWorkspaceStatus;
  statusLabel: string;
  studyDesign: ResearchStudyDesign | null;
  studyDesignLabel: string;
  createdAt: string;
  tenantId: string | null;
}

export interface ResearchEvidenceProjection {
  visibleWorkspaces: ResearchEvidenceWorkspaceSummary[];
  mostRecentWorkspace: ResearchEvidenceWorkspaceSummary | null;
  nextActionLabel: string;
  nextActionWorkspaceId: string | null;
  emptyStateLabel: string | null;
}

const PRIVATE_METADATA_PATTERN = new RegExp([
  String.raw`\bhttps?:\/\/`,
  String.raw`\bdrive[.]google[.]com\b`,
  String.raw`\bdocs[.]google[.]com\b`,
  String.raw`\bsupabase[.]co\/storage\b`,
  String.raw`\bdocument_url\b`,
  String.raw`\bfile_url\b`,
  String.raw`\bpatient\b`,
  String.raw`\bparticipant\b`,
  String.raw`\bhospital_number\b`,
  String.raw`\bdiagnosis\b`,
  String.raw`\bclinical narrative\b`,
  String.raw`\braw note\b`,
  String.raw`\binitials\b`,
].join('|'), 'i');

export function containsUnsafeResearchEvidenceMetadata(value: string): boolean {
  return PRIVATE_METADATA_PATTERN.test(value);
}

function safeTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed || containsUnsafeResearchEvidenceMetadata(trimmed)) return 'Research workspace';
  return trimmed;
}

function formatStatus(status: ResearchWorkspaceStatus): string {
  return status.replace(/_/g, ' ');
}

function formatStudyDesign(studyDesign: ResearchStudyDesign | null): string {
  return studyDesign ? studyDesign.replace(/_/g, ' ') : 'Study design not set';
}

function isTenantVisible(workspaceTenantId: string | null, scopeTenantId: string | null): boolean {
  if (!scopeTenantId) return workspaceTenantId === null;
  return workspaceTenantId === null || workspaceTenantId === scopeTenantId;
}

function isWorkspaceOwnedByScope(workspace: ResearchWorkspace, scope: ResearchEvidenceOwnerScope): boolean {
  if (!isTenantVisible(workspace.tenant_id, scope.tenantId)) return false;
  if (scope.ownerKind === 'workforce') return workspace.workforce_id === scope.ownerId;
  return workspace.doctor_id === scope.ownerId && workspace.workforce_id === null;
}

function recencyValue(workspace: ResearchEvidenceWorkspaceSummary): number {
  const parsed = Date.parse(workspace.createdAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nextActionForWorkspace(workspace: ResearchEvidenceWorkspaceSummary | null): string {
  if (!workspace) return 'Create a research workspace';
  if (!workspace.studyDesign) return 'Set study design in Research Engine';
  if (workspace.status === 'proposal_draft') return 'Continue proposal drafting';
  if (workspace.status === 'proposal_approved') return 'Collect and organize evidence';
  if (workspace.status === 'data_collection') return 'Review fieldwork evidence and data collection notes';
  if (workspace.status === 'thesis_writeup') return 'Continue thesis write-up';
  return 'Review completed research work';
}

export function projectResearchEvidenceCommandCentre(
  workspaces: ResearchWorkspace[],
  scope: ResearchEvidenceOwnerScope
): ResearchEvidenceProjection {
  const visibleWorkspaces = workspaces
    .filter((workspace) => isWorkspaceOwnedByScope(workspace, scope))
    .map((workspace) => ({
      id: workspace.id,
      title: safeTitle(workspace.title),
      status: workspace.status,
      statusLabel: formatStatus(workspace.status),
      studyDesign: workspace.study_design,
      studyDesignLabel: formatStudyDesign(workspace.study_design),
      createdAt: workspace.created_at,
      tenantId: workspace.tenant_id,
    }))
    .filter((workspace) => !containsUnsafeResearchEvidenceMetadata(`${workspace.title} ${workspace.statusLabel} ${workspace.studyDesignLabel}`))
    .sort((a, b) => {
      const byDate = recencyValue(b) - recencyValue(a);
      if (byDate !== 0) return byDate;
      return a.id.localeCompare(b.id);
    });

  const mostRecentWorkspace = visibleWorkspaces[0] ?? null;

  return {
    visibleWorkspaces,
    mostRecentWorkspace,
    nextActionLabel: nextActionForWorkspace(mostRecentWorkspace),
    nextActionWorkspaceId: mostRecentWorkspace?.id ?? null,
    emptyStateLabel: visibleWorkspaces.length === 0
      ? 'No research workspaces are visible for this account yet.'
      : null,
  };
}
