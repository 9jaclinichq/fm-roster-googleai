-- ====================================================================
-- FM Roster - Migration 41: Scored Rubric primitive (L4 Forms & pipelines)
-- ====================================================================
-- PREREQUISITE: migrations 01-40 already applied, in particular 13
-- (research_templates, for the ownership-shape precedent copied below)
-- and 25/31/40 (doctor-ownership RLS pattern, deliberately NOT copied here
-- as-is — see design note 2).
--
-- CONTEXT: docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §8.1 ("A reusable
-- primitive: the scored rubric") — a sectioned form where each item is
-- graded on a fixed scale, sections total to a threshold, and a final score
-- maps to a recommendation. Fellowship dissertation/proposal assessments,
-- OSCE mark sheets, credentialing checklists, competency sign-offs, audit
-- scorecards, and peer-review forms are all the same shape. Built once,
-- here, as a generic primitive inside Forms & pipelines (L4) — NOT as a
-- one-off "dissertation form." Per §7's central rule and §9.10 (this
-- migration's own governing spec): none of that domain knowledge (WACP,
-- OSCE, dissertation, whatever) lives in code or in this schema. It lives
-- entirely in the rows a rubric_templates/rubric_sections/rubric_items
-- instance holds. This migration seeds NO real rubric content — see
-- CLAUDE.md's "Sourcing module content" section and this task's own
-- explicit scope: a sibling stream owns generic (non-personal) seed
-- content, and Dr. Olanipekun's own real rubric documents are blocked
-- pending him supplying them.
--
-- Reserved migration numbers this session: 32-40 (sibling Living-System
-- Architecture Initiative streams — event_log, integrations layer,
-- agent_manifests, forms/pipelines, org-defined groups, insights, insights
-- dedup index, org-defined categories, doctor-owned forms). This file only
-- claims 41, per this task's explicit reservation (NOT 42 or 43, reserved
-- for other concurrent work).
--
-- NOT APPLIED LIVE: per this task's explicit security boundary, this
-- migration is written but NOT run against the live database. A human (or
-- a separately authorized pass) reviews and applies the full pending
-- migration batch.
--
-- SCOPE DECISIONS MADE WHILE WRITING THIS (flagged per CLAUDE.md's
-- no-silent-scope-creep policy):
--
--   1. OWNERSHIP SHAPE MIRRORS `research_templates` (migration 13), NOT the
--      migration 25/31/40 doctor-ownership CHECK pattern. `rubric_templates`
--      allows `tenant_id` and `doctor_id` to independently be NULL or set,
--      with NO CHECK forcing exactly one owner. Three real, valid states:
--        - tenant_id NULL, doctor_id NULL  -> global system template,
--          available to every tenant and every individual doctor (the
--          "seed library" the spec describes in §8.2).
--        - tenant_id SET, doctor_id NULL   -> an org's own custom/forked
--          template (e.g. a Chief-authored credentialing checklist).
--        - tenant_id NULL, doctor_id SET   -> an individual doctor's own
--          personal template.
--      This is a deliberate divergence from the migration 25/31/40
--      "doctor-owned XOR institutional" exclusivity CHECK, which exists on
--      those tables specifically to gate a hard RLS boundary
--      (`auth.uid() = doctor_id`). This primitive doesn't need that
--      boundary (see decision 3 below) and DOES need the third, genuinely
--      ownerless "global" state that the XOR pattern would forbid — a
--      global template has both columns NULL, which migration 25's CHECK
--      shape (exactly one of tenant_id/doctor_id set) cannot express at
--      all. Copying that CHECK here would make seeding a global template
--      impossible.
--   2. `created_by_workforce_id` ADDED, NOT SPECIFIED BY THE TASK BUT
--      MIRRORS `research_templates.created_by_workforce_id`. An org-side
--      rubric template (tenant_id SET) still needs to record which Chief
--      authored it, same rationale as research_templates' own header:
--      there's no per-Chief identity table beyond `workforce`, so this is
--      the same nullable FK used everywhere else in this app for "which
--      logged-in person did this."
--   3. RLS STAYS FULLY PERMISSIVE ON ALL 4 TABLES, INCLUDING
--      `rubric_instances` — per this task's explicit instruction, not
--      inventing a new boundary here. This means a doctor-owned personal
--      rubric template or instance is, like every doctor-owned row that
--      predates migration 25, readable/writable by anyone holding the anon
--      key. That's the same trust model as `research_templates`,
--      `research_workspaces` pre-migration-25, and the vast majority of
--      this schema (see CLAUDE.md Security Notes) — flagged, not hidden,
--      and explicitly out of scope for this pass to change.
--   4. `compute_rubric_totals` IS A SQL/PLPGSQL FUNCTION, NOT CLIENT-SIDE.
--      Chosen over a TypeScript implementation in rubricEngine.ts because:
--      (a) it needs to read `rubric_sections`/`rubric_items` alongside the
--      instance's own `scores` in a single consistent snapshot (a
--      `SELECT ... FOR UPDATE` on the instance row), which is naturally a
--      single server-side transaction rather than 3 round-trips from the
--      client; (b) `rubric_instances`'s RLS is permissive, so there's no
--      SECURITY DEFINER privilege being smuggled in here (unlike e.g.
--      migration 11's guest-review RPCs) — this is purely an aggregation
--      convenience function, matching this repo's existing precedent of
--      DB-side aggregation helpers (`check_and_increment_tenant_ai_quota`)
--      even on permissively-RLS'd tables; (c) keeps the "apply this rubric
--      scoring logic" step reusable from any future caller (a different
--      module's pipeline, a future admin re-score action) without
--      duplicating the aggregation logic in a second language. Kept
--      deliberately simple per the task's own instruction: a straightforward
--      jsonb aggregation over `scores` (keyed by `rubric_items.id`), not a
--      rules engine — no domain-specific logic of any kind.
--
-- WHAT THIS DOES:
--   1. `rubric_templates`: the reusable shape (sections[] via child table,
--      scale_definition, pass_logic).
--   2. `rubric_sections`: one row per section of a template (max_points,
--      pass_threshold, all_items_required flag).
--   3. `rubric_items`: one row per scored item within a section (label,
--      guidance, scale, weight).
--   4. `rubric_instances`: one filled-in rubric against a subject_ref
--      (deliberately free-text, same pattern as `insights.subject_ref` /
--      `event_log.event_type` — see design note in their own headers — so
--      this primitive can attach to a subject type that doesn't exist yet
--      without a schema change).
--   5. `compute_rubric_totals(p_instance_id)`: sums each section's scored
--      items against `max_points`, checks `pass_threshold` per section,
--      flags any zero-scored item in an `all_items_required` section, and
--      writes the result into `section_totals`/`final_score`/
--      `recommendation`, moving `status` to 'scored'.
-- ====================================================================

-- --------------------------------------------------
-- 1. RUBRIC TEMPLATES
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS rubric_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  -- NULL = available to every tenant. See design note 1 above for the full
  -- 3-state ownership shape (global / tenant-owned / doctor-owned).
  tenant_id uuid REFERENCES tenants(id),
  doctor_id uuid REFERENCES doctor_profiles(id),
  -- Which logged-in workforce member (e.g. a Chief) authored a tenant-owned
  -- template. Mirrors research_templates.created_by_workforce_id — see
  -- design note 2.
  created_by_workforce_id uuid REFERENCES workforce(id),
  name text NOT NULL,
  description text,
  -- e.g. {"min": 0, "max": 3, "labels": {"0": "Absent", "3": "Excellent"}}
  -- Purely descriptive metadata for a rendering UI; per-item scale_min/
  -- scale_max on rubric_items below are what's actually enforced/computed
  -- against, since different sections of the same template can use
  -- different scales (a 0-3 domain scored alongside a 0-10 defence score).
  scale_definition jsonb NOT NULL DEFAULT '{}',
  -- e.g. {"overall_pass_pct": 50, "bands": [{"min_pct": 80, "label": "recommend_pass"}, ...]}
  -- Descriptive/reference only in this pass — compute_rubric_totals below
  -- implements a fixed, generic pass/flag/recommend shape rather than
  -- interpreting arbitrary pass_logic jsonb; see that function's own header
  -- note for why (kept deliberately simple, not a rules engine).
  pass_logic jsonb NOT NULL DEFAULT '{}',
  is_system_default boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rubric_templates_tenant ON rubric_templates(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rubric_templates_doctor ON rubric_templates(doctor_id);
CREATE INDEX IF NOT EXISTS idx_rubric_templates_creator ON rubric_templates(created_by_workforce_id);

ALTER TABLE rubric_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rubric_templates_select" ON rubric_templates;
CREATE POLICY "rubric_templates_select" ON rubric_templates FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rubric_templates_insert" ON rubric_templates;
CREATE POLICY "rubric_templates_insert" ON rubric_templates FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rubric_templates_update" ON rubric_templates;
CREATE POLICY "rubric_templates_update" ON rubric_templates FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rubric_templates_delete" ON rubric_templates;
CREATE POLICY "rubric_templates_delete" ON rubric_templates FOR DELETE TO anon, authenticated USING (true);

-- --------------------------------------------------
-- 2. RUBRIC SECTIONS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS rubric_sections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rubric_template_id uuid NOT NULL REFERENCES rubric_templates(id) ON DELETE CASCADE,
  name text NOT NULL,
  max_points numeric,
  pass_threshold numeric,
  all_items_required boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rubric_sections_template ON rubric_sections(rubric_template_id);

ALTER TABLE rubric_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rubric_sections_select" ON rubric_sections;
CREATE POLICY "rubric_sections_select" ON rubric_sections FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rubric_sections_insert" ON rubric_sections;
CREATE POLICY "rubric_sections_insert" ON rubric_sections FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rubric_sections_update" ON rubric_sections;
CREATE POLICY "rubric_sections_update" ON rubric_sections FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rubric_sections_delete" ON rubric_sections;
CREATE POLICY "rubric_sections_delete" ON rubric_sections FOR DELETE TO anon, authenticated USING (true);

-- --------------------------------------------------
-- 3. RUBRIC ITEMS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS rubric_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rubric_section_id uuid NOT NULL REFERENCES rubric_sections(id) ON DELETE CASCADE,
  label text NOT NULL,
  guidance_text text,
  scale_min numeric NOT NULL DEFAULT 0,
  scale_max numeric NOT NULL,
  weight numeric NOT NULL DEFAULT 1,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_rubric_items_section ON rubric_items(rubric_section_id);

ALTER TABLE rubric_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "rubric_items_select" ON rubric_items;
CREATE POLICY "rubric_items_select" ON rubric_items FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rubric_items_insert" ON rubric_items;
CREATE POLICY "rubric_items_insert" ON rubric_items FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rubric_items_update" ON rubric_items;
CREATE POLICY "rubric_items_update" ON rubric_items FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rubric_items_delete" ON rubric_items;
CREATE POLICY "rubric_items_delete" ON rubric_items FOR DELETE TO anon, authenticated USING (true);

-- --------------------------------------------------
-- 4. RUBRIC INSTANCES
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS rubric_instances (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  rubric_template_id uuid NOT NULL REFERENCES rubric_templates(id),
  tenant_id uuid REFERENCES tenants(id),
  -- Deliberately free-text, NOT a typed FK — same rationale as
  -- insights.subject_ref (migration 37) and event_log.event_type
  -- (migration 32): this primitive must be attachable to a subject type
  -- that doesn't exist in the schema yet (an OSCE station, a credentialing
  -- audit record) without a migration every time a new subject type shows
  -- up. Convention: '<table_or_concept>:<id>', e.g.
  -- 'research_workspace:<uuid>' or 'clinical_case_report:<uuid>'.
  subject_ref text,
  assessor_workforce_id uuid REFERENCES workforce(id),
  assessor_doctor_id uuid REFERENCES doctor_profiles(id),
  -- Keyed by rubric_items.id (as text) -> raw numeric score entered by the
  -- assessor. compute_rubric_totals() reads this and derives everything
  -- else below from it plus the template's own sections/items.
  scores jsonb NOT NULL DEFAULT '{}',
  -- Written by compute_rubric_totals(); see that function for shape.
  section_totals jsonb NOT NULL DEFAULT '{}',
  final_score numeric,
  recommendation text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'scored', 'confirmed')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rubric_instances_template ON rubric_instances(rubric_template_id);
CREATE INDEX IF NOT EXISTS idx_rubric_instances_tenant ON rubric_instances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rubric_instances_subject_ref ON rubric_instances(subject_ref);

DROP TRIGGER IF EXISTS update_rubric_instances_updated_at ON rubric_instances;
CREATE TRIGGER update_rubric_instances_updated_at
BEFORE UPDATE ON rubric_instances
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE rubric_instances ENABLE ROW LEVEL SECURITY;
-- Permissive, matching every other table since migration 01 (see CLAUDE.md
-- Security Notes) — explicitly instructed for this table too, not just its
-- template tables. Not a real security boundary.
DROP POLICY IF EXISTS "rubric_instances_select" ON rubric_instances;
CREATE POLICY "rubric_instances_select" ON rubric_instances FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "rubric_instances_insert" ON rubric_instances;
CREATE POLICY "rubric_instances_insert" ON rubric_instances FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "rubric_instances_update" ON rubric_instances;
CREATE POLICY "rubric_instances_update" ON rubric_instances FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "rubric_instances_delete" ON rubric_instances;
CREATE POLICY "rubric_instances_delete" ON rubric_instances FOR DELETE TO anon, authenticated USING (true);

-- --------------------------------------------------
-- 5. compute_rubric_totals(p_instance_id): the pipeline step
-- --------------------------------------------------
-- Per spec §8.1's pipeline: "rubric.instance submitted -> BabsBrain-2
-- computes section totals, applies pass thresholds, flags any zero-scored
-- required item, proposes the recommendation band -> org admin or assessor
-- confirms." This function performs the middle step (the computation); the
-- "confirms" step is a plain client-side status update to 'confirmed'
-- (rubricEngine.ts), not part of this function.
--
-- Deliberately simple, generic aggregation — see design note 4 above for
-- why this is a DB function rather than client-side, and why it does NOT
-- interpret the template's own free-form `pass_logic` jsonb. The
-- recommendation band produced here is a fixed 3-value shape
-- ('review_required' | 'recommend_revise' | 'recommend_pass'), not
-- domain-specific wording — a template's own UI/consumer is free to map
-- these onto its own domain vocabulary (e.g. "Pass"/"Refer"/"Fail" for an
-- OSCE, "Approve"/"Request Corrections" for a dissertation proposal)
-- without this function needing to know which domain it's serving.
CREATE OR REPLACE FUNCTION public.compute_rubric_totals(p_instance_id uuid)
RETURNS rubric_instances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_instance rubric_instances;
  v_section RECORD;
  v_item RECORD;
  v_section_totals jsonb := '{}'::jsonb;
  v_final_score numeric := 0;
  v_any_required_zero boolean := false;
  v_all_thresholds_met boolean := true;
  v_section_score numeric;
  v_section_flagged boolean;
  v_item_score numeric;
BEGIN
  SELECT * INTO v_instance FROM rubric_instances WHERE id = p_instance_id FOR UPDATE;
  IF v_instance.id IS NULL THEN
    RAISE EXCEPTION 'Unknown rubric_instances id: %', p_instance_id;
  END IF;

  FOR v_section IN
    SELECT * FROM rubric_sections WHERE rubric_template_id = v_instance.rubric_template_id ORDER BY sort_order
  LOOP
    v_section_score := 0;
    v_section_flagged := false;

    FOR v_item IN
      SELECT * FROM rubric_items WHERE rubric_section_id = v_section.id ORDER BY sort_order
    LOOP
      -- scores is keyed by rubric_items.id (text); an item with no entry
      -- yet is treated as a 0 score, which also makes it eligible to trip
      -- the all_items_required flag below (an unscored required item is
      -- exactly as much a gap as an explicitly-entered 0).
      v_item_score := COALESCE((v_instance.scores ->> v_item.id::text)::numeric, 0);
      v_section_score := v_section_score + (v_item_score * v_item.weight);

      IF v_section.all_items_required AND v_item_score = 0 THEN
        v_section_flagged := true;
        v_any_required_zero := true;
      END IF;
    END LOOP;

    v_section_totals := v_section_totals || jsonb_build_object(
      v_section.id::text, jsonb_build_object(
        'section_name', v_section.name,
        'score', v_section_score,
        'max_points', v_section.max_points,
        'pass_threshold', v_section.pass_threshold,
        'passed', (v_section.pass_threshold IS NULL OR v_section_score >= v_section.pass_threshold),
        'flagged_zero_required_item', v_section_flagged
      )
    );

    v_final_score := v_final_score + v_section_score;

    IF v_section.pass_threshold IS NOT NULL AND v_section_score < v_section.pass_threshold THEN
      v_all_thresholds_met := false;
    END IF;
  END LOOP;

  UPDATE rubric_instances
  SET
    section_totals = v_section_totals,
    final_score = v_final_score,
    recommendation = CASE
      WHEN v_any_required_zero THEN 'review_required'
      WHEN v_all_thresholds_met THEN 'recommend_pass'
      ELSE 'recommend_revise'
    END,
    status = 'scored',
    updated_at = now()
  WHERE id = p_instance_id
  RETURNING * INTO v_instance;

  RETURN v_instance;
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_rubric_totals(uuid) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 41
-- ====================================================================
