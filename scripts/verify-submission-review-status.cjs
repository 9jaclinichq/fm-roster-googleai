#!/usr/bin/env node
// submissions.review_status (migration 68) — focused, dependency-free
// verification. Matches the existing scripts/verify-*.cjs convention (no
// Vitest/Jest/Playwright, no network call, no database, no writes).
//
// Mostly structural/static: unlike rosterReconciliation.ts or
// submissionStatus.ts, this slice has no standalone pure-computation
// module to unit-test directly — the "logic" is a migration CHECK
// constraint plus a forced field on every write inside submitRoster().
// These checks read the real source files and assert the exact
// properties the locked design requires.
//
// Run: node scripts/verify-submission-review-status.cjs

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
let failures = 0;

function check(label, cond) {
  if (cond) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

const MIGRATION_PATH = 'supabase/migrations/68_submissions_review_status.sql';
const DB_SERVICE_PATH = 'src/lib/databaseService.ts';
const REVIEW_SERVICE_PATH = 'src/lib/services/submissionReviewService.ts';
const PANEL_PATH = 'src/modules/org-admin/components/dashboard/SubmissionsPanel.tsx';
const DASHBOARD_PATH = 'src/modules/org-admin/components/ChiefDashboardView.tsx';
const RESIDENT_FORM_PATH = 'src/modules/form/components/ResidentFormView.tsx';
const TYPES_PATH = 'src/types.ts';
const ROSTER_MANAGER_PATH = 'src/modules/org-admin/components/dashboard/MultiRosterManagerView.tsx';

for (const p of [MIGRATION_PATH, DB_SERVICE_PATH, REVIEW_SERVICE_PATH, PANEL_PATH, DASHBOARD_PATH, TYPES_PATH]) {
  check(`${p} exists`, fs.existsSync(path.join(REPO_ROOT, p)));
}

const migrationSql = read(MIGRATION_PATH);
const dbService = read(DB_SERVICE_PATH);
const reviewService = read(REVIEW_SERVICE_PATH);
const panel = read(PANEL_PATH);
const dashboard = read(DASHBOARD_PATH);
const residentForm = fs.existsSync(path.join(REPO_ROOT, RESIDENT_FORM_PATH)) ? read(RESIDENT_FORM_PATH) : '';
const types = read(TYPES_PATH);
const rosterManager = fs.existsSync(path.join(REPO_ROOT, ROSTER_MANAGER_PATH)) ? read(ROSTER_MANAGER_PATH) : '';

// --- allowed review_status values + default ---
check('migration 68 CHECK constraint allows exactly submitted/reviewed, nothing else', (() => {
  return /CHECK\s*\(review_status IN \('submitted', 'reviewed'\)\)/.test(migrationSql);
})());
check('migration 68 does not introduce draft/locked/approved/rejected/reconciled or any other state', (() => {
  const forbidden = ['draft', 'locked', 'approved', 'rejected', 'reconciled'];
  const checkClause = (migrationSql.match(/CHECK\s*\(review_status IN \([^)]*\)\)/) || [''])[0];
  return !forbidden.some((s) => checkClause.includes(`'${s}'`));
})());
check('migration 68 defaults review_status to submitted', (() => {
  return /review_status text NOT NULL DEFAULT 'submitted'/.test(migrationSql);
})());
check('migration 68 is additive (ADD COLUMN IF NOT EXISTS, no executable DROP of any column/table)', (() => {
  // Strip `--` comment lines first — the header's own ROLLBACK note
  // documents the DROP COLUMN a human would run to reverse this, which
  // is not itself an executable statement in this file.
  const executable = migrationSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  return /ADD COLUMN IF NOT EXISTS review_status/.test(migrationSql) && !/DROP COLUMN|DROP TABLE/.test(executable);
})());
check('migration 68 is explicitly marked NOT APPLIED / written-for-review-only', (() => {
  return /WRITTEN FOR REVIEW ONLY/i.test(migrationSql) && /NOT APPLIED LIVE/i.test(migrationSql);
})());

// --- no broad tenant/RLS/auth expansion ---
check('migration 68 touches only the submissions table — no RLS/policy/grant/RPC statements at all', (() => {
  return !/CREATE POLICY|ALTER TABLE.*ENABLE ROW LEVEL SECURITY|GRANT |CREATE OR REPLACE FUNCTION|SECURITY DEFINER/i.test(migrationSql);
})());

// --- admin review transition ---
check('submissionReviewService.ts writes review_status: "reviewed" via a table update, not a new RPC', (() => {
  return /\.update\(\s*\{\s*review_status:\s*'reviewed'\s*\}\s*\)/.test(reviewService);
})());
check('submissionReviewService.ts has no "mark submitted" / un-review action', (() => {
  return !/review_status:\s*'submitted'/.test(reviewService);
})());
check('SubmissionsPanel.tsx renders a submitted/reviewed badge and a Chief-facing mark-reviewed control', (() => {
  return /review_status === 'reviewed'/.test(panel) && /onMarkReviewed/.test(panel);
})());
check('ChiefDashboardView.tsx wires onMarkReviewed to submissionReviewService.markReviewed', (() => {
  return /submissionReviewService\.markReviewed/.test(dashboard) && /onMarkReviewed=\{handleMarkReviewed\}/.test(dashboard);
})());

// --- resident resubmission resets reviewed -> submitted ---
check('submitRoster() forces review_status back to "submitted" on the existing-submission update branch', (() => {
  const updateBranch = dbService.slice(dbService.indexOf('async submitRoster'), dbService.indexOf('async updateSubmissionDirectly'));
  const firstUpdateCall = updateBranch.slice(0, updateBranch.indexOf('} else {'));
  return /review_status:\s*'submitted'/.test(firstUpdateCall);
})());
check('submitRoster() also sets review_status: "submitted" on the fresh-insert branch (no reliance on the DB default alone)', (() => {
  const fn = dbService.slice(dbService.indexOf('async submitRoster'), dbService.indexOf('async updateSubmissionDirectly'));
  const insertBranch = fn.slice(fn.indexOf('} else {'));
  return /\.insert\(\[\{[\s\S]*?review_status:\s*'submitted'/.test(insertBranch);
})());

// --- resident UI cannot directly set review_status ---
check('submitRoster()\'s input type excludes review_status entirely (cannot be passed even at the type level)', (() => {
  const sigLine = (dbService.match(/async submitRoster\(submission: Omit<Submission, [^)]*\)/) || [''])[0];
  return /'review_status'/.test(sigLine);
})());
check('ResidentFormView.tsx never references review_status', (() => {
  return !/review_status/.test(residentForm);
})());
check('updateSubmissionDirectly() (Chief edit-on-behalf) is untouched by this slice — no review_status reference added there', (() => {
  const fn = dbService.slice(dbService.indexOf('async updateSubmissionDirectly'), dbService.indexOf('async updateSubmissionDirectly') + 500);
  return !/review_status/.test(fn);
})());

// --- no roster-write/publish behavior changed ---
check('MultiRosterManagerView.tsx (roster build/publish) never references review_status', (() => {
  return !/review_status/.test(rosterManager);
})());

// --- type shape ---
check('types.ts defines SubmissionReviewStatus as exactly "submitted" | "reviewed"', (() => {
  return /export type SubmissionReviewStatus = 'submitted' \| 'reviewed';/.test(types);
})());
check('Submission interface includes review_status: SubmissionReviewStatus', (() => {
  const iface = types.slice(types.indexOf('export interface Submission {'), types.indexOf('export interface Submission {') + 800);
  return /review_status: SubmissionReviewStatus;/.test(iface);
})());

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('\nAll submissions review_status verification checks passed.');
  process.exit(0);
}
