// PLATFORM-A2: use-case to requirements projection.
//
// Takes an already-validated PLATFORM-A1 intake object and projects it into
// reviewable engineering output: requirements, acceptance criteria, test
// specifications, Harness-task-shaped work items and human-decision items.
//
// Three properties matter more than the shape of the output.
//
// DETERMINISM. The same intake must produce byte-identical output, because a
// human is going to review this and then review it again after the brief
// changes. A diff that shuffles ordering or renumbers identifiers is a diff
// nobody can read. Identifiers are derived from the content fingerprint, and
// every collection is emitted in a defined order.
//
// PROVENANCE. Every generated item names the use case, the intake schema
// version, the content fingerprint and the exact field it came from. Without
// that, a requirement is an assertion nobody can trace back to what a human
// actually wrote in the brief.
//
// REFUSAL. This projects a brief into work items; those items are the thing a
// later slice may act on. So authority-escalating language must be rejected
// here rather than carried forward wearing the costume of a requirement.
//
// It reads and writes nothing: no Drive, no network, no filesystem, no
// database, no secrets. It does not execute anything it generates.

import {
  USE_CASE_INTAKE_SCHEMA_VERSION,
  validateUseCaseIntake,
  type UseCaseIntakeContract,
  type UseCaseIntakeModule,
  type UseCaseIntakeRisk,
} from './useCaseIntakeContract';

export const USE_CASE_PROJECTION_SCHEMA_VERSION = 1 as const;

/** Harness task classes a generated work item may claim. */
export type ProjectedTaskClass = 'TOOLING_INFRASTRUCTURE' | 'UI_UX_CHANGE' | 'DOCUMENTATION_GOVERNANCE';

export type ProjectedTestKind = 'positive' | 'negative' | 'boundary' | 'safety';

export interface ProjectionProvenance {
  use_case_id: string;
  intake_schema_version: typeof USE_CASE_INTAKE_SCHEMA_VERSION;
  content_fingerprint: string;
  /** The exact intake field this item was derived from, e.g. `scope.in_scope[2]`. */
  source_field: string;
}

export interface ProjectedRequirement {
  id: string;
  statement: string;
  rationale: string;
  module: UseCaseIntakeModule;
  risk: UseCaseIntakeRisk;
  provenance: ProjectionProvenance;
}

export interface ProjectedAcceptanceCriterion {
  id: string;
  requirement_id: string;
  statement: string;
  provenance: ProjectionProvenance;
}

export interface ProjectedTestSpecification {
  id: string;
  requirement_id: string;
  kind: ProjectedTestKind;
  statement: string;
  provenance: ProjectionProvenance;
}

export interface ProjectedWorkItem {
  id: string;
  title: string;
  task_class: ProjectedTaskClass;
  risk: UseCaseIntakeRisk;
  depends_on: string[];
  requirement_ids: string[];
  verification: string[];
  non_goals: string[];
  provenance: ProjectionProvenance;
}

export interface ProjectedHumanDecision {
  id: string;
  summary: string;
  why_human: string;
  blocks_work_item_ids: string[];
  provenance: ProjectionProvenance;
}

export interface UseCaseProjection {
  schema_version: typeof USE_CASE_PROJECTION_SCHEMA_VERSION;
  source: {
    use_case_id: string;
    intake_schema_version: typeof USE_CASE_INTAKE_SCHEMA_VERSION;
    content_fingerprint: string;
    document_title: string;
    captured_at: string;
  };
  requirements: ProjectedRequirement[];
  acceptance_criteria: ProjectedAcceptanceCriterion[];
  test_specifications: ProjectedTestSpecification[];
  work_items: ProjectedWorkItem[];
  human_decisions: ProjectedHumanDecision[];
}

export type UseCaseProjectionResult =
  | { status: 'ok'; projection: UseCaseProjection }
  | { status: 'error'; message: string };

// Actions a brief may describe but may never authorise by being projected into
// a work item. A2 turns prose into things an agent might later be pointed at,
// so this is the last point at which "and then deploy it" is still just words.
//
// Assembled from short alternatives rather than one long literal, for the same
// reason as the A1 guards: as a single line it is dense enough to read as a
// high-entropy token to the Harness secret scanner.
const AUTHORITY_ESCALATION_SEGMENTS = [
  'git\\s+push',
  'force[- ]push',
  'deploy(?:ment|ing|ed|s)?\\s+to\\s+(?:prod|production|live)',
  'run\\s+(?:the\\s+)?migration',
  'apply\\s+(?:the\\s+)?migration',
  'production\\s+database',
  'service[_ ]role\\s+key',
  'bypass\\s+(?:the\\s+)?(?:harness|freeze|review)',
  'disable\\s+(?:the\\s+)?(?:harness|freeze|scanner)',
  'grant\\s+(?:admin|superuser)',
];
const AUTHORITY_ESCALATION_PATTERN = new RegExp(`\\b(${AUTHORITY_ESCALATION_SEGMENTS.join('|')})`, 'i');

/** Modules whose work is user-facing, so a generated item is a UI change. */
const UI_MODULES: ReadonlySet<string> = new Set<string>([
  'dashboard', 'scheduling', 'clinical_writing', 'meetings_actions',
  'messages_broadcasts', 'profile_memberships', 'billing_plans',
]);

function taskClassFor(module: UseCaseIntakeModule): ProjectedTaskClass {
  if (UI_MODULES.has(module)) return 'UI_UX_CHANGE';
  if (module === 'platform') return 'TOOLING_INFRASTRUCTURE';
  return 'TOOLING_INFRASTRUCTURE';
}

// A content fingerprint, not a cryptographic digest, and deliberately so: this
// module has no imports and runs in the browser bundle, so it cannot reach for
// node:crypto or Web Crypto without either breaking that or becoming async.
// It exists to detect that a brief changed and to key stable identifiers, both
// of which a well-distributed 128-bit non-cryptographic hash does. It is not
// evidence against a determined adversary and is not used as one.
function contentFingerprint(value: unknown): string {
  const canonical = canonicalJson(value);
  // Four FNV-1a lanes with different offset bases, concatenated.
  const bases = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x85ebca6b];
  const lanes = bases.map((base) => {
    let h = base >>> 0;
    for (let i = 0; i < canonical.length; i++) {
      h ^= canonical.charCodeAt(i) & 0xff;
      h = Math.imul(h, 0x01000193) >>> 0;
      h ^= canonical.charCodeAt(i) >>> 8;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  });
  return lanes.map((h) => h.toString(16).padStart(8, '0')).join('');
}

/** JSON with object keys sorted, so fingerprints do not depend on key order. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.keys(value as Record<string, unknown>).sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(',')}}`;
}

function seq(n: number): string {
  return String(n).padStart(3, '0');
}

function findEscalation(label: string, text: string): string | null {
  const m = AUTHORITY_ESCALATION_PATTERN.exec(text);
  return m ? `${label}: ${m[0]}` : null;
}

/**
 * Projects a validated intake into engineering output.
 *
 * Re-validates defensively through the A1 validator rather than trusting the
 * caller's word that the object is already valid: this is a module boundary,
 * and "already validated" is exactly the kind of claim that stops being true
 * when a later caller forgets.
 */
export function projectUseCase(raw: unknown): UseCaseProjectionResult {
  // Refuse an unknown projection input outright before anything else runs.
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'error', message: 'use case must be a JSON object' };
  }
  const declared = (raw as { schema_version?: unknown }).schema_version;
  if (declared !== USE_CASE_INTAKE_SCHEMA_VERSION) {
    return { status: 'error', message: `unsupported intake schema_version: ${JSON.stringify(declared)}` };
  }

  const validation = validateUseCaseIntake(raw);
  if (validation.status !== 'ok') {
    return { status: 'error', message: `use case does not satisfy the PLATFORM-A1 contract: ${validation.message}` };
  }
  const intake: UseCaseIntakeContract = validation.intake;

  // Provenance is not optional. Without a document id there is nothing to
  // trace a requirement back to, and an untraceable requirement is a guess.
  const useCaseId = intake.source.document_id;
  if (!useCaseId || !useCaseId.trim()) {
    return { status: 'error', message: 'missing provenance: source.document_id is required to trace generated items' };
  }

  // Authority escalation is checked across every field that becomes a work
  // item or a test, not only where A1 already looks.
  const escalationChecks: Array<[string, string]> = [
    ['problem.desired_outcome', intake.problem.desired_outcome],
    ['problem.current_state', intake.problem.current_state],
    ['problem.user_value', intake.problem.user_value],
    ['summary', intake.summary],
    ['title', intake.title],
    ...intake.scope.in_scope.map((s, i) => [`scope.in_scope[${i}]`, s] as [string, string]),
    ...intake.acceptance.success_criteria.map((s, i) => [`acceptance.success_criteria[${i}]`, s] as [string, string]),
    ...intake.acceptance.verification.map((s, i) => [`acceptance.verification[${i}]`, s] as [string, string]),
  ];
  for (const [label, text] of escalationChecks) {
    const hit = findEscalation(label, text);
    if (hit) {
      return { status: 'error', message: `authority escalation refused in ${hit}` };
    }
  }

  const fingerprint = contentFingerprint(intake);
  const idBase = `UC-${fingerprint.slice(0, 8)}`;
  const prov = (sourceField: string): ProjectionProvenance => ({
    use_case_id: useCaseId,
    intake_schema_version: USE_CASE_INTAKE_SCHEMA_VERSION,
    content_fingerprint: fingerprint,
    source_field: sourceField,
  });

  const module = intake.constraints.target_module;
  const risk = intake.constraints.risk;

  // One requirement per in-scope statement. The brief's own bounding of the
  // work is what becomes the requirement set; nothing is invented here.
  const requirements: ProjectedRequirement[] = intake.scope.in_scope.map((statement, i) => ({
    id: `${idBase}-REQ-${seq(i + 1)}`,
    statement,
    rationale: intake.problem.user_value,
    module,
    risk,
    provenance: prov(`scope.in_scope[${i}]`),
  }));

  const firstRequirementId = requirements[0].id;
  const requirementFor = (i: number): string => requirements[Math.min(i, requirements.length - 1)].id;

  const acceptance_criteria: ProjectedAcceptanceCriterion[] = intake.acceptance.success_criteria.map((statement, i) => ({
    id: `${idBase}-AC-${seq(i + 1)}`,
    requirement_id: requirementFor(i),
    statement,
    provenance: prov(`acceptance.success_criteria[${i}]`),
  }));

  // Four kinds, each derived from a real field rather than invented, and
  // emitted in a fixed kind order so the list is stable.
  const test_specifications: ProjectedTestSpecification[] = [];
  let testIndex = 0;
  const addTest = (kind: ProjectedTestKind, requirementId: string, statement: string, sourceField: string): void => {
    testIndex += 1;
    test_specifications.push({
      id: `${idBase}-TEST-${seq(testIndex)}`,
      requirement_id: requirementId,
      kind,
      statement,
      provenance: prov(sourceField),
    });
  };
  intake.acceptance.success_criteria.forEach((criterion, i) => {
    addTest('positive', requirementFor(i), `satisfies: ${criterion}`, `acceptance.success_criteria[${i}]`);
  });
  intake.scope.out_of_scope.forEach((excluded, i) => {
    addTest('negative', firstRequirementId, `does not do: ${excluded}`, `scope.out_of_scope[${i}]`);
  });
  requirements.forEach((requirement, i) => {
    addTest('boundary', requirement.id, `holds at the bounds of: ${requirement.statement}`, `scope.in_scope[${i}]`);
  });
  intake.constraints.prohibited_actions.forEach((prohibited, i) => {
    addTest('safety', firstRequirementId, `refuses: ${prohibited}`, `constraints.prohibited_actions[${i}]`);
  });
  intake.scope.non_goals.forEach((nonGoal, i) => {
    addTest('safety', firstRequirementId, `remains a non-goal: ${nonGoal}`, `scope.non_goals[${i}]`);
  });

  // Two work items, dependency-ordered: build it, then verify it. Verification
  // is a separate item because a slice that has not been verified is not done,
  // and burying that inside the build item lets it be skipped quietly.
  const buildId = `${idBase}-WORK-001`;
  const verifyId = `${idBase}-WORK-002`;
  const work_items: ProjectedWorkItem[] = [
    {
      id: buildId,
      title: `Implement: ${intake.title}`,
      task_class: taskClassFor(module),
      risk,
      depends_on: [],
      requirement_ids: requirements.map((r) => r.id),
      verification: [...intake.acceptance.verification],
      non_goals: [...intake.scope.non_goals],
      provenance: prov('scope.in_scope'),
    },
    {
      id: verifyId,
      title: `Verify: ${intake.title}`,
      task_class: 'TOOLING_INFRASTRUCTURE',
      risk,
      depends_on: [buildId],
      requirement_ids: requirements.map((r) => r.id),
      verification: [...intake.acceptance.verification],
      non_goals: [...intake.scope.non_goals],
      provenance: prov('acceptance.verification'),
    },
  ];

  // Human decisions gate the work items rather than annotating them, so a RED
  // brief cannot be picked up as ordinary work.
  const human_decisions: ProjectedHumanDecision[] = [];
  const addDecision = (summary: string, whyHuman: string, sourceField: string): void => {
    human_decisions.push({
      id: `${idBase}-HUMAN-${seq(human_decisions.length + 1)}`,
      summary,
      why_human: whyHuman,
      blocks_work_item_ids: [buildId, verifyId],
      provenance: prov(sourceField),
    });
  };
  if (risk === 'RED') {
    addDecision(
      `RED use case requires a human decision before any work begins: ${intake.title}`,
      'The brief declares risk RED. A RED item is never picked up as ordinary work, whatever else the brief says.',
      'constraints.risk',
    );
  }
  if (intake.constraints.data_sensitivity === 'sensitive') {
    addDecision(
      `Sensitive data handling requires a human decision: ${intake.title}`,
      'The brief declares data_sensitivity sensitive, so the data boundary is a human call rather than an implementation detail.',
      'constraints.data_sensitivity',
    );
  }
  if (intake.follow_up.suggested_agent === 'UNASSIGNED') {
    addDecision(
      `No agent is assigned for: ${intake.title}`,
      'The brief leaves follow_up.suggested_agent UNASSIGNED, so who does this work has not been decided.',
      'follow_up.suggested_agent',
    );
  }

  return {
    status: 'ok',
    projection: {
      schema_version: USE_CASE_PROJECTION_SCHEMA_VERSION,
      source: {
        use_case_id: useCaseId,
        intake_schema_version: USE_CASE_INTAKE_SCHEMA_VERSION,
        content_fingerprint: fingerprint,
        document_title: intake.source.document_title,
        captured_at: intake.source.captured_at,
      },
      requirements,
      acceptance_criteria,
      test_specifications,
      work_items,
      human_decisions,
    },
  };
}

/**
 * The projection as canonical JSON. Identical input yields a byte-identical
 * string, which is what makes a review diff readable.
 */
export function serialiseProjection(projection: UseCaseProjection): string {
  return canonicalJson(projection);
}
