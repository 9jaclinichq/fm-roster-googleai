import { OrganisationMembership } from './organisationMembershipService';

export type OrganisationMembershipProjection =
  | { state: 'checking'; workforceMembership: null; tenantAdminMembership: null }
  | { state: 'signed-out'; workforceMembership: null; tenantAdminMembership: null }
  | { state: 'unlinked'; workforceMembership: null; tenantAdminMembership: OrganisationMembership | null }
  | { state: 'inactive'; workforceMembership: null; tenantAdminMembership: null }
  | { state: 'ambiguous'; workforceMembership: null; tenantAdminMembership: null }
  | { state: 'error'; workforceMembership: null; tenantAdminMembership: null }
  | { state: 'linked'; workforceMembership: OrganisationMembership; tenantAdminMembership: OrganisationMembership | null };

export const initialOrganisationMembershipProjection = (): OrganisationMembershipProjection => ({
  state: 'checking',
  workforceMembership: null,
  tenantAdminMembership: null,
});

// Resolve the server-owned organisation_memberships projection without ever
// treating array order as authority. A preferred workforce is only a context
// selector among memberships the server already returned for auth.uid(); it
// cannot manufacture or broaden a membership.
export function resolveOrganisationMembershipProjection(
  memberships: OrganisationMembership[],
  preferredWorkforceId: string | null,
): OrganisationMembershipProjection {
  const activeWorkforce = memberships.filter(
    membership => membership.status === 'active' && membership.is_workforce_member && membership.workforce_id,
  );
  const preferred = preferredWorkforceId
    ? activeWorkforce.find(membership => membership.workforce_id === preferredWorkforceId)
    : null;
  const workforceMembership = preferred ?? (activeWorkforce.length === 1 ? activeWorkforce[0] : null);

  if (!workforceMembership && activeWorkforce.length > 1) {
    return { state: 'ambiguous', workforceMembership: null, tenantAdminMembership: null };
  }

  if (workforceMembership) {
    const sameTenantAdmin = memberships.find(
      membership => membership.status === 'active'
        && membership.is_tenant_admin
        && membership.tenant_id === workforceMembership.tenant_id,
    ) ?? null;
    return { state: 'linked', workforceMembership, tenantAdminMembership: sameTenantAdmin };
  }

  if (memberships.some(membership => membership.status !== 'active')) {
    return { state: 'inactive', workforceMembership: null, tenantAdminMembership: null };
  }

  const activeAdmins = memberships.filter(membership => membership.status === 'active' && membership.is_tenant_admin);
  return {
    state: 'unlinked',
    workforceMembership: null,
    tenantAdminMembership: activeAdmins.length === 1 ? activeAdmins[0] : null,
  };
}
