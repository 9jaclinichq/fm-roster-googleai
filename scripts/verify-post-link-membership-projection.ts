import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OrganisationMembership } from '../src/modules/auth/lib/organisationMembershipService';
import { resolveOrganisationMembershipProjection } from '../src/modules/auth/lib/membershipProjection';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const app = read('src/App.tsx');
const navbar = read('src/modules/shared/ui/Navbar.tsx');
const prompt = read('src/modules/auth/components/LinkInstitutionalAccessPrompt.tsx');
const resolverMigration = read('supabase/migrations/76_institutional_auth_mapping_foundation.sql');
const gatewayMigration = read('supabase/migrations/85_secure_delivery_gateway_v1.sql');
let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks += 1; };

const membership = (overrides: Partial<OrganisationMembership> = {}): OrganisationMembership => ({
  membership_id: '10000000-0000-4000-8000-000000000001',
  tenant_id: '20000000-0000-4000-8000-000000000001',
  tenant_name: 'Synthetic organization',
  workforce_id: '30000000-0000-4000-8000-000000000001',
  workforce_full_name: 'Synthetic member',
  is_workforce_member: true,
  is_tenant_admin: false,
  status: 'active',
  linked_at: null,
  claimed_at: '2026-09-09T00:00:00.000Z',
  ...overrides,
});

const linked = resolveOrganisationMembershipProjection([membership()], null);
check(linked.state === 'linked', 'one active workforce membership resolves as linked');
check(linked.workforceMembership?.workforce_id === membership().workforce_id, 'linked projection preserves server workforce identity');
check(linked.tenantAdminMembership === null, 'non-admin membership does not acquire admin capability');

const admin = resolveOrganisationMembershipProjection([membership({ is_tenant_admin: true })], null);
check(admin.state === 'linked' && admin.tenantAdminMembership?.is_tenant_admin === true, 'tenant admin is derived only from the canonical flag');

const inactive = resolveOrganisationMembershipProjection([membership({ status: 'revoked' })], null);
check(inactive.state === 'inactive', 'revoked membership is not projected as linked or unlinked');

const preferred = resolveOrganisationMembershipProjection([
  membership(),
  membership({ membership_id: '10000000-0000-4000-8000-000000000002', tenant_id: '20000000-0000-4000-8000-000000000002', workforce_id: '30000000-0000-4000-8000-000000000002' }),
], '30000000-0000-4000-8000-000000000002');
check(preferred.state === 'linked' && preferred.workforceMembership.workforce_id.endsWith('2'), 'existing server-authorized workforce context selects among multiple memberships');
check(resolveOrganisationMembershipProjection([
  membership(),
  membership({ membership_id: '10000000-0000-4000-8000-000000000002', tenant_id: '20000000-0000-4000-8000-000000000002', workforce_id: '30000000-0000-4000-8000-000000000002' }),
], null).state === 'ambiguous', 'multiple memberships are not selected by array order');
check(resolveOrganisationMembershipProjection([], null).state === 'unlinked', 'only absence of canonical rows produces unlinked state');

check(app.includes("projection.state === 'linked'\n          ? await databaseService.getWorkforceMemberById"), 'App resolves canonical workforce before legacy projection');
check(app.includes("projection.state === 'unlinked' && memberships.length === 0"), 'legacy doctor_id lookup is forbidden once any canonical row exists');
check(app.includes("localStorage.setItem('fm_session_resident', JSON.stringify(session))"), 'canonical workforce projection is persisted for refresh continuity');
check(app.includes("membershipProjection.state === 'signed-out'") && app.includes("membershipProjection.state === 'unlinked'"), 'link prompt is limited to a proven signed-out code session or authenticated unlinked state');
check(!prompt.includes('getCurrentUserMemberships'), 'link prompt no longer races a second membership read');
check(prompt.includes('onLinked(membership)'), 'successful claim immediately updates the authoritative parent projection');
check(navbar.includes('!currentDoctor && (!isChiefAuthenticated'), 'personal accounts do not see the legacy Chief portal action');
check(app.includes('currentDoctor && !membershipProjection.tenantAdminMembership'), 'direct admin portal navigation is rejected for non-admin personal accounts');
check(app.includes('no relinking action has been started') && app.includes('do not create another link'), 'read failure and inactive membership states give truthful non-relink guidance');
check(resolverMigration.includes('WHERE om.auth_user_id = auth.uid()'), 'membership resolver identity is server-derived');
check(resolverMigration.includes('is_tenant_admin boolean'), 'tenant-admin capability is an explicit canonical field');
check(gatewayMigration.includes("'membership_id', v_membership.id, 'is_tenant_admin', v_membership.is_tenant_admin"), 'Communication Hub uses the same server-side membership capability');
check(!app.includes("membership.status === 'active' && membership.workforce_id);"), 'App no longer chooses the first active membership');

console.log(`post-link membership projection verifier passed (${checks} checks)`);
