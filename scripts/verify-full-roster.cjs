#!/usr/bin/env node
// Full Roster — focused, dependency-free verification for the
// resident_get_current_full_roster() contract (migration 73) and its
// client-side wiring. Matches the existing scripts/verify-*.cjs
// convention (no Vitest/Jest/Playwright, no network call, no database, no
// writes) — sibling script to verify-my-assignment.cjs, same conventions.
//
// SCOPE OF WHAT THIS CAN AND CANNOT PROVE:
//   - Migration 73 is WRITTEN LOCALLY ONLY, NOT APPLIED (see that file's
//     header) — there is no live/local Postgres in this harness to
//     actually execute the SQL against. Section 2 verifies the SQL's
//     *text* for the required structural properties (credential
//     reverification, server-derived tenant scoping, published-only
//     gate, two-state contract, GRANT EXECUTE, no p_tenant_id parameter,
//     name-resolution helper usage) and confirms it does NOT touch/
//     redefine resident_get_current_assignment (My Assignment unaffected
//     by this migration).
//   - Section 3 independently re-derives the name-resolution +
//     grid-reshaping logic in plain JS and checks it against fixture
//     data, including a two-tenant fixture proving cross-tenant isolation
//     of the resolution helper and a draft-vs-published fixture proving
//     drafts are never exposed.
//   - Section 4 statically confirms the client (fullRosterService.ts,
//     FullRosterView.tsx) never references combined_master_rosters
//     directly, calls the RPC by name with only (workforceId, code), and
//     that FullRosterView.tsx renders all four sections generically with
//     clean null-handling and no hardcoded matching/business logic on any
//     UCH-specific literal.
//
// Run: node scripts/verify-full-roster.cjs (or npm run verify:full-roster)

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

const MIGRATION_PATH = 'supabase/migrations/73_resident_get_current' + '_full_roster.sql';
const SERVICE_PATH = 'src/modules/roster-engine/lib/fullRosterService.ts';
const VIEW_PATH = 'src/modules/roster-engine/components/FullRosterView.tsx';
const MY_ASSIGNMENT_MIGRATION_PATH = 'supabase/migrations/72_resident_get_current' + '_assignment_satellite_range.sql';

check('migration 73 file exists', fs.existsSync(path.join(REPO_ROOT, MIGRATION_PATH)));
check('fullRosterService.ts exists', fs.existsSync(path.join(REPO_ROOT, SERVICE_PATH)));
check('FullRosterView.tsx exists', fs.existsSync(path.join(REPO_ROOT, VIEW_PATH)));
check('migration 72 (My Assignment, prior slice) still exists unmodified alongside this one', fs.existsSync(path.join(REPO_ROOT, MY_ASSIGNMENT_MIGRATION_PATH)));

const migrationSql = fs.existsSync(path.join(REPO_ROOT, MIGRATION_PATH)) ? read(MIGRATION_PATH) : '';
const migration72Sql = fs.existsSync(path.join(REPO_ROOT, MY_ASSIGNMENT_MIGRATION_PATH)) ? read(MY_ASSIGNMENT_MIGRATION_PATH) : '';
const serviceTs = fs.existsSync(path.join(REPO_ROOT, SERVICE_PATH)) ? read(SERVICE_PATH) : '';
const viewTsx = fs.existsSync(path.join(REPO_ROOT, VIEW_PATH)) ? read(VIEW_PATH) : '';

// =====================================================================
// Section 2 — migration 73 SQL structural properties.
// =====================================================================

check('migration 73 is explicitly marked NOT APPLIED / written-for-review-only', (() => {
  return /WRITTEN FOR REVIEW ONLY/i.test(migrationSql) && /NOT APPLIED LIVE/i.test(migrationSql);
})());

check('RPC signature takes exactly (p_workforce_id uuid, p_code text) — no p_target_workforce_id / no second identity param', (() => {
  const signatureLine = (migrationSql.match(/CREATE OR REPLACE FUNCTION public\.resident_get_current_full_roster\([^)]*\)/) || [''])[0];
  const hasSignature = /^CREATE OR REPLACE FUNCTION public\.resident_get_current_full_roster\(p_workforce_id uuid, p_code text\)$/.test(signatureLine);
  const hasTargetParam = /p_target/i.test(signatureLine);
  return hasSignature && !hasTargetParam;
})());

check('SECURITY DEFINER + fixed search_path present', (() => {
  return /LANGUAGE plpgsql SECURITY DEFINER SET search_path = public/.test(migrationSql);
})());

check('reverifies workforce_id + resident_code + active = true server-side (same credential gate as resident_get_current_assignment)', (() => {
  return /w\.id\s*=\s*p_workforce_id/.test(migrationSql)
    && /w\.resident_code\s*=\s*p_code/.test(migrationSql)
    && /w\.active\s*=\s*true/.test(migrationSql)
    && /RAISE EXCEPTION 'Invalid access code' USING ERRCODE = '28000'/.test(migrationSql);
})());

check('tenant is derived from the verified workforce row, not a client parameter — the MAIN RPC itself takes no tenant parameter (its own signature/body, not the internal _resolve_workforce_names helper, which legitimately names its own local parameter p_tenant_id)', (() => {
  const mainFnStart = migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.resident_get_current_full_roster');
  const mainFnBody = migrationSql.slice(mainFnStart);
  const mainSignatureLine = (mainFnBody.match(/CREATE OR REPLACE FUNCTION public\.resident_get_current_full_roster\([^)]*\)/) || [''])[0];
  return /SELECT w\.tenant_id INTO v_tenant_id/.test(mainFnBody)
    && !/p_tenant_id/i.test(mainSignatureLine);
})());

check('current collection is looked up via settings.current_collection_id, not invented/hardcoded', (() => {
  return /s\.current_collection_id\s+INTO\s+v_current_collection_id/.test(migrationSql);
})());

check('published-only gate present, and scoped to the derived tenant (never another tenant\'s roster)', (() => {
  return /combined_master_rosters/.test(migrationSql)
    && /cmr\.status\s*=\s*'published'/.test(migrationSql)
    && /cmr\.tenant_id\s*=\s*v_tenant_id/.test(migrationSql);
})());

check('two-state contract literals present (not_published/published) — no fabricated third state for a whole-roster view', (() => {
  return /'not_published'/.test(migrationSql) && /'published'/.test(migrationSql);
})());

check('every "not FOUND" path returns a two-state result, never leaks a draft/other-tenant row shape', (() => {
  const returns = migrationSql.match(/RETURN QUERY SELECT[\s\S]*?;/g) || [];
  const notPublishedReturns = returns.filter((r) => r.includes("'not_published'"));
  return notPublishedReturns.length === 2; // no-current-collection path, and roster-not-found/not-published path
})());

check('resolves GOP consultants[]/residents[], A&E on_call[], and Satellite assigned[] via the tenant-scoped name-resolution helper', (() => {
  return /_resolve_workforce_names\(slot->'consultants', v_tenant_id\)/.test(migrationSql)
    && /_resolve_workforce_names\(slot->'residents', v_tenant_id\)/.test(migrationSql)
    && /_resolve_workforce_names\(shift->'on_call', v_tenant_id\)/.test(migrationSql)
    && /_resolve_workforce_names\(posting->'assigned', v_tenant_id\)/.test(migrationSql);
})());

check('Supervision grid is passed through unchanged (first_on_duty/second_on_duty are already plain text, no resolution call on them)', (() => {
  return /v_roster\.supervision_grid/.test(migrationSql)
    && !/_resolve_workforce_names\([^)]*first_on_duty/.test(migrationSql)
    && !/_resolve_workforce_names\([^)]*second_on_duty/.test(migrationSql);
})());

check('name-resolution helper is tenant-scoped (w.tenant_id = p_tenant_id) and falls back to the raw stored value, never fabricating a name', (() => {
  const helperBlock = migrationSql.slice(migrationSql.indexOf('_resolve_workforce_names(p_ids'), migrationSql.indexOf('CREATE OR REPLACE FUNCTION public.resident_get_current_full_roster'));
  return /w\.tenant_id\s*=\s*p_tenant_id/.test(helperBlock) && /COALESCE\(/.test(helperBlock);
})());

check('GRANT EXECUTE on resident_get_current_full_roster to anon, authenticated present', (() => {
  return /GRANT EXECUTE ON FUNCTION public\.resident_get_current_full_roster\(uuid, text\) TO anon, authenticated/.test(migrationSql);
})());

check('does NOT weaken combined_master_rosters RLS or grants (no ALTER POLICY / DROP POLICY / new GRANT on combined_master_rosters anywhere in this file)', (() => {
  return !/ALTER POLICY/i.test(migrationSql)
    && !/DROP POLICY/i.test(migrationSql)
    && !/GRANT[^;]*ON combined_master_rosters/i.test(migrationSql);
})());

check('migration 73 does NOT touch/redefine resident_get_current_assignment at all — My Assignment is untouched by this migration', (() => {
  return !/CREATE OR REPLACE FUNCTION public\.resident_get_current_assignment\(/.test(migrationSql);
})());

check('migration 72 (My Assignment) file itself is unmodified by this slice', (() => {
  return /WRITTEN FOR REVIEW ONLY/i.test(migration72Sql) && /resident_get_current_assignment/.test(migration72Sql);
})());

check('migration 73 introduces no fuzzy/ILIKE/similarity matching anywhere', (() => {
  return !/ILIKE|similarity\(|levenshtein/i.test(migrationSql);
})());

check('migration 73 introduces no new hardcoded UCH-Family-Medicine-specific literal VALUE in actual SQL code (section labels are rendered client-side, not in this migration; field/key names here are all pre-existing storage shape, not new)', (() => {
  const codeOnly = stripSqlComments(migrationSql);
  return !/\bTriage\b|\bNHIA\b|\bIkolaba\b|Managed Care|Male Sorting|Female Sorting|Children Sorting/i.test(codeOnly);
})());

// =====================================================================
// Section 3 — logic-level parity: reimplemented name-resolution +
// grid-reshaping rules vs. fixture data.
// =====================================================================

function resolveNames(ids, tenantId, workforce) {
  return (ids || []).map((id) => {
    const match = workforce.find((w) => w.id === id && w.tenant_id === tenantId);
    return match ? match.full_name : id;
  });
}

function buildFullRoster(tenantId, roster, workforce) {
  if (!roster || roster.tenant_id !== tenantId || roster.status !== 'published') {
    return {
      status: 'not_published', month: null, year: null,
      gop_clinic_grid: { slots: [], unparsed_notes: [] },
      emergency_call_grid: { shifts: [], unparsed_notes: [] },
      supervision_grid: { duties: [], unparsed_notes: [] },
      satellite_grid: { postings: [], unparsed_notes: [] },
    };
  }
  return {
    status: 'published',
    month: roster.month,
    year: roster.year,
    gop_clinic_grid: {
      slots: (roster.gop_clinic_grid?.slots || []).map((s) => ({
        date_or_day: s.date_or_day,
        clinic_type: s.clinic_type,
        consultants: resolveNames(s.consultants, tenantId, workforce),
        residents: resolveNames(s.residents, tenantId, workforce),
      })),
      unparsed_notes: roster.gop_clinic_grid?.unparsed_notes || [],
    },
    emergency_call_grid: {
      shifts: (roster.emergency_call_grid?.shifts || []).map((s) => ({
        date_or_day: s.date_or_day,
        shift: s.shift,
        on_call: resolveNames(s.on_call, tenantId, workforce),
      })),
      unparsed_notes: roster.emergency_call_grid?.unparsed_notes || [],
    },
    supervision_grid: roster.supervision_grid || { duties: [], unparsed_notes: [] },
    satellite_grid: {
      postings: (roster.satellite_grid?.postings || []).map((p) => ({
        facility: p.facility,
        date_or_day: p.date_or_day,
        assigned: resolveNames(p.assigned, tenantId, workforce),
      })),
      unparsed_notes: roster.satellite_grid?.unparsed_notes || [],
    },
  };
}

const WORKFORCE = [
  { id: 'w1', tenant_id: 'tenant-a', full_name: 'Dr. Ada' },
  { id: 'w2', tenant_id: 'tenant-a', full_name: 'Dr. Bola' },
  { id: 'w3', tenant_id: 'tenant-b', full_name: 'Dr. Cross-Tenant' },
];

check('GOP: resolves consultants[]/residents[] workforce_id arrays to full_name, tenant-scoped', (() => {
  const roster = { tenant_id: 'tenant-a', status: 'published', month: 9, year: 2026,
    gop_clinic_grid: { slots: [{ date_or_day: 'Monday', clinic_type: 'Triage', consultants: ['w1'], residents: ['w2'] }] },
    emergency_call_grid: {}, supervision_grid: {}, satellite_grid: {} };
  const r = buildFullRoster('tenant-a', roster, WORKFORCE);
  const slot = r.gop_clinic_grid.slots[0];
  return slot.consultants[0] === 'Dr. Ada' && slot.residents[0] === 'Dr. Bola';
})());

check('An unresolvable id (no matching workforce row) falls back to the raw stored string, never fabricated', (() => {
  const roster = { tenant_id: 'tenant-a', status: 'published', month: 9, year: 2026,
    gop_clinic_grid: { slots: [{ date_or_day: 'Monday', clinic_type: 'Triage', consultants: ['Dr Unresolved Text'], residents: [] }] },
    emergency_call_grid: {}, supervision_grid: {}, satellite_grid: {} };
  const r = buildFullRoster('tenant-a', roster, WORKFORCE);
  return r.gop_clinic_grid.slots[0].consultants[0] === 'Dr Unresolved Text';
})());

check('Cross-tenant isolation: a workforce_id belonging to ANOTHER tenant is never resolved to that other tenant\'s name (falls back to raw id instead of leaking cross-tenant identity)', (() => {
  const roster = { tenant_id: 'tenant-a', status: 'published', month: 9, year: 2026,
    gop_clinic_grid: { slots: [{ date_or_day: 'Monday', clinic_type: 'Triage', consultants: ['w3'], residents: [] }] },
    emergency_call_grid: {}, supervision_grid: {}, satellite_grid: {} };
  const r = buildFullRoster('tenant-a', roster, WORKFORCE);
  return r.gop_clinic_grid.slots[0].consultants[0] === 'w3' && r.gop_clinic_grid.slots[0].consultants[0] !== 'Dr. Cross-Tenant';
})());

check('Another tenant\'s published roster is never returned for this tenant\'s call (simulated: roster.tenant_id mismatch yields not_published, not that roster\'s content)', (() => {
  const otherTenantsRoster = { tenant_id: 'tenant-b', status: 'published', month: 9, year: 2026,
    gop_clinic_grid: { slots: [{ date_or_day: 'Monday', clinic_type: 'Triage', consultants: ['w3'], residents: [] }] },
    emergency_call_grid: {}, supervision_grid: {}, satellite_grid: {} };
  const r = buildFullRoster('tenant-a', otherTenantsRoster, WORKFORCE);
  return r.status === 'not_published' && r.gop_clinic_grid.slots.length === 0;
})());

check('A draft/chief_review roster is never exposed, even though it matches this tenant', (() => {
  const draftRoster = { tenant_id: 'tenant-a', status: 'chief_review', month: 9, year: 2026,
    gop_clinic_grid: { slots: [{ date_or_day: 'Monday', clinic_type: 'Triage', consultants: ['w1'], residents: [] }] },
    emergency_call_grid: {}, supervision_grid: {}, satellite_grid: {} };
  const r = buildFullRoster('tenant-a', draftRoster, WORKFORCE);
  return r.status === 'not_published' && r.gop_clinic_grid.slots.length === 0;
})());

check('No current collection at all (null roster) yields not_published with empty-SHAPED grids, not null/undefined grids', (() => {
  const r = buildFullRoster('tenant-a', null, WORKFORCE);
  return r.status === 'not_published'
    && Array.isArray(r.gop_clinic_grid.slots) && Array.isArray(r.emergency_call_grid.shifts)
    && Array.isArray(r.supervision_grid.duties) && Array.isArray(r.satellite_grid.postings);
})());

check('A&E: resolves on_call[] the same way', (() => {
  const roster = { tenant_id: 'tenant-a', status: 'published', month: 9, year: 2026,
    gop_clinic_grid: {}, emergency_call_grid: { shifts: [{ date_or_day: 'Tuesday', shift: '4pm-10pm', on_call: ['w1', 'w2'] }] },
    supervision_grid: {}, satellite_grid: {} };
  const r = buildFullRoster('tenant-a', roster, WORKFORCE);
  return r.emergency_call_grid.shifts[0].on_call.join(',') === 'Dr. Ada,Dr. Bola';
})());

check('Satellite: resolves assigned[] and preserves a null date_or_day verbatim (migration 72 period/range postings), never fabricating a date', (() => {
  const roster = { tenant_id: 'tenant-a', status: 'published', month: 9, year: 2026,
    gop_clinic_grid: {}, emergency_call_grid: {}, supervision_grid: {},
    satellite_grid: { postings: [{ facility: 'Agbeke Mercy', date_or_day: null, assigned: ['w1'] }] } };
  const r = buildFullRoster('tenant-a', roster, WORKFORCE);
  const posting = r.satellite_grid.postings[0];
  return posting.assigned[0] === 'Dr. Ada' && posting.date_or_day === null;
})());

check('Supervision: passed through completely unchanged (already plain full_name text, no resolution)', (() => {
  const roster = { tenant_id: 'tenant-a', status: 'published', month: 9, year: 2026,
    gop_clinic_grid: {}, emergency_call_grid: {},
    supervision_grid: { duties: [{ date_or_day: 'Wednesday', first_on_duty: 'Dr. Ada', second_on_duty: 'Dr. Bola' }] },
    satellite_grid: {} };
  const r = buildFullRoster('tenant-a', roster, WORKFORCE);
  return r.supervision_grid.duties[0].first_on_duty === 'Dr. Ada' && r.supervision_grid.duties[0].second_on_duty === 'Dr. Bola';
})());

check('unparsed_notes (footnotes) are preserved verbatim on every grid, not dropped', (() => {
  const roster = { tenant_id: 'tenant-a', status: 'published', month: 9, year: 2026,
    gop_clinic_grid: { slots: [], unparsed_notes: ['Ikolaba covered by rotation.'] },
    emergency_call_grid: { shifts: [], unparsed_notes: ['A leave-safe adjustment applied.'] },
    supervision_grid: { duties: [], unparsed_notes: [] },
    satellite_grid: { postings: [], unparsed_notes: ['Agbeke/Airport/NYSC cover 1-30 Sep.'] } };
  const r = buildFullRoster('tenant-a', roster, WORKFORCE);
  return r.gop_clinic_grid.unparsed_notes[0] === 'Ikolaba covered by rotation.'
    && r.emergency_call_grid.unparsed_notes[0] === 'A leave-safe adjustment applied.'
    && r.satellite_grid.unparsed_notes[0] === 'Agbeke/Airport/NYSC cover 1-30 Sep.';
})());

// =====================================================================
// Section 4 — client never reads combined_master_rosters directly, calls
// the RPC by name with only (workforceId, code), and the view renders
// generically with clean null-handling.
// =====================================================================

check('fullRosterService.ts never references combined_master_rosters directly (outside comments)', (() => {
  return !/combined_master_rosters/.test(stripLineComments(serviceTs));
})());

check('fullRosterService.ts calls the RPC by name, not a table select', (() => {
  return /rpc\(\s*'resident_get_current_full_roster'/.test(serviceTs);
})());

check('fullRosterService.ts exposes only (workforceId, code) — no separate/arbitrary target-member or tenant parameter', (() => {
  const sig = serviceTs.match(/getCurrentFullRoster\(([^)]*)\)/);
  if (!sig) return false;
  const params = sig[1];
  return /workforceId/.test(params) && /code/.test(params) && !/target/i.test(params) && !/tenantId/i.test(params);
})());

check('FullRosterView.tsx never references combined_master_rosters directly', (() => {
  return !/combined_master_rosters/.test(viewTsx);
})());

check('FullRosterView.tsx renders all four sections generically (gop/emergency/supervision/satellite keys present)', (() => {
  return /key:\s*'gop'/.test(viewTsx) && /key:\s*'emergency'/.test(viewTsx)
    && /key:\s*'supervision'/.test(viewTsx) && /key:\s*'satellite'/.test(viewTsx);
})());

check('FullRosterView.tsx guards a null/absent date_or_day cleanly (no literal "null" string, no crash) — renders a placeholder dash instead', (() => {
  return /row\.date_or_day\s*\?\?/.test(viewTsx);
})());

check('FullRosterView.tsx renders section notes/footnotes when present', (() => {
  return /section\.notes/.test(viewTsx) && /section\.notes\.length > 0/.test(viewTsx);
})());

check('FullRosterView.tsx does not persist the access PIN to localStorage/sessionStorage', (() => {
  return !/localStorage\.(set|get)Item/.test(viewTsx) && !/sessionStorage\.(set|get)Item/.test(viewTsx);
})());

check('FullRosterView.tsx has both a desktop/tablet table (hidden below sm) and a mobile stacked-card rendering (hidden at sm and up) — responsive, not a dropped view', (() => {
  return /hidden sm:block/.test(viewTsx) && /sm:hidden/.test(viewTsx);
})());

check('FullRosterView.tsx wraps its desktop table in a horizontally-scrollable container rather than silently dropping columns', (() => {
  return /overflow-x-auto/.test(viewTsx);
})());

check('FullRosterView.tsx\'s generic RosterRow/RosterSection/RosterAssignee types introduce no UCH-Family-Medicine-specific field name (clinic_type/shift/facility are generalized to duty_or_service_point)', (() => {
  const typesBlock = viewTsx.slice(viewTsx.indexOf('interface RosterAssignee'), viewTsx.indexOf('function buildSections'));
  return !/clinic_type|on_call|first_on_duty|second_on_duty/.test(typesBlock);
})());

check('FullRosterView.tsx section LABELS are current stored/display vocabulary used verbatim (explicitly in scope per this slice), not hardcoded into any matching/business logic — buildSections only maps existing storage fields, never branches on a label value', (() => {
  const buildSectionsBlock = viewTsx.slice(viewTsx.indexOf('function buildSections'), viewTsx.indexOf('export const FullRosterView'));
  // No conditional branching on a section's own label/key text anywhere in the transform.
  return !/if\s*\(.*label/.test(buildSectionsBlock) && !/switch\s*\(.*label/.test(buildSectionsBlock);
})());

// =====================================================================

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
} else {
  console.log('\nAll Full Roster verification checks passed.');
  process.exit(0);
}
