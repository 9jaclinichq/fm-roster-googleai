import React from 'react';
import { Announcement, AnnouncementCategory } from '../../../../types';
import { Megaphone, Pin, Plus, AlertTriangle } from 'lucide-react';

const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = ['Roster', 'Exam', 'CME', 'Admin'];

interface AnnouncementsAdminPanelProps {
  announcements: Announcement[];
  handleToggleAnnouncementPin: (announcement: Announcement) => void;
  newAnnouncementTitle: string;
  setNewAnnouncementTitle: (value: string) => void;
  newAnnouncementBody: string;
  setNewAnnouncementBody: (value: string) => void;
  newAnnouncementCategory: AnnouncementCategory;
  setNewAnnouncementCategory: (value: AnnouncementCategory) => void;
  newAnnouncementPinned: boolean;
  setNewAnnouncementPinned: (value: boolean) => void;
  newAnnouncementError: string;
  isPostingAnnouncement: boolean;
  handleCreateAnnouncement: (e: React.FormEvent) => void;
}

// Extracted from ChiefDashboardView.tsx (Phase 3, org-admin module split) — the
// 'announcements' tab. Presentational only: state and databaseService calls stay in the shell.
export const AnnouncementsAdminPanel: React.FC<AnnouncementsAdminPanelProps> = ({
  announcements,
  handleToggleAnnouncementPin,
  newAnnouncementTitle,
  setNewAnnouncementTitle,
  newAnnouncementBody,
  setNewAnnouncementBody,
  newAnnouncementCategory,
  setNewAnnouncementCategory,
  newAnnouncementPinned,
  setNewAnnouncementPinned,
  newAnnouncementError,
  isPostingAnnouncement,
  handleCreateAnnouncement,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* List of existing announcements */}
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-100 flex items-center space-x-2">
          <Megaphone className="text-slate-500" size={16} />
          <h3 className="font-bold text-slate-800 text-sm md:text-base">Department Announcements ({announcements.length})</h3>
        </div>

        {announcements.length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">No announcements posted yet.</div>
        ) : (
          <div className="space-y-2">
            {announcements.map((a) => (
              <div key={a.id} className={`p-3 rounded-xl border flex items-start justify-between gap-3 ${a.pinned ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                <div className="min-w-0">
                  <div className="flex items-center flex-wrap gap-2 mb-1">
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border bg-slate-100 text-slate-600 border-slate-200">
                      #{a.category}
                    </span>
                    {a.pinned && (
                      <span className="inline-flex items-center space-x-1 text-amber-700 text-[9px] font-bold uppercase tracking-wider">
                        <Pin size={9} />
                        <span>Pinned</span>
                      </span>
                    )}
                  </div>
                  <div className="font-bold text-slate-900 text-sm truncate">{a.title}</div>
                  <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{a.body}</p>
                </div>
                <button
                  onClick={() => handleToggleAnnouncementPin(a)}
                  className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold border transition cursor-pointer ${
                    a.pinned
                      ? 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'
                      : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  {a.pinned ? 'Unpin' : 'Pin'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create Announcement Form */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
        <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
          <Plus size={16} className="text-slate-500" />
          <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Post New Announcement</h4>
        </div>

        {newAnnouncementError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs flex items-center space-x-1">
            <AlertTriangle size={12} />
            <span>{newAnnouncementError}</span>
          </div>
        )}

        <form onSubmit={handleCreateAnnouncement} className="space-y-4 text-xs sm:text-sm">
          <div className="space-y-1">
            <label htmlFor="ann-title" className="text-xs font-bold text-slate-700 uppercase">Title</label>
            <input
              id="ann-title"
              type="text"
              placeholder="e.g. October Duty Roster Published"
              value={newAnnouncementTitle}
              onChange={(e) => setNewAnnouncementTitle(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="ann-body" className="text-xs font-bold text-slate-700 uppercase">Message</label>
            <textarea
              id="ann-body"
              rows={4}
              placeholder="Announcement details..."
              value={newAnnouncementBody}
              onChange={(e) => setNewAnnouncementBody(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="ann-category" className="text-xs font-bold text-slate-700 uppercase">Category</label>
            <select
              id="ann-category"
              value={newAnnouncementCategory}
              onChange={(e) => setNewAnnouncementCategory(e.target.value as AnnouncementCategory)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 cursor-pointer"
            >
              {ANNOUNCEMENT_CATEGORIES.map(cat => (
                <option key={cat} value={cat}>#{cat}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={newAnnouncementPinned}
              onChange={(e) => setNewAnnouncementPinned(e.target.checked)}
              className="rounded text-slate-950 focus:ring-slate-950"
            />
            <span className="text-xs font-semibold text-slate-700">Pin to top of board</span>
          </label>

          <button
            type="submit"
            disabled={isPostingAnnouncement}
            className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-xl text-xs shadow-sm transition transform active:scale-95 cursor-pointer"
          >
            {isPostingAnnouncement ? 'Posting...' : 'Post Announcement'}
          </button>
        </form>
      </div>
    </div>
  );
};
