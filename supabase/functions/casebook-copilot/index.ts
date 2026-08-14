// Supabase Edge Function: server-side proxy for the Casebook & Clinical
// Logbook Engine's AI-assisted actions (migration 15). Same rationale,
// provider chain, and deployment/secrets story as academic-copilot and
// research-copilot — see academic-copilot/index.ts's header for the full
// explanation, not repeated here.
//
// Kept as its own Edge Function (not folded into academic-copilot),
// matching the precedent set by research-copilot: depends on
// supabase/functions/_shared/casebookRubric.ts to build a per-template
// dynamic prompt, and keeps academic-copilot's existing 3 actions
// untouched rather than growing that file further.
//
// Deploy:  npx supabase functions deploy casebook-copilot --project-ref <ref> --no-verify-jwt --use-api
// Secrets: reuses the same AI_API_KEY / GEMINI_API_KEY already set for
//          academic-copilot / research-copilot — no new secrets needed.
//
// TENANT AI QUOTA: shares the same rolling free-tier quota as every other
// AI-backed Edge Function (check_and_increment_tenant_ai_quota, migration
// 11) via casebookRubric.ts's checkCasebookAiQuota.

import {
  buildCasebookSystemPrompt,
  checkCasebookAiQuota,
  fetchTenantAdaptationPromptOverride,
  appendTenantAdaptationOverride,
  CasebookTemplateRubric,
} from '../_shared/casebookRubric.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ActionType = 'audit_case' | 'generate_defense_questions' | 'parse_logbook_curriculum';

interface RequestBody {
  action: ActionType;
  text: string;
  template?: CasebookTemplateRubric;
  tenant_id?: string;
  workforce_id?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

// Every prompt frames output as an educational aid requiring human
// (supervisor/consultant) sign-off — same convention as every other AI
// action in this app — and never claims to grant exam pass/fail authority.
const BASE_SYSTEM_PROMPTS: Record<ActionType, string> = {
  audit_case:
    'You are an academic assessor helping a Family Medicine resident audit their clinical case write-up ' +
    '(from a WACP/NPMCN casebook or PMR portfolio) against the active scoring framework. Score each ' +
    'domain/step honestly based on what is actually present in the text — do not assume missing content ' +
    'is implied. You are NOT the actual examiner and this is NOT an official grade; say so explicitly. ' +
    'Respond ONLY with JSON of the shape: {"scores": {"<domain_or_step>": number, ...}, ' +
    '"overall_notes": ["...", "..."]} (max 6 notes, each specific and actionable). For point-scored ' +
    'domains, scores are 0 to the domain\'s max points. For PMR steps, use 1 for met and 0 for not met.',

  generate_defense_questions:
    'You are a Family Medicine exam preparation assistant. Given a resident\'s clinical case write-up, ' +
    'generate realistic oral defense (viva) questions an examiner might ask about this specific case, ' +
    'each with a concise recommended answer grounded in what the resident actually wrote (not invented ' +
    'clinical facts beyond it). This is exam-preparation practice, not real examiner questions, and must ' +
    'never be presented as guaranteed exam content. ' +
    'Respond ONLY with JSON of the shape: {"questions": [{"question": "...", "recommended_answer": "..."}]} ' +
    '(4 to 6 questions).',

  parse_logbook_curriculum:
    'You are a curriculum-parsing assistant. Given raw text extracted from a Family Medicine residency ' +
    'clinical logbook document, extract the structured list of stations/rotations and the procedures or ' +
    'competencies required at each, with their required counts if stated. Never invent stations or counts ' +
    'not evidenced in the text. ' +
    'Respond ONLY with JSON of the shape: {"stations": [{"station_name": "...", "procedures": ' +
    '[{"procedure_or_competency": "...", "required_count": number}]}]}',
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
          contents: [{ parts: [{ text: text.slice(0, 12000) }] }],
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (body.tenant_id && supabaseUrl && serviceRoleKey) {
    const quota = await checkCasebookAiQuota(supabaseUrl, serviceRoleKey, body.tenant_id, body.workforce_id);
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
  }

  // parse_logbook_curriculum has no per-workspace template (it's an admin
  // upload, not tied to a candidate's active framework) — only audit_case
  // and generate_defense_questions get the dynamic per-template prompt.
  let systemPrompt = template && action !== 'parse_logbook_curriculum' ? buildCasebookSystemPrompt(basePrompt, template) : basePrompt;

  // AI-rigor tuning (tenant_ai_adaptation_rules, migration 11) — wired
  // into an Edge Function for the first time here as a proof of concept.
  // Any failure (network, malformed row, no tenant_id) silently keeps the
  // unmodified prompt rather than failing the whole request.
  if (body.tenant_id && supabaseUrl && serviceRoleKey) {
    const extraInstructions = await fetchTenantAdaptationPromptOverride(supabaseUrl, serviceRoleKey, body.tenant_id);
    systemPrompt = appendTenantAdaptationOverride(systemPrompt, extraInstructions);
  }

  const result = (await callOpenAI(systemPrompt, text)) ?? (await callGemini(systemPrompt, text));

  if (!result) {
    return jsonResponse({ error: 'No AI provider is configured or all providers failed.' }, 503);
  }

  return jsonResponse({ result: result.parsed, provider: result.provider });
});
