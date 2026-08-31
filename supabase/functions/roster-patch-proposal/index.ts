// Supabase Edge Function: Chief-facing AI proposal layer for structured
// roster editing (Roster AI V1 -- Prompt-to-Patch Proposal Layer). See the
// repo root's two dated 2026-08-30 WORKSPC_ROSTER_AI_V1_*.md documents (the
// DISCOVER+PLAN doc and its final pre-implementation review) for the full
// reviewed design this function implements.
//
// UNLIKE roster-parser (this function's closest precedent), tenant is NEVER
// accepted from the client. roster-parser trusts an optional client-supplied
// tenant_id purely to gate its own AI-quota check (confirmed by re-reading
// roster-parser/index.ts) -- too loose a pattern for an AI surface whose
// output feeds a real patch-application/queueing flow. Here, the Chief's
// admin_access_code is the only credential accepted; tenant_id is derived
// from it server-side via verify_chief_admin_code(text) (migration 80), a
// SECURITY DEFINER RPC returning only tenant_id -- a POST-body/RPC-
// parameter call, never a URL query string. This function makes no
// database write of any kind (see verify_chief_admin_code's own migration
// header for why the raw admin code previously travelling in a URL was a
// real exposure surface, and why an RPC rather than a raw service-role
// table read is the correction).
//
// NO DATABASE WRITE OF ANY KIND. No revision RPC call. No roster save/
// publish call. This function's only output is a symbolic, schema-validated
// proposal -- identity resolution, swap compilation, applyRosterPatch,
// reconciliation, net diff, Chief acceptance, and Save Draft/Publish all
// happen entirely client-side afterward, through completely unmodified
// existing code (rosterPatchProposalCompiler.ts, then rosterPatch.ts/
// rosterSwap.ts/rosterReconciliation.ts/rosterNetDiff.ts/rosterRebase.ts).
//
// admin_access_code authenticates the request but is NEVER included in the
// text sent to the model -- only tenant-derived roster/workforce context
// (built client-side, from data the Chief's session already holds) and the
// Chief's own instruction text are ever part of the prompt. See
// buildSystemPrompt()/callOpenAI()/callGemini() below: neither
// admin_access_code nor tenant_id is ever interpolated into a prompt.
//
// Provider chain: OpenAI (AI_API_KEY) first, then Gemini (GEMINI_API_KEY),
// identical call mechanics to roster-parser's own callOpenAI/callGemini --
// re-justified (not blindly copied) in the reviewed design doc's Section 8.
// Duplicated rather than imported from a shared module, matching this
// repo's existing per-function convention (no shared AI-provider module
// exists anywhere in this codebase today).
//
// Deploy: npx supabase functions deploy roster-patch-proposal --project-ref <ref> --no-verify-jwt --use-api
// Secrets: shared with roster-parser/dissertation-copilot (AI_API_KEY / GEMINI_API_KEY).
//
// Status: LOCAL ONLY -- written for review, not deployed. Deployment freeze ACTIVE.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { fetchTenantAdaptationPromptOverride, appendTenantAdaptationOverride } from '../_shared/tenantAdaptation.ts';
import {
  validateProposedRosterPatch,
  normalizeRosterContext,
  normalizeWorkforceContext,
  normalizeSectionLabels,
  RosterSection,
  RosterContextRow,
  WorkforceContextEntry,
} from './schema.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  admin_access_code: string;
  instruction: string;
  roster_context: RosterContextRow[];
  workforce_context: WorkforceContextEntry[];
  // Tenant-configured section display labels (roster_section_config,
  // migration 74) -- optional, sent only so the model can map the Chief's
  // own terminology onto the 4 stable section keys; never a substitute for
  // those keys (see buildSystemPrompt()'s own explicit instruction below).
  section_labels?: Partial<Record<RosterSection, string>>;
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

// Calls verify_chief_admin_code(text) (migration 80) -- a POST to
// /rest/v1/rpc/verify_chief_admin_code with { p_admin_code } in the
// request BODY, never a URL query string. This replaced an earlier
// version of this function that queried /rest/v1/settings?admin_access_code=eq.<code>
// directly, embedding the raw admin code in a URL -- a real exposure
// surface (URL/access-log capture by intermediate infrastructure) beyond
// how every other chief_* RPC in this schema already verifies the
// identical credential. The RPC itself does the exact same
// `SELECT tenant_id FROM settings WHERE admin_access_code = p_admin_code`
// lookup chief_start_roster_revision already performs inline (migration
// 75); it returns ONLY tenant_id (or NULL), no other settings content,
// no hash/comparison logic exposed to the client.
async function verifyAdminCodeAndDeriveTenant(supabaseUrl: string, serviceRoleKey: string, adminCode: string): Promise<string | null> {
  try {
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await admin.rpc('verify_chief_admin_code', { p_admin_code: adminCode });
    if (error) {
      console.error('Admin code verification RPC failed:', error.message);
      return null;
    }
    return (data as string | null) ?? null;
  } catch (err) {
    console.error('Admin code verification threw:', err);
    return null;
  }
}

async function checkTenantAiQuota(supabaseUrl: string, serviceRoleKey: string, tenantId: string): Promise<QuotaResult | null> {
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await admin.rpc('check_and_increment_tenant_ai_quota', { p_tenant_id: tenantId });
  if (error) {
    console.error('Quota RPC failed:', error.message);
    return null;
  }
  return data?.[0] ?? null;
}

// Same Human-In-The-Loop framing every existing AI Edge Function in this
// repo already uses (roster-parser/dissertation-copilot/casebook-copilot/
// research-copilot) -- never invent, defer ambiguity to a human field
// rather than guessing.
const HITL_INSTRUCTION =
  'Never invent a person, section, field, or row that is not present in the roster context provided below. ' +
  'If part of the instruction cannot be expressed using the 4 allowed operation kinds, list it in ' +
  '"unsupported_requests" and set outcome to "unsupported_instruction" instead of inventing a new kind of ' +
  'operation. If the instruction is too vague to act on responsibly, set outcome to "needs_clarification" and ' +
  'explain what is missing in "assumptions" or "rationale" rather than guessing. A human (the Chief) reviews ' +
  'and must explicitly accept every operation before anything is saved -- nothing you produce is applied ' +
  'automatically, so it is always safer to under-propose than to guess.';

function buildSystemPrompt(
  rosterContext: RosterContextRow[],
  workforceContext: WorkforceContextEntry[],
  sectionLabels?: Partial<Record<RosterSection, string>>
): string {
  const sectionLabelNote = sectionLabels && Object.keys(sectionLabels).length > 0
    ? `Tenant-configured section display labels, for interpreting the Chief's own terminology ONLY -- always address content using the stable keys gop/emergency/supervision/satellite in your output, never these display labels: ${JSON.stringify(sectionLabels)}.`
    : '';

  return [
    'You are proposing structured edits to a duty roster for a Chief resident/admin, who will review and explicitly accept or reject every proposed change before anything is saved. You never write to any database or apply anything yourself.',
    'The roster has exactly 4 sections, identified ONLY by these stable keys: "gop", "emergency", "supervision", "satellite".',
    'Valid fields per section -- gop: consultants, residents. emergency: on_call. satellite: assigned. supervision: first_on_duty, second_on_duty.',
    'You may propose only 4 kinds of operation: assign, unassign, replace, swap. There is no operation for adding/removing/reordering a roster row, changing a date, creating a new section, editing leave records, editing workforce records, or editing tenant rules -- if the instruction needs one of those, do not invent an operation for it.',
    'Refer to people ONLY by the exact display name text shown in the roster/workforce context below, as subject_name / from_subject_name / to_subject_name / subject_a_name / subject_b_name. NEVER emit a database id, workforce id, tenant id, or any identifier that is not a plain display name string. NEVER return a raw roster snapshot -- only the operations describing the requested change.',
    HITL_INSTRUCTION,
    sectionLabelNote,
    `Roster context -- current state, addressed by section/row_index/field/current occupant display names: ${JSON.stringify(rosterContext)}`,
    `Workforce available for assignment -- display_name and category/cadre: ${JSON.stringify(workforceContext)}`,
    'Respond ONLY with JSON of this exact shape, no other keys: {"interpreted_instruction": string, "operations": SymbolicOperation[], "referenced_names": string[], "unresolved_ambiguity": string[], "unsupported_requests": string[], "assumptions": string[], "rationale": string, "outcome": "valid" | "ambiguous_identity" | "unsupported_instruction" | "needs_clarification"}. ' +
      'SymbolicOperation is exactly one of: ' +
      '{"op":"assign","section":string,"row_index":integer,"field":string,"subject_name":string,"reason"?:string} | ' +
      '{"op":"unassign","section":string,"row_index":integer,"field":string,"subject_name":string,"reason"?:string} | ' +
      '{"op":"replace","section":string,"row_index":integer,"field":string,"from_subject_name":string,"to_subject_name":string,"reason"?:string} | ' +
      '{"op":"swap","target_a":{"section":string,"row_index":integer,"field":string},"target_b":{"section":string,"row_index":integer,"field":string},"subject_a_name":string,"subject_b_name":string,"reason"?:string}. ' +
      'Do not include any key beyond exactly these.',
  ].filter(Boolean).join('\n\n');
}

interface ProviderResult {
  provider: 'openai' | 'gemini';
  parsed: unknown;
}

async function callOpenAI(systemPrompt: string, instruction: string): Promise<ProviderResult | null> {
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
          { role: 'user', content: instruction.slice(0, 4000) },
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

async function callGemini(systemPrompt: string, instruction: string): Promise<ProviderResult | null> {
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
          contents: [{ parts: [{ text: instruction.slice(0, 4000) }] }],
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
    return jsonResponse({ status: 'invalid_request', message: 'Method not allowed' }, 405);
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ status: 'invalid_request', message: 'Invalid JSON body.' }, 400);
  }

  const { admin_access_code, instruction, roster_context, workforce_context, section_labels } = body || ({} as RequestBody);

  if (!admin_access_code || typeof admin_access_code !== 'string') {
    return jsonResponse({ status: 'invalid_request', message: 'admin_access_code is required.' }, 400);
  }
  if (!instruction || typeof instruction !== 'string' || !instruction.trim()) {
    return jsonResponse({ status: 'invalid_request', message: 'instruction is required.' }, 400);
  }
  if (!Array.isArray(roster_context) || !Array.isArray(workforce_context)) {
    return jsonResponse({ status: 'invalid_request', message: 'roster_context and workforce_context are required arrays.' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY not available to Edge Function runtime.');
    return jsonResponse({ status: 'provider_unavailable' }, 503);
  }

  // Tenant is derived ONLY from the verified admin_access_code -- never
  // trusted from the client. See this file's header and
  // verifyAdminCodeAndDeriveTenant()'s own comment.
  const tenantId = await verifyAdminCodeAndDeriveTenant(supabaseUrl, serviceRoleKey, admin_access_code);
  if (!tenantId) {
    return jsonResponse({ status: 'invalid_admin_code' }, 401);
  }

  const quota = await checkTenantAiQuota(supabaseUrl, serviceRoleKey, tenantId);
  if (quota && !quota.allowed) {
    return jsonResponse(
      {
        status: 'quota_exceeded',
        message: 'Free-tier AI action limit reached for this cycle. Upgrade your plan to continue, or wait for the quota to reset.',
        resets_at: quota.resets_at,
      },
      429
    );
  }

  // Server-side allowlisting -- the ONLY values ever passed to
  // buildSystemPrompt() below are these normalized ones, never the raw
  // request-body arrays. See the normalize* functions' own header for why
  // this is enforced here rather than trusted from the client.
  const normalizedRosterContext = normalizeRosterContext(roster_context);
  const normalizedWorkforceContext = normalizeWorkforceContext(workforce_context);
  const normalizedSectionLabels = normalizeSectionLabels(section_labels);

  let systemPrompt = buildSystemPrompt(normalizedRosterContext, normalizedWorkforceContext, normalizedSectionLabels);
  // AI-rigor tuning (tenant_ai_adaptation_rules, migration 11), reused
  // unchanged under a new feature_key -- semantically appropriate here for
  // the same reason it already is for roster-parser: a tenant operator may
  // want to nudge scoring/structure/style choices for their own roster
  // conventions. Any failure silently keeps the unmodified prompt.
  const extraInstructions = await fetchTenantAdaptationPromptOverride(supabaseUrl, serviceRoleKey, tenantId, 'roster_patch_proposal');
  systemPrompt = appendTenantAdaptationOverride(systemPrompt, extraInstructions);

  const result = (await callOpenAI(systemPrompt, instruction)) ?? (await callGemini(systemPrompt, instruction));
  if (!result) {
    return jsonResponse({ status: 'provider_unavailable' }, 503);
  }

  const validated = validateProposedRosterPatch(result.parsed);
  if (validated.status === 'error') {
    // A model response that fails schema validation is a safe
    // proposal-generation failure, never a partial patch -- nothing from
    // result.parsed is ever forwarded to the client beyond this point.
    return jsonResponse({ status: 'schema_invalid', message: validated.message }, 502);
  }

  return jsonResponse({ status: 'ok', proposal: validated.proposal, provider: result.provider });
});
