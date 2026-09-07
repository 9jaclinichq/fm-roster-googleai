import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CAPABILITY_BADGES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PURPOSES,
  buildPreferenceMatrix,
  derivePrivyDocLinkage,
  isSafeInternalRoute,
  isSafeOverviewLabel,
  normalizeEmailAddress,
  normalizeWhatsAppNumber,
  planFailClosedDeliveries,
  redactForSafeLog,
  resolvePrivyDocPortalUrl,
} from '../src/modules/communication/lib/communicationDomain';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('supabase/migrations/84_communication_hub_v1.sql');
const hub = read('src/modules/communication/components/CommunicationHubView.tsx');
const service = read('src/modules/communication/lib/communicationService.ts');
const admin = read('src/modules/communication/components/CapabilityDelegationPanel.tsx');
const app = read('src/App.tsx');
const home = read('src/modules/shared/ui/IntelligenceHarnessHome.tsx');
const doctorHome = read('src/modules/doctors/components/DoctorHomeView.tsx');

let checks = 0;
function check(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks += 1;
}

check(normalizeWhatsAppNumber('+1 202-555-0123') === '+12025550123', 'WhatsApp numbers normalize to E.164');
check(normalizeWhatsAppNumber('001 (202) 555 0123') === '+12025550123', '00 international prefix normalizes safely');
assert.throws(() => normalizeWhatsAppNumber('08012345678'), /international E\.164 format/, 'local-format numbers are not guessed'); checks += 1;
check(normalizeEmailAddress('  Person@Example.COM ') === 'person@example.com', 'email normalization is explicit');
assert.throws(() => normalizeEmailAddress('not-an-email'), /valid email/, 'malformed email is rejected'); checks += 1;

const preferences = buildPreferenceMatrix([
  { purpose: 'ROSTER', channel: 'EMAIL', enabled: true },
  { purpose: 'PRODUCT_RELEASES', channel: 'IN_APP', enabled: true },
]);
check(preferences['ROSTER:EMAIL'] && !preferences['ROSTER:WHATSAPP'], 'roster email consent is channel-specific');
check(preferences['PRODUCT_RELEASES:IN_APP'] && !preferences['PRODUCT_RELEASES:EMAIL'], 'product release consent is distinct from operational consent');
check(Object.keys(preferences).length === NOTIFICATION_PURPOSES.length * NOTIFICATION_CHANNELS.length, 'all purpose/channel choices are independently represented');

check(CAPABILITY_BADGES.ROSTER_COORDINATE.label === 'Roster Coordinator', 'persisted roster capability derives the requested badge');
check(CAPABILITY_BADGES.MEMBER_SUPPORT.description.includes('Tenant-scoped'), 'badge accessibility copy states tenant scope');
check(isSafeInternalRoute('/workspace/consultant-review?invitation=abc-123'), 'safe Workspc route accepted');
check(!isSafeInternalRoute('https://example.test/private'), 'arbitrary external URL rejected');
check(isSafeOverviewLabel('September roster coordination'), 'neutral overview label accepted');
check(!isSafeOverviewLabel('Call +1 202 555 0123'), 'phone-like overview label rejected');
check(!isSafeOverviewLabel('token=super-secret'), 'token-like overview label rejected');
const redacted = redactForSafeLog('a@example.test +12025550123 https://x.test token=abc');
check(!redacted.includes('a@example.test') && !redacted.includes('+12025550123') && !redacted.includes('https://x.test') && !redacted.includes('=abc'), 'unsafe log content is redacted');

const deliveryPreferences = [
  { purpose: 'ROSTER' as const, channel: 'IN_APP' as const, enabled: true },
  { purpose: 'ROSTER' as const, channel: 'WHATSAPP' as const, enabled: true },
  { purpose: 'ROSTER' as const, channel: 'EMAIL' as const, enabled: true },
];
const firstPlan = planFailClosedDeliveries('roster:evt-1', 'W:member-1', 'ROSTER', deliveryPreferences);
const secondPlan = planFailClosedDeliveries('roster:evt-1', 'W:member-1', 'ROSTER', deliveryPreferences);
check(firstPlan.find(item => item.channel === 'IN_APP')?.outcome === 'SENT', 'in-app delivery remains available');
check(firstPlan.filter(item => item.channel !== 'IN_APP').every(item => item.outcome === 'FAILED' && item.failureClassification === 'PROVIDER_DISABLED' && !item.retryEligible), 'external delivery fails closed without retry');
check(firstPlan.map(item => item.dedupKey).join('|') === secondPlan.map(item => item.dedupKey).join('|'), 'duplicate events produce identical deduplication keys');
check(derivePrivyDocLinkage(false, true).state === 'ELIGIBLE', 'doctor eligibility does not claim a link');
check(derivePrivyDocLinkage(true, true).state === 'LINKED', 'linked state requires explicit evidence input');
check(resolvePrivyDocPortalUrl('https://portal.privydoc.com.ng') === 'https://portal.privydoc.com.ng', 'safe PrivyDoc origin accepted');
check(resolvePrivyDocPortalUrl('https://portal.privydoc.com.ng?phone=123') === 'https://portal.privydoc.com.ng', 'query-bearing portal configuration fails closed');
check(resolvePrivyDocPortalUrl('https://lookalike.example') === 'https://portal.privydoc.com.ng', 'non-PrivyDoc origins fail closed');

for (const table of [
  'communication_contact_points', 'communication_verification_requests', 'communication_preferences', 'tenant_capability_delegations',
  'communication_conversations', 'communication_participants', 'communication_messages',
  'support_tickets', 'review_invitations', 'notification_deliveries', 'privydoc_identity_links',
]) check(migration.includes(`CREATE TABLE ${table}`), `migration defines ${table}`);

check(migration.includes("verification_state = 'VERIFIED' AND verified_at IS NOT NULL AND verification_evidence_reference IS NOT NULL"), 'verified contact state requires evidence');
check(migration.includes("enabled boolean NOT NULL DEFAULT false"), 'notification consent defaults off');
check(migration.includes("status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'REVOKED'))"), 'delegation lifecycle is explicit');
check(migration.includes('capability, status, grantor_auth_user_id, grantor_authority'), 'capability grants persist the declared grantor identity column');
check(migration.includes("UPDATE tenant_capability_delegations SET status = 'REVOKED'"), 'revocation is durable rather than destructive');
check(migration.includes("access_revoked_at = timezone('utc'::text, now())"), 'support access is removed immediately on revocation');
check(migration.includes("RAISE EXCEPTION 'Coordinator capability is not active'") && migration.includes("cp.participant_role = 'COORDINATOR'"), 'revoked coordinators lose privileged reply and conversation access');
check(migration.includes("p_target_workforce_id = v_id") && migration.includes("w.tenant_id = v_tenant_id"), 'self-target and cross-tenant coordination are rejected');
check(migration.includes("p_invitee_workforce_id = v_id") && migration.includes("Reviewer must be another active member of this tenant"), 'self and cross-tenant review invitations are rejected');
check(migration.includes("Review artifact is unavailable or not owned by the inviter"), 'artifact ownership is server verified');
check(migration.includes("permission_state = 'AVAILABLE'"), 'completion requires an available owner-safe permission seam');
check(!/communication_get_hub[\s\S]*UPDATE review_invitations[\s\S]*Contact and preference mutations/.test(migration), 'opening/loading the hub does not mutate invitation status');
check(migration.includes("outcome IN ('PENDING', 'SENT', 'FAILED', 'UNKNOWN')"), 'durable delivery outcomes are constrained');
check(migration.includes("outcome <> 'UNKNOWN' OR retry_eligible = false"), 'UNKNOWN is never silently retryable');
check(migration.includes('notification_delivery_dedup UNIQUE (event_key, recipient_owner_key, channel)'), 'delivery attempts are deduplicated per event/recipient/channel');
check(migration.includes("'META_WHATSAPP_DISABLED'") && migration.includes("'RESEND_EMAIL_DISABLED'"), 'external adapters are explicitly disabled');
check(!/Deno\.env|getPublicUrl|service[_-]?role[_-]?key/i.test(service + hub), 'browser communication code contains no provider/service-role access or public URLs');
check(migration.includes('REVOKE ALL ON TABLE %I FROM anon') && migration.includes('REVOKE ALL ON TABLE %I FROM authenticated'), 'new tables deny direct browser access');
check(migration.includes("cp.access_revoked_at IS NULL") && migration.includes('Conversation access denied'), 'conversation reads and mutations require an active participant');
check(!migration.includes('platform_operator') && !migration.includes('platform_operators'), 'platform operators receive no implicit conversation access');
check(migration.includes("'sender_name', m.sender_name") && migration.includes("v_kind, v_actor->>'name'"), 'messages preserve actual actor identity');
check(!migration.includes('DELETE FROM communication_messages'), 'message deletion cannot erase evidence');
check(migration.includes('migration 81 as the production ceiling') && migration.includes('82 and 83 are unapplied'), 'migration documents verified ceiling separately from local files');
check(!/case_continuity_actions|case-source-restricted|storage\.objects/.test(migration), 'migration 84 does not depend on migrations 82 or 83');

check(app.includes('path="/workspace/communication"') && app.includes('path="/doctor/communication"'), 'authenticated member and doctor routes are wired');
check(home.includes("path: '/workspace/communication'"), 'resident home exposes the Communication Hub');
check(doctorHome.includes("navigate('/doctor/communication')"), 'independent doctor home exposes the Communication Hub');
check(hub.includes('Email and WhatsApp delivery are not yet activated'), 'provider state is truthfully visible');
check(hub.includes('does not accept or complete') || migration.includes('does not accept or complete'), 'opening an invitation is explicitly non-terminal');
check(hub.includes('not an emergency or clinical consultation channel'), 'support boundary is visible');
check(hub.includes('No conversations yet.') && hub.includes('could not be loaded'), 'empty and error states are graceful');
check(admin.includes('<CapabilityBadge') && admin.includes('revokeCapability'), 'admin delegation surface derives badges and supports revocation');
check(!/Olanipekun|\bUCH\b|@gmail|080[0-9]{8}/i.test(hub + service + admin + migration), 'new product code contains no personal or tenant hardcoding');

const migrationNumbers = readdirSync(resolve(root, 'supabase/migrations'))
  .filter(name => /^\d+_/.test(name)).map(name => Number(name.split('_')[0]));
check(Math.max(...migrationNumbers) === 84, 'local migration ceiling is 84');

console.log(`communication hub v1 verifier passed (${checks} checks)`);
