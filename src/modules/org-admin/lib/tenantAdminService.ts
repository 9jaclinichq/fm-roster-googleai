import { supabase } from '../../../lib/databaseService';

export interface TenantAdminDashboard {
  membership_id: string;
  tenant_id: string;
  tenant_name: string;
  plan_type: string;
  terminology_overrides: Record<string, string>;
  module_flags: Record<string, unknown>;
  counts: {
    active_members: number;
    open_collections: number;
    active_admins: number;
  };
  members: Array<{
    id: string;
    full_name: string;
    category: string;
    active: boolean;
  }>;
  latest_configuration_audit_id: string | null;
}

export interface TenantSetupUpdate {
  tenantId: string;
  name: string;
  overrides: Record<string, string>;
  moduleFlagsPatch: Record<string, boolean>;
  reason: string;
  idempotencyKey: string;
}

function requireClient() {
  if (!supabase) throw new Error('The secure tenant-administration service is unavailable.');
  return supabase;
}

export const tenantAdminService = {
  async getDashboard(): Promise<TenantAdminDashboard> {
    const { data, error } = await requireClient().rpc('workspc_tenant_admin_get_dashboard');
    if (error) throw new Error(error.message);
    return data as TenantAdminDashboard;
  },

  async updateSetup(input: TenantSetupUpdate): Promise<{ audit_id: string; changed: boolean }> {
    const { data, error } = await requireClient().rpc('workspc_tenant_admin_update_setup', {
      p_expected_tenant_id: input.tenantId,
      p_name: input.name,
      p_overrides: input.overrides,
      p_module_flags_patch: input.moduleFlagsPatch,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    });
    if (error) throw new Error(error.message);
    return data as { audit_id: string; changed: boolean };
  },
};
