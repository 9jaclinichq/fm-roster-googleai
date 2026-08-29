import React, { useEffect, useState } from 'react';
import { ShieldCheck, ChevronRight } from 'lucide-react';
import { organisationMembershipService } from '../lib/organisationMembershipService';

interface LinkInstitutionalAccessPromptProps {
  workforceId: string;
  onLinked: () => void;
}

// The Institutional Identity Slice 2a "minimal UI seam" — per the
// reviewed "institutional identity slice 2 claim/link" design handoff
// (WORKSPC, dated 2026-08-29)'s Section 11 and prompt1.txt's own "Minimal
// UI seam" section. Mirrors PostLoginEmailPrompt.tsx's exact established
// precedent (small, dismissible, non-blocking banner, mounted at the
// App-shell level) rather than inventing a new UI pattern.
//
// Mounted by App.tsx ONLY when BOTH a real Supabase Auth session exists
// (currentDoctor !== null — the only way any session currently gets one
// in this app) AND a resident session is also active (currentResident)
// — this is exactly the "authenticated Supabase user is also operating
// in a resident context" precondition named in the reviewed handoff and
// prompt1.txt, not a new convergence concept. This component itself then
// checks (via current_user_organisation_memberships(), migration 76)
// whether THIS specific workforce_id is already linked, and renders
// nothing at all if so, or while that check is in flight — App.tsx's own
// gating condition stays as simple/cheap as PostLoginEmailPrompt's.
//
// Explicitly does NOT: store the resident code anywhere persistent (the
// input is local component state only, cleared on unmount/dismiss, never
// written to localStorage); disable/invalidate the legacy resident
// session on success OR failure (a failed claim leaves the existing
// code-based session completely untouched); or add any second
// authentication/account system (it calls the exact same
// claim_workforce_member RPC via the same authenticated Supabase session
// currentDoctor already established — no new signup/signin flow here).
export const LinkInstitutionalAccessPrompt: React.FC<LinkInstitutionalAccessPromptProps> = ({ workforceId, onLinked }) => {
  const [checking, setChecking] = useState(true);
  const [alreadyLinked, setAlreadyLinked] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [enteredCode, setEnteredCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [succeeded, setSucceeded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const memberships = await organisationMembershipService.getCurrentUserMemberships();
        if (!cancelled) {
          setAlreadyLinked(memberships.some((m) => m.workforce_id === workforceId));
        }
      } catch (err) {
        // Non-fatal: if the check itself fails, default to NOT showing the
        // prompt rather than risking a confusing/incorrect nudge — the
        // legacy resident session is completely unaffected either way.
        console.warn('LinkInstitutionalAccessPrompt: membership check failed (non-fatal)', err);
        if (!cancelled) setAlreadyLinked(true);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => { cancelled = true; };
  }, [workforceId]);

  if (checking || alreadyLinked || dismissed) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!enteredCode.trim()) {
      setError('Enter your resident access code.');
      return;
    }
    setIsSubmitting(true);
    try {
      await organisationMembershipService.claimWorkforceMember(workforceId, enteredCode.trim());
      setSucceeded(true);
      setEnteredCode('');
      onLinked();
    } catch (err) {
      console.warn(err);
      // The RPC's own error messages (invalid code / inactive workforce /
      // already claimed elsewhere / conflict) are already clear and safe
      // to show directly — same convention as PostLoginEmailPrompt.
      setError(err instanceof Error ? err.message : 'Failed to link institutional access. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (succeeded) {
    return (
      <div className="max-w-3xl mx-auto px-4 pt-4">
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
          <div className="bg-emerald-100 text-emerald-700 p-1.5 rounded-lg shrink-0">
            <ShieldCheck size={16} />
          </div>
          <p className="text-sm font-bold text-emerald-900">Institutional access linked to your account.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pt-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="bg-blue-100 text-blue-700 p-1.5 rounded-lg shrink-0">
            <ShieldCheck size={16} />
          </div>
          <div className="min-w-0 flex-grow">
            <p className="text-sm font-bold text-blue-900">Link institutional access</p>
            <p className="text-xs text-blue-800/80 mt-0.5">
              Confirm your existing resident access code to link this signed-in account to your institutional record. Your current access code keeps working either way.
            </p>
          </div>
        </div>

        {!expanded ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center gap-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-sm transition cursor-pointer"
            >
              <span>Link institutional access</span>
              <ChevronRight size={13} />
            </button>
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="px-3 py-2 text-slate-500 hover:text-slate-700 text-xs font-bold cursor-pointer"
            >
              Not now
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={enteredCode}
              onChange={(e) => { setEnteredCode(e.target.value); setError(''); }}
              placeholder="Confirm your resident access code"
              className="flex-grow px-3 py-2 bg-white border border-blue-200 rounded-lg text-xs font-semibold text-slate-800 tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 sm:flex-none px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg text-xs font-bold shadow-sm transition cursor-pointer"
              >
                {isSubmitting ? 'Linking...' : 'Confirm'}
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
        )}
        {error && <p className="text-xs text-rose-600">{error}</p>}
      </div>
    </div>
  );
};
