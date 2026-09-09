\set ON_ERROR_STOP on
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

CREATE TABLE auth.users (
  id uuid PRIMARY KEY,
  email text,
  email_confirmed_at timestamptz
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE TABLE public.tenants (id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(), name text NOT NULL);
CREATE TABLE public.workforce (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  full_name text NOT NULL,
  category text NOT NULL,
  resident_code text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  email text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE TABLE public.doctor_profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id),
  email text NOT NULL,
  full_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);
CREATE TABLE public.organisation_memberships (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  auth_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workforce_id uuid REFERENCES public.workforce(id) ON DELETE SET NULL,
  is_workforce_member boolean NOT NULL DEFAULT false,
  is_tenant_admin boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  linked_at timestamptz,
  claimed_at timestamptz,
  claim_method text,
  legacy_code_disabled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (tenant_id, auth_user_id),
  CHECK (is_workforce_member OR is_tenant_admin),
  CHECK (NOT is_workforce_member OR workforce_id IS NOT NULL)
);
CREATE UNIQUE INDEX organisation_memberships_one_workforce_link
  ON public.organisation_memberships(tenant_id, workforce_id)
  WHERE workforce_id IS NOT NULL AND status IN ('active','suspended');
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = timezone('utc', now()); RETURN NEW; END
$$;
CREATE TABLE public.unrelated_sentinel(id integer PRIMARY KEY, value text NOT NULL);
INSERT INTO public.unrelated_sentinel VALUES (1, 'unchanged');
INSERT INTO public.tenants(id,name) VALUES
 ('10000000-0000-4000-8000-000000000001','Tenant A'),
 ('20000000-0000-4000-8000-000000000002','Tenant B');
INSERT INTO public.workforce(id,tenant_id,full_name,category,resident_code,active,email) VALUES
 ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Member One','Resident','111111',true,'member.one@example.test'),
 ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Member Two','Resident','222222',true,'member.two@example.test'),
 ('30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','No Prior Contact','Resident','333333',true,null),
 ('30000000-0000-4000-8000-000000000004','20000000-0000-4000-8000-000000000002','Other Tenant','Resident','444444',true,'other@example.test');
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('40000000-0000-4000-8000-000000000001','member.one@example.test',now()),
 ('40000000-0000-4000-8000-000000000002','wrong@example.test',now()),
 ('40000000-0000-4000-8000-000000000003','member.two@example.test',null),
 ('40000000-0000-4000-8000-000000000004','admin@example.test',now()),
 ('40000000-0000-4000-8000-000000000005','otheradmin@example.test',now()),
 ('40000000-0000-4000-8000-000000000006','member.two@example.test',now()),
 ('40000000-0000-4000-8000-000000000009','other@example.test',now());
INSERT INTO public.doctor_profiles(id,email,full_name) SELECT id,email,'Test profile' FROM auth.users;
INSERT INTO public.organisation_memberships(tenant_id,auth_user_id,is_tenant_admin) VALUES
 ('10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000004',true),
 ('20000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000005',true);
