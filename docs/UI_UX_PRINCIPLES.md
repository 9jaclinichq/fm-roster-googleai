# UI/UX Principles

Durable design constraints for PrivyDoc Workspace. This is not a redesign brief
and not a screen-by-screen implementation spec.

## Product Fit

PrivyDoc Workspace is an operational professional workspace for doctors,
doctor-led organizations, and individual doctors. Interfaces should feel clear,
quiet, dense enough for repeated work, and optimized for scanning and action.

## Tenant-Neutral First

Pre-login UI must be neutral until a tenant is selected or a user signs in.
Tenant-specific names, roles, colors, terminology, and institutional labels
belong to tenant configuration and session-aware rendering.

## One Responsive Tree

Use one responsive component tree across mobile, tablet, and desktop. Do not
fork separate mobile and desktop products. Components must reflow predictably,
with stable dimensions for fixed-format tools such as grids, counters,
toolbars, and tiles.

## Module Language

Module UI should describe capabilities, not one organization's workflow. Use
configurable instance labels for local workflows. Avoid hardcoding hospital,
residency, WACP/NPMCN, grade, role, or tenant vocabulary unless it is seed
content, fallback terminology, or explicitly scoped domain content.

## Interaction Patterns

- Use icons for common actions when an established icon exists.
- Use segmented controls for modes, tabs for views, toggles for binary states,
  sliders/inputs for numeric values, and menus for option sets.
- Keep cards for repeated items, modals, and genuinely framed tools.
- Do not nest cards inside cards.
- Keep text readable and fitting within its parent at all viewport sizes.

## Visual Restraint

Avoid decorative layouts that make operational workflows harder to scan. Do not
introduce single-hue monotony, oversized marketing hero patterns, decorative
orbs/blobs, or screen redesigns during bounded engineering slices.

## Verification

Any UI behavior change needs browser verification across representative desktop
and mobile widths, including console checks and route reload checks when session
state is involved.
