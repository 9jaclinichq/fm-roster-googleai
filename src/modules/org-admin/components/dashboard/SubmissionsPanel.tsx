import React from 'react';
import { SubmissionWithWorkforce, WorkforceCategory } from '../../../../types';
import { FileText, FileDown, Search, Filter, Calendar, Eye, Edit, X, AlertTriangle, RefreshCw } from 'lucide-react';

interface SubmissionsPanelProps {
  t: (key: string, fallback?: string) => string;
  submissions: SubmissionWithWorkforce[];
  filteredSubmissions: SubmissionWithWorkforce[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  categoryFilter: string;
  setCategoryFilter: (value: string) => void;
  // Tenant's own live category vocabulary (migration 39 rewiring) — the
  // filter dropdown below lists these instead of the old hardcoded 3-value
  // union, matching WorkforceRegistryPanel/RoleDelegationPanel.
  workforceCategories: WorkforceCategory[];
  leaveFilter: string;
  setLeaveFilter: (value: string) => void;
  handleExportCSV: () => void;
  selectedSubmission: SubmissionWithWorkforce | null;
  setSelectedSubmission: (sub: SubmissionWithWorkforce | null) => void;
  openEditSubmission: (sub: SubmissionWithWorkforce) => void;
  editingSubmission: SubmissionWithWorkforce | null;
  setEditingSubmission: (sub: SubmissionWithWorkforce | null) => void;
  editError: string;
  editCurrentRotation: string;
  setEditCurrentRotation: (value: string) => void;
  editNextRotation: string;
  setEditNextRotation: (value: string) => void;
  editTakingLeave: boolean;
  setEditTakingLeave: (value: boolean) => void;
  editLeaveType: string;
  setEditLeaveType: (value: string) => void;
  editLeaveApplied: boolean;
  setEditLeaveApplied: (value: boolean) => void;
  editLeaveStart: string;
  setEditLeaveStart: (value: string) => void;
  editLeaveEnd: string;
  setEditLeaveEnd: (value: string) => void;
  editNotes: string;
  setEditNotes: (value: string) => void;
  isEditSubmitting: boolean;
  handleEditSubmissionSubmit: (e: React.FormEvent) => void;
}

// Extracted from ChiefDashboardView.tsx (Phase 3, org-admin module split) — the
// 'submissions' tab plus its two modals (view details / edit on behalf of resident).
// Presentational only: all state and databaseService calls stay in the shell.
export const SubmissionsPanel: React.FC<SubmissionsPanelProps> = ({
  t,
  submissions,
  filteredSubmissions,
  searchQuery,
  setSearchQuery,
  categoryFilter,
  setCategoryFilter,
  workforceCategories,
  leaveFilter,
  setLeaveFilter,
  handleExportCSV,
  selectedSubmission,
  setSelectedSubmission,
  openEditSubmission,
  editingSubmission,
  setEditingSubmission,
  editError,
  editCurrentRotation,
  setEditCurrentRotation,
  editNextRotation,
  setEditNextRotation,
  editTakingLeave,
  setEditTakingLeave,
  editLeaveType,
  setEditLeaveType,
  editLeaveApplied,
  setEditLeaveApplied,
  editLeaveStart,
  setEditLeaveStart,
  editLeaveEnd,
  setEditLeaveEnd,
  editNotes,
  setEditNotes,
  isEditSubmitting,
  handleEditSubmissionSubmit,
}) => {
  return (
    <>
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden space-y-4 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 flex-wrap pb-4 border-b border-slate-100">
          <div className="flex items-center space-x-2">
            <FileText className="text-slate-400" size={18} />
            <h3 className="font-bold text-slate-800 text-sm md:text-base">{t('member', 'Resident')} Responses</h3>
          </div>
          {submissions.length > 0 && (
            <button
              onClick={handleExportCSV}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-bold shadow-sm transition cursor-pointer"
            >
              <FileDown size={14} />
              <span>Export CSV</span>
            </button>
          )}
        </div>

        {/* Submissions Search & Filters */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {/* Search */}
          <div className="relative">
            <Search size={14} className="text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder={`Search by ${t('member', 'resident').toLowerCase()} or rotation...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
            />
          </div>

          {/* Category Filter */}
          <div className="flex items-center space-x-2">
            <Filter size={12} className="text-slate-400" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 cursor-pointer"
            >
              <option value="All">All Categories</option>
              {workforceCategories.map(cat => (
                <option key={cat.id} value={cat.label}>{cat.label}</option>
              ))}
            </select>
          </div>

          {/* Leave Filter */}
          <div className="flex items-center space-x-2">
            <Calendar size={12} className="text-slate-400" />
            <select
              value={leaveFilter}
              onChange={(e) => setLeaveFilter(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 cursor-pointer"
            >
              <option value="All">All Leave Status</option>
              <option value="On Leave">Taking Leave</option>
              <option value="No Leave">No Leave</option>
            </select>
          </div>
        </div>

        {/* Responses Grid / Table */}
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200 tracking-wider">
                <th className="px-4 py-3">{t('member', 'Resident')}</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Current {t('rotation', 'Rotation')}</th>
                <th className="px-4 py-3">Next {t('rotation', 'Rotation')}</th>
                <th className="px-4 py-3">Leave Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
              {filteredSubmissions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-400">
                    {submissions.length === 0
                      ? 'No responses submitted yet for this collection.'
                      : 'No submissions matched your current search filters.'}
                  </td>
                </tr>
              ) : (
                filteredSubmissions.map((sub) => (
                  <tr key={sub.id} className="hover:bg-slate-50/50">
                    <td className="px-4 py-3.5 font-bold text-slate-900">{sub.workforce.full_name}</td>
                    <td className="px-4 py-3.5 text-slate-500">{sub.workforce.category}</td>
                    <td className="px-4 py-3.5">{sub.current_rotation}</td>
                    <td className="px-4 py-3.5">{sub.next_rotation}</td>
                    <td className="px-4 py-3.5">
                      {sub.taking_leave ? (
                        <div className="inline-flex flex-col">
                          <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full w-max">
                            On Leave ({sub.leave_type})
                          </span>
                          <span className="text-[9px] text-slate-400 mt-0.5">
                            {sub.leave_start?.substring(5)} to {sub.leave_end?.substring(5)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">No Leave</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right space-x-2 shrink-0">
                      <button
                        onClick={() => setSelectedSubmission(sub)}
                        className="inline-flex items-center justify-center p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-950 rounded-lg transition cursor-pointer"
                        title="View submission details"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        onClick={() => openEditSubmission(sub)}
                        className="inline-flex items-center justify-center p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-950 rounded-lg transition cursor-pointer"
                        title={`Edit ${t('member', 'resident').toLowerCase()}'s submission details`}
                      >
                        <Edit size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* MODAL: VIEW RESPONSE DETAILS */}
      {selectedSubmission && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-100 flex flex-col shadow-2xl">
            {/* Header */}
            <div className="bg-gradient-to-br from-blue-700 to-indigo-900 px-6 py-4 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold text-base sm:text-lg">{selectedSubmission.workforce.full_name}</h3>
                <p className="text-[10px] text-blue-200 font-bold uppercase tracking-wider">{selectedSubmission.workforce.category} &bull; Monthly Submission</p>
              </div>
              <button
                onClick={() => setSelectedSubmission(null)}
                className="text-white/80 hover:text-white p-1 hover:bg-white/10 rounded cursor-pointer transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 sm:p-8 space-y-6 text-xs sm:text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Current {t('rotation', 'Rotation')}</span>
                  <div className="font-bold text-slate-900 mt-0.5">{selectedSubmission.current_rotation}</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Expected Next {t('rotation', 'Rotation')}</span>
                  <div className="font-bold text-slate-900 mt-0.5">{selectedSubmission.next_rotation}</div>
                </div>
              </div>

              {/* Leave Info */}
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <h4 className="font-bold text-slate-850 uppercase text-[10px] tracking-wider text-slate-500">Leave Parameters</h4>

                {selectedSubmission.taking_leave ? (
                  <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-[9px] text-slate-500 font-bold uppercase">Leave Type</span>
                        <div className="font-bold text-amber-900 mt-0.5">{selectedSubmission.leave_type}</div>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 font-bold uppercase">Applied to HOD?</span>
                        <div className="font-bold text-amber-900 mt-0.5">{selectedSubmission.leave_applied ? 'Yes' : 'No'}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 border-t border-amber-200/50 pt-2.5">
                      <div>
                        <span className="text-[9px] text-slate-500 font-bold uppercase">Start Date</span>
                        <div className="font-semibold text-slate-800 mt-0.5">{selectedSubmission.leave_start}</div>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 font-bold uppercase">End Date</span>
                        <div className="font-semibold text-slate-800 mt-0.5">{selectedSubmission.leave_end}</div>
                      </div>
                    </div>

                    {/* Document downloads */}
                    {selectedSubmission.leave_document_urls && selectedSubmission.leave_document_urls.length > 0 && (
                      <div className="border-t border-amber-200/50 pt-2.5">
                        <span className="text-[9px] text-slate-500 font-bold uppercase block mb-1.5">Leave Attachments ({selectedSubmission.leave_document_urls.length})</span>
                        <div className="space-y-1.5">
                          {selectedSubmission.leave_document_urls.map((url, idx) => {
                            const isMock = url.startsWith('blob:') || url.startsWith('https://example.com');
                            const docName = isMock
                              ? `Leave_Document_${idx + 1}`
                              : decodeURIComponent(url.split('/').pop() || `Attachment_${idx + 1}`).split('_').slice(1).join('_');
                            return (
                              <a
                                key={idx}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center space-x-2 text-xs font-semibold text-slate-800 hover:text-slate-950 bg-white p-2 rounded-lg border border-slate-200 hover:shadow-sm"
                              >
                                <FileText size={14} className="text-slate-400 shrink-0" />
                                <span className="truncate max-w-[400px] underline">{docName}</span>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-slate-500 italic py-2">No leave scheduled next month.</div>
                )}
              </div>

              {/* Notes */}
              <div className="border-t border-slate-100 pt-4">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Additional {t('member', 'Resident')} Notes</span>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-slate-800 leading-relaxed font-medium mt-1">
                  {selectedSubmission.notes || <span className="text-slate-400 italic">No notes provided.</span>}
                </div>
              </div>

              {/* Timestamp */}
              <div className="text-[10px] text-slate-400 text-right font-medium">
                Submitted on: {new Date(selectedSubmission.created_at).toLocaleString()}
                {selectedSubmission.updated_at !== selectedSubmission.created_at && (
                  <span className="block italic">Updated on: {new Date(selectedSubmission.updated_at).toLocaleString()}</span>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex justify-end shrink-0">
              <button
                onClick={() => setSelectedSubmission(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition cursor-pointer"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT SUBMISSION ON BEHALF OF RESIDENT */}
      {editingSubmission && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-100 flex flex-col shadow-2xl">
            {/* Header */}
            <div className="bg-slate-950 px-6 py-4 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold text-base sm:text-lg">Edit Submission</h3>
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">{t('member', 'Resident')}: {editingSubmission.workforce.full_name}</p>
              </div>
              <button
                onClick={() => setEditingSubmission(null)}
                className="text-slate-300 hover:text-white p-1 hover:bg-slate-900 rounded cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content Form */}
            <form onSubmit={handleEditSubmissionSubmit} className="p-6 sm:p-8 space-y-5 text-xs sm:text-sm flex-1">
              {editError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 flex items-center space-x-1">
                  <AlertTriangle size={14} />
                  <span>{editError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Current Rotation */}
                <div className="space-y-1">
                  <label htmlFor="edit-curr-rot" className="text-xs font-bold text-slate-700 uppercase">Current {t('rotation', 'Rotation')}</label>
                  <input
                    id="edit-curr-rot"
                    type="text"
                    value={editCurrentRotation}
                    onChange={(e) => setEditCurrentRotation(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-slate-950"
                  />
                </div>

                {/* Next Rotation */}
                <div className="space-y-1">
                  <label htmlFor="edit-next-rot" className="text-xs font-bold text-slate-700 uppercase">Expected Next {t('rotation', 'Rotation')}</label>
                  <input
                    id="edit-next-rot"
                    type="text"
                    value={editNextRotation}
                    onChange={(e) => setEditNextRotation(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-slate-950"
                  />
                </div>
              </div>

              {/* Taking Leave Toggle */}
              <div className="flex items-center justify-between border-t border-slate-150 pt-3">
                <div>
                  <span className="font-bold text-slate-800 text-xs uppercase block">Taking Leave?</span>
                  <span className="text-[10px] text-slate-500">Scheduled leave parameter overrides</span>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setEditTakingLeave(false)}
                    className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${!editTakingLeave ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditTakingLeave(true)}
                    className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${editTakingLeave ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
                  >
                    Yes
                  </button>
                </div>
              </div>

              {editTakingLeave && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-4 animate-slideDown">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="edit-leave-type" className="font-semibold text-slate-700">Leave Type</label>
                      <select
                        id="edit-leave-type"
                        value={editLeaveType}
                        onChange={(e) => setEditLeaveType(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none cursor-pointer"
                      >
                        <option>Annual Leave</option>
                        <option>Maternity Leave</option>
                        <option>Paternity Leave</option>
                        <option>Sick Leave</option>
                        <option>Compassionate Leave</option>
                        <option>Study Leave</option>
                        <option>Other</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-slate-700 block">Applied to Dept?</label>
                      <div className="flex items-center space-x-4 h-8">
                        <label className="inline-flex items-center space-x-1 cursor-pointer">
                          <input
                            type="radio"
                            checked={editLeaveApplied === true}
                            onChange={() => setEditLeaveApplied(true)}
                            className="text-slate-950 focus:ring-slate-950"
                          />
                          <span>Yes</span>
                        </label>
                        <label className="inline-flex items-center space-x-1 cursor-pointer">
                          <input
                            type="radio"
                            checked={editLeaveApplied === false}
                            onChange={() => setEditLeaveApplied(false)}
                            className="text-slate-950 focus:ring-slate-950"
                          />
                          <span>No</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="edit-start-date" className="font-semibold text-slate-700">Start Date</label>
                      <input
                        id="edit-start-date"
                        type="date"
                        value={editLeaveStart}
                        onChange={(e) => setEditLeaveStart(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="edit-end-date" className="font-semibold text-slate-700">End Date</label>
                      <input
                        id="edit-end-date"
                        type="date"
                        value={editLeaveEnd}
                        onChange={(e) => setEditLeaveEnd(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1 border-t border-slate-150 pt-3">
                <label htmlFor="edit-notes" className="text-xs font-bold text-slate-700 uppercase">Additional Notes</label>
                <textarea
                  id="edit-notes"
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-slate-950"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-2 pt-2 border-t border-slate-150 justify-end">
                <button
                  type="button"
                  onClick={() => setEditingSubmission(null)}
                  className="px-5 py-2 border border-slate-200 hover:bg-slate-50 font-bold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEditSubmitting}
                  className="px-5 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl shadow-sm cursor-pointer flex items-center"
                >
                  {isEditSubmitting ? (
                    <>
                      <RefreshCw size={13} className="animate-spin mr-1" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Changes on Behalf</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
