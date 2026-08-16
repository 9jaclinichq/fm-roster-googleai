import React, { useEffect, useMemo, useState } from 'react';
import { Search, Users, RefreshCw, AlertTriangle, CircleUserRound } from 'lucide-react';
import { databaseService } from '../../../lib/databaseService';
import { WorkforceMember } from '../../../types';

// Resident-facing, read-only "Team Directory" — one of 4 modules selected
// from a UI/UX reference study (a Flutter product concept called "Workspc")
// as genuinely missing capability: today only Chief-facing admin panels
// (WorkforceRegistryPanel.tsx) show the workforce list; nothing lets a
// resident browse who else is in their own org. INSTITUTIONAL-ONLY by
// design — an unaffiliated individual doctor has no "team" to browse (same
// precedent as AI Copilot being disabled for doctor-owned workspaces, since
// there's no institutional context for it), so this component takes a
// required tenantId and no doctor-owned variant is offered.
//
// Read-only: fetches via the existing databaseService.getWorkforce(tenantId)
// (no new service method, no schema change) and does simple client-side
// name-substring + category-chip filtering — this app has no full-text
// search infra, so a client-side filter over an already-small org roster is
// the right level of complexity here, not a shortcut.
//
// No messaging/chat affordance: the reference mockups show a chat icon per
// person, but this app has no chat/DM infrastructure anywhere. Omitted
// entirely rather than adding a dead button that does nothing when clicked.
//
// Visual language matches this app's existing light-card system (see
// UnifiedRecordView.tsx / IntelligenceHarnessHome.tsx / CategoryManagerPanel.tsx)
// deliberately NOT the dark theme of the Flutter reference mockups.

interface TeamDirectoryViewProps {
  tenantId: string;
  // The viewer's own workforce id, if known — used only to visually
  // distinguish "You" in the list, never to filter them out.
  currentMemberId?: string;
}

const ALL_CATEGORIES_FILTER = 'All';

export const TeamDirectoryView: React.FC<TeamDirectoryViewProps> = ({ tenantId, currentMemberId }) => {
  const [members, setMembers] = useState<WorkforceMember[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<string>(ALL_CATEGORIES_FILTER);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const data = await databaseService.getWorkforce(tenantId);
        if (!cancelled) setMembers(data);
      } catch (err) {
        console.warn('TeamDirectoryView: getWorkforce failed', err);
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load the team directory.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const activeMembers = useMemo(() => members.filter((m) => m.active), [members]);

  const categories = useMemo(() => {
    const distinct = new Set<string>();
    for (const m of activeMembers) {
      if (m.category) distinct.add(m.category);
    }
    return Array.from(distinct).sort((a, b) => a.localeCompare(b));
  }, [activeMembers]);

  const visibleMembers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return activeMembers
      .filter((m) => (activeCategory === ALL_CATEGORIES_FILTER ? true : m.category === activeCategory))
      .filter((m) => (query ? m.full_name.toLowerCase().includes(query) : true))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));
  }, [activeMembers, search, activeCategory]);

  if (isLoading) {
    return (
      <div className="text-center py-16">
        <RefreshCw size={28} className="text-slate-400 animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-500">Loading team directory...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto my-8 px-4">
        <div className="bg-rose-50 border border-rose-200 text-rose-800 p-3 rounded-xl text-xs flex items-center space-x-2">
          <AlertTriangle size={14} className="shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto my-6 px-4 space-y-5">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center space-x-2">
          <Users className="text-slate-500" size={18} />
          <h1 className="font-bold text-slate-900 text-lg tracking-tight">Team Directory</h1>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Browse the active members of your organization ({activeMembers.length} total).
        </p>
      </div>

      {/* Search + category filter chips */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm space-y-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name..."
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
          />
        </div>

        {categories.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setActiveCategory(ALL_CATEGORIES_FILTER)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition cursor-pointer ${
                activeCategory === ALL_CATEGORIES_FILTER
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
              }`}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                onClick={() => setActiveCategory(category)}
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border transition cursor-pointer ${
                  activeCategory === category
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {category}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Member list */}
      {visibleMembers.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm text-center">
          <p className="text-sm text-slate-500">No active team members found.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm divide-y divide-slate-100">
          {visibleMembers.map((member) => {
            const isYou = !!currentMemberId && member.id === currentMemberId;
            return (
              <div key={member.id} className="p-4 flex items-center gap-3">
                <CircleUserRound size={28} className="text-slate-300 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 text-sm truncate">{member.full_name}</span>
                    {isYou && (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-100">
                        You
                      </span>
                    )}
                    {member.on_floor && (
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-800 border border-emerald-200">
                        On Floor
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{member.category}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
