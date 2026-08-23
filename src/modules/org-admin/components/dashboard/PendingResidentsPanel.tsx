import React from 'react';
import { WorkforceMember } from '../../../../types';
import { UserCheck, Mail } from 'lucide-react';

interface PendingResidentsPanelProps {
  t: (key: string, fallback?: string) => string;
  pendingResidents: WorkforceMember[];
  residentCodes: Record<string, string>;
  handleResetCode: (memberId: string) => void;
  // migration 69 — Chief-facing only, for manual follow-up. Value is null
  // (rendered as "No email on file") when the member has none; a
  // workforce_id absent from this map (contacts still loading, or the
  // member somehow isn't in the tenant's active set) is treated the same
  // as null, never as an error state.
  memberContacts: Record<string, string | null>;
}

// Extracted from ChiefDashboardView.tsx (Phase 3, org-admin module split) — the
// 'pending' tab. Presentational only: state and databaseService calls stay in the shell.
export const PendingResidentsPanel: React.FC<PendingResidentsPanelProps> = ({
  t,
  pendingResidents,
  residentCodes,
  handleResetCode,
  memberContacts,
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
      <div className="pb-3 border-b border-slate-100">
        <h3 className="font-bold text-slate-800 text-sm md:text-base">Pending Submissions</h3>
        <p className="text-xs text-slate-500">Active {t('members', 'residents').toLowerCase()} who have not yet submitted their information for the current collection.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {pendingResidents.length === 0 ? (
          <div className="md:col-span-3 text-center py-8 text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
            <UserCheck size={32} className="text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-slate-700">All active {t('members', 'residents').toLowerCase()} have submitted!</p>
            <p className="text-xs text-slate-400 mt-0.5">100% collection compliance reached.</p>
          </div>
        ) : (
          pendingResidents.map((member) => (
            <div key={member.id} className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col justify-between space-y-3">
              <div>
                <div className="font-bold text-slate-950 text-sm sm:text-base">{member.full_name}</div>
                <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{member.category}</div>
                <div className="flex items-center space-x-1 mt-1.5 text-[11px]">
                  <Mail size={11} className="text-slate-400 shrink-0" />
                  {memberContacts[member.id] ? (
                    <span className="text-slate-600 font-medium truncate">{memberContacts[member.id]}</span>
                  ) : (
                    <span className="text-slate-400 italic">No email on file</span>
                  )}
                </div>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="text-slate-400 font-medium">Access Code:</span>
                  <div className="font-mono font-extrabold text-slate-800 tracking-wider mt-0.5">{residentCodes[member.id] || '······'}</div>
                </div>
                <button
                  onClick={() => handleResetCode(member.id)}
                  className="px-2 py-1 hover:bg-slate-100 text-slate-600 hover:text-slate-950 rounded border border-slate-200 font-semibold text-[10px] transition"
                  title="Regenerate code"
                >
                  Reset Code
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
