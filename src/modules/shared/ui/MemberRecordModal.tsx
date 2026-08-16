import React from 'react';
import { X, IdCard } from 'lucide-react';
import { DEFAULT_TENANT_ID } from '../../../lib/databaseService';
import { UnifiedRecordView } from './UnifiedRecordView';

// Modal wrapper letting a Chief drill into one of their org's workforce
// members' Unified Doctor Record (see udr.ts / UnifiedRecordView.tsx's own
// header) without leaving the Workforce Registry. UnifiedRecordView itself
// is self-view-only today (a resident/doctor viewing their own record at
// /workspace/my-record or /doctor/my-record) — this component reuses it
// as-is for the Chief's cross-member lookup use case, no changes to that
// component required. Overlay/backdrop/header/close-button markup mirrors
// SubmissionsPanel.tsx's existing "Edit Submission" modal
// (src/modules/org-admin/components/dashboard/SubmissionsPanel.tsx) for
// visual consistency with this app's other Chief-dashboard modals.
interface MemberRecordModalProps {
  member: { id: string; full_name: string; tenant_id?: string } | null;
  onClose: () => void;
}

export const MemberRecordModal: React.FC<MemberRecordModalProps> = ({ member, onClose }) => {
  if (!member) return null;

  return (
    <div
      className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto border border-slate-100 flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-slate-950 px-6 py-4 text-white flex justify-between items-center shrink-0 sticky top-0 z-10">
          <div className="flex items-center space-x-2">
            <IdCard size={16} className="text-slate-400" />
            <div>
              <h3 className="font-bold text-base sm:text-lg">Unified Record &mdash; {member.full_name}</h3>
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Read-only cross-module summary</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-300 hover:text-white p-1 hover:bg-slate-900 rounded cursor-pointer transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content: UnifiedRecordView already carries its own max-width/margin/
            padding (max-w-5xl mx-auto my-8 px-4) — no extra wrapper padding
            added here so its internal spacing isn't doubled up. */}
        <div className="flex-1">
          <UnifiedRecordView
            owner={{
              id: member.id,
              name: member.full_name,
              kind: 'workforce',
              tenantId: member.tenant_id ?? DEFAULT_TENANT_ID,
            }}
          />
        </div>
      </div>
    </div>
  );
};
