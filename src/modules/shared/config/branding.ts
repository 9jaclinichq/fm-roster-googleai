// PrivyDoc ecosystem brand metadata — the single source of truth for
// user-facing product naming (Navbar, footer, document title, login views).
//
// Two brand profiles exist:
//   - B2C / Independent Doctor  → "PrivyDoc Medical Workspace"
//     (shown for an unlinked individual-doctor session — see getFooterBrand)
//   - B2B Institutional Tenant  → "PrivyDoc Workspace"
//     (the tenant's configured organisation label is rendered separately)
//
// Domain-based branching was removed per 2026-08-14 UX review: the product
// no longer serves a separate doc.privydoc.com.ng subdomain — everything
// lives at workspace.privydoc.com.ng, and the org-vs-individual split
// happens at /login (AuthLandingView) instead of via hostname. getActiveBrand()
// now always resolves the B2B/institutional profile; getFooterBrand's
// session-aware split (institutional vs. individual-doctor) is unaffected —
// it never depended on hostname to begin with.
//
// This complements — not replaces — the tenant terminology system in
// src/modules/shared/terminology.tsx: terminology.tsx handles ROLE vocabulary
// ("Resident", "Chief Resident", "Rotation"...) per tenant, while this file
// handles PRODUCT branding. Role words are deliberately untouched here.
//
// NOTE: brand selection is cosmetic only. It is NOT a tenant-isolation or
// auth boundary (see CLAUDE.md Security Notes — tenant isolation in this
// app is client-enforced only).

export interface BrandProfile {
  /** Stable key for the profile. */
  key: 'b2c_independent' | 'b2b_institutional' | 'neutral';
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

export const B2B_INSTITUTIONAL_BRAND: BrandProfile = {
  key: 'b2b_institutional',
  productName: 'PrivyDoc Workspace',
  shortName: 'PrivyDoc Workspace',
  logoInitials: 'PD',
  orgLabel: 'Organisation',
  copyrightHolder: 'PrivyDoc Workspace',
};

/**
 * No-session fallback for getFooterBrand() — nobody is signed in yet, so
 * there is no organization or individual name to show. Deliberately
 * carries neither an org name nor a personal-practice label, unlike either
 * real profile above.
 */
export const NEUTRAL_BRAND: BrandProfile = {
  key: 'neutral',
  productName: 'PrivyDoc Workspace',
  shortName: 'PrivyDoc Workspace',
  logoInitials: 'PD',
  orgLabel: '',
  copyrightHolder: 'PrivyDoc Workspace',
};

/**
 * The brand active for session-agnostic UI (Navbar logo, tab title, login
 * screen chrome pre-authentication). It is intentionally tenant-neutral;
 * tenant identity is rendered from configuration after selection.
 */
export function getActiveBrand(): BrandProfile {
  return B2B_INSTITUTIONAL_BRAND;
}

/**
 * Session-aware brand for the footer only (review annotation: "before it
 * labels the footer the organisation or a personal login" — the footer
 * should reflect who's actually signed in). Every other brand-driven
 * surface (Navbar, login screens, tab title) intentionally keeps using the
 * tenant-neutral getActiveBrand() — this is a narrower, session-aware variant for
 * the one spot the review flagged, not a replacement.
 *
 * Precedence: an institutional membership session (including a doctor
 * account linked to a workforce row, migration 18) is
 * always org-branded. An authenticated-but-unlinked individual doctor is
 * always personally-branded. With no session at all (pre-login screens, or
 * after logout), falls back to NEUTRAL_BRAND — there is no org or personal
 * name to show yet, so the footer reads just "PrivyDoc Workspace".
 */
export function getFooterBrand(session: {
  hasInstitutionalSession: boolean;
  hasIndividualDoctorSession: boolean;
}): BrandProfile {
  if (session.hasInstitutionalSession) return B2B_INSTITUTIONAL_BRAND;
  if (session.hasIndividualDoctorSession) return B2C_INDEPENDENT_BRAND;
  return NEUTRAL_BRAND;
}
