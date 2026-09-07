#!/usr/bin/env tsx
// PLATFORM-A1: dependency-free verification for the Drive-authored use-case
// intake contract. No Drive access, network, database, migration, deploy, or
// production write occurs here.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  USE_CASE_INTAKE_SCHEMA,
  validateUseCaseIntake,
  type UseCaseIntakeContract,
} from '../src/modules/platform/lib/useCaseIntakeContract';

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

const validIntake: UseCaseIntakeContract = {
  schema_version: 1,
  title: 'Capture ward handover actions from a Drive-authored brief',
  summary: 'Convert a structured human-authored use-case brief into bounded platform intake.',
  source: {
    kind: 'google_drive_document',
    document_id: 'drive-doc-opaque-id',
    document_title: 'Ward Handover Use Case',
    revision_id: 'rev-001',
    captured_at: '2026-09-04T14:45:00.000Z',
  },
  problem: {
    actor: 'Clinical programme administrator',
    current_state: 'Use cases are described in prose before they become tasks.',
    desired_outcome: 'The prose is captured as a strict local contract for review.',
    user_value: 'The implementation queue can reason over consistent fields without rereading a full document.',
  },
  scope: {
    in_scope: ['Define the intake object shape', 'Validate structured local intake payloads'],
    out_of_scope: ['Read or write Google Drive', 'Create product UI'],
    non_goals: ['Apply migrations', 'Deploy code'],
  },
  acceptance: {
    success_criteria: ['Valid intake returns status ok', 'Authority-bearing keys are rejected'],
    verification: ['Run the PLATFORM-A1 contract verification script', 'Run TypeScript/build verification'],
  },
  constraints: {
    risk: 'GREEN',
    target_module: 'platform',
    dependencies: ['ORCH-C5', 'ORCH-C6', 'ORCH-C7', 'ORCH-C8', 'ORCH-C9'],
    prohibited_actions: ['push', 'deploy', 'production migration'],
    data_sensitivity: 'operational',
  },
  follow_up: {
    suggested_task_id: 'PLATFORM-A2',
    suggested_agent: 'UNASSIGNED',
    notes: ['Convert validated intake into requirements in a later bounded slice.'],
  },
};

check('contract source file exists in the platform module boundary', fs.existsSync(path.join(REPO_ROOT, 'src/modules/platform/lib/useCaseIntakeContract.ts')));
check('schema advertises version 1 and google_drive_document as the only source kind', USE_CASE_INTAKE_SCHEMA.schema_version === 1 && USE_CASE_INTAKE_SCHEMA.source_kind.length === 1 && USE_CASE_INTAKE_SCHEMA.source_kind[0] === 'google_drive_document');
check('schema enumerates platform plus the ten target product capability modules', USE_CASE_INTAKE_SCHEMA.modules.length === 11 && USE_CASE_INTAKE_SCHEMA.modules.includes('forms_pipelines') && USE_CASE_INTAKE_SCHEMA.modules.includes('billing_plans') && USE_CASE_INTAKE_SCHEMA.modules.includes('platform'));
check('accepts a complete valid Drive-authored intake object', validateUseCaseIntake(validIntake).status === 'ok');

const wrongSource = clone(validIntake);
wrongSource.source.kind = 'manual' as UseCaseIntakeContract['source']['kind'];
check('rejects a non-Drive source kind', validateUseCaseIntake(wrongSource).status === 'error');

const extraTopLevel = { ...validIntake, tenant_id: 'not-authoritative' };
check('rejects unexpected top-level fields', validateUseCaseIntake(extraTopLevel).status === 'error');

const authorityNested = clone(validIntake) as UseCaseIntakeContract & { source: UseCaseIntakeContract['source'] & { access_code: string } };
authorityNested.source.access_code = 'do-not-accept';
const authorityResult = validateUseCaseIntake(authorityNested);
check('rejects nested authority-bearing keys before they can become task authority', authorityResult.status === 'error' && /authority-bearing key/.test(authorityResult.message));

const emptyScope = clone(validIntake);
emptyScope.scope.in_scope = [];
check('rejects empty scope arrays so a Drive brief cannot validate without bounded work', validateUseCaseIntake(emptyScope).status === 'error');

const badRisk = clone(validIntake);
badRisk.constraints.risk = 'BLUE' as UseCaseIntakeContract['constraints']['risk'];
check('rejects unknown risk classes', validateUseCaseIntake(badRisk).status === 'error');

const blockedFollowUp = clone(validIntake);
blockedFollowUp.follow_up.notes = ['deploy this directly after validation'];
check('rejects follow-up notes that try to smuggle blocked operational actions', validateUseCaseIntake(blockedFollowUp).status === 'error');

const noNetworkTermsInContract = fs.readFileSync(path.join(REPO_ROOT, 'src/modules/platform/lib/useCaseIntakeContract.ts'), 'utf8');
check('contract contains no Google Drive SDK/API imports or network calls', !/from ['"].*google|fetch\(|gapi|drive\.files|googleapis/i.test(noNetworkTermsInContract));

// The contract must have no execution surface. Detect an actual one — an
// import or a call site — rather than the WORDS for one.
//
// A bare word grep for /spawn|exec|deploy|push/ cannot work here: the
// contract's own BLOCKED_FOLLOW_UP_ACTION_PATTERN necessarily contains
// "deploy" and "execute" as data, because that pattern is what rejects a
// Drive brief asking for those actions. Grepping for the words made the
// safety rule report itself as a violation of the safety rule.
const CONTRACT_IMPORTS = /^\s*(import\s|export\s+(\*|\{[^}]*\})\s+from\s|const\s+\{[^}]*\}\s*=\s*require\s*\()/m;
const EXECUTION_SURFACE: RegExp[] = [
  /from\s+['"](node:)?(child_process|fs|net|http|https|dns)['"]/,
  /require\s*\(\s*['"](node:)?(child_process|fs|net|http|https|dns)['"]\s*\)/,
  /\b(spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(/,
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bprocess\.(exit|kill)\s*\(/,
];
check('contract declares no imports at all, so it cannot reach Drive, the network or a shell', !CONTRACT_IMPORTS.test(noNetworkTermsInContract));
const executionHit = EXECUTION_SURFACE.find((re) => re.test(noNetworkTermsInContract));
check(`contract contains no migration/deploy/push execution surface${executionHit ? ` (matched ${executionHit})` : ''}`, executionHit === undefined);

if (failures > 0) {
  console.error(`FAILED: ${failures} PLATFORM-A1 checks failed`);
  process.exit(1);
}

console.log('COMPLETE: PLATFORM-A1 use-case intake contract checks passed');
