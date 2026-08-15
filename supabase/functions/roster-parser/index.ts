// Supabase Edge Function: server-side proxy for LLM-backed UCH roster
// document structuring, used by src/lib/roster/uchRosterParser.ts.
//
// Same architecture and reasoning as supabase/functions/academic-copilot —
// see that function's header for the full explanation of why an Edge
// Function is the only safe place to hold an LLM key in this project.
// This is a SEPARATE function (not a new action bolted onto
// academic-copilot) because roster parsing is an operational/scheduling
// task, not an academic one — different domain, different prompts, no
// reason to couple their deploys.
//
// Provider chain: OpenAI (AI_API_KEY) first, then Gemini (GEMINI_API_KEY)
// as a fallback; if both fail or are unconfigured, returns a structured
// error and the client falls back to its own deterministic heuristic
// parser (see uchRosterParser.ts) — the HITL workflow never breaks, it
// just gets a less-structured first draft for the Chief to fix by hand.
//
// EVERY prompt instructs the model to extract only what the source text
// actually states, and to put anything ambiguous or unparseable into
// `unparsed_notes` rather than guessing — this is a Human-In-The-Loop
// tool. The model never invents a name, date, or assignment that isn't in
// the pasted document; the Chief resolves gaps and conflicts by hand in
// the merge grid, same as they always would have on paper.
//
// Deploy:  npx supabase functions deploy roster-parser --project-ref <ref> --no-verify-jwt --use-api
// Secrets: shared with academic-copilot (AI_API_KEY / GEMINI_API_KEY) —
//          no separate secret needed if that function is already deployed.
//
// Status: deployed and live-verified (see CLAUDE.md).
//
// TENANT AI QUOTA (migration 11): same optional tenant_id + server-side
// quota check as academic-copilot — see that function's header for the
// full rationale. Enforced here too, not just client-side.
//
// AI-RIGOR TUNING (2026-08-15): after the quota check, this also splices in
// the tenant's operator-authored prompt override, if any, via
// _shared/tenantAdaptation.ts under the 'roster_parser' feature_key —
// extending the pattern casebook-copilot originally proved out alone.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchTenantAdaptationPromptOverride, appendTenantAdaptationOverride } from '../_shared/tenantAdaptation.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type RosterType =
  | 'combined_gop'
  | 'consultant_gop'
  | 'accident_emergency'
  | 'afternoon_supervision'
  | 'satellite_outreach';

interface RequestBody {
  roster_type: RosterType;
  text: string;
  tenant_id?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

interface QuotaResult {
  allowed: boolean;
  remaining: number | null;
  resets_at: string | null;
}

async function checkTenantAiQuota(tenantId: string): Promise<QuotaResult | null> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not available to Edge Function runtime.');
    return null;
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc('check_and_increment_tenant_ai_quota', { p_tenant_id: tenantId });
  if (error) {
    console.error('Quota RPC failed:', error.message);
    return null;
  }
  return data?.[0] ?? null;
}

const HITL_INSTRUCTION =
  'Extract ONLY what the source text actually states — never invent a name, date, station, or ' +
  'assignment that is not present. If a portion of the text is ambiguous, illegible-looking, or ' +
  'doesn\'t fit the expected structure, put a short description of it in "unparsed_notes" instead ' +
  'of guessing. A human (the Chief Resident) will review and correct this before anything is used.';

const SYSTEM_PROMPTS: Record<RosterType, string> = {
  consultant_gop:
    'You are structuring a UCH Family Medicine GOP (General Out-Patient) Consultant Roster. ' +
    'Clinic stations are: Triage, Male Sorting, Female Sorting, Children Sorting, Managed Care, Annexe. ' +
    HITL_INSTRUCTION +
    ' Respond ONLY with JSON of the shape: {"slots": [{"date_or_day": "...", "clinic_type": "Triage|Male Sorting|Female Sorting|Children Sorting|Managed Care|Annexe|Other", "consultants": ["..."]}], "unparsed_notes": ["..."]}',

  combined_gop:
    'You are structuring a UCH Family Medicine Combined GOP Duty Roster, which matches Consultants ' +
    'with on-floor Residents across the same clinic stations (Triage, Male Sorting, Female Sorting, ' +
    'Children Sorting, Managed Care, Annexe). ' +
    HITL_INSTRUCTION +
    ' Respond ONLY with JSON of the shape: {"slots": [{"date_or_day": "...", "clinic_type": "Triage|Male Sorting|Female Sorting|Children Sorting|Managed Care|Annexe|Other", "consultants": ["..."], "residents": ["..."]}], "unparsed_notes": ["..."]}',

  accident_emergency:
    'You are structuring a UCH Family Medicine A&E (Accident & Emergency) Call Roster. Shifts are ' +
    'paired: 4pm-10pm and 10pm-8am. ' +
    HITL_INSTRUCTION +
    ' Respond ONLY with JSON of the shape: {"shifts": [{"date_or_day": "...", "shift": "4pm-10pm|10pm-8am", "on_call": ["..."]}], "unparsed_notes": ["..."]}',

  afternoon_supervision:
    'You are structuring a UCH Family Medicine Afternoon/Priority/Saturday Supervision Roster, which ' +
    'names a 1st On Duty and 2nd On Duty person per date. ' +
    HITL_INSTRUCTION +
    ' Respond ONLY with JSON of the shape: {"duties": [{"date_or_day": "...", "first_on_duty": "..." or null, "second_on_duty": "..." or null}], "unparsed_notes": ["..."]}',

  satellite_outreach:
    'You are structuring a UCH Family Medicine Satellite Outposts Roster. Known facilities include ' +
    'Ikolaba, Agbeke Mercy, Airport PHC, NYSC, and Otunba Tunwase, but the source text may include ' +
    'others — extract whatever facility names actually appear. ' +
    HITL_INSTRUCTION +
    ' Respond ONLY with JSON of the shape: {"postings": [{"facility": "...", "date_or_day": "..." or null, "assigned": ["..."]}], "unparsed_notes": ["..."]}',
};

interface ProviderResult {
  provider: 'openai' | 'gemini';
  parsed: unknown;
}

async function callOpenAI(systemPrompt: string, text: string): Promise<ProviderResult | null> {
  const apiKey = Deno.env.get('AI_API_KEY');
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text.slice(0, 12000) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!res.ok) {
      console.error('OpenAI request failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return null;

    return { provider: 'openai', parsed: JSON.parse(content) };
  } catch (err) {
    console.error('OpenAI call threw:', err);
    return null;
  }
}

async function callGemini(systemPrompt: string, text: string): Promise<ProviderResult | null> {
  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) return null;

  try {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent',
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: text.slice(0, 12000) }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
        }),
      }
    );

    if (!res.ok) {
      console.error('Gemini request failed:', res.status, await res.text());
      return null;
    }

    const data = await res.json();
    const content = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) return null;

    return { provider: 'gemini', parsed: JSON.parse(content) };
  } catch (err) {
    console.error('Gemini call threw:', err);
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }

  const { roster_type, text } = body || ({} as RequestBody);
  let systemPrompt = roster_type && SYSTEM_PROMPTS[roster_type];
  if (!systemPrompt) {
    return jsonResponse({ error: `Unknown roster_type: ${String(roster_type)}` }, 400);
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return jsonResponse({ error: 'No text provided.' }, 400);
  }

  if (body.tenant_id) {
    const quota = await checkTenantAiQuota(body.tenant_id);
    if (quota && !quota.allowed) {
      return jsonResponse(
        {
          error: 'quota_exceeded',
          message: 'Free-tier AI action limit reached for this cycle. Upgrade your plan to continue, or wait for the quota to reset.',
          resets_at: quota.resets_at,
        },
        429
      );
    }

    // AI-rigor tuning (tenant_ai_adaptation_rules, migration 11) — see
    // _shared/tenantAdaptation.ts. Any failure silently keeps the
    // unmodified prompt rather than failing the request.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && serviceRoleKey) {
      const extraInstructions = await fetchTenantAdaptationPromptOverride(supabaseUrl, serviceRoleKey, body.tenant_id, 'roster_parser');
      systemPrompt = appendTenantAdaptationOverride(systemPrompt, extraInstructions);
    }
  }

  const result = (await callOpenAI(systemPrompt, text)) ?? (await callGemini(systemPrompt, text));

  if (!result) {
    return jsonResponse({ error: 'No AI provider is configured or all providers failed.' }, 503);
  }

  return jsonResponse({ result: result.parsed, provider: result.provider });
});
