import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildAccountLinkInvitationEmail, hmacSha256Hex } from '../supabase/functions/_shared/workspcGatewayCore';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/86_institutional_account_linking_v1.sql');
const gateway = read('supabase/functions/workspc-gateway/index.ts');
const app = read('src/App.tsx');
const residentLogin = read('src/modules/auth/components/ResidentLoginView.tsx');
const memberLink = read('src/modules/auth/components/LinkInstitutionalAccessPrompt.tsx');
const invitation = read('src/modules/auth/components/InstitutionalAccountLinkInvitationView.tsx');
const admin = read('src/modules/org-admin/components/dashboard/AccountLinkingAdminPanel.tsx');
let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks += 1; };

for (const table of ['institutional_identity_contacts','institutional_account_link_invitations','institutional_account_link_events']) {
  check(migration.includes(`CREATE TABLE public.${table}`), `migration defines ${table}`);
  check(migration.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`), `${table} enables RLS`);
}
check(!migration.includes('migration 82') || migration.includes('no dependency on migrations 82 or 83'), 'migration explicitly excludes 82/83 dependency');
check(!migration.includes('case_continuity') && !migration.includes('storage.objects'), 'migration does not touch migrations 82/83 objects');
check(migration.includes('value_fingerprint') && migration.includes('masked_destination'), 'contact proof persists fingerprint and mask');
check(!/institutional_identity_contacts[\s\S]{0,500}\bemail\s+text/.test(migration), 'identity contact table stores no raw email');
check(migration.includes("source IN ('PREEXISTING_WORKFORCE_EMAIL', 'TENANT_ADMIN_CONFIRMED')"), 'proof sources are closed');
check(migration.includes("email_confirmed_at") && migration.includes("VERIFIED_WORKFORCE_EMAIL"), 'self-claim requires confirmed independent email proof');
check(migration.includes("legacy_code_disabled_at IS NOT NULL"), 'legacy-code revocation is respected');
check(migration.includes('FOR UPDATE') && migration.includes('organisation_memberships_one_workforce_link') === false, 'link functions serialize while using the existing membership unique invariant');
check(migration.includes("status IN ('ASSISTANCE_REQUESTED', 'PENDING_DELIVERY', 'SENT', 'DELIVERY_UNKNOWN')"), 'only one open invitation state family is permitted');
check(migration.includes('token_digest text UNIQUE') && !migration.includes('token_value'), 'only a unique token digest is persisted');
check(migration.includes("status='ACCEPTED'") && migration.includes("ALREADY_ACCEPTED"), 'acceptance is replay-safe and idempotent');
check(migration.includes("INVITATION_REJECTED") && migration.includes("INVITATION_REVOKED") && migration.includes("INVITATION_EXPIRED"), 'terminal invitation outcomes are audited');
check(migration.includes("is_tenant_admin = true") && migration.includes("om.tenant_id = v_workforce.tenant_id"), 'invitation issuer is an active same-tenant administrator');
check(migration.includes("REVOKE ALL ON TABLE public.%I FROM anon") && migration.includes("REVOKE ALL ON TABLE public.%I FROM authenticated"), 'durable identity evidence is browser-inaccessible');
check(migration.includes("GRANT EXECUTE ON FUNCTION public.workspc_account_link_prepare_invitation") && migration.includes('TO service_role'), 'invitation preparation is gateway-only');

const token = 'A'.repeat(43);
const mail = buildAccountLinkInvitationEmail('Workspc <notify@example.test>', 'member@example.test', token, '11111111-1111-4111-8111-111111111111');
check(mail.html.includes(encodeURIComponent(token)) && mail.subject.includes('institutional account link'), 'invitation mail contains the single-use link');
check(!mail.html.toLowerCase().includes('patient') && !mail.html.toLowerCase().includes('diagnos'), 'invitation mail contains no clinical context');
const digest = await hmacSha256Hex('test-only-pepper', `workspc-account-link-invitation-v1|${token}`);
check(digest.length === 64 && !digest.includes(token), 'gateway token digest is one-way evidence');
check(gateway.includes('crypto.getRandomValues(new Uint8Array(32))'), 'gateway creates a 256-bit invitation token');
check(gateway.includes('workspc-account-link-invitation-v1|'), 'gateway domain-separates invitation token hashes');
check(gateway.includes('workspc-account-link-${invitationId}') && gateway.includes('Idempotency-Key'), 'provider request has a durable idempotency key');
check(gateway.includes("case 'account_link.invitation.create'") && gateway.includes("case 'account_link.invitation.accept'") && gateway.includes("case 'account_link.invitation.revoke'"), 'single existing gateway exposes the bounded workflow');
check(!/return json\(req,\s*\{[^}]*token/s.test(gateway), 'gateway never returns the invitation token');
check(!/console\.(log|warn|error)\([^\n]*(token|recipient)/i.test(gateway), 'gateway does not log token or recipient');
check(residentLogin.includes('verifyResidentLoginByCode') && !residentLogin.includes('getWorkforce('), 'anonymous resident entry has no workforce directory');
check(memberLink.includes('emailMatches') && memberLink.includes('claimWorkforceMember'), 'member flow separates contact proof from account link');
check(memberLink.includes('registrationNextStepMessage') && memberLink.includes('code alone cannot link'), 'member UI explains independent proof and non-enumerating confirmation recovery');
check(invitation.includes("useState<'accept' | 'reject' | null>") && invitation.includes('authenticated'), 'recipient can accept or reject only after personal sign-in');
check(gateway.includes("case 'account_link.invitation.preview'") && gateway.includes('expectedFingerprint'), 'gateway exposes only an authenticated contact-matched invitation preview');
check(memberLink.includes('<ConfirmationDialog') && invitation.includes('<ConfirmationDialog'), 'self-claim and invitation decisions require explicit in-app review');
check(admin.includes('masked_destination') && !admin.includes('item.recipient'), 'admin UI exposes only masked destination');
check(admin.includes('Personal tenant-admin sign-in is required'), 'shared chief code is not treated as invitation authority');
check(app.includes('getCurrentUserMemberships') && app.indexOf('getCurrentUserMemberships') < app.indexOf('getLinkedWorkforceForDoctor(profile.id)'), 'app resolves canonical membership before legacy doctor link');
check(!memberLink.includes('localStorage') && !invitation.includes('localStorage'), 'link proof and tokens are not persisted in browser storage');
console.log(`institutional account linking v1 verifier passed (${checks} checks)`);
