// Tenant-configurable roster section PRESENTATION only (migration 74) —
// display label / short label / display order / accent color / icon.
// Deliberately NOT business logic: nothing here matches assignments,
// resolves identity, or gates access — it only decides how an already-
// resolved roster section is LABELED/ORDERED/COLORED on screen. Reused by
// every surface that shows a roster section (Full Roster, My Assignment,
// Chief/Admin roster config UI) so there is exactly one label map in this
// app, not one per component.
//
// `section_key` is a small, fixed, STABLE internal identifier set — the
// same 4 keys already implicit in combined_master_rosters' own column
// names (gop_clinic_grid/emergency_call_grid/supervision_grid/
// satellite_grid) and in FullRosterView.tsx's RosterSection.key (migration
// 73). This is structural, not UCH-specific vocabulary — a different
// tenant only changes the presentation values below, never this key set.

export type RosterSectionKey = 'gop' | 'emergency' | 'supervision' | 'satellite';

export const ROSTER_SECTION_KEYS: RosterSectionKey[] = ['gop', 'emergency', 'supervision', 'satellite'];

// Small, bounded set of icon NAME strings a Chief/Admin can choose from
// (migration 74's optional `icon` field). Kept here as plain strings (no
// UI-library import in this shared lib) so both the Chief config UI and
// FullRosterView's own icon-component lookup can share one authoritative
// list — FullRosterView.tsx's ICON_MAP keys must stay in sync with this.
export const ROSTER_SECTION_ICON_NAMES = ['Table2', 'Stethoscope', 'ShieldCheck', 'MapPin', 'Clock', 'Users'] as const;

export interface RosterSectionPresentation {
  section_key: RosterSectionKey;
  display_label: string;
  short_label: string | null;
  display_order: number;
  // Presentation metadata ONLY — never consulted by any matching/
  // business logic. A missing or invalid value is simply null; every
  // consumer must render correctly (textual label still visible) with no
  // color/icon present.
  accent_color: string | null;
  icon: string | null;
}

// Mirrors migration 74's _roster_section_fallbacks() SQL function
// exactly — "today's current behavior," i.e. the same fixed strings
// already used by resident_get_current_assignment()'s grid_label
// (migrations 67-72) and FullRosterView.tsx's pre-migration-74 label
// constants. Used client-side so a session that hasn't loaded live
// config yet (or whose RPC call fails) still renders exactly as before —
// keep in sync with the SQL function if either changes.
export const ROSTER_SECTION_FALLBACKS: Record<RosterSectionKey, RosterSectionPresentation> = {
  gop: { section_key: 'gop', display_label: 'GOP Clinic Grid', short_label: 'GOP', display_order: 1, accent_color: null, icon: null },
  emergency: { section_key: 'emergency', display_label: 'A&E Emergency Grid', short_label: 'A&E', display_order: 2, accent_color: null, icon: null },
  supervision: { section_key: 'supervision', display_label: 'Supervision Grid', short_label: 'Supervision', display_order: 3, accent_color: null, icon: null },
  satellite: { section_key: 'satellite', display_label: 'Satellite Grid', short_label: 'Satellite', display_order: 4, accent_color: null, icon: null },
};

// resident_get_current_assignment() (migrations 67-72) is explicitly NOT
// touched by this slice — assignment matching, assignment_detail,
// credential semantics, tenant matching, and its migration-70/71/72
// behavior all remain unchanged. That RPC still returns a FIXED
// grid_label string per matched slot (e.g. "GOP Clinic Grid"). This is
// the one bridging lookup that maps that pre-existing fixed string back
// to the stable section_key, so My Assignment can resolve tenant-
// configured presentation for a grid it already identifies, without any
// change to the RPC that names it.
export const GRID_LABEL_TO_SECTION_KEY: Record<string, RosterSectionKey> = {
  'GOP Clinic Grid': 'gop',
  'A&E Emergency Grid': 'emergency',
  'Supervision Grid': 'supervision',
  'Satellite Grid': 'satellite',
};

// One resolver, reused everywhere a roster section is rendered. Safe with
// no tenantConfig at all (loading state / RPC not yet called), an empty
// array (tenant has no configuration), or a fully-resolved list (the
// normal case — both resolver RPCs already apply their own fallback
// server-side, so this is mostly a lookup + a client-side safety net,
// not a second fallback authority).
export function resolveRosterSectionPresentation(
  sectionKey: RosterSectionKey,
  tenantConfig?: RosterSectionPresentation[] | null
): RosterSectionPresentation {
  const fallback = ROSTER_SECTION_FALLBACKS[sectionKey];
  const configured = tenantConfig?.find((c) => c.section_key === sectionKey);
  if (!configured) return fallback;
  return {
    section_key: sectionKey,
    display_label: configured.display_label || fallback.display_label,
    short_label: configured.short_label || fallback.short_label,
    display_order: configured.display_order ?? fallback.display_order,
    accent_color: configured.accent_color || null,
    icon: configured.icon || null,
  };
}
