import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildOperationalEmail,
  buildVerificationEmail,
  buildWhatsAppTemplateRequest,
  classifyProviderFailure,
  hmacSha256Hex,
  isAllowedPurpose,
  isAllowedTemplateKey,
  makeNumericOtp,
  redactGatewayError,
  timingSafeEqual,
  verifyHmacSha256Signature,
  verifySvixWebhookSignature,
} from '../supabase/functions/_shared/workspcGatewayCore';

const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
const migration = read('supabase/migrations/85_secure_delivery_gateway_v1.sql');
const gateway = read('supabase/functions/workspc-gateway/index.ts');
const core = read('supabase/functions/_shared/workspcGatewayCore.ts');
const paymentCheckout = read('supabase/functions/payment-checkout/index.ts');
const paymentWebhook = read('supabase/functions/payment-webhook/index.ts');
const client = read('src/lib/databaseService.ts');
const communicationClient = read('src/modules/communication/lib/communicationService.ts');

let checks = 0;
function check(condition: unknown, message: string) {
  assert.ok(condition, message);
  checks += 1;
}

const otp = makeNumericOtp(new Uint8Array([0xff, 0xee, 0xdd, 0xcc]));
check(/^\d{6}$/.test(otp), 'OTP generation produces six numeric digits');
const firstDigest = await hmacSha256Hex('test-only-pepper', `workspc-otp-v1|${otp}`);
const secondDigest = await hmacSha256Hex('test-only-pepper', `workspc-otp-v1|${otp}`);
const otherDigest = await hmacSha256Hex('different-test-pepper', `workspc-otp-v1|${otp}`);
check(firstDigest.length === 64 && firstDigest === secondDigest && firstDigest !== otherDigest, 'OTP evidence is deterministic only under the same secret pepper');
check(timingSafeEqual(firstDigest, secondDigest) && !timingSafeEqual(firstDigest, otherDigest), 'constant-time equality distinguishes digests');
check(classifyProviderFailure(400) === 'REJECTED' && classifyProviderFailure(503) === 'UNKNOWN' && classifyProviderFailure(null) === 'UNKNOWN', 'only provider 4xx responses are definitive failures');
check(isAllowedPurpose('ROSTER') && !isAllowedPurpose('ARBITRARY'), 'notification purposes are allow-listed');
check(isAllowedTemplateKey('support_reply') && !isAllowedTemplateKey('arbitrary_body'), 'notification templates are allow-listed');

const verificationEmail = buildVerificationEmail('Workspc <notify@example.test>', 'owner@example.test', '123456', '11111111-1111-4111-8111-111111111111');
check(verificationEmail.subject.includes('verification') && verificationEmail.html.includes('123456'), 'email verification template contains only the generated challenge');
assert.throws(() => buildVerificationEmail('x', 'bad-address', '123456', 'id')); checks += 1;
const operationalEmail = buildOperationalEmail('Workspc <notify@example.test>', 'owner@example.test', 'SUPPORT_REPLIES', '11111111-1111-4111-8111-111111111111');
check(!operationalEmail.html.includes('patient') && operationalEmail.html.includes('workspace.privydoc.com.ng'), 'operational email is neutral and uses the safe Workspc origin');
const metaRequest = buildWhatsAppTemplateRequest('123456789012345', '+2348000000001', 'workspc_contact_verification_v1', 'en', ['123456'], true);
check(metaRequest.url.startsWith('https://graph.facebook.com/v23.0/') && JSON.stringify(metaRequest.body).includes('workspc_contact_verification'), 'Meta request is a fixed template request');
check(JSON.stringify(metaRequest.body).includes('"sub_type":"url"') && JSON.stringify(metaRequest.body).includes('"index":"0"'), 'Meta authentication template binds its approved copy-code button');
check(!JSON.stringify(buildWhatsAppTemplateRequest('123456789012345', '+2348000000001', 'workspc_operational_notification', 'en', [])).includes('components'), 'zero-variable Meta template omits arbitrary body components');
const redacted = redactGatewayError(new Error('send owner@example.test +2348000000001 code 123456 Bearer abcdef'));
check(!redacted.includes('owner@example.test') && !redacted.includes('+2348000000001') && !redacted.includes('123456') && !redacted.includes('abcdef'), 'gateway log errors redact contact, OTP and authorization values');

const webhookBody = '{"type":"email.delivered"}';
const metaSecret = 'test-only-meta-secret';
const metaSignature = `sha256=${createHmac('sha256', metaSecret).update(webhookBody).digest('hex')}`;
check(await verifyHmacSha256Signature(metaSecret, webhookBody, metaSignature), 'valid Meta webhook HMAC is accepted');
check(!await verifyHmacSha256Signature(metaSecret, `${webhookBody}forged`, metaSignature), 'forged Meta webhook body is rejected');
const svixKey = Buffer.from('test-only-svix-key').toString('base64');
const svixId = 'msg_test';
const svixTimestamp = '1700000000';
const svixSignature = createHmac('sha256', Buffer.from(svixKey, 'base64'))
  .update(`${svixId}.${svixTimestamp}.${webhookBody}`).digest('base64');
check(await verifySvixWebhookSignature(`whsec_${svixKey}`, svixId, svixTimestamp, webhookBody, `v1,${svixSignature}`, 1700000000), 'valid Resend webhook signature is accepted');
check(!await verifySvixWebhookSignature(`whsec_${svixKey}`, svixId, svixTimestamp, `${webhookBody}forged`, `v1,${svixSignature}`, 1700000000), 'forged Resend webhook body is rejected');

for (const fragment of [
  'requested_by_auth_user_id', 'challenge_digest', 'contact_value_fingerprint',
  'attempt_count integer NOT NULL DEFAULT 0', "expires_at timestamptz",
  "resend_available_at timestamptz", 'consumed_at timestamptz', 'superseded_at timestamptz',
]) check(migration.includes(fragment), `migration persists ${fragment}`);
check(migration.includes("v_recent_count >= 5") && migration.includes("interval '60 seconds'") && migration.includes("interval '10 minutes'"), 'verification issuance enforces hourly rate, cooldown and expiry');
check(migration.includes('FOR UPDATE') && migration.includes('v_next_attempt := v_request.attempt_count + 1'), 'verification attempts are serialized and bounded');
check(migration.includes("verification_state = 'VERIFIED'") && migration.includes("'verification:' || v_request.id::text"), 'verification success records exact durable evidence');
check(migration.includes("status = 'SUPERSEDED'") && migration.includes("CONTACT_CHANGED"), 'contact changes cannot reuse earlier verification evidence');

for (const table of ['communication_provider_events', 'payment_gateway_attempts', 'payment_gateway_events']) {
  check(migration.includes(`CREATE TABLE ${table}`), `migration defines ${table}`);
}
check(migration.includes('communication_provider_event_dedupe UNIQUE (provider, provider_event_id)'), 'delivery webhook events are idempotent');
check(migration.includes('payment_gateway_event_dedupe UNIQUE (provider, provider_event_id)'), 'payment webhook events are idempotent');
check(migration.includes("outcome = 'UNKNOWN'") && migration.includes("failure_classification = 'DISPATCH_OUTCOME_PENDING'"), 'delivery is marked unknown before the provider side effect');
check(migration.includes('v_recent_dispatch_count >= 20'), 'external delivery claims enforce an owner-scoped hourly rate limit');
check(migration.includes("p_outcome NOT IN ('ACCEPTED', 'FAILED', 'UNKNOWN')") && migration.includes('retry_eligible = false'), 'accepted, definitive-failure and unknown delivery outcomes stay distinct and are not auto-retried');
check(migration.includes("provider_adapter IN (") && migration.includes("'META_WHATSAPP', 'RESEND_EMAIL'"), 'migration activates only named provider adapters');

check(migration.includes("purpose text NOT NULL CHECK (purpose = 'WORKFORCE_PRO_UNLIMITED')"), 'payment purpose is the existing workforce Pro plan only');
check(migration.includes('amount_minor bigint NOT NULL CHECK (amount_minor = 1200000)') && migration.includes("currency text NOT NULL CHECK (currency = 'NGN')"), 'payment amount and currency are database constrained');
check(migration.includes("p_provider_reference <> v_attempt.provider_reference") && migration.includes('p_amount_minor <> v_attempt.amount_minor') && migration.includes('p_currency <> v_attempt.currency'), 'verified reference, amount and currency must all match');
check(migration.includes("lower(p_provider_status) <> 'successful'") && migration.includes("status = 'VERIFIED_SUCCESS'"), 'only a server-verified successful provider state activates entitlement');
check(migration.includes("v_attempt.status = 'VERIFIED_SUCCESS'") && migration.includes("'VERIFICATION_REJECTED_EXISTING_UNCHANGED'"), 'semantic duplicate payment successes cannot reapply or extend entitlement');
check(migration.includes("p_status IN ('REFUNDED', 'DISPUTED')") && migration.includes("status = 'cancelled'"), 'refund and dispute states revoke rather than silently preserve entitlement');
check(!migration.includes('platform_operator') && !migration.includes('platform_operators'), 'payment can grant no platform-owner authority');
check(!migration.includes('case_continuity_actions') && !migration.includes('storage.objects'), 'migration 85 has no migration-82/83 dependency');
check(migration.includes("REVOKE ALL ON TABLE %I FROM anon") && migration.includes("REVOKE ALL ON TABLE %I FROM authenticated"), 'new durable tables deny browser access');
check(migration.includes("REPLAY CONTRACT: migration 85 is intentionally non-idempotent"), 'migration replay behavior is explicit');

check(gateway.indexOf('authenticatedUser(req)') < gateway.indexOf("case 'verification.request'"), 'browser gateway operations authenticate through the server entrypoints');
check(gateway.includes('auth.getUser(token)') && gateway.includes("workspc_gateway_resolve_actor"), 'JWT and owner resolution are server-side');
check(gateway.includes("body: { operation: 'payment.initiate' }") || client.includes("body: { operation: 'payment.initiate' }"), 'browser payment request contains only an allow-listed operation');
check(!/body:\s*\{[^}]*amount[^}]*\}/s.test(client) && !/body:\s*\{[^}]*tenant_id[^}]*\}/s.test(client.slice(client.indexOf('initiatePaymentCheckout'), client.indexOf('initiateTenantPlanCheckout'))), 'browser does not supply trusted payment amount or tenant');
check(gateway.includes("amount: '12000.00'") && gateway.includes("currency: 'NGN'") && gateway.includes('customer: { email: user.email }'), 'gateway constructs Flutterwave amount, currency and payer');
check(gateway.includes('/transactions/${transactionId}/verify') && gateway.includes('workspc_gateway_apply_verified_payment'), 'Flutterwave success requires server-to-server verification before entitlement');
check(gateway.includes("String(verifiedData.id ?? '')") && gateway.includes('verifiedTransactionId === transactionId'), 'payment verification matches the webhook and provider-returned transaction ids');
check(gateway.includes("verified.status === 'success'") && gateway.includes('verificationResponse.ok'), 'payment verification requires a successful provider verification response');
check(gateway.includes("req.headers.get('verif-hash')") && gateway.includes("req.headers.get('x-hub-signature-256')") && gateway.includes("req.headers.get('svix-signature')"), 'all provider webhooks have an explicit signature mechanism');
check(gateway.includes("RESEND_ENABLED = Deno.env.get('WORKSPC_RESEND_ENABLED') === 'true'") && gateway.includes("META_ENABLED = Deno.env.get('WORKSPC_META_ENABLED') === 'true'") && gateway.includes("FLUTTERWAVE_ENABLED = Deno.env.get('WORKSPC_FLUTTERWAVE_ENABLED') === 'true'"), 'providers default fail-closed behind independent flags');
check(gateway.includes("outcome: 'UNKNOWN'") && gateway.includes("failureClassification: 'PROVIDER_OUTCOME_UNKNOWN'"), 'ambiguous provider failures remain UNKNOWN');
check(!/console\.(log|error|warn)\([^\n]*(RESEND_API_KEY|META_ACCESS_TOKEN|FLUTTERWAVE_SECRET_KEY|OTP_PEPPER)/.test(gateway), 'gateway never logs provider or hashing secrets');
check(!/VITE_.*(RESEND|META|WHATSAPP|FLUTTERWAVE|SERVICE_ROLE|OTP)/.test(gateway + core + client + communicationClient), 'no provider/service-role secret enters the browser VITE namespace');
check(communicationClient.includes("safe_message_reference: safeMessageReference") && !communicationClient.includes('recipient:'), 'browser dispatches durable references, never arbitrary recipients');

check(paymentCheckout.indexOf('financial_feature_temporarily_unavailable') < paymentCheckout.indexOf("Deno.env.get('FLUTTERWAVE_SECRET_KEY')"), 'legacy checkout remains contained before provider access');
check(paymentWebhook.indexOf('payment_webhook_moved_to_secure_gateway') < paymentWebhook.indexOf("Deno.env.get('FLUTTERWAVE_WEBHOOK_HASH')"), 'legacy payment webhook remains contained before mutation or provider access');

const migrationNumbers = readdirSync(resolve(root, 'supabase/migrations'))
  .filter(name => /^\d+_/.test(name)).map(name => Number(name.split('_')[0]));
check(Math.max(...migrationNumbers) === 85, 'local migration ceiling is exactly 85');

console.log(`secure delivery gateway v1 verifier passed (${checks} checks)`);
