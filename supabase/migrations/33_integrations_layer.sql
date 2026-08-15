-- Migration 33: integrations layer scaffold (catalog + connections)
--
-- SCOPE: this migration is a SCAFFOLD only — a catalog of known/planned tool
-- integrations (native features already built in this app, plus external
-- providers not yet wired up) and a connections table recording per-tenant
-- or per-individual-doctor connection STATUS. It deliberately does NOT
-- implement any real OAuth/API integration flow for any of the 7 unbuilt
-- external tools (literature search, reference manager, calendar/video,
-- e-signature, etc.) — that is materially larger, per-provider work that
-- needs its own scoping pass later, matching this repo's own
-- "silent scope creep is not acceptable" policy (see CLAUDE.md).
--
-- Reserved migration numbers: 32 and 34 belong to a sibling stream (event
-- bus / UDR / agent manifests); 35 belongs to another sibling stream (Forms
-- generalization). This file only claims 33.
--
-- WHY TWO TABLES: `integrations_catalog` is read-only reference data (what
-- integrations exist, what they're for, which modules they feed) — the same
-- shape as this app's other seeded reference tables (e.g. `casebook_templates`,
-- `research_templates`). `integrations_connections` is the per-owner
-- connection record — mirrors the `user_subscriptions.scope` pattern from
-- migration 30 (tenant-level vs individual-level ownership, exactly one
-- owner shape per scope, enforced by a CHECK constraint) rather than
-- inventing a new ownership convention.
--
-- OWNER SHAPE FOR `scope='individual'`: unlike migration 30's
-- `user_subscriptions` (which only ever has a `workforce_id` owner), an
-- individual connection here can be owned by EITHER a workforce-linked
-- resident OR an unaffiliated individual doctor (`doctor_profiles`, migration
-- 18) — this app has had two individual-identity shapes since migration 18,
-- so the CHECK constraint requires exactly one of `workforce_id`/`doctor_id`
-- (not both, not neither) whenever scope='individual', and neither when
-- scope='tenant' (which requires `tenant_id` instead). This is a 3-way
-- version of migration 30's 2-way shape check, same style.
--
-- RLS: same permissive `USING (true) WITH CHECK (true)` posture as every
-- other table in this app since migration 01 (see CLAUDE.md Security Notes)
-- — deliberately NOT tightened here. No real OAuth tokens/secrets land in
-- `integrations_connections` in this pass (`external_ref` is just an opaque
-- reference id/slug for this scaffold); if a future pass stores real
-- provider tokens here, RLS should be revisited THEN, not preemptively now.
--
-- NOT applied to the live database by this pass — SQL only, per the task's
-- explicit instruction. Apply manually via the Supabase dashboard/CLI when
-- ready, same as every other migration in this repo (no automated runner).

-- --------------------------------------------------
-- 1. INTEGRATIONS CATALOG (reference data)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS integrations_catalog (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  integration_key text UNIQUE NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('native', 'external')),
  auth_type text NOT NULL DEFAULT 'none',
  feeds_modules text[] NOT NULL DEFAULT '{}',
  description text,
  created_at timestamptz DEFAULT now()
);

-- --------------------------------------------------
-- 2. INTEGRATIONS CONNECTIONS (per-tenant or per-individual status)
-- --------------------------------------------------

CREATE TABLE IF NOT EXISTS integrations_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  integration_id uuid REFERENCES integrations_catalog(id) NOT NULL,
  tenant_id uuid REFERENCES tenants(id),
  workforce_id uuid REFERENCES workforce(id),
  doctor_id uuid REFERENCES doctor_profiles(id),
  status text NOT NULL DEFAULT 'disconnected',
  scope text NOT NULL CHECK (scope IN ('tenant', 'individual')),
  external_ref text,
  connected_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Exactly one owner shape per scope, same style as migration 30's
-- user_subscriptions_scope_shape_check:
--   scope='tenant'     -> tenant_id required, workforce_id AND doctor_id both NULL
--   scope='individual' -> tenant_id NULL, exactly one of workforce_id/doctor_id set
ALTER TABLE integrations_connections DROP CONSTRAINT IF EXISTS integrations_connections_scope_shape_check;
ALTER TABLE integrations_connections ADD CONSTRAINT integrations_connections_scope_shape_check
  CHECK (
    (scope = 'tenant' AND tenant_id IS NOT NULL AND workforce_id IS NULL AND doctor_id IS NULL)
    OR
    (scope = 'individual' AND tenant_id IS NULL AND (
      (workforce_id IS NOT NULL AND doctor_id IS NULL)
      OR
      (workforce_id IS NULL AND doctor_id IS NOT NULL)
    ))
  );

CREATE INDEX IF NOT EXISTS idx_integrations_connections_tenant
  ON integrations_connections(tenant_id, integration_id);
CREATE INDEX IF NOT EXISTS idx_integrations_connections_workforce
  ON integrations_connections(workforce_id, integration_id);
CREATE INDEX IF NOT EXISTS idx_integrations_connections_doctor
  ON integrations_connections(doctor_id, integration_id);

-- --------------------------------------------------
-- 3. RLS — same permissive posture as every other table in this app
-- --------------------------------------------------

ALTER TABLE integrations_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "integrations_catalog_select" ON integrations_catalog;
CREATE POLICY "integrations_catalog_select" ON integrations_catalog FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "integrations_catalog_insert" ON integrations_catalog;
CREATE POLICY "integrations_catalog_insert" ON integrations_catalog FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "integrations_catalog_update" ON integrations_catalog;
CREATE POLICY "integrations_catalog_update" ON integrations_catalog FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "integrations_connections_select" ON integrations_connections;
CREATE POLICY "integrations_connections_select" ON integrations_connections FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "integrations_connections_insert" ON integrations_connections;
CREATE POLICY "integrations_connections_insert" ON integrations_connections FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "integrations_connections_update" ON integrations_connections;
CREATE POLICY "integrations_connections_update" ON integrations_connections FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);

-- --------------------------------------------------
-- 4. SEED DATA — the 8 known/planned integrations
-- --------------------------------------------------
--
-- payment-processor is the one row that's ALREADY live at the platform
-- level (Flutterwave, migration 17/30 — see CLAUDE.md's Billing section):
-- represented here with auth_type = 'platform_managed' (a secret held as a
-- Supabase Edge Function secret, configured once for the whole platform,
-- not a per-tenant/per-individual OAuth connection) rather than 'oauth' or
-- 'api_key' like the other 7 unbuilt stubs — there is no per-tenant
-- "Connect" action for it because there is nothing per-tenant to connect;
-- every tenant already transacts through the same platform-level Flutterwave
-- account. The other 7 rows use auth_type = 'oauth' or 'api_key' as a
-- placeholder best-guess for their eventual real integration, since none of
-- them have been scoped yet.

INSERT INTO integrations_catalog (integration_key, name, category, kind, auth_type, feeds_modules, description)
VALUES
  ('statistical-analyser', 'Statistical Analyser', 'analysis', 'native', 'none',
    ARRAY['research'],
    'Built-in statistical analysis tooling for the Research Engine. Native feature, not an external provider connection.'),
  ('literature-search', 'Literature Search', 'research', 'external', 'oauth',
    ARRAY['research', 'clinical_writing'],
    'External literature search provider (e.g. PubMed/Scopus-style lookup) feeding the Research Engine and clinical write-up workflows. Not yet built.'),
  ('literature-evidence-matrix', 'Literature Evidence Matrix', 'research', 'native', 'none',
    ARRAY['research'],
    'Built-in evidence/literature matrix synthesis, already backed by the research-copilot Edge Function''s synthesize_literature_matrix action. Native feature, not an external provider connection.'),
  ('reference-manager', 'Reference Manager', 'citation', 'external', 'oauth',
    ARRAY['clinical_writing', 'research'],
    'External reference-manager provider (e.g. Zotero/Mendeley-style citation sync) for clinical write-ups and research chapters. Not yet built.'),
  ('writing-space', 'Writing Space', 'writing', 'native', 'none',
    ARRAY['clinical_writing', 'research'],
    'Built-in structured writing surface (chapters, case reports) already live across the Research Engine and Casebook/Dissertation modules. Native feature, not an external provider connection.'),
  ('calendar-video', 'Calendar & Video', 'scheduling', 'external', 'oauth',
    ARRAY['scheduling', 'meetings'],
    'External calendar/video-conferencing provider (e.g. Google Calendar/Zoom-style scheduling and meeting links). Not yet built.'),
  ('e-signature', 'E-Signature', 'documents', 'external', 'oauth',
    ARRAY['forms', 'clinical_writing'],
    'External e-signature provider for signing off forms and clinical documents. Not yet built.'),
  ('payment-processor', 'Payment Processor', 'billing', 'external', 'platform_managed',
    ARRAY['billing'],
    'Flutterwave, already integrated and live at the platform level (see payment-checkout/payment-webhook Edge Functions and migrations 17/30) — configured once via a platform-held secret, not a per-tenant/per-individual OAuth connection.')
ON CONFLICT (integration_key) DO NOTHING;

-- ====================================================================
-- END OF MIGRATION 33
-- ====================================================================
