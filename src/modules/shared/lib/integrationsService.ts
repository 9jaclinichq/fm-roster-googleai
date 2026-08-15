// Integrations layer scaffold — read-only for this pass.
//
// Backs supabase/migrations/33_integrations_layer.sql's `integrations_catalog`
// (reference data: every known/planned tool integration, native or external)
// and `integrations_connections` (per-tenant or per-individual-doctor
// connection status). This is a SCAFFOLD ONLY: no connect/disconnect
// mutation flow exists yet — wiring up real OAuth/API integration for any of
// the external providers listed in the catalog is materially larger,
// per-provider work that needs its own scoping pass (see the migration's own
// header and CLAUDE.md's anti-scope-creep policy).
//
// Lives in modules/shared/lib/ rather than a specific module's lib/ because
// the catalog and connection status are cross-module concerns (both
// org-admin's dashboard and, eventually, the individual-doctor side will
// read from this) — same rationale as modules/shared/config/branding.ts.
//
// NOTE: this repo's `databaseService.ts` split (Phase 4 of the
// modularization effort, see docs/MODULARIZATION_ARCHITECTURE.md) hasn't
// happened yet, so there is no modules/shared/lib/supabaseClient.ts to
// import from — this file imports the existing `supabase` client and
// `checkSupabase()`-equivalent guard directly from the current god-file,
// matching how every other already-moved module's lib file does it today.

import { supabase } from '../../../lib/databaseService';

export interface IntegrationCatalogEntry {
  id: string;
  integration_key: string;
  name: string;
  category: string;
  kind: 'native' | 'external';
  auth_type: string;
  feeds_modules: string[];
  description: string | null;
  created_at: string;
}

export interface IntegrationConnection {
  id: string;
  integration_id: string;
  tenant_id: string | null;
  workforce_id: string | null;
  doctor_id: string | null;
  status: string;
  scope: 'tenant' | 'individual';
  external_ref: string | null;
  connected_at: string | null;
  created_at: string;
}

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

export const integrationsService = {
  // Full reference catalog of known/planned integrations, ordered for
  // stable grouped-by-category display.
  async listIntegrationsCatalog(): Promise<IntegrationCatalogEntry[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('integrations_catalog')
      .select('id, integration_key, name, category, kind, auth_type, feeds_modules, description, created_at')
      .order('category', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.warn('Error fetching integrations catalog:', error);
      throw error;
    }
    return (data || []) as unknown as IntegrationCatalogEntry[];
  },

  // Connection rows owned at the organization (tenant) level.
  async getConnectionsForTenant(tenantId: string): Promise<IntegrationConnection[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('integrations_connections')
      .select('id, integration_id, tenant_id, workforce_id, doctor_id, status, scope, external_ref, connected_at, created_at')
      .eq('scope', 'tenant')
      .eq('tenant_id', tenantId);

    if (error) {
      console.warn('Error fetching tenant integration connections:', error);
      throw error;
    }
    return (data || []) as unknown as IntegrationConnection[];
  },

  // Connection rows owned by an unaffiliated individual doctor
  // (doctor_profiles, migration 18) rather than a workforce-linked resident.
  async getConnectionsForDoctor(doctorId: string): Promise<IntegrationConnection[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('integrations_connections')
      .select('id, integration_id, tenant_id, workforce_id, doctor_id, status, scope, external_ref, connected_at, created_at')
      .eq('scope', 'individual')
      .eq('doctor_id', doctorId);

    if (error) {
      console.warn('Error fetching doctor integration connections:', error);
      throw error;
    }
    return (data || []) as unknown as IntegrationConnection[];
  },
};
