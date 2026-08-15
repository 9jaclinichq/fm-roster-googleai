import { useCallback, useEffect, useState } from 'react';
import { databaseService } from '../databaseService';
import { UserSubscription } from '../../types';
import {
  AI_QUOTA_ACTION_TYPES,
  AI_QUOTA_WINDOW_DAYS,
  WORKSPACE_TIERS,
  WorkspaceTier,
} from '../../modules/shared/config/tiers';

// Client-side AI Copilot quota state for one workforce member: counts the
// member's Research/Casebook AI actions (ai_action_logs) over the rolling
// window and resolves their tier from user_subscriptions. UI-layer gating
// only — the tenant-level quota RPC inside the copilot Edge Functions
// remains the authoritative backstop (see src/modules/shared/config/tiers.ts).

export interface WorkspaceQuotaState {
  loading: boolean;
  tier: WorkspaceTier;
  subscription: UserSubscription | null;
  /** Actions used in the current rolling window. */
  used: number;
  /** Window allowance; null = unlimited (Pro). */
  limit: number | null;
  /** Remaining allowance; null = unlimited. */
  remaining: number | null;
  /** True when a free-tier member has spent the allowance. */
  exhausted: boolean;
  /** Re-query usage + subscription (call after an AI action or a payment). */
  refresh: () => Promise<void>;
}

export function useWorkspaceQuota(workforceId: string): WorkspaceQuotaState {
  const [loading, setLoading] = useState(true);
  const [used, setUsed] = useState(0);
  const [subscription, setSubscription] = useState<UserSubscription | null>(null);

  const refresh = useCallback(async () => {
    try {
      const sinceIso = new Date(Date.now() - AI_QUOTA_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const [count, sub] = await Promise.all([
        databaseService.countQuotaAiActions(workforceId, sinceIso, AI_QUOTA_ACTION_TYPES),
        databaseService.getActiveSubscription(workforceId),
      ]);
      setUsed(count);
      setSubscription(sub);
    } catch (err) {
      // Quota display is best-effort — a failed read should never take the
      // workspace down. Fail open (no gate) rather than lock the UI: the
      // server-side tenant quota still backstops actual AI spend.
      console.warn('Failed to load workspace quota state:', err);
    } finally {
      setLoading(false);
    }
  }, [workforceId]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const isPro = !!subscription && subscription.plan === 'pro_unlimited';
  const tier = isPro ? WORKSPACE_TIERS.pro_unlimited : WORKSPACE_TIERS.free;
  const limit = tier.aiActionsPerWindow;
  const remaining = limit == null ? null : Math.max(0, limit - used);
  const exhausted = !loading && limit != null && used >= limit;

  return { loading, tier, subscription, used, limit, remaining, exhausted, refresh };
}
