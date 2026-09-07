export type FieldworkStudyPhase = 'pretest' | 'pilot' | 'main_fieldwork';
export type FieldworkActivityType = 'pretest' | 'pilot' | 'main_fieldwork';
export type ReadinessEvidenceState = 'complete' | 'missing' | 'verify_in_pack' | 'not_applicable';
export type FindingDisposition = 'no_change' | 'minor_implementation_refinement' | 'training_data_system_correction' | 'material_amendment_requires_approval';

export interface FieldworkProcedureConfig {
  key: string;
  label: string;
  resultExpected: boolean;
}

export interface FieldworkReadinessConfig {
  tenantId: string;
  projectRef: string;
  studyPhase: FieldworkStudyPhase;
  activityType: FieldworkActivityType;
  sampleTarget: number;
  population: string;
  site: string;
  instruments: string[];
  languages: string[];
  procedures: FieldworkProcedureConfig[];
  approvals: {
    proposalApproved: boolean;
    protocolPackConfirmed: boolean;
    materialAmendmentApprovalRecorded?: boolean;
  };
  raTraining: {
    required: boolean;
    competencySignedOff: boolean;
    roleLabel: string;
  };
  dataRules: {
    missingResponsesRule: string;
    returnVisitRule?: string;
  };
  evidence?: {
    siteLogisticsRecorded?: boolean;
    populationTargetRecorded?: boolean;
    instrumentsLanguagesRecorded?: boolean;
    measurementProceduresRecorded?: boolean;
    missingDataRulesRecorded?: boolean;
    dailyQualityAssuranceRecorded?: boolean;
    findingsDocumented?: boolean;
  };
}

export interface FieldworkEvidence {
  key: string;
  label: string;
  state: ReadinessEvidenceState;
  blocker?: string;
}

export interface FieldworkFinding {
  id: string;
  summary: string;
  disposition: FindingDisposition;
  approvalEvidenceRecorded?: boolean;
}

export interface FieldworkReadinessDefinition {
  templateKey: 'research_fieldwork_readiness_v1';
  tenantId: string;
  projectRef: string;
  studyPhase: FieldworkStudyPhase;
  activityType: FieldworkActivityType;
  sampleTarget: number;
  lanes: FieldworkEvidence[];
  findings: FieldworkFinding[];
  nextAction: string;
  readyForNextPhase: boolean;
}

const ALLOWED_CONFIG_KEYS = new Set([
  'tenantId',
  'projectRef',
  'studyPhase',
  'activityType',
  'sampleTarget',
  'population',
  'site',
  'instruments',
  'languages',
  'procedures',
  'approvals',
  'raTraining',
  'dataRules',
  'evidence',
]);

const UNSAFE_METADATA = /\b(?:https?:\/\/|service[-_ ]?role|secret|password|phone|address|hospital number|raw note|photograph|photo|patient name|clinical narrative)\b/i;
const ALLOWED_APPROVAL_KEYS = new Set(['proposalApproved', 'protocolPackConfirmed', 'materialAmendmentApprovalRecorded']);
const ALLOWED_RA_TRAINING_KEYS = new Set(['required', 'competencySignedOff', 'roleLabel']);
const ALLOWED_DATA_RULE_KEYS = new Set(['missingResponsesRule', 'returnVisitRule']);
const ALLOWED_PROCEDURE_KEYS = new Set(['key', 'label', 'resultExpected']);
const ALLOWED_EVIDENCE_KEYS = new Set([
  'siteLogisticsRecorded',
  'populationTargetRecorded',
  'instrumentsLanguagesRecorded',
  'measurementProceduresRecorded',
  'missingDataRulesRecorded',
  'dailyQualityAssuranceRecorded',
  'findingsDocumented',
]);

function assertSafeText(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${field} is required.`);
  if (UNSAFE_METADATA.test(trimmed)) throw new Error(`${field} contains unsafe readiness metadata.`);
  return trimmed;
}

function assertKnownKeys(config: Record<string, unknown>): void {
  for (const key of Object.keys(config)) {
    if (!ALLOWED_CONFIG_KEYS.has(key)) throw new Error(`Unknown fieldwork readiness config field: ${key}`);
  }
}

function assertKnownObjectKeys(object: Record<string, unknown>, allowed: Set<string>, objectName: string): void {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) throw new Error(`Unknown ${objectName} field: ${key}`);
  }
}

function lane(
  key: string,
  label: string,
  complete: boolean,
  blocker: string,
  incompleteState: ReadinessEvidenceState = 'missing'
): FieldworkEvidence {
  return {
    key,
    label,
    state: complete ? 'complete' : incompleteState,
    blocker: complete ? undefined : blocker,
  };
}

function hasBlockingFinding(findings: FieldworkFinding[]): boolean {
  return findings.some(
    (finding) => finding.disposition === 'material_amendment_requires_approval' && !finding.approvalEvidenceRecorded
  );
}

export function classifyFieldworkFinding(input: {
  id: string;
  summary: string;
  disposition: FindingDisposition;
  approvalEvidenceRecorded?: boolean;
}): FieldworkFinding {
  return {
    id: assertSafeText(input.id, 'finding id'),
    summary: assertSafeText(input.summary, 'finding summary'),
    disposition: input.disposition,
    approvalEvidenceRecorded: input.approvalEvidenceRecorded ?? false,
  };
}

export function createFieldworkReadinessTemplate(
  config: FieldworkReadinessConfig,
  findings: FieldworkFinding[] = []
): FieldworkReadinessDefinition {
  assertKnownKeys(config as unknown as Record<string, unknown>);
  if (config.studyPhase !== config.activityType && (config.studyPhase === 'pretest' || config.activityType === 'pretest')) {
    throw new Error('Pretest and pilot/main fieldwork must remain distinct.');
  }
  if (!Number.isInteger(config.sampleTarget) || config.sampleTarget < 1) throw new Error('sampleTarget must be a positive integer.');

  const population = assertSafeText(config.population, 'population');
  const site = assertSafeText(config.site, 'site');
  assertKnownObjectKeys(config.approvals as unknown as Record<string, unknown>, ALLOWED_APPROVAL_KEYS, 'approvals');
  assertKnownObjectKeys(config.raTraining as unknown as Record<string, unknown>, ALLOWED_RA_TRAINING_KEYS, 'research assistant training');
  assertKnownObjectKeys(config.dataRules as unknown as Record<string, unknown>, ALLOWED_DATA_RULE_KEYS, 'data rules');
  if (config.evidence) assertKnownObjectKeys(config.evidence as unknown as Record<string, unknown>, ALLOWED_EVIDENCE_KEYS, 'evidence');
  const instruments = config.instruments.map((instrument) => assertSafeText(instrument, 'instrument'));
  const languages = config.languages.map((language) => assertSafeText(language, 'language'));
  const raRoleLabel = assertSafeText(config.raTraining.roleLabel, 'research assistant role label');
  const missingResponsesRule = assertSafeText(config.dataRules.missingResponsesRule, 'missing responses rule');
  if (config.dataRules.returnVisitRule) assertSafeText(config.dataRules.returnVisitRule, 'return visit rule');

  const procedures = config.procedures.map((procedure) => {
    assertKnownObjectKeys(procedure as unknown as Record<string, unknown>, ALLOWED_PROCEDURE_KEYS, 'procedure');
    return {
      key: assertSafeText(procedure.key, 'procedure key'),
      label: assertSafeText(procedure.label, 'procedure label'),
      resultExpected: procedure.resultExpected,
    };
  });
  const evidence = config.evidence ?? {};

  const lanes: FieldworkEvidence[] = [
    lane('approval_protocol', 'Approval and protocol controls', config.approvals.proposalApproved, 'Verify proposal approval in approved research pack.'),
    lane('field_pack', 'Field pack confirmation', config.approvals.protocolPackConfirmed, 'Confirm approved field pack before fieldwork.'),
    lane('site_logistics', 'Site and logistics', evidence.siteLogisticsRecorded ?? !!site, 'Verify the approved field site and logistics in the approved research pack.', 'verify_in_pack'),
    lane('population_target', 'Population and sample target', evidence.populationTargetRecorded ?? (!!population && config.sampleTarget > 0), 'Verify eligible population and sample target in the approved research pack.', 'verify_in_pack'),
    lane('ra_training', 'Research-assistant competency', !config.raTraining.required || config.raTraining.competencySignedOff, `${raRoleLabel} competency sign-off is required.`),
    lane('instruments_languages', 'Instruments and language versions', evidence.instrumentsLanguagesRecorded ?? (instruments.length > 0 && languages.length > 0), 'Confirm approved instruments and language versions.'),
    lane('measurement_return_visit', 'Measurements and return visits', evidence.measurementProceduresRecorded ?? procedures.length > 0, 'Record approved measurement and return-visit procedures.'),
    lane('missing_data_rules', 'Missing-data rules', evidence.missingDataRulesRecorded ?? !!missingResponsesRule, 'Record missing-data rule separately from responses.'),
    lane('daily_quality_assurance', 'Daily quality assurance', evidence.dailyQualityAssuranceRecorded ?? false, 'Not yet recorded in Workspc.'),
    lane('findings_disposition', 'Findings and disposition', (evidence.findingsDocumented ?? findings.length > 0) && !hasBlockingFinding(findings), 'Document, classify and disposition pretest findings.'),
  ];

  const blocker = lanes.find((item) => item.state !== 'complete')?.blocker;
  const nextAction = blocker ?? 'Ready for next phase, subject to authoritative approval evidence.';

  return {
    templateKey: 'research_fieldwork_readiness_v1',
    tenantId: assertSafeText(config.tenantId, 'tenant id'),
    projectRef: assertSafeText(config.projectRef, 'project reference'),
    studyPhase: config.studyPhase,
    activityType: config.activityType,
    sampleTarget: config.sampleTarget,
    lanes,
    findings,
    nextAction,
    readyForNextPhase: lanes.every((item) => item.state === 'complete') && !hasBlockingFinding(findings),
  };
}

export function createAdvisoryFieldworkReadiness(
  projectRef: string,
  evidence: { proposalApproved?: boolean } = {}
): FieldworkReadinessDefinition {
  return createFieldworkReadinessTemplate({
    tenantId: 'current-workspace',
    projectRef,
    studyPhase: 'pretest',
    activityType: 'pretest',
    sampleTarget: 1,
    population: 'Verify in approved research pack',
    site: 'Verify in approved research pack',
    instruments: [],
    languages: [],
    procedures: [],
    approvals: {
      proposalApproved: evidence.proposalApproved ?? false,
      protocolPackConfirmed: false,
    },
    raTraining: {
      required: true,
      competencySignedOff: false,
      roleLabel: 'Research assistant',
    },
    dataRules: {
      missingResponsesRule: 'Verify in approved research pack',
    },
    evidence: {
      siteLogisticsRecorded: false,
      populationTargetRecorded: false,
      instrumentsLanguagesRecorded: false,
      measurementProceduresRecorded: false,
      missingDataRulesRecorded: false,
      dailyQualityAssuranceRecorded: false,
      findingsDocumented: false,
    },
  });
}
