import React, { useEffect, useState } from 'react';
import { listAgentManifests, AgentManifest } from '../../../shared/lib/agentRegistryService';
import { Bot, AlertTriangle, RefreshCw } from 'lucide-react';

// Read-only listing panel for the agent/AI-capability registry
// (supabase/migrations/34_agent_manifests.sql + 50_second_wave_agents.sql).
// Closes a real transparency gap: this table has 12 live rows describing
// every AI-assisted action and autonomous agent in the app, at what
// "rung" of autonomy (per docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §4), and
// what gates its behavior — but nothing in the app UI has ever surfaced it
// to a Chief. Pure read-only listing, same structural precedent as
// IntegrationsPanel.tsx (catalog + status, no CRUD) rather than
// CategoryManagerPanel.tsx's create-form half.
//
// Not wired into ChiefDashboardView.tsx yet — the parent session adds the
// tab per this task's own scope boundary (standalone new files only).

const RUNG_BADGE_STYLES: Record<number, string> = {
  0: 'bg-slate-50 text-slate-600 border-slate-200',
  1: 'bg-amber-50 text-amber-700 border-amber-200',
};
const RUNG_BADGE_FALLBACK = 'bg-blue-50 text-blue-700 border-blue-200';

const RUNG_LABELS: Record<number, string> = {
  0: 'Rung 0 · Assist',
  1: 'Rung 1 · Reasoning',
};

function rungBadgeClass(rung: number): string {
  return RUNG_BADGE_STYLES[rung] ?? RUNG_BADGE_FALLBACK;
}

function rungLabel(rung: number): string {
  return RUNG_LABELS[rung] ?? `Rung ${rung}`;
}

export const AgentRegistryPanel: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [manifests, setManifests] = useState<AgentManifest[]>([]);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setErrorMessage('');
      try {
        const rows = await listAgentManifests();
        if (!cancelled) setManifests(rows);
      } catch (err) {
        console.warn('Failed to load agent manifests:', err);
        if (!cancelled) setErrorMessage('Could not load the agent registry. Please try again.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Reasoning agents (rung >= 1) reason over a broader body of work and
  // raise suggestions on their own initiative; AI-assisted actions (rung 0)
  // are simple per-request assist/format/extraction calls a resident/Chief
  // triggers directly. Splitting the list this way surfaces the more
  // consequential "what's acting on my org's data" agents first.
  const reasoningAgents = manifests.filter(m => m.rung >= 1);
  const assistActions = manifests.filter(m => m.rung === 0);

  const renderCard = (manifest: AgentManifest) => (
    <div key={manifest.id} className="p-4 rounded-xl border border-slate-200 bg-white space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-bold text-slate-900 text-sm truncate">{manifest.name}</h4>
          <div className="text-[10px] font-mono text-slate-400 truncate mt-0.5">{manifest.agent_key}</div>
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border ${rungBadgeClass(manifest.rung)}`}>
          {rungLabel(manifest.rung)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
          {manifest.owner_engine}
        </span>
        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
          {manifest.tenant_scope}-scoped
        </span>
      </div>

      {manifest.description && (
        <p className="text-xs text-slate-600 leading-relaxed">{manifest.description}</p>
      )}

      {manifest.gates && (
        <p className="text-[10px] text-slate-400 leading-relaxed border-t border-slate-100 pt-2 mt-2">
          <span className="font-semibold text-slate-500">Gates: </span>
          {manifest.gates}
        </p>
      )}
    </div>
  );

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 space-y-5">
      <div className="pb-3 border-b border-slate-100 flex items-start space-x-2">
        <Bot className="text-slate-500 mt-0.5" size={18} />
        <div>
          <h3 className="font-bold text-slate-800 text-sm md:text-base">AI Agent Registry</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Every AI-assisted action and autonomous agent registered in this workspace, and how much
            autonomy each one has.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs flex items-center space-x-1">
          <AlertTriangle size={12} />
          <span>{errorMessage}</span>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-8 text-slate-400 text-sm flex items-center justify-center gap-2">
          <RefreshCw size={14} className="animate-spin" />
          <span>Loading agent registry...</span>
        </div>
      ) : !errorMessage && manifests.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">No registered agents found.</div>
      ) : !errorMessage && (
        <div className="space-y-6">
          {reasoningAgents.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Reasoning Agents ({reasoningAgents.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {reasoningAgents.map(renderCard)}
              </div>
            </div>
          )}

          {assistActions.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                AI-Assisted Actions ({assistActions.length})
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {assistActions.map(renderCard)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
