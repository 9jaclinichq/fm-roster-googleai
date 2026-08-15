// Supabase Edge Function: server-side proxy for LLM-backed academic tools.
//
// RENAMED from academic-copilot (2026-08-15, modularization pass — see
// docs/MODULARIZATION_ARCHITECTURE.md's backend module map) for 1:1 naming
// with the `dissertation` frontend module. Cosmetic rename only, same code
// — Deno bundles per-function, so this carries no functional change. Note
// this function ALSO backs the legacy Casebook Builder MVP's 3 original
// actions (vancouver_format, methodology_check, extract_ddx are shared
// across both call sites in src/lib/ai/academicCopilot.ts) — the name
// favors its primary/larger use case rather than being a perfect 1:1
// module boundary, same tradeoff the modularization doc calls out
// explicitly for this rename.
//
// This exists so an LLM API key can be used safely at all — this app is a
// pure static SPA with no backend of its own (see CLAUDE.md), so any key
// embedded in client code (even a non-VITE_-prefixed one, since Vite still
// ships whatever the bundled JS references) would be visible to every
// visitor. The keys live ONLY here, as Supabase Edge Function secrets
// (Deno.env), never in the repo or the client bundle.
//
// Provider chain: OpenAI (AI_API_KEY) is tried first; if it's not
// configured or the call fails, Gemini (GEMINI_API_KEY) is tried as a
// second-tier fallback; if that also fails, this returns a structured
// error and the client (src/lib/ai/academicCopilot.ts) falls back to its
// own deterministic heuristic implementations — the UI never breaks or
// silently invents output just because both providers had a bad day.
//
// Deploy:  npx supabase functions deploy dissertation-copilot --project-ref <ref> --no-verify-jwt --use-api
//          (--use-api bundles server-side, no Docker required)
// Secrets: npx supabase secrets set AI_API_KEY=sk-... --project-ref <ref>
//          npx supabase secrets set GEMINI_API_KEY=... --project-ref <ref>
// (--no-verify-jwt because this app has no Supabase Auth sessions to
// verify against — see migration 01's header for that documented limitation.
// This function is reachable by anyone holding the anon key, same trust
// model as the rest of this app's API surface.)
//
// TENANT AI QUOTA (added in migration 11 / SaaS multi-tenancy): if the
// request includes a tenant_id, this function checks and increments that
// tenant's rolling free-tier quota via check_and_increment_tenant_ai_quota()
// BEFORE calling any provider, using the service-role key (bypasses RLS,
// safe since this runs server-side only, never in client code). This is
// deliberately enforced HERE, not just in the client — a client-only quota
// check would be trivially bypassed by anyone calling this Edge Function's
// URL directly with curl. tenant_id is optional and backward-compatible:
// if omitted, quota checking is skipped entirely (older callers keep
// working unmetered until they're updated to pass it).
//
// AI-RIGOR TUNING (2026-08-15): after the quota check, this also splices in
// the tenant's operator-authored prompt override, if any, via
// _shared/tenantAdaptation.ts. Deliberately still keyed to the
// 'academic_copilot' feature_key — that's a stored data identifier in
// tenant_ai_adaptation_rules (and the exact string named in
// TenantCustomizationView.tsx's AI Behavior Tuning panel), independent of
// this function's deploy name; renaming it too would be a data-contract
// change, out of scope for what this pass's rename touches.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchTenantAdaptationPromptOverride, appendTenantAdaptationOverride } from '../_shared/tenantAdaptation.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ActionType = 'vancouver_format' | 'methodology_check' | 'extract_ddx';

interface RequestBody {
  action: ActionType;
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
    // Auto-injected by the Supabase platform in every Edge Function — if
    // absent, something is very wrong with the runtime, not with the
    // tenant's quota. Fail open rather than blocking every AI action.
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

// Every prompt explicitly frames output as an educational aid requiring
// human (supervisor/consultant) review — never as a diagnosis, a grade, or
// a substitute for the department's actual sign-off process. This mirrors
// the framing already baked into the client-side heuristic fallback.
const SYSTEM_PROMPTS: Record<ActionType, string> = {
  vancouver_format:
    'You are a citation formatting assistant for a Family Medicine residency program. ' +
    'Reformat the user\'s reference list into numbered Vancouver style ' +
    '(author surnames + initials, title, journal, year;volume(issue):pages). ' +
    'Preserve every reference given — never invent or drop one. ' +
    'Respond ONLY with JSON of the shape: {"formatted": "1. ...\\n2. ..."}',

  methodology_check:
    'You are an academic writing assistant helping a Family Medicine resident check their ' +
    'dissertation proposal draft for structural completeness (Background, Objectives, ' +
    'Methodology, Ethical Considerations, References) and clarity. ' +
    'You are NOT a substitute for supervisor or consultant sign-off, and you must say so. ' +
    'Respond ONLY with JSON of the shape: {"compliant": boolean, "notes": ["...", "..."]} ' +
    '(max 6 notes, each a specific and actionable observation).',

  extract_ddx:
    'You are an educational aid reviewing a Family Medicine resident\'s case report notes. ' +
    'Identify the differential diagnoses they\'ve already listed, and separately suggest any ' +
    'clinically relevant considerations they may have missed — framed strictly as discussion ' +
    'points for their supervisor, never as a diagnosis or medical advice, and never presented ' +
    'as more certain than a prompt for further clinical reasoning. ' +
    'Respond ONLY with JSON of the shape: {"candidates": ["...", "..."], "reasoning": ' +
    '"one sentence on your approach, ending with a reminder this requires supervisor review"}',
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
          { role: 'user', content: text.slice(0, 8000) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
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
          contents: [{ parts: [{ text: text.slice(0, 8000) }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
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

  const { action, text } = body || ({} as RequestBody);
  let systemPrompt = action && SYSTEM_PROMPTS[action];
  if (!systemPrompt) {
    return jsonResponse({ error: `Unknown action: ${String(action)}` }, 400);
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
    // _shared/tenantAdaptation.ts. Any failure (network, malformed row)
    // silently keeps the unmodified prompt rather than failing the request.
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && serviceRoleKey) {
      const extraInstructions = await fetchTenantAdaptationPromptOverride(supabaseUrl, serviceRoleKey, body.tenant_id, 'academic_copilot');
      systemPrompt = appendTenantAdaptationOverride(systemPrompt, extraInstructions);
    }
  }

  // Try OpenAI first, then Gemini. Either may be unconfigured (env var
  // unset) or transiently failing — both are treated the same way: fall
  // through to the next provider, and if none succeed, a clean error that
  // tells the client to use its local heuristic.
  const result = (await callOpenAI(systemPrompt, text)) ?? (await callGemini(systemPrompt, text));

  if (!result) {
    return jsonResponse({ error: 'No AI provider is configured or all providers failed.' }, 503);
  }

  return jsonResponse({ result: result.parsed, provider: result.provider });
});
