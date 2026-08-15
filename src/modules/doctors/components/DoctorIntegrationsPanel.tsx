import React, { useEffect, useState } from 'react';
import { integrationsService, IntegrationCatalogEntry, IntegrationConnection } from '../../shared/lib/integrationsService';
import { Plug, CheckCircle2, CircleDashed } from 'lucide-react';

// Read-only stub for the integrations layer scaffold
// (supabase/migrations/33_integrations_layer.sql), individual-doctor side.
// Sibling to org-admin's IntegrationsPanel.tsx
// (src/modules/org-admin/components/dashboard/IntegrationsPanel.tsx) — same
// visual pattern (catalog grouped by category, connected/not-connected
// badges, disabled "Connect" button, "Coming soon" for unbuilt providers) —
// flagged there as a follow-up ("a similar stub for the individual-doctor
// side is a flagged follow-up, not built") and built here.
//
// Unlike IntegrationsPanel (which infers "connected" purely from
// auth_type === 'platform_managed' and doesn't yet call
// getConnectionsForTenant), this panel does fetch the doctor's real
// `integrations_connections` rows via getConnectionsForDoctor(doctorId) and
// treats a row with status 'connected' as connected too — there is still no
// connect/disconnect mutation flow (that's per-provider OAuth/API work, out
// of scope here), so in practice every individual-scope row will read as
// not-connected until a future pass seeds/writes real connection rows.

const CATEGORY_LABELS: Record<string, string> = {
  analysis: 'Analysis',
  research: 'Research',
  citation: 'Citation',
  writing: 'Writing',
  scheduling: 'Scheduling',
  documents: 'Documents',
  billing: 'Billing',
};

function isConnected(entry: IntegrationCatalogEntry, connections: IntegrationConnection[]): boolean {
  // Platform-managed integrations (currently only the Flutterwave payment
  // processor) are configured once at the platform level, not per-doctor —
  // so they always read as connected, same rule IntegrationsPanel uses.
  if (entry.auth_type === 'platform_managed') return true;
  return connections.some(c => c.integration_id === entry.id && c.status === 'connected');
}

interface DoctorIntegrationsPanelProps {
  doctorId: string;
}

export const DoctorIntegrationsPanel: React.FC<DoctorIntegrationsPanelProps> = ({ doctorId }) => {
  const [isLoading, setIsLoading] = useState(true);
  const [catalog, setCatalog] = useState<IntegrationCatalogEntry[]>([]);
  const [connections, setConnections] = useState<IntegrationConnection[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      try {
        const [rows, conns] = await Promise.all([
          integrationsService.listIntegrationsCatalog(),
          integrationsService.getConnectionsForDoctor(doctorId),
        ]);
        if (!cancelled) {
          setCatalog(rows);
          setConnections(conns);
        }
      } catch (err) {
        console.warn('Failed to load doctor integrations:', err);
        if (!cancelled) setErrorMessage('Failed to load integrations catalog.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [doctorId]);

  const grouped = catalog.reduce<Record<string, IntegrationCatalogEntry[]>>((acc, entry) => {
    (acc[entry.category] ||= []).push(entry);
    return acc;
  }, {});
  const categories = Object.keys(grouped).sort();

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
      <div className="flex items-center gap-2 mb-1">
        <Plug className="w-5 h-5 text-indigo-600" />
        <h2 className="text-lg font-semibold text-slate-800">Integrations</h2>
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Native and external tool integrations available to your personal workspace. This is an early,
        read-only scaffold — real connect/disconnect flows for the external providers below have not
        been built yet.
      </p>

      {isLoading && <p className="text-sm text-slate-400">Loading integrations…</p>}
      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

      {!isLoading && !errorMessage && categories.length === 0 && (
        <p className="text-sm text-slate-400">No integrations found in the catalog.</p>
      )}

      {!isLoading && !errorMessage && categories.map((category) => (
        <div key={category} className="mb-6 last:mb-0">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
            {CATEGORY_LABELS[category] ?? category}
          </h3>
          <div className="divide-y divide-slate-100 border border-slate-200 rounded-md overflow-hidden">
            {grouped[category].map((entry) => {
              const connected = isConnected(entry, connections);
              return (
                <div key={entry.id} className="flex items-center justify-between gap-4 px-4 py-3 bg-white">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800 truncate">{entry.name}</span>
                      <span className="text-[11px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
                        {entry.kind}
                      </span>
                    </div>
                    {entry.description && (
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-2">{entry.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {connected ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                        <CircleDashed className="w-3.5 h-3.5" /> Not connected
                      </span>
                    )}
                    {!connected && (
                      <span className="text-[11px] text-slate-400 italic">Coming soon</span>
                    )}
                    <button
                      type="button"
                      disabled
                      className="text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
                      title="Connecting is not available yet"
                    >
                      Connect
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
