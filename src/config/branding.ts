// PrivyDoc ecosystem brand metadata — the single source of truth for
// user-facing product naming (Navbar, footer, document title, login views).
//
// Two brand profiles exist:
//   - B2C / Independent Doctor  → "PrivyDoc Medical Workspace"
//     (served from the doc.privydoc.com.ng subdomain)
//   - B2B Institutional Tenant  → "PrivyDoc Workspace — <tenant org name>"
//     (the current UCH Family Medicine deployment, and any future tenant)
//
// This complements — not replaces — the tenant terminology system in
// src/lib/terminology.tsx: terminology.tsx handles ROLE vocabulary
// ("Resident", "Chief Resident", "Rotation"...) per tenant, while this file
// handles PRODUCT branding. Role words are deliberately untouched here.
//
// NOTE: brand selection is hostname-based and purely cosmetic. It is NOT a
// tenant-isolation or auth boundary (see CLAUDE.md Security Notes — tenant
// isolation in this app is client-enforced only).

export interface BrandProfile {
  /** Stable key for the profile. */
  key: 'b2c_independent' | 'b2b_institutional';
  /** Full product name, e.g. shown in the browser tab. */
  productName: string;
  /** Short product name for tight UI spots. */
  shortName: string;
  /** Two-letter mark for the square logo badge. */
  logoInitials: string;
  /** Secondary line under the logo (org / audience label). */
  orgLabel: string;
  /** Footer copyright holder. */
  copyrightHolder: string;
}

export const B2C_INDEPENDENT_BRAND: BrandProfile = {
  key: 'b2c_independent',
  productName: 'PrivyDoc Medical Workspace',
  shortName: 'PrivyDoc Workspace',
  logoInitials: 'PD',
  orgLabel: 'PrivyDoc Practice OS',
  copyrightHolder: 'PrivyDoc',
};

export const B2B_UCH_BRAND: BrandProfile = {
  key: 'b2b_institutional',
  productName: 'PrivyDoc Workspace — UCH Family Medicine',
  shortName: 'PrivyDoc Workspace',
  logoInitials: 'PD',
  orgLabel: 'UCH Family Medicine',
  copyrightHolder: 'PrivyDoc — UCH Family Medicine',
};

/** Canonical B2C subdomain for the independent-doctor workspace. */
export const B2C_HOSTNAME = 'doc.privydoc.com.ng';

/** Canonical B2B subdomain for the departmental/institutional workspace. */
export const B2B_HOSTNAME = 'workspace.privydoc.com.ng';

/**
 * Resolve the active brand from a hostname. `doc.privydoc.com.ng` (and any
 * `doc.*` subdomain of privydoc.com.ng, e.g. a staging `doc.staging...`)
 * serves the B2C independent-doctor brand. `workspace.privydoc.com.ng` is
 * the canonical departmental/institutional host — matched explicitly so the
 * dual-hostname contract is stated in code, even though the fallthrough
 * default would produce the same B2B profile; every other host — including
 * localhost and the current single-tenant deployment — also gets the B2B
 * UCH tenant brand, which matches today's single-tenant reality.
 */
export function resolveBrandForHostname(hostname: string): BrandProfile {
  const h = hostname.toLowerCase();
  if (h === B2C_HOSTNAME || (h.startsWith('doc.') && h.endsWith('privydoc.com.ng'))) {
    return B2C_INDEPENDENT_BRAND;
  }
  if (h === B2B_HOSTNAME || (h.startsWith('workspace.') && h.endsWith('privydoc.com.ng'))) {
    return B2B_UCH_BRAND;
  }
  return B2B_UCH_BRAND;
}

/** The brand active for the current browser session. */
export function getActiveBrand(): BrandProfile {
  if (typeof window === 'undefined') return B2B_UCH_BRAND;
  return resolveBrandForHostname(window.location.hostname);
}
