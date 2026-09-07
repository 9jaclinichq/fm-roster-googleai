import type { UnifiedDoctorRecord, UdrEntry, UdrInstance } from './udr';

export const PROFESSIONAL_RECORD_ROUTES = {
  record: {
    workforce: '/workspace/my-record',
    doctor: '/doctor/my-record',
  },
  assignments: '/workspace',
  cases: {
    workforce: '/workspace/casebook-logbook',
    doctor: '/doctor/cases',
  },
  casebook: {
    workforce: '/workspace/casebook-logbook',
    doctor: '/doctor/casebook-logbook',
  },
  dissertation: '/workspace/dissertation',
  research: {
    workforce: '/workspace/research',
    doctor: '/doctor/research',
  },
  examReadiness: '/workspace/exam-readiness',
  viva: '/workspace/viva-simulator',
  review: '/workspace/consultant-review',
} as const;

export type ProfessionalRecordLaneStatus = 'available' | 'no_records_yet' | 'not_connected' | 'not_currently_tracked' | 'needs_attention';

export interface ProfessionalRecordOwnerScope {
  ownerId: string;
  ownerKind: 'workforce' | 'doctor';
  tenantId: string | null;
}

export interface ProfessionalRecordLane {
  key: 'workforce' | 'cases' | 'research' | 'learning' | 'meetings' | 'billing' | 'audit';
  title: string;
  status: ProfessionalRecordLaneStatus;
  summary: string;
  actionLabel: string;
  route: string | null;
}

export interface ProfessionalRecordProjection {
  identityName: string;
  identityRole: string;
  tenantName: string;
  currentAssignment: string;
  lastActivityLabel: string;
  nextActionLabel: string;
  nextActionRoute: string | null;
  lanes: ProfessionalRecordLane[];
}

const UNSAFE_RECORD_METADATA_PATTERN = new RegExp([
  String.raw`\bhttps?:\/\/`,
  String.raw`\bdrive[.]google[.]com\b`,
  String.raw`\bdocs[.]google[.]com\b`,
  String.raw`\bsupabase[.]co\/storage\b`,
  String.raw`\bdocument_url\b`,
  String.raw`\bfile_url\b`,
  String.raw`\bpatient\b`,
  String.raw`\bparticipant\b`,
  String.raw`\bhospital_number\b`,
  String.raw`\bclinical narrative\b`,
  String.raw`\braw note\b`,
  String.raw`\binitials\b`,
].join('|'), 'i');

export function containsUnsafeProfessionalRecordMetadata(value: string): boolean {
  return UNSAFE_RECORD_METADATA_PATTERN.test(value);
}

function safeText(value: string | null | undefined, fallback: string): string {
  const trimmed = (value ?? '').trim();
  if (!trimmed || containsUnsafeProfessionalRecordMetadata(trimmed)) return fallback;
  return trimmed;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'No dated activity';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function createdAtValue(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestEntry(entries: UdrEntry[], type: UdrEntry['type']): UdrEntry | null {
  return entries
    .filter((entry) => entry.type === type)
    .sort((a, b) => createdAtValue(b.createdAt) - createdAtValue(a.createdAt))[0] ?? null;
}

function latestInstance(instances: UdrInstance[], type: UdrInstance['type']): UdrInstance | null {
  return instances
    .filter((instance) => instance.type === type)
    .sort((a, b) => createdAtValue(b.createdAt) - createdAtValue(a.createdAt))[0] ?? null;
}

function visibleInstances(record: UnifiedDoctorRecord, scope: ProfessionalRecordOwnerScope, type: UdrInstance['type']): UdrInstance[] {
  return record.instances.filter((instance) => {
    if (instance.type !== type) return false;
    if (scope.ownerKind === 'doctor') return instance.tenantId === null;
    return instance.tenantId === null || instance.tenantId === scope.tenantId;
  });
}

function latestActivity(record: UnifiedDoctorRecord): { label: string; at: string } | null {
  const candidates: { label: string; at: string }[] = [];
  for (const entry of record.entries) candidates.push({ label: entryLabel(entry), at: entry.createdAt });
  for (const instance of record.instances) candidates.push({ label: instance.type === 'research_workspace' ? 'Research workspace' : 'Casebook workspace', at: instance.createdAt });
  if (record.academic.dissertation) candidates.push({ label: 'Dissertation', at: record.academic.dissertation.updated_at });
  for (const insight of record.insights) candidates.push({ label: 'Insight', at: insight.createdAt });
  for (const meeting of record.meetings) candidates.push({ label: 'Meeting action', at: meeting.scheduledAt ?? '' });
  return candidates.sort((a, b) => createdAtValue(b.at) - createdAtValue(a.at))[0] ?? null;
}

function entryLabel(entry: UdrEntry): string {
  if (entry.type === 'submission') return 'Assignment submission';
  if (entry.type === 'case_report') return 'Case portfolio activity';
  if (entry.type === 'dissertation_milestone') return 'Dissertation milestone';
  if (entry.type === 'clinical_document') return 'Clinical document';
  return 'Rubric assessment';
}

function currentAssignment(record: UnifiedDoctorRecord): string {
  const latestSubmission = latestEntry(record.entries, 'submission');
  if (!latestSubmission) return record.identity.kind === 'doctor' ? 'Not connected to an institutional assignment' : 'No assignment submission visible yet';
  return safeText(latestSubmission.summary, 'Assignment recorded');
}

function nextAction(lanes: ProfessionalRecordLane[]): ProfessionalRecordLane {
  return lanes.find((lane) => lane.status === 'needs_attention' && lane.route)
    ?? lanes.find((lane) => lane.key === 'cases' && lane.status === 'available' && lane.route)
    ?? lanes.find((lane) => lane.key === 'research' && lane.status === 'available' && lane.route)
    ?? lanes.find((lane) => lane.key === 'learning' && lane.route)
    ?? lanes[0];
}

export function projectProfessionalRecordCommandCentre(
  record: UnifiedDoctorRecord,
  scope: ProfessionalRecordOwnerScope
): ProfessionalRecordProjection {
  const caseReports = record.entries.filter((entry) => entry.type === 'case_report');
  const casebookWorkspaces = visibleInstances(record, scope, 'casebook_workspace');
  const researchWorkspaces = visibleInstances(record, scope, 'research_workspace');
  const dissertation = scope.ownerKind === 'workforce' ? record.academic.dissertation : null;
  const examReadiness = scope.ownerKind === 'workforce' ? record.academic.examReadiness : null;
  const latestCasebook = latestInstance(casebookWorkspaces, 'casebook_workspace');
  const latestResearch = latestInstance(researchWorkspaces, 'research_workspace');
  const latestMilestone = latestEntry(record.entries, 'dissertation_milestone');
  const latest = latestActivity(record);
  const activeMeetingActions = record.meetings.flatMap((meeting) => meeting.actionsOwed).filter((action) => action.status !== 'resolved');

  const learningNeedsAttention = !!examReadiness && (
    examReadiness.physical_logbook_verified === false ||
    examReadiness.exam_fees_paid === false ||
    examReadiness.college_forms_submitted === false ||
    examReadiness.evidemy_completed_count < examReadiness.evidemy_total_required
  );

  const lanes: ProfessionalRecordLane[] = [
    {
      key: 'workforce',
      title: 'Workforce and assignments',
      status: scope.ownerKind === 'workforce' ? (latestEntry(record.entries, 'submission') ? 'available' : 'no_records_yet') : 'not_connected',
      summary: currentAssignment(record),
      actionLabel: scope.ownerKind === 'workforce' ? 'Review assignment area' : 'Institutional assignment not connected',
      route: scope.ownerKind === 'workforce' ? PROFESSIONAL_RECORD_ROUTES.assignments : null,
    },
    {
      key: 'cases',
      title: 'Cases and portfolio',
      status: caseReports.length > 0 || casebookWorkspaces.length > 0 ? 'available' : 'no_records_yet',
      summary: caseReports.length > 0
        ? `${caseReports.length} case report${caseReports.length === 1 ? '' : 's'} recorded`
        : latestCasebook
          ? `${safeText(latestCasebook.title, 'Casebook workspace')} • ${safeText(latestCasebook.status, 'status recorded').replace(/_/g, ' ')}`
          : 'No case or casebook activity visible yet',
      actionLabel: scope.ownerKind === 'doctor' ? 'Open Cases' : 'Open Casebook / Logbook',
      route: scope.ownerKind === 'doctor' ? PROFESSIONAL_RECORD_ROUTES.cases.doctor : PROFESSIONAL_RECORD_ROUTES.casebook.workforce,
    },
    {
      key: 'research',
      title: 'Dissertation and research',
      status: dissertation || researchWorkspaces.length > 0 ? 'available' : 'no_records_yet',
      summary: dissertation
        ? `${safeText(dissertation.title, 'Dissertation')} • ${safeText(dissertation.stage, 'stage recorded')}${latestMilestone ? ` • latest milestone ${safeText(latestMilestone.status ?? '', 'status recorded').replace(/_/g, ' ')}` : ''}`
        : latestResearch
          ? `${safeText(latestResearch.title, 'Research workspace')} • ${safeText(latestResearch.status, 'status recorded').replace(/_/g, ' ')}`
          : 'No dissertation or research workspace visible yet',
      actionLabel: dissertation ? 'Continue Dissertation' : 'Open Research Engine',
      route: dissertation ? PROFESSIONAL_RECORD_ROUTES.dissertation : PROFESSIONAL_RECORD_ROUTES.research[scope.ownerKind],
    },
    {
      key: 'learning',
      title: 'Learning and assessment',
      status: examReadiness ? (learningNeedsAttention ? 'needs_attention' : 'available') : 'not_currently_tracked',
      summary: examReadiness
        ? `Evidemy ${examReadiness.evidemy_completed_count}/${examReadiness.evidemy_total_required}; logbook ${examReadiness.physical_logbook_verified ? 'verified' : 'not verified'}`
        : scope.ownerKind === 'workforce' ? 'Exam readiness is not started yet' : 'Institutional exam readiness is not connected',
      actionLabel: scope.ownerKind === 'workforce' ? 'Open Exam Readiness' : 'Open Viva Practice',
      route: scope.ownerKind === 'workforce' ? PROFESSIONAL_RECORD_ROUTES.examReadiness : PROFESSIONAL_RECORD_ROUTES.viva,
    },
    {
      key: 'meetings',
      title: 'Meetings and professional activity',
      status: activeMeetingActions.length > 0 ? 'needs_attention' : record.meetings.length > 0 ? 'available' : 'not_currently_tracked',
      summary: activeMeetingActions.length > 0
        ? `${activeMeetingActions.length} meeting action${activeMeetingActions.length === 1 ? '' : 's'} owed`
        : record.meetings.length > 0 ? `${record.meetings.length} meeting record${record.meetings.length === 1 ? '' : 's'} visible` : 'No per-person meeting actions are currently tracked',
      actionLabel: 'Review professional activity',
      route: PROFESSIONAL_RECORD_ROUTES.record[scope.ownerKind],
    },
    {
      key: 'billing',
      title: 'Billing',
      status: record.billing.activeSubscription ? 'available' : 'not_currently_tracked',
      summary: record.billing.activeSubscription ? `${record.billing.activeSubscription.plan.replace(/_/g, ' ')} • ${record.billing.activeSubscription.status}` : 'No active individual subscription visible',
      actionLabel: 'Billing unavailable here',
      route: null,
    },
    {
      key: 'audit',
      title: 'Audit',
      status: record.audit.length > 0 ? 'available' : 'not_currently_tracked',
      summary: record.audit.length > 0 ? `${record.audit.length} audit event${record.audit.length === 1 ? '' : 's'} visible` : 'No per-person audit trail source exists yet',
      actionLabel: 'Audit unavailable here',
      route: null,
    },
  ];

  const prioritized = nextAction(lanes);

  return {
    identityName: safeText(record.identity.fullName, 'Professional record'),
    identityRole: record.identity.category ?? (record.identity.kind === 'doctor' ? 'Doctor' : 'Role not set'),
    tenantName: safeText(record.tenant?.name, 'Not affiliated with an organization'),
    currentAssignment: currentAssignment(record),
    lastActivityLabel: latest ? `${latest.label} • ${formatDate(latest.at)}` : 'No professional activity recorded yet',
    nextActionLabel: prioritized.status === 'needs_attention' ? prioritized.summary : prioritized.actionLabel,
    nextActionRoute: prioritized.route,
    lanes,
  };
}
