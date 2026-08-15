// Supabase Edge Function: server-side proxy for the Universal Research
// Engine's AI Copilot Panel (ResearchWorkspaceView.tsx). Same rationale and
// provider chain as supabase/functions/dissertation-copilot/index.ts — an LLM
// API key can only live here (Deno.env), never in client code, since this
// app is a pure static SPA. See that function's header for the full
// deploy/secrets/provider-chain explanation; not repeated here.
//
// Kept as its OWN Edge Function rather than folded into dissertation-copilot's
// action list: it depends on supabase/functions/_shared/researchRubric.ts
// to build a per-template dynamic system prompt (see that module's header
// for the prompt-injection safety design), which dissertation-copilot's fixed
// prompts have no use for. Every action here is deterministic-fallback-
// first at the CLIENT (see src/lib/ai/researchCopilot.ts) — this function
// only makes the "real AI" tier possible, the UI never depends on it.
//
// Deploy:  npx supabase functions deploy research-copilot --project-ref <ref> --no-verify-jwt --use-api
// Secrets: reuses the same AI_API_KEY / GEMINI_API_KEY already set for
//          dissertation-copilot — no new secrets needed.
//
// TENANT AI QUOTA: shares the SAME rolling free-tier quota as every other
// AI-backed Edge Function (check_and_increment_tenant_ai_quota, migration
// 11) via researchRubric.ts's checkResearchAiQuota — research actions
// don't get a separate budget.
//
// AI-RIGOR TUNING (2026-08-15): after the quota check, this also splices in
// the tenant's operator-authored prompt override, if any, via
// _shared/tenantAdaptation.ts under the 'research_copilot' feature_key —
// extending the pattern casebook-copilot originally proved out alone.

import { buildDynamicSystemPrompt, checkResearchAiQuota, ResearchTemplateRubric } from '../_shared/researchRubric.ts';
import { fetchTenantAdaptationPromptOverride, appendTenantAdaptationOverride } from '../_shared/tenantAdaptation.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ActionType = 'audit_draft' | 'synthesize_literature_matrix' | 'generate_table_shells';

interface RequestBody {
  action: ActionType;
  text: string;
  template?: ResearchTemplateRubric;
  tenant_id?: string;
  workforce_id?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Every prompt frames output as an educational planning aid requiring
// human (supervisor/consultant) review — same framing convention as
// dissertation-copilot's SYSTEM_PROMPTS — and explicitly forbids inventing
// bibliographic details or results beyond what the resident provided.
const BASE_SYSTEM_PROMPTS: Record<ActionType, string> = {
  audit_draft:
    'You are an academic writing assistant helping a Family Medicine resident audit their research ' +
    'proposal/dissertation draft against their institution\'s active rubric template. Assess structural ' +
    'completeness (does the draft address what this section should cover?), clarity, and any rubric-specific ' +
    'gaps (e.g. a missing PICO element, an under-developed methodology). You are NOT a substitute for ' +
    'supervisor or consultant sign-off, and you must say so. ' +
    'Respond ONLY with JSON of the shape: {"compliant": boolean, "notes": ["...", "..."]} ' +
    '(max 6 notes, each a specific and actionable observation).',

  synthesize_literature_matrix:
    'You are a literature-review assistant. Given a resident\'s pasted reference list, organize it into a ' +
    'literature matrix — one row per reference. For each: extract the author/year, infer the likely study ' +
    'design from the title/journal if reasonably inferable (else "unclear"), summarize the apparent focus in ' +
    'a few words, and note a possible research gap the title suggests, if any. Never invent bibliographic ' +
    'details or findings beyond what the reference text itself shows. ' +
    'Respond ONLY with JSON of the shape: {"rows": [{"author_year": "...", "study_design": "...", ' +
    '"key_focus": "...", "gap_or_note": "..."}]}',

  generate_table_shells:
    'You are a research methodology assistant helping a Family Medicine resident plan their results tables ' +
    'before data collection begins. Given their study title and study design, propose 3 to 5 appropriately ' +
    'titled dummy table shells with a short description of expected columns. These are structural ' +
    'placeholders only — never fabricate actual data, results, or statistics. ' +
    'Respond ONLY with JSON of the shape: {"tables": [{"title": "...", "columns_hint": "..."}]}',
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

  const { action, text, template } = body || ({} as RequestBody);
  const basePrompt = action && BASE_SYSTEM_PROMPTS[action];
  if (!basePrompt) {
    return jsonResponse({ error: `Unknown action: ${String(action)}` }, 400);
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return jsonResponse({ error: 'No text provided.' }, 400);
  }

  let systemPrompt = template ? buildDynamicSystemPrompt(basePrompt, template) : basePrompt;

  if (body.tenant_id) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && serviceRoleKey) {
      const quota = await checkResearchAiQuota(supabaseUrl, serviceRoleKey, body.tenant_id, body.workforce_id);
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
      const extraInstructions = await fetchTenantAdaptationPromptOverride(supabaseUrl, serviceRoleKey, body.tenant_id, 'research_copilot');
      systemPrompt = appendTenantAdaptationOverride(systemPrompt, extraInstructions);
    }
  }

  // Try OpenAI first, then Gemini — either may be unconfigured or
  // transiently failing; if both fail, the client falls back to its own
  // heuristic implementation (see src/lib/ai/researchCopilot.ts).
  const result = (await callOpenAI(systemPrompt, text)) ?? (await callGemini(systemPrompt, text));

  if (!result) {
    return jsonResponse({ error: 'No AI provider is configured or all providers failed.' }, 503);
  }

  return jsonResponse({ result: result.parsed, provider: result.provider });
});
