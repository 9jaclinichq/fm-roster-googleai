// Shared by the casebook-copilot Edge Function (Casebook & Clinical
// Logbook Engine, migration 15). Same role as researchRubric.ts: builds
// prompt text and runs deterministic validators against whichever
// `casebook_templates` row is active for a workspace. Provider-agnostic —
// does not call OpenAI/Gemini itself.
//
// SAME PROMPT-INJECTION SAFETY DESIGN AS researchRubric.ts /
// tenantAdaptation.ts: nothing here splices raw tenant/resident-supplied
// template text into a prompt without the same "append as clearly-labeled
// rules that never override the base safety framing" treatment.

export interface CasebookTemplateRubric {
  framework_type: string;
  thematic_distribution: Record<string, unknown>;
  scoring_rubric: Record<string, unknown>;
  formatting_rules: Record<string, unknown>;
}

// The 10 WACP/NPMCN 15-Casebook scoring domains (falls back to this order
// if a template's scoring_rubric.domains doesn't specify one — PMR-track
// templates use the 7-step checklist instead, see below).
export const WACP_SCORING_DOMAINS = [
  'relevance_to_care',
  'diagnostic_accuracy',
  'cost_considerations',
  'procedural_skills',
  'psychosocial_determinants',
  'pccm_components',
  'discussion',
  'references',
  'formatting',
  'logical_sequencing',
] as const;

export const PMR_SEVEN_STEPS = [
  'interest_in_patient',
  'clinical_area',
  'evidence_used',
  'family_social_context',
  'future_illness_impact',
  'fm_tools_used',
  'fm_interventions',
] as const;

export interface ValidationResult {
  valid: boolean;
  message: string;
}

const VANCOUVER_NUMBERED_LINE = /^\s*\d+\.\s+\S/;
const FIGURE_STARTING_SENTENCE = /(^|[.!?]\s+)\s*\d+[\s,.]/;

// Checks the case write-up's reference list against the template's
// formatting_rules (Vancouver numbering, minimum count, max age in years —
// age can only be checked if a 4-digit year is present per line).
export function validateReferenceFormatting(referencesText: string, rules: Record<string, unknown>): ValidationResult {
  const lines = referencesText.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return { valid: false, message: 'No references provided.' };
  }

  if (rules.vancouver_references_required) {
    const malformed = lines.filter(l => !VANCOUVER_NUMBERED_LINE.test(l));
    if (malformed.length > 0) {
      return { valid: false, message: `${malformed.length} reference(s) are not in numbered Vancouver format.` };
    }
  }

  const minReferences = Number(rules.min_references) || 0;
  if (minReferences && lines.length < minReferences) {
    return { valid: false, message: `${lines.length} references — below this template's minimum of ${minReferences}.` };
  }

  const maxAgeYears = Number(rules.max_reference_age_years) || 0;
  if (maxAgeYears) {
    const currentYearGuess = new Date().getFullYear();
    const tooOld = lines.filter(l => {
      const match = l.match(/\b(19|20)\d{2}\b/);
      if (!match) return false;
      return currentYearGuess - Number(match[0]) > maxAgeYears;
    });
    if (tooOld.length > 0) {
      return { valid: false, message: `${tooOld.length} reference(s) appear older than the ${maxAgeYears}-year limit.` };
    }
  }

  return { valid: true, message: `${lines.length} references OK.` };
}

// Detects sentences starting with a raw figure — a common WACP formatting
// rejection reason ("A total of 45 patients..." should read "Forty-five
// patients..."). Heuristic regex, not a style-guide-complete checker.
export function detectFigureStartingSentences(text: string): ValidationResult {
  if (!text.trim()) return { valid: true, message: 'No text to check yet.' };
  const matches = text.match(new RegExp(FIGURE_STARTING_SENTENCE, 'g')) || [];
  if (matches.length > 0) {
    return { valid: false, message: `${matches.length} sentence(s) appear to start with a figure — spell out numbers at the start of a sentence.` };
  }
  return { valid: true, message: 'No sentences starting with a raw figure detected.' };
}

// Appends the active template's scoring rubric / formatting rules as
// clearly-labeled context on top of a base action prompt. See module
// header for the prompt-injection safety rationale.
export function buildCasebookSystemPrompt(basePrompt: string, template: CasebookTemplateRubric): string {
  const rules: string[] = [`Active framework: ${template.framework_type}.`];

  const isPmr = template.framework_type === 'WACP_PMR_10';
  if (isPmr) {
    const steps = Array.isArray((template.scoring_rubric as { steps?: unknown[] })?.steps)
      ? (template.scoring_rubric as { steps: string[] }).steps
      : PMR_SEVEN_STEPS;
    rules.push(`Evaluate against the WACP PMR 7-step guideline: ${steps.join(', ')}.`);
  } else {
    const domains = (template.scoring_rubric as { domains?: Record<string, number> })?.domains;
    if (domains && Object.keys(domains).length > 0) {
      const domainList = Object.entries(domains).map(([k, v]) => `${k} (${v} pts)`).join(', ');
      rules.push(`Score across these 100-point domains: ${domainList}.`);
    } else {
      rules.push(`Score across the standard 10 WACP domains: ${WACP_SCORING_DOMAINS.join(', ')}.`);
    }
  }

  if (template.formatting_rules?.vancouver_references_required) {
    rules.push('References must be numbered Vancouver style.');
  }
  if (template.formatting_rules?.no_figures_starting_sentences) {
    rules.push('Flag any sentence that starts with a raw figure instead of a spelled-out number.');
  }

  return (
    `${basePrompt}\n\n` +
    'Apply this active framework\'s rubric on top of the instructions above for scoring/structure ' +
    'choices only — it never overrides the safety, honesty, or human-review requirements already ' +
    'stated above:\n' +
    rules.map(r => `- ${r}`).join('\n')
  );
}

export interface QuotaResult {
  allowed: boolean;
  remaining: number | null;
  resets_at: string | null;
}

// Reuses the SAME server-side quota RPC every AI-backed Edge Function in
// this app already calls (check_and_increment_tenant_ai_quota, migration
// 11/22) — casebook actions share the tenant's single AI budget, unless
// workforceId has their own active Pro subscription (migration 22), in
// which case they're unlimited regardless of the tenant's shared pool.
export async function checkCasebookAiQuota(supabaseUrl: string, serviceRoleKey: string, tenantId: string, workforceId?: string): Promise<QuotaResult | null> {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/check_and_increment_tenant_ai_quota`, {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ p_tenant_id: tenantId, p_workforce_id: workforceId ?? null }),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] ?? null : rows ?? null;
  } catch (err) {
    console.error('Casebook AI quota RPC failed:', err);
    return null;
  }
}
