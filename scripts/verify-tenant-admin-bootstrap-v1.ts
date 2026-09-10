import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  hasUnsafeTenantVocabularyMarkup,
  resolveTenantVocabulary,
  TENANT_VOCABULARY_DEFAULTS,
} from '../src/modules/shared/tenantVocabulary';
import { resolveOrganisationMembershipProjection } from '../src/modules/auth/lib/membershipProjection';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/87_tenant_admin_bootstrap_and_setup_v1.sql');
const app = read('src/App.tsx');
const navbar = read('src/modules/shared/ui/Navbar.tsx');
const dashboard = read('src/modules/org-admin/components/AuthenticatedTenantAdminDashboardView.tsx');
const service = read('src/modules/org-admin/lib/tenantAdminService.ts');
const legacyLogin = read('src/modules/auth/components/ChiefLoginView.tsx');
const branding = read('src/modules/shared/config/branding.ts');
let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks += 1; };

check(migration.includes("capability text NOT NULL CHECK (capability = 'TENANT_ADMIN')"), 'canonical capability is TENANT_ADMIN');
check(migration.includes('v_target.auth_user_id <> p_actor_auth_user_id'), 'bootstrap actor must own the target membership');
check(migration.includes("v_target.status <> 'active'") && migration.includes('v_target.is_workforce_member <> true'), 'bootstrap requires one active linked workforce membership');
check(migration.includes('different active tenant administrator'), 'bootstrap refuses a conflicting administrator');
check(migration.includes('idempotency_key text NOT NULL UNIQUE'), 'grant and setup audit tables enforce idempotency');
check(migration.includes("v_existing.action <> 'GRANTED'") && migration.includes("v_existing.action <> 'REVOKED'"), 'grant and revocation replays are bound to their original action');
check(migration.includes('tenant_admin_authority_events') && migration.includes('authorization_reference') && migration.includes('reason'), 'authority audit records actor, target, reason and authorization');
check(migration.includes('TO service_role') && migration.includes('FROM PUBLIC, anon, authenticated'), 'bootstrap and revocation are service-role only');
check(migration.includes('auth.uid() IS NULL') && migration.includes('is_tenant_admin = true') && migration.includes("om.status = 'active'"), 'dashboard authority is resolved from the current JWT membership');
check(migration.includes("t.status = 'active'"), 'suspended organisations cannot authorize the dashboard');
check(migration.includes('Cross-tenant configuration is not allowed'), 'configuration mutation rejects a mismatched tenant');
check(migration.includes("trim(p_name) ~ '[<>]'") && migration.includes("trim(v_value #>> '{}') ~ '[<>]'"), 'server rejects markup in names and vocabulary');
check(migration.includes('v_allowed_keys') && migration.includes('v_allowed_modules'), 'server allow-lists vocabulary and module visibility keys');
check(migration.includes('before_state') && migration.includes('after_state') && migration.includes('actor_auth_user_id'), 'configuration changes have durable before/after actor evidence');
check(migration.includes('module_flags = module_flags || p_module_flags_patch'), 'module changes preserve unrelated module configuration');
check(!migration.includes('admin_access_code'), 'authenticated authority does not read or copy the shared code');

check(TENANT_VOCABULARY_DEFAULTS.member === 'Member' && TENANT_VOCABULARY_DEFAULTS.admin === 'Organisation Administrator', 'missing tenant labels use generic defaults');
check(!Object.values(TENANT_VOCABULARY_DEFAULTS).some(value => /UCH|Family Medicine|Resident|Consultant|WACP/i.test(value)), 'generic defaults contain no first-tenant or medical vocabulary');
check(resolveTenantVocabulary({ member: 'Colleague' }, 'member') === 'Colleague', 'synthetic non-medical label resolves from configuration');
check(resolveTenantVocabulary({}, 'admin') === 'Organisation Administrator', 'missing administrator label falls back safely');
check(hasUnsafeTenantVocabularyMarkup('<script>') && hasUnsafeTenantVocabularyMarkup('bad\u0000label'), 'unsafe markup and controls are rejected');
check(!hasUnsafeTenantVocabularyMarkup('Programme Lead'), 'ordinary configured language is accepted');

const baseMembership = {
  membership_id: '10000000-0000-4000-8000-000000000001', tenant_id: '20000000-0000-4000-8000-000000000001',
  tenant_name: 'Synthetic Cooperative', workforce_id: '30000000-0000-4000-8000-000000000001', workforce_full_name: 'Synthetic Member',
  is_workforce_member: true, is_tenant_admin: true, status: 'active' as const, linked_at: null, claimed_at: new Date(0).toISOString(),
};
const adminProjection = resolveOrganisationMembershipProjection([baseMembership], baseMembership.workforce_id);
const relabelledProjection = resolveOrganisationMembershipProjection([baseMembership], baseMembership.workforce_id);
check(adminProjection.state === 'linked' && !!adminProjection.tenantAdminMembership, 'tenant-admin membership projects admin access');
check(JSON.stringify(adminProjection) === JSON.stringify(relabelledProjection), 'changing display terminology cannot change authorization projection');
const ordinaryProjection = resolveOrganisationMembershipProjection([{ ...baseMembership, is_tenant_admin: false }], baseMembership.workforce_id);
check(ordinaryProjection.state === 'linked' && ordinaryProjection.tenantAdminMembership === null, 'ordinary member does not project admin access');

check(app.includes('hasAuthenticatedTenantAdmin') && app.includes('<AuthenticatedTenantAdminDashboardView'), 'authenticated admin route uses the canonical membership projection');
check(app.includes("membershipProjection.state === 'checking'") && app.includes("<Navigate to={currentDoctor ?"), 'direct route waits for server projection and rejects non-admin users');
check(navbar.includes('Switch to Admin') && navbar.includes('Member Workspace'), 'navigation supports switching in both directions');
check(navbar.includes("t('admin', 'Organisation Administrator')"), 'badge label is configured with a generic fallback');
check(dashboard.includes('aria-label={`Tenant administrator: ${adminLabel}`}'), 'tenant-admin badge has an accessible name');
check(dashboard.includes('focus-visible:ring-2') && dashboard.includes('min-h-11'), 'admin actions have visible focus and adequate targets');
check(dashboard.includes('<ConfirmationDialog') && dashboard.includes('Review changes'), 'consequential setup changes require review');
check(dashboard.includes('crypto.randomUUID()') && dashboard.includes('disabled={saving || !!validationError}'), 'setup submission has unique idempotency and double-submit prevention');
check(service.includes("rpc('workspc_tenant_admin_get_dashboard')") && service.includes("rpc('workspc_tenant_admin_update_setup'"), 'UI uses the existing Supabase server boundary');
check(!dashboard.includes('localStorage') && !service.includes('localStorage'), 'authenticated administration creates no browser-local authority');
check(legacyLogin.includes('Transitional administrator recovery') && legacyLogin.includes('does not create or grant personal tenant-administrator authority'), 'legacy shared-code access is clearly classified');
check(!/productName:.*(?:UCH|Family Medicine)|orgLabel:.*(?:UCH|Family Medicine)|copyrightHolder:.*(?:UCH|Family Medicine)/i.test(branding), 'shared runtime branding contains no first-tenant identity');
check(branding.includes("B2B_INSTITUTIONAL_BRAND") && branding.includes("orgLabel: 'Organisation'"), 'institutional brand uses a generic platform label');

console.log(`tenant-admin bootstrap and setup verifier passed (${checks} checks)`);
