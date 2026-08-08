// Supabase Edge Function: server-side proxy for LLM-backed academic tools.
//
// This exists so an LLM API key can be used safely at all — this app is a
// pure static SPA with no backend of its own (see CLAUDE.md), so any key
// embedded in client code (even a non-VITE_-prefixed one, since Vite still
// ships whatever the bundled JS references) would be visible to every
// visitor. The key lives ONLY here, as a Supabase Edge Function secret
// (Deno.env), never in the repo or the client bundle.
//
// If AI_API_KEY isn't set, or the LLM call fails for any reason, this
// returns a clear structured error rather than a 200 with fabricated
// content — src/lib/ai/academicCopilot.ts on the client treats any
// non-success response as a signal to fall back to its own deterministic
// heuristic implementations, so the UI never breaks or silently invents
// output just because this function had a bad day.
//
// Deploy:  npx supabase functions deploy academic-copilot --no-verify-jwt
// Secret:  npx supabase secrets set AI_API_KEY=sk-...
// (--no-verify-jwt because this app has no Supabase Auth sessions to
// verify against — see migration 01's header for that documented limitation.
// This function is reachable by anyone holding the anon key, same trust
// model as the rest of this app's API surface.)
//
// NOT DEPLOYED OR LIVE-TESTED from the session that wrote this file — there
// was no working Supabase CLI / Docker deploy path available. The code
// below is written to the standard Supabase Edge Function (Deno.serve)
// contract as precisely as possible, but treat it as reviewed-not-verified
// until it's actually deployed and exercised once for real.

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
// the framing already baked into the client-side heuristic fallbacks.
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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const apiKey = Deno.env.get('AI_API_KEY');
  if (!apiKey) {
    return jsonResponse({ error: 'AI_API_KEY is not configured for this Edge Function.' }, 503);
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

  try {
    const llmResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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

    if (!llmResponse.ok) {
      const errText = await llmResponse.text();
      console.error('LLM request failed:', llmResponse.status, errText);
      return jsonResponse({ error: 'LLM request failed.', status: llmResponse.status }, 502);
    }

    const llmData = await llmResponse.json();
    const content = llmData?.choices?.[0]?.message?.content;
    if (!content) {
      return jsonResponse({ error: 'LLM returned no content.' }, 502);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      return jsonResponse({ error: 'LLM returned unparseable JSON.', raw: content }, 502);
    }

    return jsonResponse({ result: parsed });
  } catch (err) {
    console.error('academic-copilot function error:', err);
    return jsonResponse({ error: 'Unexpected error calling the LLM.' }, 500);
  }
});
