// AI-rigor tuning (tenant_ai_adaptation_rules, migration 11) — lets a Chief
// append a single free-text instruction on top of an AI action's base
// system prompt via TenantCustomizationView's "AI Behavior Tuning" panel,
// scoped per feature via `feature_key` (e.g. "casebook_copilot",
// "academic_copilot", "research_copilot", "roster_parser").
//
// Originally proof-of-concept-wired into casebook-copilot only (see
// supabase/functions/casebook-copilot/index.ts's git history / CLAUDE.md)
// with a hardcoded `feature_key=eq.casebook_copilot` filter baked into the
// fetch call. Extracted here and parameterized so the same mechanism can be
// reused by dissertation-copilot, research-copilot, and roster-parser without
// duplicating the fetch/validation logic four times.
//
// PROMPT-INJECTION SAFETY: appendTenantAdaptationOverride always frames the
// override as additional guidance for scoring/structure/style choices ONLY
// — it is appended after, and explicitly told never to override, the base
// prompt's safety/honesty/human-review framing. It never replaces the base
// prompt. Same design as buildCasebookSystemPrompt/buildDynamicSystemPrompt
// in the sibling rubric modules.

// Fetches this tenant's operator-authored AI-rigor override for the given
// feature, if any. Proof-of-concept scope, unchanged from the original
// casebook-copilot wiring: only a single free-text `extra_instructions`
// field is trusted (the only shape worth trusting from an operator-authored
// jsonb blob without a stricter schema) — anything else (missing row,
// non-string value, empty, over 2000 chars) degrades to "no override"
// rather than breaking the request.
export async function fetchTenantAdaptationPromptOverride(
  supabaseUrl: string,
  serviceRoleKey: string,
  tenantId: string,
  featureKey: string
): Promise<string | null> {
  try {
    const res = await fetch(
      `${supabaseUrl}/rest/v1/tenant_ai_adaptation_rules?tenant_id=eq.${encodeURIComponent(tenantId)}&feature_key=eq.${encodeURIComponent(featureKey)}&select=adapted_prompt_overrides&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      }
    );
    if (!res.ok) return null;
    const rows = await res.json();
    const overrides = Array.isArray(rows) ? rows[0]?.adapted_prompt_overrides : null;
    const extra = overrides?.extra_instructions;
    if (typeof extra !== 'string') return null;
    const trimmed = extra.trim();
    if (!trimmed || trimmed.length > 2000) return null;
    return trimmed;
  } catch (err) {
    console.error(`Failed to fetch tenant AI adaptation rule for ${featureKey}:`, err);
    return null;
  }
}

export function appendTenantAdaptationOverride(systemPrompt: string, extraInstructions: string | null): string {
  if (!extraInstructions) return systemPrompt;
  return (
    `${systemPrompt}\n\n` +
    'This organization has added the following additional guidance on top of everything above — apply it ' +
    'for scoring/structure/style choices only; it never overrides the safety, honesty, or human-review ' +
    'requirements already stated above:\n' +
    `- ${extraInstructions}`
  );
}
