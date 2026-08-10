// Supabase Edge Function: initializes a provider-hosted checkout for the
// Pro/Unlimited workspace upgrade (Paystack transaction/initialize or
// Flutterwave v3 /payments) and records a 'pending' user_subscriptions row
// keyed by the provider reference. The payment-webhook function — never the
// client — is what flips the row to 'active' after the provider confirms.
//
// Why server-side init instead of Paystack Inline / Flutterwave inline JS:
// no public key exists in this project's env, and holding the AMOUNT here
// means a forged client can't decide what gets charged. The client only
// receives a redirect URL.
//
// ⚠️ PRICING PLACEHOLDER: PLAN_AMOUNT_NGN below is the value actually
// charged and was NOT specified in the task brief — ₦5,000/month awaits a
// real business decision (mirrored display-only in src/config/tiers.ts).
// PAYSTACK_SECRET_KEY on this project is a LIVE key — a completed checkout
// moves real money.
//
// Deploy:  npx supabase@2.112.0 functions deploy payment-checkout --project-ref <ref> --no-verify-jwt --use-api
// Secrets: PAYSTACK_SECRET_KEY (set), FLUTTERWAVE_SECRET_KEY (set).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PLAN = 'pro_unlimited';
const PLAN_AMOUNT_NGN = 5000; // placeholder — see header

// Where the provider sends the payer after checkout. Cosmetic only — the
// webhook is the source of truth for activation.
const RETURN_URL = 'https://privydoc-doc-workspace.web.app/#/workspace/research';

interface RequestBody {
  provider: 'paystack' | 'flutterwave';
  workforce_id: string;
  tenant_id?: string;
  email: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.provider || !body.workforce_id || !body.email) {
    return jsonResponse({ error: 'provider, workforce_id, and email are required' }, 400);
  }
  if (body.provider !== 'paystack' && body.provider !== 'flutterwave') {
    return jsonResponse({ error: "provider must be 'paystack' or 'flutterwave'" }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Supabase runtime env not available' }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);

  const reference = `privydoc-pro-${crypto.randomUUID()}`;
  const metadata = { workforce_id: body.workforce_id, tenant_id: body.tenant_id || null, plan: PLAN };

  try {
    let checkoutUrl: string;

    if (body.provider === 'paystack') {
      const key = Deno.env.get('PAYSTACK_SECRET_KEY');
      if (!key) return jsonResponse({ error: 'PAYSTACK_SECRET_KEY is not configured' }, 503);

      const res = await fetch('https://api.paystack.co/transaction/initialize', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: body.email,
          amount: PLAN_AMOUNT_NGN * 100, // kobo
          currency: 'NGN',
          reference,
          callback_url: RETURN_URL,
          metadata,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.status || !data.data?.authorization_url) {
        return jsonResponse({ error: data.message || 'Paystack rejected the initialize request' }, res.status || 502);
      }
      checkoutUrl = data.data.authorization_url;
    } else {
      const key = Deno.env.get('FLUTTERWAVE_SECRET_KEY');
      if (!key) return jsonResponse({ error: 'FLUTTERWAVE_SECRET_KEY is not configured' }, 503);

      const res = await fetch('https://api.flutterwave.com/v3/payments', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tx_ref: reference,
          amount: String(PLAN_AMOUNT_NGN),
          currency: 'NGN',
          redirect_url: RETURN_URL,
          customer: { email: body.email },
          meta: metadata,
          customizations: { title: 'PrivyDoc Workspace — Pro/Unlimited', description: 'Monthly Pro subscription' },
        }),
      });
      const data = await res.json();
      if (!res.ok || data.status !== 'success' || !data.data?.link) {
        return jsonResponse({ error: data.message || 'Flutterwave rejected the payment request' }, res.status || 502);
      }
      checkoutUrl = data.data.link;
    }

    // Record the pending subscription the webhook will later activate.
    const { error: insertError } = await admin.from('user_subscriptions').insert([{
      tenant_id: body.tenant_id || null,
      workforce_id: body.workforce_id,
      plan: PLAN,
      status: 'pending',
      provider: body.provider,
      provider_reference: reference,
      amount_ngn: PLAN_AMOUNT_NGN,
      customer_email: body.email,
    }]);
    if (insertError) {
      // The provider checkout already exists; surface but don't strand the
      // payer — the webhook upserts by reference and can still activate.
      console.error('Failed to insert pending subscription:', insertError);
    }

    return jsonResponse({ provider: body.provider, checkout_url: checkoutUrl, reference });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown checkout error' }, 502);
  }
});
