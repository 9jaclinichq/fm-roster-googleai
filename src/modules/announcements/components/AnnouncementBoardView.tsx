import React, { useState, useEffect, useMemo } from 'react';
import { databaseService } from '../../../lib/databaseService';
import { Announcement, AnnouncementCategory } from '../../../types';
import { Pin, Search, Megaphone, RefreshCw, CheckCircle2, ChevronDown, ChevronUp, Table2 } from 'lucide-react';

interface AnnouncementBoardViewProps {
  resident: { id: string; name: string; category: string };
  // Optional — deep-links a roster-published announcement to the Full
  // Roster view. Uses the announcement's EXISTING `category` field
  // ('Roster') to decide when to show the action, so this needed no
  // schema change (no action_route/deep-link column exists on
  // `announcements` yet — that remains deferred, see this slice's report).
  // Always navigates to the CURRENT published roster, not a snapshot of
  // whichever roster was current when this specific announcement was
  // posted — Full Roster has no versioning concept yet either.
  onViewFullRoster?: () => void;
}

const CATEGORIES: AnnouncementCategory[] = ['Roster', 'Exam', 'CME', 'Admin'];

const CATEGORY_STYLES: Record<AnnouncementCategory, string> = {
  Roster: 'bg-blue-50 text-blue-700 border-blue-200',
  Exam: 'bg-rose-50 text-rose-700 border-rose-200',
  CME: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Admin: 'bg-slate-100 text-slate-700 border-slate-200',
};

export const AnnouncementBoardView: React.FC<AnnouncementBoardViewProps> = ({ resident, onViewFullRoster }) => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [categoryFilter, setCategoryFilter] = useState<AnnouncementCategory | 'All'>('All');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      try {
        const [list, reads] = await Promise.all([
          databaseService.getAnnouncements(),
          databaseService.getAnnouncementReadsForWorkforce(resident.id),
        ]);
        setAnnouncements(list);
        setReadIds(new Set(reads.map(r => r.announcement_id)));
      } catch (err) {
        console.warn('Failed to load announcements:', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [resident.id]);

  const handleExpand = async (announcement: Announcement) => {
    const isOpening = expandedId !== announcement.id;
    setExpandedId(isOpening ? announcement.id : null);

    if (isOpening && !readIds.has(announcement.id)) {
      setReadIds(prev => new Set(prev).add(announcement.id));
      try {
        await databaseService.markAnnouncementRead(announcement.id, resident.id);
      } catch (err) {
        console.warn('Failed to record read receipt:', err);
      }
    }
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return announcements.filter(a => {
      const matchesCategory = categoryFilter === 'All' || a.category === categoryFilter;
      const matchesSearch = !q || a.title.toLowerCase().includes(q) || a.body.toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [announcements, categoryFilter, searchQuery]);

  const pinned = filtered.filter(a => a.pinned);
  const regular = filtered.filter(a => !a.pinned);

  const renderCard = (announcement: Announcement) => {
    const isExpanded = expandedId === announcement.id;
    const isRead = readIds.has(announcement.id);

    return (
      <div
        key={announcement.id}
        className={`bg-white border rounded-2xl shadow-sm overflow-hidden transition ${
          announcement.pinned ? 'border-amber-300' : 'border-slate-200'
        }`}
      >
        <button
          type="button"
          onClick={() => handleExpand(announcement)}
          className="w-full text-left p-4 sm:p-5 flex items-start justify-between gap-3 cursor-pointer"
        >
          <div className="min-w-0">
            <div className="flex items-center flex-wrap gap-2 mb-1.5">
              {announcement.pinned && (
                <span className="inline-flex items-center space-x-1 text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  <Pin size={10} />
                  <span>Pinned</span>
                </span>
              )}
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${CATEGORY_STYLES[announcement.category]}`}>
                #{announcement.category}
              </span>
              {!isRead && (
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" title="Unread" />
              )}
            </div>
            <h3 className="font-bold text-slate-900 text-sm sm:text-base truncate">{announcement.title}</h3>
            {!isExpanded && (
              <p className="text-xs sm:text-sm text-slate-500 mt-1 line-clamp-2">{announcement.body}</p>
            )}
            <p className="text-[10px] text-slate-400 mt-1.5 font-medium">
              {new Date(announcement.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          <div className="shrink-0 text-slate-400">
            {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
        </button>

        {isExpanded && (
          <div className="px-4 sm:px-5 pb-5 border-t border-slate-100 pt-4">
            <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{announcement.body}</p>
            {/* No schema change: this only reads the announcement's
                existing `category` column. Always deep-links to the
                CURRENT published roster (Full Roster has no per-
                announcement snapshot/versioning concept). */}
            {announcement.category === 'Roster' && onViewFullRoster && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onViewFullRoster(); }}
                className="mt-3 inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-semibold shadow-sm transition cursor-pointer"
              >
                <Table2 size={13} />
                <span>View Full Roster</span>
              </button>
            )}
            <div className="mt-3 flex items-center space-x-1.5 text-[10px] text-emerald-700 font-semibold">
              <CheckCircle2 size={12} />
              <span>Marked as read</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="max-w-3xl mx-auto my-8 px-4 space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
        <div className="flex items-center space-x-2 mb-4">
          <Megaphone className="text-slate-500" size={18} />
          <h2 className="font-bold text-slate-900 text-lg tracking-tight">Department Announcements</h2>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <Search size={14} className="text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search announcements..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
          />
        </div>

        {/* Category filter tags */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setCategoryFilter('All')}
            className={`px-3 py-1 rounded-full text-xs font-bold border transition cursor-pointer ${
              categoryFilter === 'All' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            All
          </button>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1 rounded-full text-xs font-bold border transition cursor-pointer ${
                categoryFilter === cat ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
              }`}
            >
              #{cat}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl">
          <RefreshCw size={28} className="text-slate-400 animate-spin mx-auto mb-2" />
          <p className="text-sm text-slate-500">Loading announcements...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl text-slate-400">
          <Megaphone size={28} className="mx-auto mb-2" />
          <p className="text-sm font-medium">No announcements match your filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pinned.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-[10px] font-bold text-amber-700 uppercase tracking-wider px-1">Pinned Notices</h3>
              {pinned.map(renderCard)}
            </div>
          )}
          {regular.length > 0 && (
            <div className="space-y-3">
              {pinned.length > 0 && (
                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">All Announcements</h3>
              )}
              {regular.map(renderCard)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
