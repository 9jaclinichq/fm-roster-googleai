// Supabase Edge Function: creates a real Paystack subaccount for a tenant.
//
// Why an Edge Function at all: PAYSTACK_SECRET_KEY is a live secret key
// that can create subaccounts and, on other endpoints, move real money.
// It can never be embedded in client code — even a non-VITE_-prefixed one,
// since Vite ships whatever the bundled JS actually references — so this
// function is the only place in this project's architecture that can hold
// it safely (Deno.env, never in the repo or the client bundle). Same
// pattern as academic-copilot's AI_API_KEY/GEMINI_API_KEY.
//
// SCOPE (deliberately narrow — see migration 11's header): this function
// ONLY creates a subaccount (POST /subaccount) and returns the resulting
// subaccount_code for the caller to store on tenants.paystack_subaccount_code.
// There is no charge, subscription, or webhook handling here — that's a
// separate, larger task (needs a public webhook endpoint + signature
// verification) not attempted in this pass.
//
// Deploy:  npx supabase@2.112.0 functions deploy paystack-subaccount --project-ref <ref> --no-verify-jwt --use-api
// Secret:  npx supabase@2.112.0 secrets set PAYSTACK_SECRET_KEY=sk_live_... --project-ref <ref>
// (--no-verify-jwt because this app has no Supabase Auth sessions to verify
// against — see migration 01's header. This function is reachable by
// anyone holding the anon key, same trust model as the rest of this app's
// API surface. In this pass, the ONLY caller is meant to be
// SaaSOperatorConsoleView, gated by the platform-operator shared code —
// but that gating happens in the client/UI layer, not enforced here.)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  business_name: string;
  settlement_bank: string; // Paystack bank code, e.g. "058" for GTBank
  account_number: string;
  percentage_charge: number;
  description?: string;
  primary_contact_email?: string;
  primary_contact_name?: string;
  primary_contact_phone?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!paystackKey) {
    return jsonResponse({ error: 'PAYSTACK_SECRET_KEY is not configured on this function' }, 503);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  if (!body.business_name || !body.settlement_bank || !body.account_number || body.percentage_charge == null) {
    return jsonResponse(
      { error: 'business_name, settlement_bank, account_number, and percentage_charge are required' },
      400
    );
  }

  try {
    const paystackRes = await fetch('https://api.paystack.co/subaccount', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        business_name: body.business_name,
        settlement_bank: body.settlement_bank,
        account_number: body.account_number,
        percentage_charge: body.percentage_charge,
        description: body.description,
        primary_contact_email: body.primary_contact_email,
        primary_contact_name: body.primary_contact_name,
        primary_contact_phone: body.primary_contact_phone,
      }),
    });

    const paystackData = await paystackRes.json();

    if (!paystackRes.ok || !paystackData.status) {
      return jsonResponse(
        { error: paystackData.message || 'Paystack rejected the subaccount request', paystack_response: paystackData },
        paystackRes.status || 502
      );
    }

    return jsonResponse({
      subaccount_code: paystackData.data.subaccount_code,
      subaccount_id: paystackData.data.id,
      raw: paystackData.data,
    });
  } catch (err) {
    return jsonResponse({ error: err instanceof Error ? err.message : 'Unknown error calling Paystack' }, 502);
  }
});
