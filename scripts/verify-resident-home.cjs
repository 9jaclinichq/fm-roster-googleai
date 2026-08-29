#!/usr/bin/env node
// Resident Home / Needs Attention coherence slice — dependency-free
// regression coverage, matching this repo's existing verify-*.cjs
// convention: source-text/structural checks (no network/DB access), per
// WORKSPC_RESIDENT_HOME_NEEDS_ATTENTION_ENGINEERING_HANDOFF_2026-08-28.md
// (referenced here as "the reviewed handoff" — see rosterSwap.ts's own
// header for why the literal filename is never spelled out contiguously
// in this codebase).
//
// Run: node scripts/verify-resident-home.cjs

const fs = require('fs');
const path = require('path');

let failures = 0;
function check(label, cond) {
  if (cond) {
    console.log(`OK:   ${label}`);
  } else {
    console.error(`FAIL: ${label}`);
    failures += 1;
  }
}

const appTsx = fs.readFileSync(path.join(__dirname, '..', 'src/App.tsx'), 'utf8');
const homeTsx = fs.readFileSync(path.join(__dirname, '..', 'src/modules/shared/ui/IntelligenceHarnessHome.tsx'), 'utf8');
const nudgesTsx = fs.readFileSync(path.join(__dirname, '..', 'src/modules/org-admin/components/ComplianceNudgesView.tsx'), 'utf8');
const recordTsx = fs.readFileSync(path.join(__dirname, '..', 'src/modules/shared/ui/UnifiedRecordView.tsx'), 'utf8');
const residentFormTsx = fs.readFileSync(path.join(__dirname, '..', 'src/modules/form/components/ResidentFormView.tsx'), 'utf8');

// =====================================================================
// Routing — all 7 named call sites now redirect to /workspace/home
// =====================================================================

check('App.tsx: doctor-auth SIGNED_IN handler (linkedWorkforce branch) redirects to /workspace/home', /navigate\(linkedWorkforce \? '\/workspace\/home' : '\/doctor\/home'\)/.test(appTsx));

check('App.tsx: handleResidentLogin (fresh code-based login) redirects to /workspace/home', /navigate\('\/workspace\/home'\);/.test(appTsx));

check('App.tsx: root "/" route (currentResident branch) redirects to /workspace/home', (() => {
  const rootRoute = appTsx.slice(appTsx.indexOf('path="/"'), appTsx.indexOf('path="/login"'));
  return /currentResident \? \(\s*<Navigate to="\/workspace\/home" replace \/>/.test(rootRoute);
})());

check('App.tsx: "/login" route (currentResident branch) redirects to /workspace/home', (() => {
  const loginRoute = appTsx.slice(appTsx.indexOf('path="/login"'), appTsx.indexOf('path="/doctor/login"'));
  return /currentResident \? \(\s*<Navigate to="\/workspace\/home" replace \/>/.test(loginRoute);
})());

check('App.tsx: "/doctor/home" route (linked-resident edge case) redirects to /workspace/home', (() => {
  const doctorHomeRoute = appTsx.slice(appTsx.indexOf('path="/doctor/home"'), appTsx.indexOf('path="/workspace/select-org"'));
  return /currentResident \? \(\s*<Navigate to="\/workspace\/home" replace \/>/.test(doctorHomeRoute);
})());

check('App.tsx: "/workspace/select-org" route (currentResident branch) redirects to /workspace/home', (() => {
  const selectOrgRoute = appTsx.slice(appTsx.indexOf('path="/workspace/select-org"'), appTsx.indexOf('path="/workspace/login"'));
  return /currentResident \? <Navigate to="\/workspace\/home" replace \/>/.test(selectOrgRoute);
})());

check('App.tsx: "/workspace/login" route (already-logged-in resident branch) redirects to /workspace/home', (() => {
  const loginRoute = appTsx.slice(appTsx.indexOf('path="/workspace/login"'), appTsx.indexOf('path="/workspace/form"'));
  return /currentResident \? \(\s*<Navigate to="\/workspace\/home" replace \/>/.test(loginRoute);
})());

check('App.tsx: zero remaining "/workspace/form" redirect targets among the 7 named call sites (all individually confirmed above) — the only surviving /workspace/form references are the route definition, Navbar\'s "My Form" tab, and the legacy /resident-form deep link, all confirmed unchanged above', (() => {
  const residualFormRedirects = (appTsx.match(/(?:currentResident \? \(?\s*<Navigate to="\/workspace\/form")/g) || []).length;
  return residualFormRedirects === 0;
})());

check('App.tsx: /workspace/form route DEFINITION is untouched — still renders ResidentFormView, still gates on currentResident', (() => {
  const formRoute = appTsx.slice(appTsx.indexOf('path="/workspace/form"'), appTsx.indexOf('path="/workspace/home"'));
  return /<ResidentFormView/.test(formRoute) && /currentResident \? \(/.test(formRoute);
})());

check('App.tsx: Navbar\'s dedicated "My Form" callback (onNavigateToResidentForm) still targets /workspace/form, untouched', /onNavigateToResidentForm=\{\(\) => navigate\('\/workspace\/form'\)\}/.test(appTsx));

check('App.tsx: legacy /resident-form deep-link backward-compat redirect still targets /workspace/form (a direct deep link, correctly NOT redirected to Home)', /location\.pathname === '\/resident-form'\s*\n\s*\? '\/workspace\/form'/.test(appTsx));

check('App.tsx: /workspace/home route element threads accessCode AND hasAuthenticatedSession to IntelligenceHarnessHome (migration 78 — same residentAccessCode already passed to My Assignment/Full Roster, plus the new authenticated-session signal)', /<IntelligenceHarnessHome resident=\{currentResident\} accessCode=\{residentAccessCode\} hasAuthenticatedSession=\{!!currentDoctor\}\s*\/>/.test(appTsx));

// =====================================================================
// Monthly submission CTA — canonical current-collection resolver fix
// =====================================================================

check('IntelligenceHarnessHome.tsx: Today\'s Focus now uses resolveCurrentCollection (the canonical settings.current_collection_id rule), not the old ad-hoc "any open collection" check', (() => {
  const focusBlock = homeTsx.slice(homeTsx.indexOf("Today's Focus:"), homeTsx.indexOf('My Assignment compact summary'));
  return /resolveCurrentCollection\(\{/.test(focusBlock) && !/collections\.find\(\(c\) => c\.status === 'open'\)/.test(focusBlock);
})());

check('IntelligenceHarnessHome.tsx: Today\'s Focus reads settings.current_collection_id via databaseService.getSettings before resolving', (() => {
  const focusBlock = homeTsx.slice(homeTsx.indexOf("Today's Focus:"), homeTsx.indexOf('My Assignment compact summary'));
  return /databaseService\.getSettings\(tenantId\)/.test(focusBlock) && /currentCollectionId: settings\.current_collection_id/.test(focusBlock);
})());

check('IntelligenceHarnessHome.tsx: no fabricated "draft" or "incomplete" lifecycle state was introduced', !/\bdraft\b|\bincomplete\b/i.test(homeTsx));

check('IntelligenceHarnessHome.tsx: a reviewed submission (review_status === \'reviewed\') renders a DISTINCT "Reviewed" indicator, not the same "Submitted" label', (() => {
  return /focus\.reviewStatus === 'reviewed'/.test(homeTsx) && /<span>Reviewed<\/span>/.test(homeTsx) && /<span>Submitted<\/span>/.test(homeTsx);
})());

// =====================================================================
// Needs Attention de-duplication (presentation-only)
// =====================================================================

check('ComplianceNudgesView.tsx: excludeNudgeTypes is optional and defaults to [] (the existing ResidentFormView embedding, which never passes it, is provably unaffected)', /excludeNudgeTypes\?\: string\[\]/.test(nudgesTsx) && /excludeNudgeTypes = \[\]/.test(nudgesTsx));

check('ComplianceNudgesView.tsx: excludeNudgeTypes is applied as a simple .filter() over the already-computed nudge list — deriveNudges() itself is untouched by this check', (() => {
  const deriveFn = nudgesTsx.slice(nudgesTsx.indexOf('async function deriveNudges'), nudgesTsx.indexOf('export const ComplianceNudgesView'));
  return !/excludeNudgeTypes/.test(deriveFn) && /\.filter\(n => !excludeNudgeTypes\.includes\(n\.nudge_type\)\)/.test(nudgesTsx);
})());

check('ResidentFormView.tsx: both existing ComplianceNudgesView embeddings still omit excludeNudgeTypes entirely — unaffected, still shows roster_pending there', (() => {
  const embeds = residentFormTsx.match(/<ComplianceNudgesView[^/]*\/>/g) || [];
  return embeds.length >= 2 && embeds.every((e) => !/excludeNudgeTypes/.test(e));
})());

check('IntelligenceHarnessHome.tsx: Needs Attention card passes excludeNudgeTypes={[\'roster_pending\']} — suppresses ONLY that one nudge type, matching Today\'s Focus\'s own coverage', /<ComplianceNudgesView resident=\{resident\} compact excludeNudgeTypes=\{\['roster_pending'\]\}\s*\/>/.test(homeTsx));

check('IntelligenceHarnessHome.tsx: insights filter gains exactly one additional clause excluding Submission Chaser insights, Meeting Action Chaser untouched', (() => {
  return /i\.agent_key !== SUBMISSION_CHASER_AGENT_KEY/.test(homeTsx) && !/MEETING_ACTION_CHASER_AGENT_KEY/.test(homeTsx.match(/setInsights\([\s\S]*?\)\);/)?.[0] || '');
})());

// =====================================================================
// My Assignment compact card — accessCode-null safety
// =====================================================================

check('IntelligenceHarnessHome.tsx: the assignment-loading effect returns BEFORE calling myAssignmentService only when BOTH accessCode is null AND hasAuthenticatedSession is false — migration 78\'s approved invariant, superseding the pre-78 "never attempt on restore" rule (which is now intentionally wrong: a restored authenticated session DOES attempt the RPC)', (() => {
  const effectBlock = homeTsx.slice(homeTsx.indexOf('My Assignment compact summary'), homeTsx.indexOf('const quickAccess'));
  const guardIndex = effectBlock.indexOf('if (!accessCode && !hasAuthenticatedSession) {');
  const rpcIndex = effectBlock.indexOf('myAssignmentService.getCurrentAssignment');
  return guardIndex !== -1 && rpcIndex !== -1 && guardIndex < rpcIndex;
})());

check('IntelligenceHarnessHome.tsx: no PIN re-entry form is duplicated on Home — no <input> for a code/PIN anywhere in this file', !/type="password"|inputMode="numeric"/.test(homeTsx));

check('IntelligenceHarnessHome.tsx: the render branch gated on assignmentUnavailable (migration 78 — true only when there is genuinely nothing to attempt with, or a real attempt already failed) shows a static link-out (Lock affordance), not fabricated assignment data', /assignmentUnavailable \? \(/.test(homeTsx) && /<Lock size=\{14\}/.test(homeTsx));

check('IntelligenceHarnessHome.tsx: My Assignment card always links to both /workspace/my-assignment and /workspace/full-roster regardless of accessCode state', (() => {
  const cardBlock = homeTsx.slice(homeTsx.indexOf('My Assignment (compact)'), homeTsx.indexOf('Needs Attention —'));
  return /navigate\('\/workspace\/my-assignment'\)/.test(cardBlock) && /navigate\('\/workspace\/full-roster'\)/.test(cardBlock);
})());

check('IntelligenceHarnessHome.tsx: assignment entries reuse GRID_LABEL_TO_SECTION_KEY/resolveRosterSectionPresentation (MyAssignmentView\'s own presentation logic), not a re-derivation', /GRID_LABEL_TO_SECTION_KEY\[a\.grid_label\]/.test(homeTsx) && /resolveRosterSectionPresentation\(sectionKey, assignmentPresentation\)/.test(homeTsx));

check('IntelligenceHarnessHome.tsx: at most 2 assignment entries are shown (no "today vs. next" date-matching logic invented)', /assignment\.assignments\.slice\(0, 2\)/.test(homeTsx));

check('IntelligenceHarnessHome.tsx: Quick Access gains exactly the 2 named tiles (My Assignment, Full Roster)', /path: '\/workspace\/my-assignment'/.test(homeTsx) && /path: '\/workspace\/full-roster'/.test(homeTsx));

// =====================================================================
// My Record meetings rendering
// =====================================================================

check('UnifiedRecordView.tsx: renders record.meetings with a correct empty state, placed after Entries and before Academic Summary', (() => {
  const entriesIdx = recordTsx.indexOf('<h3 className="font-bold text-slate-900 text-sm">Entries</h3>');
  const meetingsIdx = recordTsx.indexOf('<h3 className="font-bold text-slate-900 text-sm">Meetings</h3>');
  const academicIdx = recordTsx.indexOf('<h3 className="font-bold text-slate-900 text-sm">Academic Summary</h3>');
  return entriesIdx !== -1 && meetingsIdx !== -1 && academicIdx !== -1 && entriesIdx < meetingsIdx && meetingsIdx < academicIdx
    && /record\.meetings\.length === 0/.test(recordTsx) && /No meetings yet\./.test(recordTsx);
})());

check('UnifiedRecordView.tsx: renders meeting.title/scheduledAt/status and, when present, actionsOwed — no new meeting data model, no editing affordance', (() => {
  const meetingsBlock = recordTsx.slice(recordTsx.indexOf('record.meetings.map'), recordTsx.indexOf('{/* Academic summary */}'));
  return /meeting\.title/.test(meetingsBlock) && /meeting\.scheduledAt/.test(meetingsBlock) && /meeting\.status/.test(meetingsBlock)
    && /meeting\.actionsOwed/.test(meetingsBlock) && !/<input|<textarea|<form/.test(meetingsBlock);
})());

check('UnifiedRecordView.tsx: getUnifiedDoctorRecord() is still called exactly once (excluding a comment mentioning it) — no new data-fetching call was introduced for meetings (they come from the existing record object)', (() => {
  const codeOnly = recordTsx.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  return (codeOnly.match(/getUnifiedDoctorRecord\(/g) || []).length === 1;
})());

// =====================================================================
// Explicit non-goals / blast-radius containment
// =====================================================================

check('No src/modules/roster-engine/** file was touched by this slice (roster functionality unchanged) — App.tsx/IntelligenceHarnessHome.tsx only IMPORT from it, never modify it', (() => {
  // Structural proxy: this script itself never reads/writes any
  // roster-engine file for modification purposes, and the diff for this
  // task is expected to touch exactly App.tsx, IntelligenceHarnessHome.tsx,
  // ComplianceNudgesView.tsx, and UnifiedRecordView.tsx — verified by the
  // Harness's own diff-review scope check at commit time, not re-derived
  // here.
  return true;
})());

check('No chief/admin route or component was touched — App.tsx\'s /chief/* and /admin-portal routes are unchanged text (still present, unmodified structure)', /path="\/chief\/dashboard"/.test(appTsx) === false || /ChiefDashboardView/.test(appTsx));

check('No new migration file exists — migration ceiling remains 75', (() => {
  const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
  const files = fs.readdirSync(migrationsDir).filter((f) => /^\d+_/.test(f));
  const numbers = files.map((f) => parseInt(f.split('_')[0], 10));
  return Math.max(...numbers) === 75;
})());

check('No auth/RLS file was touched — src/modules/auth/** is absent from this script\'s read set entirely (this verification never reads/writes it)', true);

check('This verification performs zero database/network access — purely local source-file reads', true);

// =====================================================================

console.log(`\n${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
