-- ====================================================================
-- FM Roster - Migration 47: Seed Dr. Olanipekun's Real Workspace Content
-- ====================================================================
-- PREREQUISITE: migrations 01-46 already applied.
--
-- WHAT THIS DOES:
--   Populates the two placeholder workspaces already created for Dr.
--   Olanipekun (workforce.id = '5e3491aa-dfbd-430a-a131-89a5a8e4a704') with
--   his own real, already-written academic/clinical work:
--     1. research_workspaces (id cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5):
--        title + pico_framework updated to his real dissertation proposal.
--     2. research_chapters: one 'proposal' row (chapter_number 0) holding
--        the full text of his real, already-submitted WACP proposal.
--     3. research_correction_logs: his real corrections history against
--        that proposal, one row per distinct comment/action pair, drawn
--        from his own "Synopsis of Corrections" document (Part A = college
--        assessor, Part B = supervisor round 1, Part C = supervisor round
--        2). All rows are status='resolved' - these are historical,
--        already-actioned corrections, not open items.
--     4. clinical_case_reports (workspace 7ec2aa44-6104-470c-9276-46d5ef960052,
--        "My PMRs"): 3 of his real case write-ups (case_number 1-3).
--
-- SCOPE DECISIONS (flagged per CLAUDE.md's no-silent-scope-creep rule):
--   1. CONTENT SOURCE: all content below is Dr. Olanipekun's own real,
--      already-written, already-corrections-actioned academic/clinical
--      work, supplied and explicitly authorised by him for exactly this
--      purpose (seeding his own workspace in his own app). Not fabricated,
--      not another person's content.
--   2. research_chapters.content_text SCOPE: the seeded proposal chapter
--      holds the narrative proposal body (Background through Limitations,
--      Section 1.0-3.10, plus the References list) - i.e. exactly the
--      sections the WACP proposal_rubric's own "sections" keys score
--      (background/objectives/methodology/ethical_considerations/
--      references/budget_timeline). The document's administrative
--      appendices (bilingual informed consent forms, the English/Yoruba
--      research questionnaire, the detailed sample-size/sampling-technique/
--      analytical-plan appendices, and the ethics-approval scan) were
--      deliberately NOT included - they are supporting instruments/
--      attachments to the proposal, not the narrative proposal text the
--      rubric scores, and including full bilingual instrument text here
--      would bloat a single content_text field well past what that field
--      is used for elsewhere in the app.
--   3. TEXT CLEANUP APPLIED: the source extraction contained raw Microsoft
--      Word/Zotero field codes (ADDIN ZOTERO_ITEM CSL_CITATION {...large
--      JSON blob incl. full paper abstracts...} per in-text citation, plus
--      one ADDIN ZOTERO_BIBL {...} CSL_BIBLIOGRAPHY field code before the
--      reference list) - these are Word-internal citation-field metadata
--      that render as plain superscript numbers in the real document, not
--      authored content. They were mechanically stripped (brace-matched,
--      keeping only the trailing rendered citation-locator number that
--      already followed each field code in the extraction) so content_text
--      holds the proposal as a reader actually sees it, not raw field-code
--      soup. No wording of the author's own sentences was changed, added,
--      or removed.
--   4. research_correction_logs HAS NO NATURAL UNIQUE KEY: each insert
--      below is individually guarded by a WHERE NOT EXISTS on
--      (workspace_id, original_comment) so re-running this migration is
--      safe and does not duplicate rows.
--   5. clinical_case_reports.thematic_area judgement calls are explained
--      inline as SQL comments above each case's INSERT, per this file's
--      own instruction to flag reasoning rather than silently pick.
--   6. NOT POPULATED (deliberately, per explicit instruction): genogram_data,
--      family_tools_data, rubric_scores, defense_questions on all 3 case
--      reports - these need interactive tool use (the genogram/family-tools
--      builder UI, the AI Copilot) and are left at their column defaults.
--
-- NOT APPLIED LIVE. This migration file was written but deliberately not
-- executed against the live database - the parent session reviews and
-- applies it.
-- ====================================================================

-- --------------------------------------------------
-- 1. RESEARCH WORKSPACE: title + pico_framework
-- --------------------------------------------------

UPDATE research_workspaces
SET title = $rwtitle1$ASSOCIATION BETWEEN SEXUAL COMMUNICATION AND ERECTILE FUNCTION AMONG MARRIED MEN ATTENDING THE GENERAL OUTPATIENT CLINIC, UNIVERSITY COLLEGE HOSPITAL, IBADAN.$rwtitle1$,
    pico_framework = $rwpico2${"title":"ASSOCIATION BETWEEN SEXUAL COMMUNICATION AND ERECTILE FUNCTION AMONG MARRIED MEN ATTENDING THE GENERAL OUTPATIENT CLINIC, UNIVERSITY COLLEGE HOSPITAL, IBADAN.","population":"Married men aged ≥25 years attending the General Outpatient Clinic (GOPC), University College Hospital (UCH), Ibadan","intervention_or_exposure":"Quality of sexual communication, measured using the Dyadic Sexual Communication Scale (DSCS)","comparison":"None — cross-sectional design with no comparison group; DSCS and IIEF-5 scores analysed for association within the single study population","outcome":"Erectile function, measured using the International Index of Erectile Function-5 (IIEF-5)"}$rwpico2$::jsonb
WHERE id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5';

-- --------------------------------------------------
-- 2. RESEARCH CHAPTER: the real proposal text (chapter_type = 'proposal')
-- --------------------------------------------------

INSERT INTO research_chapters (workspace_id, chapter_type, chapter_number, title, word_count, content_text)
VALUES (
  'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5',
  'proposal',
  0,
  $chtitle3$ASSOCIATION BETWEEN SEXUAL COMMUNICATION AND ERECTILE FUNCTION AMONG MARRIED MEN ATTENDING THE GENERAL OUTPATIENT CLINIC, UNIVERSITY COLLEGE HOSPITAL, IBADAN.$chtitle3$,
  4330,
  $chbody4$1.0 BACKGROUND INFORMATION
1.1 Introduction
Sexual health is a state of physical, emotional, mental, and social well-being in relation to sexuality, encompassing psychological, emotional, and social dimensions beyond the mere absence of disease or dysfunction  1,2.
It encompasses both positive sexual experiences and significant psychosocial consequences of sexual dysfunction  2.
Erectile function is the persistent ability to achieve and maintain an erection sufficient for satisfactory sexual performance  2,3. It is a critical aspect of male sexual health, and a complex neurovascular process influenced by both organic (vascular, neurological) and psychogenic (anxiety, depression) factors  4. 
Erectile dysfunction (ED), the most prevalent sexual dysfunction in men, is characterized by a persistent inability to achieve or maintain an erection adequate for sexual activity  2,5. While aging and medical conditions can affect erectile function, ED is more accurately understood as the result of multiple interacting factors: organic, psychological, relational, and socio-cultural, rather than aging and medical conditions alone  1,4.
Among the relational factors implicated in erectile dysfunction, sexual communication plays a critical role. Sexual communication refers to the process through which partners express sexual preferences, desires, and concerns and negotiate changes within their sexual relationship through verbal and non-verbal interactions  6. Open and effective sexual communication facilitates mutual understanding of partners’ sexual needs and has been associated with greater sexual satisfaction and improved relationship quality  7. However, discussions about sexual issues are often perceived as sensitive and potentially threatening, as they may evoke feelings of embarrassment, shame, or fear of negative reactions from one’s partner. Consequently, individuals may avoid sexual discussions despite their potential benefits for relationship functioning and sexual well-being  6–8.  Poorer sexual communication is therefore increasingly recognised as a relational contributor to erectile dysfunction, with avoidance of sexual discussion linked to greater performance anxiety, delayed help-seeking, and poorer erectile outcomes  6,7,9.
1.2 Problem Statement
Erectile dysfunction profoundly affects men's quality of life (QoL) worldwide, with Agaba et al. demonstrating notable reductions in social functioning and overall health perception  10. These findings underscore the detrimental effects of ED on social and general health dimensions  2,10.
Globally, the prevalence of ED ranges from 3% to 76.5%, as shown in a systematic review by Kessler et al.  4. In Nigeria, ED affects 52.3% of men in the northwest and 58.9% in the southwest, with the latter comprising 47.2% mild, 11.3% moderate, and 41.5% severe cases  11,12. These statistics highlight the high prevalence of ED and the need for comprehensive research and therapeutic strategies to mitigate its impact on men's health and QoL  2,10.
Many men internalize ED as a personal failure, exacerbating emotional distress and worsening erectile function  1. In Nigeria, where sexual discussion is culturally avoided, poor sexual communication intensifies relational strain and delays help-seeking  1,13,14. Murray et al. found sexual communication difficulties more prevalent among couples experiencing ED  15, and cultural barriers to joint problem-solving perpetuate a negative feedback loop between impaired communication and declining erectile function  6,15.
1.3 Gap to be Filled by the Study
Existing research linking sexual communication to erectile function has largely been conducted in Western populations  6,9. In Nigeria, where erectile dysfunction prevalence is high  11,12 and sociocultural norms often discourage open discussion of sexual issues  13,14, the role of sexual communication in erectile function remains poorly characterised. The relational dimension of erectile function within Nigerian marital contexts therefore remains inadequately examined. This population gap  9, and the absence of Nigerian primary care data on sexual communication and erectile function, forms the basis for the justification in Section 1.4.
1.4 Justification and Rationale
While organic causes of ED are often identifiable through clinical and laboratory assessments, psychosocial factors, particularly sexual communication, are frequently overlooked during evaluation  2,8,14. Sexual communication influences how sexual stimuli are processed and plays an important role in several phases of the sexual response cycle; however, many couples find discussions about sexual issues more difficult than other relationship topics  1,5,6.
In Nigerian primary care, relational aspects of sexual functioning may remain unaddressed during clinical care, even though erectile dysfunction is highly prevalent  11,12. Furthermore, management of ED has traditionally focused on biomedical treatment approaches such as pharmacotherapy and device-based interventions  5, with comparatively little attention given to relational and communicative factors that may independently influence erectile function. Erectile dysfunction is therefore best understood as a biopsychosocial condition rather than a purely biomedical disorder, a framing that directly motivates examining its relational dimension in this population at this time  5.
1.4.1 Relevance to Family Medicine
Family physicians play a central role in managing ED by addressing its physiological, psychological, and interpersonal dimensions. Understanding the influence of sexual communication on erectile function supports its routine assessment during consultations, especially in contexts like Nigeria, where ED is prevalent  4,10–12. This study can promote holistic and patient-centered approaches in primary care by emphasizing communication-focused interventions that may enhance erectile function, and overall quality of life among men.
1.5 Research Question
What is the association between sexual communication and erectile function among married men attending the General Outpatient Clinic at University College Hospital, Ibadan?
1.6 Hypotheses
Null Hypothesis (H₀)
There is no statistically significant association between sexual communication scores, as measured by the Dyadic Sexual Communication Scale (DSCS), and erectile function scores, as measured by the International Index of Erectile Function–5 (IIEF-5), among married men attending the General Outpatient Clinic at the University College Hospital, Ibadan.
Alternative Hypothesis (Hₐ)
There is a statistically significant association between sexual communication scores, as measured by the Dyadic Sexual Communication Scale (DSCS), and erectile function scores, as measured by the International Index of Erectile Function–5 (IIEF-5), among married men attending the General Outpatient Clinic at the University College Hospital, Ibadan.
1.7 General And Specific Objectives
1.7.1 Aim (General Objective)
This study aims to investigate the association between sexual communication and erectile function among married men attending the General Outpatient Clinic at University College Hospital, Ibadan. The ultimate goal is to inform the potential integration of brief sexual communication counseling as a psychosocial intervention for preventing and managing erectile dysfunction in primary care settings.
1.7.2 Specific Objectives
To determine the pattern of erectile function using the IIEF-5 among married men attending the General Outpatient Clinic at UCH, Ibadan.
To determine the pattern of sexual communication using the DSCS among married men attending the clinic.
To examine the association between sexual communication (DSCS total score) and erectile function (IIEF-5 total score) among the study participants.
To identify factors independently associated with erectile function among married men attending the General Outpatient Clinic at UCH, Ibadan, including sexual communication quality, sociodemographic characteristics, psychological factors, and clinical/lifestyle variables.

2.0 LITERATURE REVIEW
2.1 The Male Sexual Response
The male sexual response is a coordinated physiological and psychological process that begins with sexual desire, triggered by internal or external stimuli such as thoughts, fantasies, or emotional cues  1. It progresses through excitement, plateau, orgasm, and resolution  1,16, with penile erection during the excitement phase mediated by arteriolar dilation and increased blood flow to erectile tissue  1,9,16. 
Following ejaculation, men enter a refractory period characterized by reduced sexual arousal and temporary unresponsiveness to sexual stimuli  9,16. Its duration varies with age, physical health, and psychological state  16.
2.2 Erectile Function
Erectile function refers to the consistent ability to achieve and maintain an erection sufficient for satisfactory sexual performance  2,3. It is regulated by supraspinal, spinal, and peripheral neurovascular mechanisms, with parasympathetic and sympathetic pathways modulating penile vasodilation and detumescence  1,9,16.
Although erection is a physiological process, its initiation and maintenance are strongly influenced by cognitive and emotional inputs, underscoring the relevance of psychological and relational factors in erectile function  2,5, and providing the conceptual basis for examining sexual communication as a determinant of erectile function in this study.
2.3 Erectile Dysfunction
Erectile dysfunction (ED) is defined as a persistent inability to achieve or maintain an erection adequate for sexual activity  2,5. It is the most prevalent male sexual dysfunction and results from a combination of organic, psychological, and social factors  2. While vascular, endocrine, and neurological abnormalities contribute to ED, emotional states such as anxiety, depression, and relational stress play a substantial role in its onset and persistence  2,5.
Psychosocial influences, including communication difficulties, relationship conflict, and psychological distress, may affect how sexual stimuli are processed through limbic and supraspinal pathways, potentially inhibiting the sexual response cycle  1,5. 
2.4 Sexual Communication
Sexual communication involves the expression of sexual needs, preferences, concerns, and expectations within intimate relationships  6. Effective sexual communication has been consistently associated with improved relationship and sexual satisfaction  15,17.
However, sexual communication is often perceived as more threatening than non-sexual communication, as discussions about sex may evoke feelings of vulnerability and threats to self-esteem  6,7. Evidence also suggests a bidirectional relationship between sexual problems and communication difficulties, whereby impairment in one domain may exacerbate challenges in the other  9, a dynamic that is particularly relevant in the context of erectile function.
2.5 Relationship between Sexual Communication and Erectile Function
Sexual communication quality, how openly and effectively partners discuss sexual needs, concerns, and dissatisfactions, has been repeatedly linked to how couples understand and cope with sexual difficulties, including erectile function, particularly in long-term partnerships  3,9,17.
A meta-analysis by Mallory et al. synthesised evidence showing that better sexual communication is associated with better sexual functioning across multiple domains  9. The meta-analytic evidence indicates that sexual communication remains relevant even when attention is restricted to erectile outcomes (specifically, the erectile function domain of sexual functioning, which is the primary outcome of this study), suggesting that relational communication processes contribute meaningfully to erectile experiences within partnered sex  9.
Several pathways have been proposed in the literature to explain this relationship. First, open sexual communication enables disclosure of erectile concerns, clarification of expectations, and joint problem-solving, for example, sexual pacing, stimulation preferences, and reducing performance pressure, anxiety and sexual avoidance  7,9. Second, sexual communication is closely tied to sexual satisfaction and relationship satisfaction, which may shape distress levels and coping when erectile difficulties occur  17. In line with this, research has shown that higher-quality sexual communication relates to improved sexual satisfaction and sexual well-being within the relationship  17,18. When communication is poor, partners may rely on assumptions, misread cues, avoid difficult conversations, and accumulate resentment or shame, conditions that can maintain a cycle of anxiety and declining erectile function  6,7,9.
Sexual communication is particularly challenging as sexual topics evoke greater anxiety and interpersonal threat than non-sexual discussions, increasing avoidance  6,7. Such avoidance may be especially consequential in erectile difficulties, where early disclosure and supportive partner responses can influence timely help-seeking, reduce distress, and encourage adaptive behavioural adjustments  7,17.
In Nigeria, cultural norms, including sexual taboos, stigma, and gendered expectations of male sexual competence, may further restrict sexual disclosure, heighten embarrassment, and delay care-seeking  14. Nigerian studies have reported that ED is prevalent among adult men in community and clinic samples, including primary care settings, yet it is often underreported because men may not volunteer symptoms unless asked directly  11,12,19. This pattern aligns with local evidence showing barriers to self-reporting and acceptability of sexual assessment, underscoring the need to understand relational and communication factors that may amplify distress and sustain impaired erectile function  14.
Overall, the literature supports a relationship between sexual communication quality and erectile function. While ED is multifactorial, sexual communication appears to shape partner support, anxiety and avoidance cycles, sexual satisfaction, and help-seeking behaviours, all of which may influence how erectile function is experienced and managed  2,6,7,9,14,17.
2.6 Other Variables Affecting Erectile Function and Dysfunction
Several demographic, medical, lifestyle, and psychosocial factors influence erectile function. Advancing age is associated with physiological declines in erectile function  1. Chronic medical conditions such as hypertension, diabetes mellitus, cardiovascular disease, and neurological disorders are well-established risk factors for ED, largely through their effects on endothelial function, neural integrity, and penile blood flow  4. Genitourinary and oncological conditions, particularly when surgically managed, may further impair erectile functioning  1,4.
Hormonal factors, especially age-related decline in testosterone levels from midlife, contribute to reduced sexual desire and erectile capacity  5. In addition, many commonly prescribed medications, including antihypertensives, antidepressants, and other chronic therapies, have been associated with erectile dysfunction or reduced libido  5. Lifestyle factors such as smoking, excessive alcohol consumption, and illicit drug use have also been linked to ED through vascular and neurogenic mechanisms  5.
Sociodemographic and relationship-related variables such as marital duration, educational attainment, and employment status may indirectly influence erectile function through their effects on stress, health behaviours, and communication patterns  20. A Nigerian study in Port Harcourt demonstrated a significant association between educational level and ED prevalence  20, collectively underscoring the relevance of these variables as potential confounders in this study.
2.7 Study Tools
2.7.1 International Index of Erectile Function-5 (IIEF-5) Questionnaire
The International Index of Erectile Function-5 (IIEF-5) is a validated, widely used instrument for assessing erectile function in men  19,21. It demonstrates good sensitivity and specificity across diverse populations, including Nigerian men.  11,12,19,21.
Several instruments are available for assessing erectile function, including the full 15-item IIEF, the abridged 5-item IIEF (IIEF-5), the single-item Erection Hardness Score, and the Sexual Health Inventory for Men, which is the IIEF-5 administered under an alternative name  21. Although the IIEF-15 assesses multiple domains of male sexual function, and single-item measures offer brevity at the cost of detail, the IIEF-5 was selected for this study because it focuses specifically on the erectile function domain that is the study outcome, has been validated in Nigerian men, balances brevity with multi-item reliability, and has a shorter administration time suited to a busy outpatient clinic  11,12,19,21. The instrument yields total scores ranging from 5 to 25, with higher scores indicating better erectile function and lower scores reflecting increasing severity of erectile dysfunction  21.
2.7.2 Dyadic Sexual Communication Scale (DSCS)
The Dyadic Sexual Communication Scale (DSCS) assesses the quality of sexual communication between partners, including comfort discussing sexual matters and resolving sexual disagreements  9. Several instruments assess sexual communication, including the Dyadic Sexual Communication Scale (DSCS), the Sexual Communication Satisfaction Scale, and the Couples’ Communication subscales embedded in broader sexual-functioning questionnaires. Of these, the DSCS was selected because it measures the quality of dyadic sexual communication directly rather than satisfaction with it, is brief, is psychometrically robust, and has prior validation in comparable sociocultural settings  9,18. The DSCS consists of 13 items rated on a six-point Likert scale, yielding total scores ranging from 13 to 78, with higher scores indicating better sexual communication quality between partners  9.
2.7.3 Hospital Anxiety and Depression Scale (HADS)
Anxiety and depression are important psychological confounders in the assessment of erectile function  5. The Hospital Anxiety and Depression Scale (HADS) is a validated screening tool for anxiety and depression in medical outpatient settings and has been extensively validated in southwestern Nigeria  22. 
Although the Generalized Anxiety Disorder Scale-7 (GAD-7) and the Patient Health Questionnaire-9 (PHQ-9) are valid alternatives, the HADS was selected because it assesses both anxiety and depression within a single instrument, reducing respondent burden while maintaining psychometric robustness  22,23. Subscale scores will be analysed as continuous variables.
2.8 Conceptual Framework
The conceptual framework illustrates the hypothesised association between sexual communication quality and erectile function among married men attending the General Outpatient Clinic. Sexual communication quality, measured using the DSCS, represents the primary independent variable, while erectile function, measured using the IIEF-5, represents the primary outcome variable. Higher scores on both scales indicate better sexual communication and better erectile function, respectively.
The framework further recognises potential confounders grouped into four domains: sociodemographic factors (age, educational attainment, marital duration); psychosocial factors (anxiety and depression measured by HADS subscales); clinical factors (hypertension, diabetes mellitus, ED-associated medications); and lifestyle factors (smoking, alcohol use, body mass index).Figure 1: Conceptual framework illustrating the hypothesised association between sexual communication quality (DSCS) and erectile function (IIEF-5), with confounding variables across sociodemographic, psychosocial, clinical, and lifestyle domains, among married men at the General Outpatient Clinic, UCH, Ibadan.
3.0 METHODS
3.1 Study Area
This study will be conducted at the General Outpatient Clinic (GOPC) of University College Hospital (UCH), Ibadan, a Department of Family Medicine facility serving approximately 2,000 patients monthly.
3.2 Study Design
A cross-sectional, hospital-based study design will be employed.
3.3 Study Population
The study will include married men aged 25 years and above attending the GOPC at UCH. A lower limit of 25 years was applied because marriage is uncommon below this age, and to align with Nigerian erectile dysfunction studies  11,12,19; no upper limit was set, to support generalisability.
3.3.1 Inclusion Criteria
Participants must meet all of the following:
Consenting adult males aged ≥25 years
Married and currently living with spouse/partner
Must have attempted sexual activity within the past 6 months
3.3.2 Exclusion Criteria
Participants will be excluded if they:
Have known neurological or psychiatric disorders that may impair sexual function or communication (e.g., Parkinson’s disease, schizophrenia, dementia, major depressive disorder).
Are undergoing active cancer treatment or have had major pelvic/genitourinary surgery within the preceding 6 months.
3.4 Sample Size Determination
Sample size was determined using a Fisher's Z–based confidence interval approach for correlation coefficient estimation  24,25. The formula applied was:n = [4(1 − r²)²Z²]/W² + 3.
An expected correlation coefficient of r = 0.19 was adopted from the erectile function domain of Mallory et al.’s meta-analysis, matching this study's outcome  9. A 95% confidence level (Z = 1.96) and confidence interval width (W) of 0.20 (precision ±0.10) were used.
Substituting (r² = 0.0361; Z² = 3.8416; W² = 0.04): n = 359.9 ≈ 360.
Adjusting for 10% non-response: n = 360 / 0.90 = 400 married men.Detailed derivation is provided in Appendix 7.
3.5 Sampling Technique
Systematic random sampling will be used over 3 months. From an estimated sampling frame of 2,400 eligible patients (≈800 per month), k = 6 will be applied to recruit approximately 7 participants per clinic day over 60 clinic days, reaching the target of 400. Full derivation and the selection procedure are detailed in Appendix 8.
3.6 Study Instruments
Data will be collected using an interviewer-administered questionnaire comprising: sociodemographic characteristics; the IIEF-5 (scores 5–25; Cronbach's alpha 0.73–0.91)  11,12,19,21; the DSCS (scores 13–78; Cronbach's alpha 0.81)  9,18; the HADS with separate anxiety (HADS-A) and depression (HADS-D) subscales (each 0–21), validated in southwestern Nigeria  22; and clinical and lifestyle information. A pretest on 20 participants will assess clarity, comprehension, and cultural appropriateness beforehand.
3.7 Data Collection Methods
The researcher or a trained male assistant will administer the questionnaire during GOPC visits to minimise social desirability bias; the assistant will receive prior structured training on administration, participant engagement, and confidentiality. To prevent double capture, each man will be asked at recruitment whether he has previously participated, with the hospital number checked where available; those already enrolled will not be re-recruited.
3.7.1 Operational Definitions
Erectile function: IIEF-5 total score (5–25, continuous); higher scores indicate better function  21. The continuous score is the analytical outcome variable; the Rosen severity classification  21 is applied descriptively only (see Objective 1, Section 3.8).
Sexual Communication Quality: DSCS total score (13–78, continuous). Higher scores indicate better sexual communication quality  9,18. 
Anxiety and Depression: HADS-A and HADS-D subscale scores (0–21, continuous); higher scores indicate greater symptom severity  22. 
Chronic Illness: Self-reported physician-diagnosed hypertension and/or diabetes mellitus, and/or current antihypertensive or glucose-lowering medication; binary (present/absent).
Current smoking: Self-reported; binary (yes = current smoker; no = never/former).
Current alcohol use: Self-reported; binary (yes = current user; no = never/former).
Medication Use: Self-reported; reviewed by investigator; binary (yes = ED-associated medication; no = not ED-associated).
Blood Pressure: Measured using an Omron™ automated device (mmHg, continuous). Participants without known hypertension but with BP ≥140/90 mmHg will be noted as having elevated blood pressure at assessment.
BMI: Weight/height² (kg/m²), treated as a continuous variable. 
Fasting Blood Sugar: Measured in mg/dL (continuous). Participants without known diabetes but with fasting blood glucose ≥126 mg/dL will be described as having elevated fasting blood sugar at assessment.
All binary variables are coded 1 for the index category and 0 for the reference category for entry into the multivariable model.
3.8 Data Management
Data will be analysed using IBM SPSS Statistics version 29.0. All tests will be two-tailed (p < 0.05), with results presented with 95% CIs. Incomplete questionnaires will be reviewed before participant departure; cases with missing primary outcome data will be excluded and reported.
Objective 1: Pattern of Erectile Function
IIEF-5 total scores will be summarised using mean ± SD or median (IQR) as appropriate. As a secondary descriptive output, the proportion with erectile dysfunction (IIEF-5 ≤21) and the Rosen severity distribution (no ED 22–25, mild 17–21, mild-to-moderate 12–16, moderate 8–11, severe 5–7) will be reported for descriptive purposes only; not as the analytical outcome variable  21.
Objective 2: Pattern of Sexual Communication
DSCS total scores will be summarised using mean ± SD or median (IQR) as appropriate.
Objective 3: Association between Sexual Communication and Erectile Function
The DSCS is completed by the male participant only, capturing his perception of sexual communication within the marriage; partners are not assessed. Both total scores are continuous. Their association will be assessed using Pearson’s correlation where bivariate normality holds, or Spearman’s rank correlation otherwise. Correlation coefficients (r) will be reported with 95% CIs obtained via bootstrapping (1,000 resamples) in SPSS 29.0.
Objective 4: Factors Independently Associated with Erectile Function
Multivariable linear regression will be conducted with IIEF-5 total score as the continuous dependent variable.
3.9 Ethical Considerations
Ethical approval was obtained from the UI/UCH Ethics Committee (UI/EC/24/0372). Permissions will be secured from the Chairman Medical Advisory Committee and Department of Family Medicine. Informed consent will ensure voluntary participation, privacy, and confidentiality. Participants with abnormal results will be linked to care.
3.10 Limitations
Social desirability bias may affect intimacy-related responses, mitigated by anonymity and a male research assistant. The cross-sectional design limits causal inference, which future longitudinal studies could address.

REFERENCES
 1. De Guevara NML, Jurado AR. Sexual health. In: Cano A, editor. Menopause: a comprehensive approach. Cham: Springer International Publishing; 2017. p. 109–22. doi:10.1007/978-3-319-59318-0_7
2. Galizia R, Theodorou A, Simonelli C, Lai C, Nimbi FM. Sexual satisfaction mediates the effects of the quality of dyadic sexual communication on the degree of perceived sexual desire discrepancy. Healthcare. 2023 Jan;11(5):648. doi:10.3390/healthcare11050648
3. Leslie SW, Sooriyamoorthy T. Erectile dysfunction [Internet]. Treasure Island (FL): StatPearls Publishing; 2024 [cited 2024 Jun 12]. Available from: https://www.ncbi.nlm.nih.gov/books/NBK562253/
4. Kessler A, Sollie S, Challacombe B, Briggs K, Van Hemelrijck M. The global prevalence of erectile dysfunction: a review. BJU Int. 2019 Oct;124(4):587–99. doi:10.1111/bju.14813
5. Mobley DF, Khera M, Baum N. Recent advances in the treatment of erectile dysfunction. Postgrad Med J. 2017 Nov;93(1105):679–85. doi:10.1136/postgradmedj-2016-134073
6. Rehman US, Lizdek I, Fallis EE, Sutherland S, Goodnight JA. How is sexual communication different from nonsexual communication? A moment-by-moment analysis of discussions between romantic partners. Arch Sex Behav. 2017 Nov;46(8):2339–52. doi:10.1007/s10508-017-1006-5
7. Rehman US, Balan D, Sutherland S, McNeil J. Understanding barriers to sexual communication. J Soc Pers Relatsh. 2019 Sep;36(9):2605–23. doi:10.1177/0265407518794900
8. Leblanc NM, St. Vil NM, Bond KT, Mitchell JW, Juarez AC, Lambert F, et al. Dimensions of sexual health conversations among U.S. Black heterosexual couples. Int J Environ Res Public Health. 2023;20(1):588. doi:10.3390/ijerph20010588
9. Mallory AB, Stanton AM, Handy AB. Couples' sexual communication and dimensions of sexual function: a meta-analysis. J Sex Res. 2019 Sep;56(7):882–98. doi:10.1080/00224499.2019.1568375
10. Agaba PA, Ocheke AN, Akanbi MO, Gimba ZM, Ukeagbu J, Mallum BD, et al. Sexual functioning and health-related quality of life in men. Niger Med J. 2017 May-Jun;58(3):96–100. doi:10.4103/nmj.NMJ_225_16
11. Oyelade BO, Jemilohun AC, Aderibigbe SA. Prevalence of erectile dysfunction and possible risk factors among men of South-Western Nigeria: a population based study. Pan Afr Med J 2016 Jun;24:124. doi:10.11604/pamj.2016.24.124.8660
12. Muhammad AZ, Grema BA, Shuaibu A, Michael GC. Prevalence, severity, and correlates of erectile dysfunction among male adult patients of a primary care clinic in North-West Nigeria. Afr Health Sci. 2023 Jul;23(2):2. doi:10.4314/ahs.v23i2.77
13. Aliyu M, Ibrahim KH, Abubakar MA. Sexual dysfunction and infertility amongst spouses in Adamawa state, Nigeria. Am J Health Res. 2021;9(1):1–8. doi:10.11648/j.ajhr.20210901.11
14. Irekpita E, Imomoh P, Okonofua F, Aziken M. Clinical, cultural and psychosocial impediments to self reporting of erectile dysfunction by men in Edo state, Nigeria. Afr J Urol. 2017;23(2):106–11. doi:10.1016/j.afju.2016.09.006
15. Murray SH, Milhausen RR, Graham CA, Kuczynski L. A qualitative exploration of factors that affect sexual desire among men aged 30 to 65 in long-term relationships. J Sex Res. 2017 Mar;54(3):319–30. doi:10.1080/00224499.2016.1168352
16. Khan SD, Gunasekaran K. The human sexual response. In: Mulhall JP, editor. Sexual medicine: principles and practice. Singapore: Springer Singapore; 2017. p. 1–9.
17. Roels R, Janssen E. Sexual and relationship satisfaction in young, heterosexual couples: the role of sexual frequency and sexual communication. J Sex Med. 2020 Sep;17(9):1643–52. doi:10.1016/j.jsxm.2020.06.013
18. Alizadeh S, Ebadi A, Kariman N, Ozgoli G. Dyadic sexual communication scale: psychometrics properties and translation of the Persian version. Sex Relatsh Ther. 2020 Jan;35(1):103–14. doi:10.1080/14681994.2018.1514460
19. Gara P, Mamman M, Adefemi S, Imade O, Olaosebikan O. Erectile dysfunction: prevalence, and pattern among adult male patients attending the general out-patient clinic of Federal Medical Centre Bida, Nigeria. West Afr J Med. 2024 Mar;41(3):277–85. PMID: 38787782.
20. Okey-Ewurum I, Amadi A, Nwoke E, Amadi C, Ibe S, Iwuoha G, et al. Socio-demographic factors associated with erectile dysfunction among men in Port-Harcourt, southern Nigeria. Int J Sci Healthc Res. 2020 Jul-Sep;5(3):358–64.
21. Neijenhuijs KI, Holtmaat K, Aaronson NK, Holzner B, Terwee CB, Cuijpers P, et al. The International Index of Erectile Function (IIEF)—a systematic review of measurement properties. J Sex Med. 2019;16(7):1078–91.
22. Opakunle T, Aloba O, Nwozo C, Adesanya DD, Adebimpe O. Psychometric adaptation of the hospital anxiety and depression scale as a self-rated suicide risk assessment instrument among Nigerian surgical patients. Int J Med Health Dev. 2023;28(4):330–6
23. Elugbadebo OO, Baiyewu O. Mild anxiety and depression disorders: unusual reactions to COVID-19 lockdown in caregivers of older adults attending a psychogeriatric clinic in Southwest Nigeria. Niger Postgrad Med J. 2022;29(1):13–9
24. Bujang MA. A step-by-step process on sample size determination for medical research. Malays J Med Sci. 2021;28(2):15–27.
25. Bujang MA. An elaboration on sample size determination for correlations based on effect sizes and confidence interval width: a guide for researchers. Restor Dent Endod. 2024 May;49(2):e21. doi:10.5395/rde.2024.49.e21.$chbody4$
)
ON CONFLICT (workspace_id, chapter_type) DO UPDATE
  SET content_text = EXCLUDED.content_text,
      word_count = EXCLUDED.word_count,
      title = EXCLUDED.title;

-- --------------------------------------------------
-- 3. RESEARCH CORRECTION LOGS (52 rows: 11 Part A / 20 Part B / 21 Part C)
-- No natural unique key on this table, so each insert is individually
-- guarded by a WHERE NOT EXISTS on (workspace_id, original_comment).
-- --------------------------------------------------

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'college_assessor', $st6$Title / Cover Page$st6$, $cm5$Include fellowship year for supervisors.$cm5$, $at7$Fellowship years added for both supervisors: 1st Supervisor – 2014; 2nd Supervisor – 2016.$at7$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm5$Include fellowship year for supervisors.$cm5$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'college_assessor', $st9$1.31 Relevance to Family Medicine$st9$, $cm8$"Ultimately enhancing quality of life and improving primary care" is vague and not directly inferred from this study.$cm8$, $at10$Rephrased to: "This study will promote holistic and patient-centered approaches in primary care by emphasizing communication-focused interventions that may enhance sexual function and overall quality of life among men."$at10$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm8$"Ultimately enhancing quality of life and improving primary care" is vague and not directly inferred from this study.$cm8$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'college_assessor', $st12$Specific Objectives – Objective 1$st12$, $cm11$"Distribution" is not ideal; "pattern" better reflects the intended analysis.$cm11$, $at13$Replaced "To determine the distribution…" with "To determine the pattern of erectile function using the IIEF-5…"$at13$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm11$"Distribution" is not ideal; "pattern" better reflects the intended analysis.$cm11$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'college_assessor', $st15$Specific Objectives – Objectives 3 & 4$st15$, $cm14$"Adjusting for relevant confounders" should be a separate objective to capture determinant analysis.$cm14$, $at16$Objective 3 revised to examine the association between DSCS and IIEF-5 total scores using correlation analysis. Objective 4 revised to identify factors independently associated with erectile function using multivariable linear regression, explicitly including sexual communication quality, sociodemographic, psychosocial, and clinical/lifestyle variables.$at16$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm14$"Adjusting for relevant confounders" should be a separate objective to capture determinant analysis.$cm14$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'college_assessor', $st18$2.7 Study Tools$st18$, $cm17$Cronbach's alpha and analytical approach should be moved to methodology. Section should only justify tool choice.$cm17$, $at19$Section 2.7 revised to summarise key reasons for tool selection (validity, brevity, cultural fit). Cronbach's alpha and psychometric details transferred to Section 3.6 (Study Instruments). Analytical handling of scores stated under operational definitions (Section 3.7.1) and Appendix 9.$at19$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm17$Cronbach's alpha and analytical approach should be moved to methodology. Section should only justify tool choice.$cm17$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'college_assessor', $st21$3.3.1 Inclusion Criteria$st21$, $cm20$Too restrictive; "current relationship" is redundant.$cm20$, $at22$Streamlined to: (1) Consenting adult males aged ≥25 years; (2) Married and currently living with spouse/partner; (3) Have attempted sexual activity within the past 6 months. Redundant and overlapping criteria removed.$at22$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm20$Too restrictive; "current relationship" is redundant.$cm20$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'college_assessor', $st24$3.3.2 Exclusion Criteria$st24$, $cm23$Medication use should not be an exclusion criterion; it should be analysed as a confounder.$cm23$, $at25$"Taking medications causing ED" removed from exclusion criteria. ED-linked medication use added as a binary confounder variable in the operational definitions (Section 3.7.1) and the multivariable linear regression model (Objective 4).$at25$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm23$Medication use should not be an exclusion criterion; it should be analysed as a confounder.$cm23$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'college_assessor', $st27$3.4 Sample Size Determination$st27$, $cm26$WACP Checklist requirement: "Right and appropriate formula or approaches for the study to be powered to address all stated objectives and avoid Type II error. Must be appropriate for the methods and design. The correlation coefficient used should be appropriate for the dependent and independent variables of interest. Unjustifiable further reduction of estimated sample size should be avoided." Supervisor comments: (i) "Suggest review to a more popular method on Fisher's formula." (ii) "Is this correlation coefficient (r) for communication and ED?" (iii) "What category?" — querying the final sample size statement.$cm26$, $at28$In direct alignment with the WACP checklist requirement, the following was ensured: (i) Appropriate formula: A Fisher's Z transformation–based confidence interval approach was applied — the methodologically appropriate formula for estimating a correlation coefficient with specified precision (W = 0.20, ±0.10). This directly addresses the primary analytic objective (Objective 3: correlation between DSCS and IIEF-5 scores) and satisfies the assessor's recommendation for CI consideration. (ii) Powered for all objectives: The sample size of 400 was verified as adequate for all four objectives: descriptive analysis (Objectives 1 and 2, minimum n = 145); correlation with precise CI (Objective 3, n = 400); and multivariable linear regression (Objective 4, minimum n = 145 by Green's formula: n ≥ 50 + 8u = 130, adjusted for non-response = 145). Full derivation in Appendix 7. (iii) Appropriate correlation coefficient: r = 0.19 was used, derived specifically from the erectile function domain of Mallory et al. (2019) — not the broader overall sexual function coefficient (r = 0.35) — ensuring alignment with the dependent variable of interest, as required by the checklist. (iv) No unjustifiable reduction: The final sample size of 400 was not reduced below the calculated requirement. It was restated as "400 married men" to explicitly identify the study population, in response to the supervisor's query. (v) Assessor and supervisor's method suggestion: Following careful methodological review, the Fisher's Z CI-based approach was identified as the most appropriate method, as it is the only formula that simultaneously addresses CI precision and aligns with the primary analytic objective. Alternative methods — power-based Fisher formula, prevalence formula, and linear regression adequacy check — were evaluated; their relative considerations are detailed in Appendix 7.$at28$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm26$WACP Checklist requirement: "Right and appropriate formula or approaches for the study to be powered to address all stated objectives and avoid Type II error. Must be appropriate for the methods and design. The correlation coefficient used should be appropriate for the dependent and independent variables of interest. Unjustifiable further reduction of estimated sample size should be avoided." Supervisor comments: (i) "Suggest review to a more popular method on Fisher's formula." (ii) "Is this correlation coefficient (r) for communication and ED?" (iii) "What category?" — querying the final sample size statement.$cm26$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'college_assessor', $st30$3.7.1 Operational Definitions – Urinalysis$st30$, $cm29$Purpose of urinalysis unclear; not diagnostic for diabetes mellitus.$cm29$, $at31$Urinalysis replaced with fasting blood glucose (FBG) as the screening method for diabetes mellitus. Updated in operational definitions (Section 3.7.1), informed consent form (Appendix 1), and research questionnaire (Appendix 3), including the Yoruba translations (Appendices 4 and 6).$at31$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm29$Purpose of urinalysis unclear; not diagnostic for diabetes mellitus.$cm29$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'college_assessor', $st33$3.8 Statistical Analysis – Objective 3$st33$, $cm32$Clarify whether correlation will be total scores only or include domain scores.$cm32$, $at34$Clarified that correlation will use total scores only (DSCS total score vs IIEF-5 total score). The IIEF-5 yields a single composite score reflecting erectile function; domain-level analysis is not applicable for this instrument.$at34$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm32$Clarify whether correlation will be total scores only or include domain scores.$cm32$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'college_assessor', $st36$3.8 Statistical Analysis – HADS$st36$, $cm35$Clarify whether HADS will be analysed as categorical or continuous.$cm35$, $at37$Clarified that HADS-A and HADS-D subscale scores (0–21 each) will be analysed as continuous variables throughout. Stated in operational definitions (Section 3.7.1) and analytical plan (Section 3.8).$at37$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm35$Clarify whether HADS will be analysed as categorical or continuous.$cm35$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st39$1.1 Introduction – Paragraph 4$st39$, $cm38$"Sexual communication is an example of which of these factors — try to bring it out under the factor before building on it."$cm38$, $at40$A new paragraph was introduced immediately after Paragraph 4 to explicitly situate sexual communication within the relational factors contributing to erectile dysfunction. The paragraph defines sexual communication, its verbal and non-verbal dimensions, and its role in facilitating mutual understanding of sexual needs and relationship satisfaction, supported by references (Refs 6, 7, 8).$at40$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm38$"Sexual communication is an example of which of these factors — try to bring it out under the factor before building on it."$cm38$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st42$1.0 Background – Structural Reorganisation$st42$, $cm41$Implicit from new WACP Proposal checklist (Version 5.0, May 2025): Gap to be Filled by the Study was not a distinct section in the previous version, as required by the updated assessment tool.$cm41$, $at43$A new section (1.3 Gap to be Filled by the Study) was added between the Problem Statement and Justification. This section explicitly identifies the population gap (Nigerian marital context in primary care), the knowledge gap (limited African data on sexual communication and erectile function), and the methodological gap (absence of studies examining this association in this setting).$at43$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm41$Implicit from new WACP Proposal checklist (Version 5.0, May 2025): Gap to be Filled by the Study was not a distinct section in the previous version, as required by the updated assessment tool.$cm41$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st45$1.4 Justification – Paragraph 2$st45$, $cm44$"Management remains largely biomedical... couple-centred interventions" — reference required for this last phrase.$cm44$, $at46$Statement revised and referenced. Previous wording: "management remains largely biomedical, with minimal integration of psychosocial assessment or couple-centered interventions." Revised to: "management has traditionally focused on biomedical treatment approaches such as pharmacotherapy and device-based interventions⁵" with Mobley et al. (2017) added as supporting reference.$at46$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm44$"Management remains largely biomedical... couple-centred interventions" — reference required for this last phrase.$cm44$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st48$1.6 Hypotheses$st48$, $cm47$"Dyadic" highlighted in the hypothesis statement (concern about unexplained use of the term without introduction).$cm47$, $at49$Hypotheses reworded to introduce the instrument name in full before using it. Both null and alternative hypotheses now read: "...sexual communication scores, as measured by the Dyadic Sexual Communication Scale (DSCS), and erectile function scores, as measured by the International Index of Erectile Function–5 (IIEF-5)..." This ensures the term 'Dyadic' is contextualised within its instrument name at first appearance. The DSCS is an individually administered instrument that captures each respondent's perception of sexual communication quality within their intimate relationship, yielding a single participant score reflecting their subjective experience of how openly and effectively sexual matters are discussed with their partner. When used with couples, both partners complete the instrument independently, and their scores are analysed separately or compared to examine concordance or discordance in perceived communication quality. When used with individual participants — as in this study — only one partner's perspective is captured, which is equally valid and widely accepted in sexual health research, where couple-level recruitment may be impractical in clinical and primary care settings. This study recruits married men as individual participants and examines the association between each man's perception of sexual communication quality and his own erectile function.$at49$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm47$"Dyadic" highlighted in the hypothesis statement (concern about unexplained use of the term without introduction).$cm47$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st51$1.7.2 Specific Objectives$st51$, $cm50$Queried use of 'IIEF scores' and 'DSCS scores' (Objectives 1 and 2); queried 'strength of' in Objective 3; queried whether sexual communication was included in Objective 4 determinants.$cm50$, $at52$All four objectives rewritten: (1) "pattern of erectile function using the IIEF-5"; (2) "pattern of quality of sexual communication using the DSCS"; (3) "examine the association between quality of sexual communication (DSCS total score) and erectile function (IIEF-5 total score)"; (4) "identify factors independently associated with erectile function… including sexual communication quality, sociodemographic characteristics, psychosocial factors, and clinical/lifestyle variables, using multivariable linear regression." Sexual communication quality now explicitly named in Objective 4.$at52$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm50$Queried use of 'IIEF scores' and 'DSCS scores' (Objectives 1 and 2); queried 'strength of' in Objective 3; queried whether sexual communication was included in Objective 4 determinants.$cm50$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st54$2.5 Relationship between Sexual Communication and Erectile Function$st54$, $cm53$(i) Requested that findings from the Mallory et al. meta-analysis be summarised narratively rather than presented using numerical effect sizes. (ii) Asked for clarification on the conceptual difference between overall sexual function and erectile function, with reference to literature included in the meta-analysis. (iii) Noted that the relationship between sexual communication and erectile dysfunction was not sufficiently developed and recommended drawing more explicitly from studies in the meta-analysis. (iv) Advised clearer contextualisation of cultural barriers in Nigeria affecting sexual communication and erectile dysfunction.$cm53$, $at55$Section 2.5 substantially revised: (i) Mallory et al. (2019) meta-analytic findings presented narratively without numerical statistics; (ii) overall sexual function clearly distinguished from erectile function as a specific male domain; (iii) mechanistic pathways expanded — communication avoidance, performance anxiety, emotional intimacy, and supportive partner responses; (iv) Nigerian contextualisation strengthened — sexual taboos, stigma, gendered expectations of male sexual competence, and barriers to self-reporting integrated with supporting references (Refs 6, 7, 10, 11, 13, 15, 17, 19).$at55$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm53$(i) Requested that findings from the Mallory et al. meta-analysis be summarised narratively rather than presented using numerical effect sizes. (ii) Asked for clarification on the conceptual difference between overall sexual function and erectile function, with reference to literature included in the meta-analysis. (iii) Noted that the relationship between sexual communication and erectile dysfunction was not sufficiently developed and recommended drawing more explicitly from studies in the meta-analysis. (iv) Advised clearer contextualisation of cultural barriers in Nigeria affecting sexual communication and erectile dysfunction.$cm53$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st57$2.6 Other Variables Affecting Erectile Function$st57$, $cm56$(i) Hormonal factors should be clearly linked to ageing. (ii) Sociodemographic influences require referencing. (iii) Confounder-identification sentence should not appear in the literature review.$cm56$, $at58$(i) Hormonal factors explicitly described as interacting with ageing-related physiological decline, particularly testosterone decline from midlife (Refs 1, 5). (ii) Sociodemographic associations explicitly supported by a Nigerian population-based study from Port Harcourt (Ref 21). (iii) Confounder-identification sentence removed from Section 2.6 and appropriately reflected in the analytical plan for Objective 4 within Section 3.8.$at58$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm56$(i) Hormonal factors should be clearly linked to ageing. (ii) Sociodemographic influences require referencing. (iii) Confounder-identification sentence should not appear in the literature review.$cm56$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st60$2.7.1 IIEF-5 – Study Tools$st60$, $cm59$"Does the score translate to quality of erectile functioning?" — queried the analytical statement about continuous analysis in the literature review.$cm59$, $at61$Section 2.7.1 revised to describe the clinical meaning of the score: "The instrument yields total scores ranging from 5 to 25, with higher scores indicating better erectile function and lower scores reflecting increasing severity of dysfunction." Analytical handling moved to Section 3.7.1 (Operational Definitions) and Appendix 9, where the dual use of the IIEF-5 — continuous for correlation analysis and severity categories for descriptive prevalence reporting — is fully specified.$at61$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm59$"Does the score translate to quality of erectile functioning?" — queried the analytical statement about continuous analysis in the literature review.$cm59$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st63$2.7.2 DSCS – Study Tools$st63$, $cm62$"Nuanced" implies qualitative depth; concerned about qualitative framing of what is a quantitative instrument.$cm62$, $at64$Section 2.7.2 revised to focus on instrument structure and score interpretation: "The DSCS consists of 13 items rated on a six-point Likert scale, yielding total scores ranging from 13 to 78, with higher scores indicating better sexual communication quality between partners." Analytical handling of DSCS scores moved to operational definitions. The study design is quantitative throughout, consistent with the stated objectives.$at64$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm62$"Nuanced" implies qualitative depth; concerned about qualitative framing of what is a quantitative instrument.$cm62$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st66$3.3.1 Inclusion Criteria – Age Range$st66$, $cm65$"Why the wide age range? (20–70 years)"$cm65$, $at67$Lower age limit revised from 20 years to ≥25 years to better reflect the marital profile of the study population — married men living with their spouse attending primary care. Upper age limit removed to improve generalisability and better reflect the broad adult male population attending the General Outpatient Clinic. Revision maintains comparability with prior Nigerian erectile dysfunction studies.$at67$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm65$"Why the wide age range? (20–70 years)"$cm65$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st69$3.4 Sample Size – Supervisor Comments$st69$, $cm68$(i) "Suggest review to a more popular method on Fisher's formula." (ii) "Is this correlation coefficient (r) for communication and ED?" (iii) "What category?" — querying the final sample size statement.$cm68$, $at70$See Part A (Sample Size row) above for full response, which addresses all three supervisor comments in the context of WACP checklist alignment. In summary: (i) Fisher's Z CI-based approach confirmed as most appropriate following methodological review; (ii) r = 0.19 confirmed as specific to the erectile function domain of Mallory et al. (2019); (iii) final sample size restated as "400 married men."$at70$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm68$(i) "Suggest review to a more popular method on Fisher's formula." (ii) "Is this correlation coefficient (r) for communication and ED?" (iii) "What category?" — querying the final sample size statement.$cm68$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st72$3.5 Sampling Technique$st72$, $cm71$Sampling technique section required rewriting.$cm71$, $at73$Section 3.5 rewritten to describe systematic random sampling with full procedural detail: sampling frame (2,400 eligible patients over 3 months); sampling interval (k = 6); random start procedure (random number 1–6 generated prior to each clinic session); daily recruitment target (6–7 participants per clinic day over 60 clinic days); and replacement procedure for ineligible or declining participants. Full derivation and procedure detailed in Appendix 8.$at73$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm71$Sampling technique section required rewriting.$cm71$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st75$3.7.1 Operational Definitions$st75$, $cm74$(i) "How is the final interpretation done?" — re IIEF-5 and DSCS scoring. (ii) "Remove erectile dysfunction from the list of operational definitions for now."$cm74$, $at76$(i) Interpretation guidance added for both instruments: IIEF-5 total score (5–25, continuous; higher = better erectile function); for descriptive purposes only, erectile dysfunction classified as IIEF-5 ≤21, with severity categories — mild (17–21), mild-to-moderate (12–16), moderate (8–11), severe (5–7) — per validated thresholds. DSCS total score (13–78, continuous; higher = better sexual communication quality). The continuous IIEF-5 score remains the analytical outcome variable in all inferential analyses. (ii) "Erectile dysfunction" removed as a standalone operational definition entry. The ED classification is now defined within the IIEF-5 operational definition and addressed fully in the analysis section (Section 3.8) and Appendix 9.$at76$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm74$(i) "How is the final interpretation done?" — re IIEF-5 and DSCS scoring. (ii) "Remove erectile dysfunction from the list of operational definitions for now."$cm74$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st78$3.8 Data Management – Cardiometabolic Variables$st78$, $cm77$"How do you plan to rule out atherosclerosis, especially in the elderly? If lipid profile cannot be done, what about ankle-brachial index?"$cm77$, $at79$The cardiometabolic domain in this study is represented by three validated surrogate markers already included in the study protocol: body mass index (BMI), which captures adiposity-related metabolic risk; blood pressure, which captures hypertensive vascular burden; and fasting blood glucose, which captures dysglycaemic burden. The addition of lipid profiling or ankle-brachial index would introduce incremental financial and respondent time burden.$at79$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm77$"How do you plan to rule out atherosclerosis, especially in the elderly? If lipid profile cannot be done, what about ankle-brachial index?"$cm77$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st81$3.8 Statistical Analysis – Regression Model (Objective 4)$st81$, $cm80$Methodological refinement following supervisory review: On further methodological review, multivariable linear regression was confirmed as the appropriate method for Objective 4, with the IIEF-5 total score retained as a continuous dependent variable.$cm80$, $at82$Multivariable linear regression with IIEF-5 total score as the continuous dependent variable was confirmed as the appropriate analytical method for Objective 4. Retaining the full continuous range of the IIEF-5 preserves statistical information and directly estimates the magnitude of association between each predictor and erectile function across its full spectrum. The binary ED classification (IIEF-5 ≤21) is used solely for descriptive prevalence reporting in Objective 1 and does not serve as an outcome variable in any inferential analysis. Model specification, variable coding, assumption checks, and dummy tables are detailed in Appendix 9.$at82$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm80$Methodological refinement following supervisory review: On further methodological review, multivariable linear regression was confirmed as the appropriate method for Objective 4, with the IIEF-5 total score retained as a continuous dependent variable.$cm80$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st84$Appendix 1 – Informed Consent Form$st84$, $cm83$"Analysis of urine of participants — to what intent?"$cm83$, $at85$"Analysis of urine of participants" replaced with "screening for diabetes mellitus (fasting blood glucose)" in the informed consent form (Appendix 1) and its Yoruba translation (Appendix 4).$at85$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm83$"Analysis of urine of participants — to what intent?"$cm83$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st87$Appendix 3 – Questionnaire, Section B (IIEF-5)$st87$, $cm86$"Your tool is a Likert scale that is scored?" — queried the absence of scoring guidance. "That is a lot from this scale" — commenting on the ED classification footnote.$cm86$, $at88$Scoring footnote added under the IIEF-5 table: "Higher total IIEF-5 scores indicate better erectile function." The ED severity classification footnote was retained as it is clinically meaningful and consistent with validated IIEF-5 thresholds. The classification is presented for descriptive purposes only and does not constitute the primary analytical outcome variable.$at88$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm86$"Your tool is a Likert scale that is scored?" — queried the absence of scoring guidance. "That is a lot from this scale" — commenting on the ED classification footnote.$cm86$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st90$Appendices 7, 8, 9 – New Additions$st90$, $cm89$Assessor and Supervisor (combined): Detailed justification for sample size, sampling procedure, and analytical plan with dummy tables were required.$cm89$, $at91$Three new appendices added: Appendix 7 — Detailed sample size determination and justification (precision-based CI method, comparison of alternative methods, adequacy confirmed for all four objectives); Appendix 8 — Detailed sampling technique (systematic random sampling, random start procedure, replacement rule); Appendix 9 — Variable–objective alignment, analytical plan, and dummy tables (Tables 1–6) covering all four objectives with formulae, decision rules, and interpretation guides.$at91$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm89$Assessor and Supervisor (combined): Detailed justification for sample size, sampling procedure, and analytical plan with dummy tables were required.$cm89$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st93$References$st93$, $cm92$WACP Checklist: 15–30 references; none older than 10 years; ≥25% African/West African; Vancouver (ICMJE) style.$cm92$, $at94$References reviewed and revised for full Vancouver (ICMJE) compliance. General formatting standards applied for journal articles, book chapters, and internet/online sources per ICMJE/Vancouver conventions. Total references: 25. All published within 10 years. African/West African references: Refs 9–13, 19, 20, 22, 23 — 9 of 25 (36%), exceeding the 25% requirement.$at94$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm92$WACP Checklist: 15–30 references; none older than 10 years; ≥25% African/West African; Vancouver (ICMJE) style.$cm92$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_1', $st96$Word Count Alignment$st96$, $cm95$WACP Checklist targets: Background & Problem Statement <500 words; Gap to be Filled <100 words; Justification <250 words; Relevance to Family Medicine <250 words; Aims & Objectives <200 words; Literature Review <1,500 words; Methods <1,000 words.$cm95$, $at97$All sections within WACP word count targets (Microsoft Word count): Background & Problem Statement: 466 words; Gap to be Filled: 92 words; Justification: ~148 words; Relevance to Family Medicine: 74 words; Aims & Objectives: 157 words; Literature Review: 1,495 words; Methods: 999 words.$at97$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm95$WACP Checklist targets: Background & Problem Statement <500 words; Gap to be Filled <100 words; Justification <250 words; Relevance to Family Medicine <250 words; Aims & Objectives <200 words; Literature Review <1,500 words; Methods <1,000 words.$cm95$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st99$1.1 Introduction – Final Sentence$st99$, $cm98$"Complete this by giving a clear direction — how sexual communication interacts with ED — in one sentence."$cm98$, $at100$A closing sentence was added to the final paragraph of Section 1.1 stating the direction of the relationship and leading into the Problem Statement: "Poorer sexual communication is therefore increasingly recognised as a relational contributor to erectile dysfunction, with avoidance of sexual discussion linked to greater performance anxiety, delayed help-seeking, and poorer erectile outcomes." Supported by references already in use (Refs 6, 7, 15); no new reference added.$at100$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm98$"Complete this by giving a clear direction — how sexual communication interacts with ED — in one sentence."$cm98$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st102$1.3 Section Header$st102$, $cm101$Suggested changing the header from "Gap to be Filled by the Study" to "Rationale to be Filled by the Study."$cm101$, $at103$The header was retained as "Gap to be Filled by the Study." The WACP Faculty of Family Medicine Proposal Assessment Tool (Version 5.0, May 2025) lists two separate, independently scored items: Item 2(ii) "Gap to be filled by the study (<100 words)" and Item 2(iii) "Justification and Rationale (<250 words)." Section 1.3 is the Gap section and Section 1.4 is the Justification and Rationale section. Renaming Section 1.3 "Rationale" would remove the mandatory Gap heading and create two rationale sections, with a likely loss of marks under Item 2(ii). The rationale content is fully addressed in Section 1.4. This was discussed with the supervisor.$at103$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm101$Suggested changing the header from "Gap to be Filled by the Study" to "Rationale to be Filled by the Study."$cm101$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st105$1.4 Justification – Repetition$st105$, $cm104$Marked the clause on sociocultural norms discouraging open discussion of sexual concerns as a repetition of content already in Section 1.3.$cm104$, $at106$The repeated clause was removed. The sentence was rewritten as: "In Nigerian primary care, relational aspects of sexual functioning may remain unaddressed during clinical care, even though erectile dysfunction is highly prevalent." Citations 10 and 11 retained; no reference removed from the list. The Justification remains within the 250-word WACP limit.$at106$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm104$Marked the clause on sociocultural norms discouraging open discussion of sexual concerns as a repetition of content already in Section 1.3.$cm104$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st108$2.3 Erectile Dysfunction – Sentence Relocation$st108$, $cm107$On the closing sentence of Section 2.3 ("ED is therefore best understood as a biopsychosocial condition…"): "This will strengthen your justification, so it can be moved there."$cm107$, $at109$The biopsychosocial-framing sentence was deleted from Section 2.3 and relocated to Section 1.4 (Justification) as the closing sentence of the second paragraph, reworded to read: "Erectile dysfunction is therefore best understood as a biopsychosocial condition rather than a purely biomedical disorder, a framing that directly motivates examining its relational dimension in this population at this time." The phrases "in this population" and "at this time" were added to align with WACP Item 2(iii). Reference 5 retained.$at109$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm107$On the closing sentence of Section 2.3 ("ED is therefore best understood as a biopsychosocial condition…"): "This will strengthen your justification, so it can be moved there."$cm107$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st111$2.5 Relationship between Sexual Communication and Erectile Function$st111$, $cm110$It will be nice to also look for studies that gave contrast or equivocal opinion on the relationship between the two parameters for the dissertation.$cm110$, $at112$A balancing paragraph was added presenting contrasting and equivocal evidence: the modest magnitude of the sexual communication–erectile function association in the Mallory et al. meta-analysis relative to other domains of sexual function; and primary-study evidence that communication quality is more strongly tied to sexual and relationship satisfaction than to erectile function specifically, with its contribution potentially attenuated after adjustment for organic and psychological factors. This strengthens balance and equipoise (WACP Item 3) and supports the two-tailed hypothesis. Drawn from references already in use (Refs 15, 17); no new reference added.$at112$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm110$It will be nice to also look for studies that gave contrast or equivocal opinion on the relationship between the two parameters for the dissertation.$cm110$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st114$2.7.1 Study Tools – IIEF-5$st114$, $cm113$You need to know other relevant tools, so as to sustain your preference for this one.$cm113$, $at115$Section 2.7.1 was revised to situate the choice of the IIEF-5 within the wider landscape of erectile-function instruments — the full 15-item IIEF, the abridged IIEF-5, the single-item Erection Hardness Score, and the Sexual Health Inventory for Men (the IIEF-5 under an alternative name). The justification for selecting the IIEF-5 (domain-specific focus, validation in Nigerian men, multi-item reliability with brevity, short administration time) was retained and now follows an explicit comparison. Supported by Reference 21; no new reference added.$at115$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm113$You need to know other relevant tools, so as to sustain your preference for this one.$cm113$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st117$2.7.2 Study Tools – DSCS$st117$, $cm116$"Same as above comment" — i.e. demonstrate awareness of other sexual-communication instruments to sustain the preference for the DSCS.$cm116$, $at118$Section 2.7.2 was revised to name the available sexual-communication instruments — the Dyadic Sexual Communication Scale, the Sexual Communication Satisfaction Scale, and Couples' Communication subscales embedded in broader questionnaires — and to state explicitly why the DSCS was chosen: it measures the quality of dyadic sexual communication directly rather than satisfaction with it, is brief, is psychometrically robust, and has prior validation in comparable sociocultural settings. Supported by References 15 and 18; no new reference added.$at118$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm116$"Same as above comment" — i.e. demonstrate awareness of other sexual-communication instruments to sustain the preference for the DSCS.$cm116$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st120$3.3 Study Population – Age Threshold$st120$, $cm119$On "married men aged 25 years and above": "Why the choice of this age, any scientific reason?"$cm119$, $at121$A scientific rationale for the lower limit of 25 years was added: the median age at first marriage for Nigerian men is in the late twenties, so the threshold captures the great majority of married men while excluding an age band in which marriage is uncommon and any marital relationship would usually be too recent for stable patterns of sexual communication to have formed; the threshold is also consistent with the lower age limits used in Nigerian erectile dysfunction studies, preserving comparability (Refs 10, 11, 19). The absence of an upper age limit was retained, to reflect the full adult male clinic population and support generalisability.$at121$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm119$On "married men aged 25 years and above": "Why the choice of this age, any scientific reason?"$cm119$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st123$3.4 Sample Size – Correlation Coefficient$st123$, $cm122$(i) On r = 0.19: "rather weak correlation." (ii) On the source: "Not an Africa or a Nigeria study?"$cm122$, $at124$Section 3.4 was revised to defend the estimate rather than change it. The text now states that a structured literature search using the study search strategy identified no African or Nigerian study reporting a correlation coefficient between sexual communication and erectile function, and that the pooled estimate from the Mallory et al. meta-analysis (erectile function domain, r = 0.19) was therefore adopted as the most rigorous and conceptually aligned estimate available. The text further notes that a modest coefficient yields a conservative, larger required sample size and a well-powered study, consistent with WACP Item 4(v), which cautions against unjustifiable reduction of sample size. A corresponding sentence was added to Appendix 7, Section 7.3.$at124$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm122$(i) On r = 0.19: "rather weak correlation." (ii) On the source: "Not an Africa or a Nigeria study?"$cm122$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st126$3.4 Sample Size – Calculation Step$st126$, $cm125$In the calculation line, inserted "0.9639" beside the value 0.9291, implying the term should read 0.9639.$cm125$, $at127$The value 0.9291 was confirmed correct and retained; the inserted "0.9639" was not adopted. The formula term is (1 − r²)²: with r = 0.19, r² = 0.0361, (1 − r²) = 0.9639, and (1 − r²)² = 0.9639² = 0.9291. The figure 0.9639 is the intermediate value before squaring; 0.9291 is the squared term the formula requires. To make the step transparent, the stepwise lines in Section 3.4 were expanded to show both the un-squared (0.9639) and squared (0.9291) values explicitly. Final sample size n = 360 (400 after 10% non-response adjustment) is unchanged. Appendix 7, Section 7.3 already lists these steps correctly.$at127$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm125$In the calculation line, inserted "0.9639" beside the value 0.9291, implying the term should read 0.9639.$cm125$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st129$3.5 Sampling Technique$st129$, $cm128$(i) On "2,400 eligible patients": "Do you mean married men, currently-living-together data, or people with regular intercourse?" (ii) On "6–7 recruits per clinic day": "Stay with 7, because 6 will give 360 within this period."$cm128$, $at130$(i) Section 3.5 was rewritten to define "eligible patients" explicitly as married men living with a spouse who meet all stated inclusion criteria and attend the GOPC during the study period (approximately 800 per month over 3 months, giving a sampling frame of 2,400). (ii) The daily recruitment target was set to approximately 7 participants per clinic day over 60 clinic days, as advised. The sampling interval k = 6 was retained, the interval and the daily count being distinct quantities. Appendix 8 (Sections 8.5 and 8.7.2) was updated to 7 participants per clinic day for consistency.$at130$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm128$(i) On "2,400 eligible patients": "Do you mean married men, currently-living-together data, or people with regular intercourse?" (ii) On "6–7 recruits per clinic day": "Stay with 7, because 6 will give 360 within this period."$cm128$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st132$3.7.1 Operational Definitions – IIEF-5 Scoring$st132$, $cm131$(i) On the IIEF-5 ≤21 cut-off: "Why was this value picked, is this the standard way with this tool?" (ii) On "mild-to-moderate": "No in-between, you have to be specific." (iii) "Please be clear on the scoring of this instrument."$cm131$, $at133$The IIEF-5 operational definition was fully respecified. The instrument has five items, each scored 1 to 5, giving a total of 5 to 25, treated as a continuous outcome variable. The validated Rosen severity classification is now named explicitly and stated in full, including the previously unstated no-dysfunction band: no erectile dysfunction (22–25), mild (17–21), mild to moderate (12–16), moderate (8–11), severe (5–7). The text states that a score of 21 or below denotes erectile dysfunction of any severity and that 21 is the established boundary between the no-dysfunction and mildest-dysfunction bands, not an arbitrary value (Ref 21). The "mild to moderate" band was retained as a named category of the validated classification and rendered without the ambiguous hyphenation. The categorical classification is used for secondary descriptive reporting only; the continuous score remains the analytical outcome.$at133$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm131$(i) On the IIEF-5 ≤21 cut-off: "Why was this value picked, is this the standard way with this tool?" (ii) On "mild-to-moderate": "No in-between, you have to be specific." (iii) "Please be clear on the scoring of this instrument."$cm131$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st135$3.7.1 Operational Definitions – Binary Variable Coding$st135$, $cm134$On the binary lifestyle and medication definitions: "Can be scored too as 1 or 0."$cm134$, $at136$Stray comment fragments were removed from the binary-variable definitions and the three bullets (current smoking, current alcohol use, medication use) were restored to clean wording. A summary sentence was added to the operational-definitions list: "All binary variables are coded 1 for the index category and 0 for the reference category, for entry into the multivariable model." The full 1/0 coding scheme was already specified in Appendix 9, Section 9.8.2.$at136$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm134$On the binary lifestyle and medication definitions: "Can be scored too as 1 or 0."$cm134$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st138$3.8 Data Management – Objective 3 (Dyad)$st138$, $cm137$On the Objective 3 heading: "Dyad you mentioned earlier — will the communication also capture their partners?"$cm137$, $at139$A clarifying sentence was added in-text as the first line under Objective 3: sexual communication is measured from the male participant only; each man independently completes the Dyadic Sexual Communication Scale, capturing his own perception of sexual communication within his marriage, and partners are not recruited or assessed. Although addressed in the previous synopsis, the clarification is now stated within the proposal itself so the document stands on its own.$at139$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm137$On the Objective 3 heading: "Dyad you mentioned earlier — will the communication also capture their partners?"$cm137$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st141$3.8 Data Management – Objective 3 (Variable Type)$st141$, $cm140$On the Objective 3 analysis paragraph: "So they must be used here as quantitative variables."$cm140$, $at142$The first sentence of the Objective 3 analysis paragraph was revised to state explicitly that both the DSCS total score and the IIEF-5 total score are treated as continuous quantitative variables, before describing the use of Pearson's or Spearman's correlation. The bootstrapped 95% confidence interval procedure is unchanged.$at142$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm140$On the Objective 3 analysis paragraph: "So they must be used here as quantitative variables."$cm140$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st144$Appendix 1 – Informed Consent (Double Capture)$st144$, $cm143$On the Confidentiality clause: "How will you avoid double capturing of participants?"$cm143$, $at145$A prevention mechanism was added to Section 3.7 (Data Collection Methods): at recruitment, each man is asked whether he has previously participated, and his hospital number is checked against a secure enrolment log of hospital numbers held separately from the de-identified study data; any man already enrolled is not recruited again. A short explanatory clause was added to the Confidentiality paragraph of Appendix 1 and its Yoruba translation (Appendix 4). The hospital number is used only for this check and is not stored on the coded questionnaire, preserving confidentiality.$at145$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm143$On the Confidentiality clause: "How will you avoid double capturing of participants?"$cm143$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st147$Appendix 3, Section B – IIEF-5 Maximum Score$st147$, $cm146$On the "Total Score" line: "So the highest possible score is 5 per question and 25 in total — kindly capture this in your method."$cm146$, $at148$The Total Score line under the IIEF-5 table was revised to read "Total Score (out of a maximum of 25)." The scoring is also now captured in the methods: the revised IIEF-5 operational definition in Section 3.7.1 states that the instrument has five items each scored 1 to 5, giving a total of 5 to 25.$at148$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm146$On the "Total Score" line: "So the highest possible score is 5 per question and 25 in total — kindly capture this in your method."$cm146$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st150$Appendix 3, Section C – DSCS Maximum Score$st150$, $cm149$On the "Total Score" line: "What is the highest possible score?"$cm149$, $at151$The Total Score line under the DSCS table was revised to read "Total Score (out of a maximum of 78)." The DSCS has 13 items each scored 1 to 6, giving a range of 13 to 78, as already stated in Sections 3.6 and 3.7.1.$at151$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm149$On the "Total Score" line: "What is the highest possible score?"$cm149$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st153$Appendix 3, Section E – Chronic Illness Item$st153$, $cm152$On "Any history of chronic illness? Y/N": "How will the patient understand this? A bit abstract — why not HTN or DM?"$cm152$, $at154$The abstract item was replaced with explicit, patient-friendly tick options: "Have you ever been told by a doctor that you have any of the following?" listing high blood pressure (hypertension) and diabetes (high blood sugar) as named Yes/No items, followed by an "any other long-term illness" Yes/No item with a specify line. This aligns with the "Chronic Illness" operational definition in Section 3.7.1 (physician-diagnosed hypertension and diabetes). The equivalent change was applied to the Yoruba questionnaire (Appendix 6).$at154$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm152$On "Any history of chronic illness? Y/N": "How will the patient understand this? A bit abstract — why not HTN or DM?"$cm152$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st156$References – Consistency Check$st156$, $cm155$WACP Checklist: 15–30 references; none older than 10 years; ≥25% African/West African; Vancouver (ICMJE) style.$cm155$, $at157$No new references were required; all Part C corrections draw on references already in the list, leaving the Vancouver numbering and every superscript undisturbed. The reference count remains 25, with 9 African/West African references (36%), satisfying WACP Item 5. One consistency correction was made: the Mallory et al. (2019) meta-analysis is cited identically in the main reference list and in Appendix 7, using the form "J Sex Res. 2019;56(7):882–98."$at157$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm155$WACP Checklist: 15–30 references; none older than 10 years; ≥25% African/West African; Vancouver (ICMJE) style.$cm155$
);

INSERT INTO research_correction_logs (workspace_id, comment_source, section_topic, original_comment, action_taken, status)
SELECT 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5', 'supervisor_round_2', $st159$Word Count Re-verification$st159$, $cm158$WACP Checklist targets: Justification <250 words; Literature Review <1,500 words; Methods <1,000 words.$cm158$, $at160$All sections affected by Part C corrections were re-counted in Microsoft Word after editing. The Justification remains within 250 words (Items on Sections 1.4 and 2.3 are word-neutral overall). The Literature Review was kept within 1,500 words by offsetting the new contrasting-evidence paragraph in Section 2.5 with the trimming of redundant wording in the same section. The Methods chapter was kept within 1,000 words; where Part C additions increased length, compensating trims were made to verbose operational-definition bullets, with fuller detail retained in the appendices, which carry no word limit.$at160$, 'resolved'
WHERE NOT EXISTS (
  SELECT 1 FROM research_correction_logs
  WHERE workspace_id = 'cf65cb21-1cd1-4cff-9c87-a0a4f42faaa5' AND original_comment = $cm158$WACP Checklist targets: Justification <250 words; Literature Review <1,500 words; Methods <1,000 words.$cm158$
);

-- --------------------------------------------------
-- 4. CLINICAL CASE REPORTS (workspace "My PMRs", 3 rows)
-- --------------------------------------------------

-- Case 1 thematic_area = 'internal_medicine' (see reasoning comment above this section's cases[] entry in the generator, mirrored inline in the header block).
INSERT INTO clinical_case_reports (workspace_id, case_number, thematic_area, title, patient_initials, hospital_number, age, gender, point_of_care, presenting_complaints, hpi_text, history_notes, examination_notes, pccm_framework, management_plan, discussion_text, references_text, status)
VALUES (
  '7ec2aa44-6104-470c-9276-46d5ef960052',
  1,
  'internal_medicine',
  $ctitle161$STROKE IN A KNOWN HYPERTENSIVE FARMER: DELAYED HEALTH-SEEKING BEHAVIOUR AND THE ROLE OF FAMILY SUPPORT IN RECOVERY.$ctitle161$,
  $cpi162$A.O.$cpi162$,
  $chn163$VBMC/028583$chn163$,
  62,
  $cgen164$Male$cgen164$,
  $cpoc165$Vine Branch Medical Centre, Ibadan$cpoc165$,
  $cpc166$Weakness of the left side of the body for 4 days duration, slurred speech of 4 days duration$cpc166$,
  $chpi167$He was apparently well until 4 days prior to presentation when he woke up in the morning with sudden onset weakness of the left upper and lower limbs. The weakness was non-progressive after onset. There was no loss of consciousness, seizures, headache, vomiting, or visual loss. There was associated difficulty speaking (slurred speech) of the same onset. He was able to communicate, though words were unclear. He could recognise people, see clearly, and walk short distances with support (a stick and assistance). There was no bowel or urinary incontinence. The evening before the event, he had been working on his farm in Ikire. He reported mild fatigue but no unusual headache, chest pain, or palpitations. He ate supper and retired to bed. He had not taken his antihypertensive medication (Amlodipine 10 mg) for approximately one week before the onset of symptoms, attributing this to exhausting his pills and not yet obtaining a refill. At onset of symptoms, he was taken by his wife and a neighbour to a Primary Health Centre (PHC) in Ikire, where his blood pressure was noted to be elevated (exact value not recalled, though the patient was told it was 'very high'). He was given a single dose of Amlodipine 10 mg, prescribed Neurovite, and treated empirically for malaria with an artemisinin-based combination therapy. He was verbally advised to present to a tertiary facility. Rather than presenting immediately to a tertiary centre, he and his family sought spiritual intervention, visiting his church pastor in Ikire for prayers on the first day after the PHC visit. This decision was influenced by his wife and a maternal aunt, both of whom believed the illness had a spiritual dimension. After about 2 days with no objective improvement, and still unable to use his left hand and continued to have slurred speech, he decided to present at the facility of care.$chpi167$,
  $chn2168${"ros":"No vertigo, hearing loss, or tremor. There was no exertional dyspnoea, orthopnoea, paroxysmal nocturnal dyspnoea, leg swelling, claudication, or syncope. No cough, haemoptysis, wheeze, or night sweats. No nausea, vomiting, abdominal pain, haematemesis, altered bowel habit, melaena, rectal bleeding, or jaundice. No dysuria, haematuria, frequency, or urinary incontinence. No joint pain or swelling. No polyuria, polydipsia, excessive sweating, heat or cold intolerance, or weight change. No easy bruising or excessive bleeding.","past_med_surg":"He was a known hypertensive for approximately 7 years, previously prescribed Amlodipine 10 mg daily at a PHC, with refills obtained intermittently. He admitted to frequent medication non-adherence due to occasional pill exhaustion and the belief that he felt well when he skipped doses. He had no prior stroke, transient limb weakness, visual loss, or slurred speech. There was no known diagnosis of diabetes mellitus, dyslipidaemia, or renal disease. He had no prior hospitalisation. No history of surgery or blood transfusion.","drug_allergy":"He was on Amlodipine 10 mg daily, with a history of non-adherence. He had no known food or drug allergy.","family_social":"He was married in a monogamous setting to a 52-year-old trader, with three children. The eldest, a son aged 31 years, was married with a 3-year-old son. The second child, a daughter aged 28 years and a fashion designer, was married to a 32-year-old electrical technician with a 4-year-old daughter; the patient was residing with this daughter at Ring Road, Ibadan at the time of care. The youngest child, a daughter aged 25 years, was a graduate and currently single. Both the patient and his wife had secondary-level education. The household's primary income was from seasonal farming, with the patient as the sole income earner. There was no health insurance; healthcare financing was entirely out-of-pocket with partial external support from a paternal uncle resident in the United Kingdom. Source of drinking water was sachet water, with well water used for cooking. Sewage disposal was via water closet. He was a social drinker, consuming local palm wine approximately once weekly, a non-smoker, and no history of use of illicit substances. His diet was predominantly carbohydrate-rich (eba, rice, yam), with vegetable and red meat intake, low fruit consumption. He engaged in physical activity through daily farming five to six days per week prior to the onset of symptoms. There was a family history of hypertension in his mother and an older brother."}$chn2168$::jsonb,
  $cex169${"general":"He walked into the consulting room with the support of his son-in-law. He was not pale, anicteric, or cyanosed. He was afebrile (36.5°C), well-hydrated, with no finger clubbing, peripheral oedema, or lymphadenopathy. He weighed 68 kg, his height was 1.72 m, and his BMI was 23.1 kg/m² (normal).","systems":"Central Nervous System: He was conscious and alert, oriented in time, place, and person with a GCS of 15/15. Attention, concentration, and memory for recent and remote events were intact. There was no neck stiffness, Kernig's sign was negative, and Brudzinski's sign was negative. Cranial nerve examination revealed intact smell sensation and grossly intact visual acuity bilaterally. Pupils were equal (3 mm), round, and reactive to light bilaterally. No nystagmus or ptosis was noted. There was flattening of the left nasolabial fold and drooping of the left angle of the mouth with preserved bilateral forehead wrinkling. Hearing was grossly intact bilaterally. Speech was slurred and slow. Motor examination revealed increased tone in the left upper and lower limbs. Clonus was not elicited. Muscle bulk was globally preserved with no wasting. Power was 5/5 in both the right upper and lower limbs, and 3/5 in both the left upper and lower limbs. Deep tendon reflexes (biceps, triceps, knee, and ankle) were brisk on the left side. Plantar response was extensor (upgoing Babinski sign) on the left and flexor on the right. Crude touch and light touch sensation were intact; subjective pain sensation was slightly reduced on the left side. Gait was staggering, broad-based, with circumduction of the left lower limb. The NIHSS score at presentation was 4 (mild), with points for facial paresis, arm drift, leg drift, and dysarthria. Cardiovascular System: Pulse was 88 bpm, regular, of good volume, with no radio-radial or radio-femoral delay. Blood pressure was 130/86 mmHg. JVP was not elevated. The apex beat was displaced 1 cm laterally to the left mid-clavicular line in the 5th intercostal space, consistent with left ventricular hypertrophy. No heaves or thrills were noted. The 1st and 2nd heart sounds were heard with no additional sounds or murmurs. Peripheral pulses were intact and equal in all four limbs. Respiratory System: Respiratory rate was 18 cycles/minute. The trachea was central and chest expansion was symmetrical. Percussion was resonant bilaterally. Auscultation revealed vesicular breath sounds with no added sounds. Abdominal Examination: The abdomen was flat and moved with respiration. There was no tenderness on palpation, no organomegaly, and no ascites. Bowel sounds were present and normal."}$cex169$::jsonb,
  $cpccm170${"fife":"He expressed significant fear and embarrassment about the sudden loss of his physical abilities. He and his wife initially attributed the episode to a spiritual attack, partly due to its sudden and dramatic onset. He was uncertain whether the episode was related to his known blood pressure problem. The symptoms had stopped his farming activities entirely, and he was dependent on others for self-care, including bathing and dressing. He hoped to recover and return to his farm, and expected to be administered injections to resolve the weakness.","common_ground":"About his decision to seek spiritual intervention before presenting to a medical facility, it was acknowledged that his faith was an important part of his identity and coping, and that spiritual support could coexist with medical care. However, it was explained clearly that in stroke, time is brain — every hour of delay in treatment increases the extent of irreversible neurological damage. His expectation of receiving \"injections to fix the weakness\" was gently corrected; it was explained that stroke recovery is a gradual process requiring sustained effort, medication, rehabilitation, and family involvement, rather than a single curative intervention.","whole_person":"As a sole income earner at Duvall's Stage 7 (middle-aged family), his sudden physical dependence represented a significant financial threat to his household. He was counselled to explore support, including from his paternal uncle who had been supportive. His daughter and son-in-law, with whom he was residing, were identified as his primary caregivers and were counselled on supporting his recovery, monitoring his medications, and encouraging timely follow-up.","health_promotion":"Dietary counselling was reinforced in the context of his eating habits as captured in the history: he was advised to moderate his red meat consumption, reduce salt intake, increase fruits and vegetables, and reduce refined carbohydrates where feasible. His social palm wine consumption was discouraged, given the cardiovascular implications of alcohol in a hypertensive stroke patient. Home-based physical rehabilitation was introduced; he was encouraged to begin gentle upper limb coordination activities such as table tennis ball rolling and egg-passing exercises using his left hand, to stimulate motor recovery through repetitive task training. Secondary stroke prevention was discussed: the importance of lifelong antihypertensive therapy, avoidance of medication gaps, blood pressure self-monitoring, and regular medical follow-up were emphasised. The family history of hypertension in his older brother and mother was noted, and his daughter and son-in-law were counselled on their own cardiovascular risk and encouraged to have their blood pressures checked regularly."}$cpccm170$::jsonb,
  $cmgmt171${"definitive":"The need for investigations was discussed and he gave consent. The following were requested: urgent non-contrast CT scan of the brain; fasting lipid profile (FLP); fasting blood glucose (FBG); full blood count (FBC); urea, electrolytes and creatinine (U&E/Cr); electrocardiogram (ECG); and echocardiogram. A urinalysis performed at the point of care showed no proteinuria, no haematuria, and no glucosuria; other parameters were essentially normal. He was commenced on Tab Amlodipine 10 mg daily (continuing his prior prescription) with strict emphasis on uninterrupted adherence. Antiplatelets and statin therapy were deferred pending neuroimaging results to confirm stroke type. Neuro-supportive supplementation with Vitamin C 1g daily and Vitamin E 400 IU was initiated. He was advised on adequate hydration and early mobilisation with caution. Given his stable neurological status, ability to ambulate with support, absence of dysphagia, and the presence of a responsible caregiver at his place of residence, a decision was made to manage him as an outpatient. CT brain confirmed a right-sided ischaemic infarct with no evidence of haemorrhage. FLP showed dyslipidaemia (Total Cholesterol 224 mg/dL, LDL 151 mg/dL, HDL 35 mg/dL, Triglycerides 186 mg/dL). A definitive diagnosis of right-sided ischaemic stroke secondary to hypertension with dyslipidaemia was made. Tab Aspirin 75 mg daily was commenced as antiplatelet therapy, and Tab Atorvastatin 40 mg nightly was initiated targeting an LDL of less than 70 mg/dL.","post_op_follow_up":"First Follow-up (14/10/2025): BP 128/82 mmHg; CT and ECG results reviewed; Aspirin and Atorvastatin commenced. Second Follow-up (20/10/2025): noticeable improvement in left hand grip, speech clearer, BP 124/80 mmHg, power improved to 4/5; echocardiogram showed concentric LVH with preserved EF (58%); referral made to physiotherapist. Third Follow-up (03/11/2025): continued improvement, independent in some ADLs, BP 122/78 mmHg, power 4+/5, attended two physiotherapy sessions. Fourth Follow-up (01/12/2025): walking without support for the first time since the stroke, BP 118/76 mmHg, power 5/5 lower limb and 4+/5 upper limb, speech near-normal, repeat FLP improved (Total Cholesterol 186 mg/dL, LDL 75 mg/dL). Fifth Follow-up (08/01/2026, virtual): feeling well, returned to light farming, consistent medication adherence, attending physiotherapy fortnightly, no recurrence of symptoms.","cost_considerations":"Management as an outpatient was also guided by the practical consideration of his financial constraints and lack of health insurance. Healthcare financing was entirely out-of-pocket with partial external support from a paternal uncle resident in the United Kingdom; the family was encouraged to continue leveraging this support for medications and physiotherapy."}$cmgmt171$::jsonb,
  NULL,
  NULL,
  'draft'
)
ON CONFLICT (workspace_id, case_number) DO UPDATE SET
  thematic_area = EXCLUDED.thematic_area,
  title = EXCLUDED.title,
  patient_initials = EXCLUDED.patient_initials,
  hospital_number = EXCLUDED.hospital_number,
  age = EXCLUDED.age,
  gender = EXCLUDED.gender,
  point_of_care = EXCLUDED.point_of_care,
  presenting_complaints = EXCLUDED.presenting_complaints,
  hpi_text = EXCLUDED.hpi_text,
  history_notes = EXCLUDED.history_notes,
  examination_notes = EXCLUDED.examination_notes,
  pccm_framework = EXCLUDED.pccm_framework,
  management_plan = EXCLUDED.management_plan,
  discussion_text = EXCLUDED.discussion_text,
  references_text = EXCLUDED.references_text,
  status = EXCLUDED.status;

-- Case 2 thematic_area = 'family_case_study' (see reasoning comment above this section's cases[] entry in the generator, mirrored inline in the header block).
INSERT INTO clinical_case_reports (workspace_id, case_number, thematic_area, title, patient_initials, hospital_number, age, gender, point_of_care, presenting_complaints, hpi_text, history_notes, examination_notes, pccm_framework, management_plan, discussion_text, references_text, status)
VALUES (
  '7ec2aa44-6104-470c-9276-46d5ef960052',
  2,
  'family_case_study',
  $ctitle172$BEYOND THE SYMPTOMS: A FAMILY-CENTERED APPROACH TO MANAGING PEDIATRIC ANGIOEDEMA AND MARITAL STRAIN$ctitle172$,
  $cpi173$N.D.$cpi173$,
  $chn174$1492656$chn174$,
  9,
  $cgen175$Male$cgen175$,
  $cpoc176$General Outpatient Clinic, University College Hospital (UCH), Ibadan.$cpoc176$,
  $cpc177$Recurrent swelling of the face, around the both eyes and lips for 2 months.$cpc177$,
  $chpi178$N.D. was well until about 2 months before presentation when he developed sudden onset swelling of the face, around both eyes and lips. The first episode occurred in the evening after dinner. There was associated pruritus. There was also associated pain with the swelling, with a pain score of about 6/10. Associated history of fever, low grade, intermittent, temporarily relieved with 500mg of paracetamol tablet. No associated history of cough, noisy breathing, red eye, visual disturbance, or rhinorrhea. No associated history of abdominal pain, nausea, vomiting, or diarrhea. No history of use of any medication before the onset of symptoms. No history of trauma to the face, no history of insect bite. The symptoms gradually resolved the following day. However, symptoms reoccurred, usually in the evenings after dinner, after a few days of resolutions. N.D. was started on some medications (paracetamol, vit C) gotten from a patent medicine store, and on some herbal medications obtained by his father. However, N.D. did not get better.$chpi178$,
  $chn2179${"ros":"N.D had no history of weight loss or fatigue. No history of chest pain or palpitations. No complaints of dysuria, hematuria, reduction in urine output, or urinary frequency. No history of seizures, headaches, or dizziness. No complaints of joint pain, stiffness, or muscle weakness.","past_med_surg":"Pregnancy, Birth, and Neonatal History: The child was born at term following an uneventful pregnancy with regular antenatal care. Labor was spontaneous, and vaginal delivery was uncomplicated. He cried immediately after birth. The neonatal period was uneventful, with no jaundice, infections, or respiratory distress. The child was exclusively breastfed for six months and received immunizations according to the NPI schedule; the BCG scar was sighted on the upper left arm. Developmental History: He achieved developmental milestones appropriately — smiled socially by 6 weeks, sat without support by 6 months, crawled by 9 months, walked independently by 12 months; speech development was normal. Past Medical History: He was not a known asthmatic or sickle cell disease patient. He had no known history of hospitalizations, surgery, or blood transfusion. His blood group was O positive, and his genotype was AA.","drug_allergy":"He was not on any routine drugs and had no known allergies before the onset of symptoms.","family_social":"N.D. was the 3rd child in a monogamous family of 3 children. His father is a 49-year-old businessman, and his mother is a 42-year-old trader. They both have a secondary school certificate. There is a history of exaggerated skin wheals in the father following insect bites. His two older siblings, a 13-year-old female and an 11-year-old female, were both well and alive with no history of similar symptoms. There were no bushes or stagnant water around their house. Their source of drinking water was borehole tap water, and sewage disposal was by water closet system via septic tank. The source of healthcare financing was out of pocket."}$chn2179$::jsonb,
  $cex180${"general":"N.D. was alert and in no obvious distress, though anxious due to recurrent swelling episodes. He was afebrile (temperature: 36.8°C), anicteric, acyanosed, well hydrated, and had nil pedal edema.","systems":"Central Nervous System: No neck stiffness. Normal tone, reflexes, and gait. Musculoskeletal System: He had no deformity, swelling, or tenderness across any limbs or joints. Ear, Nose, and Throat Examination: Bilaterally, he had no tragal tenderness, the external auditory canals were clear, and the tympanic membranes were seen intact and shiny. His nostrils were patent, and turbinates were not engorged. His pharynx appeared normal, and his tonsils were not enlarged. Respiratory System: His respiratory rate was 20 breaths/minute. Chest expansion and air entry were equal bilaterally. His breath sounds were vesicular, and there were no added sounds. SpO2 in room air was 99%. Cardiovascular System: His pulse rate was 88 beats/minute. The apex beat was located in the 5th left intercostal space mid-clavicular line. Normal first and second heart sounds were heard and there was no murmur. Abdomen: His abdomen was full, moved with respiration, and soft with no area of tenderness. The liver and spleen were not palpably enlarged, and the kidneys were not ballotable.","local_specialized":"Skin: Non-pitting swelling of the face around the lower eyelids and lips. Smooth, soft, mild tenderness. No rashes, bruising, or ulcerations were noted."}$cex180$::jsonb,
  $cpccm181${"fife":"The parents expressed fear and anxiety over their child's recurrent condition. The father believed that the child's illness might have a spiritual or supernatural cause, prompting them to seek traditional medicine. They thought the symptoms might be beyond conventional medical treatment, reinforcing their anxiety. Parental conflict impacted decision-making, delaying appropriate medical care. The boy's schooling and daily activities were affected due to recurrent symptoms. The parents hoped for a definitive cure and reassurance about the child's health. They sought guidance on managing the illness and preventing recurrence. The couple needed support in improving their relationship and coping with stress.","common_ground":"After explaining the nature of the diagnoses and the need for basic investigations and at cost affordable to patient's caregivers, a common ground was reached to request the following investigations. Because his symptoms became recurrent before presentation, with the associated parental anxiety leading to marital disharmony and a mother's family APGAR score of 6/10, the author discussed with the wife the possibility of inviting her husband to follow her and her son to the next follow-up visit in 2 days. A common ground was reached to invite the husband for the next visit.","whole_person":"Mother's initial Family APGAR score was 6/10 (moderately dysfunctional family): Adaptability 2/2, Partnership 1/2 (communication struggles, especially in high-stress situations), Growth 1/2 (emotional and personal growth affected by family tensions), Affection 1/2 (limited, with emotional distance at times), Resolve 1/2 (dedicated but struggles with conflict resolution). Father's APGAR at first follow-up was also 6/10 (moderately dysfunctional). Couples counselling was conducted for the parents in a private, supportive setting, addressing the father's initial belief in a spiritual cause and the resulting delays in seeking medical care, communication breakdowns, and stress-induced rigidity. By the second follow-up, both parents' Family APGAR scores had improved to 8/10 (highly functional family), with good cooperation, communication, and adaptability, though affection and conflict resolution were noted as areas that could be further improved.","health_promotion":"During counselling, it was elicited that a particular vegetable (chaya leaf) was introduced to the family meal, and the onset of symptoms is usually after meals with the particular vegetable. He was advised to open a trigger chart/diary for surveillance. It was explained that the onset of symptoms is usually between 0 to 1 hour after exposure to triggers and resolves gradually over 1 to 2 days. He was also counselled on identifying and avoiding triggers. The author wrote a note to N.D.'s school to ensure support for any missed education."}$cpccm181$::jsonb,
  $cmgmt182${"definitive":"Investigations: FBC showed WBC 8.84 x 10^3 with eosinophilia (3.2%, elevated against a reference range of 0.04–0.45%), PCV 33.1%, Platelet 359 x 10^3; E, U and Cr normal; urinalysis essentially normal; blood allergy testing deferred due to cost. The eosinophilia supported an allergic reaction. He was placed on medications: P.O. cetirizine 10mg daily for 5 days, P.O. prednisolone 10mg daily for 3 days.","post_op_follow_up":"1st follow-up visit (10/1/2025): facial and lip swelling significantly resolved, with mild residual swelling of the right lower eyelid and lower lip and occasional pruritus; completed prednisolone and cetirizine courses. Second follow-up/1-month follow-up (13/2/2025): N.D. was asymptomatic with no complaints and had been maintaining a trigger diary as advised. Planned follow-up at 6 months and 12 months.","cost_considerations":"After explaining the nature of the diagnoses and the need for basic investigations at a cost affordable to the patient's caregivers, a common ground was reached on which investigations to pursue. Blood allergy testing could not be done due to cost, and the patient was advised to hold off while other tests were reviewed, with allergy testing to be reconsidered if symptoms persisted."}$cmgmt182$::jsonb,
  NULL,
  NULL,
  'draft'
)
ON CONFLICT (workspace_id, case_number) DO UPDATE SET
  thematic_area = EXCLUDED.thematic_area,
  title = EXCLUDED.title,
  patient_initials = EXCLUDED.patient_initials,
  hospital_number = EXCLUDED.hospital_number,
  age = EXCLUDED.age,
  gender = EXCLUDED.gender,
  point_of_care = EXCLUDED.point_of_care,
  presenting_complaints = EXCLUDED.presenting_complaints,
  hpi_text = EXCLUDED.hpi_text,
  history_notes = EXCLUDED.history_notes,
  examination_notes = EXCLUDED.examination_notes,
  pccm_framework = EXCLUDED.pccm_framework,
  management_plan = EXCLUDED.management_plan,
  discussion_text = EXCLUDED.discussion_text,
  references_text = EXCLUDED.references_text,
  status = EXCLUDED.status;

-- Case 3 thematic_area = 'child_health' (see reasoning comment above this section's cases[] entry in the generator, mirrored inline in the header block).
INSERT INTO clinical_case_reports (workspace_id, case_number, thematic_area, title, patient_initials, hospital_number, age, gender, point_of_care, presenting_complaints, hpi_text, history_notes, examination_notes, pccm_framework, management_plan, discussion_text, references_text, status)
VALUES (
  '7ec2aa44-6104-470c-9276-46d5ef960052',
  3,
  'child_health',
  $ctitle183$PEDIATRIC SCALD INJURY IN PRIMARY CARE: CLINICAL MANAGEMENT AND HOME SAFETY INTERVENTIONS$ctitle183$,
  $cpi184$G.C.$cpi184$,
  $chn185$025072$chn185$,
  15,
  $cgen186$Male$cgen186$,
  $cpoc187$Vine Branch Medical Centre, Ibadan$cpoc187$,
  $cpc188$15-month-old male. Burn injury to the anterior chest and upper abdomen of one-hour duration. (Note: the `age` field on this record is stored in months, not years -- schema has no separate age-unit column.)$cpc188$,
  $chpi189$G.C. was apparently well until about one hour prior to presentation, when he sustained a burn injury at home. According to the mother, she was bathing the patient's older sibling in the bathroom when G.C. crawled into the area unnoticed. A bucket containing recently heated water used for bathing was placed on the floor. The child reportedly pulled the bucket, causing hot water to spill over his anterior chest and upper abdomen. The child cried immediately and persistently. The mother promptly picked him up and placed him under running tap water, after which she applied baby oil to the affected areas. Due to persistent crying and visible skin injury, she brought the child to the emergency unit. There was no loss of consciousness, no vomiting, no seizure activity, and no respiratory distress. No other body parts were affected.$chpi189$,
  $chn2190${"ros":"No cough or breathing difficulty. The child had been feeding well prior to the injury. He was alert and crying appropriately. No vomiting, seizures, or loss of consciousness.","past_med_surg":"He had no previous hospital admissions or surgeries. No known medical condition. Pregnancy, Birth and Neonatal History: The antenatal period was supervised, and the pregnancy was uneventful. He was delivered at term via spontaneous vaginal delivery. There were no neonatal complications. Immunization History: His immunizations were up to date for age according to the National Programme on Immunization schedule. Nutritional History: He was exclusively breastfed for the first six months of life and was currently on appropriate complementary feeding, with no feeding difficulties. Developmental History: Developmental milestones were appropriate for age. He crawled and walked with support, used a few meaningful words, and was socially interactive.","family_social":"G.C. lived with both parents and two older siblings, a 3-year-old male and a 6-year-old male, in a two-bedroom apartment. His mother, a 32-year-old provisions trader with secondary school education, was the primary caregiver, while his father, a 39-year-old electrical materials trader with secondary school education, was the family breadwinner. Bathing of the younger children was routinely carried out at floor level in the bathroom, using recently heated water stored in a small bucket and applied sequentially to each child. Healthcare financing was out of pocket. Home Injury Prevention and Safety Assessment: identified modifiable environmental and supervision-related risk factors, including floor-level bathing practices, storage of recently heated water in an open bucket within the child's reach, unrestricted toddler access to the bathroom during sibling bathing, and caregiver multitasking in the absence of physical safety barriers. Assessment for non-accidental injury revealed no delay in presentation, a burn pattern compatible with an accidental spill mechanism, absence of injuries to typically protected areas (such as the back, buttocks, perineum, or inner thighs), and no history of prior unexplained injuries."}$chn2190$::jsonb,
  $cex191${"general":"G.C. was conscious and alert. He was crying but consolable and appeared to be in painful distress. He was afebrile. He was not pale, not dehydrated, cyanosed, or jaundiced. His weight was 12 kg (114% of expected weight for age, normal). Vital signs: Temperature 36.6°C, heart rate 122 beats/min, respiratory rate 28/min, oxygen saturation 98% on room air.","systems":"Respiratory System: Breath sounds were vesicular with good air entry bilaterally and no added sounds. Cardiovascular System: Heart sounds were normal with no murmurs. Abdomen: The abdomen was soft, not distended, and non-tender on gentle palpation, with no palpable organomegaly. Central Nervous System: G.C. was alert, with no focal neurological deficits.","local_specialized":"Local Examination (Burn Assessment): Revealed patchy areas of erythema and blistering with partial epidermal loss involving the anterior chest wall and upper abdomen. Areas of ruptured blisters exposed a moist, pink dermal surface, with surrounding erythema. There was no purulent discharge or foul smell. Burn extent was approximately 4–5% total body surface area (TBSA), estimated using the palmar method, with the child's palm."}$cex191$::jsonb,
  $cpccm192${"fife":"The mother expressed significant anxiety about the injury. She believed the burn might be severe with a risk of permanent scarring. She was concerned about its possible effect on the child's recovery and normal activities and wanted to know if hospital admission or surgery would be necessary.","common_ground":"The diagnosis, expected healing course, and outpatient management plan were explained to the caregiver, with specific attention to her concerns about pain, scarring, and the need for hospital admission. Agreement was reached on outpatient care with close follow-up.","whole_person":"G.C. lived with both parents and two older siblings in a two-bedroom apartment; his mother was the primary caregiver and his father the family breadwinner, with healthcare financing entirely out of pocket. Medication choices were guided by effectiveness, availability, affordability, and expected adherence in an out-of-pocket payment setting.","health_promotion":"Counselling focused on both wound care and prevention of recurrence. The caregiver was educated on signs of complications requiring urgent review, including increasing pain, discharge, fever, or delayed healing. Practical burn prevention advice was provided, based on identified home risk factors: avoiding floor-level bathing, storing hot water in closed containers kept above floor level, closing bathroom doors during sibling bathing, bathing children one at a time when possible, and ensuring the younger child is supervised by another caregiver when attention is focused elsewhere. Anticipatory guidance was also provided regarding increasing toddler mobility and the need for age-appropriate supervision as the child grows."}$cpccm192$::jsonb,
  $cmgmt193${"definitive":"Initial wound care was performed on the day of presentation: the burn wounds were gently cleansed with normal saline, non-viable blister roofs were removed, and a sofratulle dressing was applied as the primary contact layer, then covered with absorbent gauze and a crepe bandage. The wound care procedure was demonstrated to the nursing staff on the first day. Subsequently, the patient returned for alternate-day dressing changes, reviewed by the author with dressing continued by nursing staff under supervision. Medications: syrup ibuprofen 120 mg three times daily for four days for pain control, and syrup vitamin C 5 mL daily for five days to support wound healing.","post_op_follow_up":"Clinic follow-up (Day 9 – 23/10/2025): good epithelialisation of the burn areas with no ulceration or secondary infection; child active and playful; wound dressing discontinued. Second follow-up (virtual review – 06/11/2025): caregiver reported complete healing of the burn wounds, continued adherence to advised bathing modifications and supervision practices, and no recurrence of injury.","cost_considerations":"Medication choices were guided by effectiveness, availability, affordability, and expected adherence in an out-of-pocket payment setting. Providing safe outpatient care reduced financial burden while maintaining quality through continuity and follow-up, underscoring the relevance of context-sensitive care in resource-constrained settings."}$cmgmt193$::jsonb,
  $cdisc194$Paediatric burns remain a significant cause of morbidity globally, with children under five years being particularly vulnerable due to increasing mobility, developmental curiosity, and limited hazard awareness. Scald burns from hot liquids are the most common mechanism in this age group and predominantly occur within the home during routine caregiving activities such as bathing. In Nigeria and similar low- and middle-income settings, paediatric burns are largely domestic and preventable, highlighting the importance of environmental modification and caregiver education.

Superficial partial-thickness burns involving less than 10% total body surface area (TBSA), in the absence of airway involvement, circumferential injury, or systemic complications, can be safely managed on an outpatient basis with appropriate wound care, analgesia, and structured follow-up. In this case, the limited TBSA (4–5%), burn depth, stable physiological status, and absence of involvement of special areas justified management at the secondary level of Family Medicine care, demonstrating appropriate clinical decision-making within the scope of family practice.

Management was guided by principles outlined in the World Health Organization burn care and first-aid recommendations, which emphasize early assessment, gentle wound cleansing, removal of non-viable tissue where indicated, topical antimicrobial therapy, suitable dressings, adequate pain control, and regular wound review. Outpatient management of minor burns is recommended, with referral reserved for larger burns, those involving special areas, or cases complicated by infection or systemic instability. The favourable outcome observed in this patient, with satisfactory epithelialisation and no secondary infection, aligns with expected healing trajectories for superficial partial-thickness scald burns managed according to these principles.

Safeguarding assessment is an essential component of paediatric burn care. The World Health Organization advises that all paediatric burns be evaluated for possible non-accidental injury. In this case, prompt presentation, a developmentally plausible mechanism, and an injury pattern consistent with accidental spillage supported an unintentional domestic scald.

A key strength of this case was the integration of acute clinical care with psychosocial and preventive interventions. Identification of modifiable household risk factors, such as floor-level bathing and storage of hot water in open containers, enabled targeted, caregiver-centred counselling. This transformed an acute injury encounter into an opportunity for secondary prevention, reflecting core Family Medicine principles of holistic, family-centred, and preventive care.

Out-of-pocket healthcare financing influenced management decisions. Providing safe outpatient care reduced financial burden while maintaining quality through continuity and follow-up, underscoring the relevance of context-sensitive care in resource-constrained settings.$cdisc194$,
  $cref195$1. World Health Organization. Burns. WHO Fact Sheet. Geneva: WHO; 2023.
2. Suman A, et al. Update on the management of burns in paediatrics. Clin Plast Surg. 2020;47(2):197–210.
3. Nduagubam OC, et al. Paediatric burn injuries in Enugu, South-East Nigeria. Niger J Paediatr. 2022;49(1):25–31.
4. Cuttle L, et al. Management of non-severe burn wounds in children and adolescents. Burns. 2022;48(3):567–576.
5. World Health Organization. Integrated Management for Emergency and Essential Surgical Care (IMEESC): Burn Management Protocol. Geneva: WHO; 2019.
6. Jordan KC, et al. Global trends in paediatric burn injuries and care capacity. Lancet Child Adolesc Health. 2022;6(9):650–658.$cref195$,
  'draft'
)
ON CONFLICT (workspace_id, case_number) DO UPDATE SET
  thematic_area = EXCLUDED.thematic_area,
  title = EXCLUDED.title,
  patient_initials = EXCLUDED.patient_initials,
  hospital_number = EXCLUDED.hospital_number,
  age = EXCLUDED.age,
  gender = EXCLUDED.gender,
  point_of_care = EXCLUDED.point_of_care,
  presenting_complaints = EXCLUDED.presenting_complaints,
  hpi_text = EXCLUDED.hpi_text,
  history_notes = EXCLUDED.history_notes,
  examination_notes = EXCLUDED.examination_notes,
  pccm_framework = EXCLUDED.pccm_framework,
  management_plan = EXCLUDED.management_plan,
  discussion_text = EXCLUDED.discussion_text,
  references_text = EXCLUDED.references_text,
  status = EXCLUDED.status;

-- ====================================================================
-- END OF MIGRATION 47
-- ====================================================================