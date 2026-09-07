import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  containsUnsafeProfessionalRecordMetadata,
  projectProfessionalRecordCommandCentre,
  PROFESSIONAL_RECORD_ROUTES,
  type ProfessionalRecordOwnerScope,
} from '../src/modules/shared/lib/professionalRecordCommandCentre';
import type { UnifiedDoctorRecord } from '../src/modules/shared/lib/udr';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const workforceScope: ProfessionalRecordOwnerScope = {
  ownerId: 'workforce-current',
  ownerKind: 'workforce',
  tenantId: 'tenant-current',
};

const baseRecord = (): UnifiedDoctorRecord => ({
  identity: {
    kind: 'workforce',
    workforceId: 'workforce-current',
    doctorId: null,
    fullName: 'Current Doctor',
    email: null,
    category: 'Registrar',
    active: true,
  },
  tenant: {
    id: 'tenant-current',
    name: 'Current Institution',
    shortCode: 'CURRENT',
    planType: 'free_seeded',
    status: 'active',
  },
  instances: [
    {
      id: 'research-current',
      type: 'research_workspace',
      title: 'Research workspace',
      status: 'proposal_draft',
      tenantId: 'tenant-current',
      createdAt: '2026-07-01T10:00:00.000Z',
    },
    {
      id: 'research-other-tenant',
      type: 'research_workspace',
      title: 'Other tenant research',
      status: 'completed',
      tenantId: 'tenant-other',
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    {
      id: 'casebook-current',
      type: 'casebook_workspace',
      title: 'Casebook workspace',
      status: 'draft',
      tenantId: 'tenant-current',
      createdAt: '2026-08-01T10:00:00.000Z',
    },
  ],
  entries: [
    {
      id: 'submission-current',
      type: 'submission',
      status: 'rotation_only',
      summary: 'Clinic -> Emergency',
      createdAt: '2026-09-01T10:00:00.000Z',
    },
    {
      id: 'case-report',
      type: 'case_report',
      status: 'draft',
      summary: 'Case 4: patient diagnosis must not display',
      createdAt: '2026-09-02T10:00:00.000Z',
    },
    {
      id: 'milestone',
      type: 'dissertation_milestone',
      status: 'in_review',
      summary: 'Proposal Development',
      createdAt: '2026-09-03T10:00:00.000Z',
    },
  ],
  academic: {
    dissertation: {
      id: 'dissertation-current',
      workforce_id: 'workforce-current',
      title: 'Professional continuity dissertation',
      stage: 'Supervisor Review',
      supervisor_name: null,
      created_at: '2026-01-01T10:00:00.000Z',
      updated_at: '2026-09-04T10:00:00.000Z',
    },
    examReadiness: {
      id: 'exam-current',
      workforce_id: 'workforce-current',
      evidemy_completed_count: 2,
      evidemy_total_required: 4,
      physical_logbook_verified: false,
      exam_fees_paid: true,
      college_forms_submitted: false,
      oral_practice_score: null,
      created_at: '2026-09-05T09:00:00.000Z',
      updated_at: '2026-09-05T10:00:00.000Z',
    },
    caseReportsCount: 1,
  },
  billing: { activeSubscription: null },
  insights: [],
  meetings: [],
  pipelines: [],
  audit: [],
});

const projection = projectProfessionalRecordCommandCentre(baseRecord(), workforceScope);
assert(projection.identityName === 'Current Doctor', 'projects professional identity name');
assert(projection.identityRole === 'Registrar', 'projects category/role');
assert(projection.tenantName === 'Current Institution', 'projects tenant display name');
assert(projection.currentAssignment === 'Clinic -> Emergency', 'projects current assignment from submission summary');
assert(projection.lastActivityLabel.startsWith('Dissertation'), 'uses meaningful newest professional activity');
assert(projection.nextActionLabel === 'Evidemy 2/4; logbook not verified', 'prioritizes structured learning needs attention');
assert(projection.nextActionRoute === '/workspace/exam-readiness', 'next action targets real route');
assert(projection.lanes.map((lane) => lane.key).join(',') === 'workforce,cases,research,learning,meetings,billing,audit', 'creates the required record lanes');
assert(projection.lanes.find((lane) => lane.key === 'cases')?.summary === '1 case report recorded', 'case lane uses safe aggregate instead of diagnosis');
assert(!projection.lanes.some((lane) => /patient|diagnosis|document_url|https?:\/\//i.test(lane.summary)), 'lane summaries exclude sensitive metadata');
assert(projection.lanes.find((lane) => lane.key === 'meetings')?.status === 'not_currently_tracked', 'meetings are honest when no per-person records exist');
assert(projection.lanes.find((lane) => lane.key === 'audit')?.summary === 'No per-person audit trail source exists yet', 'audit unsupported state is honest');

const emptyDoctor: UnifiedDoctorRecord = {
  ...baseRecord(),
  identity: {
    kind: 'doctor',
    workforceId: null,
    doctorId: 'doctor-current',
    fullName: 'Standalone Doctor',
    email: 'private@example.test',
    category: null,
    active: null,
  },
  tenant: null,
  instances: [],
  entries: [],
  academic: { dissertation: null, examReadiness: null, caseReportsCount: 0 },
  billing: { activeSubscription: null },
  insights: [],
  meetings: [],
  pipelines: [],
  audit: [],
};
const doctorProjection = projectProfessionalRecordCommandCentre(emptyDoctor, { ownerId: 'doctor-current', ownerKind: 'doctor', tenantId: null });
assert(doctorProjection.identityRole === 'Doctor', 'doctor record has generic role fallback');
assert(doctorProjection.currentAssignment === 'Not connected to an institutional assignment', 'doctor empty assignment is honest');
assert(doctorProjection.lanes.find((lane) => lane.key === 'workforce')?.status === 'not_connected', 'doctor workforce lane is not connected');
assert(doctorProjection.lanes.find((lane) => lane.key === 'learning')?.route === '/workspace/viva-simulator', 'doctor learning action uses existing viva route');

assert(containsUnsafeProfessionalRecordMetadata('https://example.com/private'), 'detects private URLs');
assert(containsUnsafeProfessionalRecordMetadata('patient initials'), 'detects patient identifiers');

assert(PROFESSIONAL_RECORD_ROUTES.record.workforce === '/workspace/my-record', 'uses real workforce record route');
assert(PROFESSIONAL_RECORD_ROUTES.record.doctor === '/doctor/my-record', 'uses real doctor record route');
assert(PROFESSIONAL_RECORD_ROUTES.casebook.workforce === '/workspace/casebook-logbook', 'uses real casebook route');
assert(PROFESSIONAL_RECORD_ROUTES.cases.doctor === '/doctor/cases', 'uses real doctor cases route');
assert(PROFESSIONAL_RECORD_ROUTES.dissertation === '/workspace/dissertation', 'uses real dissertation route');
assert(PROFESSIONAL_RECORD_ROUTES.research.workforce === '/workspace/research', 'uses real research route');
assert(PROFESSIONAL_RECORD_ROUTES.examReadiness === '/workspace/exam-readiness', 'uses real exam readiness route');
assert(PROFESSIONAL_RECORD_ROUTES.review === '/workspace/consultant-review', 'keeps review route registered');

const files = [
  'src/modules/shared/lib/professionalRecordCommandCentre.ts',
  'src/modules/shared/ui/UnifiedRecordView.tsx',
  'src/modules/shared/lib/udr.ts',
].map((file) => resolve(process.cwd(), file));

for (const file of files) {
  const contents = readFileSync(file, 'utf8');
  assert(!/Olanipekun|Federal Secretariat Clinic|Ikolaba|9jaclinic|service_role|SUPABASE_SERVICE|localStorage|drive\.google\.com|docs\.google\.com|gapi|googleapis|drive\.files|docs\.documents/i.test(contents), `${file} must not hardcode people, tenants, Drive/API writes, service-role, or browser storage authority`);
}

const view = readFileSync(resolve(process.cwd(), 'src/modules/shared/ui/UnifiedRecordView.tsx'), 'utf8');
assert(view.includes("owner.kind === 'workforce' ? { workforceId: owner.id } : { doctorId: owner.id }"), 'view keeps authenticated owner-scoped UDR lookup');
assert(!view.includes('record.entries.map'), 'view does not render raw UDR entry timeline');
assert(view.includes('Record Boundaries'), 'view exposes honest overview boundaries');

const udr = readFileSync(resolve(process.cwd(), 'src/modules/shared/lib/udr.ts'), 'utf8');
assert(udr.includes(".eq('workforce_id', ref.workforceId)") || udr.includes('fetchWorkforceById'), 'UDR lookup remains workforce scoped');
assert(udr.includes(".eq('doctor_id', ref.doctorId)") || udr.includes('fetchDoctorProfile'), 'UDR lookup remains doctor scoped');

console.log('my professional record v1 verifier passed');
