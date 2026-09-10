import React from 'react';
import { AlertCircle, Loader2, LogIn, ShieldCheck } from 'lucide-react';

export type PersonalAccountAccessState =
  | 'signed-out'
  | 'checking'
  | 'error'
  | 'inactive'
  | 'ambiguous'
  | 'unauthorized';

interface Props {
  state: PersonalAccountAccessState;
  onSignIn: () => void;
  onRetry: () => void;
}

// This surface restores an existing personal authentication session. It never
// performs account linking and never treats the browser's resident session as
// membership or tenant-admin authority. After sign-in, App.tsx resolves the
// canonical server projection before enabling any administrator navigation.
export const PersonalAccountAccessPrompt: React.FC<Props> = ({ state, onSignIn, onRetry }) => {
  if (state === 'signed-out') {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pt-4">
        <div className="space-y-3 rounded-xl border border-blue-200 bg-blue-50 p-4" role="status">
          <div className="flex gap-3">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-blue-700" />
            <div>
              <p className="text-sm font-bold text-blue-950">Sign in to restore personal access</p>
              <p className="mt-1 text-xs leading-relaxed text-blue-900">
                Use your existing personal account. Workspc will verify your organisation membership and administrator capability from the server. This does not create or relink an account, and you do not need your institutional access code.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onSignIn}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            <LogIn size={15} />
            Sign in with personal account
          </button>
        </div>
      </div>
    );
  }

  if (state === 'checking') {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 pt-4">
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700" role="status">
          <Loader2 size={17} className="shrink-0 animate-spin" />
          Checking your organisation access…
        </div>
      </div>
    );
  }

  const message = state === 'inactive'
    ? 'Your personal organisation membership is not active. Ask an organisation administrator to review it; do not create another link.'
    : state === 'ambiguous'
      ? 'More than one active organisation membership was found. Workspc did not guess which workspace to authorize.'
      : state === 'unauthorized'
        ? 'This personal account is not authorized for the current organisation context. No administrator access was granted.'
        : 'Workspc could not verify your organisation access. No administrator access was granted and no relinking action was started.';

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-4">
      <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950" role="alert">
        <div className="flex gap-3">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <p className="text-xs leading-relaxed">{message}</p>
        </div>
        {state === 'error' && (
          <button
            type="button"
            onClick={onRetry}
            className="min-h-11 rounded-lg border border-amber-300 bg-white px-4 py-2 text-xs font-bold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2"
          >
            Retry access check
          </button>
        )}
      </div>
    </div>
  );
};
