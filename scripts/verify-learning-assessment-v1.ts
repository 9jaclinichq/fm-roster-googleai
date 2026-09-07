#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  LEARNING_ASSESSMENT_ROUTES,
  projectLearningAssessmentCommandCentre,
  type LearningAssessmentInput,
} from '../src/modules/exam-readiness/lib/learningAssessmentCommandCentre';

let failures = 0;

function assert(condition: unknown, label: string) {
  if (condition) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

function read(relPath: string): string {
  return readFileSync(resolve(process.cwd(), relPath), 'utf8');
}

const baseInput: LearningAssessmentInput = {
  readiness: null,
  dissertation: null,
  milestones: [],
  caseReports: [],
  vivaSimulations: [],
  knowledgePacks: [],
  currentCollection: null,
  currentSubmission: null,
};

const empty = projectLearningAssessmentCommandCentre(baseInput);
assert(empty.recentActivity === 'No activity recorded yet', 'honest empty recent activity');
assert(empty.nextActionLabel === 'Begin Exam Readiness', 'empty state starts first supported activity');
assert(empty.nextActionRoute === '/workspace/exam-readiness', 'empty next action uses real Exam Readiness route');
assert(empty.lanes.every((lane) => (Object.values(LEARNING_ASSESSMENT_ROUTES) as readonly string[]).includes(lane.route)), 'all lane actions target real workspace routes');
assert(empty.lanes.some((lane) => lane.summary === 'No activity recorded yet'), 'empty states use the required wording');

const incompleteExam = projectLearningAssessmentCommandCentre({
  ...baseInput,
  readiness: {
    id: 'ready-1',
    workforce_id: 'resident-1',
    evidemy_completed_count: 1,
    evidemy_total_required: 3,
    physical_logbook_verified: false,
    exam_fees_paid: true,
    college_forms_submitted: true,
    oral_practice_score: 88,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-02T00:00:00.000Z',
  },
});
assert(incompleteExam.nextActionLabel === 'Continue Exam Readiness', 'deterministic priority chooses incomplete assessment before other actions');
assert(incompleteExam.nextActionDetail.includes('Evidemy 1/3'), 'projection uses structured counts when present');
assert(!incompleteExam.nextActionDetail.includes('88'), 'projection does not surface computed or trigger-maintained viva score as readiness');

const viva = projectLearningAssessmentCommandCentre({
  ...baseInput,
  readiness: {
    id: 'ready-2',
    workforce_id: 'resident-1',
    evidemy_completed_count: 0,
    evidemy_total_required: 0,
    physical_logbook_verified: true,
    exam_fees_paid: true,
    college_forms_submitted: true,
    oral_practice_score: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  },
  vivaSimulations: [
    {
      id: 'viva-1',
      workforce_id: 'resident-1',
      case_title: 'Structured practice case',
      category: 'practice',
      duration_seconds: 600,
      scoring_breakdown: { diagnostic_reasoning: 70, management: 70, safety: 70, communication: 70 },
      feedback_summary: 'private note must stay in source module',
      created_at: '2026-09-03T00:00:00.000Z',
    },
  ],
});
assert(viva.nextActionLabel === 'Resume Viva Practice', 'deterministic priority resumes recent viva practice after complete tracked exam items');
assert(viva.nextActionRoute === '/workspace/viva-simulator', 'viva continuation uses real Viva Simulator route');
assert(!JSON.stringify(viva).includes('private note must stay in source module'), 'sensitive viva feedback summary is excluded from projection');

const feedback = projectLearningAssessmentCommandCentre({
  ...baseInput,
  milestones: [
    {
      id: 'milestone-1',
      dissertation_id: 'dissertation-1',
      stage: 'Supervisor Review',
      status: 'in_review',
      document_url: 'https://example.test/private.pdf',
      supervisor_feedback: 'private supervisor note',
      created_at: '2026-09-01T00:00:00.000Z',
      updated_at: '2026-09-04T00:00:00.000Z',
    },
  ],
});
assert(feedback.nextActionLabel === 'Review Feedback', 'feedback presence routes resident to review workspace');
assert(feedback.nextActionRoute === '/workspace/consultant-review', 'feedback continuation uses real review route');
assert(!JSON.stringify(feedback).includes('private supervisor note'), 'supervisor feedback content is excluded from learning projection');
assert(!JSON.stringify(feedback).includes('https://example.test/private.pdf'), 'private document URL is excluded from learning projection');

const library = projectLearningAssessmentCommandCentre({
  ...baseInput,
  knowledgePacks: [
    {
      id: 'pack-1',
      title: 'Tenant resource',
      category: 'guidelines',
      file_url: 'https://example.test/resource.pdf',
      description: 'tenant scoped',
      tags: [],
      created_at: '2026-09-05T00:00:00.000Z',
    },
  ],
});
assert(library.nextActionLabel === 'Open Learning Resources', 'saved learning resources are the next action when no assessment/practice/revision exists');
assert(library.nextActionRoute === '/workspace/library', 'library continuation uses real library route');
assert(!JSON.stringify(library).includes('resource.pdf'), 'library private file URLs are excluded from learning home projection');

const view = read('src/modules/exam-readiness/components/ExamReadinessView.tsx');
const libraryView = read('src/modules/knowledge-packs/components/KnowledgeLibraryView.tsx');
const app = read('src/App.tsx');
const helper = read('src/modules/exam-readiness/lib/learningAssessmentCommandCentre.ts');

assert(/databaseService\.getSettings\(tenantId\)/.test(view), 'Exam Readiness reads current tenant settings');
assert(/databaseService\.getCollections\(tenantId\)/.test(view), 'Exam Readiness reads current tenant collections');
assert(/databaseService\.getKnowledgePacks\(undefined, tenantId\)/.test(view), 'Learning home reads tenant-scoped library resources');
assert(/<KnowledgeLibraryView tenantId=\{currentResident\.tenant_id \?\? DEFAULT_TENANT_ID\}/.test(app), 'Library route receives current resident tenant id');
assert(/databaseService\.getKnowledgePacks\(undefined, tenantId\)/.test(libraryView), 'Library view uses supplied tenant id');
assert(!/localStorage|service_role|supabaseKey|SUPABASE_SERVICE/i.test(view + libraryView + helper), 'no browser localStorage or service-role authority added');
assert(!/Olanipekun|UCH|WACP|2027|2028/i.test(view + helper), 'no personal tenant, college, or exam-date hardcoding');
assert(!/overallScore|Ready<\/span>|Average Mock Viva Score|strokeDashoffset/.test(view), 'no fabricated readiness score or percentage UI remains');
assert(/Unsupported readiness scores, completion percentages, exam dates, supervisor approvals, and recommendations are not inferred/.test(view), 'UI states unsupported readiness fields are not inferred');

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}

console.log('\nAll Learning & Assessment V1 verification checks passed.');
