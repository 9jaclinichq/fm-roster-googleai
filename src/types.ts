export type Category = 'Registrar' | 'Senior Registrar' | 'Medical Officer';

export type RoleId = 'super_admin' | 'hod' | 'rtc' | 'cme_coord' | 'consultant' | 'resident';

export interface WorkforceMember {
  id: string;
  full_name: string;
  category: Category;
  // Never present on the general workforce list (databaseService.getWorkforce()) —
  // the resident_code column is locked down at the database level and only
  // returned by the chief_* RPCs (see databaseService.ts).
  resident_code?: string;
  active: boolean;
  created_at: string;
}

export interface Collection {
  id: string;
  title: string;
  deadline: string; // ISO timestamp
  status: 'open' | 'closed';
  created_at: string;
}

export interface Submission {
  id: string;
  collection_id: string;
  workforce_id: string;
  current_rotation: string;
  next_rotation: string;
  current_rotation_id?: string | null;
  next_rotation_id?: string | null;
  taking_leave: boolean;
  leave_type: string | null;
  leave_start: string | null;
  leave_end: string | null;
  leave_applied: boolean | null;
  leave_document_urls: string[]; // maximum 3
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  id: number;
  // admin_access_code is intentionally NOT included here — the column is
  // locked down at the database level and never returned to the client.
  // Use databaseService.verifyChiefLogin() / updateAdminCode() instead.
  current_collection_id: string | null;
}

export interface SubmissionWithWorkforce extends Submission {
  workforce: {
    full_name: string;
    category: Category;
  };
}

export interface Role {
  id: RoleId;
  label: string;
  description: string | null;
}

export interface UserRole {
  id: string;
  auth_user_id: string | null;
  workforce_id: string | null;
  role_id: RoleId;
  email: string | null;
  created_at: string;
}

export interface Rotation {
  id: string;
  name: string;
  department: string | null;
  active: boolean;
  created_at: string;
}

export interface FileUpload {
  id: string;
  file_name: string;
  storage_path: string;
  user_id: string | null;
  workforce_id: string | null;
  submission_id: string | null;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
}

export type AnnouncementCategory = 'Roster' | 'Exam' | 'CME' | 'Admin';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: AnnouncementCategory;
  pinned: boolean;
  created_by: string | null;
  created_by_workforce_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementRead {
  id: string;
  announcement_id: string;
  workforce_id: string;
  read_at: string;
}

export type DissertationStage =
  | 'Topic Registration'
  | 'Proposal Development'
  | 'Ethical Clearance'
  | 'Data Collection'
  | 'Data Analysis'
  | 'Draft Writing'
  | 'Supervisor Review'
  | 'Internal Defense'
  | 'Final Submission';

export const WACP_DISSERTATION_STAGES: DissertationStage[] = [
  'Topic Registration',
  'Proposal Development',
  'Ethical Clearance',
  'Data Collection',
  'Data Analysis',
  'Draft Writing',
  'Supervisor Review',
  'Internal Defense',
  'Final Submission',
];

export interface Dissertation {
  id: string;
  workforce_id: string;
  title: string;
  stage: DissertationStage;
  supervisor_name: string | null;
  created_at: string;
  updated_at: string;
}

export type MilestoneStatus = 'draft' | 'in_review' | 'approved';

export interface DissertationMilestone {
  id: string;
  dissertation_id: string;
  stage: DissertationStage;
  status: MilestoneStatus;
  document_url: string | null;
  supervisor_feedback: string | null;
  created_at: string;
  updated_at: string;
}

export type KnowledgePackCategory = 'guidelines' | 'templates' | 'sample_dissertation' | 'past_questions';

export interface KnowledgePack {
  id: string;
  title: string;
  category: KnowledgePackCategory;
  file_url: string;
  description: string | null;
  tags: string[];
  created_at: string;
}

export type CaseReportStatus = 'draft' | 'pending_supervisor' | 'approved';

export interface CaseReport {
  id: string;
  workforce_id: string;
  case_number: number; // 1-15
  patient_initials: string | null;
  diagnosis: string | null;
  category: string | null;
  status: CaseReportStatus;
  document_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExamReadiness {
  id: string;
  workforce_id: string;
  evidemy_completed_count: number;
  evidemy_total_required: number;
  physical_logbook_verified: boolean;
  exam_fees_paid: boolean;
  college_forms_submitted: boolean;
  oral_practice_score: number | null;
  created_at: string;
  updated_at: string;
}

export interface ScoringBreakdown {
  diagnostic_reasoning: number; // 0-100
  management: number; // 0-100
  safety: number; // 0-100
  communication: number; // 0-100
}

export interface VivaSimulation {
  id: string;
  workforce_id: string;
  case_title: string;
  category: string | null;
  duration_seconds: number | null;
  scoring_breakdown: ScoringBreakdown | Record<string, never>;
  feedback_summary: string | null;
  created_at: string;
}

export type ReviewTargetType = 'dissertation_milestone' | 'case_report';
export type ReviewStatus = 'approved' | 'revisions_requested';
export type SubadminRoleId = Exclude<RoleId, 'super_admin' | 'resident'>;

export interface ConsultantReview {
  id: string;
  target_type: ReviewTargetType;
  target_id: string;
  reviewer_workforce_id: string | null;
  status: ReviewStatus;
  feedback_notes: string | null;
  // The reviewer's role at the time of review ('resident' for a
  // co-resident peer-assist review, or the subadmin role_id otherwise).
  reviewer_role: string | null;
  created_at: string;
}

export interface DelegatedRole extends UserRole {
  workforce: {
    full_name: string;
    category: Category;
  } | null;
}

export interface DissertationMilestoneWithContext extends DissertationMilestone {
  dissertations: {
    title: string;
    workforce_id: string;
    workforce: { full_name: string; category: Category } | null;
  } | null;
}

export interface CaseReportWithWorkforce extends CaseReport {
  workforce: { full_name: string; category: Category } | null;
}

export interface KnowledgePackItem {
  id: string;
  pack_id: string;
  title: string;
  document_url: string | null;
  extracted_text_content: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export type AiActionType = 'methodology_check' | 'vancouver_format' | 'mesh_suggest' | 'differential_extract';

export interface AiActionLog {
  id: string;
  workforce_id: string | null;
  action_type: AiActionType;
  input_summary: string | null;
  output_result: Record<string, unknown>;
  created_at: string;
}
