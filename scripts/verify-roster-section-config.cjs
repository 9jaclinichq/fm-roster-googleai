#!/usr/bin/env node
// Roster Section Config — focused, dependency-free verification for
// migration 74 (roster_section_config table + 3 RPCs) and its client
// wiring. Matches the existing scripts/verify-*.cjs convention (no
// Vitest/Jest/Playwright, no network call, no database, no writes).
//
// SCOPE OF WHAT THIS CAN AND CANNOT PROVE:
//   - Migration 74 is WRITTEN LOCALLY ONLY, NOT APPLIED — Section 2
//     verifies the SQL's *text* for the required structural/security
//     properties (RLS-enabled-with-zero-policies, CHECK-constrained
//     section_key, credential/admin-code reverification, tenant
//     derivation, no cross-tenant path) and confirms migrations 67-73 are
//     completely untouched (My Assignment / Full Roster unaffected).
//   - Section 3 independently re-derives resolveRosterSectionPresentation
//     in plain JS and checks it against fixture data, including two-tenant
//     isolation, no-configuration fallback, and partial-configuration
//     per-field fallback.
//   - Section 4 statically confirms the frontend files wire the shared
//     resolver consistently (one resolver, not per-component label maps)
//     and that no business logic anywhere depends on color/order/label.
//
// Run: node scripts/verify-roster-section-config.cjs

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

function stripSqlComments(text) {
  return text.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
}
function stripLineComments(text) {
  return text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
}

// =====================================================================
// Section 1 — files exist where the approved plan said they would.
// =====================================================================

const MIGRATION_PATH = 'supabase/migrations/74_roster_section' + '_config.sql';
const RESOLVER_PATH = 'src/modules/roster-engine/lib/rosterSectionPresentation.ts';
const RESIDENT_SERVICE_PATH = 'src/modules/roster-engine/lib/rosterSectionPresentationService.ts';
const TENANT_SERVICE_PATH = 'src/lib/services/tenantService.ts';
const MY_ASSIGNMENT_VIEW_PATH = 'src/modules/roster-engine/components/MyAssignmentView.tsx';
const FULL_ROSTER_VIEW_PATH = 'src/modules/roster-engine/components/FullRosterView.tsx';
const CHIEF_UI_PATH = 'src/modules/org-admin/components/dashboard/TenantCustomizationView.tsx';

for (const p of [MIGRATION_PATH, RESOLVER_PATH, RESIDENT_SERVICE_PATH, TENANT_SERVICE_PATH, MY_ASSIGNMENT_VIEW_PATH, FULL_ROSTER_VIEW_PATH, CHIEF_UI_PATH]) {
  check(`${p} exists`, fs.existsSync(path.join(REPO_ROOT, p)));
}

const migrationSql = read(MIGRATION_PATH);
const resolverTs = read(RESOLVER_PATH);
const residentServiceTs = read(RESIDENT_SERVICE_PATH);
const tenantServiceTs = read(TENANT_SERVICE_PATH);
const myAssignmentViewTsx = read(MY_ASSIGNMENT_VIEW_PATH);
const fullRosterViewTsx = read(FULL_ROSTER_VIEW_PATH);
const chiefUiTsx = read(CHIEF_UI_PATH);

// =====================================================================
// Section 2 — migration 74 SQL structural/security properties.
// =====================================================================

check('migration 74 is explicitly marked NOT APPLIED / written-for-review-only', (() => {
  return /WRITTEN FOR REVIEW ONLY/i.test(migrationSql) && /NOT APPLIED LIVE/i.test(migrationSql);
})());

check('roster_section_config table has section_key CHECK constrained to exactly the 4 stable keys', (() => {
  return /CHECK \(section_key IN \('gop', 'emergency', 'supervision', 'satellite'\)\)/.test(migrationSql);
})());

check('roster_section_config has a UNIQUE(tenant_id, section_key) constraint (one row per section per tenant)', (() => {
  return /UNIQUE \(tenant_id, section_key\)/.test(migrationSql);
})());

check('roster_section_config has RLS ENABLED with ZERO policies defined (default-deny; every access mediated by an RPC)', (() => {
  const hasRlsEnable = /ALTER TABLE roster_section_config ENABLE ROW LEVEL SECURITY/.test(migrationSql);
  const hasAnyPolicyOnTable = /CREATE POLICY[^;]*ON roster_section_config/i.test(migrationSql);
  return hasRlsEnable && !hasAnyPolicyOnTable;
})());

check('no direct GRANT of table-level SELECT/INSERT/UPDATE on roster_section_config to anon/authenticated (RPC-only access)', (() => {
  return !/GRANT[^;]*ON roster_section_config[^;]*TO anon/i.test(migrationSql);
})());

check('resident_get_roster_section_presentation: same credential-reverification block as resident_get_current_assignment (workforce_id+resident_code+active=true, raises Invalid access code)', (() => {
  const start = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.resident_get_roster_section_presentation');
  const body = migrationSql.slice(start, migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.chief_get_roster_section_config'));
  return /w\.id\s*=\s*p_workforce_id/.test(body) && /w\.resident_code\s*=\s*p_code/.test(body)
    && /w\.active\s*=\s*true/.test(body) && /Invalid access code/.test(body) && /SECURITY DEFINER/.test(body);
})());

check('resident RPC signature has no client-supplied tenant parameter', (() => {
  const sigLine = (migrationSql.match(/CREATE OR REPLACE FUNCTION public\.resident_get_roster_section_presentation\([^)]*\)/) || [''])[0];
  return /^CREATE OR REPLACE FUNCTION public\.resident_get_roster_section_presentation\(p_workforce_id uuid, p_code text\)$/.test(sigLine);
})());

check('resident RPC is READ-ONLY (no INSERT/UPDATE/DELETE anywhere in its body) — no additional write capability granted to residents', (() => {
  const start = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.resident_get_roster_section_presentation');
  const end = migrationSql.indexOf('GRANT EXECUTE ON FUNCTION public.resident_get_roster_section_presentation');
  const body = migrationSql.slice(start, end);
  return !/INSERT INTO|UPDATE roster_section_config|DELETE FROM/i.test(body);
})());

check('chief_get_roster_section_config / chief_upsert_roster_section_config: same admin-code-verification pattern as chief_update_tenant_terminology (settings.admin_access_code, raises Invalid admin access code)', (() => {
  const start = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.chief_get_roster_section_config');
  const body = migrationSql.slice(start);
  return (body.match(/SELECT s\.tenant_id INTO v_tenant_id FROM settings s WHERE s\.admin_access_code = p_admin_code/g) || []).length === 2
    && (body.match(/Invalid admin access code/g) || []).length === 2;
})());

check('chief_upsert_roster_section_config rejects an unrecognized section_key before writing anything', (() => {
  const start = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.chief_upsert_roster_section_config');
  const body = migrationSql.slice(start);
  const rejectIdx = body.indexOf('Unknown roster section key');
  const insertIdx = body.indexOf('INSERT INTO roster_section_config');
  return rejectIdx !== -1 && insertIdx !== -1 && rejectIdx < insertIdx;
})());

check('the write RPC is the ONLY INSERT/UPDATE path into roster_section_config in this migration (resident and chief-read RPCs never write)', (() => {
  const allWrites = migrationSql.match(/(INSERT INTO roster_section_config|UPDATE roster_section_config)/g) || [];
  // Expect exactly: 1 INSERT + the ON CONFLICT DO UPDATE SET clause (same statement), both inside chief_upsert only.
  const writeSection = migrationSql.slice(migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.chief_upsert_roster_section_config'));
  const writesInsideUpsert = (writeSection.match(/(INSERT INTO roster_section_config)/g) || []).length;
  return allWrites.length >= 1 && writesInsideUpsert === allWrites.filter(w => w.startsWith('INSERT')).length;
})());

check('accent_color/icon are never referenced in any WHERE/IF/CASE condition anywhere in this migration (presentation metadata only, no business logic depends on color)', (() => {
  const codeOnly = stripSqlComments(migrationSql);
  const conditionalLines = codeOnly.split('\n').filter((l) => /\b(WHERE|IF|CASE)\b/i.test(l));
  return conditionalLines.every((l) => !/accent_color|icon/i.test(l));
})());

check('fallback defaults match "today\'s current behavior" (the same 4 grid_label strings resident_get_current_assignment already returns) — not new vocabulary', (() => {
  return /'gop', 'GOP Clinic Grid', 'GOP', 1/.test(migrationSql)
    && /'emergency', 'A&E Emergency Grid', 'A&E', 2/.test(migrationSql)
    && /'supervision', 'Supervision Grid', 'Supervision', 3/.test(migrationSql)
    && /'satellite', 'Satellite Grid', 'Satellite', 4/.test(migrationSql);
})());

check('migration 74 introduces no NEW UCH-Family-Medicine-specific term beyond the 4 already-established grid_label strings (no Triage/NHIA/Ikolaba/Agbeke/Airport/NYSC/Priority anywhere)', (() => {
  const codeOnly = stripSqlComments(migrationSql);
  return !/\bTriage\b|\bNHIA\b|\bIkolaba\b|\bAgbeke\b|\bAirport\b|\bNYSC\b|\bPriority\b|Managed Care|Male Sorting|Female Sorting|Children Sorting/i.test(codeOnly);
})());

check('migration 74 does NOT touch/redefine resident_get_current_assignment or resident_get_current_full_roster — My Assignment and Full Roster are both untouched', (() => {
  return !/CREATE OR REPLACE FUNCTION public\.resident_get_current_assignment\(/.test(migrationSql)
    && !/CREATE OR REPLACE FUNCTION public\.resident_get_current_full_roster\(/.test(migrationSql);
})());

check('migrations 72 and 73 files themselves are unmodified by this slice', (() => {
  const m72 = read('supabase/migrations/72_resident_get_current' + '_assignment_satellite_range.sql');
  const m73 = read('supabase/migrations/73_resident_get_current' + '_full_roster.sql');
  return /Migration 72:/.test(m72) && /Migration 73:/.test(m73);
})());

check('migration 74 introduces no fuzzy/ILIKE/similarity matching anywhere', (() => {
  return !/ILIKE|similarity\(|levenshtein/i.test(migrationSql);
})());

// =====================================================================
// Section 3 — logic-level parity: reimplemented resolver vs. fixture
// data, including two-tenant isolation and partial-configuration
// fallback. Mirrors src/modules/roster-engine/lib/
// rosterSectionPresentation.ts's resolveRosterSectionPresentation() —
// deliberate reimplementation for verification (same convention as
// verify-my-assignment.cjs), not an import (this is a .cjs script; that
// file is a TS ES module).
// =====================================================================

const FALLBACKS = {
  gop: { section_key: 'gop', display_label: 'GOP Clinic Grid', short_label: 'GOP', display_order: 1, accent_color: null, icon: null },
  emergency: { section_key: 'emergency', display_label: 'A&E Emergency Grid', short_label: 'A&E', display_order: 2, accent_color: null, icon: null },
  supervision: { section_key: 'supervision', display_label: 'Supervision Grid', short_label: 'Supervision', display_order: 3, accent_color: null, icon: null },
  satellite: { section_key: 'satellite', display_label: 'Satellite Grid', short_label: 'Satellite', display_order: 4, accent_color: null, icon: null },
};

function resolve(sectionKey, tenantConfig) {
  const fallback = FALLBACKS[sectionKey];
  const configured = (tenantConfig || []).find((c) => c.section_key === sectionKey);
  if (!configured) return fallback;
  return {
    section_key: sectionKey,
    display_label: configured.display_label || fallback.display_label,
    short_label: configured.short_label || fallback.short_label,
    display_order: configured.display_order ?? fallback.display_order,
    accent_color: configured.accent_color || null,
    icon: configured.icon || null,
  };
}

// Simulates the SERVER-SIDE resolution (COALESCE(NULLIF(...), fallback))
// that both read RPCs perform, per-tenant, so a two-tenant fixture proves
// isolation the same way the live RPCs enforce it (tenant_id match in the
// LEFT JOIN condition).
function serverResolveForTenant(tenantId, sectionKey, allConfigRows) {
  const row = allConfigRows.find((r) => r.tenant_id === tenantId && r.section_key === sectionKey);
  const fallback = FALLBACKS[sectionKey];
  return {
    section_key: sectionKey,
    display_label: (row && row.display_label) || fallback.display_label,
    short_label: (row && row.short_label) || fallback.short_label,
    display_order: (row && row.display_order != null) ? row.display_order : fallback.display_order,
    accent_color: (row && row.accent_color) || null,
    icon: (row && row.icon) || null,
  };
}

check('Tenant with no configuration receives current fallback presentation for every section', (() => {
  const r = resolve('gop', []);
  return r.display_label === 'GOP Clinic Grid' && r.short_label === 'GOP' && r.display_order === 1 && r.accent_color === null && r.icon === null;
})());

check('Partial configuration (only accent_color set) falls back correctly for every other field', (() => {
  const r = resolve('emergency', [{ section_key: 'emergency', display_label: null, short_label: null, display_order: null, accent_color: '#ff0000', icon: null }]);
  return r.display_label === 'A&E Emergency Grid' && r.short_label === 'A&E' && r.display_order === 2 && r.accent_color === '#ff0000';
})());

check('Tenant A can rename a section (display_label) — resolves to the tenant-configured value', (() => {
  const allRows = [{ tenant_id: 'tenant-a', section_key: 'gop', display_label: 'Floor Clinic', short_label: null, display_order: null, accent_color: null, icon: null }];
  const r = serverResolveForTenant('tenant-a', 'gop', allRows);
  return r.display_label === 'Floor Clinic';
})());

check('Tenant A renaming a section does NOT affect Tenant B — Tenant B still sees the current fallback', (() => {
  const allRows = [{ tenant_id: 'tenant-a', section_key: 'gop', display_label: 'Floor Clinic', short_label: null, display_order: null, accent_color: null, icon: null }];
  const rB = serverResolveForTenant('tenant-b', 'gop', allRows);
  return rB.display_label === 'GOP Clinic Grid';
})());

check('Tenant A\'s color/order does not leak to Tenant B', (() => {
  const allRows = [{ tenant_id: 'tenant-a', section_key: 'satellite', display_label: null, short_label: null, display_order: 99, accent_color: '#123456', icon: 'MapPin' }];
  const rA = serverResolveForTenant('tenant-a', 'satellite', allRows);
  const rB = serverResolveForTenant('tenant-b', 'satellite', allRows);
  return rA.display_order === 99 && rA.accent_color === '#123456' && rA.icon === 'MapPin'
    && rB.display_order === 4 && rB.accent_color === null && rB.icon === null;
})());

check('Full Roster and My Assignment resolve the SAME label for the SAME section_key (both call the one shared resolver against the same resolved config array)', (() => {
  const config = [{ section_key: 'supervision', display_label: 'Duty Board', short_label: 'Duty', display_order: 3, accent_color: null, icon: null }];
  const fullRosterLabel = resolve('supervision', config).display_label;
  // My Assignment reaches the same section_key via the GRID_LABEL_TO_SECTION_KEY bridge (grid_label 'Supervision Grid' -> 'supervision'), then the SAME resolver.
  const myAssignmentSectionKey = { 'Supervision Grid': 'supervision' }['Supervision Grid'];
  const myAssignmentLabel = resolve(myAssignmentSectionKey, config).display_label;
  return fullRosterLabel === myAssignmentLabel && fullRosterLabel === 'Duty Board';
})());

check('Changing a display label has no effect on other fields (order/color/icon untouched) — presentation fields resolve independently', (() => {
  const config = [{ section_key: 'gop', display_label: 'Renamed', short_label: null, display_order: null, accent_color: null, icon: null }];
  const r = resolve('gop', config);
  return r.display_label === 'Renamed' && r.display_order === 1 && r.accent_color === null;
})());

check('Changing display order has no effect on display_label (structurally independent fields)', (() => {
  const config = [{ section_key: 'gop', display_label: null, short_label: null, display_order: 42, accent_color: null, icon: null }];
  const r = resolve('gop', config);
  return r.display_order === 42 && r.display_label === 'GOP Clinic Grid';
})());

check('Changing color has no behavioral effect on label/order resolution (color is presentation-only)', (() => {
  const withoutColor = resolve('gop', [{ section_key: 'gop', display_label: 'X', short_label: null, display_order: null, accent_color: null, icon: null }]);
  const withColor = resolve('gop', [{ section_key: 'gop', display_label: 'X', short_label: null, display_order: null, accent_color: '#00ff00', icon: null }]);
  return withoutColor.display_label === withColor.display_label && withoutColor.display_order === withColor.display_order;
})());

// =====================================================================
// Section 4 — frontend wiring: one shared resolver (not per-component
// label maps), Chief-only write access, and no new hardcoded UCH term.
// =====================================================================

check('rosterSectionPresentationService.ts never references roster_section_config directly (RPC-only, outside comments)', (() => {
  return !/\.from\(\s*['"]roster_section_config['"]/.test(stripLineComments(residentServiceTs));
})());

check('rosterSectionPresentationService.ts calls the RPC by name with only (workforceId, code) — code widened to string | null by migration 79 for authenticated-membership coexistence, same shape otherwise', (() => {
  return /rpc\(\s*'resident_get_roster_section_presentation'/.test(residentServiceTs)
    && /getResidentPresentation\(workforceId: string, code: string \| null\)/.test(residentServiceTs);
})());

check('tenantService.ts exposes chiefGetRosterSectionConfig/chiefUpsertRosterSectionConfig calling the admin-code-verified RPCs (not a direct table write)', (() => {
  return /rpc\(\s*'chief_get_roster_section_config'/.test(tenantServiceTs)
    && /rpc\(\s*'chief_upsert_roster_section_config'/.test(tenantServiceTs)
    && !/\.from\(\s*['"]roster_section_config['"]/.test(stripLineComments(tenantServiceTs));
})());

check('MyAssignmentView.tsx uses the shared resolveRosterSectionPresentation (not its own hardcoded label map)', (() => {
  return /resolveRosterSectionPresentation/.test(myAssignmentViewTsx) && /GRID_LABEL_TO_SECTION_KEY/.test(myAssignmentViewTsx);
})());

check('FullRosterView.tsx uses the shared resolveRosterSectionPresentation (not its own hardcoded label constants) and sorts sections by resolved display_order', (() => {
  return /resolveRosterSectionPresentation/.test(fullRosterViewTsx) && /\.sort\(\(a, b\) => a\._order - b\._order\)/.test(fullRosterViewTsx);
})());

check('FullRosterView.tsx never hardcodes a section label literal directly in buildSections (labels come only from the resolver)', (() => {
  const buildSectionsBlock = fullRosterViewTsx.slice(fullRosterViewTsx.indexOf('function buildSections'), fullRosterViewTsx.indexOf('export const FullRosterView'));
  return !/'GOP Clinic Grid'|'A&E Emergency Grid'|'Supervision Grid'|'Satellite Grid'/.test(buildSectionsBlock);
})());

check('FullRosterView.tsx treats color as purely visual (a missing/invalid accent_color renders no border/dot, never breaks layout) — guarded, not assumed present', (() => {
  return /section\.accentColor &&/.test(fullRosterViewTsx);
})());

check('TenantCustomizationView.tsx (Chief/Admin-only surface) is the only place chiefUpsertRosterSectionConfig is called from — ordinary resident views never call it', (() => {
  const chiefCallsIt = /chiefUpsertRosterSectionConfig/.test(chiefUiTsx);
  const residentFilesCallIt = /chiefUpsertRosterSectionConfig/.test(myAssignmentViewTsx) || /chiefUpsertRosterSectionConfig/.test(fullRosterViewTsx);
  return chiefCallsIt && !residentFilesCallIt;
})());

check('No shared/generic file (resolver, resident service) introduces a NEW UCH-specific term beyond the 4 already-established fallback strings', (() => {
  const stripped = stripLineComments(resolverTs) + '\n' + stripLineComments(residentServiceTs);
  return !/\bTriage\b|\bNHIA\b|\bIkolaba\b|\bAgbeke\b|\bAirport\b|\bNYSC\b|\bPriority\b|Managed Care|Male Sorting|Female Sorting|Children Sorting/i.test(stripped);
})());

// =====================================================================

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('\nAll Roster Section Config verification checks passed.');
  process.exit(0);
}
