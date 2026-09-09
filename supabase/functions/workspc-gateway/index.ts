// Workspc's single server-side delivery, contact-verification and Flutterwave
// gateway. Deploy with --no-verify-jwt because provider webhooks share this
// surface; every browser operation validates its bearer token with Auth here.
// Provider flags default to false, and no provider secret is ever logged.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  buildOperationalEmail,
  buildAccountLinkInvitationEmail,
  buildVerificationEmail,
  buildWhatsAppTemplateRequest,
  classifyProviderFailure,
  hmacSha256Hex,
  isAllowedPurpose,
  isAllowedTemplateKey,
  isUuid,
  isValidRecipient,
  makeNumericOtp,
  redactGatewayError,
  timingSafeEqual,
  verifyHmacSha256Signature,
  verifySvixWebhookSignature,
  type ExternalChannel,
  type WorkspcNotificationPurpose,
} from '../_shared/workspcGatewayCore.ts';

type Json = Record<string, unknown>;
type SupabaseClient = ReturnType<typeof createClient>;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GATEWAY_ENABLED = Deno.env.get('WORKSPC_GATEWAY_ENABLED') === 'true';
const RESEND_ENABLED = Deno.env.get('WORKSPC_RESEND_ENABLED') === 'true';
const META_ENABLED = Deno.env.get('WORKSPC_META_ENABLED') === 'true';
const FLUTTERWAVE_ENABLED = Deno.env.get('WORKSPC_FLUTTERWAVE_ENABLED') === 'true';
const OTP_PEPPER = Deno.env.get('WORKSPC_OTP_PEPPER') ?? '';
const RESEND_API_KEY = Deno.env.get('WORKSPC_RESEND_API_KEY') ?? '';
const RESEND_FROM = Deno.env.get('WORKSPC_RESEND_FROM') ?? '';
const RESEND_WEBHOOK_SECRET = Deno.env.get('WORKSPC_RESEND_WEBHOOK_SECRET') ?? '';
const META_ACCESS_TOKEN = Deno.env.get('WORKSPC_META_ACCESS_TOKEN') ?? '';
const META_PHONE_NUMBER_ID = Deno.env.get('WORKSPC_META_PHONE_NUMBER_ID') ?? '';
const META_APP_SECRET = Deno.env.get('WORKSPC_META_APP_SECRET') ?? '';
const META_WEBHOOK_VERIFY_TOKEN = Deno.env.get('WORKSPC_META_WEBHOOK_VERIFY_TOKEN') ?? '';
const META_VERIFICATION_TEMPLATE = Deno.env.get('WORKSPC_META_VERIFICATION_TEMPLATE') ?? 'workspc_contact_verification_v1';
const META_OPERATIONAL_TEMPLATE = Deno.env.get('WORKSPC_META_OPERATIONAL_TEMPLATE') ?? 'workspc_operational_notification';
const META_TEMPLATE_LANGUAGE = Deno.env.get('WORKSPC_META_TEMPLATE_LANGUAGE') ?? 'en';
const FLUTTERWAVE_SECRET_KEY = Deno.env.get('FLUTTERWAVE_SECRET_KEY') ?? '';
const FLUTTERWAVE_WEBHOOK_HASH = Deno.env.get('FLUTTERWAVE_WEBHOOK_HASH') ?? '';
const WORKSPC_ORIGIN = 'https://workspace.privydoc.com.ng';

const ALLOWED_ORIGINS = new Set([
  WORKSPC_ORIGIN,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.endsWith('---privydoc-doc-workspace-cqd32rsz5a-nw.a.run.app');
  } catch {
    return false;
  }
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  return {
    'Access-Control-Allow-Origin': origin && isAllowedOrigin(origin) ? origin : WORKSPC_ORIGIN,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function serviceClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Gateway database runtime is unavailable');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function authenticatedUser(req: Request): Promise<{ id: string; email: string | null }> {
  const authorization = req.headers.get('authorization') ?? '';
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) throw new GatewayHttpError(401, 'authentication_required');
  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) throw new GatewayHttpError(401, 'authentication_required');
  return { id: data.user.id, email: data.user.email?.trim().toLowerCase() ?? null };
}

class GatewayHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function membershipId(body: Json): string | null {
  if (body.membership_id === undefined || body.membership_id === null || body.membership_id === '') return null;
  if (!isUuid(body.membership_id)) throw new GatewayHttpError(400, 'invalid_membership');
  return body.membership_id;
}

function channel(body: Json): ExternalChannel {
  if (body.channel !== 'EMAIL' && body.channel !== 'WHATSAPP') throw new GatewayHttpError(400, 'invalid_channel');
  return body.channel;
}

async function rpc<T>(admin: SupabaseClient, name: string, params: Json): Promise<T> {
  const { data, error } = await admin.rpc(name, params);
  if (error) {
    const message = String(error.message ?? '');
    if (/cooldown|rate limit|already open|already has an active/i.test(message)) throw new GatewayHttpError(429, 'rate_limited');
    if (/not authorized|requires an active|no active|authentication|administrator required/i.test(message)) throw new GatewayHttpError(403, 'owner_not_authorized');
    if (/invalid invitation|no longer available|expired|ownership proof/i.test(message)) throw new GatewayHttpError(409, 'invitation_not_available');
    throw new Error(`Database contract failed: ${message}`);
  }
  return data as T;
}

async function resolveActor(admin: SupabaseClient, userId: string, selectedMembershipId: string | null): Promise<Json> {
  return rpc<Json>(admin, 'workspc_gateway_resolve_actor', {
    p_auth_user_id: userId,
    p_membership_id: selectedMembershipId,
  });
}

async function currentContact(
  admin: SupabaseClient,
  actor: Json,
  selectedChannel: ExternalChannel,
): Promise<{ id: string; value_canonical: string } | null> {
  const column = actor.kind === 'WORKFORCE' ? 'owner_workforce_id' : 'owner_doctor_id';
  const { data, error } = await admin
    .from('communication_contact_points')
    .select('id, value_canonical')
    .eq(column, String(actor.id ?? ''))
    .eq('channel', selectedChannel)
    .maybeSingle();
  if (error) throw new Error(`Contact lookup failed: ${error.message}`);
  return data as { id: string; value_canonical: string } | null;
}

async function contactFingerprint(selectedChannel: ExternalChannel, value: string): Promise<string> {
  return hmacSha256Hex(OTP_PEPPER, `workspc-contact-v1|${selectedChannel}|${value}`);
}

interface SendResult {
  outcome: 'ACCEPTED' | 'FAILED' | 'UNKNOWN';
  providerMessageId: string | null;
  failureClassification: string | null;
}

async function sendResend(input: Json, idempotencyKey: string): Promise<SendResult> {
  if (!RESEND_ENABLED || !RESEND_API_KEY || !RESEND_FROM) {
    return { outcome: 'FAILED', providerMessageId: null, failureClassification: 'PROVIDER_DISABLED' };
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({})) as Json;
    if (!response.ok) {
      const failure = classifyProviderFailure(response.status);
      return {
        outcome: failure === 'REJECTED' ? 'FAILED' : 'UNKNOWN',
        providerMessageId: null,
        failureClassification: failure === 'REJECTED' ? 'PROVIDER_REJECTED' : 'PROVIDER_OUTCOME_UNKNOWN',
      };
    }
    const providerMessageId = typeof result.id === 'string' ? result.id : null;
    return providerMessageId
      ? { outcome: 'ACCEPTED', providerMessageId, failureClassification: null }
      : { outcome: 'UNKNOWN', providerMessageId: null, failureClassification: 'PROVIDER_OUTCOME_UNKNOWN' };
  } catch {
    return { outcome: 'UNKNOWN', providerMessageId: null, failureClassification: 'PROVIDER_OUTCOME_UNKNOWN' };
  }
}

async function sendMeta(
  to: string,
  templateName: string,
  variables: readonly string[],
  copyCodeButton = false,
): Promise<SendResult> {
  if (!META_ENABLED || !META_ACCESS_TOKEN || !META_PHONE_NUMBER_ID) {
    return { outcome: 'FAILED', providerMessageId: null, failureClassification: 'PROVIDER_DISABLED' };
  }
  try {
    const request = buildWhatsAppTemplateRequest(
      META_PHONE_NUMBER_ID,
      to,
      templateName,
      META_TEMPLATE_LANGUAGE,
      variables,
      copyCodeButton,
    );
    const response = await fetch(request.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request.body),
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json().catch(() => ({})) as { messages?: Array<{ id?: string }> };
    if (!response.ok) {
      const failure = classifyProviderFailure(response.status);
      return {
        outcome: failure === 'REJECTED' ? 'FAILED' : 'UNKNOWN',
        providerMessageId: null,
        failureClassification: failure === 'REJECTED' ? 'PROVIDER_REJECTED' : 'PROVIDER_OUTCOME_UNKNOWN',
      };
    }
    const providerMessageId = result.messages?.[0]?.id ?? null;
    return providerMessageId
      ? { outcome: 'ACCEPTED', providerMessageId, failureClassification: null }
      : { outcome: 'UNKNOWN', providerMessageId: null, failureClassification: 'PROVIDER_OUTCOME_UNKNOWN' };
  } catch {
    return { outcome: 'UNKNOWN', providerMessageId: null, failureClassification: 'PROVIDER_OUTCOME_UNKNOWN' };
  }
}

async function requestVerification(req: Request, body: Json, admin: SupabaseClient): Promise<Response> {
  if (!GATEWAY_ENABLED || !OTP_PEPPER) throw new GatewayHttpError(503, 'gateway_not_configured');
  const user = await authenticatedUser(req);
  const selectedMembershipId = membershipId(body);
  const selectedChannel = channel(body);
  if ((selectedChannel === 'EMAIL' && !RESEND_ENABLED) || (selectedChannel === 'WHATSAPP' && !META_ENABLED)) {
    throw new GatewayHttpError(503, 'provider_disabled');
  }
  const actor = await resolveActor(admin, user.id, selectedMembershipId);
  const contact = await currentContact(admin, actor, selectedChannel);
  if (!contact || !isValidRecipient(selectedChannel, contact.value_canonical)) throw new GatewayHttpError(400, 'contact_not_available');

  const randomBytes = crypto.getRandomValues(new Uint8Array(4));
  const code = makeNumericOtp(randomBytes);
  const digest = await hmacSha256Hex(OTP_PEPPER, `workspc-otp-v1|${code}`);
  const fingerprint = await contactFingerprint(selectedChannel, contact.value_canonical);
  const challenge = await rpc<Json>(admin, 'workspc_gateway_begin_verification', {
    p_auth_user_id: user.id,
    p_membership_id: selectedMembershipId,
    p_channel: selectedChannel,
    p_challenge_digest: digest,
    p_contact_value_fingerprint: fingerprint,
  });
  const returnedValue = String(challenge.value_canonical ?? '');
  const returnedFingerprint = await contactFingerprint(selectedChannel, returnedValue);
  let result: SendResult;
  if (!timingSafeEqual(fingerprint, returnedFingerprint)) {
    result = { outcome: 'FAILED', providerMessageId: null, failureClassification: 'CONTACT_CHANGED_BEFORE_SEND' };
  } else if (selectedChannel === 'EMAIL') {
    result = await sendResend(
      buildVerificationEmail(RESEND_FROM, returnedValue, code, String(challenge.request_id)),
      `workspc-verification-${challenge.request_id}`,
    );
  } else {
    result = await sendMeta(returnedValue, META_VERIFICATION_TEMPLATE, [code], true);
  }
  const verificationOutcome = result.outcome === 'ACCEPTED'
    ? 'CHALLENGE_SENT'
    : result.outcome === 'FAILED' ? 'FAILED' : 'DELIVERY_UNKNOWN';
  await rpc(admin, 'workspc_gateway_finish_verification_dispatch', {
    p_request_id: challenge.request_id,
    p_outcome: verificationOutcome,
    p_provider_message_id: result.providerMessageId,
    p_failure_classification: result.failureClassification,
  });
  if (result.outcome !== 'ACCEPTED') throw new GatewayHttpError(result.outcome === 'FAILED' ? 502 : 504, 'verification_delivery_unavailable');
  return json(req, { state: 'CHALLENGE_SENT', expires_at: challenge.expires_at });
}

async function completeVerification(req: Request, body: Json, admin: SupabaseClient): Promise<Response> {
  if (!GATEWAY_ENABLED || !OTP_PEPPER) throw new GatewayHttpError(503, 'gateway_not_configured');
  const user = await authenticatedUser(req);
  const selectedMembershipId = membershipId(body);
  const selectedChannel = channel(body);
  if (typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) throw new GatewayHttpError(400, 'invalid_code');
  const actor = await resolveActor(admin, user.id, selectedMembershipId);
  const contact = await currentContact(admin, actor, selectedChannel);
  if (!contact) throw new GatewayHttpError(404, 'contact_not_available');
  const digest = await hmacSha256Hex(OTP_PEPPER, `workspc-otp-v1|${body.code}`);
  const fingerprint = await contactFingerprint(selectedChannel, contact.value_canonical);
  const result = await rpc<Json>(admin, 'workspc_gateway_complete_verification', {
    p_auth_user_id: user.id,
    p_membership_id: selectedMembershipId,
    p_channel: selectedChannel,
    p_submitted_digest: digest,
    p_contact_value_fingerprint: fingerprint,
  });
  const state = String(result.state ?? 'UNKNOWN');
  const status = state === 'VERIFIED' ? 200 : state === 'CODE_MISMATCH' ? 400 : state === 'ATTEMPTS_EXCEEDED' ? 429 : 409;
  return json(req, { state, attempts_remaining: result.attempts_remaining }, status);
}

function accountLinkToken(body: Json): string {
  if (typeof body.token !== 'string' || !/^[A-Za-z0-9_-]{40,100}$/.test(body.token)) {
    throw new GatewayHttpError(400, 'invalid_invitation');
  }
  return body.token;
}

async function accountLinkTokenDigest(token: string): Promise<string> {
  if (!OTP_PEPPER) throw new GatewayHttpError(503, 'gateway_not_configured');
  return hmacSha256Hex(OTP_PEPPER, `workspc-account-link-invitation-v1|${token}`);
}

function newAccountLinkToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

async function accountLinkAdminOverview(req: Request, body: Json, admin: SupabaseClient): Promise<Response> {
  const user = await authenticatedUser(req);
  const overview = await rpc<Json>(admin, 'workspc_account_link_admin_overview', {
    p_auth_user_id: user.id,
    p_membership_id: membershipId(body),
  });
  return json(req, overview);
}

async function createAccountLinkInvitation(req: Request, body: Json, admin: SupabaseClient): Promise<Response> {
  if (!GATEWAY_ENABLED || !RESEND_ENABLED || !OTP_PEPPER) throw new GatewayHttpError(503, 'provider_disabled');
  const user = await authenticatedUser(req);
  if (!isUuid(body.workforce_id)) throw new GatewayHttpError(400, 'invalid_workforce');
  const token = newAccountLinkToken();
  const digest = await accountLinkTokenDigest(token);
  const prepared = await rpc<Json>(admin, 'workspc_account_link_prepare_invitation', {
    p_auth_user_id: user.id,
    p_membership_id: membershipId(body),
    p_workforce_id: body.workforce_id,
    p_token_digest: digest,
  });
  if (prepared.state === 'CONTACT_CONFIRMATION_REQUIRED') {
    return json(req, { state: prepared.state }, 409);
  }
  const invitationId = String(prepared.invitation_id ?? '');
  const recipient = String(prepared.recipient ?? '').trim().toLowerCase();
  if (!isUuid(invitationId) || !isValidRecipient('EMAIL', recipient)) {
    throw new Error('Invitation preparation returned an invalid durable record');
  }
  await rpc(admin, 'workspc_account_link_begin_invitation_delivery', { p_invitation_id: invitationId });
  const delivery = await sendResend(
    buildAccountLinkInvitationEmail(RESEND_FROM, recipient, token, invitationId),
    `workspc-account-link-${invitationId}`,
  );
  const finished = await rpc<Json>(admin, 'workspc_account_link_finish_invitation_delivery', {
    p_invitation_id: invitationId,
    p_outcome: delivery.outcome,
    p_provider_message_id: delivery.providerMessageId,
    p_failure_classification: delivery.failureClassification,
  });
  if (delivery.outcome !== 'ACCEPTED') {
    throw new GatewayHttpError(delivery.outcome === 'FAILED' ? 502 : 504, 'invitation_delivery_unavailable');
  }
  return json(req, {
    state: finished.state,
    masked_destination: prepared.masked_destination,
    expires_at: finished.expires_at,
  });
}

async function actOnAccountLinkInvitation(
  req: Request,
  body: Json,
  admin: SupabaseClient,
  action: 'accept' | 'reject',
): Promise<Response> {
  const user = await authenticatedUser(req);
  const digest = await accountLinkTokenDigest(accountLinkToken(body));
  const result = await rpc<Json>(admin, `workspc_account_link_${action}_invitation`, {
    p_auth_user_id: user.id,
    p_token_digest: digest,
  });
  return json(req, result);
}

async function revokeAccountLinkInvitation(req: Request, body: Json, admin: SupabaseClient): Promise<Response> {
  const user = await authenticatedUser(req);
  if (!isUuid(body.invitation_id)) throw new GatewayHttpError(400, 'invalid_invitation');
  const result = await rpc<Json>(admin, 'workspc_account_link_revoke_invitation', {
    p_auth_user_id: user.id,
    p_membership_id: membershipId(body),
    p_invitation_id: body.invitation_id,
  });
  return json(req, result);
}

async function deliverClaimed(admin: SupabaseClient, rows: Json[]): Promise<{ accepted: number; failed: number; unknown: number }> {
  const totals = { accepted: 0, failed: 0, unknown: 0 };
  for (const row of rows) {
    const deliveryId = String(row.delivery_id ?? '');
    const selectedChannel = row.channel as ExternalChannel;
    const recipient = String(row.value_canonical ?? '');
    const purpose = row.purpose as WorkspcNotificationPurpose;
    const templateKey = row.template_key;
    let result: SendResult;
    if (!isUuid(deliveryId) || !isValidRecipient(selectedChannel, recipient)
      || !isAllowedPurpose(purpose) || !isAllowedTemplateKey(templateKey)) {
      result = { outcome: 'FAILED', providerMessageId: null, failureClassification: 'INVALID_DURABLE_DELIVERY' };
    } else if (selectedChannel === 'EMAIL') {
      result = await sendResend(
        buildOperationalEmail(RESEND_FROM, recipient, purpose, deliveryId),
        `workspc-delivery-${deliveryId}`,
      );
    } else {
      result = await sendMeta(recipient, META_OPERATIONAL_TEMPLATE, []);
    }
    await rpc(admin, 'workspc_gateway_finish_delivery', {
      p_delivery_id: deliveryId,
      p_outcome: result.outcome,
      p_provider_message_id: result.providerMessageId,
      p_failure_classification: result.failureClassification,
    });
    if (result.outcome === 'ACCEPTED') totals.accepted += 1;
    else if (result.outcome === 'FAILED') totals.failed += 1;
    else totals.unknown += 1;
  }
  return totals;
}

async function dispatch(req: Request, body: Json, admin: SupabaseClient, selfTest: boolean): Promise<Response> {
  if (!GATEWAY_ENABLED) throw new GatewayHttpError(503, 'gateway_not_configured');
  const user = await authenticatedUser(req);
  const selectedMembershipId = membershipId(body);
  let safeReference: string;
  if (selfTest) {
    safeReference = await rpc<string>(admin, 'workspc_gateway_begin_self_test', {
      p_auth_user_id: user.id,
      p_membership_id: selectedMembershipId,
      p_event_id: crypto.randomUUID(),
    });
  } else {
    if (typeof body.safe_message_reference !== 'string' || !/^(conversation|review_invitation):[0-9a-f-]{36}$/.test(body.safe_message_reference)) {
      throw new GatewayHttpError(400, 'invalid_delivery_reference');
    }
    safeReference = body.safe_message_reference;
  }
  const rows = await rpc<Json[]>(admin, 'workspc_gateway_claim_deliveries', {
    p_auth_user_id: user.id,
    p_membership_id: selectedMembershipId,
    p_safe_message_reference: safeReference,
  });
  const totals = await deliverClaimed(admin, rows ?? []);
  return json(req, { state: 'DISPATCH_COMPLETE', ...totals });
}

async function initiatePayment(req: Request, body: Json, admin: SupabaseClient): Promise<Response> {
  if (!GATEWAY_ENABLED || !FLUTTERWAVE_ENABLED || !FLUTTERWAVE_SECRET_KEY) {
    throw new GatewayHttpError(503, 'payment_provider_disabled');
  }
  const user = await authenticatedUser(req);
  if (!user.email || !isValidRecipient('EMAIL', user.email)) throw new GatewayHttpError(409, 'authenticated_email_required');
  const selectedMembershipId = membershipId(body);
  const providerReference = `workspc-fw-${crypto.randomUUID()}`;
  const attempt = await rpc<Json>(admin, 'workspc_gateway_create_payment_attempt', {
    p_auth_user_id: user.id,
    p_membership_id: selectedMembershipId,
    p_provider_reference: providerReference,
  });
  const attemptId = String(attempt.attempt_id);
  let response: Response;
  try {
    response = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_ref: providerReference,
        amount: '12000.00',
        currency: 'NGN',
        redirect_url: `${WORKSPC_ORIGIN}/#/workspace/communication?payment=return`,
        customer: { email: user.email },
        meta: { gateway_attempt_id: attemptId, purpose: 'WORKFORCE_PRO_UNLIMITED' },
        customizations: {
          title: 'PrivyDoc Workspace',
          description: 'Monthly Workspc Pro/Unlimited subscription',
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    await rpc(admin, 'workspc_gateway_finish_payment_checkout', {
      p_attempt_id: attemptId, p_status: 'UNKNOWN', p_failure_classification: 'PROVIDER_OUTCOME_UNKNOWN',
    });
    throw new GatewayHttpError(504, 'payment_checkout_unknown');
  }
  const providerBody = await response.json().catch(() => ({})) as { status?: string; data?: { link?: string } };
  if (!response.ok || providerBody.status !== 'success' || typeof providerBody.data?.link !== 'string') {
    const failure = classifyProviderFailure(response.status);
    await rpc(admin, 'workspc_gateway_finish_payment_checkout', {
      p_attempt_id: attemptId,
      p_status: failure === 'REJECTED' ? 'FAILED' : 'UNKNOWN',
      p_failure_classification: failure === 'REJECTED' ? 'PROVIDER_REJECTED' : 'PROVIDER_OUTCOME_UNKNOWN',
    });
    throw new GatewayHttpError(failure === 'REJECTED' ? 502 : 504, 'payment_checkout_unavailable');
  }
  await rpc(admin, 'workspc_gateway_finish_payment_checkout', {
    p_attempt_id: attemptId, p_status: 'CHECKOUT_CREATED', p_failure_classification: null,
  });
  return json(req, {
    provider: 'flutterwave',
    checkout_url: providerBody.data.link,
    reference: providerReference,
    merchant: 'PrivyDoc Workspace',
    purpose: 'Monthly Workspc Pro/Unlimited subscription',
    amount: 12000,
    currency: 'NGN',
  });
}

async function verifyResendWebhook(req: Request, rawBody: string): Promise<boolean> {
  const id = req.headers.get('svix-id') ?? '';
  const timestamp = req.headers.get('svix-timestamp') ?? '';
  const signatures = req.headers.get('svix-signature') ?? '';
  return verifySvixWebhookSignature(RESEND_WEBHOOK_SECRET, id, timestamp, rawBody, signatures);
}

async function verifyMetaWebhook(req: Request, rawBody: string): Promise<boolean> {
  const supplied = req.headers.get('x-hub-signature-256') ?? '';
  return verifyHmacSha256Signature(META_APP_SECRET, rawBody, supplied);
}

async function providerWebhook(req: Request, provider: string, rawBody: string, admin: SupabaseClient): Promise<Response> {
  if (provider === 'resend') {
    if (!await verifyResendWebhook(req, rawBody)) return json(req, { error: 'invalid_signature' }, 401);
    let event: Json;
    try { event = JSON.parse(rawBody) as Json; } catch { return json(req, { error: 'invalid_json' }, 400); }
    const data = (event.data ?? {}) as Json;
    const eventId = req.headers.get('svix-id') ?? '';
    const eventType = String(event.type ?? 'unknown');
    const messageId = String(data.email_id ?? '');
    const occurred = typeof event.created_at === 'string' ? event.created_at : null;
    await rpc(admin, 'workspc_gateway_record_provider_event', {
      p_provider: 'RESEND_EMAIL', p_provider_event_id: eventId, p_event_type: eventType,
      p_provider_message_id: messageId, p_delivered: eventType === 'email.delivered',
      p_provider_occurred_at: occurred,
    });
    return json(req, { ok: true });
  }
  if (provider === 'meta') {
    if (!await verifyMetaWebhook(req, rawBody)) return json(req, { error: 'invalid_signature' }, 401);
    let event: { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<Json> } }> }> };
    try { event = JSON.parse(rawBody); } catch { return json(req, { error: 'invalid_json' }, 400); }
    for (const entry of event.entry ?? []) for (const change of entry.changes ?? []) for (const status of change.value?.statuses ?? []) {
      const messageId = String(status.id ?? '');
      const state = String(status.status ?? 'unknown');
      const timestamp = String(status.timestamp ?? '');
      if (!messageId) continue;
      await rpc(admin, 'workspc_gateway_record_provider_event', {
        p_provider: 'META_WHATSAPP',
        p_provider_event_id: `${messageId}:${state}:${timestamp}`,
        p_event_type: state,
        p_provider_message_id: messageId,
        p_delivered: state === 'delivered' || state === 'read',
        p_provider_occurred_at: /^\d+$/.test(timestamp) ? new Date(Number(timestamp) * 1000).toISOString() : null,
      });
    }
    return json(req, { ok: true });
  }
  if (provider === 'flutterwave') return flutterwaveWebhook(req, rawBody, admin);
  return json(req, { error: 'unsupported_provider' }, 404);
}

async function flutterwaveWebhook(req: Request, rawBody: string, admin: SupabaseClient): Promise<Response> {
  const suppliedHash = req.headers.get('verif-hash') ?? '';
  if (!FLUTTERWAVE_WEBHOOK_HASH || !timingSafeEqual(suppliedHash, FLUTTERWAVE_WEBHOOK_HASH)) {
    return json(req, { error: 'invalid_signature' }, 401);
  }
  let event: Json;
  try { event = JSON.parse(rawBody) as Json; } catch { return json(req, { error: 'invalid_json' }, 400); }
  const data = (event.data ?? {}) as Json;
  const reference = typeof data.tx_ref === 'string' ? data.tx_ref : '';
  const transactionId = data.id === undefined ? '' : String(data.id);
  const eventType = String(event.event ?? 'unknown');
  const eventId = await hmacSha256Hex(FLUTTERWAVE_WEBHOOK_HASH, `workspc-fw-event-v1|${rawBody}`);
  if (!reference.startsWith('workspc-fw-')) return json(req, { ok: true, ignored: true });
  const { data: attempt, error } = await admin
    .from('payment_gateway_attempts')
    .select('id, provider_reference')
    .eq('provider_reference', reference)
    .maybeSingle();
  if (error) throw new Error(`Payment attempt lookup failed: ${error.message}`);
  if (!attempt) {
    await rpc(admin, 'workspc_gateway_record_payment_state', {
      p_provider_event_id: eventId, p_event_type: eventType, p_provider_reference: reference,
      p_provider_transaction_id: transactionId || null, p_status: 'UNKNOWN',
    });
    return json(req, { ok: true, state: 'ATTEMPT_NOT_FOUND' });
  }
  const incomingStatus = String(data.status ?? '').toLowerCase();
  const successEvent = eventType === 'charge.completed' && incomingStatus === 'successful' && /^\d+$/.test(transactionId);
  if (successEvent) {
    if (!FLUTTERWAVE_SECRET_KEY) return json(req, { error: 'verification_provider_disabled' }, 503);
    let verificationResponse: Response;
    try {
      verificationResponse = await fetch(`https://api.flutterwave.com/v3/transactions/${transactionId}/verify`, {
        headers: { Authorization: `Bearer ${FLUTTERWAVE_SECRET_KEY}` }, signal: AbortSignal.timeout(15_000),
      });
    } catch {
      await rpc(admin, 'workspc_gateway_record_payment_state', {
        p_provider_event_id: eventId, p_event_type: eventType, p_provider_reference: reference,
        p_provider_transaction_id: transactionId, p_status: 'UNKNOWN',
      });
      return json(req, { ok: true, state: 'VERIFICATION_UNKNOWN' });
    }
    const verified = await verificationResponse.json().catch(() => ({})) as { status?: string; data?: Json };
    const verifiedData = verified.data ?? {};
    const verifiedReference = String(verifiedData.tx_ref ?? '');
    const verifiedTransactionId = String(verifiedData.id ?? '');
    const verifiedCurrency = String(verifiedData.currency ?? '').toUpperCase();
    const providerStatus = String(verifiedData.status ?? 'unknown');
    const verifiedStatus = verificationResponse.ok
      && verified.status === 'success'
      && verifiedTransactionId === transactionId
      ? providerStatus
      : 'transaction_id_mismatch_or_verification_failed';
    const amount = Number(verifiedData.amount);
    const amountMinor = Number.isFinite(amount) ? Math.round(amount * 100) : -1;
    const state = await rpc<Json>(admin, 'workspc_gateway_apply_verified_payment', {
      p_attempt_id: attempt.id, p_provider_event_id: eventId, p_event_type: eventType,
      p_provider_transaction_id: verifiedTransactionId, p_provider_reference: verifiedReference,
      p_amount_minor: amountMinor, p_currency: verifiedCurrency, p_provider_status: verifiedStatus,
    });
    return json(req, { ok: true, state: state.state });
  }
  const mappedStatus = /refund/i.test(eventType) ? 'REFUNDED'
    : /chargeback|dispute/i.test(eventType) ? 'DISPUTED'
    : incomingStatus === 'cancelled' ? 'CANCELLED'
    : incomingStatus === 'failed' ? 'FAILED'
    : incomingStatus === 'pending' ? 'PENDING' : 'UNKNOWN';
  const state = await rpc<Json>(admin, 'workspc_gateway_record_payment_state', {
    p_provider_event_id: eventId, p_event_type: eventType, p_provider_reference: reference,
    p_provider_transaction_id: transactionId || null, p_status: mappedStatus,
  });
  return json(req, { ok: true, state: state.state });
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const provider = url.searchParams.get('provider');
  if (req.method === 'GET' && provider === 'meta') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');
    if (mode === 'subscribe' && META_WEBHOOK_VERIFY_TOKEN && token && timingSafeEqual(token, META_WEBHOOK_VERIFY_TOKEN)) {
      return new Response(challenge ?? '', { status: 200, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
    }
    return new Response('Forbidden', { status: 403 });
  }
  if (req.method === 'OPTIONS') {
    if (!isAllowedOrigin(req.headers.get('origin'))) return json(req, { error: 'origin_not_allowed' }, 403);
    return new Response('ok', { headers: corsHeaders(req) });
  }
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  if (!isAllowedOrigin(req.headers.get('origin'))) return json(req, { error: 'origin_not_allowed' }, 403);
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > 64_000) return json(req, { error: 'request_too_large' }, 413);

  try {
    const admin = serviceClient();
    const rawBody = await req.text();
    if (rawBody.length > 64_000) return json(req, { error: 'request_too_large' }, 413);
    if (provider) return await providerWebhook(req, provider, rawBody, admin);
    let body: Json;
    try { body = JSON.parse(rawBody) as Json; } catch { throw new GatewayHttpError(400, 'invalid_json'); }
    switch (body.operation) {
      case 'status':
        return json(req, {
          gateway: GATEWAY_ENABLED ? 'AVAILABLE' : 'DISABLED',
          email: RESEND_ENABLED && RESEND_API_KEY && RESEND_FROM ? 'AVAILABLE' : 'DISABLED',
          whatsapp: META_ENABLED && META_ACCESS_TOKEN && META_PHONE_NUMBER_ID ? 'AVAILABLE' : 'DISABLED',
          flutterwave: FLUTTERWAVE_ENABLED && FLUTTERWAVE_SECRET_KEY && FLUTTERWAVE_WEBHOOK_HASH ? 'AVAILABLE' : 'DISABLED',
        });
      case 'verification.request': return await requestVerification(req, body, admin);
      case 'verification.complete': return await completeVerification(req, body, admin);
      case 'delivery.dispatch': return await dispatch(req, body, admin, false);
      case 'delivery.self_test': return await dispatch(req, body, admin, true);
      case 'account_link.admin.overview': return await accountLinkAdminOverview(req, body, admin);
      case 'account_link.invitation.create': return await createAccountLinkInvitation(req, body, admin);
      case 'account_link.invitation.accept': return await actOnAccountLinkInvitation(req, body, admin, 'accept');
      case 'account_link.invitation.reject': return await actOnAccountLinkInvitation(req, body, admin, 'reject');
      case 'account_link.invitation.revoke': return await revokeAccountLinkInvitation(req, body, admin);
      case 'payment.initiate': return await initiatePayment(req, body, admin);
      default: throw new GatewayHttpError(400, 'operation_not_allowed');
    }
  } catch (error) {
    if (error instanceof GatewayHttpError) return json(req, { error: error.code }, error.status);
    console.error('workspc_gateway_error', redactGatewayError(error));
    return json(req, { error: 'gateway_internal_error' }, 500);
  }
});
