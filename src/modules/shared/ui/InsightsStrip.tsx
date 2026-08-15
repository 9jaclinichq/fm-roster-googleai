import React, { useEffect, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { supabase } from '../../../lib/databaseService';
import { runSubmissionChaser, getActiveInsights, dismissInsight, InsightRow } from '../lib/submissionChaserAgent';

interface InsightsStripProps {
  tenantId: string;
}

// L4/L5 face for the L1 Submission Chaser agent (see
// src/modules/shared/lib/submissionChaserAgent.ts). Per
// docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7's Dashboard module row
// ("insight strips, module tiles, tenant switcher"), this is meant to sit
// near the top of the org-admin dashboard, above the tab switcher.
//
// Wired into ChiefDashboardView.tsx, between the KPI cards and the tab
// switcher.
//
// FAILS GRACEFULLY: both the agent run and the read are best-effort. If
// `insights`/`agent_manifests`/`event_log` don't exist yet (migration 37 not
// applied) or the Supabase client isn't configured, this renders nothing —
// no error boundary needed, no loading spinner, no visible failure state.
// An admin should never see a broken widget for a feature they don't know
// exists yet.
export const InsightsStrip: React.FC<InsightsStripProps> = ({ tenantId }) => {
  const [insights, setInsights] = useState<InsightRow[]>([]);
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!supabase || !tenantId) return;
    let cancelled = false;

    const load = async () => {
      // Fire-and-forget: run the agent, but don't block the read on it —
      // if the agent run fails (e.g. table missing, no open collection),
      // still attempt to show whatever insights already exist.
      try {
        await runSubmissionChaser(supabase!, tenantId);
      } catch (err) {
        console.warn('InsightsStrip: runSubmissionChaser failed (non-fatal)', err);
      }

      try {
        const active = await getActiveInsights(supabase!, tenantId);
        if (!cancelled) setInsights(active);
      } catch (err) {
        // Expected in any environment where migration 37 hasn't been
        // applied yet — fail silently, render nothing.
        console.warn('InsightsStrip: getActiveInsights failed (non-fatal)', err);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const handleDismiss = async (id: string) => {
    if (!supabase) return;
    setDismissingIds((prev) => new Set(prev).add(id));
    try {
      await dismissInsight(supabase, id);
      setInsights((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.warn('InsightsStrip: dismissInsight failed', err);
      setDismissingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // Empty state: render nothing — no clutter on a dashboard with no
  // outstanding insights (spec requirement, matches every other empty-state
  // convention in this app that only shows a message inside a populated tab,
  // not as a persistent top-of-page banner).
  if (insights.length === 0) return null;

  return (
    <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
      {insights.map((insight) => (
        <div
          key={insight.id}
          className="flex-shrink-0 w-72 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-start gap-3"
        >
          <div className="mt-0.5 flex-shrink-0 h-8 w-8 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center">
            <Sparkles size={16} className="text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-slate-800 leading-snug">{insight.text}</p>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-400">
                Submission Chaser
              </span>
              <button
                onClick={() => handleDismiss(insight.id)}
                disabled={dismissingIds.has(insight.id)}
                className="flex items-center gap-1 px-2 py-1 rounded border border-slate-200 text-slate-500 hover:text-slate-950 hover:bg-slate-50 text-[10px] font-semibold transition disabled:opacity-50"
                title="Dismiss"
              >
                <X size={10} />
                Dismiss
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
