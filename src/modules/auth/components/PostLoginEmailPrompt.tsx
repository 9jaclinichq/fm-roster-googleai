import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import { databaseService } from '../../../lib/databaseService';

interface PostLoginEmailPromptProps {
  workforceId: string;
  // In-memory only, passed down from App.tsx's fresh-login state — never
  // persisted to localStorage (same pattern already used for the platform
  // operator's transitional shared code). resident_set_email() re-verifies
  // this server-side; it is never trusted as authorization on its own.
  accessCode: string;
  onSaved: () => void;
}

// Lightweight, dismissible, non-blocking — a banner, not a modal, so it
// never sits between the member and their workspace. Rendered only for a
// member whose workforce.email is still NULL, immediately after a fresh
// login (see App.tsx: not shown again on a page reload/restore, only on
// their next actual login if skipped — no durable server-side dismissal
// is added in this slice, per the locked decision).
export const PostLoginEmailPrompt: React.FC<PostLoginEmailPromptProps> = ({ workforceId, accessCode, onSaved }) => {
  const [dismissed, setDismissed] = useState(false);
  const [email, setEmail] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  if (dismissed) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim()) {
      setError('Enter an email address.');
      return;
    }
    setIsSaving(true);
    try {
      await databaseService.residentSetEmail(workforceId, accessCode, email.trim());
      onSaved();
    } catch (err) {
      console.warn(err);
      // The RPC's own error messages (invalid code / malformed email /
      // duplicate) are already clear, specific, and safe to show directly.
      setError(err instanceof Error ? err.message : 'Failed to save email. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 pt-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="bg-blue-100 text-blue-700 p-1.5 rounded-lg shrink-0">
            <Mail size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-blue-900">Add your email</p>
            <p className="text-xs text-blue-800/80 mt-0.5">
              Used for account verification and future notifications. Optional — you can add this later without any effect on your access.
            </p>
          </div>
        </div>
        <form onSubmit={handleSave} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(''); }}
            placeholder="you@example.com"
            className="flex-grow px-3 py-2 bg-white border border-blue-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
          />
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 sm:flex-none px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold shadow-sm transition cursor-pointer"
            >
              {isSaving ? 'Saving...' : 'Save email'}
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="flex-1 sm:flex-none px-3 py-2 text-slate-500 hover:text-slate-700 text-xs font-bold cursor-pointer"
            >
              Not now
            </button>
          </div>
        </form>
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </div>
  );
};
