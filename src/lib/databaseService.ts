import { createClient } from '@supabase/supabase-js';
import {
  WorkforceMember,
  Collection,
  Submission,
  Settings,
  SubmissionWithWorkforce,
  Role,
  UserRole,
  Rotation,
  FileUpload,
  Announcement,
  AnnouncementRead,
} from '../types';

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

// Columns safe to return from the general workforce listing. `resident_code`
// is deliberately excluded — that column is locked down at the database
// level (see supabase/migrations/01_rbac_and_rotations.sql) and only ever
// returned by the chief_* RPCs below, which re-verify the admin code first.
const WORKFORCE_PUBLIC_COLUMNS = 'id, full_name, category, active, created_at';

export const databaseService = {
  isMock: false, // Always false as the app must read only from Supabase.

  // --- WORKFORCE SERVICES ---
  async getWorkforce(): Promise<WorkforceMember[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('workforce')
      .select(WORKFORCE_PUBLIC_COLUMNS)
      .order('full_name', { ascending: true });

    if (error) {
      console.warn('Error fetching workforce:', error);
      throw error;
    }
    return (data || []) as unknown as WorkforceMember[];
  },

  // Adds a new resident with a server-generated, unique 6-digit code.
  // `adminCode` is re-verified server-side before the insert happens.
  async addWorkforceMember(adminCode: string, member: { full_name: string; category: string }): Promise<WorkforceMember> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_add_workforce_member', {
      p_admin_code: adminCode,
      p_full_name: member.full_name,
      p_category: member.category,
    });

    if (error) {
      console.warn('Error adding workforce member:', error);
      throw error;
    }
    return (Array.isArray(data) ? data[0] : data) as WorkforceMember;
  },

  // Updates non-code fields only (full_name, category, active). Resident
  // code changes must go through resetResidentAccessCode().
  async updateWorkforceMember(id: string, updates: Partial<Pick<WorkforceMember, 'full_name' | 'category' | 'active'>>): Promise<WorkforceMember> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('workforce')
      .update(updates)
      .eq('id', id)
      .select(WORKFORCE_PUBLIC_COLUMNS)
      .single();

    if (error) {
      console.warn('Error updating workforce member:', error);
      throw error;
    }
    return data as unknown as WorkforceMember;
  },

  // Regenerates a resident's access code server-side. Returns the new code
  // so the Chief can relay it to the resident.
  async resetResidentAccessCode(adminCode: string, workforceId: string): Promise<string> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_reset_resident_code', {
      p_admin_code: adminCode,
      p_workforce_id: workforceId,
    });

    if (error) {
      console.warn('Error resetting resident access code:', error);
      throw error;
    }
    return data as string;
  },

  // Bulk-fetches every resident's code for the Chief Dashboard registry
  // view. Requires the already-verified admin code.
  async getWorkforceCodes(adminCode: string): Promise<Record<string, string>> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_get_workforce_codes', {
      p_admin_code: adminCode,
    });

    if (error) {
      console.warn('Error fetching workforce codes:', error);
      throw error;
    }

    const map: Record<string, string> = {};
    for (const row of (data || []) as { id: string; resident_code: string }[]) {
      map[row.id] = row.resident_code;
    }
    return map;
  },

  // --- AUTHENTICATION (server-side code verification) ---
  async verifyResidentLogin(workforceId: string, code: string): Promise<{ id: string; full_name: string; category: string } | null> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('verify_resident_login', {
      p_workforce_id: workforceId,
      p_code: code,
    });

    if (error) {
      console.warn('Error verifying resident login:', error);
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  },

  async verifyChiefLogin(code: string): Promise<boolean> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('verify_chief_login', { p_code: code });

    if (error) {
      console.warn('Error verifying chief login:', error);
      throw error;
    }
    return !!data;
  },

  async updateAdminCode(currentAdminCode: string, newCode: string): Promise<boolean> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_update_admin_code', {
      p_admin_code: currentAdminCode,
      p_new_code: newCode,
    });

    if (error) {
      console.warn('Error updating admin code:', error);
      throw error;
    }
    return !!data;
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
  // Note: admin_access_code is never selected here — see updateAdminCode()
  // and verifyChiefLogin() for the only supported ways to touch that column.
  async getSettings(): Promise<Settings> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('settings')
      .select('id, current_collection_id')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching settings:', error);
      throw error;
    }

    if (!data) {
      // Default fallback settings insert if table is blank
      const defaultSettings = { id: 1, current_collection_id: null };
      const { data: inserted, error: insertErr } = await supabase!
        .from('settings')
        .insert([defaultSettings])
        .select('id, current_collection_id')
        .single();

      if (insertErr) {
        return defaultSettings;
      }
      return inserted;
    }

    return data;
  },

  async updateSettings(updates: Partial<Pick<Settings, 'current_collection_id'>>): Promise<Settings> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('settings')
      .update(updates)
      .eq('id', 1)
      .select('id, current_collection_id')
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

    // Record metadata alongside the storage object. Best-effort: a failure
    // here shouldn't fail the upload itself, since the file is already saved.
    try {
      await this.recordFileUpload({
        file_name: file.name,
        storage_path: filePath,
        workforce_id: workforceId,
        submission_id: null,
        mime_type: file.type || null,
        file_size: file.size,
      });
    } catch (metaErr) {
      console.warn('Failed to record file_uploads metadata:', metaErr);
    }

    return publicUrlData.publicUrl;
  },

  async recordFileUpload(entry: {
    file_name: string;
    storage_path: string;
    workforce_id?: string | null;
    submission_id?: string | null;
    mime_type?: string | null;
    file_size?: number | null;
  }): Promise<FileUpload> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('file_uploads')
      .insert([entry])
      .select()
      .single();

    if (error) {
      console.warn('Error recording file upload metadata:', error);
      throw error;
    }
    return data;
  },

  async getFileUploads(submissionId: string): Promise<FileUpload[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('file_uploads')
      .select('*')
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching file uploads:', error);
      throw error;
    }
    return data || [];
  },

  // --- ROLES / RBAC ---
  async getRoles(): Promise<Role[]> {
    checkSupabase();

    const { data, error } = await supabase!.from('roles').select('*');
    if (error) {
      console.warn('Error fetching roles:', error);
      throw error;
    }
    return data || [];
  },

  async getUserRolesForWorkforce(workforceId: string): Promise<UserRole[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('user_roles')
      .select('*')
      .eq('workforce_id', workforceId);

    if (error) {
      console.warn('Error fetching user roles:', error);
      throw error;
    }
    return data || [];
  },

  // --- ROTATIONS ---
  async getRotations(): Promise<Rotation[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('rotations')
      .select('*')
      .eq('active', true)
      .order('name', { ascending: true });

    if (error) {
      console.warn('Error fetching rotations:', error);
      throw error;
    }
    return data || [];
  },

  async addRotation(name: string, department?: string): Promise<Rotation> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('rotations')
      .insert([{ name, department: department || null }])
      .select()
      .single();

    if (error) {
      console.warn('Error adding rotation:', error);
      throw error;
    }
    return data;
  },

  // --- ANNOUNCEMENTS ---
  async getAnnouncements(): Promise<Announcement[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('announcements')
      .select('*')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching announcements:', error);
      throw error;
    }
    return data || [];
  },

  async createAnnouncement(entry: {
    title: string;
    body: string;
    category: Announcement['category'];
    pinned?: boolean;
    created_by_workforce_id?: string | null;
  }): Promise<Announcement> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('announcements')
      .insert([{ pinned: false, ...entry }])
      .select()
      .single();

    if (error) {
      console.warn('Error creating announcement:', error);
      throw error;
    }
    return data;
  },

  async updateAnnouncement(id: string, updates: Partial<Pick<Announcement, 'title' | 'body' | 'category' | 'pinned'>>): Promise<Announcement> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('announcements')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating announcement:', error);
      throw error;
    }
    return data;
  },

  async markAnnouncementRead(announcementId: string, workforceId: string): Promise<AnnouncementRead> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('announcement_reads')
      .upsert([{ announcement_id: announcementId, workforce_id: workforceId }], {
        onConflict: 'announcement_id,workforce_id',
      })
      .select()
      .single();

    if (error) {
      console.warn('Error recording announcement read receipt:', error);
      throw error;
    }
    return data;
  },

  async getAnnouncementReadsForWorkforce(workforceId: string): Promise<AnnouncementRead[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('announcement_reads')
      .select('*')
      .eq('workforce_id', workforceId);

    if (error) {
      console.warn('Error fetching announcement read receipts:', error);
      throw error;
    }
    return data || [];
  },
};
