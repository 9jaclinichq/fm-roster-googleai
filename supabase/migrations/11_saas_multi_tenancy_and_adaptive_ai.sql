-- ====================================================================
-- FM Roster - Migration 11: SaaS Multi-Tenancy & Adaptive AI Engine
-- ====================================================================
-- PREREQUISITE: migrations 01-10 already applied.
--
-- SCOPE DECISIONS MADE WITH THE USER BEFORE WRITING THIS (do not silently
-- relitigate these — they were explicit trade-offs, not oversights):
--
--   1. TENANT ISOLATION IS CLIENT-ENFORCED, NOT RLS-ENFORCED. The original
--      task spec asked for RLS policies like
--      `tenant_id = current_setting('app.current_tenant_id', true)::uuid`.
--      That requires a per-request session variable, which normally comes
--      from a signed JWT claim via Supabase Auth. This app has NO Supabase
--      Auth (see migration 01's header, Role Model in CLAUDE.md) — login is
--      a plaintext code compared client-side, session state in
--      localStorage. Without real auth, that RLS policy would either never
--      fire (nothing ever sets the session var, so every row is invisible
--      to everyone) or would have to be faked in a way that isn't real
--      security. Given the choice between a broken/fake RLS policy and an
--      honest client-enforced model, we kept RLS permissive (matching
--      every table since migration 01) and added `tenant_id` as a plain
--      data column that `databaseService.ts` must filter by. This is NOT
--      a real security boundary — same caveat CLAUDE.md already documents
--      for every other table. A determined anon-key holder can still read
--      across tenants directly via the REST API. Real tenant isolation
--      requires real Supabase Auth with tenant_id in a JWT claim; that is
--      a separate, larger project, not attempted here.
--   2. PAYSTACK ONLY, SUBACCOUNT CREATION ONLY. No charge/subscription/
--      webhook code exists. `tenants.paystack_subaccount_code` is filled by
--      a real live API call (see supabase/functions/paystack-subaccount),
--      nothing more.
--   3. `settings` and `submissions` are NOT given tenant_id in this
--      migration — the task spec's table list didn't include them, and
--      `settings` is a global singleton (id=1) that doesn't cleanly fit
--      the tenant model as-is. This is a known gap for a future migration,
--      not an oversight: right now every tenant would still share one
--      Chief admin_access_code and one active collection pointer. Noted
--      explicitly per CLAUDE.md's "no silent scope creep" rule.
--   4. THE SAAS OPERATOR (platform owner) IS NOT A `workforce` ROW. The
--      task spec named the log column `operator_workforce_id`, implying
--      operators are workforce members — but the user explicitly chose a
--      separate shared code for this role (not tied to any one tenant's
--      Chief code), and a platform owner is inherently above/outside the
--      tenant model (they administer ALL tenants, not one). Forcing them
--      into `workforce` (a tenant-scoped table) would be architecturally
--      wrong. This migration creates a standalone `platform_operators`
--      table instead, and `saas_operator_logs.operator_id` references
--      that, not `workforce`. Deviation from the literal spec column name,
--      made deliberately — flagged per CLAUDE.md's scope-change rule.
--   5. `tenant_ai_adaptation_rules` is a real, writable data model in this
--      migration, but the Edge Functions (academic-copilot, roster-parser)
--      do NOT read or apply `adapted_prompt_overrides` yet — only the AI
--      quota check is wired into them (see below). Splicing tenant-specific
--      prompt overrides into already-carefully-worded system prompts is a
--      separate task; building it blind with only one seeded tenant to
--      validate against risks silently degrading prompt quality. Deferred,
--      not forgotten.
--
-- WHAT THIS DOES:
--   1. `tenants`: core multi-tenant table, seeded with the existing UCH
--      Family Medicine data as `free_seeded` tenant, fixed id
--      '00000000-0000-0000-0000-000000000001' so every backfill/default
--      below can reference it directly without a dynamic PL/pgSQL lookup.
--   2. `tenant_id` FK added to the 10 tables the spec named: workforce,
--      collections, combined_master_rosters, announcements,
--      knowledge_packs, dissertations, case_reports, exam_readiness,
--      viva_simulations, call_duty_rules. All backfilled to the UCH
--      tenant and defaulted to it going forward (single-tenant-today
--      reality), then set NOT NULL.
--   3. `call_duty_rules`: did not exist before this migration — created
--      net-new (tenant_id, rule_key, rule_value) since the spec named it
--      as a tenant-scoped table but no prior migration built it. Backs
--      TenantCustomizationView's "call duty limits" curriculum-alignment
--      bullet.
--   4. `platform_operators` + `saas_operator_logs`: SaaS super-admin
--      identity (separate shared code) and its audit log.
--   5. `tenant_ai_adaptation_rules`: per-tenant, per-feature AI prompt/style
--      overrides (schema only — not yet read by the Edge Functions).
--   6. `tenant_ai_usage`: rolling free-tier AI quota tracking, enforced
--      SERVER-SIDE inside the Edge Functions (not just the client) via
--      `check_and_increment_tenant_ai_quota()` — client-only enforcement
--      would be trivially bypassed by anyone hitting the Edge Function URL
--      directly.
--   7. `guest_review_invites`: token-based, no-login-required review
--      sharing for consultant sign-off, extending the existing
--      `consultant_reviews` HITL system (migrations 06/07) rather than
--      duplicating it. RLS deliberately grants NO direct SELECT — the
--      token itself is the only access credential (like any capability
--      URL), and a permissive SELECT policy would let anyone list every
--      outstanding guest token via the REST API. Access is only through
--      SECURITY DEFINER RPCs that require the exact token.
--      SECURITY NOTE ON APPROVAL AUTHORITY: migration 07 deliberately
--      restricts co-resident peer reviewers to 'revisions_requested' only,
--      never 'approved', specifically to stop residents getting a friend
--      to rubber-stamp their own exam eligibility. A guest link is even
--      easier to hand to a friend than a co-resident account, so the same
--      restriction applies: a guest invite can only carry final approval
--      authority (`invited_as = 'consultant'`) if it was created by a
--      workforce member who actually holds an authorizing role
--      (hod/rtc/cme_coord/consultant/super_admin) — enforced server-side
--      in `create_guest_review_invite()`, not just hidden in the UI.
--   8. `consultant_reviews` gets `guest_invite_id`, `guest_name`,
--      `guest_signature_url` columns — `reviewer_workforce_id` was already
--      nullable, so a guest review is simply a review row with no
--      workforce reviewer, linked back to its invite.
--   9. `guest-signatures` Storage bucket for camera-captured signature
--      photos, same public-bucket trust model as every other bucket in
--      this app.
-- ====================================================================

-- --------------------------------------------------
-- 1. TENANTS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  short_code text NOT NULL UNIQUE,
  institution text,
  department text,
  plan_type text NOT NULL DEFAULT 'free_seeded' CHECK (plan_type IN ('free_seeded', 'tier_1', 'tier_2', 'enterprise')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  paystack_subaccount_code text,
  -- White-label config: tenant-configurable label overrides (e.g.
  -- {"resident": "Trainee", "chief_resident": "Programme Lead"}) so the
  -- same underlying schema/UI can serve a residency program, a university
  -- department, or another hierarchy without a code-level rename. Read by
  -- TerminologyContext (src/lib/terminology.tsx). Falls back to the
  -- built-in medical-residency defaults when a key is absent.
  terminology_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Granular module enable/disable + numeric overrides, e.g.
  -- {"viva_simulator_enabled": true, "case_reports_required_count": 15}.
  -- Edited via TenantCustomizationView.
  module_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

INSERT INTO tenants (id, name, short_code, institution, department, plan_type, status)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Family Medicine, UCH Ibadan',
  'uch_fm',
  'University College Hospital, Ibadan',
  'Family Medicine',
  'free_seeded',
  'active'
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenants_select" ON tenants;
CREATE POLICY "tenants_select" ON tenants FOR SELECT TO anon, authenticated USING (true);
-- Same permissive, client-enforced-only model as every other table in
-- this app (see this file's header) — matches call_duty_rules and
-- tenant_ai_adaptation_rules below, both written the same way from
-- databaseService.ts. SaaSOperatorConsoleView/TenantCustomizationView are
-- the only UI surfaces that call these writes, gated by the operator
-- shared code / Chief admin code respectively at the UI layer, same trust
-- model as every Chief-facing screen in this app — not a real database
-- security boundary. (An earlier draft of this migration claimed these
-- writes would go through operator-gated RPCs; that was never built —
-- corrected here rather than left as a misleading comment.)
DROP POLICY IF EXISTS "tenants_insert" ON tenants;
CREATE POLICY "tenants_insert" ON tenants FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "tenants_update" ON tenants;
CREATE POLICY "tenants_update" ON tenants FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 2. tenant_id ON THE 10 NAMED CORE TABLES
-- --------------------------------------------------

ALTER TABLE workforce ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE workforce SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE workforce ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE workforce ALTER COLUMN tenant_id SET NOT NULL;
-- Same allow-list gotcha as migration 10's on_floor column: migration 02
-- replaced workforce's table-level grants with an explicit column
-- allow-list. A new column does not inherit privileges automatically.
GRANT SELECT (tenant_id), UPDATE (tenant_id) ON workforce TO anon, authenticated;

ALTER TABLE collections ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE collections SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE collections ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE collections ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE combined_master_rosters ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE combined_master_rosters SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE combined_master_rosters ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE combined_master_rosters ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE announcements ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE announcements SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE announcements ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE announcements ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE knowledge_packs ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE knowledge_packs SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE knowledge_packs ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE knowledge_packs ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE dissertations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE dissertations SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE dissertations ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE dissertations ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE case_reports ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE case_reports SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE case_reports ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE case_reports ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE exam_readiness ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE exam_readiness SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE exam_readiness ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE exam_readiness ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE viva_simulations ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id);
UPDATE viva_simulations SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE viva_simulations ALTER COLUMN tenant_id SET DEFAULT '00000000-0000-0000-0000-000000000001';
ALTER TABLE viva_simulations ALTER COLUMN tenant_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workforce_tenant ON workforce(tenant_id);
CREATE INDEX IF NOT EXISTS idx_collections_tenant ON collections(tenant_id);
CREATE INDEX IF NOT EXISTS idx_combined_master_rosters_tenant ON combined_master_rosters(tenant_id);
CREATE INDEX IF NOT EXISTS idx_announcements_tenant ON announcements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_packs_tenant ON knowledge_packs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_dissertations_tenant ON dissertations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_case_reports_tenant ON case_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_exam_readiness_tenant ON exam_readiness(tenant_id);
CREATE INDEX IF NOT EXISTS idx_viva_simulations_tenant ON viva_simulations(tenant_id);

-- --------------------------------------------------
-- 3. CALL DUTY RULES (net-new — did not exist before this migration)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS call_duty_rules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  rule_key text NOT NULL,
  rule_value integer NOT NULL,
  description text,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_rule_per_tenant UNIQUE (tenant_id, rule_key)
);

CREATE INDEX IF NOT EXISTS idx_call_duty_rules_tenant ON call_duty_rules(tenant_id);

ALTER TABLE call_duty_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "call_duty_rules_select" ON call_duty_rules;
CREATE POLICY "call_duty_rules_select" ON call_duty_rules FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "call_duty_rules_insert" ON call_duty_rules;
CREATE POLICY "call_duty_rules_insert" ON call_duty_rules FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "call_duty_rules_update" ON call_duty_rules;
CREATE POLICY "call_duty_rules_update" ON call_duty_rules FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 4. PLATFORM OPERATORS (SaaS super-admin identity) + LOGS
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS platform_operators (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  shared_code varchar(6) NOT NULL UNIQUE,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Seed one operator with a random 6-digit code. Deliberately NOT surfaced
-- in DevHelper.tsx (already a documented critical credential leak — see
-- CLAUDE.md Security Notes; this migration does not make that worse). The
-- generated code is reported once, out-of-band, to whoever ran this
-- migration.
INSERT INTO platform_operators (name, shared_code)
SELECT 'Platform Owner', lpad(floor(random() * 900000 + 100000)::text, 6, '0')
WHERE NOT EXISTS (SELECT 1 FROM platform_operators);

ALTER TABLE platform_operators ENABLE ROW LEVEL SECURITY;
-- Deliberately NO select policy on the codes themselves — same reasoning
-- as guest_review_invites below. Login is verified through a RPC, not a
-- direct table read.
DROP POLICY IF EXISTS "platform_operators_select_public" ON platform_operators;
CREATE POLICY "platform_operators_select_public" ON platform_operators
  FOR SELECT TO anon, authenticated USING (false);

CREATE OR REPLACE FUNCTION public.verify_platform_operator_code(p_code text)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY SELECT po.id, po.name FROM platform_operators po WHERE po.shared_code = p_code;
END;
$$;
GRANT EXECUTE ON FUNCTION public.verify_platform_operator_code(text) TO anon, authenticated;

CREATE TABLE IF NOT EXISTS saas_operator_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  operator_id uuid REFERENCES platform_operators(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_saas_operator_logs_operator ON saas_operator_logs(operator_id);

ALTER TABLE saas_operator_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "saas_operator_logs_select" ON saas_operator_logs;
CREATE POLICY "saas_operator_logs_select" ON saas_operator_logs FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "saas_operator_logs_insert" ON saas_operator_logs;
CREATE POLICY "saas_operator_logs_insert" ON saas_operator_logs FOR INSERT TO anon, authenticated WITH CHECK (true);
-- Append-only: no UPDATE/DELETE policy, matches raw_roster_uploads pattern.

-- --------------------------------------------------
-- 5. TENANT AI ADAPTATION RULES (schema only — not yet read by Edge Fns)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_ai_adaptation_rules (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  feature_key text NOT NULL,
  adapted_prompt_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  local_style_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  CONSTRAINT unique_adaptation_per_tenant_feature UNIQUE (tenant_id, feature_key)
);

DROP TRIGGER IF EXISTS update_tenant_ai_adaptation_rules_updated_at ON tenant_ai_adaptation_rules;
CREATE TRIGGER update_tenant_ai_adaptation_rules_updated_at
BEFORE UPDATE ON tenant_ai_adaptation_rules
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE tenant_ai_adaptation_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_ai_adaptation_rules_select" ON tenant_ai_adaptation_rules;
CREATE POLICY "tenant_ai_adaptation_rules_select" ON tenant_ai_adaptation_rules FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "tenant_ai_adaptation_rules_insert" ON tenant_ai_adaptation_rules;
CREATE POLICY "tenant_ai_adaptation_rules_insert" ON tenant_ai_adaptation_rules FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "tenant_ai_adaptation_rules_update" ON tenant_ai_adaptation_rules;
CREATE POLICY "tenant_ai_adaptation_rules_update" ON tenant_ai_adaptation_rules FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 6. TENANT AI USAGE (rolling free-tier quota, server-enforced)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS tenant_ai_usage (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id),
  period_start timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  action_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE tenant_ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_ai_usage_select" ON tenant_ai_usage;
CREATE POLICY "tenant_ai_usage_select" ON tenant_ai_usage FOR SELECT TO anon, authenticated USING (true);
-- No client INSERT/UPDATE: all writes go through the quota RPC below,
-- callable by both the client (to display remaining quota) and, with a
-- service-role client, by the Edge Functions themselves (real
-- enforcement point — see academic-copilot/roster-parser).

CREATE OR REPLACE FUNCTION public.check_and_increment_tenant_ai_quota(
  p_tenant_id uuid,
  p_free_tier_limit integer DEFAULT 50,
  p_window_days integer DEFAULT 14
)
RETURNS TABLE (allowed boolean, remaining integer, resets_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_plan_type text;
  v_usage tenant_ai_usage;
BEGIN
  SELECT plan_type INTO v_plan_type FROM tenants WHERE id = p_tenant_id;
  IF v_plan_type IS NULL THEN
    RAISE EXCEPTION 'Unknown tenant_id: %', p_tenant_id;
  END IF;

  -- Only the free_seeded tier is quota-gated in this pass. Paid tiers are
  -- unlimited here — differentiated per-tier limits are a future task once
  -- there's a real paying tenant to calibrate against.
  IF v_plan_type <> 'free_seeded' THEN
    RETURN QUERY SELECT true, NULL::integer, NULL::timestamptz;
    RETURN;
  END IF;

  INSERT INTO tenant_ai_usage (tenant_id)
  VALUES (p_tenant_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  SELECT * INTO v_usage FROM tenant_ai_usage WHERE tenant_id = p_tenant_id FOR UPDATE;

  IF now() > v_usage.period_start + make_interval(days => p_window_days) THEN
    UPDATE tenant_ai_usage
    SET period_start = now(), action_count = 0, updated_at = now()
    WHERE tenant_id = p_tenant_id
    RETURNING * INTO v_usage;
  END IF;

  IF v_usage.action_count >= p_free_tier_limit THEN
    RETURN QUERY SELECT false, 0, v_usage.period_start + make_interval(days => p_window_days);
    RETURN;
  END IF;

  UPDATE tenant_ai_usage
  SET action_count = action_count + 1, updated_at = now()
  WHERE tenant_id = p_tenant_id
  RETURNING * INTO v_usage;

  RETURN QUERY SELECT true, (p_free_tier_limit - v_usage.action_count), v_usage.period_start + make_interval(days => p_window_days);
END;
$$;
GRANT EXECUTE ON FUNCTION public.check_and_increment_tenant_ai_quota(uuid, integer, integer) TO anon, authenticated;

-- --------------------------------------------------
-- 7. GUEST REVIEW INVITES (token-based, no-login reviewer sharing)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS guest_review_invites (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) DEFAULT '00000000-0000-0000-0000-000000000001',
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  target_type text NOT NULL CHECK (target_type IN ('dissertation_milestone', 'case_report')),
  target_id uuid NOT NULL,
  invited_as text NOT NULL DEFAULT 'peer_reviewer' CHECK (invited_as IN ('peer_reviewer', 'consultant')),
  created_by_workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,
  guest_name text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'revoked')),
  expires_at timestamptz NOT NULL DEFAULT (timezone('utc'::text, now()) + interval '14 days'),
  completed_at timestamptz,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_guest_review_invites_target ON guest_review_invites(target_type, target_id);

ALTER TABLE guest_review_invites ENABLE ROW LEVEL SECURITY;
-- Deliberately NO select policy — see migration header. The token is the
-- only credential; access is via get_guest_review_invite() below.
DROP POLICY IF EXISTS "guest_review_invites_no_direct_select" ON guest_review_invites;
CREATE POLICY "guest_review_invites_no_direct_select" ON guest_review_invites
  FOR SELECT TO anon, authenticated USING (false);

CREATE OR REPLACE FUNCTION public.create_guest_review_invite(
  p_created_by_workforce_id uuid,
  p_target_type text,
  p_target_id uuid,
  p_invited_as text DEFAULT 'peer_reviewer',
  p_guest_name text DEFAULT NULL
)
RETURNS guest_review_invites
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite guest_review_invites;
  v_tenant_id uuid;
  v_creator_has_authority boolean;
BEGIN
  IF p_target_type NOT IN ('dissertation_milestone', 'case_report') THEN
    RAISE EXCEPTION 'Invalid target_type: %', p_target_type;
  END IF;
  IF p_invited_as NOT IN ('peer_reviewer', 'consultant') THEN
    RAISE EXCEPTION 'Invalid invited_as: %', p_invited_as;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE workforce_id = p_created_by_workforce_id
      AND role_id IN ('hod', 'rtc', 'cme_coord', 'consultant', 'super_admin')
  ) INTO v_creator_has_authority;

  -- Same rationale as migration 07's co-resident approval restriction: a
  -- guest link handed to a friend must not be able to grant final
  -- approval unless whoever created it actually holds an authorizing
  -- role. Enforced here server-side, not just hidden in the UI.
  IF p_invited_as = 'consultant' AND NOT v_creator_has_authority THEN
    RAISE EXCEPTION 'Only hod/rtc/cme_coord/consultant/super_admin can create a consultant-authority guest invite' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(tenant_id, '00000000-0000-0000-0000-000000000001') INTO v_tenant_id
  FROM workforce WHERE id = p_created_by_workforce_id;

  INSERT INTO guest_review_invites (tenant_id, target_type, target_id, invited_as, created_by_workforce_id, guest_name)
  VALUES (COALESCE(v_tenant_id, '00000000-0000-0000-0000-000000000001'), p_target_type, p_target_id, p_invited_as, p_created_by_workforce_id, p_guest_name)
  RETURNING * INTO v_invite;

  RETURN v_invite;
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_guest_review_invite(uuid, text, uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_guest_review_invite(p_token uuid)
RETURNS TABLE (
  target_type text, target_id uuid, invited_as text, guest_name text,
  status text, expires_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  SELECT gri.target_type, gri.target_id, gri.invited_as, gri.guest_name, gri.status, gri.expires_at
  FROM guest_review_invites gri
  WHERE gri.token = p_token;
END;
$$;
GRANT EXECUTE ON FUNCTION public.get_guest_review_invite(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.submit_guest_review(
  p_token uuid,
  p_status text,
  p_feedback_notes text,
  p_guest_signature_url text,
  p_guest_name text DEFAULT NULL
)
RETURNS consultant_reviews
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_invite guest_review_invites;
  v_review consultant_reviews;
BEGIN
  IF p_status NOT IN ('approved', 'revisions_requested') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status;
  END IF;

  SELECT * INTO v_invite FROM guest_review_invites WHERE token = p_token FOR UPDATE;
  IF v_invite.id IS NULL THEN
    RAISE EXCEPTION 'Guest review link not found' USING ERRCODE = '42501';
  END IF;
  IF v_invite.status <> 'pending' THEN
    RAISE EXCEPTION 'This guest review link has already been used or revoked' USING ERRCODE = '42501';
  END IF;
  IF v_invite.expires_at < now() THEN
    RAISE EXCEPTION 'This guest review link has expired' USING ERRCODE = '42501';
  END IF;
  IF p_status = 'approved' AND v_invite.invited_as <> 'consultant' THEN
    RAISE EXCEPTION 'This guest link can only submit feedback/revisions, not final approval' USING ERRCODE = '42501';
  END IF;

  INSERT INTO consultant_reviews (
    target_type, target_id, reviewer_workforce_id, status, feedback_notes,
    reviewer_role, guest_invite_id, guest_name, guest_signature_url
  )
  VALUES (
    v_invite.target_type, v_invite.target_id, NULL, p_status, p_feedback_notes,
    'guest_' || v_invite.invited_as, v_invite.id, COALESCE(p_guest_name, v_invite.guest_name), p_guest_signature_url
  )
  RETURNING * INTO v_review;

  IF v_invite.target_type = 'dissertation_milestone' THEN
    UPDATE dissertation_milestones
    SET status = CASE WHEN p_status = 'approved' THEN 'approved' ELSE 'draft' END,
        supervisor_feedback = p_feedback_notes
    WHERE id = v_invite.target_id;
  ELSE
    UPDATE case_reports
    SET status = CASE WHEN p_status = 'approved' THEN 'approved' ELSE 'draft' END
    WHERE id = v_invite.target_id;
  END IF;

  UPDATE guest_review_invites SET status = 'completed', completed_at = now() WHERE id = v_invite.id;

  RETURN v_review;
END;
$$;
GRANT EXECUTE ON FUNCTION public.submit_guest_review(uuid, text, text, text, text) TO anon, authenticated;

-- consultant_reviews: link back to the guest invite that produced a
-- review, if any. reviewer_workforce_id was already nullable (migration
-- 06), so no change needed there.
ALTER TABLE consultant_reviews ADD COLUMN IF NOT EXISTS guest_invite_id uuid REFERENCES guest_review_invites(id) ON DELETE SET NULL;
ALTER TABLE consultant_reviews ADD COLUMN IF NOT EXISTS guest_name text;
ALTER TABLE consultant_reviews ADD COLUMN IF NOT EXISTS guest_signature_url text;

-- --------------------------------------------------
-- 8. STORAGE BUCKET FOR GUEST SIGNATURE PHOTOS
-- --------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('guest-signatures', 'guest-signatures', true, 5242880, ARRAY['image/jpeg', 'image/jpg', 'image/png'])
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Allow public read of guest signatures" ON storage.objects;
CREATE POLICY "Allow public read of guest signatures"
ON storage.objects FOR SELECT TO public USING (bucket_id = 'guest-signatures');

DROP POLICY IF EXISTS "Allow public upload of guest signatures" ON storage.objects;
CREATE POLICY "Allow public upload of guest signatures"
ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'guest-signatures');

-- ====================================================================
-- END OF MIGRATION 11
-- ====================================================================
