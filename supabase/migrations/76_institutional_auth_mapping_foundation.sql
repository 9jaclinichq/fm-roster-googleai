-- Institutional Auth Mapping Foundation (additive only).
--
-- Per prompt1.txt: "Introduce a server-verifiable authenticated
-- person<->tenant membership foundation without changing any existing
-- authorization behavior." Reconciled against docs/INSTITUTIONAL_AUTH_
-- MIGRATION_SPEC.md's own architecture (Organisation Membership as a
-- distinct Person<->Organisation primitive, §3; this is that spec's own
-- Slice 17 row 1, "Foundation/linking primitives") -- no file literally
-- named "Codex Institutional Auth Mapping Foundation handoff" exists in
-- this repository; the in-repo spec above is the closest and only
-- matching reviewed architecture document found, and this migration's
-- exact fields/constraints/RLS/RPC shape were reconciled directly against
-- the CURRENT live schema (doctor_profiles/tenants/workforce), not merely
-- copied from that spec's own conceptual description.
--
-- THIS MIGRATION DOES NOT:
--   - touch verify_resident_login/verify_chief_login or any existing
--     code-based login path in any way;
--   - implement any claim/link RPC (resident, Chief, or otherwise);
--   - disable, weaken, or reference resident_code/admin_access_code;
--   - migrate or backfill any real user;
--   - tighten RLS on workforce/settings/collections/submissions/rosters/
--     announcements/tenants or any other existing institutional table;
--   - build role tables, appointment history, or a broader RBAC/
--     capability framework.
-- It only adds one new, currently-unreferenced table and one new,
-- currently-unreferenced read-only resolver RPC. No existing table,
-- function, policy, or grant is altered by this file.
--
-- organisation_memberships is one durable row per (tenant, authenticated
-- person) -- the "Organisation Membership" primitive from the spec above,
-- deliberately NOT collapsed into `workforce` (a workforce row is an
-- optional, separate "Workforce Record" a membership may link to, per
-- that spec's §3 -- a tenant admin with no workforce row at all is a
-- fully valid membership, per the relationship invariant below).
--
-- Schema conventions matched exactly against this repo's current
-- migrations (verified by direct read of doctor_profiles/tenants/
-- workforce, not assumed): uuid PKs via gen_random_uuid(); timestamptz
-- columns defaulted via timezone('utc'::text, now()), never bare now();
-- status columns as text CHECK(...) (no native enum exists anywhere in
-- this schema); auth.users FKs use ON DELETE CASCADE (doctor_profiles'
-- own pattern); an optional/nullable domain-record FK uses ON DELETE SET
-- NULL (workforce.doctor_id's own pattern); partial unique indexes
-- follow roster_revisions'/workforce.email's own precedent.
CREATE TABLE IF NOT EXISTS organisation_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which tenant this membership belongs to. No ON DELETE clause, mirroring
  -- workforce.tenant_id's own existing FK style exactly.
  tenant_id uuid NOT NULL REFERENCES tenants(id),

  -- The authenticated Supabase Auth principal this row belongs to. This is
  -- the ONE server-verifiable fact this whole table exists to carry --
  -- every other column describes what that principal IS allowed within
  -- tenant_id, never re-derives who they are. ON DELETE CASCADE mirrors
  -- doctor_profiles.id's own FK to auth.users (the one other place this
  -- repo links a row to a real Auth principal).
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Optional, current-operational-only link to a workforce row (a
  -- "Workforce Record" per the reviewed architecture's §3 -- NOT
  -- historical appointment storage; if a person's operational workforce
  -- assignment changes, this column is updated in place, it does not grow
  -- a history here). Nullable: a tenant admin with no workforce
  -- participation has NULL here and that is a fully valid, terminal state,
  -- not a placeholder awaiting a future value. ON DELETE SET NULL mirrors
  -- workforce.doctor_id's own existing FK style exactly -- deleting a
  -- workforce row must never cascade-delete the membership/auth link
  -- itself.
  workforce_id uuid REFERENCES workforce(id) ON DELETE SET NULL,

  -- Relationship invariant (enforced below, not just documented): at
  -- least one of these two must be true for every row. A membership that
  -- is neither a workforce participant nor a tenant admin describes
  -- nothing and must not be representable.
  is_workforce_member boolean NOT NULL DEFAULT false,
  is_tenant_admin boolean NOT NULL DEFAULT false,

  -- Lifecycle status. 'active' is the only status that may ever authorize
  -- future authenticated routing -- 'suspended'/'revoked' must never do
  -- so (enforced by future routing-consumer logic, not by this table
  -- itself, which only records the fact). No claim/admin/revocation RPC
  -- is implemented by this migration -- status starts and stays 'active'
  -- until a future, separately reviewed slice adds a way to change it.
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'revoked')),

  -- created_at: this membership ROW exists, nothing more -- it says
  -- nothing about whether the underlying person/link has been verified in
  -- any way.
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  -- linked_at: a system/admin action established this
  -- auth_user_id<->tenant_id (and optionally workforce_id) association,
  -- WITHOUT the person themselves having proven/claimed it (e.g. a future
  -- Chief-assisted linking action). Null until that happens. Not defaulted
  -- to created_at -- row existence and system-linked are different facts
  -- and must not be conflated.
  linked_at timestamptz,

  -- claimed_at: the person themselves explicitly proved/claimed this
  -- relationship (e.g. a future OTP-verified claim flow). Deliberately
  -- NEVER defaulted -- per this slice's explicit instruction, a claim is
  -- a real event that either happened or didn't; it is never inferred
  -- from row existence or from linked_at.
  claimed_at timestamptz,

  -- claim_method: which mechanism produced claimed_at (e.g. a future
  -- 'resident_code_otp'/'admin_code_otp'/'chief_assisted_recovery' value).
  -- Deliberately left as unconstrained nullable text, not a CHECK-bounded
  -- enum -- the actual claim RPCs (and therefore the real vocabulary of
  -- claim methods) are explicit non-goals of this slice; constraining the
  -- values now would be inventing that vocabulary before it is designed.
  -- Nullable until a real link/claim exists (enforced below: never
  -- non-null without claimed_at also being non-null).
  claim_method text,

  -- legacy_code_disabled_at: when (if ever) this specific person's legacy
  -- resident_code/admin_access_code server-authorization was disabled as a
  -- result of this membership's claim, per the reviewed architecture's
  -- locked per-individual-immediate-cutover rule (§14). Null today and for
  -- the entire lifetime of this migration -- no claim RPC exists yet to
  -- ever set it. Recorded here now so that future column exists ahead of
  -- the claim-flow slice that will populate it, rather than requiring a
  -- second additive migration purely to add this one fact later.
  legacy_code_disabled_at timestamptz,

  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),

  CONSTRAINT organisation_memberships_relationship_invariant
    CHECK (is_workforce_member OR is_tenant_admin),

  -- claim_method only ever means something alongside a real claimed_at --
  -- never allow one without the other to exist independently.
  CONSTRAINT organisation_memberships_claim_method_requires_claimed_at
    CHECK (claim_method IS NULL OR claimed_at IS NOT NULL),

  -- Cardinality, exactly as specified: one row per (tenant, authenticated
  -- person). The SAME auth_user_id may legitimately have separate rows
  -- across DIFFERENT tenants (multi-organisation membership, per the
  -- reviewed architecture's §3/§15) -- this constraint only forbids a
  -- second row for the same person within the SAME tenant.
  CONSTRAINT organisation_memberships_tenant_auth_user_unique
    UNIQUE (tenant_id, auth_user_id)
);

-- Prevents the SAME current workforce row from being linked to two
-- simultaneously active/suspended authenticated memberships -- a
-- workforce row's operational identity must resolve to at most one
-- currently-live authenticated person at a time. A 'revoked' membership
-- does not hold this lock, so the workforce_id becomes linkable again
-- once its prior membership is revoked. Partial-unique-index syntax
-- matches roster_revisions' own precedent
-- (unique_editing_revision_per_collection) and workforce's own
-- idx_workforce_email_unique exactly.
CREATE UNIQUE INDEX IF NOT EXISTS organisation_memberships_one_active_workforce_link
  ON organisation_memberships (workforce_id)
  WHERE workforce_id IS NOT NULL AND status IN ('active', 'suspended');

-- Primary access pattern for both the RLS policy below and the resolver
-- RPC is "find this auth_user_id's own rows" with no tenant_id in the
-- predicate -- the (tenant_id, auth_user_id) unique constraint's own
-- composite index does not efficiently serve an auth_user_id-only lookup,
-- so this is a dedicated index for that exact access pattern.
CREATE INDEX IF NOT EXISTS organisation_memberships_auth_user_id_idx
  ON organisation_memberships (auth_user_id);

DROP TRIGGER IF EXISTS organisation_memberships_set_updated_at ON organisation_memberships;
CREATE TRIGGER organisation_memberships_set_updated_at
BEFORE UPDATE ON organisation_memberships
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

-- =====================================================================
-- RLS -- authenticated may SELECT only their own row(s); no INSERT/
-- UPDATE/DELETE policy exists at all (client writes are structurally
-- impossible, not merely discouraged); anon gets no grant and no policy.
-- This is the first table in this repo enforced by a REAL row-level
-- policy referencing auth.uid() directly (doctor_profiles/its owned
-- children already do this for doctor-owned rows; this is the first
-- tenant-membership-shaped table to do so) rather than the RPC-only
-- zero-policy posture used by roster_section_config/roster_revisions --
-- appropriate here specifically because this table's own row IS the
-- caller's real, auth.uid()-keyed identity fact, not tenant-wide
-- operational data.
-- =====================================================================

ALTER TABLE organisation_memberships ENABLE ROW LEVEL SECURITY;

-- Explicit revoke-then-grant (not merely relying on RLS alone, per this
-- slice's own explicit "revoke/limit grants accordingly" instruction) --
-- belt-and-suspenders: anon has neither a grant NOR a policy; authenticated
-- has a SELECT grant that RLS then narrows to own-row-only. No role is
-- ever granted INSERT/UPDATE/DELETE on this table.
REVOKE ALL ON organisation_memberships FROM PUBLIC;
REVOKE ALL ON organisation_memberships FROM anon;
GRANT SELECT ON organisation_memberships TO authenticated;

CREATE POLICY organisation_memberships_select_own
  ON organisation_memberships
  FOR SELECT
  TO authenticated
  USING (auth.uid() = auth_user_id);

-- No INSERT/UPDATE/DELETE policy of any kind is created, for any role.
-- Every future write path (claim, admin link, status change) must go
-- through a to-be-designed SECURITY DEFINER RPC in a separately reviewed
-- slice -- never a direct client mutation. Future status-changing
-- workflows (suspend/revoke/reinstate, admin-assisted linking) MUST
-- preserve lifecycle provenance through an approved audit/history
-- mechanism (mirroring this repo's existing event_log/emitEvent
-- pattern) when they are built -- this migration deliberately does not
-- build that mechanism now, and does not implement any status-changing
-- RPC itself.

-- =====================================================================
-- Resolver RPC -- the only sanctioned way any client ever reads this
-- table's content. Takes no arguments; derives the caller exclusively
-- from auth.uid() (never a client-supplied identity); an unauthenticated
-- caller gets zero rows back, not an error and not another caller's data.
-- Enriches with tenant/workforce DISPLAY fields only, via SECURITY
-- DEFINER (so the caller's own possibly-nonexistent direct SELECT
-- privilege on tenants/workforce is irrelevant -- this function decides
-- what to expose, not the caller's ambient grants), scoped by this
-- function's own WHERE auth_user_id = auth.uid() -- never a blanket
-- tenants/workforce read.
-- =====================================================================

CREATE OR REPLACE FUNCTION current_user_organisation_memberships()
RETURNS TABLE (
  membership_id uuid,
  tenant_id uuid,
  tenant_name text,
  workforce_id uuid,
  workforce_full_name text,
  is_workforce_member boolean,
  is_tenant_admin boolean,
  status text,
  linked_at timestamptz,
  claimed_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Belt-and-suspenders: even though EXECUTE is never granted to anon/
  -- PUBLIC below, an unauthenticated caller (auth.uid() IS NULL) gets an
  -- explicit empty result here too -- exposing nothing is enforced at
  -- both the grant layer and the function body, not just one of them.
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  -- auth_user_id is deliberately NOT returned -- the caller already knows
  -- their own auth.uid() from their own session; echoing it back adds no
  -- information and is omitted per this slice's own explicit review
  -- instruction ("if unnecessary, omit it").
  --
  -- Every status value is returned, including 'suspended'/'revoked' --
  -- this resolver's job is to honestly enumerate the caller's real
  -- memberships, not to pre-filter them. A future routing consumer is the
  -- one that must never treat 'suspended'/'revoked' as authorizing
  -- anything -- that enforcement belongs at the call site that decides
  -- what to DO with a membership, not by hiding the row here.
  RETURN QUERY
  SELECT
    om.id,
    om.tenant_id,
    t.name,
    om.workforce_id,
    w.full_name,
    om.is_workforce_member,
    om.is_tenant_admin,
    om.status,
    om.linked_at,
    om.claimed_at
  FROM organisation_memberships om
  JOIN tenants t ON t.id = om.tenant_id
  LEFT JOIN workforce w ON w.id = om.workforce_id
  WHERE om.auth_user_id = auth.uid();
END;
$$;

-- Postgres grants EXECUTE to PUBLIC by default on function creation --
-- explicitly revoked here so anon does NOT inherit it, then granted to
-- authenticated only. This is the first authenticated-only (not
-- "anon, authenticated") RPC grant in this repo -- every existing RPC is
-- still code/PIN-based and therefore callable pre-Auth-session, which
-- this one deliberately is not.
REVOKE ALL ON FUNCTION current_user_organisation_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_user_organisation_memberships() TO authenticated;
