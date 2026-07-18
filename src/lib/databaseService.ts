import { createClient } from '@supabase/supabase-js';
import { WorkforceMember, Collection, Submission, Settings, SubmissionWithWorkforce } from '../types';

// Read from import.meta.env
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Initialize Supabase client
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

console.log(`[FM Residents Dashboard] Live Supabase service initialized. Connected: ${!!supabase}`);

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

export const databaseService = {
  isMock: false, // Always false as the app must read only from Supabase.

  // --- WORKFORCE SERVICES ---
  async getWorkforce(): Promise<WorkforceMember[]> {
    checkSupabase();
    
    const { data, error } = await supabase!
      .from('workforce')
      .select('*')
      .order('full_name', { ascending: true });
    
    if (error) {
      console.warn('Error fetching workforce:', error);
      throw error;
    }
    return data || [];
  },

  async addWorkforceMember(member: Omit<WorkforceMember, 'id' | 'created_at' | 'active'>): Promise<WorkforceMember> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('workforce')
      .insert([{ ...member, active: true }])
      .select()
      .single();

    if (error) {
      console.warn('Error adding workforce member:', error);
      throw error;
    }
    return data;
  },

  async updateWorkforceMember(id: string, updates: Partial<WorkforceMember>): Promise<WorkforceMember> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('workforce')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating workforce member:', error);
      throw error;
    }
    return data;
  },

  async resetResidentAccessCode(id: string, newCode: string): Promise<WorkforceMember> {
    return this.updateWorkforceMember(id, { resident_code: newCode });
  },

  // --- COLLECTIONS SERVICES ---
  async getCollections(): Promise<Collection[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('collections')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching collections:', error);
      throw error;
    }
    return data || [];
  },

  async createCollection(title: string, deadline: string): Promise<Collection> {
    checkSupabase();

    // 1. Close current collections
    await supabase!
      .from('collections')
      .update({ status: 'closed' })
      .eq('status', 'open');

    // 2. Create new open collection
    const { data: newColl, error: err1 } = await supabase!
      .from('collections')
      .insert([{ title, deadline, status: 'open' }])
      .select()
      .single();

    if (err1) {
      console.warn('Error creating collection:', err1);
      throw err1;
    }

    // 3. Update settings
    const { error: err2 } = await supabase!
      .from('settings')
      .update({ current_collection_id: newColl.id })
      .eq('id', 1);

    if (err2) {
      await supabase!
        .from('settings')
        .insert([{ id: 1, current_collection_id: newColl.id }]);
    }

    return newColl;
  },

  async updateCollectionStatus(id: string, status: 'open' | 'closed'): Promise<Collection> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('collections')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating collection status:', error);
      throw error;
    }
    return data;
  },

  async updateCollectionDeadline(id: string, deadline: string): Promise<Collection> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('collections')
      .update({ deadline })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating collection deadline:', error);
      throw error;
    }
    return data;
  },

  // --- SUBMISSIONS SERVICES ---
  async getSubmissions(collectionId?: string): Promise<SubmissionWithWorkforce[]> {
    checkSupabase();

    let query = supabase!
      .from('submissions')
      .select('*, workforce(full_name, category)');
    
    if (collectionId) {
      query = query.eq('collection_id', collectionId);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('Error fetching submissions:', error);
      throw error;
    }

    return (data || []) as unknown as SubmissionWithWorkforce[];
  },

  async getSubmissionForWorkforceAndCollection(workforceId: string, collectionId: string): Promise<Submission | null> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('submissions')
      .select('*')
      .eq('workforce_id', workforceId)
      .eq('collection_id', collectionId)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching submission details:', error);
      throw error;
    }
    return data;
  },

  async submitRoster(submission: Omit<Submission, 'id' | 'created_at' | 'updated_at'>): Promise<Submission> {
    checkSupabase();

    // First check if submission exists to prevent duplicate keys
    const { data: existing } = await supabase!
      .from('submissions')
      .select('id')
      .eq('workforce_id', submission.workforce_id)
      .eq('collection_id', submission.collection_id)
      .maybeSingle();

    if (existing) {
      const { data, error } = await supabase!
        .from('submissions')
        .update({
          ...submission,
          updated_at: new Date().toISOString()
        })
        .eq('id', existing.id)
        .select()
        .single();
      
      if (error) {
        console.warn('Error updating existing submission:', error);
        throw error;
      }
      return data;
    } else {
      const { data, error } = await supabase!
        .from('submissions')
        .insert([{
          ...submission,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }])
        .select()
        .single();
      
      if (error) {
        console.warn('Error inserting new submission:', error);
        throw error;
      }
      return data;
    }
  },

  async updateSubmissionDirectly(id: string, updates: Partial<Submission>): Promise<Submission> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('submissions')
      .update({
        ...updates,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating submission directly:', error);
      throw error;
    }
    return data;
  },

  // --- SETTINGS SERVICES ---
  async getSettings(): Promise<Settings> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching settings:', error);
      throw error;
    }

    if (!data) {
      // Default fallback settings insert if table is blank
      const defaultSettings = { id: 1, admin_access_code: '999999', current_collection_id: null };
      const { data: inserted, error: insertErr } = await supabase!
        .from('settings')
        .insert([defaultSettings])
        .select()
        .single();
      
      if (insertErr) {
        return defaultSettings;
      }
      return inserted;
    }

    return data;
  },

  async updateSettings(updates: Partial<Settings>): Promise<Settings> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('settings')
      .update(updates)
      .eq('id', 1)
      .select()
      .single();

    if (error) {
      console.warn('Error updating settings:', error);
      throw error;
    }
    return data;
  },

  // --- FILE UPLOADS ---
  async uploadLeaveDocument(workforceId: string, file: File): Promise<string> {
    checkSupabase();

    const fileExt = file.name.split('.').pop();
    const fileName = `${workforceId}/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;
    const filePath = `${fileName}`;

    const { data, error } = await supabase!.storage
      .from('leave-documents')
      .upload(filePath, file);

    if (error) {
      console.warn('Storage upload failed:', error);
      throw error;
    }

    const { data: publicUrlData } = supabase!.storage
      .from('leave-documents')
      .getPublicUrl(filePath);

    return publicUrlData.publicUrl;
  }
};
