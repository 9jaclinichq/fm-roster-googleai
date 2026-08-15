// L5 Face for the L4 Scored Rubric primitive (see
// src/modules/shared/lib/scoredRubricEngine.ts and
// supabase/migrations/41_scored_rubric_primitive.sql).
//
// FIRST SLICE ONLY, per this task's explicit scope: render whatever
// sections/items the given template actually has (fully data-driven —
// nothing hardcoded, no section/item names read from this file), let an
// assessor enter a per-item score, submit, show the computed total.
//
// NOT INCLUDED (flagged as a followup, not silently skipped): a builder UI
// for authoring new rubric_templates/sections/items. This component only
// ever renders and fills in an EXISTING template — creating/editing
// templates is a separate, later piece of work.
//
// Deliberately has no opinion on how it's wired into a page — a caller
// passes templateId + a SupabaseClient + an already-created instanceId (or
// this component creates one itself if none is given, via
// createRubricInstance) plus optional assessor/tenant/subjectRef context.
// No domain-specific styling or copy of any kind.

import React, { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  RubricTemplateWithStructure,
  RubricInstance,
  RubricSectionTotal,
  getRubricTemplate,
  createRubricInstance,
  submitRubricScores,
} from '../lib/scoredRubricEngine';

export interface RubricInstanceFormProps {
  supabaseClient: SupabaseClient;
  rubricTemplateId: string;
  /** An existing draft instance to resume, if any. If omitted, a new
   *  instance is created on mount using the props below. */
  instanceId?: string;
  tenantId?: string | null;
  subjectRef?: string | null;
  assessorWorkforceId?: string | null;
  assessorDoctorId?: string | null;
  /** Called once the instance has been submitted and scored. */
  onScored?: (instance: RubricInstance) => void;
}

/**
 * Renders every section and item of a rubric_templates row (fetched live —
 * nothing about the shape is assumed ahead of time), collects a numeric
 * score per item within that item's own scale_min/scale_max, and on submit
 * writes the scores + runs compute_rubric_totals() (via
 * submitRubricScores()) and displays the resulting final score and
 * per-section pass/fail.
 */
export const RubricInstanceForm: React.FC<RubricInstanceFormProps> = ({
  supabaseClient,
  rubricTemplateId,
  instanceId,
  tenantId = null,
  subjectRef = null,
  assessorWorkforceId = null,
  assessorDoctorId = null,
  onScored,
}) => {
  const [template, setTemplate] = useState<RubricTemplateWithStructure | null>(null);
  const [instance, setInstance] = useState<RubricInstance | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scored, setScored] = useState<RubricInstance | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const fetchedTemplate = await getRubricTemplate(supabaseClient, rubricTemplateId);
        if (!fetchedTemplate) {
          throw new Error('Rubric template not found.');
        }

        let activeInstance: RubricInstance | null = null;
        if (instanceId) {
          const { data, error: instErr } = await supabaseClient
            .from('rubric_instances')
            .select('*')
            .eq('id', instanceId)
            .maybeSingle();
          if (instErr) throw instErr;
          activeInstance = (data as RubricInstance) ?? null;
        }
        if (!activeInstance) {
          activeInstance = await createRubricInstance(supabaseClient, {
            rubricTemplateId,
            tenantId,
            subjectRef,
            assessorWorkforceId,
            assessorDoctorId,
          });
        }

        if (cancelled) return;
        setTemplate(fetchedTemplate);
        setInstance(activeInstance);
        setScores((activeInstance.scores as Record<string, number>) ?? {});
        if (activeInstance.status === 'scored' || activeInstance.status === 'confirmed') {
          setScored(activeInstance);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load rubric.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubricTemplateId, instanceId]);

  const handleScoreChange = (itemId: string, value: number) => {
    setScores((prev) => ({ ...prev, [itemId]: value }));
  };

  const handleSubmit = async () => {
    if (!instance) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitRubricScores(supabaseClient, instance.id, scores);
      setScored(result);
      setInstance(result);
      onScored?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit rubric scores.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-slate-500 p-4">Loading rubric...</div>;
  }

  if (error && !template) {
    return <div className="text-sm text-red-600 p-4">{error}</div>;
  }

  if (!template) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{template.name}</h2>
        {template.description && <p className="text-sm text-slate-500 mt-1">{template.description}</p>}
      </div>

      {template.sections.map((section) => (
        <div key={section.id} className="border border-slate-200 rounded-xl p-4 space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-800">{section.name}</h3>
            {section.max_points != null && (
              <span className="text-xs text-slate-400">Max {section.max_points} pts</span>
            )}
          </div>

          {section.items.map((item) => (
            <div key={item.id} className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <label htmlFor={`rubric-item-${item.id}`} className="text-sm text-slate-700 block">
                  {item.label}
                </label>
                {item.guidance_text && (
                  <p className="text-xs text-slate-400 mt-0.5">{item.guidance_text}</p>
                )}
              </div>
              <input
                id={`rubric-item-${item.id}`}
                type="number"
                min={item.scale_min}
                max={item.scale_max}
                step="1"
                disabled={!!scored}
                value={scores[item.id] ?? ''}
                onChange={(e) => handleScoreChange(item.id, Number(e.target.value))}
                className="w-20 border border-slate-300 rounded-lg px-2 py-1 text-sm text-right disabled:bg-slate-50 disabled:text-slate-400"
              />
            </div>
          ))}
        </div>
      ))}

      {error && <div className="text-sm text-red-600">{error}</div>}

      {!scored ? (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'Submit for scoring'}
        </button>
      ) : (
        <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 space-y-2">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-slate-800">Final score</span>
            <span className="text-lg font-bold text-slate-900">{scored.final_score ?? '-'}</span>
          </div>
          {scored.recommendation && (
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Recommendation: <span className="font-semibold text-slate-700">{scored.recommendation}</span>
            </div>
          )}
          <div className="space-y-1 pt-2">
            {Object.entries(scored.section_totals ?? {}).map(([sectionId, total]: [string, RubricSectionTotal]) => (
              <div key={sectionId} className="flex items-center justify-between text-xs">
                <span className="text-slate-600">{total.section_name}</span>
                <span className={total.passed ? 'text-emerald-600' : 'text-amber-600'}>
                  {total.score}
                  {total.max_points != null ? ` / ${total.max_points}` : ''}
                  {total.flagged_zero_required_item ? ' - flagged' : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
