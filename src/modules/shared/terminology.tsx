import React, { createContext, useContext, useEffect, useState } from 'react';
import { databaseService, DEFAULT_TENANT_ID } from '../../lib/databaseService';

// Tenant-configurable vocabulary so the same underlying schema/UI can serve
// a residency program, a university department, or another hierarchy
// without a code-level rename — see migration 11's header for why a full
// find-and-replace rename was rejected in favor of this.
//
// SCOPE (updated 2026-08-15 — this note was stale): TerminologyProvider is
// now mounted with the ACTUAL active session's tenantId (see App.tsx's
// activeTenantId, computed from currentResident.tenant_id / the Chief's
// fm_chief_tenant_id) rather than being pinned to DEFAULT_TENANT_ID
// regardless of who's logged in — that was a real bug once per-tenant Chief
// codes and self-serve org creation became real (migrations 23/24), fixed
// alongside this retrofit pass. useTerminology() now covers every
// user-facing "Resident"/"Chief Resident" label in the main login flow
// (AuthLandingView, ResidentLoginView, ChiefLoginView), the primary nav
// (Navbar), the Chief dashboard's headers/tabs/table/CSV export/toasts
// (ChiefDashboardView), the roster HITL editor (MultiRosterManagerView),
// and the co-resident/consultant review flow (ConsultantReviewView,
// GuestReviewView). NOT covered, deliberately: DevHelper.tsx (dev-only,
// never rendered in production — see App.tsx's import.meta.env.DEV guard)
// and internal identifiers/comments/variable names throughout the codebase
// (e.g. `currentResident`, `ResidentSession`) — renaming those has no
// user-facing effect and would just be code churn. Live-verified end-to-end
// by temporarily setting a real terminology_overrides value on the UCH
// tenant and confirming every retrofitted surface picked it up, then
// reverting — see this pass's commit for the exact verification.

export const TERMINOLOGY_DEFAULTS: Record<string, string> = {
  org_name: 'Family Medicine, UCH Ibadan',
  member: 'Resident',
  members: 'Residents',
  admin: 'Chief Resident',
  senior_reviewer: 'Consultant',
  rotation: 'Rotation',
  dissertation: 'Dissertation',
  case_report: 'Case Report',
  viva: 'Viva',
  collection_cycle: 'Collection Cycle',
};

interface TerminologyContextValue {
  t: (key: keyof typeof TERMINOLOGY_DEFAULTS | string, fallback?: string) => string;
  loading: boolean;
  tenantId: string;
}

const TerminologyContext = createContext<TerminologyContextValue>({
  t: (key, fallback) => fallback || TERMINOLOGY_DEFAULTS[key] || key,
  loading: true,
  tenantId: DEFAULT_TENANT_ID,
});

// eslint-disable-next-line react-refresh/only-export-components
export function useTerminology() {
  return useContext(TerminologyContext);
}

// tenantId is now passed by App.tsx's MainAppContent from the actual active
// session (see the header note above) — the DEFAULT_TENANT_ID fallback
// below only fires pre-login or for a tenant-less individual-doctor session.
export const TerminologyProvider: React.FC<{ children: React.ReactNode; tenantId?: string }> = ({
  children,
  tenantId = DEFAULT_TENANT_ID,
}) => {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    databaseService
      .getTenant(tenantId)
      .then(tenant => {
        if (!cancelled) setOverrides(tenant?.terminology_overrides || {});
      })
      .catch(err => console.warn('Failed to load tenant terminology, using defaults:', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const t = (key: string, fallback?: string) => overrides[key] || fallback || TERMINOLOGY_DEFAULTS[key] || key;

  return (
    <TerminologyContext.Provider value={{ t, loading, tenantId }}>
      {children}
    </TerminologyContext.Provider>
  );
};
