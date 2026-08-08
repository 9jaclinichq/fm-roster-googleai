import React, { createContext, useContext, useEffect, useState } from 'react';
import { databaseService, DEFAULT_TENANT_ID } from './databaseService';

// Tenant-configurable vocabulary so the same underlying schema/UI can serve
// a residency program, a university department, or another hierarchy
// without a code-level rename — see migration 11's header for why a full
// find-and-replace rename was rejected in favor of this.
//
// SCOPE: this provider and hook are real and functional, but only applied
// to the NEW components built in this pass (SaaSOperatorConsoleView,
// TenantCustomizationView, GuestReviewView) as a demonstration. Retrofitting
// every existing component (ChiefDashboardView, ResidentFormView, Navbar,
// etc.) to read through useTerminology() instead of hardcoded strings is a
// separate, larger follow-up task — deliberately not attempted here to
// avoid a huge, error-prone mechanical diff across dozens of files for a
// single-tenant app that has no tenant-switching login yet to exercise it.

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

// No tenant-switching login flow exists yet (see note above), so this
// always loads the single seeded tenant's overrides. Once real per-tenant
// login exists, tenantId should come from session state instead of the
// hardcoded default.
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
