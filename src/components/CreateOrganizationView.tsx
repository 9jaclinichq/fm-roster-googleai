import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, AlertCircle, CheckCircle2, KeyRound } from 'lucide-react';
import { databaseService } from '../lib/databaseService';

interface CreateOrganizationViewProps {
  // Hands the freshly-generated admin code back to App.tsx, which prefills
  // it into ChiefLoginView (same mechanism DevHelper's admin-code preset
  // already uses) so the founding Chief doesn't have to retype it.
  onCreated: (adminCode: string) => void;
}

// Self-serve "create a new organization" flow (migration 24) — see
// databaseService.createTenantWithAdmin for why this goes through a
// SECURITY DEFINER RPC rather than a raw insert. This is a fully public,
// unauthenticated form; the hidden `website` field below is a lightweight
// honeypot (a bot that fills every input trips it, a human never sees it)
// since this app has no other rate-limiting infrastructure to lean on.
export const CreateOrganizationView: React.FC<CreateOrganizationViewProps> = ({ onCreated }) => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [shortCode, setShortCode] = useState('');
  const [institution, setInstitution] = useState('');
  const [department, setDepartment] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ tenantName: string; adminAccessCode: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (honeypot) {
      // Silently no-op for whatever filled the hidden field — no need to
      // tip off a bot that it was caught.
      return;
    }

    if (!name.trim()) {
      setError('Organization name is required.');
      return;
    }
    if (!/^[a-z0-9_]{3,32}$/.test(shortCode)) {
      setError('Short code must be 3-32 lowercase letters, digits, or underscores.');
      return;
    }

    setIsSubmitting(true);
    try {
      const created = await databaseService.createTenantWithAdmin({
        name: name.trim(),
        short_code: shortCode,
        institution: institution.trim() || null,
        department: department.trim() || null,
      });
      setResult({ tenantName: created.tenantName, adminAccessCode: created.adminAccessCode });
    } catch (err) {
      console.warn(err);
      setError(err instanceof Error ? err.message : 'Could not create the organization. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="max-w-md mx-auto my-12 px-4">
        <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
          <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 p-6 text-white text-center">
            <div className="mx-auto bg-white/15 text-white w-12 h-12 rounded-xl flex items-center justify-center mb-3 shadow-inner">
              <CheckCircle2 size={20} />
            </div>
            <h2 className="text-xl font-bold tracking-tight">{result.tenantName} is ready</h2>
            <p className="text-xs text-emerald-100/90 mt-1 font-medium">Your organization's admin access code</p>
          </div>

          <div className="p-6 sm:p-8 space-y-4">
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3.5 flex items-start space-x-2 text-xs sm:text-sm">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>Write this down now — it will never be shown again.</span>
            </div>
            <p className="text-center font-mono font-bold text-2xl tracking-widest text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-4 py-4">
              {result.adminAccessCode}
            </p>
            <button
              type="button"
              onClick={() => onCreated(result.adminAccessCode)}
              className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-sm transition transform active:scale-[0.98] cursor-pointer"
            >
              Continue to Admin Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto my-12 px-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 p-6 text-white text-center">
          <div className="mx-auto bg-white/15 text-white w-12 h-12 rounded-xl flex items-center justify-center mb-3 shadow-inner">
            <Building2 size={20} />
          </div>
          <h2 className="text-xl font-bold tracking-tight">Create a New Organization</h2>
          <p className="text-xs text-blue-100/90 mt-1 font-medium">Sets up a fresh workspace with its own admin code</p>
        </div>

        <form onSubmit={handleSubmit} className="p-6 sm:p-8 space-y-4">
          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3.5 flex items-start space-x-2 text-xs sm:text-sm animate-shake">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Honeypot — visually hidden, real users never fill it. */}
          <div className="absolute -left-[9999px]" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Organization Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Department of Family Medicine, ..."
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Short Code</label>
            <input
              type="text"
              value={shortCode}
              onChange={(e) => setShortCode(e.target.value.toLowerCase())}
              placeholder="e.g. luth_fm"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition"
            />
            <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
              3-32 lowercase letters, digits, or underscores. Must be unique across all organizations.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Institution (optional)</label>
            <input
              type="text"
              value={institution}
              onChange={(e) => setInstitution(e.target.value)}
              placeholder="e.g. Lagos University Teaching Hospital"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Department (optional)</label>
            <input
              type="text"
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              placeholder="e.g. Family Medicine"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition"
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 text-white rounded-xl text-sm font-bold shadow-sm transition transform active:scale-[0.98] cursor-pointer flex items-center justify-center gap-1.5"
          >
            {isSubmitting ? 'Creating...' : (
              <>
                <KeyRound size={14} />
                <span>Create Organization</span>
              </>
            )}
          </button>
        </form>

        <div className="bg-slate-50 border-t border-slate-100 p-4 text-center">
          <button
            type="button"
            onClick={() => navigate('/admin-portal')}
            className="text-xs font-bold text-blue-600 hover:text-blue-700 hover:underline cursor-pointer"
          >
            &larr; Back
          </button>
        </div>
      </div>
    </div>
  );
};
