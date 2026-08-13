-- Migration 20: close cross-tenant leak in chief_get_workforce_codes
--
-- Found by an adversarial scale/performance audit: chief_get_workforce_codes
-- (defined in migration 01, re-defined in migration 19 for an unrelated
-- ambiguous-column fix) has NEVER filtered by tenant — any holder of ANY
-- tenant's admin_access_code could call it and receive every workforce
-- member's plaintext resident_code across the ENTIRE platform, not just
-- their own tenant. Not exploitable today in practice (only one tenant has
-- ever had real workforce rows), but live-exploitable the moment a second
-- tenant's workforce gets any rows — including via the already-working SaaS
-- Operator tenant-provisioning flow.
--
-- FIX SCOPE: this app has no tenant-aware Chief session yet (a single
-- shared admin_access_code, not one per tenant — see CLAUDE.md's SaaS
-- section, "a real multi-tenant Chief admin code... is still a future gap,
-- not solved here"). So there is no real tenant_id to thread in from the
-- caller. Rather than silently build that larger feature here, this
-- migration hardcodes the filter to the one seeded tenant
-- (DEFAULT_TENANT_ID in src/lib/databaseService.ts), matching the same
-- provisional pattern workforce.tenant_id's own DEFAULT already uses. This
-- closes the leak for today's reality (one real tenant) without changing
-- the function's call signature, so no client code needs to change. When
-- real per-tenant Chief sessions exist, this hardcoded value must become a
-- parameter threaded from that session — flagged here so it isn't missed.

CREATE OR REPLACE FUNCTION public.chief_get_workforce_codes(p_admin_code text)
RETURNS TABLE(id uuid, resident_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings WHERE settings.id = 1 AND settings.admin_access_code = p_admin_code) THEN
    RAISE EXCEPTION 'Invalid admin access code' USING ERRCODE = '28000';
  END IF;
  RETURN QUERY
    SELECT w.id, w.resident_code::text
    FROM workforce w
    WHERE w.tenant_id = '00000000-0000-0000-0000-000000000001';
END;
$$;
