// Workspace tier definitions for AI Copilot feature gating.
//
// Relationship to the EXISTING quota machinery (migration 11): the
// `check_and_increment_tenant_ai_quota()` RPC enforces a TENANT-level
// 50-actions-per-14-days limit server-side inside every copilot Edge
// Function, and remains the authoritative backstop — a curl straight at a
// function URL still hits it. The per-WORKFORCE-member gating configured
// here (consumed by src/lib/billing/useWorkspaceQuota.ts) is the
// user-facing layer on top: it counts the member's own ai_action_logs rows
// client-side, blocks the UI when the free allowance is spent, and offers
// the Paystack/Flutterwave upgrade checkout instead of a hard error.
//
// PRICING: ₦12,000/month, confirmed by the user (Dr. Olanipekun) on
// 2026-08-14 — no longer a placeholder (the earlier ₦5,000 figure was).
// The value below is display-only; the authoritative charged amount is
// the server-side twin constant in supabase/functions/payment-checkout/
// index.ts, so a forged client can't change what Paystack/Flutterwave
// actually charge — keep both in sync when this changes again.

export type WorkspaceTierId = 'free' | 'pro_unlimited';

/**
 * The payment provider presented as the primary/default checkout in the
 * upgrade modal (both brand hostnames — the modal is brand-agnostic). The
 * other provider stays available as a secondary option. Server-side, both
 * remain fully supported by payment-checkout/payment-webhook regardless of
 * this ordering.
 */
export const DEFAULT_PAYMENT_PROVIDER = 'flutterwave' as const;

export interface WorkspaceTier {
  id: WorkspaceTierId;
  label: string;
  /** AI Copilot executions allowed per rolling window; null = unlimited. */
  aiActionsPerWindow: number | null;
  priorityQueueing: boolean;
  customLogbookExports: boolean;
  /** Display price. null = free. The charged amount lives server-side. */
  priceNgnPerMonth: number | null;
}

/** Rolling window over which free-tier AI usage is counted, in days. */
export const AI_QUOTA_WINDOW_DAYS = 14;

/**
 * The AI Copilot action types that count against the free-tier quota:
 * the Research Engine and PMR/Casebook module actions (migrations 14/16).
 * The original academic-copilot action types (migration 08) are deliberately
 * not gated in this pass — the task brief scopes gating to "Research &
 * PMR/Casebook modules".
 */
export const AI_QUOTA_ACTION_TYPES = [
  'research_audit',
  'literature_matrix',
  'table_shells',
  'casebook_audit',
  'defense_questions',
  'logbook_parse',
] as const;

export const WORKSPACE_TIERS: Record<WorkspaceTierId, WorkspaceTier> = {
  free: {
    id: 'free',
    label: 'Free',
    aiActionsPerWindow: 50,
    priorityQueueing: false,
    customLogbookExports: false,
    priceNgnPerMonth: null,
  },
  pro_unlimited: {
    id: 'pro_unlimited',
    label: 'Pro / Unlimited',
    aiActionsPerWindow: null,
    priorityQueueing: true,
    customLogbookExports: true,
    priceNgnPerMonth: 12000,
  },
};
