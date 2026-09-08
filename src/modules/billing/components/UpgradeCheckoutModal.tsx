import React, { useState } from 'react';
import { databaseService } from '../../../lib/databaseService';
import { WORKSPACE_TIERS, AI_QUOTA_WINDOW_DAYS } from '../../shared/config/tiers';
import { PaymentProvider } from '../../../types';
import { X, Sparkles, CreditCard, RefreshCw, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';

// Shown when a free-tier member exhausts the AI Copilot allowance (see
// useWorkspaceQuota). Checkout is provider-hosted: the authenticated
// workspc-gateway Edge Function derives owner, payer, plan, amount and
// currency server-side and this modal opens the returned Flutterwave URL.
// A verified gateway webhook — not anything in this client — activates the subscription, so after
// paying the member comes back and hits "I've completed payment" to
// re-query their subscription state.

interface UpgradeCheckoutModalProps {
  open: boolean;
  onClose: () => void;
  workforceId: string;
  // The member's real tenant — was previously hardcoded to DEFAULT_TENANT_ID
  // here, which would misattribute a non-UCH tenant's subscription/revenue
  // to UCH (user_subscriptions.tenant_id) now that self-serve orgs exist
  // (migration 24). Callers resolve the real tenant from their own owner/
  // session context — see ResearchWorkspaceView/CasebookWorkspaceView.
  tenantId: string;
  used: number;
  limit: number | null;
  /** Called when the member says payment is done — parent should refresh quota. */
  onPaymentCompleted: () => Promise<void>;
}

export const UpgradeCheckoutModal: React.FC<UpgradeCheckoutModalProps> = ({
  open,
  onClose,
  workforceId,
  tenantId,
  used,
  limit,
  onPaymentCompleted,
}) => {
  const [busyProvider, setBusyProvider] = useState<PaymentProvider | null>(null);
  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const pro = WORKSPACE_TIERS.pro_unlimited;

  const handleCheckout = async (provider: PaymentProvider) => {
    setError('');
    setBusyProvider(provider);
    try {
      const result = await databaseService.initiatePaymentCheckout(provider, workforceId, tenantId, '');
      window.open(result.checkout_url, '_blank', 'noopener');
      setCheckoutOpened(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
    } finally {
      setBusyProvider(null);
    }
  };

  const handleConfirmPaid = async () => {
    setIsConfirming(true);
    try {
      await onPaymentCompleted();
    } finally {
      setIsConfirming(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl border border-slate-100 w-full max-w-md overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="bg-gradient-to-br from-blue-600 to-indigo-700 p-5 text-white relative">
          <button onClick={onClose} className="absolute top-3 right-3 text-white/70 hover:text-white cursor-pointer">
            <X size={18} />
          </button>
          <div className="flex items-center space-x-2 mb-1">
            <Sparkles size={18} />
            <h3 className="text-lg font-bold tracking-tight">Upgrade to {pro.label}</h3>
          </div>
          <p className="text-xs text-blue-100/90">
            You&apos;ve used {used}
            {limit != null ? ` of ${limit}` : ''} free AI Copilot actions in the last {AI_QUOTA_WINDOW_DAYS} days.
          </p>
        </div>

        <div className="p-5 space-y-4">
          <ul className="text-xs text-slate-600 space-y-1.5">
            <li className="flex items-center space-x-2">
              <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              <span>Unlimited AI Copilot executions (Research &amp; Casebook)</span>
            </li>
            <li className="flex items-center space-x-2">
              <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              <span>Priority queueing for AI actions</span>
            </li>
            <li className="flex items-center space-x-2">
              <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              <span>Custom logbook exports</span>
            </li>
          </ul>

          <div className="text-center">
            <span className="text-2xl font-bold text-slate-900">&#8358;{pro.priceNgnPerMonth?.toLocaleString()}</span>
            <span className="text-xs text-slate-500"> / month</span>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 flex items-start space-x-2 text-xs">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!checkoutOpened ? (
            <>
              <p className="text-xs text-slate-500">The payer and receipt email come from your linked authenticated Workspc account. The secure gateway determines the plan, amount and currency.</p>
              <div className="space-y-2">
                {(['flutterwave'] as PaymentProvider[]).map(provider => (
                  <button
                    key={provider}
                    onClick={() => handleCheckout(provider)}
                    disabled={busyProvider !== null}
                    className="w-full flex items-center justify-center space-x-1.5 px-3 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition cursor-pointer shadow-sm"
                  >
                    {busyProvider === provider ? <RefreshCw size={13} className="animate-spin" /> : <CreditCard size={13} />}
                    <span>
                      Continue to Flutterwave
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 flex items-start space-x-2 text-xs">
                <ExternalLink size={14} className="shrink-0 mt-0.5" />
                <span>
                  The secure checkout opened in a new tab. Complete the payment there, then come back and confirm below.
                </span>
              </div>
              <button
                onClick={handleConfirmPaid}
                disabled={isConfirming}
                className="w-full flex items-center justify-center space-x-1.5 px-3 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition cursor-pointer"
              >
                {isConfirming ? <RefreshCw size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                <span>I&apos;ve completed payment — refresh my plan</span>
              </button>
            </div>
          )}

          <p className="text-[10px] text-slate-400 text-center">
            Payment is confirmed by the provider&apos;s webhook — your plan activates automatically once the payment
            settles, even if you close this window.
          </p>
        </div>
      </div>
    </div>
  );
};
