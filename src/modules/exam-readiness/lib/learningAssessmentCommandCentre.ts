import type { CaseReport, Collection, Dissertation, DissertationMilestone, ExamReadiness, KnowledgePack, Submission, VivaSimulation } from '../../../types';

export const LEARNING_ASSESSMENT_ROUTES = {
  examReadiness: '/workspace/exam-readiness',
  viva: '/workspace/viva-simulator',
  library: '/workspace/library',
  review: '/workspace/consultant-review',
  professionalRecord: '/workspace/my-record',
} as const;

export type LearningCapabilityStatus = 'working' | 'partial' | 'scaffolded' | 'absent';

export interface LearningAssessmentInput {
  readiness: ExamReadiness | null;
  dissertation: Dissertation | null;
  milestones: DissertationMilestone[];
  caseReports: CaseReport[];
  vivaSimulations: VivaSimulation[];
  knowledgePacks: KnowledgePack[];
  currentCollection: Collection | null;
  currentSubmission: Submission | null;
}

export interface LearningAssessmentLane {
  key: 'exam' | 'viva' | 'library' | 'review' | 'record';
  title: string;
  role: string;
  status: LearningCapabilityStatus;
  summary: string;
  recentActivity: string;
  route: string;
  actionLabel: string;
}

export interface LearningAssessmentProjection {
  recentActivity: string;
  nextActionLabel: string;
  nextActionDetail: string;
  nextActionRoute: string;
  lanes: LearningAssessmentLane[];
  privacyBoundary: string;
}

function parseDate(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'No activity recorded yet';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Date unavailable';
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function latestDate(values: Array<string | null | undefined>): string | null {
  const sorted = values
    .filter((value): value is string => !!value)
    .sort((a, b) => parseDate(b) - parseDate(a));
  return sorted[0] ?? null;
}

function examNeedsAttention(readiness: ExamReadiness | null): boolean {
  if (!readiness) return false;
  return readiness.physical_logbook_verified === false
    || readiness.exam_fees_paid === false
    || readiness.college_forms_submitted === false
    || readiness.evidemy_completed_count < readiness.evidemy_total_required;
}

function evidenceLine(readiness: ExamReadiness | null): string {
  if (!readiness) return 'No activity recorded yet';
  const logistics = [
    readiness.physical_logbook_verified ? 'logbook verified' : 'logbook not verified',
    readiness.exam_fees_paid ? 'fees marked paid' : 'fees not marked paid',
    readiness.college_forms_submitted ? 'forms submitted' : 'forms not submitted',
  ].join('; ');
  const modules = readiness.evidemy_total_required > 0
    ? `Evidemy ${readiness.evidemy_completed_count}/${readiness.evidemy_total_required}`
    : 'Evidemy requirement not currently tracked';
  return `${modules}; ${logistics}`;
}

export function projectLearningAssessmentCommandCentre(input: LearningAssessmentInput): LearningAssessmentProjection {
  const latestViva = input.vivaSimulations
    .slice()
    .sort((a, b) => parseDate(b.created_at) - parseDate(a.created_at))[0] ?? null;
  const latestCase = input.caseReports
    .slice()
    .sort((a, b) => parseDate(b.updated_at) - parseDate(a.updated_at))[0] ?? null;
  const latestMilestone = input.milestones
    .slice()
    .sort((a, b) => parseDate(b.updated_at) - parseDate(a.updated_at))[0] ?? null;
  const latestLibrary = input.knowledgePacks
    .slice()
    .sort((a, b) => parseDate(b.created_at) - parseDate(a.created_at))[0] ?? null;
  const latestActivityDate = latestDate([
    input.readiness?.updated_at,
    latestViva?.created_at,
    latestCase?.updated_at,
    latestMilestone?.updated_at,
    input.dissertation?.updated_at,
    input.currentSubmission?.updated_at,
    latestLibrary?.created_at,
  ]);
  const feedbackAvailable = input.milestones.some((milestone) => !!milestone.supervisor_feedback?.trim());
  const reviewedWorkVisible = feedbackAvailable
    || input.caseReports.some((report) => report.status === 'pending_supervisor' || report.status === 'approved')
    || input.milestones.some((milestone) => milestone.status === 'in_review' || milestone.status === 'approved');
  const currentSubmissionSummary = input.currentCollection
    ? input.currentSubmission
      ? `Current collection submitted on ${formatDate(input.currentSubmission.updated_at)}`
      : 'Current collection has no submission recorded yet'
    : 'No active collection is currently tracked';

  let nextActionLabel = 'Begin Exam Readiness';
  let nextActionDetail = 'Begin the first supported learning and assessment activity.';
  let nextActionRoute: string = LEARNING_ASSESSMENT_ROUTES.examReadiness;

  if (examNeedsAttention(input.readiness)) {
    nextActionLabel = 'Continue Exam Readiness';
    nextActionDetail = evidenceLine(input.readiness);
  } else if (latestViva) {
    nextActionLabel = 'Resume Viva Practice';
    nextActionDetail = `${latestViva.case_title || 'Viva practice'} attempted ${formatDate(latestViva.created_at)}.`;
    nextActionRoute = LEARNING_ASSESSMENT_ROUTES.viva;
  } else if (feedbackAvailable) {
    nextActionLabel = 'Review Feedback';
    nextActionDetail = 'Feedback is recorded on a dissertation milestone.';
    nextActionRoute = LEARNING_ASSESSMENT_ROUTES.review;
  } else if (input.knowledgePacks.length > 0) {
    nextActionLabel = 'Open Learning Resources';
    nextActionDetail = `${input.knowledgePacks.length} library resource${input.knowledgePacks.length === 1 ? '' : 's'} visible for this tenant.`;
    nextActionRoute = LEARNING_ASSESSMENT_ROUTES.library;
  }

  return {
    recentActivity: latestActivityDate ? `Most recent learning activity: ${formatDate(latestActivityDate)}` : 'No activity recorded yet',
    nextActionLabel,
    nextActionDetail,
    nextActionRoute,
    lanes: [
      {
        key: 'exam',
        title: 'Exam Readiness',
        role: 'Structured preparation and progress.',
        status: input.readiness ? (examNeedsAttention(input.readiness) ? 'partial' : 'working') : 'scaffolded',
        summary: input.readiness ? `${evidenceLine(input.readiness)}. ${currentSubmissionSummary}.` : 'No activity recorded yet',
        recentActivity: formatDate(input.readiness?.updated_at),
        route: LEARNING_ASSESSMENT_ROUTES.examReadiness,
        actionLabel: input.readiness ? 'Update tracked items' : 'Start readiness record',
      },
      {
        key: 'viva',
        title: 'Viva Simulator',
        role: 'Oral examination practice.',
        status: input.vivaSimulations.length > 0 ? 'working' : 'partial',
        summary: latestViva ? `${latestViva.case_title || 'Practice session'} attempted.` : 'No activity recorded yet',
        recentActivity: formatDate(latestViva?.created_at),
        route: LEARNING_ASSESSMENT_ROUTES.viva,
        actionLabel: latestViva ? 'Resume practice' : 'Start practice',
      },
      {
        key: 'library',
        title: 'Library',
        role: 'Learning resources and evidence.',
        status: input.knowledgePacks.length > 0 ? 'working' : 'partial',
        summary: input.knowledgePacks.length > 0
          ? `${input.knowledgePacks.length} tenant resource${input.knowledgePacks.length === 1 ? '' : 's'} visible.`
          : 'No activity recorded yet',
        recentActivity: formatDate(latestLibrary?.created_at),
        route: LEARNING_ASSESSMENT_ROUTES.library,
        actionLabel: 'Open library',
      },
      {
        key: 'review',
        title: 'Review Workspace',
        role: 'Appraisal and feedback.',
        status: reviewedWorkVisible ? 'working' : 'partial',
        summary: feedbackAvailable ? 'Feedback is recorded in a source module.' : reviewedWorkVisible ? 'Reviewable work exists in source modules.' : 'Private feedback content is not shown here.',
        recentActivity: formatDate(latestDate([latestCase?.updated_at, latestMilestone?.updated_at])),
        route: LEARNING_ASSESSMENT_ROUTES.review,
        actionLabel: 'Open review workspace',
      },
      {
        key: 'record',
        title: 'My Professional Record',
        role: 'Longitudinal summary.',
        status: 'working',
        summary: 'Overview only. Source-module details remain in their original workspace.',
        recentActivity: latestActivityDate ? formatDate(latestActivityDate) : 'No activity recorded yet',
        route: LEARNING_ASSESSMENT_ROUTES.professionalRecord,
        actionLabel: 'Open my record',
      },
    ],
    privacyBoundary: 'Owner-scoped resident data and tenant-scoped library resources only; raw feedback, private files, patient identifiers and cross-user performance are not projected.',
  };
}
