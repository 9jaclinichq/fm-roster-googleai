#!/usr/bin/env node
// chief_get_active_member_contacts (migration 69) — focused, dependency-free
// verification. Matches the existing scripts/verify-*.cjs convention (no
// Vitest/Jest/Playwright, no network call, no database, no writes).
//
// Mostly structural/static, matching verify-submission-review-status.cjs's
// own precedent: no standalone pure-computation module exists for this
// slice — the "logic" is a migration RPC plus a client join. These checks
// read the real source files and assert the exact properties the locked
// design requires.
//
// Run: node scripts/verify-pending-member-contacts.cjs

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

// Strips `--`-comment lines (SQL) so a check for "does the EXECUTABLE SQL
// do X" isn't tripped by this migration's own extensive header/rationale
// comments, which necessarily discuss the very things they explain are
// absent (e.g. "does not touch chief_get_workforce_codes").
function stripSqlComments(text) {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
}

const MIGRATION_PATH = 'supabase/migrations/69_chief_active_member_contacts.sql';
const CONTACT_SERVICE_PATH = 'src/lib/services/workforceContactService.ts';
const DASHBOARD_PATH = 'src/modules/org-admin/components/ChiefDashboardView.tsx';
const PANEL_PATH = 'src/modules/org-admin/components/dashboard/PendingResidentsPanel.tsx';
const DB_SERVICE_PATH = 'src/lib/databaseService.ts';
const RESIDENT_FORM_PATH = 'src/modules/form/components/ResidentFormView.tsx';
const MY_ASSIGNMENT_VIEW_PATH = 'src/modules/roster-engine/components/MyAssignmentView.tsx';
const MIGRATION_26_PATH = 'supabase/migrations/26_workforce_email_and_org_login.sql';

for (const p of [MIGRATION_PATH, CONTACT_SERVICE_PATH, DASHBOARD_PATH, PANEL_PATH]) {
  check(`${p} exists`, fs.existsSync(path.join(REPO_ROOT, p)));
}

const migrationSql = read(MIGRATION_PATH);
const contactService = read(CONTACT_SERVICE_PATH);
const dashboard = read(DASHBOARD_PATH);
const panel = read(PANEL_PATH);
const dbService = read(DB_SERVICE_PATH);
const migration26 = read(MIGRATION_26_PATH);
const residentForm = fs.existsSync(path.join(REPO_ROOT, RESIDENT_FORM_PATH)) ? read(RESIDENT_FORM_PATH) : '';
const myAssignmentView = fs.existsSync(path.join(REPO_ROOT, MY_ASSIGNMENT_VIEW_PATH)) ? read(MY_ASSIGNMENT_VIEW_PATH) : '';

// --- workforce.email is still absent from shared/public workforce projections ---
check('WORKFORCE_PUBLIC_COLUMNS is unchanged (still no email column listed)', (() => {
  const line = (dbService.match(/const WORKFORCE_PUBLIC_COLUMNS = '[^']*';/) || [''])[0];
  return /WORKFORCE_PUBLIC_COLUMNS/.test(line) && !/\bemail\b/.test(line);
})());
check('migration 26\'s own record that email was deliberately excluded from the client SELECT allowlist is still present (unmodified precedent)', (() => {
  return /email is deliberately NOT added to the client SELECT allowlist/.test(migration26);
})());
const migrationSqlCode = stripSqlComments(migrationSql);

check('migration 69 does not touch chief_get_workforce_codes (outside comments)', (() => {
  return !/chief_get_workforce_codes/.test(migrationSqlCode);
})());

// --- no direct client SELECT(email) grant is added ---
check('migration 69 contains no executable GRANT SELECT on the workforce table/column (outside comments)', (() => {
  return !/GRANT SELECT/i.test(migrationSqlCode);
})());
check('migration 69 contains no ALTER TABLE/RLS/POLICY statement at all', (() => {
  return !/ALTER TABLE|CREATE POLICY|ENABLE ROW LEVEL SECURITY/i.test(migrationSql);
})());

// --- RPC is SECURITY DEFINER with fixed search path ---
check('chief_get_active_member_contacts is SECURITY DEFINER with a fixed search_path', (() => {
  return /CREATE OR REPLACE FUNCTION public\.chief_get_active_member_contacts\(p_admin_code text\)/.test(migrationSql)
    && /SECURITY DEFINER SET search_path = public/.test(migrationSql);
})());

// --- existing Chief/admin authority is reverified server-side ---
check('the function reverifies p_admin_code against settings.admin_access_code server-side, exactly like verify_chief_login/chief_get_workforce_codes', (() => {
  return /SELECT s\.tenant_id INTO v_tenant_id FROM settings s WHERE s\.admin_access_code = p_admin_code/.test(migrationSql)
    && /RAISE EXCEPTION 'Invalid admin access code'/.test(migrationSql);
})());

// --- tenant is not caller-selectable across organisations ---
check('the function takes no p_tenant_id parameter — tenant is derived only from the verified admin code', (() => {
  const sigLine = (migrationSql.match(/CREATE OR REPLACE FUNCTION public\.chief_get_active_member_contacts\([^)]*\)/) || [''])[0];
  return sigLine.length > 0 && !/p_tenant/i.test(sigLine);
})());
check('the query filters by w.tenant_id = v_tenant_id (server-derived), not any client-supplied value', (() => {
  return /WHERE w\.tenant_id = v_tenant_id/.test(migrationSql);
})());

// --- no resident/access code is returned ---
check('the function never selects/returns resident_code (outside comments)', (() => {
  return !/resident_code/i.test(migrationSqlCode);
})());
check('the return shape is exactly (workforce_id uuid, email text) — nothing else', (() => {
  return /RETURNS TABLE \(\s*workforce_id uuid,\s*email text\s*\)/.test(migrationSql);
})());

// --- null email is handled ---
check('the function selects w.email directly (no COALESCE/placeholder) so NULL is preserved for the client to render as "No email on file"', (() => {
  return /SELECT w\.id, w\.email/.test(migrationSql) && !/COALESCE\(w\.email/i.test(migrationSql);
})());
check('PendingResidentsPanel.tsx renders an explicit "No email on file" state', (() => {
  return /No email on file/.test(panel);
})());

// --- PendingResidentsPanel receives only the intended contact data ---
check('workforceContactService.ts calls the RPC by name, not a direct table select', (() => {
  return /rpc\(\s*'chief_get_active_member_contacts'/.test(contactService) && !/\.from\('workforce'\)/.test(contactService);
})());
check('PendingResidentsPanelProps carries memberContacts as Record<string, string | null>', (() => {
  return /memberContacts:\s*Record<string,\s*string\s*\|\s*null>/.test(panel);
})());

// --- no send/notification capability is introduced ---
check('no send/mail-dispatch/template/scheduler code was introduced anywhere in this slice\'s files', (() => {
  const combined = contactService + dashboard + panel + migrationSql;
  return !/sendEmail|mailto:|nodemailer|resend\.com|sendgrid|postmark|smtp|setInterval|cron/i.test(combined);
})());

// --- no resident-facing surface receives email ---
check('ResidentFormView.tsx is untouched by this slice — no reference to the new RPC/service', (() => {
  return !/chief_get_active_member_contacts|workforceContactService/.test(residentForm);
})());
check('MyAssignmentView.tsx (the other member-facing surface) is untouched by this slice', (() => {
  return !/chief_get_active_member_contacts|workforceContactService/.test(myAssignmentView);
})());

check('migration 69 is explicitly marked NOT APPLIED / written-for-review-only', (() => {
  return /WRITTEN FOR REVIEW ONLY/i.test(migrationSql) && /NOT APPLIED LIVE/i.test(migrationSql);
})());

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('\nAll pending-member-contacts verification checks passed.');
  process.exit(0);
}
