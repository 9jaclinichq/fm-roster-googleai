-- ====================================================================
-- Migration 69: chief_get_active_member_contacts — narrow Chief-facing
-- email-directory RPC for the pending-submission follow-up workflow
-- ====================================================================
-- WRITTEN FOR REVIEW ONLY. NOT APPLIED LIVE. Do not run this against the
-- live database until a human explicitly lifts the current deployment
-- freeze and applies it (same discipline as migrations 66/67/68).
--
-- WHY THIS EXISTS: workforce.email has fully permissive table-level RLS
-- (USING(true), migration 01) but was DELIBERATELY never added to the
-- client SELECT grant/allowlist (see migration 26's own header: "email is
-- deliberately NOT added to the client SELECT allowlist"). No existing
-- RPC returns the email value to a Chief/admin caller — the only
-- email-adjacent RPC anywhere in the schema is verify_resident_login(),
-- which returns a has_email BOOLEAN on the resident's own login path, not
-- the value, and not to a Chief. This function is the first and only
-- sanctioned path for a Chief to read a member's actual email, for the
-- narrow purpose of manually following up with members who have not yet
-- submitted for the current collection cycle.
--
-- NAME/SHAPE DECISION (discovery finding, disclosed rather than
-- implemented silently): the originally preferred shape was a function
-- that derives the "pending" (not-yet-submitted) member set itself,
-- server-side. Discovery found that would require reimplementing "current
-- collection" resolution in SQL, and this repository currently has TWO
-- different rules for that:
--   (a) src/modules/shared/lib/submissionStatus.ts's canonical, locked
--       rule: settings.current_collection_id AND that collection's
--       status = 'open', with NO fallback to any other collection;
--   (b) ChiefDashboardView.tsx's own `activeColl` resolution:
--       `collectionsList.find(c => c.id === settings.current_collection_id)
--       || collectionsList[0] || null` — falls back to the first
--       collection in the list when the pointer doesn't resolve, and does
--       NOT check status = 'open' at all.
-- These two rules can disagree (e.g. a stale/missing settings pointer),
-- so a SQL-side "pending" re-derivation would risk silently diverging
-- from whichever set PendingResidentsPanel is already showing on screen -
-- a real semantic-drift risk, not a hypothetical one. Per the pre-approved
-- fallback for exactly this situation, this function does NOT re-derive
-- "pending" at all: it returns the email for every ACTIVE member of the
-- verified Chief's own tenant, nothing more. The client already computes
-- (and already renders) the pending set from data it already has; it
-- joins that existing, already-on-screen set against this function's
-- result by workforce_id. This guarantees the email shown can never
-- disagree with who the Chief is already looking at, at the cost of this
-- function's result technically covering more members than the currently-
-- pending subset (still tenant-scoped, active-only, email-only - never
-- exposed anywhere the pending join doesn't render it).
--
-- AUTHORIZATION: identical pattern to verify_chief_login()/
-- chief_get_workforce_codes() (migration 23) - re-verifies the admin
-- access code server-side on every call, derives the tenant from that
-- code alone (never a client-supplied tenant id), operates only within
-- that tenant. No new authentication mechanism invented.
--
-- MINIMUM FIELDS ONLY: {workforce_id, email}. Never resident_code/PIN,
-- never any other workforce column, never a full row. NULL email is
-- returned as NULL (not coalesced to a placeholder) so the client can
-- render an explicit "No email on file" state.
--
-- NO RLS CHANGE, NO CLIENT GRANT: this function runs SECURITY DEFINER,
-- bypassing the (already-permissive) RLS under its own narrow logic. It
-- does not grant SELECT(email) to anon/authenticated, does not touch
-- workforce's RLS policies, and does not modify chief_get_workforce_codes.

CREATE OR REPLACE FUNCTION public.chief_get_active_member_contacts(p_admin_code text)
RETURNS TABLE (
  workforce_id uuid,
  email text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT s.tenant_id INTO v_tenant_id FROM settings s WHERE s.admin_access_code = p_admin_code;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;

  RETURN QUERY
    SELECT w.id, w.email
    FROM workforce w
    WHERE w.tenant_id = v_tenant_id
      AND w.active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chief_get_active_member_contacts(text) TO anon, authenticated;

-- ====================================================================
-- END OF MIGRATION 69
-- ====================================================================
