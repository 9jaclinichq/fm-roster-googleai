// Supabase Edge Function: payment webhook receiver for Paystack and
// Flutterwave. Verifies authenticity, logs the event to payment_events
// (whose UNIQUE constraint makes replayed deliveries idempotent no-ops),
// and activates the matching user_subscriptions row (migration 17).
//
// SCOPE (migration 30, 2026-08-14): a row's `scope` column says who the
// subscription is for. 'workforce' (the original, unchanged path) just
// activates the row. 'tenant' ALSO promotes tenants.plan_type from
// 'free_seeded' to 'tier_1' — the self-serve organization upgrade. That
// promotion only fires FROM 'free_seeded': it will never downgrade or
// silently overwrite a tenant an operator has manually placed on a higher
// tier_2/enterprise plan (a custom/negotiated deal outside this flow).
//
// Signature verification:
//   * Paystack sends `x-paystack-signature` = HMAC-SHA512 of the RAW request
//     body keyed with the account's secret key — verified here with
//     WebCrypto, exactly as the task brief specifies.
//   * Flutterwave — SPEC DEVIATION (flagged, not silent): the brief asked
//     for HMAC SHA512 here too, but Flutterwave v3 does NOT sign payloads.
//     It sends a `verif-hash` header that must simply EQUAL the secret hash
//     configured in the Flutterwave dashboard (Settings → Webhooks). We
//     verify by constant-time equality against the FLUTTERWAVE_WEBHOOK_HASH
//     secret; implementing "HMAC" against a scheme the provider doesn't use
//     would just be security theater. Set the secret with:
//       npx supabase@2.112.0 secrets set FLUTTERWAVE_WEBHOOK_HASH=<same value as dashboard> --project-ref <ref>
//
// Register the webhook URL with each provider (dashboard, one-time):
//   https://<project-ref>.supabase.co/functions/v1/payment-webhook
//
// Deploy:  npx supabase@2.112.0 functions deploy payment-webhook --project-ref <ref> --no-verify-jwt --use-api
// (--no-verify-jwt is REQUIRED here: providers call this endpoint directly
// and cannot send a Supabase JWT. Authenticity comes from the signature
// checks above instead.)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

function textResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function hmacSha512Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time string comparison — don't leak signature prefixes via timing.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const SUBSCRIPTION_PERIOD_DAYS = 30;

// Promotes a tenant to the self-serve paid tier — ONLY from 'free_seeded',
// so this never overwrites an operator-assigned tier_2/enterprise plan.
// deno-lint-ignore no-explicit-any
async function promoteTenantIfFreeSeeded(admin: any, tenantId: string): Promise<void> {
  const { error } = await admin
    .from('tenants')
    .update({ plan_type: 'tier_1' })
    .eq('id', tenantId)
    .eq('plan_type', 'free_seeded');
  if (error) {
    console.error('Failed to promote tenant plan_type after payment:', error);
    // Non-fatal: the subscription row itself is still activated below, and
    // is the source of truth an operator can reconcile from if this fails.
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return textResponse({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return textResponse({ error: 'Runtime env unavailable' }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey);

  // Raw body FIRST — Paystack's HMAC is over the exact bytes sent.
  const rawBody = await req.text();

  const paystackSignature = req.headers.get('x-paystack-signature');
  const flutterwaveHash = req.headers.get('verif-hash');

  let provider: 'paystack' | 'flutterwave';
  if (paystackSignature) {
    const key = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!key) return textResponse({ error: 'PAYSTACK_SECRET_KEY not configured' }, 503);
    const expected = await hmacSha512Hex(key, rawBody);
    if (!timingSafeEqual(expected, paystackSignature)) {
      return textResponse({ error: 'Invalid Paystack signature' }, 401);
    }
    provider = 'paystack';
  } else if (flutterwaveHash) {
    const expected = Deno.env.get('FLUTTERWAVE_WEBHOOK_HASH');
    if (!expected) return textResponse({ error: 'FLUTTERWAVE_WEBHOOK_HASH not configured' }, 503);
    if (!timingSafeEqual(expected, flutterwaveHash)) {
      return textResponse({ error: 'Invalid Flutterwave verif-hash' }, 401);
    }
    provider = 'flutterwave';
  } else {
    return textResponse({ error: 'Missing signature header' }, 401);
  }

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return textResponse({ error: 'Invalid JSON payload' }, 400);
  }

  // Normalize the two providers' shapes to one activation decision.
  const eventType = String(event.event ?? event['event.type'] ?? 'unknown');
  // deno-lint-ignore no-explicit-any
  const data: any = event.data ?? {};
  let reference: string | null = null;
  let shouldActivate = false;

  if (provider === 'paystack') {
    reference = data.reference ?? null;
    shouldActivate = eventType === 'charge.success' && data.status === 'success';
  } else {
    reference = data.tx_ref ?? null;
    shouldActivate = eventType === 'charge.completed' && data.status === 'successful';
  }

  if (!reference) return textResponse({ ok: true, note: 'No reference in payload; ignored' });

  // Idempotency: the UNIQUE (provider, event_type, reference) constraint
  // turns webhook replays into conflict no-ops.
  const { error: eventError } = await admin.from('payment_events').insert([{
    provider,
    event_type: eventType,
    reference,
    signature_valid: true,
    payload: event,
  }]);
  if (eventError) {
    if (eventError.code === '23505') {
      return textResponse({ ok: true, note: 'Duplicate delivery; already processed' });
    }
    console.error('Failed to record payment event:', eventError);
    // Fall through — activation matters more than the audit row.
  }

  if (!shouldActivate) return textResponse({ ok: true, note: `Event ${eventType} logged; no action` });

  const now = new Date();
  const periodEnd = new Date(now.getTime() + SUBSCRIPTION_PERIOD_DAYS * 24 * 60 * 60 * 1000);

  // Activate the pending row created at checkout-init; if it's missing
  // (e.g. the pending insert failed), reconstruct from webhook metadata.
  const { data: existing } = await admin
    .from('user_subscriptions')
    .select('id, scope, tenant_id')
    .eq('provider_reference', reference)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from('user_subscriptions')
      .update({
        status: 'active',
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', existing.id);
    if (error) {
      console.error('Failed to activate subscription:', error);
      return textResponse({ error: 'Failed to activate subscription' }, 500);
    }
    if (existing.scope === 'tenant' && existing.tenant_id) {
      await promoteTenantIfFreeSeeded(admin, existing.tenant_id);
    }
  } else {
    const meta = (provider === 'paystack' ? data.metadata : data.meta) ?? {};
    const scope = meta.scope === 'tenant' ? 'tenant' : 'workforce';

    if (scope === 'tenant') {
      if (!meta.tenant_id) {
        console.error('No pending row and no tenant_id in metadata for', reference);
        return textResponse({ error: 'Unmatchable payment — no tenant_id' }, 422);
      }
      const { error } = await admin.from('user_subscriptions').insert([{
        scope: 'tenant',
        tenant_id: meta.tenant_id,
        workforce_id: null,
        plan: 'pro_unlimited',
        status: 'active',
        provider,
        provider_reference: reference,
        customer_email: data.customer?.email ?? null,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
      }]);
      if (error) {
        console.error('Failed to insert tenant subscription from webhook:', error);
        return textResponse({ error: 'Failed to record subscription' }, 500);
      }
      await promoteTenantIfFreeSeeded(admin, meta.tenant_id);
    } else {
      if (!meta.workforce_id) {
        console.error('No pending row and no workforce_id in metadata for', reference);
        return textResponse({ error: 'Unmatchable payment — no workforce_id' }, 422);
      }
      const { error } = await admin.from('user_subscriptions').insert([{
        scope: 'workforce',
        tenant_id: meta.tenant_id || null,
        workforce_id: meta.workforce_id,
        plan: 'pro_unlimited',
        status: 'active',
        provider,
        provider_reference: reference,
        customer_email: data.customer?.email ?? null,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd.toISOString(),
      }]);
      if (error) {
        console.error('Failed to insert subscription from webhook:', error);
        return textResponse({ error: 'Failed to record subscription' }, 500);
      }
    }
  }

  return textResponse({ ok: true, activated: reference });
});
