import React from 'react';
import { DelegatedRole, SubadminRoleId, WorkforceMember } from '../../../../types';
import { ShieldCheck, UserPlus, AlertTriangle } from 'lucide-react';

const SUBADMIN_ROLES: { value: SubadminRoleId; label: string }[] = [
  { value: 'hod', label: 'Head of Department' },
  { value: 'rtc', label: 'Rotation/Training Coordinator' },
  { value: 'cme_coord', label: 'CME Coordinator' },
  { value: 'consultant', label: 'Consultant' },
];

interface RoleDelegationPanelProps {
  delegatedRoles: DelegatedRole[];
  delegateRoleFilter: SubadminRoleId | 'All';
  setDelegateRoleFilter: (value: SubadminRoleId | 'All') => void;
  workforce: WorkforceMember[];
  delegateWorkforceId: string;
  setDelegateWorkforceId: (value: string) => void;
  delegateRole: SubadminRoleId;
  setDelegateRole: (value: SubadminRoleId) => void;
  delegateError: string;
  isDelegating: boolean;
  handleAssignRole: (e: React.FormEvent) => void;
  handleRevokeRole: (role: DelegatedRole) => void;
}

// Extracted from ChiefDashboardView.tsx (Phase 3, org-admin module split) — the
// 'roles' tab. Presentational only: state and databaseService calls stay in the shell.
export const RoleDelegationPanel: React.FC<RoleDelegationPanelProps> = ({
  delegatedRoles,
  delegateRoleFilter,
  setDelegateRoleFilter,
  workforce,
  delegateWorkforceId,
  setDelegateWorkforceId,
  delegateRole,
  setDelegateRole,
  delegateError,
  isDelegating,
  handleAssignRole,
  handleRevokeRole,
}) => {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* List of delegated roles */}
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center space-x-2">
            <ShieldCheck className="text-slate-500" size={16} />
            <h3 className="font-bold text-slate-800 text-sm md:text-base">Active Subadmins ({delegatedRoles.length})</h3>
          </div>
          <select
            value={delegateRoleFilter}
            onChange={(e) => setDelegateRoleFilter(e.target.value as SubadminRoleId | 'All')}
            className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 cursor-pointer"
          >
            <option value="All">All Roles</option>
            {SUBADMIN_ROLES.map(r => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {delegatedRoles.filter(r => delegateRoleFilter === 'All' || r.role_id === delegateRoleFilter).length === 0 ? (
          <div className="text-center py-8 text-slate-400 text-sm">No subadmins delegated yet.</div>
        ) : (
          <div className="space-y-2">
            {delegatedRoles
              .filter(r => delegateRoleFilter === 'All' || r.role_id === delegateRoleFilter)
              .map(role => (
                <div key={role.id} className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-bold text-slate-900 text-sm truncate">{role.workforce?.full_name || 'Unknown member'}</div>
                    <div className="flex items-center space-x-2 mt-0.5">
                      <span className="text-[10px] text-slate-500">{role.workforce?.category}</span>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                        {SUBADMIN_ROLES.find(r => r.value === role.role_id)?.label || role.role_id}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRevokeRole(role)}
                    className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 transition cursor-pointer"
                  >
                    Revoke
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Delegate a role form */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
        <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
          <UserPlus size={16} className="text-slate-500" />
          <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Delegate a Role</h4>
        </div>

        {delegateError && (
          <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs flex items-center space-x-1">
            <AlertTriangle size={12} />
            <span>{delegateError}</span>
          </div>
        )}

        <form onSubmit={handleAssignRole} className="space-y-4 text-xs sm:text-sm">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 uppercase">Workforce Member</label>
            <select
              value={delegateWorkforceId}
              onChange={(e) => setDelegateWorkforceId(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 cursor-pointer"
            >
              <option value="">Select a member...</option>
              {workforce.map(w => (
                <option key={w.id} value={w.id}>{w.full_name} ({w.category})</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700 uppercase">Role</label>
            <select
              value={delegateRole}
              onChange={(e) => setDelegateRole(e.target.value as SubadminRoleId)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 cursor-pointer"
            >
              {SUBADMIN_ROLES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={isDelegating}
            className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-xl text-xs shadow-sm transition transform active:scale-95 cursor-pointer"
          >
            {isDelegating ? 'Delegating...' : 'Delegate Role'}
          </button>
        </form>
        <p className="text-[10px] text-slate-400 leading-relaxed">
          Delegated members log in with their normal resident access code — an extra "Consultant Review" tab
          appears automatically once their role is active.
        </p>
      </div>
    </div>
  );
};
