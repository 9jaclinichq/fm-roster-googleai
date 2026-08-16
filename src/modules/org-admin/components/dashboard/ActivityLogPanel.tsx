import React, { useEffect, useState } from 'react';
import { listRecentEvents, EventLogRow } from '../../../shared/lib/auditLogService';
import { History, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';

// Read-out panel for `event_log` (supabase/migrations/32_event_log.sql),
// via src/modules/shared/lib/auditLogService.ts. Closes the gap flagged in
// eventBus.ts's own header: real agent runs (submissionChaserAgent.ts,
// meetingActionAgent.ts) have been writing into event_log with nothing in
// the app ever reading it back out. This is a plain, tenant-scoped activity
// trail — no filtering, search, or pagination beyond a reverse-chronological
// row limit, matching the task's own "simple, not a full audit-log product"
// scope.
//
// Layout: a dense, table-like row list rather than the card-grid style
// IntegrationsPanel.tsx uses. An audit trail is read by scanning many rows
// quickly for a signal (event_type, who/what, when) — cards with padding
// and icons per entry would push 50 rows off-screen and work against that.
// Each row's raw jsonb payload is view-on-demand (collapsed by default)
// rather than rendered inline, since payload shapes vary per event_type and
// most are only interesting when something looks off.

interface ActivityLogPanelProps {
  tenantId: string;
}

function formatEventType(eventType: string): string {
  // Light-touch only, per task scope — no hardcoded label map, since
  // event_type is free text and the vocabulary grows over time (see
  // eventBus.ts's EventType union comment). Just makes long dotted/
  // underscored strings a little more scannable.
  return eventType.replace(/[._]/g, ' › ');
}

function formatWho(row: EventLogRow): string | null {
  if (row.agent_ref && row.source && row.agent_ref !== row.source) {
    return `${row.agent_ref} (${row.source})`;
  }
  return row.agent_ref || row.source || null;
}

export const ActivityLogPanel: React.FC<ActivityLogPanelProps> = ({ tenantId }) => {
  const [events, setEvents] = useState<EventLogRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const rows = await listRecentEvents(tenantId);
      setEvents(rows);
    } catch (err) {
      console.warn('Failed to load activity log:', err);
      setErrorMessage('Failed to load activity log.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, [tenantId]);

  const toggleExpanded = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <History className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold text-slate-800">Activity Log</h2>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={isLoading}
          className="flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        A record of what your organization's AI agents have done, and when.
      </p>

      {isLoading && <p className="text-sm text-slate-400">Loading activity...</p>}
      {errorMessage && <p className="text-sm text-red-600">{errorMessage}</p>}

      {!isLoading && !errorMessage && events.length === 0 && (
        <p className="text-sm text-slate-400">No activity recorded yet.</p>
      )}

      {!isLoading && !errorMessage && events.length > 0 && (
        <div className="border border-slate-200 rounded-md overflow-hidden divide-y divide-slate-100">
          {events.map((row) => {
            const who = formatWho(row);
            const isExpanded = expandedId === row.id;
            return (
              <div key={row.id} className="bg-white">
                <div className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono font-medium text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                        {formatEventType(row.event_type)}
                      </span>
                      {who && (
                        <span className="text-[11px] text-slate-400 truncate">{who}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[11px] text-slate-400 whitespace-nowrap">
                      {new Date(row.created_at).toLocaleString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleExpanded(row.id)}
                      className="flex items-center gap-0.5 text-[11px] font-medium text-slate-500 hover:text-slate-700 cursor-pointer"
                    >
                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                      Details
                    </button>
                  </div>
                </div>
                {isExpanded && (
                  <div className="px-3 pb-3">
                    <pre className="text-[11px] bg-slate-50 border border-slate-200 rounded-md p-2 overflow-x-auto whitespace-pre-wrap break-words text-slate-600">
                      {JSON.stringify(row.payload, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
