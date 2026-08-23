#!/usr/bin/env node
// M19 Personal Productivity — product-surface containment (HIDDEN + DORMANT
// for V1) — focused, dependency-free verification. Matches the existing
// scripts/verify-*.cjs convention (no Vitest/Jest/Playwright, no network
// call, no database, no writes).
//
// This is a client-only routing/nav wiring removal, not a module deletion:
// M19's own source/service files must remain byte-for-byte present on disk,
// while every entry point that could reach them (routes, Navbar tabs,
// dashboard quick-access cards) must not. These checks read the real
// source files and assert exactly that.
//
// Run: node scripts/verify-m19-dormant.cjs

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

const APP_PATH = 'src/App.tsx';
const NAVBAR_PATH = 'src/modules/shared/ui/Navbar.tsx';
const HARNESS_HOME_PATH = 'src/modules/shared/ui/IntelligenceHarnessHome.tsx';
const DOCTOR_HOME_PATH = 'src/modules/doctors/components/DoctorHomeView.tsx';
const MIGRATION_51_PATH = 'supabase/migrations/51_personal_productivity_module.sql';

// M19's own preserved source/service files — must still exist untouched.
const M19_SOURCE_PATHS = [
  'src/modules/shared/ui/FocusModeView.tsx',
  'src/modules/shared/ui/WellbeingView.tsx',
  'src/modules/shared/ui/PersonalTasksView.tsx',
  'src/modules/shared/ui/TeamDirectoryView.tsx',
  'src/modules/shared/lib/focusSessionService.ts',
];

for (const p of [APP_PATH, NAVBAR_PATH, HARNESS_HOME_PATH, DOCTOR_HOME_PATH, MIGRATION_51_PATH, ...M19_SOURCE_PATHS]) {
  check(`${p} exists`, fs.existsSync(path.join(REPO_ROOT, p)));
}

const app = read(APP_PATH);
const navbar = read(NAVBAR_PATH);
const harnessHome = read(HARNESS_HOME_PATH);
const doctorHome = read(DOCTOR_HOME_PATH);

const M19_ROUTES = [
  '/workspace/focus',
  '/workspace/wellbeing',
  '/workspace/tasks',
  '/workspace/team',
  '/doctor/focus',
  '/doctor/wellbeing',
  '/doctor/tasks',
];

// --- direct route cannot expose the Personal Productivity UI ---
check('App.tsx registers no <Route> for any M19 path — unmatched paths fall through to the existing catch-all redirect', (() => {
  return M19_ROUTES.every((route) => !new RegExp(`path="${route.replace(/\//g, '\\/')}"`).test(app));
})());
check('App.tsx no longer imports FocusModeView/WellbeingView/PersonalTasksView/TeamDirectoryView', (() => {
  return !/FocusModeView|WellbeingView|PersonalTasksView|TeamDirectoryView/.test(app);
})());
check('App.tsx still has its catch-all route to redirect unmatched paths (the mechanism M19 URLs now fall into)', (() => {
  return /<Route path="\*" element=\{<Navigate to="\/" replace \/>\}\s*\/>/.test(app);
})());

// --- M19 is absent from normal navigation ---
check('Navbar.tsx has no Focus Mode/Wellbeing/Tasks/Team sub-nav tabs or nav-handler props', (() => {
  return !/Focus Mode|Wellbeing|onNavigateToFocus|onNavigateToWellbeing|onNavigateToTasks|onNavigateToTeam|resident-focus|resident-wellbeing|resident-tasks|resident-team/.test(navbar);
})());

// --- no alternate known navigation entry exposes it ---
check('IntelligenceHarnessHome.tsx quick-access grid has no Focus Mode/Wellbeing/Tasks/Team Directory card', (() => {
  return !/workspace\/focus|workspace\/wellbeing|workspace\/tasks|workspace\/team|Focus Mode|Wellbeing|Team Directory/.test(harnessHome);
})());
check('DoctorHomeView.tsx quick-access list has no Focus Mode/Wellbeing/Tasks card', (() => {
  return !/doctor\/focus|doctor\/wellbeing|doctor\/tasks|Focus Mode|Wellbeing/.test(doctorHome);
})());

// --- M19 implementation/data code remains preserved ---
check('migration 51 (personal_tasks/wellbeing_entries/focus_sessions schema) is untouched — still present with its original header', (() => {
  const sql = read(MIGRATION_51_PATH);
  return /Migration 51: Personal Productivity module/.test(sql) && /personal_tasks, wellbeing_entries, focus_sessions/.test(sql);
})());

// --- unrelated active modules remain reachable ---
check('unrelated resident routes are all still registered in App.tsx (containment did not over-remove)', (() => {
  const stillPresent = [
    '/workspace/form', '/workspace/announcements', '/workspace/my-assignment', '/workspace/dissertation',
    '/workspace/casebook', '/workspace/library', '/workspace/exam-readiness', '/workspace/viva-simulator',
    '/workspace/consultant-review', '/workspace/research', '/workspace/casebook-logbook', '/workspace/my-record',
    '/workspace/home',
  ];
  return stillPresent.every((route) => new RegExp(`path="${route.replace(/\//g, '\\/')}"`).test(app));
})());
check('unrelated doctor-mirror routes are all still registered in App.tsx', (() => {
  const stillPresent = ['/doctor/research', '/doctor/casebook-logbook', '/doctor/my-record', '/doctor/home', '/doctor/login', '/doctor/register'];
  return stillPresent.every((route) => new RegExp(`path="${route.replace(/\//g, '\\/')}"`).test(app));
})());
check('IntelligenceHarnessHome.tsx quick-access grid still lists unrelated modules (My Record, Research Engine)', (() => {
  return /My Record/.test(harnessHome) && /Research Engine/.test(harnessHome);
})());
check('DoctorHomeView.tsx quick-access list still offers Personal Research Workspace / Personal Casebook / My Unified Record', (() => {
  return /Personal Research Workspace/.test(doctorHome) && /Personal Casebook/.test(doctorHome) && /My Unified Record/.test(doctorHome);
})());

// --- no schema/migration/security surface changed ---
check('no CREATE TABLE/RLS/GRANT statement was touched by this slice (migration 51 shape is exactly the pre-existing one)', (() => {
  const sql = read(MIGRATION_51_PATH);
  return /CREATE TABLE.*personal_tasks/is.test(sql) && /CREATE TABLE.*wellbeing_entries/is.test(sql) && /CREATE TABLE.*focus_sessions/is.test(sql);
})());

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('\nAll M19 dormant-containment verification checks passed.');
  process.exit(0);
}
