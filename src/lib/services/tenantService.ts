// Tenant-domain service (Modularization Phase 4A) — extracted verbatim from
// src/lib/databaseService.ts's SaaS Multi-Tenancy section. Contains tenant
// discovery, tenant configuration read/write compatibility methods,
// operator/Chief tenant RPC wrappers this service itself still depends on,
// tenant provisioning, and tenant analytics. Spread into the databaseService
// object facade (see databaseService.ts) so every existing
// `databaseService.X(...)` call site keeps working unchanged — this file is
// not imported directly by any application call site in this slice.
//
// createTenantWithAdmin(), platformOperatorCreateTenant(),
// platformOperatorUpdateTenantPlan()/Status(), call-duty-rules, and every
// other SaaS Multi-Tenancy method deliberately remain in databaseService.ts —
// only the exact function set approved for this extraction moved here.
import { databaseService, checkSupabase, supabase } from '../databaseService';
import { Tenant, PublicTenant, ChiefTenantConfig, TenantPlanType, TenantStatus } from '../../types';
import { RosterSectionKey, RosterSectionPresentation } from '../../modules/roster-engine/lib/rosterSectionPresentation';

export const tenantService = {
  // Unsafe — depends on tenants' permissive direct-read RLS (migration
  // 11); no caller-identity check happens here at all. Superseded by
  // platformOperatorListTenants() below (migration 61, Priority-0 Tenant
  // Surface slice P0-5) — that was this method's only remaining caller.
  // Left in place, unused, until the final tenant-table lockdown audit
  // (P0-7) confirms no caller remains.
  async getTenants(): Promise<Tenant[]> {
    checkSupabase();

    const { data, error } = await supabase!.from('tenants').select('*').order('created_at', { ascending: true });
    if (error) {
      console.warn('Error fetching tenants:', error);
      throw error;
    }
    return data || [];
  },

  // Public, pre-login tenant discovery (migration 58, Priority-0 Tenant
  // Surface slice P0-1) — the locked public projection via
  // `list_public_tenants()`, which server-side filters to active/
  // discoverable tenants and returns only id/name/institution/department.
  // P0-2 migrated both real consumers (TenantSelectorView.tsx,
  // ResidentLoginView.tsx) onto this method.
  async listPublicTenants(): Promise<PublicTenant[]> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('list_public_tenants');
    if (error) {
      console.warn('Error fetching public tenants:', error);
      throw error;
    }
    return data || [];
  },

  // Unsafe for a privileged caller (Chief) — depends on tenants'
  // permissive direct-read RLS. chiefGetTenant() below (migration 61,
  // slice P0-5) supersedes this for TenantCustomizationView.tsx/
  // TemplateManagerView.tsx. Still genuinely in use by
  // CasebookBuilderView.tsx and terminology.tsx's resident/pre-login
  // paths — those callers have no reusable server-verifiable credential
  // today, so they remain on this method pending institutional Auth
  // (explicitly deferred from P0-5 — see docs/TENANT_SURFACE_SECURITY_SPEC.md).
  // Do not remove until every caller is migrated.
  //
  // TENANT CLIENT-SURFACE MINIMIZATION / DEFENSE-IN-DEPTH (not the final
  // confidentiality boundary): projection narrowed from select('*') to
  // exactly what those two callers read (terminology_overrides,
  // module_flags), mirroring the WORKFORCE_PUBLIC_COLUMNS/ChiefTenantConfig
  // narrow-projection convention already used elsewhere in this file. This
  // stops the helper itself from requesting or re-exposing sensitive
  // columns (paystack_subaccount_code, plan_type, status, short_code) and
  // prevents silent re-expansion through this specific call site. It does
  // NOT close database-level exposure: tenants_select RLS remains `USING
  // (true)` (migration 11, deliberately untouched by migration 63 pending
  // institutional Auth), and `tenants` has never had its default
  // table-level GRANT narrowed to a column allow-list the way migration 02
  // did for workforce/settings — so any anon-key caller querying `tenants`
  // directly, outside this helper, can still independently select
  // paystack_subaccount_code/plan_type/status/short_code today. That
  // remaining gap stays deferred debt pending the institutional-Auth-
  // dependent tenant-read-authorization slice (see
  // docs/TENANT_SURFACE_SECURITY_SPEC.md, docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md).
  async getTenant(tenantId: string): Promise<Pick<Tenant, 'id' | 'terminology_overrides' | 'module_flags'> | null> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenants')
      .select('id, terminology_overrides, module_flags')
      .eq('id', tenantId)
      .maybeSingle();
    if (error) {
      console.warn('Error fetching tenant:', error);
      throw error;
    }
    return data;
  },

  // Chief-scoped, capability-checked tenant config read (migration 61,
  // Priority-0 Tenant Surface slice P0-5). p_admin_code is re-verified
  // server-side inside the RPC, which derives the caller's own tenant from
  // it — no tenant id is ever accepted or trusted from the client. Narrow
  // return shape (see ChiefTenantConfig) — only the fields
  // TenantCustomizationView.tsx/TemplateManagerView.tsx actually read, not
  // the full tenant row.
  async chiefGetTenant(adminCode: string): Promise<ChiefTenantConfig | null> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_get_tenant', { p_admin_code: adminCode });
    if (error) {
      console.warn('Error fetching tenant config:', error);
      throw error;
    }
    return data?.[0] ?? null;
  },

  // Creates a Paystack subaccount via the platform-operator-subaccount Edge
  // Function (renamed from paystack-subaccount 2026-08-15, see
  // docs/MODULARIZATION_ARCHITECTURE.md), then creates the tenant row with
  // the returned subaccount_code via platformOperatorCreateTenant() below
  // — a single capability-checked RPC call, not a direct insert (migration
  // 62, Priority-0 Tenant Surface slice P0-7A: this used to be the one
  // remaining tenant write with no operator-code verification at all,
  // inert only because the Edge Function call above fails closed under
  // Emergency Slice E0 containment). If the Paystack call fails, no tenant
  // row is created — surfaced to the caller as a thrown error so the
  // operator console can show it plainly rather than leaving a tenant with
  // no billing configured.
  //
  // TRANSITIONAL, E0-ERA DESIGN — see migration 62's own header: the
  // subaccount_code passed to platformOperatorCreateTenant() below is
  // whatever fnData.subaccount_code contains, trusted as-is with no
  // independent verification that Paystack actually issued it. This call
  // only adds verification of the operator's own authority, not of the
  // subaccount code's authenticity. Any future work reassessing/lifting E0
  // containment must also reassess server-side binding/verification of
  // this payment-provider metadata — not redesigned here.
  //
  // platformOperatorCreateTenant() itself remains in databaseService.ts
  // (not part of this extraction's approved function set) — called here via
  // the databaseService facade import above, same as this method's own
  // pre-extraction body did.
  async provisionTenantWithSubaccount(operatorCode: string, tenant: {
    name: string;
    short_code: string;
    institution?: string | null;
    department?: string | null;
    plan_type?: TenantPlanType;
    business_name: string;
    settlement_bank: string;
    account_number: string;
    percentage_charge: number;
  }): Promise<Tenant> {
    checkSupabase();

    const { data: fnData, error: fnError } = await supabase!.functions.invoke('platform-operator-subaccount', {
      body: {
        business_name: tenant.business_name,
        settlement_bank: tenant.settlement_bank,
        account_number: tenant.account_number,
        percentage_charge: tenant.percentage_charge,
      },
    });

    if (fnError || !fnData?.subaccount_code) {
      // E0 TRANSITIONAL (2026-08-20) — platform-operator-subaccount is under
      // emergency containment (see docs/EMERGENCY_SLICE_E0_FINANCIAL_CONTAINMENT.md)
      // and fails closed on every call while active. Deliberately not
      // parsing fnData?.error/fnError?.message here: DISCOVER established
      // the exact supabase-js non-2xx response shape is unverified, so any
      // failure of this specific call is mapped to a fixed neutral message
      // rather than risking a leaked/garbled internal string. Revert to
      // surfacing the real provider/internal error once containment lifts.
      console.warn('Error creating Paystack subaccount:', fnError || fnData);
      throw new Error('Payment setup is temporarily unavailable.');
    }

    return databaseService.platformOperatorCreateTenant(operatorCode, {
      name: tenant.name,
      short_code: tenant.short_code,
      institution: tenant.institution || null,
      department: tenant.department || null,
      plan_type: tenant.plan_type || 'free_seeded',
      paystack_subaccount_code: fnData.subaccount_code,
    });
  },

  // Unsafe — depends on tenants' permissive direct-write RLS (migration
  // 11); no caller-identity check happens here at all. Provisions a tenant
  // WITHOUT a Paystack subaccount (free tier or billing configured later).
  // Superseded by platformOperatorCreateTenant() below (migration 60,
  // Priority-0 Tenant Surface slice P0-4). Left in place, unused, until the
  // final tenant-table lockdown audit (P0-7) confirms no caller remains.
  async createTenant(tenant: {
    name: string;
    short_code: string;
    institution?: string | null;
    department?: string | null;
    plan_type?: TenantPlanType;
  }): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenants')
      .insert([{ plan_type: 'free_seeded', ...tenant }])
      .select()
      .single();

    if (error) {
      console.warn('Error creating tenant:', error);
      throw error;
    }
    return data;
  },

  // Unsafe — same gap as createTenant() above. Superseded by
  // platformOperatorUpdateTenantPlan() below (migration 60, slice P0-4).
  // Left in place, unused, until P0-7 confirms no caller remains.
  async updateTenantPlan(tenantId: string, planType: TenantPlanType): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenants')
      .update({ plan_type: planType })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      console.warn('Error updating tenant plan:', error);
      throw error;
    }
    return data;
  },

  // Unsafe — same gap as createTenant() above. Superseded by
  // platformOperatorUpdateTenantStatus() below (migration 60, slice P0-4).
  // Left in place, unused, until P0-7 confirms no caller remains.
  async updateTenantStatus(tenantId: string, status: 'active' | 'suspended'): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenants')
      .update({ status })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      console.warn('Error updating tenant status:', error);
      throw error;
    }
    return data;
  },

  // Unsafe — depends on tenants' permissive direct-write RLS (migration
  // 11); no caller-identity check happens here at all. Superseded by
  // chiefUpdateTenantTerminology() below (migration 59, Priority-0 Tenant
  // Surface slice P0-3). Left in place, unused, until the final tenant-
  // table lockdown audit (P0-7) confirms no caller remains — do not delete
  // before then.
  async updateTenantTerminology(tenantId: string, overrides: Record<string, string>): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenants')
      .update({ terminology_overrides: overrides })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      console.warn('Error updating tenant terminology:', error);
      throw error;
    }
    return data;
  },

  // Unsafe — same gap as updateTenantTerminology() above. Superseded by
  // chiefUpdateTenantModuleFlags() below (migration 59, slice P0-3). Left
  // in place, unused, until P0-7 confirms no caller remains.
  async updateTenantModuleFlags(tenantId: string, flags: Record<string, unknown>): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenants')
      .update({ module_flags: flags })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      console.warn('Error updating tenant module flags:', error);
      throw error;
    }
    return data;
  },

  // Chief-scoped, capability-checked replacements for the two direct
  // writes above (migration 59, Priority-0 Tenant Surface slice P0-3).
  // p_admin_code is re-verified server-side inside the RPC, which derives
  // the caller's own tenant from it — no tenant id is ever accepted or
  // trusted from the client. p_admin_code is explicitly transitional
  // compatibility (same plaintext-code pattern every chief_* RPC already
  // uses), not the target API contract — see
  // docs/INSTITUTIONAL_AUTH_MIGRATION_SPEC.md §11.
  async chiefUpdateTenantTerminology(adminCode: string, overrides: Record<string, string>): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_update_tenant_terminology', {
      p_admin_code: adminCode,
      p_overrides: overrides,
    });

    if (error) {
      console.warn('Error updating tenant terminology:', error);
      throw error;
    }
    return data;
  },

  async chiefUpdateTenantModuleFlags(adminCode: string, flags: Record<string, unknown>): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_update_tenant_module_flags', {
      p_admin_code: adminCode,
      p_flags: flags,
    });

    if (error) {
      console.warn('Error updating tenant module flags:', error);
      throw error;
    }
    return data;
  },

  // Chief-scoped roster section presentation config (migration 74). Same
  // admin-code-verification pattern as chiefUpdateTenantTerminology above
  // — the RPC derives tenant only from the verified admin code, so a
  // Chief can never read/write another tenant's configuration. Returns
  // the already-fallback-resolved 4 sections (same shape the resident
  // RPC returns) so the config UI can render "what residents currently
  // see" and edit from there.
  async chiefGetRosterSectionConfig(adminCode: string): Promise<RosterSectionPresentation[]> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_get_roster_section_config', {
      p_admin_code: adminCode,
    });

    if (error) {
      console.warn('Error fetching roster section config:', error);
      throw error;
    }
    return Array.isArray(data) ? data : [];
  },

  async chiefUpsertRosterSectionConfig(
    adminCode: string,
    sectionKey: RosterSectionKey,
    updates: { display_label?: string | null; short_label?: string | null; display_order?: number | null; accent_color?: string | null; icon?: string | null }
  ): Promise<RosterSectionPresentation> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_upsert_roster_section_config', {
      p_admin_code: adminCode,
      p_section_key: sectionKey,
      p_display_label: updates.display_label ?? null,
      p_short_label: updates.short_label ?? null,
      p_display_order: updates.display_order ?? null,
      p_accent_color: updates.accent_color ?? null,
      p_icon: updates.icon ?? null,
    });

    if (error) {
      console.warn('Error saving roster section config:', error);
      throw error;
    }
    return data;
  },

  // Unsafe — coarse, unfiltered counts for the SaaS operator console's
  // platform analytics panel, but the `tenants` count depends on
  // permissive direct-read RLS with no caller-identity check. Superseded
  // by platformOperatorGetAnalyticsSummary() below (migration 61, slice
  // P0-5) — that was this method's only caller. Left in place, unused,
  // until P0-7 confirms no caller remains.
  async getPlatformAnalyticsSummary(): Promise<{
    totalTenants: number;
    totalMembers: number;
    activeMasterRosters: number;
    aiActionCount: number;
  }> {
    checkSupabase();

    const [tenants, members, rosters, aiActions] = await Promise.all([
      supabase!.from('tenants').select('id', { count: 'exact', head: true }),
      supabase!.from('workforce').select('id', { count: 'exact', head: true }),
      supabase!.from('combined_master_rosters').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      supabase!.from('ai_action_logs').select('id', { count: 'exact', head: true }),
    ]);

    return {
      totalTenants: tenants.count || 0,
      totalMembers: members.count || 0,
      activeMasterRosters: rosters.count || 0,
      aiActionCount: aiActions.count || 0,
    };
  },

  // Unsafe — same gap as getPlatformAnalyticsSummary() above (the
  // `tenants` read specifically). Superseded by
  // platformOperatorGetTenantUsageBreakdown() below (migration 61, slice
  // P0-5) — that was this method's only caller. Left in place, unused,
  // until P0-7 confirms no caller remains.
  async getTenantUsageBreakdown(): Promise<{
    tenantId: string;
    name: string;
    planType: TenantPlanType;
    status: TenantStatus;
    memberCount: number;
    aiActionsThisWindow: number;
    submissionCount: number;
  }[]> {
    checkSupabase();

    const [tenants, usage, members, submissions] = await Promise.all([
      supabase!.from('tenants').select('id, name, plan_type, status'),
      supabase!.from('tenant_ai_usage').select('tenant_id, action_count'),
      supabase!.from('workforce').select('id, tenant_id').eq('active', true),
      // submissions has no tenant_id of its own (see getSubmissions' comment
      // above) — go through the same workforce join to attribute each
      // submission to a tenant.
      supabase!.from('submissions').select('id, workforce!inner(tenant_id)'),
    ]);

    if (tenants.error) { console.warn('Error fetching tenants:', tenants.error); throw tenants.error; }

    const usageByTenant = new Map<string, number>();
    for (const row of usage.data || []) usageByTenant.set(row.tenant_id, row.action_count);

    const membersByTenant = new Map<string, number>();
    for (const row of members.data || []) membersByTenant.set(row.tenant_id, (membersByTenant.get(row.tenant_id) || 0) + 1);

    const submissionsByTenant = new Map<string, number>();
    for (const row of (submissions.data || []) as unknown as { workforce: { tenant_id: string } }[]) {
      const tid = row.workforce?.tenant_id;
      if (tid) submissionsByTenant.set(tid, (submissionsByTenant.get(tid) || 0) + 1);
    }

    return (tenants.data || []).map(t => ({
      tenantId: t.id,
      name: t.name,
      planType: t.plan_type,
      status: t.status,
      memberCount: membersByTenant.get(t.id) || 0,
      aiActionsThisWindow: usageByTenant.get(t.id) || 0,
      submissionCount: submissionsByTenant.get(t.id) || 0,
    }));
  },
};
