-- ====================================================================
-- FM Roster - Migration 43: Seed generic research/audit/publication/
-- grant + casebook templates (Living-System spec §8.2)
-- ====================================================================
-- PREREQUISITE: migrations 01-40 already applied. Numbers 41 and 42 are
-- reserved for sibling streams (the Scored Rubric primitive and another
-- parallel effort) and are NOT touched or assumed present here.
--
-- SCOPE
-- -----
-- docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §8.2 ("Research & academic
-- tracks") asks for generic, specialty-agnostic seed templates beyond the
-- 9 research_templates + 4 casebook_templates rows already seeded by
-- migrations 13/15:
--   - "Generic audit / QI project track, generic publication track,
--     generic grant track -- staged, lighter-weight versions of the
--     same pattern."
--   - "Case-based portfolio / casebook... Individual clinical case
--     template... Case-selection guide... plus an optional case-mix
--     planner."
--
-- This migration ONLY adds seed rows to the two EXISTING tables
-- (research_templates, casebook_templates) using their established
-- global-seed convention (tenant_id IS NULL, created_by_workforce_id IS
-- NULL). No schema change, no new table, no application code touched.
-- Every label/prompt/example below is deliberately specialty- and
-- college-agnostic (per the task's explicit boundary) -- none of this is
-- WACP/NPMCN-specific content, and none of it is Dr. Olanipekun's real
-- in-progress dissertation/casebook data (see docs §8.3, which is
-- explicitly out of scope for this migration).
--
-- JUDGMENT CALL 1 -- Scored Rubric primitive (migration 41) not
-- referenced. At the time this migration was written, this worktree's
-- supabase/migrations/ only goes up to 40_doctor_personal_forms.sql --
-- 41_scored_rubric_primitive.sql (rubric_templates/rubric_sections/
-- rubric_items/rubric_instances) is not present. Per this task's own
-- fallback instruction, the "generic scored-rubric templates" bullet in
-- §8.2 (proposal assessment, full-work assessment, OSCE/skills sign-off,
-- credentialing/audit checklist, peer-review form) is SKIPPED here and
-- flagged as a followup once that primitive lands and is visible in a
-- worktree -- inventing a parallel copy of those tables here would
-- duplicate/collide with that sibling stream's work.
--
-- JUDGMENT CALL 2 -- organization_or_body for the 3 new research_templates
-- rows. research_templates.organization_or_body has a fixed CHECK list
-- ('WACP', 'NPMCN', 'ICMJE', 'CONSORT', 'STROBE', 'PRISMA', 'CARE',
-- 'University_Thesis', 'Custom_Doctor') with no QI/publication/grant-
-- specific value, and none of those existing values fit a generic,
-- college-agnostic audit/QI, publication, or grant track. Widening the
-- CHECK constraint for 3 seed rows felt like schema churn for what is
-- really just a naming/categorization need, not a new organizational
-- body -- so all 3 new rows use 'Custom_Doctor' (already the enum's own
-- "generic/unaffiliated" bucket) with a distinguishing, descriptive
-- `name` instead. If a future need arises to filter/group by track type
-- specifically (not just by name), a dedicated `track_kind` column would
-- be the cleaner fix over further CHECK-widening.
--
-- JUDGMENT CALL 3 -- "staged, lighter-weight" realized as: the audit/QI
-- track gets both a proposal_rubric (audit protocol stage) and a
-- dissertation_rubric (final audit report stage, reusing the same
-- proposal + ch1_intro..ch5_discussion slots research_chapters already
-- enforces via its own CHECK constraint -- there is no separate schema
-- for a QI report's stages, so it rides the same fixed chapter slots
-- every other staged template uses, just with lighter word-count caps).
-- The publication and grant tracks are modeled as single-stage (proposal
-- only, dissertation_rubric left '{}'), mirroring the existing lighter
-- ICMJE/STROBE/CONSORT/PRISMA/CARE rows from migration 13, which are
-- manuscript/protocol-shaped rather than full-dissertation-shaped.
--
-- JUDGMENT CALL 4 -- "individual clinical case template" and "case-
-- selection guide" (with optional case-mix planner) do NOT get their own
-- casebook_templates rows. casebook_templates is a whole-portfolio
-- framework table (framework_type + thematic_distribution/scoring_rubric/
-- formatting_rules describing a multi-case container) -- a bare "how to
-- write up one case" template or a "how to pick a case" prompt list isn't
-- itself a framework a casebook_workspace could sensibly set as its
-- template_id. Rather than force a bad fit (a fake framework row that
-- doesn't actually describe a portfolio) or invent a new table this task
-- was told not to add, both are folded as structured, genuinely-used
-- content into ONE new generic portfolio row's existing jsonb columns,
-- which already exist for exactly this purpose:
--   - thematic_distribution already models "spread of cases by theme"
--     for the existing WACP/NPMCN 15-Casebook rows (total_cases/
--     min_specialties/max_specialties) -- the case-mix planner is the
--     same shape, generalized and left theme-open (no fixed specialty
--     list), so it lives here as `case_mix_planner`.
--   - formatting_rules already models "how an individual case should be
--     written/formatted" for every existing row (vancouver_references_
--     required, no_figures_starting_sentences, bold_headings) -- the
--     individual clinical case template's section order
--     (`case_write_up_structure`) and the case-selection guide's prompt
--     set (`case_selection_guide`) are the same kind of per-case
--     guidance, just more detailed, so they live here too.
-- The section order used for `case_write_up_structure` (presenting
-- complaint -> history -> examination -> diagnosis -> management ->
-- follow-up) is standard, generic medical documentation convention, not
-- any one college's proprietary rubric -- consistent with this task's own
-- note that this structure does not trigger the "ask before fabricating
-- authoritative content" rule.
-- ====================================================================

-- --------------------------------------------------
-- 1. GENERIC RESEARCH TRACKS (research_templates, migration 13's table)
-- --------------------------------------------------

INSERT INTO research_templates (name, is_public, organization_or_body, specialty, study_design, referencing_style, proposal_rubric, dissertation_rubric, word_count_limits)
SELECT * FROM (VALUES
  (
    'Generic Audit / Quality Improvement (QI) Project Track',
    true, 'Custom_Doctor', NULL, NULL, 'vancouver',
    '{"title_max_words": 20, "sections": {"background_and_problem": 20, "standard_or_target_criteria": 15, "baseline_data_methodology": 25, "proposed_intervention": 20, "re_audit_and_evaluation_plan": 20}}'::jsonb,
    '{"sections": {"ch1_intro": 15, "ch2_lit_review": 15, "ch3_methods": 25, "ch4_results": 25, "ch5_discussion": 20}}'::jsonb,
    '{"proposal_title": 20, "proposal_total": 1200, "ch1_intro": 800, "ch2_lit_review": 800, "ch3_methods": 1000, "ch4_results": 1000, "ch5_discussion": 1000}'::jsonb
  ),
  (
    'Generic Publication / Journal Manuscript Track',
    true, 'Custom_Doctor', NULL, NULL, 'vancouver',
    '{"title_max_words": 20, "sections": {"title_and_abstract": 10, "introduction": 15, "methods": 30, "results": 25, "discussion": 20}}'::jsonb,
    '{}'::jsonb,
    '{"proposal_title": 20, "proposal_total": 3500}'::jsonb
  ),
  (
    'Generic Research Grant Proposal Track',
    true, 'Custom_Doctor', NULL, NULL, 'vancouver',
    '{"title_max_words": 20, "sections": {"problem_statement_and_significance": 20, "specific_aims_or_objectives": 15, "methodology_and_approach": 30, "budget_and_timeline": 20, "evaluation_and_impact_plan": 15}}'::jsonb,
    '{}'::jsonb,
    '{"proposal_title": 20, "proposal_total": 2500}'::jsonb
  )
) AS seed(name, is_public, organization_or_body, specialty, study_design, referencing_style, proposal_rubric, dissertation_rubric, word_count_limits)
WHERE NOT EXISTS (SELECT 1 FROM research_templates rt WHERE rt.name = seed.name AND rt.tenant_id IS NULL);

-- --------------------------------------------------
-- 2. GENERIC CASE-BASED PORTFOLIO (casebook_templates, migration 15's
--    table) -- bundles the case-based portfolio, individual clinical
--    case template, and case-selection guide + case-mix planner into one
--    row, per Judgment Call 4 above.
-- --------------------------------------------------

INSERT INTO casebook_templates (name, framework_type, thematic_distribution, scoring_rubric, formatting_rules)
SELECT * FROM (VALUES
  (
    'Generic Case-Based Portfolio (Specialty-Agnostic)',
    'CUSTOM_CLINICAL',
    '{"case_mix_planner": {"description": "Optional table of theme vs. case count, for any organisation or individual that wants to track the spread of cases across domains. Themes are fully custom-labelled -- no fixed specialty list is assumed.", "total_cases_target": null, "themes": {}}}'::jsonb,
    '{"domains": {"relevance_and_rationale_for_case_selection": 10, "clinical_reasoning_and_diagnostic_accuracy": 20, "evidence_based_management": 15, "psychosocial_and_contextual_factors": 15, "communication_and_professionalism": 10, "discussion_and_learning_points": 15, "references_and_evidence_base": 10, "presentation_and_formatting": 5}}'::jsonb,
    '{"vancouver_references_required": true, "no_figures_starting_sentences": true, "bold_headings": true, "case_write_up_structure": {"description": "Generic section order for an individual case write-up. Usable for any specialty, training programme, or case-based learning requirement -- not specific to one college or discipline.", "sections": ["presenting_complaint", "history_of_presenting_complaint", "review_of_systems", "past_medical_and_surgical_history", "drug_and_allergy_history", "family_and_social_history", "examination_by_system", "provisional_and_differential_diagnosis", "management_plan", "dated_follow_up_entries"]}, "case_selection_guide": {"description": "Short structured prompt set to help a candidate justify and select a case for the portfolio.", "prompts": ["Why was this patient/case selected?", "What clinical area or theme does this case represent?", "What evidence guided the intervention or management decision?", "What family or social context shaped the case?", "What was the patient''s illness experience or perspective?", "Which discipline-specific tools were relevant (e.g. structured assessment tools, scoring systems)?", "What interventions were undertaken and why?"]}}'::jsonb
  )
) AS seed(name, framework_type, thematic_distribution, scoring_rubric, formatting_rules)
WHERE NOT EXISTS (SELECT 1 FROM casebook_templates ct WHERE ct.name = seed.name AND ct.tenant_id IS NULL);

-- ====================================================================
-- END OF MIGRATION 43
-- ====================================================================
