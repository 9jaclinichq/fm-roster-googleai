import React, { useState } from 'react';
import { databaseService } from '../../../../lib/databaseService';
import { WORKSPACE_TIERS, DEFAULT_PAYMENT_PROVIDER } from '../../../shared/config/tiers';
import { PaymentProvider } from '../../../../types';
import { X, Building2, CreditCard, RefreshCw, ExternalLink, CheckCircle2, AlertCircle } from 'lucide-react';

// Self-serve ORGANIZATION-wide Pro upgrade (migration 30) — closes the gap
// migration 29 flagged: Template Manager / Viva Vignette org-content
// creation is gated behind tenants.plan_type, but until now the only way
// to change that was the Platform Operator Console's manual updateTenantPlan.
// This is the tenant-scoped sibling of UpgradeCheckoutModal (per-resident AI
// Copilot Pro) — same provider-hosted-checkout pattern, same flat price,
// different owner (tenant_id, not workforce_id) and a different unlock list.
// Activation (including promoting tenants.plan_type) happens ONLY in the
// payment-webhook Edge Function, never in this client code.

interface TenantUpgradeCheckoutModalProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  /** Called when the Chief says payment is done — parent should refresh the tenant's plan_type. */
  onPaymentCompleted: () => Promise<void>;
}

export const TenantUpgradeCheckoutModal: React.FC<TenantUpgradeCheckoutModalProps> = ({
  open,
  onClose,
  tenantId,
  onPaymentCompleted,
}) => {
  const [email, setEmail] = useState('');
  const [busyProvider, setBusyProvider] = useState<PaymentProvider | null>(null);
  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const pro = WORKSPACE_TIERS.pro_unlimited;

  const handleCheckout = async (provider: PaymentProvider) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address — the payment receipt goes there.');
      return;
    }
    setError('');
    setBusyProvider(provider);
    try {
      const result = await databaseService.initiateTenantPlanCheckout(provider, tenantId, email.trim());
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
        <div className="bg-gradient-to-br from-amber-500 to-orange-600 p-5 text-white relative">
          <button onClick={onClose} className="absolute top-3 right-3 text-white/70 hover:text-white cursor-pointer">
            <X size={18} />
          </button>
          <div className="flex items-center space-x-2 mb-1">
            <Building2 size={18} />
            <h3 className="text-lg font-bold tracking-tight">Upgrade Your Organization</h3>
          </div>
          <p className="text-xs text-orange-50/90">
            One subscription for your whole organization — every Chief-authored template and vignette, not just
            one resident's AI Copilot allowance.
          </p>
        </div>

        <div className="p-5 space-y-4">
          <ul className="text-xs text-slate-600 space-y-1.5">
            <li className="flex items-center space-x-2">
              <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              <span>Create &amp; edit your organization's own Casebook templates</span>
            </li>
            <li className="flex items-center space-x-2">
              <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              <span>Fork Research templates into your organization's own copies</span>
            </li>
            <li className="flex items-center space-x-2">
              <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />
              <span>Add your own Viva Vignette bank entries</span>
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
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider">Email for receipt</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>
              {/* Same provider ordering convention as UpgradeCheckoutModal —
                  DEFAULT_PAYMENT_PROVIDER first, the other as a secondary option. */}
              <div className="space-y-2">
                {(
                  [
                    DEFAULT_PAYMENT_PROVIDER,
                    DEFAULT_PAYMENT_PROVIDER === 'flutterwave' ? 'paystack' : 'flutterwave',
                  ] as PaymentProvider[]
                ).map((provider, idx) => (
                  <button
                    key={provider}
                    onClick={() => handleCheckout(provider)}
                    disabled={busyProvider !== null}
                    className={
                      idx === 0
                        ? 'w-full flex items-center justify-center space-x-1.5 px-3 py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-bold transition cursor-pointer shadow-sm'
                        : 'w-full flex items-center justify-center space-x-1.5 px-3 py-2 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 text-slate-600 rounded-xl text-xs font-semibold transition cursor-pointer'
                    }
                  >
                    {busyProvider === provider ? <RefreshCw size={13} className="animate-spin" /> : <CreditCard size={13} />}
                    <span>
                      Pay with {provider === 'flutterwave' ? 'Flutterwave' : 'Paystack'}
                      {idx === 0 ? ' — Recommended' : ' instead'}
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
                <span>I&apos;ve completed payment — refresh my organization's plan</span>
              </button>
            </div>
          )}

          <p className="text-[10px] text-slate-400 text-center">
            Payment is confirmed by the provider&apos;s webhook — your organization's plan activates automatically
            once the payment settles, even if you close this window.
          </p>
        </div>
      </div>
    </div>
  );
};
