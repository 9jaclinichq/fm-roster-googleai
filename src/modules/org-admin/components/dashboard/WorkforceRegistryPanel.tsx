import React from 'react';
import { WorkforceCategory, WorkforceMember } from '../../../../types';
import { Edit, RefreshCw, Unlink, Link2, X, UserPlus, AlertTriangle, IdCard } from 'lucide-react';

interface WorkforceRegistryPanelProps {
  t: (key: string, fallback?: string) => string;
  workforce: WorkforceMember[];
  // Opens the member's Unified Record in a modal (see MemberRecordModal.tsx,
  // rendered by the parent ChiefDashboardView shell).
  onViewRecord: (member: WorkforceMember) => void;
  // Tenant's own live org-defined category vocabulary (migration 39) — the
  // dropdowns below list these instead of the old hardcoded 3-value union.
  // Fetched once in ChiefDashboardView (alongside orgGroups/delegatedRoles)
  // rather than self-fetched here, since this panel is presentational only
  // (state/databaseService calls stay in the shell, per this file's own
  // header) and the parent's handleAddWorkforceMember/handleEditWorkforceMember
  // also need the same list to resolve a category id back to its label.
  workforceCategories: WorkforceCategory[];
  residentCodes: Record<string, string>;
  handleToggleActiveState: (member: WorkforceMember) => void;
  handleResetCode: (memberId: string) => void;
  linkingMemberId: string | null;
  setLinkingMemberId: (id: string | null) => void;
  linkDoctorEmail: string;
  setLinkDoctorEmail: (value: string) => void;
  linkDoctorError: string;
  setLinkDoctorError: (value: string) => void;
  isLinkingDoctor: boolean;
  handleLinkDoctor: (e: React.FormEvent, memberId: string) => void;
  handleUnlinkDoctor: (memberId: string) => void;
  editingMember: WorkforceMember | null;
  setEditingMember: (member: WorkforceMember | null) => void;
  editMemberName: string;
  setEditMemberName: (value: string) => void;
  // Now holds the selected workforce_categories.id (uuid string), not the
  // legacy Category text union — see migration 39 rewiring note above.
  editMemberCategory: string;
  setEditMemberCategory: (value: string) => void;
  handleEditWorkforceMember: (e: React.FormEvent) => void;
  newMemberName: string;
  setNewMemberName: (value: string) => void;
  // Same as editMemberCategory: a workforce_categories.id, not Category text.
  newMemberCategory: string;
  setNewMemberCategory: (value: string) => void;
  newMemberError: string;
  handleAddWorkforceMember: (e: React.FormEvent) => void;
}

// Extracted from ChiefDashboardView.tsx (Phase 3, org-admin module split) — the
// 'workforce' tab. Presentational only: state and databaseService calls stay in the shell.
export const WorkforceRegistryPanel: React.FC<WorkforceRegistryPanelProps> = ({
  t,
  workforce,
  onViewRecord,
  workforceCategories,
  residentCodes,
  handleToggleActiveState,
  handleResetCode,
  linkingMemberId,
  setLinkingMemberId,
  linkDoctorEmail,
  setLinkDoctorEmail,
  linkDoctorError,
  setLinkDoctorError,
  isLinkingDoctor,
  handleLinkDoctor,
  handleUnlinkDoctor,
  editingMember,
  setEditingMember,
  editMemberName,
  setEditMemberName,
  editMemberCategory,
  setEditMemberCategory,
  handleEditWorkforceMember,
  newMemberName,
  setNewMemberName,
  newMemberCategory,
  setNewMemberCategory,
  newMemberError,
  handleAddWorkforceMember,
}) => {
  // Prefer the tenant's own (possibly renamed) live category label when
  // category_id is set, falling back to the legacy free-text column for
  // rows that predate migration 39's backfill or fall outside its match.
  const resolveCategoryLabel = (member: WorkforceMember): string => {
    if (member.category_id) {
      const match = workforceCategories.find(c => c.id === member.category_id);
      if (match) return match.label;
    }
    return member.category;
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Left side: Workforce Member Grid */}
      <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
        <div className="pb-3 border-b border-slate-100">
          <h3 className="font-bold text-slate-800 text-sm md:text-base">Workforce Registry ({workforce.length})</h3>
          <p className="text-xs text-slate-500">Deactivated members are temporarily excluded from login & current metrics.</p>
        </div>

        {/* Workforce Table */}
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200 tracking-wider">
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Access Code</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
              {workforce.map((member) => (
                <React.Fragment key={member.id}>
                  <tr className="hover:bg-slate-50/50">
                    <td className="px-4 py-3 font-bold text-slate-900">{member.full_name}</td>
                    <td className="px-4 py-3 text-slate-500">{resolveCategoryLabel(member)}</td>
                    <td className="px-4 py-3">
                      <span className="font-mono font-extrabold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                        {residentCodes[member.id] || '······'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleActiveState(member)}
                        className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-bold border transition shrink-0 cursor-pointer ${
                          member.active
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-rose-50 text-rose-800 border-rose-200'
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${member.active ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        <span>{member.active ? 'Active' : 'Inactive'}</span>
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2 shrink-0">
                      <button
                        onClick={() => onViewRecord(member)}
                        className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-950 rounded transition cursor-pointer"
                        title="View Unified Record"
                      >
                        <IdCard size={13} />
                      </button>
                      <button
                        onClick={() => {
                          setEditingMember(member);
                          setEditMemberName(member.full_name);
                          // Prefer the member's own category_id; fall back to
                          // matching the legacy text against the tenant's own
                          // vocabulary for rows that predate the backfill.
                          setEditMemberCategory(
                            member.category_id || workforceCategories.find(c => c.label === member.category)?.id || ''
                          );
                        }}
                        className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-950 rounded transition cursor-pointer"
                        title="Edit Name/Category"
                      >
                        <Edit size={13} />
                      </button>
                      <button
                        onClick={() => handleResetCode(member.id)}
                        className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-950 rounded transition cursor-pointer"
                        title="Regenerate Access Code"
                      >
                        <RefreshCw size={13} />
                      </button>
                      {member.doctor_id ? (
                        <button
                          onClick={() => handleUnlinkDoctor(member.id)}
                          className="p-1 hover:bg-slate-100 text-emerald-600 hover:text-emerald-800 rounded transition cursor-pointer"
                          title="Unlink Doctor Account"
                        >
                          <Unlink size={13} />
                        </button>
                      ) : member.active ? (
                        <button
                          onClick={() => {
                            setLinkingMemberId(linkingMemberId === member.id ? null : member.id);
                            setLinkDoctorEmail('');
                            setLinkDoctorError('');
                          }}
                          className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-950 rounded transition cursor-pointer"
                          title="Link Doctor Account"
                        >
                          <Link2 size={13} />
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  {linkingMemberId === member.id && (
                    <tr className="bg-slate-50/70">
                      <td colSpan={5} className="px-4 py-3">
                        <form
                          onSubmit={(e) => handleLinkDoctor(e, member.id)}
                          className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                        >
                          <input
                            type="email"
                            required
                            value={linkDoctorEmail}
                            onChange={(e) => setLinkDoctorEmail(e.target.value)}
                            placeholder="Doctor's registered email"
                            className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition"
                          />
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="submit"
                              disabled={isLinkingDoctor}
                              className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg text-[11px] font-bold transition cursor-pointer"
                            >
                              {isLinkingDoctor ? 'Linking...' : 'Link Account'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setLinkingMemberId(null)}
                              className="p-2 hover:bg-slate-100 text-slate-500 rounded-lg transition cursor-pointer"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </form>
                        {linkDoctorError && (
                          <p className="text-[11px] text-rose-600 font-semibold mt-1.5">{linkDoctorError}</p>
                        )}
                        <p className="text-[10px] text-slate-400 mt-1.5">
                          Links this workforce entry to an already-registered individual doctor account by email.
                        </p>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right side: Add Workforce Member or Edit Form */}
      <div className="space-y-6">
        {/* Edit Member Form */}
        {editingMember ? (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
            <div className="pb-2 border-b border-slate-100 flex justify-between items-center">
              <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Edit Workforce Member</h4>
              <button onClick={() => setEditingMember(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleEditWorkforceMember} className="space-y-4 text-xs sm:text-sm">
              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 uppercase">Full Name</label>
                <input
                  type="text"
                  value={editMemberName}
                  onChange={(e) => setEditMemberName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-slate-700 uppercase">Category</label>
                <select
                  value={editMemberCategory}
                  onChange={(e) => setEditMemberCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 cursor-pointer"
                >
                  {workforceCategories.length === 0 && <option value="">No categories yet</option>}
                  {workforceCategories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingMember(null)}
                  className="w-1/2 py-2 border border-slate-200 hover:bg-slate-50 font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        ) : (
          /* Add Member Form */
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
            <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
              <UserPlus size={16} className="text-slate-500" />
              <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Add New {t('member', 'Resident')}</h4>
            </div>

            {newMemberError && (
              <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs flex items-center space-x-1">
                <AlertTriangle size={12} />
                <span>{newMemberError}</span>
              </div>
            )}

            <form onSubmit={handleAddWorkforceMember} className="space-y-4 text-xs sm:text-sm">
              <div className="space-y-1">
                <label htmlFor="new-name" className="text-xs font-bold text-slate-700 uppercase">Full Name</label>
                <input
                  id="new-name"
                  type="text"
                  placeholder="e.g. Dr. John Doe"
                  value={newMemberName}
                  onChange={(e) => setNewMemberName(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                />
              </div>

              <div className="space-y-1">
                <label htmlFor="new-category" className="text-xs font-bold text-slate-700 uppercase">Category</label>
                <select
                  id="new-category"
                  value={newMemberCategory}
                  onChange={(e) => setNewMemberCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 cursor-pointer"
                >
                  {workforceCategories.length === 0 && <option value="">No categories yet</option>}
                  {workforceCategories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm transition transform active:scale-95 cursor-pointer"
              >
                Add & Generate Code
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
