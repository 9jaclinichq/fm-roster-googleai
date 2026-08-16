-- ====================================================================
-- FM Roster - Migration 46: Seed official WACP Family Medicine rubric
-- templates into the Scored Rubric primitive (migration 41)
-- ====================================================================
-- PREREQUISITE: migrations 01-45 already applied, in particular 41
-- (rubric_templates/rubric_sections/rubric_items/rubric_instances).
--
-- CONTEXT: migration 41 shipped the generic Scored Rubric primitive with
-- ZERO real rubric content -- its own header explicitly deferred seeding
-- to "a sibling stream [that] owns generic (non-personal) seed content"
-- pending Dr. Olanipekun supplying the real WACP source documents (see
-- CLAUDE.md's "Sourcing module content" section: don't fabricate
-- authoritative college rubrics, ask for the real ones). This migration
-- closes that gap: it transcribes the three real WACP Faculty of Family
-- Medicine assessment instruments Dr. Olanipekun supplied --
--   1. WACP-FM Proposal Assessment tool-checklist-marking guide, v5.0
--      (May 2025)
--   2. WACP-FM Dissertation Assessment Tool, v4.1 (Aug 2022)
--   3. WACP-FM Casebook/PMR Assessment Tool, v4.0 (Nov 2021)
-- into rubric_templates/rubric_sections/rubric_items rows -- TEMPLATES
-- ONLY. No rubric_instances rows are created by this migration (that
-- table holds real filled-in assessments of real candidates, which is a
-- runtime concern, not seed content).
--
-- NOT APPLIED LIVE: per this task's explicit security boundary, this
-- migration is written but NOT run against the live database. A human
-- (or a separately authorized pass) reviews and applies it.
--
-- OWNERSHIP: all 3 templates are seeded as GLOBAL system templates
-- (tenant_id = NULL, doctor_id = NULL, created_by_workforce_id = NULL,
-- is_system_default = true) -- per migration 41's design note 1, this is
-- a real, valid, distinct ownership state ("available to every tenant and
-- every individual doctor"), appropriate here because these are official
-- West African College of Physicians assessment standards, not any single
-- org's or doctor's private/customized content.
--
-- IDEMPOTENCY: each template is wrapped in `IF NOT EXISTS (SELECT 1 FROM
-- rubric_templates WHERE name = '<exact name>')` so a re-run of this file
-- is a no-op once the templates exist. Section/item ids are captured into
-- plpgsql variables at insert time (via a fresh gen_random_uuid() per
-- row) rather than computed via a WITH...RETURNING chain, purely for
-- readability across ~90 child rows -- functionally equivalent.
--
-- TRANSCRIPTION FIDELITY -- read before trusting any single number below:
-- every item label/point-range/guidance note is transcribed directly from
-- the 3 source PDFs, not invented or "cleaned up" to make the arithmetic
-- prettier. Several places where the source documents' own numbers don't
-- cleanly reconcile are transcribed AS WRITTEN and flagged both here and
-- in this migration's own task report -- see the specific notes inline
-- at each affected section below:
--   (a) Template 1, Section "Method": the document labels 12 line items
--       (i-xii) but its own printed denominator for the section average
--       is "/11", not "/12". The most likely reason: item vi (Sampling
--       technique -- explicitly "Non-experimental studies" only) and
--       item viii (Randomization -- explicitly "Experimental studies"
--       only) are mutually exclusive for any single proposal, so only 11
--       of the 12 printed items are ever actually scorable on one
--       proposal. Transcribed as 12 rubric_items (all printed criteria
--       preserved); pass_threshold computed off the document's own "/11"
--       divisor (11 * 2 = 22), not 12 * 2 = 24.
--   (b) Template 2, Chapter 1: the section is printed as "/70 or 80" with
--       "7 or 8" items, because item iv (Hypothesis) is explicitly
--       conditional ("Score this sub-section ONLY when it is indicated in
--       the research design"). Transcribed as 8 rubric_items (the ceiling
--       case); max_points/pass_threshold use the 80/40 ceiling values,
--       with the 70/35 non-hypothesis variant noted in pass_logic and in
--       item iv's own guidance_text.
--   (c) Template 2, Chapter 3 (Methods): the document's own summary line
--       says "All nine (9) items must be attempted" directly under a
--       table that prints 11 items (i-xi). This is a genuine error in the
--       source document itself (not a transcription artifact on this
--       migration's part) -- transcribed as all 11 printed items,
--       all_items_required = true (matching the stated rule), with the
--       "nine" vs "eleven" mismatch preserved verbatim in a SQL comment
--       rather than silently "corrected" to 9 or 11.
--   (d) Template 2 overall: the holistic final-mark bands (Full Pass
--       52-54, Provisional Pass 50-51, Referred 46-48, Rejected 40) do
--       NOT numerically reconcile with the sum of the 9 sections' own
--       max_points (12+20+10+80+90+110+70+80+10 = 482, using the Ch.1
--       80-point ceiling). Transcribed exactly as printed in both places
--       -- these read as two independent scoring mechanisms on the WACP's
--       own form, not a single formula. Flagged in pass_logic and in this
--       migration's task report; not "fixed" or reconciled here.
--   (e) Template 3, "Per-Case Scoring" section: the task brief that
--       requested this migration described "8 criteria" summing to /100.
--       The actual source document prints 10 distinct scoring criteria
--       (Relevance / Accuracy of diagnostic process & treatment / Accuracy
--       of Treatment and Cost Considerations / Demonstration of Procedural
--       Skills / Psycho-social Determinant of Health / Patient Centered
--       Clinical Method / Discussion / References / Grammar-Punctuation-
--       Spelling-Formatting / Logical Sequencing), each worth 0-10,
--       10 x 10 = 100. Transcribed as the real 10 criteria the document
--       actually contains, not forced down to 8 -- flagged here and in
--       the task report as a correction to the brief, not a deviation
--       from the source document.
--   (f) Template 3, "Preliminary Pages" item 13 ("Headings (Upper case,
--       Size 12, Not bold)"): the source PDF's extracted text shows only
--       a single value "2" in this row (its sibling rows 10-15 all show
--       "0 1 2"), most likely a table-rendering/extraction artifact in
--       the source PDF itself rather than a deliberate 1-point scale.
--       Transcribed with the same 0-2 scale as every sibling formatting
--       item in this section, flagged as a best-faithful-reading
--       assumption rather than a literal "0/1/2 all confirmed" read.
--   (g) Template 3, "Case Defense" section: the source document's defense
--       block is a variable-length list of blank assessor-authored
--       question rows ("Please add more rows if necessary"), each scored
--       0 / 1-4 / 5-7 / 8-10, with a 50%-of-total pass mark applied to
--       whatever total the assessor's actual question set adds up to --
--       there is no fixed criterion text or fixed item count to seed.
--       One representative rubric_item ("Defense question response
--       quality") is seeded to carry the scale/band wording; the
--       variable-question-count structure itself is documented in
--       pass_logic and the item's own guidance_text rather than modeled,
--       since rubric_items has no "repeat N times" concept. A future
--       assessor UI would add one rubric_instance-level score entry per
--       actual question asked, all against this same item definition.
--
-- WHAT THIS DOES NOT DO: no rubric_instances rows (no real assessments
-- seeded); no changes to any other table; no application code touched
-- (a future UI reads rubric_templates/rubric_sections/rubric_items
-- directly, same as every other seed-content migration in this repo).
-- ====================================================================

DO $$
DECLARE
  v_template_id uuid;
  v_section_id uuid;
BEGIN

IF NOT EXISTS (
  SELECT 1 FROM rubric_templates
  WHERE name = 'WACP Family Medicine Proposal Assessment Tool (v5.0, May 2025)'
) THEN
  v_template_id := gen_random_uuid();
  INSERT INTO rubric_templates (id, tenant_id, doctor_id, created_by_workforce_id, name, description, scale_definition, pass_logic, is_system_default)
  VALUES (
    v_template_id, NULL, NULL, NULL,
    'WACP Family Medicine Proposal Assessment Tool (v5.0, May 2025)',
    'West African College of Physicians, Faculty of Family Medicine -- official assessment guide for Fellowship dissertation proposals. Each line item is graded 0 (not done) to 3 (shows expertise). Source: "WACP-FM Proposal Assessment tool-checklist-marking guide- May 2025 version 5.0.pdf".',
    '{"min": 0, "max": 3, "labels": {"0": "Not done", "1": "Needs improvement", "2": "Meets expectation", "3": "Shows expertise"}}'::jsonb,
    '{
      "total_raw_points_possible": 108,
      "final_score_formula": "sum of the 5 raw section totals (max 108), divided by 36, yields a Final Score on the same 0-3 scale as each individual item",
      "final_score_scale": "0-3",
      "pass_rule": "Candidate must score >=2 on the Final Score AND >=2 average in every section for an acceptable proposal to proceed to data collection (i.e. must be corrected to at least \"Meets Expectation\" throughout before proceeding).",
      "recommendation_bands": [
        {"code": "a", "label": "Acceptable -- start data collection, no correction required", "condition": "each section average score >= 2 AND Final Score >= 2"},
        {"code": "b", "label": "Acceptable -- start data collection, but minor corrections required and corrected version submitted", "condition": "each section average score >= 2 AND Final Score >= 2"},
        {"code": "c", "label": "Acceptable subject to major modifications -- candidate must NOT commence data collection; must correct and resubmit", "condition": "overall score < 2 but >= 1"},
        {"code": "d", "label": "Reject -- candidate must submit a fresh proposal", "condition": "overall score < 1"}
      ],
      "return_deadline": "Assessor asked to return within 4 weeks of receipt.",
      "transcription_note": "Method section pass_threshold below is computed off the document''s own printed \"/11\" section divisor (11 items x 2 = 22 minimum), even though 12 line items are printed -- see migration 46 header note (a)."
    }'::jsonb,
    true
  );

  -- Section 1: Title (max 12, 4 items, pass = average >=2 -> raw >= 8)
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Title', 12, 8, false, 1);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Title page follows the WACP proposal and title registration format (Appendix 1).', NULL, 0, 3, 1, 1),
    (v_section_id, 'Title includes PECO(T)/PICO(T) -- Population, Exposure or Intervention, Control or Comparison group, Outcome of interest.', 'Inclusion of study design, if it does not push the title over 25 words, is desirable but not mandatory.', 0, 3, 1, 2),
    (v_section_id, 'Aligns with the research question(s) and hypothesis.', NULL, 0, 3, 1, 3),
    (v_section_id, 'Grammatically correct and brief (<=25 words).', 'If the title needs revision, suggest an alternative on the Comment page.', 0, 3, 1, 4);

  -- Section 2: Introduction & Aims/Objectives (max 45, 15 items, pass = average >=2 -> raw >= 30)
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Introduction & Aims/Objectives', 45, 30, false, 2);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Background and Problem Statement (<500 words)', 'Concise, literature-based, and includes all the major variables of the study leading to the gap to be addressed.', 0, 3, 1, 1),
    (v_section_id, 'Gap to be filled by the study (<100 words)', 'Must go beyond "not previously done at this site". Should come from an identified, relevant gap in existing published manuscripts -- a critically appraised systematic review/meta-analysis is preferred if available; otherwise literature mapping, practice or policy documents. Candidate must state the type of gap (evidence, knowledge, population, methodology, time, practice etc.) and substantiate it with references; the assessor must confirm the gap is correct and justifiable.', 0, 3, 1, 2),
    (v_section_id, 'Justification and Rationale (<250 words)', 'Clearly explains why the study should be done in the proposed population, at this time, by this researcher, at this site, using these methods.', 0, 3, 1, 3),
    (v_section_id, 'Relevance to Family Medicine (<250 words)', 'The study must reflect and translate into Family Medicine care tenets impactful to the West African sub-region, generating patient- and family-oriented evidence.', 0, 3, 1, 4),
    (v_section_id, 'Research question', 'Should be clear, focused, and come naturally from the identified gap -- ideally a single question. Should be balanced and follow the principle of equipoise for experimental/non-experimental studies. Objectives should not be turned into questions.', 0, 3, 1, 5),
    (v_section_id, 'Hypothesis', 'May be a hypothesis to be generated (observational descriptive) or tested (observational analytic/experimental), in line with the research question. Should be stated two-tailed; a one-tailed statement must be justified with appropriate statistics. A purely descriptive study is below the scope of research at this level.', 0, 3, 1, 6),
    (v_section_id, 'Operational definition of terms', 'The precise meaning and measure of major terms/variables in the proposal should be clearly defined.', 0, 3, 1, 7),
    (v_section_id, 'Aim (as part of Aim & Objectives, <200 words)', 'Should align with the research title & question and state the goal of the study.', 0, 3, 1, 8),
    (v_section_id, 'Objectives are Specific', 'Stated clearly and unequivocally; precise and supports only one interpretation.', 0, 3, 1, 9),
    (v_section_id, 'Objectives are Measurable', 'Variables identified can be estimated with quantifiable criteria.', 0, 3, 1, 10),
    (v_section_id, 'Objectives are Achievable', 'Not fewer than 3 but not more than 5 in number, and feasible given the research site, time, scope and budget -- realistic, not impossible.', 0, 3, 1, 11),
    (v_section_id, 'Objectives are Relevant', 'In tandem with the aim and the realities of the study population and the focus of the WACP Faculty of Family Medicine.', 0, 3, 1, 12),
    (v_section_id, 'Objectives are Time bound', 'The study duration should be stated and should not exceed the period allowed for the Fellowship programme.', 0, 3, 1, 13),
    (v_section_id, 'Objectives are Ethical', 'Morally sound and avoid unethical behaviour.', 0, 3, 1, 14),
    (v_section_id, 'Objectives are Recorded and Reproducible by other researchers', NULL, 0, 3, 1, 15);

  -- Section 3: Literature Review (max 9, 3 items, pass = average >=2 -> raw >= 6)
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Literature Review', 9, 6, false, 3);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Briefly reviews the current state of knowledge of the research topic (<1,500 words for the section).', NULL, 0, 3, 1, 1),
    (v_section_id, 'Includes theoretical and conceptual framework of the proposed study.', NULL, 0, 3, 1, 2),
    (v_section_id, 'Concise review of the proposed study instrument(s).', NULL, 0, 3, 1, 3);

  -- Section 4: Method (max 33, 12 printed items; document's own divisor is /11 -- see header note (a))
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Method', 33, 22, false, 4);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Study site', 'Concise, and focused on why the proposed study site is appropriate for the study.', 0, 3, 1, 1),
    (v_section_id, 'Study population', 'Must be in keeping with the population stated in the research gap, question, objectives and title.', 0, 3, 1, 2),
    (v_section_id, 'Study duration', 'Reasonable and within the Fellowship training period.', 0, 3, 1, 3),
    (v_section_id, 'Study design is appropriate for the stated research question and all stated objectives.', 'Cross-sectional, appropriate case-control, cohort, test of diagnostic accuracy, appropriate community-based study, clinical trials, quasi-experimental, mixed-design, or longitudinal studies completable within the Fellowship period are acceptable. Purely descriptive studies in which inferences cannot be made are NOT acceptable.', 0, 3, 1, 4),
    (v_section_id, 'Minimum sample size calculation', 'Right and appropriate formula/approach for the study to be powered to address all stated objectives and avoid Type II error; must be appropriate for the methods and design. If prior-study estimates are unavailable, a pilot should determine them. Prevalence/SD/correlation coefficient used should be appropriate for the dependent/independent variables. Unjustifiable further reduction of the estimated sample size should be avoided.', 0, 3, 1, 5),
    (v_section_id, 'Sampling technique (non-experimental studies)', 'Applicable to non-experimental studies; should be appropriate for the study design and stated objectives. Mutually exclusive with the Randomization item below -- only one applies per proposal (see migration 46 header note (a)).', 0, 3, 1, 6),
    (v_section_id, 'Inclusion and exclusion criteria', 'Reasonable, and allow for validity and generalisability of the results.', 0, 3, 1, 7),
    (v_section_id, 'Randomization (experimental studies)', 'Applicable to experimental studies only; the technique, type, and ratio of randomization should be clearly stated. Mutually exclusive with the Sampling Technique item above (see migration 46 header note (a)).', 0, 3, 1, 8),
    (v_section_id, 'Ethical considerations', 'Sample consent form in simple English, fully explicit per international standards (see Informed Consent Guidelines / Research Ethics & Compliance). Ethical approval and compliance with the Declaration of Helsinki must be stated.', 0, 3, 1, 9),
    (v_section_id, 'Study procedure', 'Means to prevent Type I error and bias must be stated; standard methods/procedures referenced rather than repeated. For experimental studies, allocation/open-label/blinding/concealment methods must be stated, plus adverse-event documentation/management and any interim analysis/stopping rules.', 0, 3, 1, 10),
    (v_section_id, 'Adequacy of data collection', 'Study instrument/questionnaire (if any) must be in the appendix. All data-collection-sheet items must be relevant to the stated objectives; the assessor must look for gaps in data collection relative to each objective.', 0, 3, 1, 11),
    (v_section_id, 'Data Analysis Plan and Dummy Tables', 'Appropriate data management method/medium; analysis method per objective; level of significance and confidence interval; how missing data will be handled; any exploratory analysis; statistical software to be used. Dummy tables for the analysis of each objective must be included.', 0, 3, 1, 12);

  -- Section 5: Formatting & Referencing (max 9, 3 items, pass = average >=2 -> raw >= 6)
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Formatting & Referencing', 9, 6, false, 5);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Proposal is error-free in grammar and punctuation.', NULL, 0, 3, 1, 1),
    (v_section_id, 'Has 15 to 30 references, none older than 10 years, adequately supporting the discussion, in Vancouver style (ICMJE).', NULL, 0, 3, 1, 2),
    (v_section_id, '25% of references are African/West African literature.', NULL, 0, 3, 1, 3);

END IF;

-- ====================================================================
-- TEMPLATE 2: WACP Dissertation Assessment Guide
-- ====================================================================

IF NOT EXISTS (
  SELECT 1 FROM rubric_templates
  WHERE name = 'WACP Family Medicine Dissertation Assessment Guide (v4.1, Aug 2022)'
) THEN
  v_template_id := gen_random_uuid();
  INSERT INTO rubric_templates (id, tenant_id, doctor_id, created_by_workforce_id, name, description, scale_definition, pass_logic, is_system_default)
  VALUES (
    v_template_id, NULL, NULL, NULL,
    'WACP Family Medicine Dissertation Assessment Guide (v4.1, Aug 2022)',
    'West African College of Physicians, Faculty of Family Medicine -- official assessment guide for the completed Fellowship dissertation (80-120 pages, Chapter 1 to end of Chapter 5). Source: "Dissertation Assessment Tool (1).pdf".',
    '{"min": 0, "max": 10, "labels": {"0": "Not done", "1-4": "Needs improvement", "5-7": "Meets expectation", "8-10": "Shows expertise"}, "note": "Formatting/Preliminary Pages/Summary/References sections use narrower per-item point scales -- see each item''s own scale_min/scale_max and guidance_text."}'::jsonb,
    '{
      "dissertation_length_requirement": "80-120 pages of A4 paper, from page 1 of Chapter 1 to the last page of Chapter 5",
      "section_max_points": {"formatting": 12, "preliminary_pages": 20, "summary": 10, "chapter_1_introduction": "70 (7 items, if Hypothesis not applicable) or 80 (8 items, if Hypothesis applicable) -- seeded here using the 80-point/8-item ceiling", "chapter_2_literature_review": 90, "chapter_3_methods": 110, "chapter_4_results": 70, "chapter_5_discussion_conclusion": 80, "references": 10},
      "holistic_final_mark_bands": [
        {"label": "Full Pass", "score_range": "52-54", "condition": "no editorial errors, or only MINOR editorial/typographical errors"},
        {"label": "Provisional Pass", "score_range": "50-51", "condition": "ONLY significant editorial/typographical/minor data-handling errors"},
        {"label": "Referred", "score_range": "46-48", "condition": "MAJOR structural errors and/or data handling/interpretation errors exist"},
        {"label": "Rejected", "score_range": "40", "condition": "write-up does not comply with the approved proposal"}
      ],
      "reconciliation_note": "The holistic final-mark bands above (max ~54) do NOT numerically reconcile with the sum of the 9 sections'' own max_points (482 using the Ch.1 80-point ceiling, or 472 using the 70-point variant). Transcribed exactly as printed in the source document -- these read as two independent scoring mechanisms on the WACP''s own form (a per-section formative checklist vs. a separate holistic pass/fail mark), not a single formula. See migration 46 header note (d). Not reconciled or corrected by this migration.",
      "chapter_all_items_required_rule": "For Chapters 1-5: all items in that chapter must be attempted; any item scoring 0 renders the whole chapter unacceptable (must be corrected and resubmitted).",
      "labelling_convention_for_electronic_copy": "Surname, First Name, Initial of Middle name, exam type (Dissertation = Diss / Casebook = CB), exam month, exam year -- e.g. \"Doe John T Diss Oct2021\" -- sent to fam-med@wac-physicians.org"
    }'::jsonb,
    true
  );

  -- Section 1: Formatting (max 12, pass_threshold 6, items scale 0-2)
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Formatting', 12, 6, false, 1);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Margins (1.5" on the left, 0.5" margin on the right, 1" margin at top and bottom).', NULL, 0, 2, 1, 1),
    (v_section_id, 'Double line spacing (Size 12, Times New Roman).', NULL, 0, 2, 1, 2),
    (v_section_id, 'Headings (Upper case, Size 12, Not bold).', NULL, 0, 2, 1, 3),
    (v_section_id, 'Subheadings (Each word capitalized, Size 12, Not bold).', NULL, 0, 2, 1, 4),
    (v_section_id, 'Sentences do not start with figures.', NULL, 0, 2, 1, 5),
    (v_section_id, 'Illustrative photographs are black and white or colour print, NOT photocopies.', NULL, 0, 2, 1, 6);

  -- Section 2: Preliminary Pages (max 20, pass_threshold 10, items scale 0-2)
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Preliminary Pages', 20, 10, false, 2);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Title page (refer to Appendix 1).', NULL, 0, 2, 1, 1),
    (v_section_id, 'Declaration.', NULL, 0, 2, 1, 2),
    (v_section_id, 'Certification by Supervisors and HOD.', NULL, 0, 2, 1, 3),
    (v_section_id, 'Dedication.', NULL, 0, 2, 1, 4),
    (v_section_id, 'Acknowledgement.', NULL, 0, 2, 1, 5),
    (v_section_id, 'Table of contents.', NULL, 0, 2, 1, 6),
    (v_section_id, 'List of tables.', NULL, 0, 2, 1, 7),
    (v_section_id, 'List of figures.', NULL, 0, 2, 1, 8),
    (v_section_id, 'List of abbreviations and their meanings.', NULL, 0, 2, 1, 9),
    (v_section_id, 'Page numbering in Roman notation.', NULL, 0, 2, 1, 10);

  -- Section 3: Summary (max 10, pass_threshold 6). Per-item point scales are
  -- NOT uniform 0-2 -- see each item's guidance_text for the exact tier values
  -- printed in the source document (this section's rating columns give
  -- different point values per item, unlike every other section).
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Summary', 10, 6, false, 3);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Not more than 500 words.', 'Document''s printed point values for this item: Not done = 0, Needs improvement = 0, Meets expectation = 2 (binary pass/fail, not a 3-tier scale).', 0, 2, 1, 1),
    (v_section_id, 'Structured as background, aim, methods, results and conclusion.', 'Document''s printed point values: Not done = 0, Needs improvement = 0, Meets expectation = 1 (binary pass/fail).', 0, 1, 1, 2),
    (v_section_id, 'The content of the summary reflects the dissertation accurately.', 'Document''s printed point values: Not done = 0, Needs improvement = 2, Meets expectation = 6 (widest-weighted item in this section).', 0, 6, 1, 3),
    (v_section_id, 'Page numbering in Arabic (modern, e.g. 1, 2, 3) notation.', 'Document''s printed point values: Not done = 0, Needs improvement = 0, Meets expectation = 1 (binary pass/fail).', 0, 1, 1, 4);

  -- Section 4: Chapter 1 - Introduction (max 80 ceiling / 8 items when Hypothesis
  -- applies; 70/7 items when it does not -- see header note (b)). all_items_required
  -- = true per the document's own "any item scoring 0 renders the chapter
  -- unacceptable" rule. Expected length: 1,250-1,750 words.
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Chapter 1 - Introduction', 80, 40, true, 4);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Background of the problem is concise, literature-based and includes all major variables of the study leading to the gap addressed.', NULL, 0, 10, 1, 1),
    (v_section_id, 'The Statement of Problem concisely focuses on the global, regional and national public health significance and indicates the gap the dissertation focuses on.', NULL, 0, 10, 1, 2),
    (v_section_id, 'The Research Questions follow naturally to itemize the gaps identified and the question(s) the research will answer.', NULL, 0, 10, 1, 3),
    (v_section_id, 'Hypothesis is in line with the research design/title and, where appropriate, presented in a directional alternate format.', 'CONDITIONAL: only scored when the hypothesis sub-section is indicated in the research design. If not applicable, the section ceiling drops from 80 to 70 points (7 items) and the pass threshold from 40 to 35, per the source document.', 0, 10, 1, 4),
    (v_section_id, 'Justification or Rationale of the Study includes why the proposed research method would answer the identified gap and how findings can be applied.', NULL, 0, 10, 1, 5),
    (v_section_id, 'Relevance to Family Medicine -- how the work benefits the practice of Family Medicine or improves handling of the problem in West Africa.', NULL, 0, 10, 1, 6),
    (v_section_id, 'Aim reflects the variables in the dissertation title and what the researcher hopes to achieve.', NULL, 0, 10, 1, 7),
    (v_section_id, 'Objectives are SMART.', NULL, 0, 10, 1, 8);

  -- Section 5: Chapter 2 - Literature Review (max 90, pass_threshold 45, 9 items,
  -- all_items_required = true. Expected length: 7,500-10,500 words.)
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Chapter 2 - Literature Review', 90, 45, true, 5);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Starts with a review of the current state of knowledge on the research subject.', NULL, 0, 10, 1, 1),
    (v_section_id, 'Review of the Dependent Variable(s), followed by the Independent Variable(s), and the interaction between these.', NULL, 0, 10, 1, 2),
    (v_section_id, 'Theoretical and/or conceptual framework of the study is presented.', NULL, 0, 10, 1, 3),
    (v_section_id, 'The spectrum of issues under each variable is comprehensively addressed.', NULL, 0, 10, 1, 4),
    (v_section_id, 'Demonstrates an appreciation of the influence of confounders and presents these.', NULL, 0, 10, 1, 5),
    (v_section_id, 'Review of relevant tools and measurements.', NULL, 0, 10, 1, 6),
    (v_section_id, 'Demonstrates appreciation of the peculiarities of the research setting that would influence the findings.', NULL, 0, 10, 1, 7),
    (v_section_id, 'Presents all literature reviewed systematically from international, regional, national and local research findings.', NULL, 0, 10, 1, 8),
    (v_section_id, 'Grammatically correct.', 'Should be a global assessment for all sections of the book, not just this chapter.', 0, 10, 1, 9);

  -- Section 6: Chapter 3 - Methods (max 110, pass_threshold 55, 11 printed
  -- items i-xi, all_items_required = true. NOTE: the source document's own
  -- summary line says "All nine (9) items must be attempted" directly beneath
  -- a table that prints 11 items -- a genuine inconsistency in the source
  -- document itself, transcribed as-is per migration 46 header note (c).
  -- Expected length: 2,500-4,000 words.)
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Chapter 3 - Methods', 110, 55, true, 6);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Presents study site.', NULL, 0, 10, 1, 1),
    (v_section_id, 'Describes study design.', NULL, 0, 10, 1, 2),
    (v_section_id, 'Describes study population.', NULL, 0, 10, 1, 3),
    (v_section_id, 'Provides operational definitions of variables of the study.', NULL, 0, 10, 1, 4),
    (v_section_id, 'States inclusion and exclusion criteria.', NULL, 0, 10, 1, 5),
    (v_section_id, 'Displays sample size calculation (right formula for the research design).', NULL, 0, 10, 1, 6),
    (v_section_id, 'Records sampling technique / randomisation procedure.', NULL, 0, 10, 1, 7),
    (v_section_id, 'Describes study procedure.', NULL, 0, 10, 1, 8),
    (v_section_id, 'Describes tools used.', NULL, 0, 10, 1, 9),
    (v_section_id, 'Complies with the ethical considerations as approved by the Institutional Review Board/Ethical Research Committee.', NULL, 0, 10, 1, 10),
    (v_section_id, 'States clearly which statistical analysis was used for each objective.', NULL, 0, 10, 1, 11);

  -- Section 7: Chapter 4 - Results (max 70, pass_threshold 35, 7 items,
  -- all_items_required = true. Expected length: 3,750-6,000 words.)
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Chapter 4 - Results', 70, 35, true, 7);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Results are presented in a structured manner, each section starting with prose before the illustration (tables, figures, charts).', NULL, 0, 10, 1, 1),
    (v_section_id, 'Presents sample description data followed by results for each objective in sequence.', NULL, 0, 10, 1, 2),
    (v_section_id, 'Tables are well presented (fully explanatory title, no gridlines, font size 11, line spacing 1.5, not split across 2 pages, significant findings highlighted, sequentially labelled).', NULL, 0, 10, 1, 3),
    (v_section_id, 'Figures are well presented (appropriate for the variable, fully explanatory title, black & white or colour print, no photocopies, sequentially labelled).', NULL, 0, 10, 1, 4),
    (v_section_id, 'The full data set is presented only once (text, tables or figures); numbers and percentages are accurate.', NULL, 0, 10, 1, 5),
    (v_section_id, 'Relevant and appropriate use of statistics.', NULL, 0, 10, 1, 6),
    (v_section_id, 'Where further inferential statistics are used, they are relevant to the study objectives.', NULL, 0, 10, 1, 7);

  -- Section 8: Chapter 5 - Discussion & Conclusion (max 80, pass_threshold 40,
  -- 8 items, all_items_required = true. Expected length: 5,000-7,500 words.)
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Chapter 5 - Discussion & Conclusion', 80, 40, true, 8);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Summarizes main findings, briefly interpreting results correctly.', NULL, 0, 10, 1, 1),
    (v_section_id, 'Critically relates study results with published literature.', NULL, 0, 10, 1, 2),
    (v_section_id, 'Presents a structured discussion along the study objectives.', NULL, 0, 10, 1, 3),
    (v_section_id, 'Limitations of the study recognize weaknesses of study design, and show grasp of confounders and bias.', NULL, 0, 10, 1, 4),
    (v_section_id, 'Conclusion of the study reflects the research question(s) and objectives.', NULL, 0, 10, 1, 5),
    (v_section_id, 'Conclusions are based on study findings.', NULL, 0, 10, 1, 6),
    (v_section_id, 'Recommendations apply the study findings in the Family Medicine setting.', NULL, 0, 10, 1, 7),
    (v_section_id, 'Recommendation for future studies reflects the limitations identified.', NULL, 0, 10, 1, 8);

  -- Section 9: References (max 10, pass_threshold 7, 5 items, scale 0-2 binary
  -- Not done/Meets expectation -- this section's table has only those two
  -- rating columns, unlike every other section.)
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'References', 10, 7, false, 9);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Presented a minimum of 60 relevant references.', NULL, 0, 2, 1, 1),
    (v_section_id, 'References are less than 10 years old from the date of first examination, except landmark publications (not more than 10 in number).', NULL, 0, 2, 1, 2),
    (v_section_id, 'At least 25% of references are African/West African literature.', NULL, 0, 2, 1, 3),
    (v_section_id, 'All references are cited in Vancouver style, including date of access for online publications.', NULL, 0, 2, 1, 4),
    (v_section_id, 'Not more than 5 justified references from non-peer-reviewed literature.', NULL, 0, 2, 1, 5);

END IF;

-- ====================================================================
-- TEMPLATE 3: WACP Casebook/PMR Assessment Tool
-- ====================================================================
-- Represents the PER-CASE assessment shape (used once per case in a
-- 10-case PMR or 15-case Casebook), NOT a whole-casebook aggregate -- the
-- "Preliminary Pages" section below is scored once for the whole
-- casebook/PMR, but "Per-Case Scoring" and "Case Defense" are each
-- applied once per individual case.

IF NOT EXISTS (
  SELECT 1 FROM rubric_templates
  WHERE name = 'WACP Family Medicine Casebook/PMR Assessment Tool (v4.0, Nov 2021)'
) THEN
  v_template_id := gen_random_uuid();
  INSERT INTO rubric_templates (id, tenant_id, doctor_id, created_by_workforce_id, name, description, scale_definition, pass_logic, is_system_default)
  VALUES (
    v_template_id, NULL, NULL, NULL,
    'WACP Family Medicine Casebook/PMR Assessment Tool (v4.0, Nov 2021)',
    'West African College of Physicians, Faculty of Family Medicine -- official assessment tool for the Patient Management Report (10 PMRs, Membership exam, 2022 curriculum) or Case Book (compilation of 15, Fellowship exam, 2017 curriculum). Covers casebook-wide Preliminary Pages plus a per-case scoring rubric and a per-case defense rubric. Source: "Casebook Assessment Tool Nov_21 V 4.1.pdf" (form itself is labelled Version 4.0, Nov ''21).',
    '{"note": "Scales differ by section -- Preliminary Pages items are mostly 0-2 (a few 0-4/0-3), Per-Case Scoring and Case Defense items are 0-10 (Inadequate 0 / Needs improvement 1-4 / Meets expectation 5-7 / Merits Commendation 8-10). See each item''s own scale_min/scale_max."}'::jsonb,
    '{
      "granularity": "The Per-Case Scoring and Case Defense sections represent a PER-CASE assessment -- apply once per case, across the 10 cases of a PMR or the 15 cases of a Casebook. The Preliminary Pages section is scored once for the whole casebook/PMR.",
      "casebook_length_requirement": "80-120 pages (PMR) or 80-140 pages (Casebook), excluding introductory pages",
      "preliminary_pages_pass_rule": "Must score above 36 out of 41 (\"must score above 36\" -- strictly greater than 36; this template''s pass_threshold is set to 37 to encode that as a >= comparison).",
      "per_case_scoring_max": 100,
      "case_defense_pass_rule": "Total defense score (summed across however many questions the assessor actually asks, each scored 0-10) is converted to a percentage; pass mark is 50%. The source document provides blank, assessor-authored question rows (\"add more rows if necessary\") rather than fixed question text -- see migration 46 header note (g).",
      "per_case_disposition_options": ["Accepted (Minor modification)", "Accepted (Major modification)", "Rejected (To be replaced)"],
      "casebook_vs_pmr_case_count": "PMR = 10 cases; Casebook = 15 cases (\"+5 for Casebook\" on the disposition sign-off sheet)",
      "electronic_copy_naming": "Surname, First Name, Initial of Middle name, exam type (Dissertation = Diss / Casebook = CB), exam month, exam year -- sent to fam-med@wac-physicians.org",
      "correction_to_task_brief": "The task brief that requested this migration described the Per-Case Scoring section as having 8 criteria; the source document actually contains 10 distinct scoring criteria summing to 100 points (10 x 10). Transcribed as the real 10 criteria -- see migration 46 header note (e)."
    }'::jsonb,
    true
  );

  -- Section 1: Preliminary Pages (max 41, "must score above 36" -> pass_threshold
  -- 37 to encode as >=). 18 items. all_items_required = false: the document
  -- states an overall minimum total, not an explicit "every item must be
  -- nonzero" rule (unlike Template 2's chapter sections).
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Preliminary Pages', 41, 37, false, 1);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Title page (no page number on this page).', NULL, 0, 2, 1, 1),
    (v_section_id, 'Declaration.', NULL, 0, 2, 1, 2),
    (v_section_id, 'Certification by Supervisors and HOD page (signatures dated).', NULL, 0, 2, 1, 3),
    (v_section_id, 'Dedication.', NULL, 0, 2, 1, 4),
    (v_section_id, 'Acknowledgement.', NULL, 0, 2, 1, 5),
    (v_section_id, 'Table of contents.', NULL, 0, 2, 1, 6),
    (v_section_id, 'List of cases.', NULL, 0, 2, 1, 7),
    (v_section_id, 'List of abbreviations and their meanings.', NULL, 0, 2, 1, 8),
    (v_section_id, 'Numeration in Roman notation.', NULL, 0, 2, 1, 9),
    (v_section_id, 'Used A4 paper?', 'Conformation with WACP formatting recommendation.', 0, 2, 1, 10),
    (v_section_id, 'Margins (1.5" on the left, 0.5" margin on the right, 1" margin top & bottom)?', NULL, 0, 2, 1, 11),
    (v_section_id, 'Double spacing (size 12, Times New Roman)?', NULL, 0, 2, 1, 12),
    (v_section_id, 'Headings (Upper case, Size 12, Not bold).', 'TRANSCRIPTION NOTE: the source PDF''s extracted text shows only a single point value ("2") in this row, unlike its sibling formatting items which all show 0/1/2 -- most likely a table-rendering artifact in the source PDF. Scored here on the same 0-2 scale as its sibling items as a best-faithful reading; see migration 46 header note (f).', 0, 2, 1, 13),
    (v_section_id, 'Subheadings (size 12, Not bold, each word capitalized)?', NULL, 0, 2, 1, 14),
    (v_section_id, 'Sentences do not start with figures?', NULL, 0, 2, 1, 15),
    (v_section_id, 'Introduction describes the setting(s) of practice with population served and facilities available for diagnosis and management.', 'Document''s printed point values for this item: Not done = 0, Needs improvement = 1, Meets expectation = 4 (wider-weighted item, not the standard 0-2 scale).', 0, 4, 1, 16),
    (v_section_id, 'Conclusion summarizes and captures the lessons learnt and the essence of writing up a compilation of cases in Family Medicine.', 'Document''s printed point values: Not done = 0, Needs improvement = 1, Meets expectation = 4 (wider-weighted item, not the standard 0-2 scale).', 0, 4, 1, 17),
    (v_section_id, 'Spectrum of cases according to the recommended guideline.', 'Document''s printed point values: Not done = 0, Needs improvement = 1, Meets expectation = 3.', 0, 3, 1, 18);

  -- Section 2: Per-Case Scoring (max 100, 10 criteria x 10 points each -- see
  -- header note (e) on the real criterion count vs. the task brief's "8").
  -- Applied once per case. Band wording for each criterion (Inadequate 0 /
  -- Needs improvement 1-4 / Meets expectation 5-7 / Merits Commendation 8-10)
  -- is preserved verbatim in guidance_text.
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Per-Case Scoring', 100, NULL, false, 2);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Relevance not below 2nd level of care.',
      'Inadequate (0): patient managed at a level of care below the competence of a family physician. Needs improvement (1-4): at 2nd level of care but does not demonstrate the competency required of a Family Physician. Meets expectation (5-7): demonstrates the competency required of a Family Physician. Merits Commendation (8-10): germane presentation that expertly demonstrates the skills and attitudes of a Family Physician.',
      0, 10, 1, 1),
    (v_section_id, 'Accuracy of diagnostic process & treatment.',
      'Inadequate (0) / Needs improvement (1-4): symptoms, systems and complications are incompletely explored. Meets expectation (5-7): symptoms, systems & complications are explored leading to correct diagnostic differentials. Merits Commendation (8-10): merges best-practice guidelines in clerkship and diagnostic process.',
      0, 10, 1, 2),
    (v_section_id, 'Accuracy of Treatment and Cost Considerations.',
      'Inadequate (0): treatment is suboptimal/potentially harmful; no consideration of cost implication of medical intervention. Needs improvement (1-4): treatment correct but incomplete in management/prevention-of-complication/adherence domains; cost considerations applied but inadequately reported. Meets expectation (5-7): treatment follows best-practice guidelines with consideration of complications/non-adherence; cost considerations applied and reported. Merits Commendation (8-10): treatment follows best-practice guidelines and incorporates social/structural/cultural considerations of the practice site for optimal outcome, capturing nuances of how cost influences medical decision-making.',
      0, 10, 1, 3),
    (v_section_id, 'Demonstration of Procedural Skills.',
      'Inadequate (0): no evidence of direct hands-on management. Needs improvement (1-4): evidence of hands-on skills but inappropriately reported. Meets expectation (5-7): evidence of hands-on skills in both management and reporting. Merits Commendation (8-10): demonstration of advanced skill set in both management and reporting.',
      0, 10, 1, 4),
    (v_section_id, 'Psycho-social Determinant of Health.',
      'Inadequate (0): failed to identify or apply psychological aspects of patient presentation; case report is culturally insensitive. Needs improvement (1-4): identified/applied but inadequately reported at least one social and one psychological aspect. Meets expectation (5-7): identified, applied and reported at least one social and one psychological aspect. Merits Commendation (8-10): identified, applied and reported more than one social and one psychological aspect, expertly using this to influence management.',
      0, 10, 1, 5),
    (v_section_id, 'Patient Centered Clinical Method (PCCM).',
      'Inadequate (0): clinical encounter, management plan and treatment execution is doctor-centered. Needs improvement (1-4): clerkship/treatment is patient-centered and reaching common ground (Component 3) is adequately reported. Meets expectation (5-7): patient-centered with common ground (Component 3) reported; minimum of 3 PCCM components used. Merits Commendation (8-10): captures patient-centeredness in all aspects of the encounter, reflected in the discussion, with 5-6 PCCM components used.',
      0, 10, 1, 6),
    (v_section_id, 'Discussion.',
      'Inadequate (0): no analysis or discussion of case management; incorrect medical information. Needs improvement (1-4): brief analysis and limited discussion. Meets expectation (5-7): topic well developed with adequate analysis. Merits Commendation (8-10): excellent discussion and in-depth analysis.',
      0, 10, 1, 7),
    (v_section_id, 'References.',
      'Inadequate (0): references not relevant, do not support discussion. Needs improvement (1-4): fewer than 10 references or more than one older than 10 years; references adequately support the discussion. Meets expectation (5-7): 10+ references, none older than 10 years, adequately supporting the discussion. Merits Commendation (8-10): 10+ references, majority within the last 5 years, including a systematic review article, expertly supporting the discussion.',
      0, 10, 1, 8),
    (v_section_id, 'Grammar, Punctuation, Spelling, Formatting.',
      'Inadequate (0): poor organisation and sentence structure impede comprehension; errors distract the reader. Needs improvement (1-4): needs editing, several grammatical/punctuation/formatting errors. Meets expectation (5-7): only 2-3 minor errors. Merits Commendation (8-10): very high quality writing/grammar, not more than 1 minor editing issue.',
      0, 10, 1, 9),
    (v_section_id, 'Logical Sequencing.',
      'Inadequate (0): more than 2 errors in sequencing or more than 2 sections missing. Needs improvement (1-4): 1 error in sequencing or 1 section missing. Meets expectation (5-7): no errors in sequencing, all relevant information present. Merits Commendation (8-10): sequencing and relevant information presented very clearly and concisely to international standard.',
      0, 10, 1, 10);

  -- Section 3: Case Defense (representative item -- see header note (g); real
  -- form has a variable number of assessor-authored question rows, each on
  -- this same 0-10 scale). Applied once per case, per question asked.
  v_section_id := gen_random_uuid();
  INSERT INTO rubric_sections (id, rubric_template_id, name, max_points, pass_threshold, all_items_required, sort_order)
  VALUES (v_section_id, v_template_id, 'Case Defense', 10, NULL, false, 3);
  INSERT INTO rubric_items (rubric_section_id, label, guidance_text, scale_min, scale_max, weight, sort_order) VALUES
    (v_section_id, 'Defense question response quality.',
      'Inadequate (0 points) / Needs improvement (1-4 points) / Meets expectation (5-7 points) / Merits Commendation (8-10 points) per question asked, based on clarifications the candidate is asked from the case write-up. The source document provides a variable-length, assessor-authored list of question rows ("add more rows if necessary") rather than fixed question text -- this single item represents ONE such question; an assessor scoring a real case defense adds one score entry against this item per question actually asked, then sums and converts the total to a percentage. Pass mark is 50% of that total (see this template''s pass_logic).',
      0, 10, 1, 1);

END IF;

END $$;

-- ====================================================================
-- END OF MIGRATION 46
-- ====================================================================
