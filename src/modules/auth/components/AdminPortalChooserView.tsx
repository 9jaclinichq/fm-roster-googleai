import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, Building2, ChevronRight } from 'lucide-react';

// Review annotation (workspc.pdf, page 9): "create a new organisation flow
// too, should be in the link flow" — this is the destination for what used
// to be a direct "Admin Portal" link straight into ChiefLoginView. Splits
// admin entry into its two genuinely different trust boundaries (per-org
// Chief admin vs. the separate, more sensitive Platform Operator Console)
// rather than merging them, plus the new self-serve org-creation path
// (migration 24).
export const AdminPortalChooserView: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-br from-blue-700 to-indigo-900 p-6 text-white text-center">
          <div className="mx-auto bg-white/10 text-white w-12 h-12 rounded-xl flex items-center justify-center mb-3 border border-white/10">
            <ShieldAlert size={20} />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Organizational Admin Portal</h2>
          <p className="text-xs text-blue-100/90 mt-1 font-medium">
            Manage an existing organization, or set up a new one
          </p>
        </div>

        <div className="p-6 sm:p-8 space-y-4">
          <button
            type="button"
            onClick={() => navigate('/chief/login')}
            className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition cursor-pointer"
          >
            <span className="flex items-center space-x-3">
              <ShieldAlert size={18} className="text-blue-600 shrink-0" />
              <span>
                <span className="block text-sm font-bold text-slate-800">Sign in to my organization's admin</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">Enter your existing admin access code</span>
              </span>
            </span>
            <ChevronRight size={16} className="text-slate-400 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => navigate('/organization/new')}
            className="w-full flex items-center justify-between px-5 py-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-left transition cursor-pointer"
          >
            <span className="flex items-center space-x-3">
              <Building2 size={18} className="text-blue-600 shrink-0" />
              <span>
                <span className="block text-sm font-bold text-slate-800">Create a new organization</span>
                <span className="block text-[11px] text-slate-500 mt-0.5">Set up a fresh workspace with its own admin code</span>
              </span>
            </span>
            <ChevronRight size={16} className="text-slate-400 shrink-0" />
          </button>
        </div>

        <div className="bg-slate-50 border-t border-slate-100 p-4 flex items-center justify-between text-xs">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
          >
            &larr; Back
          </button>
          <button
            type="button"
            onClick={() => navigate('/saas-operator')}
            className="text-slate-400 hover:text-slate-600 hover:underline cursor-pointer"
          >
            Already a Platform Operator?
          </button>
        </div>
      </div>
    </div>
  );
};
