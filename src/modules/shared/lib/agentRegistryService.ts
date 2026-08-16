import { supabase } from '../../../lib/databaseService';

// Read-only data access for the agent/AI-capability registry
// (supabase/migrations/34_agent_manifests.sql, with a second-wave seed added
// in supabase/migrations/50_second_wave_agents.sql). This is the "living
// intelligence" spec's (docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §4, the
// intelligence ladder / agent rungs) registry of every AI-assisted action and
// autonomous agent this app exposes — today nothing in the app UI reads this
// table, which is the real transparency gap this file exists to close.
//
// `agent_manifests` is NOT tenant-scoped — it's a platform-wide capability
// catalog (what this app CAN do), not tenant data (what a given org has
// configured) — so no tenantId param here, unlike most other shared/lib
// services in this directory.
//
// Lives in modules/shared/lib/ rather than a specific module's lib/ because
// the registry is a cross-cutting concern (org-admin today, potentially the
// individual-doctor side or a platform-operator view later) — same rationale
// as integrationsService.ts.

export interface AgentManifest {
  id: string;
  agent_key: string;
  name: string;
  owner_engine: 'privybrain-2' | 'babsbrain-2' | 'none';
  rung: number;
  description: string | null;
  gates: string | null;
  tenant_scope: 'platform' | 'org' | 'individual' | 'any';
  created_at: string;
}

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

// Lists every registered agent/AI-assisted action, highest rung (most
// autonomous) first, then alphabetically by name — the most interesting
// signal for a Chief skimming this list is "what's actually reasoning over
// my org's data" rather than the more numerous simple-assist actions.
export async function listAgentManifests(): Promise<AgentManifest[]> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('agent_manifests')
    .select('id, agent_key, name, owner_engine, rung, description, gates, tenant_scope, created_at')
    .order('rung', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    console.warn('Error fetching agent manifests:', error);
    throw error;
  }
  return (data || []) as unknown as AgentManifest[];
}
