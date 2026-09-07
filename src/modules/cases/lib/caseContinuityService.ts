import { supabase } from '../../../lib/databaseService';
import {
  normalizeContinuityActionLabel,
} from './caseContinuityDomain';

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

export type CaseContinuityActionType = 'follow_up' | 'procedure' | 'investigation' | 'result_review' | 'other';
export type CaseContinuityActionStatus = 'planned' | 'completed' | 'cancelled';
export type CaseContinuityResultStatus = 'not_expected' | 'awaiting' | 'available' | 'reviewed';

export interface CaseContinuityAction {
  id: string;
  case_capture_record_id: string;
  doctor_id: string;
  action_type: CaseContinuityActionType;
  planned_for: string | null;
  status: CaseContinuityActionStatus;
  completed_at: string | null;
  result_status: CaseContinuityResultStatus;
  safe_action_label: string;
  created_at: string;
  updated_at: string;
}

export interface CreateCaseContinuityActionInput {
  caseCaptureRecordId: string;
  doctorId: string;
  actionType: CaseContinuityActionType;
  plannedFor?: string | null;
  resultStatus?: CaseContinuityResultStatus;
  safeActionLabel: string;
}

export const caseContinuityService = {
  async listActionsForDoctor(doctorId: string): Promise<CaseContinuityAction[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_continuity_actions')
      .select('*')
      .eq('doctor_id', doctorId)
      .order('planned_for', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return (data || []) as CaseContinuityAction[];
  },

  async createAction(input: CreateCaseContinuityActionInput): Promise<CaseContinuityAction> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_continuity_actions')
      .insert([{
        case_capture_record_id: input.caseCaptureRecordId,
        doctor_id: input.doctorId,
        action_type: input.actionType,
        planned_for: input.plannedFor || null,
        result_status: input.resultStatus ?? 'not_expected',
        safe_action_label: normalizeContinuityActionLabel(input.safeActionLabel),
      }])
      .select()
      .single();

    if (error) throw error;
    return data as CaseContinuityAction;
  },

  async markCompleted(actionId: string): Promise<CaseContinuityAction> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_continuity_actions')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', actionId)
      .select()
      .single();

    if (error) throw error;
    return data as CaseContinuityAction;
  },

  async markCancelled(actionId: string): Promise<CaseContinuityAction> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_continuity_actions')
      .update({ status: 'cancelled', completed_at: null })
      .eq('id', actionId)
      .select()
      .single();

    if (error) throw error;
    return data as CaseContinuityAction;
  },

  async markResultAvailable(actionId: string): Promise<CaseContinuityAction> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_continuity_actions')
      .update({ result_status: 'available' })
      .eq('id', actionId)
      .select()
      .single();

    if (error) throw error;
    return data as CaseContinuityAction;
  },

  async markResultReviewed(actionId: string): Promise<CaseContinuityAction> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_continuity_actions')
      .update({ result_status: 'reviewed' })
      .eq('id', actionId)
      .select()
      .single();

    if (error) throw error;
    return data as CaseContinuityAction;
  },
};
