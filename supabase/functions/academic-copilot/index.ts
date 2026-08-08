// Supabase Edge Function: server-side proxy for LLM-backed academic tools.
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
// Deploy:  npx supabase functions deploy academic-copilot --project-ref <ref> --no-verify-jwt --use-api
//          (--use-api bundles server-side, no Docker required)
// Secrets: npx supabase secrets set AI_API_KEY=sk-... --project-ref <ref>
//          npx supabase secrets set GEMINI_API_KEY=... --project-ref <ref>
// (--no-verify-jwt because this app has no Supabase Auth sessions to
// verify against — see migration 01's header for that documented limitation.
// This function is reachable by anyone holding the anon key, same trust
// model as the rest of this app's API surface.)

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type ActionType = 'vancouver_format' | 'methodology_check' | 'extract_ddx';

interface RequestBody {
  action: ActionType;
  text: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
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
  const systemPrompt = action && SYSTEM_PROMPTS[action];
  if (!systemPrompt) {
    return jsonResponse({ error: `Unknown action: ${String(action)}` }, 400);
  }
  if (!text || typeof text !== 'string' || !text.trim()) {
    return jsonResponse({ error: 'No text provided.' }, 400);
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
