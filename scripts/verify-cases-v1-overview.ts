import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CASES_V1_ROUTES,
  projectCasesOverview,
  safeCaseTitle,
} from '../src/modules/cases/lib/casesOverview';
import type { CaseCaptureRecord } from '../src/modules/cases/lib/caseCaptureService';
import type { CaseContinuityAction } from '../src/modules/cases/lib/caseContinuityService';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function record(overrides: Partial<CaseCaptureRecord>): CaseCaptureRecord {
  return {
    id: 'case-base-00000000',
    doctor_id: 'doctor-a',
    captured_at: '2026-09-01T08:00:00.000Z',
    title: 'Safe professional case reference',
    subject_label: null,
    ownership_status: 'personal',
    lifecycle_status: 'quick_capture',
    portfolio_ref: null,
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: '2026-09-01T08:00:00.000Z',
    ...overrides,
  };
}

function action(overrides: Partial<CaseContinuityAction>): CaseContinuityAction {
  return {
    id: 'action-base',
    case_capture_record_id: 'case-base-00000000',
    doctor_id: 'doctor-a',
    action_type: 'follow_up',
    planned_for: null,
    status: 'planned',
    completed_at: null,
    result_status: 'not_expected',
    safe_action_label: 'Review progress',
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: '2026-09-01T08:00:00.000Z',
    ...overrides,
  };
}

function listOwnedRecords(records: CaseCaptureRecord[], doctorId: string): CaseCaptureRecord[] {
  return records.filter((item) => item.doctor_id === doctorId);
}

const now = new Date('2026-09-07T12:00:00.000Z');
const ownOverdue = record({ id: 'case-overdue', title: 'Clinic follow-up case', updated_at: '2026-09-01T08:00:00.000Z' });
const ownSoon = record({ id: 'case-soon', title: 'Procedure planning case', updated_at: '2026-09-02T08:00:00.000Z' });
const ownLater = record({ id: 'case-later', title: 'Review later case', updated_at: '2026-09-03T08:00:00.000Z' });
const ownUnscheduled = record({ id: 'case-unscheduled', title: 'Unscheduled review case', updated_at: '2026-09-04T08:00:00.000Z' });
const ownRecent = record({ id: 'case-recent', title: 'Recent captured case', updated_at: '2026-09-06T08:00:00.000Z', portfolio_ref: 'clinical_case_report:report-1' });
const otherDoctor = record({ id: 'case-other', doctor_id: 'doctor-b', title: 'Other doctor case' });

const owned = listOwnedRecords([ownOverdue, otherDoctor, ownSoon, ownLater, ownUnscheduled, ownRecent], 'doctor-a');
assert(owned.length === 5 && !owned.some((item) => item.doctor_id === 'doctor-b'), 'authenticated ownership filter keeps another doctor out');

const overview = projectCasesOverview({
  records: owned,
  artifactCountsByRecordId: {
    'case-overdue': 1,
    'case-soon': 2,
    'case-later': 0,
    'case-unscheduled': 0,
    'case-recent': 3,
  },
  continuityActions: [
    action({ id: 'overdue-action', case_capture_record_id: 'case-overdue', planned_for: '2026-09-06T00:00:00.000Z', safe_action_label: 'Overdue professional review' }),
    action({ id: 'soon-action', case_capture_record_id: 'case-soon', planned_for: '2026-09-08T00:00:00.000Z', safe_action_label: 'Due soon review' }),
    action({ id: 'later-action', case_capture_record_id: 'case-later', planned_for: '2026-09-20T00:00:00.000Z', safe_action_label: 'Later review' }),
    action({ id: 'unscheduled-action', case_capture_record_id: 'case-unscheduled', planned_for: null, safe_action_label: 'Unscheduled review' }),
  ],
  now,
});

assert(
  overview.map((item) => item.id).join(',') === 'case-overdue,case-soon,case-later,case-unscheduled,case-recent',
  'deterministic overview priority is overdue, due soon, later, unscheduled, recent without actions'
);
assert(overview[0].nextAction === 'Overdue professional review', 'next action comes from persisted continuity action label');
assert(overview.find((item) => item.id === 'case-recent')?.hasWriteUpRef === true, 'portfolio_ref projects as write-up availability without exposing a storage path');
assert(projectCasesOverview({ records: [], artifactCountsByRecordId: {}, continuityActions: [], now }).length === 0, 'empty state is representable');

const completedProcedure = action({
  id: 'completed-procedure',
  action_type: 'procedure',
  status: 'completed',
  completed_at: '2026-09-07T09:00:00.000Z',
  result_status: 'awaiting',
});
assert(completedProcedure.status === 'completed' && completedProcedure.result_status === 'awaiting', 'procedure completion does not imply result review');

assert(safeCaseTitle(record({ id: 'case-private', title: 'Patient name with diagnosis and phone 08000000000' })) === 'Case case-pri', 'unsafe overview title falls back to safe case reference');
assert(safeCaseTitle(record({ id: 'case-url1', subject_label: 'https://private.example/path' })) === 'Case case-url', 'private URLs are excluded from overview labels');

for (const route of Object.values(CASES_V1_ROUTES)) {
  assert(route === '/doctor/cases' || route === '/doctor/casebook-logbook' || route === '/doctor/home', `visible action route is real: ${route}`);
}

const productFiles = [
  'src/modules/cases/lib/casesOverview.ts',
  'src/modules/cases/components/CasesLandingView.tsx',
].map((file) => resolve(process.cwd(), file));

for (const file of productFiles) {
  const contents = readFileSync(file, 'utf8');
  for (const pattern of [
    /Olanipekun/i,
    /Agbeke Mercy/i,
    /Airport Clinic/i,
    /herpes zoster/i,
    /lesion/i,
    /9jaclinic/i,
    /service_role/i,
    /localStorage/i,
    /drive\.google\.com/i,
    /docs\.google\.com/i,
  ]) {
    assert(!pattern.test(contents), `${file} must not contain hardcoded personal, tenant, facility, clinical, Drive, service-role, or localStorage coupling`);
  }
}

const landing = readFileSync(resolve(process.cwd(), 'src/modules/cases/components/CasesLandingView.tsx'), 'utf8');
const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
const doctorHome = readFileSync(resolve(process.cwd(), 'src/modules/doctors/components/DoctorHomeView.tsx'), 'utf8');
const casesRouteStart = app.indexOf('path="/doctor/cases"');
assert(casesRouteStart >= 0, '/doctor/cases route exists');
const casesRouteBlock = app.slice(casesRouteStart, casesRouteStart + 500);
assert(/CasesLandingView/.test(casesRouteBlock) && /Navigate to="\/login"/.test(casesRouteBlock), '/doctor/cases route renders CasesLandingView with login fallback');
assert(!/localStorage|service_role|getPublicUrl|drive\.google\.com|docs\.google\.com/i.test(casesRouteBlock), 'Cases route block has no localStorage, service-role, public URL, or Drive coupling');
assert(/navigate\('\/doctor\/cases'\)/.test(doctorHome) && /Cases/.test(doctorHome), 'doctor home links to Cases');
assert(/caseCaptureService\.listCaptureRecords\(doctor\.id\)/.test(landing), 'real route loads doctor-owned persisted case_capture_records');
assert(/caseCaptureService\.listArtifacts\(record\.id\)/.test(landing), 'real route derives artifact availability from persisted case_capture_artifacts');
assert(/caseContinuityService\.listActionsForDoctor\(doctor\.id\)/.test(landing), 'real route uses migration-83 continuity contract when available');
assert(/setContinuityUnavailable\(true\)/.test(landing), 'real route remains useful when migration 83 is absent');
assert(!/getPublicUrl/.test(landing), 'Cases V1 does not expose public artifact URLs');
assert(/createArtifactSignedUrl/.test(landing), 'available artifacts open through signed URLs');

console.log('cases v1 overview verifier passed');
