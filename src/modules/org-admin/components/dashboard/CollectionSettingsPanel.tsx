import React from 'react';
import { Collection } from '../../../../types';
import { Calendar, AlertTriangle, Settings, Unlock, Lock, Key } from 'lucide-react';

interface CollectionSettingsPanelProps {
  newCollectionTitle: string;
  setNewCollectionTitle: (value: string) => void;
  newCollectionDeadline: string;
  setNewCollectionDeadline: (value: string) => void;
  newCollectionError: string;
  handleCreateCollection: (e: React.FormEvent) => void;
  collection: Collection | null;
  handleToggleCollectionStatus: () => void;
  changeDeadlineValue: string;
  setChangeDeadlineValue: (value: string) => void;
  changeDeadlineError: string;
  handleChangeDeadline: (e: React.FormEvent) => void;
  adminAccessCodeValue: string;
  setAdminAccessCodeValue: (value: string) => void;
  adminAccessCodeError: string;
  handleUpdateAdminCode: (e: React.FormEvent) => void;
}

// Extracted from ChiefDashboardView.tsx (Phase 3, org-admin module split) — the
// 'settings' tab. Presentational only: state and databaseService calls stay in the shell.
export const CollectionSettingsPanel: React.FC<CollectionSettingsPanelProps> = ({
  newCollectionTitle,
  setNewCollectionTitle,
  newCollectionDeadline,
  setNewCollectionDeadline,
  newCollectionError,
  handleCreateCollection,
  collection,
  handleToggleCollectionStatus,
  changeDeadlineValue,
  setChangeDeadlineValue,
  changeDeadlineError,
  handleChangeDeadline,
  adminAccessCodeValue,
  setAdminAccessCodeValue,
  adminAccessCodeError,
  handleUpdateAdminCode,
}) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Create Collection Column */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
        <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
          <Calendar size={16} className="text-slate-500" />
          <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Initiate Monthly Collection</h4>
        </div>

        <div className="bg-amber-50 text-amber-900 border border-amber-200 p-3 rounded-lg text-xs leading-relaxed flex items-start space-x-2">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>
            <strong>Important Transaction Rule:</strong> Establishing a new collection will automatically close and lock submissions on all other previously active collection boards.
          </span>
        </div>

        {newCollectionError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs">
            {newCollectionError}
          </div>
        )}

        <form onSubmit={handleCreateCollection} className="space-y-4 text-xs sm:text-sm">
          <div className="space-y-1">
            <label htmlFor="coll-title" className="text-xs font-bold text-slate-700 uppercase">Collection Title</label>
            <input
              id="coll-title"
              type="text"
              placeholder="e.g. August 2026 Collection"
              value={newCollectionTitle}
              onChange={(e) => setNewCollectionTitle(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="coll-deadline" className="text-xs font-bold text-slate-700 uppercase">Submission Deadline</label>
            <input
              id="coll-deadline"
              type="datetime-local"
              value={newCollectionDeadline}
              onChange={(e) => setNewCollectionDeadline(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow transition cursor-pointer"
          >
            Create & Launch Collection
          </button>
        </form>
      </div>

      {/* Manage Current Collection & Admin Details */}
      <div className="space-y-6">
        {/* Current Status Form */}
        {collection && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
            <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
              <Settings size={16} className="text-slate-500" />
              <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Active Collection Details</h4>
            </div>

            <div className="flex items-center justify-between text-xs sm:text-sm">
              <div>
                <span className="text-xs text-slate-500 font-medium">Monthly Slot:</span>
                <div className="font-bold text-slate-900">{collection.title}</div>
              </div>

              <button
                onClick={handleToggleCollectionStatus}
                className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                  collection.status === 'open'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                }`}
              >
                {collection.status === 'open' ? (
                  <>
                    <Unlock size={12} />
                    <span>Status: OPEN</span>
                  </>
                ) : (
                  <>
                    <Lock size={12} />
                    <span>Status: LOCKED</span>
                  </>
                )}
              </button>
            </div>

            <form onSubmit={handleChangeDeadline} className="space-y-3 pt-2 text-xs sm:text-sm">
              {changeDeadlineError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2 text-xs rounded">
                  {changeDeadlineError}
                </div>
              )}
              <div className="space-y-1">
                <label htmlFor="change-deadline" className="text-xs font-bold text-slate-700 uppercase">Edit Deadline</label>
                <input
                  id="change-deadline"
                  type="datetime-local"
                  value={changeDeadlineValue}
                  onChange={(e) => setChangeDeadlineValue(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                />
              </div>
              <button
                type="submit"
                className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
              >
                Update Deadline Time
              </button>
            </form>
          </div>
        )}

        {/* Administrative Access Code Settings */}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
          <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
            <Key size={16} className="text-slate-500" />
            <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Admin Access Security</h4>
          </div>

          {adminAccessCodeError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2 text-xs rounded">
              {adminAccessCodeError}
            </div>
          )}

          <form onSubmit={handleUpdateAdminCode} className="space-y-3 text-xs sm:text-sm">
            <div className="space-y-1">
              <label htmlFor="change-admin-code" className="text-xs font-bold text-slate-700 uppercase">Set New Admin Access Code</label>
              <input
                id="change-admin-code"
                type="text"
                placeholder="Enter a new admin access code"
                value={adminAccessCodeValue}
                onChange={(e) => setAdminAccessCodeValue(e.target.value.trim())}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
              />
              <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
                For security, the current code is never displayed here. Entering a new one replaces it immediately.
              </p>
            </div>
            <button
              type="submit"
              className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
            >
              Save New Admin Code
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
