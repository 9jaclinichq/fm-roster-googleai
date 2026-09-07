import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DISSERTATION_COMMAND_ROUTES,
  isSafeExternalDocumentUrl,
  projectDissertationCommandCentre,
} from '../src/modules/dissertation/lib/dissertationCommandCentre';
import type { Dissertation, DissertationMilestone, DissertationStage, MilestoneStatus } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function dissertation(overrides: Partial<Dissertation> = {}): Dissertation {
  return {
    id: 'dissertation-a',
    workforce_id: 'workforce-a',
    title: 'Tenant neutral dissertation project',
    stage: 'Proposal Development',
    supervisor_name: 'Supervisor recorded in row',
    created_at: '2026-01-01T08:00:00.000Z',
    updated_at: '2026-09-01T08:00:00.000Z',
    ...overrides,
  };
}

function milestone(stage: DissertationStage, status: MilestoneStatus, overrides: Partial<DissertationMilestone> = {}): DissertationMilestone {
  return {
    id: `milestone-${stage.replace(/\s+/g, '-').toLowerCase()}`,
    dissertation_id: 'dissertation-a',
    stage,
    status,
    document_url: null,
    supervisor_feedback: null,
    created_at: '2026-01-01T08:00:00.000Z',
    updated_at: '2026-09-01T08:00:00.000Z',
    ...overrides,
  };
}

const approvedProjection = projectDissertationCommandCentre(dissertation(), [
  milestone('Topic Registration', 'approved', { updated_at: '2026-02-01T08:00:00.000Z' }),
  milestone('Proposal Development', 'approved', {
    document_url: 'https://example.test/proposal.pdf',
    updated_at: '2026-09-05T08:00:00.000Z',
  }),
  milestone('Ethical Clearance', 'draft', {
    document_url: 'javascript:alert(1)',
    updated_at: '2026-09-04T08:00:00.000Z',
  }),
]);

assert(approvedProjection.title === 'Tenant neutral dissertation project', 'projects dissertation title from row');
assert(approvedProjection.currentStage === 'Proposal Development', 'projects current stage from row');
assert(approvedProjection.supervisorName === 'Supervisor recorded in row', 'projects supervisor from row');
assert(approvedProjection.currentMilestone?.status === 'approved', 'projects current milestone status');
assert(approvedProjection.latestMilestone?.stage === 'Proposal Development', 'latest milestone is date-derived, not title-derived');
assert(approvedProjection.proposalApproved === true, 'proposal approval comes from structured milestone status');
assert(approvedProjection.safeDocuments.length === 1, 'only safe HTTPS document links are surfaced');
assert(approvedProjection.invalidDocumentCount === 1, 'unsafe document URLs are counted but not rendered as links');
assert(approvedProjection.nextAction === 'Open current milestone document', 'current safe document is the deterministic next action');

const draftProjection = projectDissertationCommandCentre(dissertation({ stage: 'Ethical Clearance', supervisor_name: null }), [
  milestone('Proposal Development', 'draft'),
  milestone('Ethical Clearance', 'draft'),
]);
assert(draftProjection.proposalApproved === false, 'unapproved proposal is not inferred as approved');
assert(draftProjection.nextAction === 'Complete or submit the current milestone', 'draft current milestone asks for completion/submission');
assert(draftProjection.supervisorName === null, 'missing supervisor remains missing');

const feedbackProjection = projectDissertationCommandCentre(dissertation(), [
  milestone('Proposal Development', 'in_review', { supervisor_feedback: 'Please revise methods section.' }),
]);
assert(feedbackProjection.nextAction === 'Review supervisor feedback', 'supervisor feedback outranks generic drafting');

const noMilestonesProjection = projectDissertationCommandCentre(dissertation(), []);
assert(noMilestonesProjection.latestMilestone === null, 'no milestones is represented honestly');
assert(noMilestonesProjection.nextAction === 'Review dissertation milestone setup', 'missing milestone setup has a real next action');

for (const [url, expected] of [
  ['https://example.test/document.pdf', true],
  ['http://example.test/document.pdf', false],
  ['javascript:alert(1)', false],
  ['data:text/html,hello', false],
  ['file:///tmp/document.pdf', false],
  ['not a url', false],
] as const) {
  assert(isSafeExternalDocumentUrl(url) === expected, `safe URL handling for ${url}`);
}

assert(Object.values(DISSERTATION_COMMAND_ROUTES).join(',') === '/workspace/dissertation,/workspace/research,/workspace/library,/workspace/consultant-review', 'navigation targets are existing workspace routes');

const productFiles = [
  'src/modules/dissertation/lib/dissertationCommandCentre.ts',
  'src/modules/dissertation/components/DissertationAssistantView.tsx',
].map((file) => resolve(process.cwd(), file));

for (const file of productFiles) {
  const contents = readFileSync(file, 'utf8');
  for (const pattern of [
    /Olanipekun/i,
    /Federal Secretariat Clinic/i,
    /Ikolaba/i,
    /FBS/i,
    /RBS/i,
    /9jaclinic/i,
    /service_role/i,
    /drive\.google\.com/i,
    /docs\.google\.com/i,
    /localStorage/i,
  ]) {
    assert(!pattern.test(contents), `${file} must not contain hardcoded user, tenant, study, Drive, service-role, or localStorage coupling`);
  }
}

const component = readFileSync(resolve(process.cwd(), 'src/modules/dissertation/components/DissertationAssistantView.tsx'), 'utf8');
assert(/databaseService\.getDissertationForWorkforce\(resident\.id\)/.test(component), 'route keeps workforce-owned dissertation read scope');
assert(/databaseService\.getDissertationMilestones\(diss\.id\)/.test(component), 'route loads milestones through dissertation id');
assert(/FieldworkReadinessPanel/.test(component), 'fieldwork readiness panel remains present');
assert(/Workspc readiness guidance/.test(readFileSync(resolve(process.cwd(), 'src/modules/research/components/FieldworkReadinessPanel.tsx'), 'utf8')), 'fieldwork advisory wording retained');
assert(!/gapi|googleapis|drive\.files|docs\.documents|iframe/i.test(component), 'no Drive API/write/embed surface introduced');
assert(/rel="noopener noreferrer"/.test(component), 'external links use noopener/noreferrer');
assert(!/service_role/i.test(component), 'no browser service-role access');

console.log('dissertation v1 command centre verifier passed');
