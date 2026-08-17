-- ====================================================================
-- FM Roster - Migration 56: backfill min_african_literature_pct on the
-- WACP Fellowship Dissertation template's proposal_rubric
-- ====================================================================
-- PREREQUISITE: migrations 01-55 already applied.
--
-- WHY: this migration exists to preserve identical rubricEngine.ts behavior
-- while removing a hardcoded organization-name allowlist
-- (`AFRICAN_LITERATURE_ORGS = new Set(['WACP', 'NPMCN'])`) from that file,
-- per docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md working rule 9 ("never
-- hard-code a use case into a module") — see docs/LIVING_SYSTEM_GAP_AUDIT.md's
-- addendum, §8.1 finding.
--
-- The African-literature-percentage citation check should be driven by
-- whether a template's OWN proposal_rubric configures
-- `min_african_literature_pct`, not by matching the template's
-- organization_or_body against a literal code-level set. Every template
-- that needs this check already carries the field EXCEPT ONE:
-- "WACP Fellowship Dissertation (v4.1, Aug 2022)" (organization_or_body =
-- 'WACP', id 4052ae57-469a-44d6-aeaf-29a30efff2f7) has an entirely empty
-- proposal_rubric ({}), relying only on the org-name match to trigger the
-- check with the code's DEFAULT_AFRICAN_LITERATURE_MIN_PCT (25) fallback.
--
-- Verified via a direct before/after comparison against all 5 live
-- casebook_templates and all 13 live research_templates rows
-- (.tmp-rubric-verify.cjs, run and discarded, not committed): every other
-- template produces byte-identical validateCitationSyntax()/
-- summarizeRubricScore() output under the new template-data-driven logic.
-- This dissertation template was the single exception, and only for this
-- one field - its sections/title_max_words were already empty/defaulted
-- before this change too, which is a pre-existing gap (no real WACP
-- dissertation rubric content has been supplied) left untouched here,
-- out of scope for this migration.
--
-- Sets it to the same 25% its sibling "WACP Family Medicine Proposal
-- (v5.0, May 2025)" template already has explicitly, restoring identical
-- rubric-engine output post-refactor. Re-verified after applying: 0
-- mismatches across all live templates.
-- ====================================================================

UPDATE research_templates
SET proposal_rubric = proposal_rubric || '{"min_african_literature_pct": 25}'::jsonb
WHERE id = '4052ae57-469a-44d6-aeaf-29a30efff2f7'
  AND organization_or_body = 'WACP'
  AND NOT (proposal_rubric ? 'min_african_literature_pct');

-- ====================================================================
-- END OF MIGRATION 56
-- ====================================================================
