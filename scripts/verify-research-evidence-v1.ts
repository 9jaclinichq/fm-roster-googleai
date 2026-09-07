import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  containsUnsafeResearchEvidenceMetadata,
  projectResearchEvidenceCommandCentre,
  RESEARCH_EVIDENCE_ROUTES,
  type ResearchEvidenceOwnerScope,
} from '../src/modules/research/lib/researchEvidenceCommandCentre';
import type { ResearchWorkspace } from '../src/types';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const scope: ResearchEvidenceOwnerScope = {
  ownerId: 'workforce-current',
  ownerKind: 'workforce',
  tenantId: 'tenant-current',
};

const workspace = (overrides: Partial<ResearchWorkspace>): ResearchWorkspace => ({
  id: 'workspace',
  tenant_id: 'tenant-current',
  workforce_id: 'workforce-current',
  doctor_id: null,
  title: 'Hypertension quality improvement',
  study_design: 'cross_sectional',
  template_id: null,
  pico_framework: { title: 'private title not projected' },
  target_exam_date: null,
  folder_tree: [],
  status: 'proposal_draft',
  created_at: '2026-08-01T10:00:00.000Z',
  ...overrides,
});

const projection = projectResearchEvidenceCommandCentre([
  workspace({ id: 'older', created_at: '2026-08-01T10:00:00.000Z' }),
  workspace({ id: 'newer', title: 'Evidence synthesis workspace', status: 'proposal_approved', created_at: '2026-09-01T10:00:00.000Z' }),
  workspace({ id: 'other-user', workforce_id: 'workforce-other', title: 'Other user workspace', created_at: '2026-09-02T10:00:00.000Z' }),
  workspace({ id: 'other-tenant', tenant_id: 'tenant-other', title: 'Other tenant workspace', created_at: '2026-09-03T10:00:00.000Z' }),
  workspace({ id: 'unsafe-url', title: 'Draft https://docs.google.com/private', created_at: '2026-09-04T10:00:00.000Z' }),
  workspace({ id: 'unsafe-clinical', title: 'Patient diagnosis notes', created_at: '2026-09-05T10:00:00.000Z' }),
], scope);

assert(projection.visibleWorkspaces.map((item) => item.id).join(',') === 'unsafe-clinical,unsafe-url,newer,older', 'keeps owned workspaces while filtering other users and tenants');
assert(!projection.visibleWorkspaces.some((item) => item.id === 'other-user' || item.id === 'other-tenant'), 'excludes out-of-scope workspaces');
assert(projection.visibleWorkspaces[0].title === 'Research workspace', 'sanitizes sensitive workspace titles');
assert(projection.visibleWorkspaces[1].title === 'Research workspace', 'sanitizes private URL-shaped titles');
assert(projection.mostRecentWorkspace?.id === 'unsafe-clinical', 'selects newest visible workspace deterministically');
assert(projection.nextActionLabel === 'Continue proposal drafting', 'derives deterministic next action from structured status');
assert(projection.nextActionWorkspaceId === 'unsafe-clinical', 'resume target is the newest visible workspace id, not a URL');
assert(projection.visibleWorkspaces[2].title === 'Evidence synthesis workspace', 'projects safe title metadata only');
assert(projection.visibleWorkspaces[2].statusLabel === 'proposal approved', 'projects status label');
assert(projection.visibleWorkspaces[2].studyDesignLabel === 'cross sectional', 'projects study design label');

const empty = projectResearchEvidenceCommandCentre([], scope);
assert(empty.emptyStateLabel === 'No research workspaces are visible for this account yet.', 'has honest empty state');
assert(empty.nextActionLabel === 'Create a research workspace', 'empty next action starts a workspace');

const doctorScope: ResearchEvidenceOwnerScope = { ownerId: 'doctor-current', ownerKind: 'doctor', tenantId: null };
const doctorProjection = projectResearchEvidenceCommandCentre([
  workspace({ id: 'doctor-owned', tenant_id: null, workforce_id: null, doctor_id: 'doctor-current' }),
  workspace({ id: 'linked-workforce', tenant_id: 'tenant-current', workforce_id: 'workforce-current', doctor_id: 'doctor-current' }),
], doctorScope);
assert(doctorProjection.visibleWorkspaces.map((item) => item.id).join(',') === 'doctor-owned', 'doctor scope excludes linked workforce rows');

assert(containsUnsafeResearchEvidenceMetadata('https://example.com/private'), 'detects private URL-shaped metadata');
assert(containsUnsafeResearchEvidenceMetadata('participant initials'), 'detects participant detail');

assert(RESEARCH_EVIDENCE_ROUTES.research.workforce === '/workspace/research', 'uses real workforce research route');
assert(RESEARCH_EVIDENCE_ROUTES.research.doctor === '/doctor/research', 'uses real doctor research route');
assert(RESEARCH_EVIDENCE_ROUTES.library === '/workspace/library', 'uses real library route');
assert(RESEARCH_EVIDENCE_ROUTES.review === '/workspace/consultant-review', 'uses real review route');
assert(RESEARCH_EVIDENCE_ROUTES.dissertation === '/workspace/dissertation', 'uses real dissertation route');

const productFiles = [
  'src/modules/research/lib/researchEvidenceCommandCentre.ts',
  'src/modules/research/components/ResearchWorkspaceView.tsx',
].map((file) => resolve(process.cwd(), file));

for (const file of productFiles) {
  const contents = readFileSync(file, 'utf8');
  assert(!/Olanipekun|Federal Secretariat Clinic|Ikolaba|9jaclinic|drive\.google\.com|docs\.google\.com|service_role|SUPABASE_SERVICE|localStorage|gapi|googleapis|drive\.files|docs\.documents/i.test(contents), `${file} must not hardcode people, tenants, Drive, service-role, or browser storage authority`);
}

const researchView = readFileSync(resolve(process.cwd(), 'src/modules/research/components/ResearchWorkspaceView.tsx'), 'utf8');
const commandCentreSource = readFileSync(resolve(process.cwd(), 'src/modules/research/lib/researchEvidenceCommandCentre.ts'), 'utf8');
assert(!/content_text|original_comment/i.test(commandCentreSource), 'command-centre projection does not read raw chapters or correction comments');
assert(researchView.includes('databaseService.getResearchWorkspacesForWorkforce(owner.id)'), 'workforce read remains owner-scoped');
assert(researchView.includes('databaseService.getResearchWorkspacesForDoctor(owner.id)'), 'doctor read remains owner-scoped');
assert(researchView.includes('setActiveWorkspaceId(commandCentre.nextActionWorkspaceId)'), 'resume uses existing in-page workspace selection');
assert(researchView.includes('Research Engine') && researchView.includes('Library') && researchView.includes('Review Workspace') && researchView.includes('Dissertation'), 'module labels are distinguished');

console.log('research evidence v1 verifier passed');
