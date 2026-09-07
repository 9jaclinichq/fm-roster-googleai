#!/usr/bin/env tsx
// PLATFORM-A2: dependency-free verification for the use-case requirements
// projection. No Drive access, network, database, migration, deploy or
// production write occurs here.
//
// The refusal checks carry most of the weight. Projecting a brief into work
// items is the step where prose starts to look like instructions, so the
// tests that matter are the ones proving a brief cannot smuggle authority
// through that step.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  projectUseCase,
  serialiseProjection,
  USE_CASE_PROJECTION_SCHEMA_VERSION,
  type UseCaseProjection,
} from '../src/modules/platform/lib/useCaseRequirementsProjection';
import type { UseCaseIntakeContract } from '../src/modules/platform/lib/useCaseIntakeContract';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
let failures = 0;

function check(label: string, condition: boolean): void {
  if (condition) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function ok(result: ReturnType<typeof projectUseCase>): UseCaseProjection {
  if (result.status !== 'ok') throw new Error(`expected a projection, got: ${result.message}`);
  return result.projection;
}

const validIntake: UseCaseIntakeContract = {
  schema_version: 1,
  title: 'Capture ward handover actions from a Drive-authored brief',
  summary: 'Convert a structured human-authored use-case brief into bounded platform intake.',
  source: {
    kind: 'google_drive_document',
    document_id: 'drive-doc-opaque-id',
    document_title: 'Ward Handover Use Case',
    revision_id: 'rev-001',
    captured_at: '2026-09-05T09:00:00.000Z',
  },
  problem: {
    actor: 'Clinical programme administrator',
    current_state: 'Use cases are described in prose before they become tasks.',
    desired_outcome: 'The prose becomes reviewable requirements and tests.',
    user_value: 'Reviewers reason over consistent fields instead of rereading a document.',
  },
  scope: {
    in_scope: ['Normalise the brief into requirements', 'Derive test specifications from the brief'],
    out_of_scope: ['Read or write Google Drive', 'Execute the generated work items'],
    non_goals: ['Apply migrations', 'Change production data'],
  },
  acceptance: {
    success_criteria: ['A valid brief yields requirements with provenance', 'Identical input yields identical output'],
    verification: ['Run the PLATFORM-A2 projection verification script', 'Run TypeScript and build verification'],
  },
  constraints: {
    risk: 'GREEN',
    target_module: 'platform',
    dependencies: ['PLATFORM-A1'],
    prohibited_actions: ['push', 'deploy', 'production migration'],
    data_sensitivity: 'operational',
  },
  follow_up: {
    suggested_task_id: 'PLATFORM-A3',
    suggested_agent: 'CLAUDE',
    notes: ['Drive retrieval is a later bounded slice.'],
  },
};

// ---- positive ------------------------------------------------------------

check('projection source file exists in the platform module boundary',
  fs.existsSync(path.join(REPO_ROOT, 'src/modules/platform/lib/useCaseRequirementsProjection.ts')));

const projection = ok(projectUseCase(validIntake));
check('a valid brief projects successfully', projection.schema_version === USE_CASE_PROJECTION_SCHEMA_VERSION);
check('one requirement is produced per in-scope statement',
  projection.requirements.length === validIntake.scope.in_scope.length);
check('one acceptance criterion is produced per success criterion',
  projection.acceptance_criteria.length === validIntake.acceptance.success_criteria.length);
check('every acceptance criterion references a requirement that exists',
  projection.acceptance_criteria.every((ac) => projection.requirements.some((r) => r.id === ac.requirement_id)));
check('all four test kinds are produced',
  (['positive', 'negative', 'boundary', 'safety'] as const)
    .every((kind) => projection.test_specifications.some((t) => t.kind === kind)));
check('every test specification references a requirement that exists',
  projection.test_specifications.every((t) => projection.requirements.some((r) => r.id === t.requirement_id)));
check('work items are dependency-ordered: verification depends on implementation',
  projection.work_items.length === 2
  && projection.work_items[0].depends_on.length === 0
  && projection.work_items[1].depends_on[0] === projection.work_items[0].id);
check('no work item depends on an item that does not exist',
  projection.work_items.every((w) => w.depends_on.every((d) => projection.work_items.some((x) => x.id === d))));

// ---- provenance ----------------------------------------------------------

const allItems = [
  ...projection.requirements, ...projection.acceptance_criteria,
  ...projection.test_specifications, ...projection.work_items, ...projection.human_decisions,
];
check('every generated item carries the source use-case id, schema version and fingerprint',
  allItems.length > 0 && allItems.every((i) =>
    i.provenance.use_case_id === validIntake.source.document_id
    && i.provenance.intake_schema_version === 1
    && typeof i.provenance.content_fingerprint === 'string'
    && i.provenance.content_fingerprint.length === 32));
check('every generated item names the exact intake field it came from',
  allItems.every((i) => typeof i.provenance.source_field === 'string' && i.provenance.source_field.length > 0));
check('every generated identifier is unique',
  new Set(allItems.map((i) => i.id)).size === allItems.length);

// ---- determinism ---------------------------------------------------------

const again = ok(projectUseCase(clone(validIntake)));
check('identical input yields byte-identical output',
  serialiseProjection(projection) === serialiseProjection(again));
check('identical input yields identical identifiers',
  projection.requirements[0].id === again.requirements[0].id);

const reordered = clone(validIntake);
// Same content, different key insertion order: the fingerprint must not move.
const reorderedSource = { captured_at: reordered.source.captured_at, kind: reordered.source.kind, document_title: reordered.source.document_title, revision_id: reordered.source.revision_id, document_id: reordered.source.document_id };
(reordered as unknown as { source: unknown }).source = reorderedSource;
check('the fingerprint does not depend on object key order',
  ok(projectUseCase(reordered)).source.content_fingerprint === projection.source.content_fingerprint);

const changed = clone(validIntake);
changed.problem.desired_outcome = 'A materially different outcome.';
const changedProjection = ok(projectUseCase(changed));
check('changed content produces a different fingerprint and different identifiers',
  changedProjection.source.content_fingerprint !== projection.source.content_fingerprint
  && changedProjection.requirements[0].id !== projection.requirements[0].id);

// ---- negative and boundary ----------------------------------------------

check('a non-object is rejected', projectUseCase(null).status === 'error' && projectUseCase([] as unknown).status === 'error');

const wrongVersion = clone(validIntake) as unknown as { schema_version: number };
wrongVersion.schema_version = 2;
const wrongVersionResult = projectUseCase(wrongVersion);
check('an unknown schema version is rejected by name',
  wrongVersionResult.status === 'error' && /unsupported intake schema_version/.test(wrongVersionResult.message));

const invalid = clone(validIntake);
invalid.scope.in_scope = [];
const invalidResult = projectUseCase(invalid);
check('input that fails the PLATFORM-A1 contract is rejected, not projected',
  invalidResult.status === 'error' && /PLATFORM-A1 contract/.test(invalidResult.message));

const noProvenance = clone(validIntake);
noProvenance.source.document_id = '   ';
const noProvenanceResult = projectUseCase(noProvenance);
check('a brief without a usable document id is rejected as missing provenance',
  noProvenanceResult.status === 'error' && /(missing provenance|PLATFORM-A1 contract)/.test(noProvenanceResult.message));

const unknownField = { ...clone(validIntake), extra_authority: 'grant admin' };
check('an unexpected top-level field is rejected via the A1 contract',
  projectUseCase(unknownField).status === 'error');

// ---- safety: authority escalation ---------------------------------------

const escalations: Array<[string, (i: UseCaseIntakeContract) => void]> = [
  ['scope.in_scope', (i) => { i.scope.in_scope[0] = 'Implement the feature and then git push to origin'; }],
  ['acceptance.success_criteria', (i) => { i.acceptance.success_criteria[0] = 'The change is deployed to production'; }],
  ['acceptance.verification', (i) => { i.acceptance.verification[0] = 'Run the migration against the production database'; }],
  ['problem.desired_outcome', (i) => { i.problem.desired_outcome = 'Bypass the harness so the work lands faster'; }],
  ['summary', (i) => { i.summary = 'A slice that will disable the scanner to reduce noise'; }],
];
for (const [label, mutate] of escalations) {
  const hostile = clone(validIntake);
  mutate(hostile);
  const result = projectUseCase(hostile);
  check(`authority escalation in ${label} is refused rather than projected into a work item`,
    result.status === 'error' && /authority escalation refused/.test(result.message));
}

// A brief may still legitimately DECLARE these as prohibited actions; naming
// something as forbidden is the opposite of demanding it.
const declaresProhibited = clone(validIntake);
declaresProhibited.constraints.prohibited_actions = ['git push', 'deployment to production', 'run the migration'];
check('declaring an action as prohibited is not itself treated as escalation',
  projectUseCase(declaresProhibited).status === 'ok');

// ---- human decisions -----------------------------------------------------

check('a GREEN brief with an assigned agent needs no human decision',
  projection.human_decisions.length === 0);

const red = clone(validIntake);
red.constraints.risk = 'RED';
const redProjection = ok(projectUseCase(red));
check('a RED brief produces a human decision that blocks every work item',
  redProjection.human_decisions.length >= 1
  && redProjection.human_decisions[0].blocks_work_item_ids.length === redProjection.work_items.length);

const sensitive = clone(validIntake);
sensitive.constraints.data_sensitivity = 'sensitive';
check('a sensitive-data brief produces a human decision',
  ok(projectUseCase(sensitive)).human_decisions.some((d) => /Sensitive data/.test(d.summary)));

const unassigned = clone(validIntake);
unassigned.follow_up.suggested_agent = 'UNASSIGNED';
check('an unassigned brief produces a human decision',
  ok(projectUseCase(unassigned)).human_decisions.some((d) => /No agent is assigned/.test(d.summary)));

// ---- the module cannot reach anything ------------------------------------

const source = fs.readFileSync(path.join(REPO_ROOT, 'src/modules/platform/lib/useCaseRequirementsProjection.ts'), 'utf8');
check('the projection imports nothing but the PLATFORM-A1 contract',
  (source.match(/^\s*import\s/gm) || []).length === 1 && /from '\.\/useCaseIntakeContract'/.test(source));
const EXECUTION_SURFACE: RegExp[] = [
  /from\s+['"](node:)?(child_process|fs|net|http|https|dns)['"]/,
  /require\s*\(\s*['"](node:)?(child_process|fs|net|http|https|dns)['"]\s*\)/,
  // Not \b: `.exec(` on a RegExp is a method call, not a process spawn, and a
  // word-boundary match flags the projection's own pattern matching as an
  // execution surface. The lookbehind requires a bare call, not a member one.
  /(?<![.\w])(spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
];
const executionHit = EXECUTION_SURFACE.find((re) => re.test(source));
check(`the projection has no execution, filesystem or network surface${executionHit ? ` (matched ${executionHit})` : ''}`,
  executionHit === undefined);
check('the projection contains no Google Drive SDK or API surface',
  !/googleapis|drive\.files|gapi|oauth/i.test(source));

if (failures > 0) {
  console.error(`FAILED: ${failures} PLATFORM-A2 checks failed`);
  process.exit(1);
}
console.log('COMPLETE: PLATFORM-A2 use-case requirements projection checks passed');
