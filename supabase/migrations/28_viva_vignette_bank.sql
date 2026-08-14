-- Migration 28: org-admin Viva Vignette bank (Phase 4 of the module
-- admin-content build-out — see CLAUDE.md's "Module admin-content
-- build-out progress" section, which scoped this as its own phase after
-- Phase 3's audit found OralExamSimulatorView's 5 practice vignettes
-- hardcoded identically for every tenant regardless of specialty mix.
--
-- Same shape as migration 27's Template Manager: tenant_id NULL = global
-- seed vignette (every resident, every tenant), tenant_id set = that org's
-- own vignette. A Chief can create/edit/delete their org's own vignettes;
-- global seed vignettes stay read-only everywhere.
--
-- RLS DESIGNED RIGHT FROM THE START THIS TIME: migration 27 had to retro-
-- actively close a gap where casebook_templates' original INSERT/UPDATE
-- policies were permissive (USING(true)), letting anyone write to global
-- rows. This table skips that mistake — SELECT is the only RLS policy;
-- there is no INSERT/UPDATE/DELETE policy at all, so all writes go
-- through the SECURITY DEFINER + admin-code-check RPCs below from day
-- one (same deny-then-RPC pattern as platform_operators/
-- guest_review_invites).

CREATE TABLE IF NOT EXISTS viva_vignettes (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL,
  scenario text NOT NULL,
  prompts text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_viva_vignettes_tenant ON viva_vignettes(tenant_id);

ALTER TABLE viva_vignettes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "viva_vignettes_select" ON viva_vignettes;
CREATE POLICY "viva_vignettes_select" ON viva_vignettes FOR SELECT TO anon, authenticated USING (true);

-- --------------------------------------------------
-- SEED: the 5 vignettes that were hardcoded in OralExamSimulatorView.tsx
-- (tenant_id NULL — global, preserves today's default behavior exactly).
-- --------------------------------------------------

INSERT INTO viva_vignettes (title, category, scenario, prompts) VALUES
(
  'Poorly Controlled Hypertension',
  'Chronic Disease Management',
  'A 58-year-old presents to your clinic with blood pressure readings consistently above target despite being on two antihypertensive agents.',
  ARRAY[
    'What is your differential for resistant hypertension in this patient?',
    'Outline your approach to reviewing and adjusting this patient''s management plan.',
    'What safety-netting would you put in place before their next review?',
    'How would you explain the treatment plan and check the patient''s understanding?'
  ]
),
(
  'Antenatal Patient with Gestational Diabetes',
  'Obstetric Care',
  'A patient at 26 weeks gestation is newly diagnosed with gestational diabetes on routine screening.',
  ARRAY[
    'What is your immediate diagnostic reasoning and next steps?',
    'Describe your management and referral plan for this patient.',
    'What red flags would prompt urgent escalation?',
    'How would you counsel the patient and family on the diagnosis?'
  ]
),
(
  'Febrile Child with Rash',
  'Paediatric Case',
  'A 4-year-old is brought in with a 3-day history of fever and a new rash noticed this morning.',
  ARRAY[
    'What differentials are you considering, and what history would you prioritise?',
    'What is your initial management plan pending further assessment?',
    'What features would make you concerned about a serious underlying cause?',
    'How would you communicate your assessment and plan to the caregiver?'
  ]
),
(
  'Elderly Patient with Polypharmacy',
  'Geriatrics',
  'A 76-year-old on 8 regular medications presents with increasing falls over the past month.',
  ARRAY[
    'What is your reasoning for the likely contributors to this presentation?',
    'How would you approach medication review and deprescribing here?',
    'What safety measures would you prioritise for this patient?',
    'How would you involve the patient and family in decision-making?'
  ]
),
(
  'Acute Breathlessness in Adult',
  'Emergency / Acute Presentation',
  'A 45-year-old presents acutely with sudden-onset breathlessness and pleuritic chest pain.',
  ARRAY[
    'Talk through your differential diagnosis and initial assessment priorities.',
    'What is your immediate management plan in a primary care/emergency setting?',
    'What are the key safety considerations you must not miss?',
    'How would you communicate urgency to the patient while keeping them calm?'
  ]
);

-- --------------------------------------------------
-- CRUD RPCs — same admin-code-resolves-tenant pattern as migration 27's
-- chief_create/update/delete_casebook_template.
-- --------------------------------------------------

CREATE OR REPLACE FUNCTION public.chief_create_viva_vignette(
  p_admin_code text,
  p_title text,
  p_category text,
  p_scenario text,
  p_prompts text[]
)
RETURNS viva_vignettes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row viva_vignettes;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  INSERT INTO viva_vignettes (tenant_id, title, category, scenario, prompts)
  VALUES (v_tenant_id, p_title, p_category, p_scenario, p_prompts)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_create_viva_vignette(text, text, text, text, text[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_update_viva_vignette(
  p_admin_code text,
  p_vignette_id uuid,
  p_title text,
  p_category text,
  p_scenario text,
  p_prompts text[]
)
RETURNS viva_vignettes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
  v_row viva_vignettes;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  -- Same tenant-boundary check as every other Chief-gated RPC — a global
  -- vignette (tenant_id IS NULL) or another tenant's vignette can never be
  -- edited through this RPC.
  IF NOT EXISTS (SELECT 1 FROM viva_vignettes WHERE id = p_vignette_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Vignette not found in this organization';
  END IF;

  UPDATE viva_vignettes
  SET title = p_title, category = p_category, scenario = p_scenario, prompts = p_prompts
  WHERE id = p_vignette_id
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_update_viva_vignette(text, uuid, text, text, text, text[]) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.chief_delete_viva_vignette(
  p_admin_code text,
  p_vignette_id uuid
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM viva_vignettes WHERE id = p_vignette_id AND tenant_id = v_tenant_id) THEN
    RAISE EXCEPTION 'Vignette not found in this organization';
  END IF;

  DELETE FROM viva_vignettes WHERE id = p_vignette_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.chief_delete_viva_vignette(text, uuid) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 28
-- ====================================================================
