import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  classifyFieldworkFinding,
  createAdvisoryFieldworkReadiness,
  createFieldworkReadinessTemplate,
  type FieldworkReadinessConfig,
} from '../src/modules/research/lib/fieldworkReadiness';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const approvedPretest: FieldworkReadinessConfig = {
  tenantId: 'tenant-pretest',
  projectRef: 'approved-pretest',
  studyPhase: 'pretest',
  activityType: 'pretest',
  sampleTarget: 20,
  population: 'Married men aged at least 25 years, no upper age limit',
  site: 'Federal Secretariat Clinic, Ikolaba',
  instruments: ['Approved English instrument', 'Approved Yoruba instrument'],
  languages: ['English', 'Yoruba'],
  procedures: [
    { key: 'fbs', label: 'FBS with return visit when not fasting', resultExpected: true },
    { key: 'no-rbs-substitution', label: 'No RBS substitution', resultExpected: false },
  ],
  approvals: {
    proposalApproved: true,
    protocolPackConfirmed: false,
  },
  raTraining: {
    required: true,
    competencySignedOff: false,
    roleLabel: 'Trained male research assistant',
  },
  dataRules: {
    missingResponsesRule: 'Leave missing responses blank and record reason separately',
    returnVisitRule: 'Return visit when participant is not fasting',
  },
};

const secondTenantPilot: FieldworkReadinessConfig = {
  tenantId: 'tenant-fictional',
  projectRef: 'antenatal-pilot',
  studyPhase: 'pilot',
  activityType: 'pilot',
  sampleTarget: 35,
  population: 'Antenatal clinic attendees aged 18 years and above',
  site: 'Community Maternal Health Centre',
  instruments: ['Tablet-administered questionnaire'],
  languages: ['English', 'Hausa'],
  procedures: [
    { key: 'blood-pressure', label: 'Blood pressure measurement', resultExpected: false },
    { key: 'daily-upload', label: 'Daily encrypted data upload check', resultExpected: false },
  ],
  approvals: {
    proposalApproved: true,
    protocolPackConfirmed: true,
  },
  raTraining: {
    required: true,
    competencySignedOff: true,
    roleLabel: 'Nurse research assistant',
  },
  dataRules: {
    missingResponsesRule: 'Use coded missing-data reason selected by interviewer',
  },
};

const pretestReadiness = createFieldworkReadinessTemplate(approvedPretest);
assert(pretestReadiness.templateKey === 'research_fieldwork_readiness_v1', 'uses reusable template key');
assert(pretestReadiness.studyPhase === 'pretest' && pretestReadiness.activityType === 'pretest', 'pretest remains distinct');
assert(pretestReadiness.sampleTarget === 20, 'pretest target is preserved');
assert(pretestReadiness.nextAction === 'Confirm approved field pack before fieldwork.', 'field-pack confirmation is first pretest action before RA sign-off');
assert(!pretestReadiness.readyForNextPhase, 'missing evidence does not become complete');

const pretestAfterPack = createFieldworkReadinessTemplate({
  ...approvedPretest,
  approvals: { ...approvedPretest.approvals, protocolPackConfirmed: true },
});
assert(pretestAfterPack.nextAction === 'Trained male research assistant competency sign-off is required.', 'RA sign-off is next action once field pack is confirmed');

const pilotReadiness = createFieldworkReadinessTemplate(secondTenantPilot, [
  classifyFieldworkFinding({
    id: 'daily-sync-friction',
    summary: 'Daily upload checklist needs clearer timing',
    disposition: 'training_data_system_correction',
  }),
]);
assert(pilotReadiness.tenantId === 'tenant-fictional', 'second tenant id is preserved');
assert(pilotReadiness.projectRef === 'antenatal-pilot', 'second tenant project ref is preserved');
assert(pilotReadiness.studyPhase === 'pilot' && pilotReadiness.activityType === 'pilot', 'pilot remains distinct from pretest');
assert(pretestReadiness.tenantId !== pilotReadiness.tenantId, 'one tenant configuration does not leak into another');
assert(JSON.stringify(pretestReadiness).includes('antenatal-pilot') === false, 'second tenant project does not leak into pretest output');

const materialFinding = classifyFieldworkFinding({
  id: 'eligibility-change',
  summary: 'Proposed eligibility expansion needs approval',
  disposition: 'material_amendment_requires_approval',
});
const blocked = createFieldworkReadinessTemplate({
  ...secondTenantPilot,
  sampleTarget: 400,
}, [materialFinding]);
assert(!blocked.readyForNextPhase, 'material amendment blocks next-phase readiness without approval evidence');

const approvedMaterialFinding = classifyFieldworkFinding({
  ...materialFinding,
  approvalEvidenceRecorded: true,
});
const unblocked = createFieldworkReadinessTemplate({
  ...secondTenantPilot,
  sampleTarget: 400,
}, [approvedMaterialFinding]);
assert(unblocked.findings[0].approvalEvidenceRecorded === true, 'approval evidence is preserved when supplied');

for (const disposition of [
  'no_change',
  'minor_implementation_refinement',
  'training_data_system_correction',
  'material_amendment_requires_approval',
] as const) {
  const finding = classifyFieldworkFinding({ id: disposition, summary: `Observed friction ${disposition}`, disposition });
  assert(finding.disposition === disposition, `supports finding disposition ${disposition}`);
}

assert(JSON.stringify(createFieldworkReadinessTemplate(approvedPretest)) === JSON.stringify(createFieldworkReadinessTemplate(approvedPretest)), 'deterministic input produces deterministic output');

const advisory = createAdvisoryFieldworkReadiness('dissertation-record', { proposalApproved: true });
assert(advisory.nextAction === 'Confirm approved field pack before fieldwork.', 'approved proposal evidence moves advisory next action to field-pack confirmation');
assert(advisory.lanes.some((lane) => lane.key === 'population_target' && lane.state === 'verify_in_pack'), 'advisory placeholders do not count as completed population evidence');

for (const unsafe of [
  { ...approvedPretest, site: 'https://example.test/private-pack' },
  { ...approvedPretest, population: 'patient name and phone number' },
  { ...approvedPretest, procedures: [{ key: 'raw', label: 'raw note photograph review', resultExpected: true }] },
] as FieldworkReadinessConfig[]) {
  let rejected = false;
  try {
    createFieldworkReadinessTemplate(unsafe);
  } catch {
    rejected = true;
  }
  assert(rejected, 'unsafe participant identifiers, clinical narratives, private URLs, or photo metadata are rejected');
}

let unknownFieldRejected = false;
try {
  createFieldworkReadinessTemplate({ ...approvedPretest, credentialAuthority: 'service-role' } as unknown as FieldworkReadinessConfig);
} catch {
  unknownFieldRejected = true;
}
assert(unknownFieldRejected, 'unknown and unsafe fields are rejected');

let nestedUnknownFieldRejected = false;
try {
  createFieldworkReadinessTemplate({
    ...approvedPretest,
    dataRules: { ...approvedPretest.dataRules, privateDriveUrl: 'not allowed' },
  } as unknown as FieldworkReadinessConfig);
} catch {
  nestedUnknownFieldRejected = true;
}
assert(nestedUnknownFieldRejected, 'nested unknown fields are rejected');

let conflationRejected = false;
try {
  createFieldworkReadinessTemplate({ ...approvedPretest, activityType: 'pilot' });
} catch {
  conflationRejected = true;
}
assert(conflationRejected, 'pretest and pilot cannot be conflated');

const productFiles = [
  'src/modules/research/lib/fieldworkReadiness.ts',
  'src/modules/research/components/FieldworkReadinessPanel.tsx',
  'src/modules/dissertation/components/DissertationAssistantView.tsx',
].map((file) => resolve(process.cwd(), file));

for (const file of productFiles) {
  const contents = readFileSync(file, 'utf8');
  for (const pattern of [/Olanipekun/i, /9jaclinic/i, /service_role/i, /drive\.google\.com/i, /docs\.google\.com/i, /localStorage/i]) {
    assert(!pattern.test(contents), `${file} must not contain identity, credential, Drive, or localStorage coupling`);
  }
}

console.log('fieldwork readiness verifier passed');
