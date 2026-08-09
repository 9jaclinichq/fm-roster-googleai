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
  Dissertation,
  DissertationStage,
  DissertationMilestone,
  MilestoneStatus,
  KnowledgePack,
  KnowledgePackCategory,
  CaseReport,
  ExamReadiness,
  VivaSimulation,
  ScoringBreakdown,
  ConsultantReview,
  ReviewTargetType,
  ReviewStatus,
  SubadminRoleId,
  DelegatedRole,
  DissertationMilestoneWithContext,
  CaseReportWithWorkforce,
  KnowledgePackItem,
  AiActionType,
  AiActionLog,
  ActivityMatrixDay,
  ComplianceNudge,
  DerivedNudge,
  RosterType,
  RosterTypeId,
  RawRosterUpload,
  CombinedMasterRoster,
  MasterRosterStatus,
  Tenant,
  TenantPlanType,
  CallDutyRule,
  TenantAiAdaptationRule,
  TenantAiQuota,
  PlatformOperator,
  GuestInvitedAs,
  GuestReviewInvite,
  GuestReviewInvitePublic,
  ResearchTemplate,
  ResearchWorkspace,
  ResearchWorkspaceStatus,
  ResearchChapter,
  ResearchChapterType,
  ResearchCorrectionLog,
  ResearchCorrectionSource,
  ResearchCorrectionStatus,
} from '../types';
import { buildDefaultFolderTree } from './research/folderStructure';

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
const WORKFORCE_PUBLIC_COLUMNS = 'id, full_name, category, active, on_floor, tenant_id, created_at';

// Fixed id of the UCH Family Medicine seed tenant (migration 11) — the
// only tenant that exists today. Used as a fallback default; components
// should prefer reading a real tenant_id from session/context once
// tenant-aware login exists.
export const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';

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

  // Updates non-code fields only (full_name, category, active, on_floor).
  // Resident code changes must go through resetResidentAccessCode().
  async updateWorkforceMember(id: string, updates: Partial<Pick<WorkforceMember, 'full_name' | 'category' | 'active' | 'on_floor'>>): Promise<WorkforceMember> {
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

  // --- DISSERTATION ASSISTANT ---
  async getDissertationForWorkforce(workforceId: string): Promise<Dissertation | null> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('dissertations')
      .select('*')
      .eq('workforce_id', workforceId)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching dissertation:', error);
      throw error;
    }
    return data;
  },

  async createDissertation(workforceId: string, title: string, supervisorName?: string): Promise<Dissertation> {
    checkSupabase();

    // The seed_dissertation_milestones trigger auto-populates one milestone
    // row per WACP stage as soon as this insert commits.
    const { data, error } = await supabase!
      .from('dissertations')
      .insert([{ workforce_id: workforceId, title, supervisor_name: supervisorName || null }])
      .select()
      .single();

    if (error) {
      console.warn('Error creating dissertation:', error);
      throw error;
    }
    return data;
  },

  async updateDissertationStage(id: string, stage: DissertationStage): Promise<Dissertation> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('dissertations')
      .update({ stage })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating dissertation stage:', error);
      throw error;
    }
    return data;
  },

  async getDissertationMilestones(dissertationId: string): Promise<DissertationMilestone[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('dissertation_milestones')
      .select('*')
      .eq('dissertation_id', dissertationId);

    if (error) {
      console.warn('Error fetching dissertation milestones:', error);
      throw error;
    }
    return data || [];
  },

  async updateMilestone(id: string, updates: { status?: MilestoneStatus; document_url?: string | null; supervisor_feedback?: string | null }): Promise<DissertationMilestone> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('dissertation_milestones')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating milestone:', error);
      throw error;
    }
    return data;
  },

  async uploadDissertationDocument(workforceId: string, milestoneId: string, file: File): Promise<string> {
    checkSupabase();

    const fileExt = file.name.split('.').pop();
    const filePath = `dissertations/${workforceId}/${milestoneId}_${Date.now()}.${fileExt}`;

    const { error } = await supabase!.storage.from('academic-documents').upload(filePath, file);
    if (error) {
      console.warn('Dissertation document upload failed:', error);
      throw error;
    }

    const { data: publicUrlData } = supabase!.storage.from('academic-documents').getPublicUrl(filePath);
    return publicUrlData.publicUrl;
  },

  // --- KNOWLEDGE LIBRARY ---
  async getKnowledgePacks(category?: KnowledgePackCategory): Promise<KnowledgePack[]> {
    checkSupabase();

    let query = supabase!.from('knowledge_packs').select('*').order('created_at', { ascending: false });
    if (category) {
      query = query.eq('category', category);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('Error fetching knowledge packs:', error);
      throw error;
    }
    return data || [];
  },

  async createKnowledgePack(entry: {
    title: string;
    category: KnowledgePackCategory;
    file_url: string;
    description?: string | null;
    tags?: string[];
  }): Promise<KnowledgePack> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('knowledge_packs')
      .insert([{ tags: [], ...entry }])
      .select()
      .single();

    if (error) {
      console.warn('Error creating knowledge pack:', error);
      throw error;
    }
    return data;
  },

  // --- CASEBOOK BUILDER ---
  async getCaseReports(workforceId: string): Promise<CaseReport[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_reports')
      .select('*')
      .eq('workforce_id', workforceId)
      .order('case_number', { ascending: true });

    if (error) {
      console.warn('Error fetching case reports:', error);
      throw error;
    }
    return data || [];
  },

  async upsertCaseReport(
    workforceId: string,
    caseNumber: number,
    updates: Partial<Pick<CaseReport, 'patient_initials' | 'diagnosis' | 'category' | 'status' | 'document_url'>>
  ): Promise<CaseReport> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_reports')
      .upsert([{ workforce_id: workforceId, case_number: caseNumber, ...updates }], {
        onConflict: 'workforce_id,case_number',
      })
      .select()
      .single();

    if (error) {
      console.warn('Error saving case report:', error);
      throw error;
    }
    return data;
  },

  async uploadCaseDocument(workforceId: string, caseNumber: number, file: File): Promise<string> {
    checkSupabase();

    const fileExt = file.name.split('.').pop();
    const filePath = `case-reports/${workforceId}/case-${caseNumber}_${Date.now()}.${fileExt}`;

    const { error } = await supabase!.storage.from('academic-documents').upload(filePath, file);
    if (error) {
      console.warn('Case report document upload failed:', error);
      throw error;
    }

    const { data: publicUrlData } = supabase!.storage.from('academic-documents').getPublicUrl(filePath);
    return publicUrlData.publicUrl;
  },

  // --- EXAM READINESS ---
  async getOrCreateExamReadiness(workforceId: string): Promise<ExamReadiness> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('exam_readiness')
      .select('*')
      .eq('workforce_id', workforceId)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching exam readiness:', error);
      throw error;
    }
    if (data) return data;

    const { data: created, error: createErr } = await supabase!
      .from('exam_readiness')
      .insert([{ workforce_id: workforceId }])
      .select()
      .single();

    if (createErr) {
      console.warn('Error creating exam readiness record:', createErr);
      throw createErr;
    }
    return created;
  },

  async upsertExamReadiness(
    workforceId: string,
    updates: Partial<Pick<ExamReadiness, 'evidemy_completed_count' | 'evidemy_total_required' | 'physical_logbook_verified' | 'exam_fees_paid' | 'college_forms_submitted'>>
  ): Promise<ExamReadiness> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('exam_readiness')
      .upsert([{ workforce_id: workforceId, ...updates }], { onConflict: 'workforce_id' })
      .select()
      .single();

    if (error) {
      console.warn('Error updating exam readiness:', error);
      throw error;
    }
    return data;
  },

  // --- MOCK VIVA ORAL EXAM SIMULATOR ---
  async createVivaSimulation(entry: {
    workforce_id: string;
    case_title: string;
    category?: string | null;
    duration_seconds?: number | null;
    scoring_breakdown: ScoringBreakdown;
    feedback_summary?: string | null;
  }): Promise<VivaSimulation> {
    checkSupabase();

    // The sync_oral_practice_score trigger recomputes exam_readiness's
    // running average as soon as this insert commits.
    const { data, error } = await supabase!
      .from('viva_simulations')
      .insert([entry])
      .select()
      .single();

    if (error) {
      console.warn('Error recording viva simulation:', error);
      throw error;
    }
    return data;
  },

  async getVivaSimulations(workforceId: string): Promise<VivaSimulation[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('viva_simulations')
      .select('*')
      .eq('workforce_id', workforceId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching viva simulations:', error);
      throw error;
    }
    return data || [];
  },

  // --- SUBADMIN ROLE DELEGATION (Chief-only, admin-code gated) ---
  async getDelegatedRoles(): Promise<DelegatedRole[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('user_roles')
      .select('*, workforce(full_name, category)')
      .in('role_id', ['hod', 'rtc', 'cme_coord', 'consultant'])
      .order('role_id', { ascending: true });

    if (error) {
      console.warn('Error fetching delegated roles:', error);
      throw error;
    }
    return (data || []) as unknown as DelegatedRole[];
  },

  async assignUserRole(adminCode: string, workforceId: string, roleId: SubadminRoleId): Promise<void> {
    checkSupabase();

    const { error } = await supabase!.rpc('chief_assign_user_role', {
      p_admin_code: adminCode,
      p_workforce_id: workforceId,
      p_role_id: roleId,
    });

    if (error) {
      console.warn('Error assigning role:', error);
      throw error;
    }
  },

  async removeUserRole(adminCode: string, userRoleId: string): Promise<boolean> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('chief_remove_user_role', {
      p_admin_code: adminCode,
      p_user_role_id: userRoleId,
    });

    if (error) {
      console.warn('Error removing role:', error);
      throw error;
    }
    return !!data;
  },

  // --- CONSULTANT HITL REVIEW WORKSPACE ---
  async getPendingDissertationMilestones(): Promise<DissertationMilestoneWithContext[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('dissertation_milestones')
      .select('*, dissertations(title, workforce_id, workforce(full_name, category))')
      .eq('status', 'in_review')
      .order('updated_at', { ascending: true });

    if (error) {
      console.warn('Error fetching pending dissertation milestones:', error);
      throw error;
    }
    return (data || []) as unknown as DissertationMilestoneWithContext[];
  },

  async getPendingCaseReports(): Promise<CaseReportWithWorkforce[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_reports')
      .select('*, workforce(full_name, category)')
      .eq('status', 'pending_supervisor')
      .order('updated_at', { ascending: true });

    if (error) {
      console.warn('Error fetching pending case reports:', error);
      throw error;
    }
    return (data || []) as unknown as CaseReportWithWorkforce[];
  },

  // Single-row fetches for the guest review page — reuses the same
  // permissive SELECT policies dissertation_milestones/case_reports
  // already have (see migrations 04/07), joined the same way as the
  // pending-review queues above.
  async getDissertationMilestoneById(id: string): Promise<DissertationMilestoneWithContext | null> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('dissertation_milestones')
      .select('*, dissertations(title, workforce_id, workforce(full_name, category))')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching dissertation milestone:', error);
      throw error;
    }
    return data as unknown as DissertationMilestoneWithContext | null;
  },

  async getCaseReportById(id: string): Promise<CaseReportWithWorkforce | null> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('case_reports')
      .select('*, workforce(full_name, category)')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching case report:', error);
      throw error;
    }
    return data as unknown as CaseReportWithWorkforce | null;
  },

  async submitConsultantReview(
    reviewerWorkforceId: string,
    targetType: ReviewTargetType,
    targetId: string,
    status: ReviewStatus,
    feedbackNotes: string
  ): Promise<ConsultantReview> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('submit_consultant_review', {
      p_reviewer_workforce_id: reviewerWorkforceId,
      p_target_type: targetType,
      p_target_id: targetId,
      p_status: status,
      p_feedback_notes: feedbackNotes || null,
    });

    if (error) {
      console.warn('Error submitting consultant review:', error);
      throw error;
    }
    return data;
  },

  // --- KNOWLEDGE PACK ITEMS (manager UI + search) ---
  async getKnowledgePackItems(packId: string): Promise<KnowledgePackItem[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('knowledge_pack_items')
      .select('*')
      .eq('pack_id', packId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching knowledge pack items:', error);
      throw error;
    }
    return data || [];
  },

  async createKnowledgePackItem(entry: {
    pack_id: string;
    title: string;
    document_url?: string | null;
    extracted_text_content?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<KnowledgePackItem> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('knowledge_pack_items')
      .insert([{ metadata: {}, ...entry }])
      .select()
      .single();

    if (error) {
      console.warn('Error creating knowledge pack item:', error);
      throw error;
    }
    return data;
  },

  async uploadKnowledgePackDocument(packId: string, file: File): Promise<string> {
    checkSupabase();

    const fileExt = file.name.split('.').pop();
    const filePath = `knowledge-packs/${packId}/${Date.now()}_${file.name}.${fileExt}`;

    const { error } = await supabase!.storage.from('academic-documents').upload(filePath, file);
    if (error) {
      console.warn('Knowledge pack document upload failed:', error);
      throw error;
    }

    const { data: publicUrlData } = supabase!.storage.from('academic-documents').getPublicUrl(filePath);
    return publicUrlData.publicUrl;
  },

  // Lexical full-text search (Postgres tsvector/GIN) over indexed knowledge
  // pack items — see migration 08's header for why this is keyword
  // retrieval, not embedding-based semantic search.
  async searchKnowledgePackItems(query: string): Promise<KnowledgePackItem[]> {
    checkSupabase();
    if (!query.trim()) return [];

    const { data, error } = await supabase!
      .from('knowledge_pack_items')
      .select('*')
      .textSearch('search_vector', query, { type: 'websearch', config: 'english' })
      .limit(10);

    if (error) {
      console.warn('Error searching knowledge pack items:', error);
      throw error;
    }
    return data || [];
  },

  // --- AI ACTION LOGGING ---
  async logAiAction(
    workforceId: string,
    actionType: AiActionType,
    inputSummary: string,
    outputResult: Record<string, unknown>
  ): Promise<AiActionLog> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('ai_action_logs')
      .insert([{
        workforce_id: workforceId,
        action_type: actionType,
        input_summary: inputSummary.slice(0, 500),
        output_result: outputResult,
      }])
      .select()
      .single();

    if (error) {
      console.warn('Error logging AI action:', error);
      throw error;
    }
    return data;
  },

  // --- ACTIVITY GRAPH ---
  async getResidentActivityMatrix(workforceId: string): Promise<ActivityMatrixDay[]> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('get_resident_activity_matrix', { p_workforce_id: workforceId });

    if (error) {
      console.warn('Error fetching activity matrix:', error);
      throw error;
    }
    return data || [];
  },

  // --- COMPLIANCE NUDGES ---
  async getComplianceNudges(workforceId: string): Promise<ComplianceNudge[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('compliance_nudges')
      .select('*')
      .eq('workforce_id', workforceId);

    if (error) {
      console.warn('Error fetching compliance nudges:', error);
      throw error;
    }
    return data || [];
  },

  // Reconciles the persisted compliance_nudges rows with the currently-
  // applicable set computed client-side: upserts nudges that still apply
  // (leaving `resolved` untouched on conflict, since it isn't in the
  // payload), and deletes rows whose condition no longer holds.
  async syncComplianceNudges(workforceId: string, derived: DerivedNudge[]): Promise<ComplianceNudge[]> {
    checkSupabase();

    const existing = await this.getComplianceNudges(workforceId);
    const derivedTypes = new Set(derived.map(d => d.nudge_type));
    const staleIds = existing.filter(e => !derivedTypes.has(e.nudge_type)).map(e => e.id);

    if (staleIds.length > 0) {
      const { error: deleteError } = await supabase!.from('compliance_nudges').delete().in('id', staleIds);
      if (deleteError) console.warn('Error deleting stale nudges:', deleteError);
    }

    if (derived.length > 0) {
      const { error } = await supabase!
        .from('compliance_nudges')
        .upsert(
          derived.map(d => ({ workforce_id: workforceId, ...d })),
          { onConflict: 'workforce_id,nudge_type' }
        );
      if (error) {
        console.warn('Error syncing compliance nudges:', error);
        throw error;
      }
    }

    return this.getComplianceNudges(workforceId);
  },

  async resolveComplianceNudge(nudgeId: string): Promise<ComplianceNudge> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('compliance_nudges')
      .update({ resolved: true })
      .eq('id', nudgeId)
      .select()
      .single();

    if (error) {
      console.warn('Error resolving compliance nudge:', error);
      throw error;
    }
    return data;
  },

  // --- MULTI-ROSTER ENGINE ---
  async getRosterTypes(): Promise<RosterType[]> {
    checkSupabase();

    const { data, error } = await supabase!.from('roster_types').select('*');
    if (error) {
      console.warn('Error fetching roster types:', error);
      throw error;
    }
    return data || [];
  },

  async createRawRosterUpload(entry: {
    month: number;
    year: number;
    roster_type_id: RosterTypeId;
    file_name?: string | null;
    file_url?: string | null;
    raw_text_content?: string | null;
    parsed_data?: Record<string, unknown>;
    uploaded_by_workforce_id?: string | null;
  }): Promise<RawRosterUpload> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('raw_roster_uploads')
      .insert([{ parsed_data: {}, ...entry }])
      .select()
      .single();

    if (error) {
      console.warn('Error recording roster upload:', error);
      throw error;
    }
    return data;
  },

  async getLatestRosterUpload(rosterTypeId: RosterTypeId, month: number, year: number): Promise<RawRosterUpload | null> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('raw_roster_uploads')
      .select('*')
      .eq('roster_type_id', rosterTypeId)
      .eq('month', month)
      .eq('year', year)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching latest roster upload:', error);
      throw error;
    }
    return data;
  },

  async uploadRosterDocument(file: File): Promise<string> {
    checkSupabase();

    const fileExt = file.name.split('.').pop();
    const filePath = `roster-uploads/${Date.now()}_${file.name}.${fileExt}`;

    const { error } = await supabase!.storage.from('roster-documents').upload(filePath, file);
    if (error) {
      console.warn('Roster document upload failed:', error);
      throw error;
    }

    const { data: publicUrlData } = supabase!.storage.from('roster-documents').getPublicUrl(filePath);
    return publicUrlData.publicUrl;
  },

  async getMasterRosterForCollection(collectionId: string): Promise<CombinedMasterRoster | null> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('combined_master_rosters')
      .select('*')
      .eq('collection_id', collectionId)
      .maybeSingle();

    if (error) {
      console.warn('Error fetching master roster:', error);
      throw error;
    }
    return data;
  },

  async getOrCreateMasterRoster(collectionId: string, month: number, year: number): Promise<CombinedMasterRoster> {
    checkSupabase();

    const existing = await this.getMasterRosterForCollection(collectionId);
    if (existing) return existing;

    const { data, error } = await supabase!
      .from('combined_master_rosters')
      .insert([{ collection_id: collectionId, month, year }])
      .select()
      .single();

    if (error) {
      console.warn('Error creating master roster:', error);
      throw error;
    }
    return data;
  },

  async updateMasterRoster(
    id: string,
    updates: Partial<Pick<CombinedMasterRoster, 'status' | 'gop_clinic_grid' | 'emergency_call_grid' | 'supervision_grid' | 'satellite_grid' | 'published_at'>>
  ): Promise<CombinedMasterRoster> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('combined_master_rosters')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating master roster:', error);
      throw error;
    }
    return data;
  },

  // --- SAAS MULTI-TENANCY ---
  // NOTE ON SCOPE: tenant_id is now a column on the 10 core tables (see
  // migration 11), but existing get*/query methods above are NOT filtered
  // by tenant_id — with exactly one tenant seeded and no tenant-switching
  // login flow yet, there's nothing to filter against. When a second
  // tenant is provisioned, those methods need tenant_id filters added.
  // This section covers what IS functional today: operator-level tenant
  // management, per-tenant customization, AI quota, and guest review
  // links. Tenant isolation is client-enforced only, not RLS-enforced —
  // see migration 11's header for why.
  async getTenants(): Promise<Tenant[]> {
    checkSupabase();

    const { data, error } = await supabase!.from('tenants').select('*').order('created_at', { ascending: true });
    if (error) {
      console.warn('Error fetching tenants:', error);
      throw error;
    }
    return data || [];
  },

  async getTenant(tenantId: string): Promise<Tenant | null> {
    checkSupabase();

    const { data, error } = await supabase!.from('tenants').select('*').eq('id', tenantId).maybeSingle();
    if (error) {
      console.warn('Error fetching tenant:', error);
      throw error;
    }
    return data;
  },

  // Creates a Paystack subaccount via the Edge Function, then inserts the
  // tenant row with the returned subaccount_code. If the Paystack call
  // fails, no tenant row is created — surfaced to the caller as a thrown
  // error so the operator console can show it plainly rather than leaving
  // a tenant with no billing configured.
  async provisionTenantWithSubaccount(tenant: {
    name: string;
    short_code: string;
    institution?: string | null;
    department?: string | null;
    plan_type?: TenantPlanType;
    business_name: string;
    settlement_bank: string;
    account_number: string;
    percentage_charge: number;
  }): Promise<Tenant> {
    checkSupabase();

    const { data: fnData, error: fnError } = await supabase!.functions.invoke('paystack-subaccount', {
      body: {
        business_name: tenant.business_name,
        settlement_bank: tenant.settlement_bank,
        account_number: tenant.account_number,
        percentage_charge: tenant.percentage_charge,
      },
    });

    if (fnError || !fnData?.subaccount_code) {
      console.warn('Error creating Paystack subaccount:', fnError || fnData);
      throw new Error(fnData?.error || fnError?.message || 'Failed to create Paystack subaccount');
    }

    const { data, error } = await supabase!
      .from('tenants')
      .insert([{
        name: tenant.name,
        short_code: tenant.short_code,
        institution: tenant.institution || null,
        department: tenant.department || null,
        plan_type: tenant.plan_type || 'free_seeded',
        paystack_subaccount_code: fnData.subaccount_code,
      }])
      .select()
      .single();

    if (error) {
      console.warn('Error inserting tenant after subaccount creation:', error);
      throw error;
    }
    return data;
  },

  // Provisions a tenant WITHOUT a Paystack subaccount (free tier or
  // billing configured later).
  async createTenant(tenant: {
    name: string;
    short_code: string;
    institution?: string | null;
    department?: string | null;
    plan_type?: TenantPlanType;
  }): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenants')
      .insert([{ plan_type: 'free_seeded', ...tenant }])
      .select()
      .single();

    if (error) {
      console.warn('Error creating tenant:', error);
      throw error;
    }
    return data;
  },

  async updateTenantPlan(tenantId: string, planType: TenantPlanType): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenants')
      .update({ plan_type: planType })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      console.warn('Error updating tenant plan:', error);
      throw error;
    }
    return data;
  },

  async updateTenantStatus(tenantId: string, status: 'active' | 'suspended'): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenants')
      .update({ status })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      console.warn('Error updating tenant status:', error);
      throw error;
    }
    return data;
  },

  async updateTenantTerminology(tenantId: string, overrides: Record<string, string>): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenants')
      .update({ terminology_overrides: overrides })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      console.warn('Error updating tenant terminology:', error);
      throw error;
    }
    return data;
  },

  async updateTenantModuleFlags(tenantId: string, flags: Record<string, unknown>): Promise<Tenant> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenants')
      .update({ module_flags: flags })
      .eq('id', tenantId)
      .select()
      .single();

    if (error) {
      console.warn('Error updating tenant module flags:', error);
      throw error;
    }
    return data;
  },

  // --- CALL DUTY RULES (per-tenant curriculum alignment) ---
  async getCallDutyRules(tenantId: string): Promise<CallDutyRule[]> {
    checkSupabase();

    const { data, error } = await supabase!.from('call_duty_rules').select('*').eq('tenant_id', tenantId);
    if (error) {
      console.warn('Error fetching call duty rules:', error);
      throw error;
    }
    return data || [];
  },

  async upsertCallDutyRule(tenantId: string, ruleKey: string, ruleValue: number, description?: string | null): Promise<CallDutyRule> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('call_duty_rules')
      .upsert([{ tenant_id: tenantId, rule_key: ruleKey, rule_value: ruleValue, description: description || null }], {
        onConflict: 'tenant_id,rule_key',
      })
      .select()
      .single();

    if (error) {
      console.warn('Error upserting call duty rule:', error);
      throw error;
    }
    return data;
  },

  // --- TENANT AI ADAPTATION RULES ---
  // Schema/UI only in this pass — NOT yet read by the Edge Functions when
  // constructing prompts. See migration 11's header for why that's deferred.
  async getTenantAiAdaptationRules(tenantId: string): Promise<TenantAiAdaptationRule[]> {
    checkSupabase();

    const { data, error } = await supabase!.from('tenant_ai_adaptation_rules').select('*').eq('tenant_id', tenantId);
    if (error) {
      console.warn('Error fetching tenant AI adaptation rules:', error);
      throw error;
    }
    return data || [];
  },

  async upsertTenantAiAdaptationRule(
    tenantId: string,
    featureKey: string,
    updates: { adapted_prompt_overrides?: Record<string, unknown>; local_style_weights?: Record<string, unknown> }
  ): Promise<TenantAiAdaptationRule> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('tenant_ai_adaptation_rules')
      .upsert([{ tenant_id: tenantId, feature_key: featureKey, ...updates }], { onConflict: 'tenant_id,feature_key' })
      .select()
      .single();

    if (error) {
      console.warn('Error upserting tenant AI adaptation rule:', error);
      throw error;
    }
    return data;
  },

  // --- TENANT AI QUOTA ---
  // Real enforcement happens server-side inside the Edge Functions (see
  // supabase/functions/academic-copilot and roster-parser) — this is a
  // client-side convenience for displaying remaining quota, and also
  // increments the counter itself when called (same RPC either way).
  async checkTenantAiQuota(tenantId: string): Promise<TenantAiQuota> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('check_and_increment_tenant_ai_quota', { p_tenant_id: tenantId });
    if (error) {
      console.warn('Error checking tenant AI quota:', error);
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row as TenantAiQuota;
  },

  // --- SAAS OPERATOR (platform owner — separate identity from workforce) ---
  async verifyPlatformOperatorLogin(code: string): Promise<PlatformOperator | null> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('verify_platform_operator_code', { p_code: code });
    if (error) {
      console.warn('Error verifying platform operator login:', error);
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  },

  async logOperatorEvent(operatorId: string, eventType: string, details: Record<string, unknown> = {}): Promise<void> {
    checkSupabase();

    const { error } = await supabase!.from('saas_operator_logs').insert([{ operator_id: operatorId, event_type: eventType, details }]);
    if (error) {
      console.warn('Error logging operator event:', error);
      // Non-fatal: an audit-log write failure shouldn't block the action itself.
    }
  },

  // --- GUEST REVIEW LINKS (no-login consultant/peer sign-off) ---
  async createGuestReviewInvite(
    createdByWorkforceId: string,
    targetType: 'dissertation_milestone' | 'case_report',
    targetId: string,
    invitedAs: GuestInvitedAs = 'peer_reviewer',
    guestName?: string
  ): Promise<GuestReviewInvite> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('create_guest_review_invite', {
      p_created_by_workforce_id: createdByWorkforceId,
      p_target_type: targetType,
      p_target_id: targetId,
      p_invited_as: invitedAs,
      p_guest_name: guestName || null,
    });

    if (error) {
      console.warn('Error creating guest review invite:', error);
      throw error;
    }
    return data;
  },

  async getGuestReviewInvite(token: string): Promise<GuestReviewInvitePublic | null> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('get_guest_review_invite', { p_token: token });
    if (error) {
      console.warn('Error fetching guest review invite:', error);
      throw error;
    }
    const row = Array.isArray(data) ? data[0] : data;
    return row || null;
  },

  async submitGuestReview(
    token: string,
    status: ReviewStatus,
    feedbackNotes: string,
    guestSignatureUrl: string | null,
    guestName?: string
  ): Promise<ConsultantReview> {
    checkSupabase();

    const { data, error } = await supabase!.rpc('submit_guest_review', {
      p_token: token,
      p_status: status,
      p_feedback_notes: feedbackNotes || null,
      p_guest_signature_url: guestSignatureUrl,
      p_guest_name: guestName || null,
    });

    if (error) {
      console.warn('Error submitting guest review:', error);
      throw error;
    }
    return data;
  },

  async uploadGuestSignature(file: File): Promise<string> {
    checkSupabase();

    const fileExt = file.name.split('.').pop();
    const filePath = `guest-signatures/${Date.now()}_${Math.random().toString(36).substring(2, 7)}.${fileExt}`;

    const { error } = await supabase!.storage.from('guest-signatures').upload(filePath, file);
    if (error) {
      console.warn('Guest signature upload failed:', error);
      throw error;
    }

    const { data: publicUrlData } = supabase!.storage.from('guest-signatures').getPublicUrl(filePath);
    return publicUrlData.publicUrl;
  },

  // Coarse, unfiltered counts for the SaaS operator console's platform
  // analytics panel — global (across all tenants), not tenant-scoped.
  // count: 'exact', head: true avoids fetching row bodies just to count.
  async getPlatformAnalyticsSummary(): Promise<{
    totalTenants: number;
    totalMembers: number;
    activeMasterRosters: number;
    aiActionCount: number;
  }> {
    checkSupabase();

    const [tenants, members, rosters, aiActions] = await Promise.all([
      supabase!.from('tenants').select('id', { count: 'exact', head: true }),
      supabase!.from('workforce').select('id', { count: 'exact', head: true }),
      supabase!.from('combined_master_rosters').select('id', { count: 'exact', head: true }).eq('status', 'published'),
      supabase!.from('ai_action_logs').select('id', { count: 'exact', head: true }),
    ]);

    return {
      totalTenants: tenants.count || 0,
      totalMembers: members.count || 0,
      activeMasterRosters: rosters.count || 0,
      aiActionCount: aiActions.count || 0,
    };
  },

  // --- UNIVERSAL RESEARCH ENGINE (migration 13) ---
  // Plain CRUD only — fork/edit business logic lives in
  // src/lib/research/templateEngine.ts, which calls these.
  async getResearchTemplates(): Promise<ResearchTemplate[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_templates')
      .select('*')
      .order('organization_or_body', { ascending: true })
      .order('name', { ascending: true });

    if (error) {
      console.warn('Error fetching research templates:', error);
      throw error;
    }
    return data || [];
  },

  async getResearchTemplate(id: string): Promise<ResearchTemplate | null> {
    checkSupabase();

    const { data, error } = await supabase!.from('research_templates').select('*').eq('id', id).maybeSingle();
    if (error) {
      console.warn('Error fetching research template:', error);
      throw error;
    }
    return data;
  },

  async createResearchTemplate(entry: {
    tenant_id: string | null;
    created_by_workforce_id: string | null;
    name: string;
    is_public: boolean;
    organization_or_body: ResearchTemplate['organization_or_body'];
    specialty?: string | null;
    study_design?: ResearchTemplate['study_design'];
    proposal_rubric?: Record<string, unknown>;
    dissertation_rubric?: Record<string, unknown>;
    referencing_style?: ResearchTemplate['referencing_style'];
    word_count_limits?: Record<string, number>;
  }): Promise<ResearchTemplate> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_templates')
      .insert([entry])
      .select()
      .single();

    if (error) {
      console.warn('Error creating research template:', error);
      throw error;
    }
    return data;
  },

  async updateResearchTemplate(
    id: string,
    updates: Partial<Pick<ResearchTemplate, 'name' | 'specialty' | 'study_design' | 'proposal_rubric' | 'dissertation_rubric' | 'referencing_style' | 'word_count_limits'>>
  ): Promise<ResearchTemplate> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_templates')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating research template:', error);
      throw error;
    }
    return data;
  },

  // --- RESEARCH WORKSPACES ---
  async getResearchWorkspacesForWorkforce(workforceId: string): Promise<ResearchWorkspace[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_workspaces')
      .select('*')
      .eq('workforce_id', workforceId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching research workspaces:', error);
      throw error;
    }
    return data || [];
  },

  async getResearchWorkspace(id: string): Promise<ResearchWorkspace | null> {
    checkSupabase();

    const { data, error } = await supabase!.from('research_workspaces').select('*').eq('id', id).maybeSingle();
    if (error) {
      console.warn('Error fetching research workspace:', error);
      throw error;
    }
    return data;
  },

  // Stamps the default 7-folder Drive taxonomy onto every new workspace —
  // see src/lib/research/folderStructure.ts.
  async createResearchWorkspace(entry: {
    tenant_id: string | null;
    workforce_id: string;
    title: string;
    study_design?: ResearchWorkspace['study_design'];
    template_id?: string | null;
    pico_framework?: Record<string, unknown>;
    target_exam_date?: string | null;
  }): Promise<ResearchWorkspace> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_workspaces')
      .insert([{ pico_framework: {}, folder_tree: buildDefaultFolderTree(), ...entry }])
      .select()
      .single();

    if (error) {
      console.warn('Error creating research workspace:', error);
      throw error;
    }
    return data;
  },

  async updateResearchWorkspaceTemplate(id: string, templateId: string): Promise<ResearchWorkspace> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_workspaces')
      .update({ template_id: templateId })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating research workspace template:', error);
      throw error;
    }
    return data;
  },

  async updateResearchWorkspaceStatus(id: string, status: ResearchWorkspaceStatus): Promise<ResearchWorkspace> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_workspaces')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating research workspace status:', error);
      throw error;
    }
    return data;
  },

  async updateResearchWorkspacePico(id: string, picoFramework: Record<string, unknown>): Promise<ResearchWorkspace> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_workspaces')
      .update({ pico_framework: picoFramework })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating research workspace PICO framework:', error);
      throw error;
    }
    return data;
  },

  // --- RESEARCH CHAPTERS ---
  async getResearchChapters(workspaceId: string): Promise<ResearchChapter[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_chapters')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('chapter_number', { ascending: true });

    if (error) {
      console.warn('Error fetching research chapters:', error);
      throw error;
    }
    return data || [];
  },

  async upsertResearchChapter(
    workspaceId: string,
    chapterType: ResearchChapterType,
    chapterNumber: number,
    updates: Partial<Pick<ResearchChapter, 'title' | 'word_count' | 'content_text' | 'section_scores' | 'ai_audit_logs'>>
  ): Promise<ResearchChapter> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_chapters')
      .upsert([{ workspace_id: workspaceId, chapter_type: chapterType, chapter_number: chapterNumber, ...updates }], {
        onConflict: 'workspace_id,chapter_type',
      })
      .select()
      .single();

    if (error) {
      console.warn('Error saving research chapter:', error);
      throw error;
    }
    return data;
  },

  // --- RESEARCH CORRECTION LOGS ---
  async getResearchCorrectionLogs(workspaceId: string): Promise<ResearchCorrectionLog[]> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_correction_logs')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Error fetching research correction logs:', error);
      throw error;
    }
    return data || [];
  },

  async createResearchCorrectionLog(entry: {
    workspace_id: string;
    comment_source: ResearchCorrectionSource;
    section_topic?: string | null;
    original_comment: string;
  }): Promise<ResearchCorrectionLog> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_correction_logs')
      .insert([entry])
      .select()
      .single();

    if (error) {
      console.warn('Error creating research correction log:', error);
      throw error;
    }
    return data;
  },

  async updateResearchCorrectionLog(
    id: string,
    updates: { action_taken?: string; status?: ResearchCorrectionStatus }
  ): Promise<ResearchCorrectionLog> {
    checkSupabase();

    const { data, error } = await supabase!
      .from('research_correction_logs')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.warn('Error updating research correction log:', error);
      throw error;
    }
    return data;
  },
};
