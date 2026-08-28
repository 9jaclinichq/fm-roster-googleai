export type Category = 'Registrar' | 'Senior Registrar' | 'Medical Officer';

export type RoleId = 'super_admin' | 'hod' | 'rtc' | 'cme_coord' | 'consultant' | 'resident';

export interface WorkforceMember {
  id: string;
  full_name: string;
  category: Category;
  // Nullable FK into workforce_categories (migration 39) — additive
  // alongside the legacy `category` text column. Present when explicitly
  // selected (see WORKFORCE_PUBLIC_COLUMNS in databaseService.ts); null for
  // any row that predates migration 39's backfill or falls outside its
  // normalization match. Prefer resolving a display label via this id
  // (against a fetched WorkforceCategory[]) and fall back to `category`
  // text when null — see the "rewired" call sites this comment's own
  // migration 39 header originally flagged as a followup:
  // WorkforceRegistryPanel.tsx, ChiefDashboardView.tsx's CSV export/filter,
  // RoleDelegationPanel.tsx.
  category_id?: string | null;
  // Never present on the general workforce list (databaseService.getWorkforce()) —
  // the resident_code column is locked down at the database level and only
  // returned by the chief_* RPCs (see databaseService.ts).
  resident_code?: string;
  active: boolean;
  // True by default. Distinguishes residents currently posted in GOP
  // (General Out-Patient) from those on an outside rotation — a
  // current-state flag, not tracked month-by-month.
  on_floor: boolean;
  // Present when explicitly selected (migration 11) — see
  // WORKFORCE_PUBLIC_COLUMNS in databaseService.ts. Optional because most
  // existing call sites don't request it and there's only one tenant
  // seeded today; not yet used to filter any existing query client-side.
  tenant_id?: string;
  // Nullable link to an individual doctor's own auth-based identity
  // (migration 18) — set once a Chief links this workforce row to a
  // self-registered doctor_profiles account. Most existing rows have this
  // NULL (created via the plaintext-code Resident flow, unchanged).
  doctor_id?: string | null;
  created_at: string;
}

// An individual doctor's self-registered identity (migration 18) — 1:1 with
// a real Supabase Auth user, unlike every other identity in this app (see
// Role Model in CLAUDE.md). Exists independently of `workforce`; gains
// access to the resident dashboard only once a Chief links a workforce row
// to it via WorkforceMember.doctor_id.
export interface DoctorProfile {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
}

export interface Collection {
  id: string;
  title: string;
  deadline: string; // ISO timestamp
  status: 'open' | 'closed';
  created_at: string;
  // Already a real column (see createCollection's insert/filter in
  // databaseService.ts) — added here so the submission-status shared
  // primitive (src/modules/shared/lib/submissionStatus.ts) can verify a
  // collection belongs to the requested tenant without a parallel type.
  tenant_id: string;
}

// Administrative metadata only (migration 68, locked 2026-08-22): exactly
// two states, never draft/locked/approved/rejected/reconciled. See that
// migration's own header for the full invariant and non-goals.
export type SubmissionReviewStatus = 'submitted' | 'reviewed';

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
  // Administrative metadata only — never read by ResidentFormView,
  // collection.status logic, roster/publication code, or anything other
  // than the Chief-facing SubmissionsPanel. Reset to 'submitted' on every
  // resident-driven write (see databaseService.ts's submitRoster()).
  review_status: SubmissionReviewStatus;
  created_at: string;
  updated_at: string;
}

export interface Settings {
  id: string;
  // One settings row per tenant since migration 23 (previously a 1-row
  // global singleton).
  tenant_id: string;
  // admin_access_code is intentionally NOT included here — the column is
  // locked down at the database level and never returned to the client.
  // Use databaseService.verifyChiefLogin() / updateAdminCode() instead.
  current_collection_id: string | null;
}

export interface SubmissionWithWorkforce extends Submission {
  workforce: {
    full_name: string;
    category: Category;
    // Present since the migration-39 rewiring (getSubmissions' select now
    // requests it) — see WorkforceMember.category_id's comment.
    category_id?: string | null;
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
  // Nullable since migration 36 — a role assignment carries EITHER the
  // fixed platform-level role_id ('resident'/'super_admin') OR a
  // tenant-scoped org_group_id, never neither (see the DB CHECK
  // constraint). Delegated subadmin-style roles now use org_group_id.
  role_id: RoleId | null;
  org_group_id: string | null;
  email: string | null;
  created_at: string;
}

// Org-defined group vocabulary (migration 36) — replaces the previously
// hardcoded global 4-value subadmin role list. Seeded per-tenant with the
// 4 legacy labels (is_system_default: true, editable but not deletable);
// a Chief can also create fully custom groups for their own org structure.
export interface OrgGroup {
  id: string;
  tenant_id: string;
  group_key: string;
  label: string;
  description: string | null;
  grants_review_approval: boolean;
  is_system_default: boolean;
  created_at: string;
}

// Org-defined workforce category vocabulary (migration 39) — replaces the
// previously hardcoded global `Category` union ('Registrar' | 'Senior
// Registrar' | 'Medical Officer') with a tenant-scoped table. Seeded
// per-tenant with those 3 legacy labels (is_system_default: true, editable
// but not deletable); a Chief can also create fully custom categories for
// their own org's grade structure. Additive only — `workforce.category`
// (text) and the `Category` union stay in place; no existing component
// reads/writes `workforce.category_id` yet (followup, not this pass).
export interface WorkforceCategory {
  id: string;
  tenant_id: string;
  category_key: string;
  label: string;
  description: string | null;
  is_system_default: boolean;
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

// Migration 28 — practice viva scenarios. tenant_id NULL = global/seeded,
// available to every tenant; tenant_id set = that org's own vignette,
// editable only by that org's Chief (see chief_*_viva_vignette RPCs).
export interface VivaVignette {
  id: string;
  tenant_id: string | null;
  title: string;
  category: string;
  scenario: string;
  prompts: string[];
  created_at: string;
}

export type ReviewTargetType = 'dissertation_milestone' | 'case_report';
export type ReviewStatus = 'approved' | 'revisions_requested';

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
  // Set only for reviews submitted through a guest link (migration 11) —
  // reviewer_workforce_id is null in that case.
  guest_invite_id?: string | null;
  guest_name?: string | null;
  guest_signature_url?: string | null;
  created_at: string;
}

// --- SAAS MULTI-TENANCY & ADAPTIVE AI (migration 11) ---

export type TenantPlanType = 'free_seeded' | 'tier_1' | 'tier_2' | 'enterprise';
export type TenantStatus = 'active' | 'suspended';

export interface Tenant {
  id: string;
  name: string;
  short_code: string;
  institution: string | null;
  department: string | null;
  plan_type: TenantPlanType;
  status: TenantStatus;
  paystack_subaccount_code: string | null;
  // Tenant-configurable label overrides (e.g. {"resident": "Trainee"}) so
  // the same app can serve orgs beyond medical residency without a
  // code-level rename. Read via src/modules/shared/terminology.tsx. NOT yet applied
  // to most existing components — see that file's header for scope.
  terminology_overrides: Record<string, string>;
  // Granular module toggles/overrides, e.g.
  // {"viva_simulator_enabled": true, "case_reports_required_count": 15}.
  module_flags: Record<string, unknown>;
  created_at: string;
}

// Pre-login discovery projection (migration 58, Priority-0 Tenant Surface
// slice P0-1) — the `list_public_tenants()` RPC's exact return shape, not
// a client-side pick of `Tenant`. Deliberately excludes `status` (active/
// discoverable filtering happens server-side inside the RPC, see that
// migration's header) and every private field (`short_code`, `plan_type`,
// `paystack_subaccount_code`, `module_flags`, `terminology_overrides`,
// `created_at`) per docs/TENANT_SURFACE_SECURITY_SPEC.md §3.
export interface PublicTenant {
  id: string;
  name: string;
  institution: string | null;
  department: string | null;
}

// Chief-scoped tenant configuration read (migration 61, Priority-0 Tenant
// Surface slice P0-5) — the `chief_get_tenant()` RPC's exact return shape.
// Covers exactly what TenantCustomizationView.tsx and TemplateManagerView.tsx
// (the only two current consumers) actually read: `name`/`module_flags`/
// `terminology_overrides` for the customization editor, `plan_type` for
// TemplateManagerView's free-tier gate. Deliberately excludes
// `short_code`, `status`, `paystack_subaccount_code`, and `created_at` —
// no existing Chief consumer needs them.
export interface ChiefTenantConfig {
  id: string;
  name: string;
  plan_type: TenantPlanType;
  module_flags: Record<string, unknown>;
  terminology_overrides: Record<string, string>;
}

// Platform-operator-scoped tenant listing (migration 61, slice P0-5) — the
// `platform_operator_list_tenants()` RPC's exact return shape, matching
// exactly what SaaSOperatorConsoleView.tsx's tenant management table
// renders. Excludes `module_flags`/`terminology_overrides`/`created_at` —
// not rendered there.
export interface OperatorTenantListing {
  id: string;
  name: string;
  short_code: string;
  institution: string | null;
  department: string | null;
  plan_type: TenantPlanType;
  status: TenantStatus;
  paystack_subaccount_code: string | null;
}

export interface CallDutyRule {
  id: string;
  tenant_id: string;
  rule_key: string;
  rule_value: number;
  description: string | null;
  created_at: string;
}

export interface TenantAiAdaptationRule {
  id: string;
  tenant_id: string;
  feature_key: string;
  adapted_prompt_overrides: Record<string, unknown>;
  local_style_weights: Record<string, unknown>;
  updated_at: string;
}

export interface TenantAiQuota {
  allowed: boolean;
  remaining: number | null;
  resets_at: string | null;
}

export interface PlatformOperator {
  id: string;
  name: string;
}

export interface SaasOperatorLog {
  id: string;
  operator_id: string | null;
  event_type: string;
  details: Record<string, unknown>;
  created_at: string;
}

export type GuestInvitedAs = 'peer_reviewer' | 'consultant';
export type GuestInviteStatus = 'pending' | 'completed' | 'revoked';

export interface GuestReviewInvite {
  id: string;
  tenant_id: string;
  token: string;
  target_type: ReviewTargetType;
  target_id: string;
  invited_as: GuestInvitedAs;
  created_by_workforce_id: string | null;
  guest_name: string | null;
  status: GuestInviteStatus;
  expires_at: string;
  completed_at: string | null;
  created_at: string;
}

// Subset returned by get_guest_review_invite() — deliberately minimal,
// doesn't leak tenant_id/creator identity to an anonymous guest visitor.
export interface GuestReviewInvitePublic {
  target_type: ReviewTargetType;
  target_id: string;
  invited_as: GuestInvitedAs;
  guest_name: string | null;
  status: GuestInviteStatus;
  expires_at: string;
}

export interface DelegatedRole extends UserRole {
  workforce: {
    full_name: string;
    category: Category;
    // Present since the migration-39 rewiring (getDelegatedRoles' select
    // now requests it) — see WorkforceMember.category_id's comment.
    category_id?: string | null;
  } | null;
  org_group: OrgGroup | null;
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

export type AiActionType =
  | 'methodology_check' | 'vancouver_format' | 'mesh_suggest' | 'differential_extract'
  | 'research_audit' | 'literature_matrix' | 'table_shells'
  | 'casebook_audit' | 'defense_questions' | 'logbook_parse';

export interface AiActionLog {
  id: string;
  workforce_id: string | null;
  action_type: AiActionType;
  input_summary: string | null;
  output_result: Record<string, unknown>;
  created_at: string;
}

export type ActivityType = 'roster_submission' | 'dissertation_milestone' | 'case_report' | 'viva_simulation' | 'announcement_read';

export interface ActivityMatrixDay {
  activity_date: string; // YYYY-MM-DD
  activity_count: number;
}

export type NudgeSeverity = 'high' | 'medium' | 'info';

export interface ComplianceNudge {
  id: string;
  workforce_id: string;
  nudge_type: string;
  severity: NudgeSeverity;
  title: string;
  action_link: string | null;
  resolved: boolean;
  created_at: string;
}

// A nudge computed client-side before it's synced/persisted — no `id` yet.
export interface DerivedNudge {
  nudge_type: string;
  severity: NudgeSeverity;
  title: string;
  action_link: string | null;
}

// --- Multi-Roster Engine (UCH Family Medicine) ---

export type RosterTypeId =
  | 'combined_gop'
  | 'consultant_gop'
  | 'accident_emergency'
  | 'afternoon_supervision'
  | 'satellite_outreach';

export interface RosterType {
  id: RosterTypeId;
  name: string;
}

export interface RawRosterUpload {
  id: string;
  month: number;
  year: number;
  roster_type_id: RosterTypeId;
  file_name: string | null;
  file_url: string | null;
  raw_text_content: string | null;
  parsed_data: Record<string, unknown>;
  uploaded_by_workforce_id: string | null;
  created_at: string;
}

export type ClinicType = 'Triage' | 'Male Sorting' | 'Female Sorting' | 'Children Sorting' | 'Floor Clinic' | 'Managed Care' | 'Annexe' | 'Other';

export interface GopClinicSlot {
  date_or_day: string;
  clinic_type: ClinicType;
  consultants: string[];
  // Only meaningful for the combined_gop grid — consultant_gop slots have no residents.
  residents?: string[];
}
export interface GopClinicGrid {
  slots: GopClinicSlot[];
  unparsed_notes: string[];
}

export type EmergencyShiftLabel = '4pm-10pm' | '10pm-8am';
export interface EmergencyShift {
  date_or_day: string;
  shift: EmergencyShiftLabel;
  on_call: string[];
}
export interface EmergencyCallGrid {
  shifts: EmergencyShift[];
  unparsed_notes: string[];
}

export interface SupervisionDuty {
  date_or_day: string;
  first_on_duty: string | null;
  second_on_duty: string | null;
}
export interface SupervisionGrid {
  duties: SupervisionDuty[];
  unparsed_notes: string[];
}

export interface SatellitePosting {
  facility: string;
  date_or_day: string | null;
  assigned: string[];
}
export interface SatelliteGrid {
  postings: SatellitePosting[];
  unparsed_notes: string[];
}

export type MasterRosterStatus = 'draft' | 'chief_review' | 'published';

export interface CombinedMasterRoster {
  id: string;
  collection_id: string | null;
  month: number;
  year: number;
  status: MasterRosterStatus;
  gop_clinic_grid: GopClinicGrid;
  emergency_call_grid: EmergencyCallGrid;
  supervision_grid: SupervisionGrid;
  satellite_grid: SatelliteGrid;
  published_at: string | null;
  created_at: string;
  // Migration 75 — Chief/audit-tooling metadata only (nullable, additive).
  // No resident-facing RPC reads this; it exists so Chief/audit tooling
  // can answer "which revision produced this row's current content"
  // without a separate lookup. Null for rows published before the
  // revision model existed, or that have never had a revision published
  // into them yet.
  current_revision_id?: string | null;
}

// Migration 75 — revision-safe Chief roster editing. See
// WORKSPC_REVISION_SAFE_CHIEF_ROSTER_EDITING_DISCOVER_AND_PLAN_2026-08-28.md
// for the full design. combined_master_rosters remains the ONLY thing
// residents ever read (My Assignment / Full Roster RPCs are unaffected);
// a RosterRevision is Chief-editing-only working state.
export type RosterRevisionStatus = 'editing' | 'published' | 'superseded' | 'discarded';
// 'chief_manual' is the only value any current RPC produces.
// 'external_import'/'ai_proposal' are schema headroom for future seams
// (Drive/Docs import, AI-proposed edits) — neither is implemented yet.
export type RosterRevisionSource = 'chief_manual' | 'external_import' | 'ai_proposal';

export interface RosterRevisionDiffSummary {
  based_on_revision_id: string | null;
  sections_changed: {
    gop: boolean;
    emergency: boolean;
    supervision: boolean;
    satellite: boolean;
  };
}

export interface RosterRevision {
  id: string;
  collection_id: string;
  tenant_id: string;
  revision_number: number;
  status: RosterRevisionStatus;
  gop_clinic_grid: GopClinicGrid;
  emergency_call_grid: EmergencyCallGrid;
  supervision_grid: SupervisionGrid;
  satellite_grid: SatelliteGrid;
  based_on_revision_id: string | null;
  source: RosterRevisionSource;
  source_reference: string | null;
  changed_by: string;
  change_reason: string | null;
  diff_summary: RosterRevisionDiffSummary | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface RosterParseResult<T> {
  data: T;
  source: 'edge_function' | 'heuristic_fallback';
  provider?: 'openai' | 'gemini';
}

// Workforce Option A (read-only reconciliation) — see
// docs/WORKFORCE_V1_RECOVERY_SPEC.md. Computed by
// src/modules/roster-engine/lib/rosterReconciliation.ts, rendered inside
// MultiRosterManagerView.tsx. Never written anywhere — this is a pure
// display type, not a database row shape.
// invalid_declared_leave_range added as a hardening slice (2026-08-20,
// adversarial finding): leave_start > leave_end previously made the
// overlap check mathematically unsatisfiable and silently produced zero
// findings. Now surfaced explicitly instead of suppressed.
// missing_expected_coverage/ineligible_assignment added as UCH Family
// Medicine Slice 1 (2026-08-23, see
// WORKSPC_RECONCILIATION_REVIEW_2026-08-23_SEPTEMBER_CYCLE.md §G Slice 3):
// read-only checks against the same FM-specific adapter/precedent as the
// existing on-floor rule, NOT universal Workspc rules.
export type ReconciliationIssueType =
  | 'rotation_conflict'
  | 'unrecognised_rotation'
  | 'leave_roster_overlap'
  | 'invalid_declared_leave_range'
  | 'missing_expected_coverage'
  | 'ineligible_assignment';

export interface ReconciliationIssue {
  type: ReconciliationIssueType;
  // Null only for missing_expected_coverage findings that are about an
  // absence at a service point/posting rather than about one specific
  // member (e.g. "no Senior Registrar assigned to Triage on Monday") —
  // every other issue type always names a specific member.
  workforceId: string | null;
  memberName: string | null;
  // Human-readable, following the locked "conflicts with"/"declared
  // leave"/"Needs Review" phrasing — never asserts one state is wrong.
  message: string;
  // Exact submitted/organisational/roster values being compared, named
  // per field so the Chief can see precisely what was checked.
  evidence: Record<string, string>;
}

// --- Universal Research Engine (migration 13) ---

export type ResearchOrgBody = 'WACP' | 'NPMCN' | 'ICMJE' | 'CONSORT' | 'STROBE' | 'PRISMA' | 'CARE' | 'University_Thesis' | 'Custom_Doctor';
export type ResearchStudyDesign = 'cross_sectional' | 'cohort' | 'case_control' | 'clinical_trial' | 'qualitative' | 'systematic_review' | 'case_series';
export type ResearchReferencingStyle = 'vancouver' | 'apa7' | 'harvard';

export interface ResearchTemplate {
  id: string;
  tenant_id: string | null;
  created_by_workforce_id: string | null;
  name: string;
  is_public: boolean;
  organization_or_body: ResearchOrgBody;
  specialty: string | null;
  study_design: ResearchStudyDesign | null;
  proposal_rubric: Record<string, unknown>;
  dissertation_rubric: Record<string, unknown>;
  referencing_style: ResearchReferencingStyle;
  word_count_limits: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export type ResearchWorkspaceStatus = 'proposal_draft' | 'proposal_approved' | 'data_collection' | 'thesis_writeup' | 'completed';

export interface ResearchWorkspace {
  id: string;
  tenant_id: string | null;
  workforce_id: string | null;
  // Unlinked individual-doctor track (migration 25) — set for a personal
  // workspace instead of workforce_id.
  doctor_id: string | null;
  title: string;
  study_design: ResearchStudyDesign | null;
  template_id: string | null;
  pico_framework: Record<string, unknown>;
  target_exam_date: string | null;
  folder_tree: FolderNode[];
  status: ResearchWorkspaceStatus;
  created_at: string;
}

export type ResearchChapterType = 'proposal' | 'ch1_intro' | 'ch2_lit_review' | 'ch3_methods' | 'ch4_results' | 'ch5_discussion';

export interface ResearchChapter {
  id: string;
  workspace_id: string;
  chapter_type: ResearchChapterType;
  chapter_number: number; // 0-5
  title: string | null;
  word_count: number;
  content_text: string | null;
  section_scores: Record<string, unknown>;
  ai_audit_logs: Record<string, unknown>[];
  updated_at: string;
}

export type ResearchCorrectionSource = 'college_assessor' | 'supervisor_round_1' | 'supervisor_round_2' | 'peer_reviewer';
export type ResearchCorrectionStatus = 'pending' | 'resolved';

export interface ResearchCorrectionLog {
  id: string;
  workspace_id: string;
  comment_source: ResearchCorrectionSource;
  section_topic: string | null;
  original_comment: string;
  action_taken: string | null;
  status: ResearchCorrectionStatus;
  created_at: string;
}

// A folder or subfolder in the default 7-folder drive taxonomy
// (src/modules/research/lib/folderStructure.ts). Recursive, but the current
// taxonomy is only 2 levels deep (folder -> subfolder).
export interface FolderNode {
  name: string;
  children?: FolderNode[];
}

// --- Casebook & Clinical Logbook Engine (migrations 15-16) ---

export type CasebookFrameworkType = 'WACP_PMR_10' | 'WACP_CASEBOOK_15' | 'NPMCN_CASEBOOK_15' | 'GENERIC_10' | 'CUSTOM_CLINICAL';

export interface CasebookTemplate {
  id: string;
  tenant_id: string | null;
  created_by_workforce_id: string | null;
  name: string;
  framework_type: CasebookFrameworkType;
  thematic_distribution: Record<string, unknown>;
  scoring_rubric: Record<string, unknown>;
  formatting_rules: Record<string, unknown>;
  created_at: string;
}

export type CasebookWorkspaceStatus = 'draft' | 'under_review' | 'completed';

export interface CasebookWorkspace {
  id: string;
  tenant_id: string | null;
  workforce_id: string | null;
  // Unlinked individual-doctor track (migration 25) — set for a personal
  // workspace instead of workforce_id.
  doctor_id: string | null;
  title: string;
  framework_type: CasebookFrameworkType;
  template_id: string | null;
  candidate_name: string | null;
  exam_date: string | null;
  preliminary_pages: Record<string, unknown>;
  page_count_target: { min_pages?: number; max_pages?: number };
  status: CasebookWorkspaceStatus;
  created_at: string;
}

export type ThematicArea =
  | 'maternal_health' | 'gynaecology' | 'internal_medicine' | 'child_health' | 'surgery'
  | 'mental_health' | 'trauma_orthopaedics' | 'accident_emergency' | 'ent' | 'ophthalmology'
  | 'family_case_study' | 'custom';

export interface ClinicalHistoryNotes {
  ros?: string;
  past_med_surg?: string;
  gynae_obs?: string;
  drug_allergy?: string;
  personal?: string;
  family_social?: string;
}

export interface ClinicalExaminationNotes {
  general?: string;
  systems?: string;
  local_specialized?: string;
}

export interface PccmFramework {
  fife?: string;
  common_ground?: string;
  whole_person?: string;
  health_promotion?: string;
}

export interface ManagementPlan {
  resuscitation?: string;
  definitive?: string;
  post_op_follow_up?: string;
  cost_considerations?: string;
}

export type ClinicalCaseStatus = 'draft' | 'supervisor_review' | 'approved';

export interface ClinicalCaseReport {
  id: string;
  workspace_id: string;
  case_number: number; // 1-15
  thematic_area: ThematicArea;
  title: string | null;
  patient_initials: string | null;
  hospital_number: string | null;
  age: number | null;
  gender: string | null;
  point_of_care: string | null;
  presenting_complaints: string | null;
  hpi_text: string | null;
  history_notes: ClinicalHistoryNotes;
  examination_notes: ClinicalExaminationNotes;
  pccm_framework: PccmFramework;
  genogram_data: GenogramData;
  family_tools_data: FamilyToolsData;
  management_plan: ManagementPlan;
  discussion_text: string | null;
  references_text: string | null;
  rubric_scores: Record<string, number>;
  defense_questions: { question: string; recommended_answer: string }[];
  status: ClinicalCaseStatus;
  updated_at: string;
}

export interface ClinicalLogbook {
  id: string;
  tenant_id: string | null;
  workforce_id: string | null;
  station_name: string;
  procedure_or_competency: string;
  required_count: number;
  completed_count: number;
  supervisor_signoffs: { signed_by_workforce_id: string | null; signed_by_name: string; date: string; note?: string }[];
  created_at: string;
  updated_at: string;
}

export type LogbookParsedStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AdminLogbookParsingQueueEntry {
  id: string;
  tenant_id: string | null;
  uploaded_by_workforce_id: string | null;
  file_url: string | null;
  raw_text_content: string | null;
  parsed_status: LogbookParsedStatus;
  extracted_curriculum: Record<string, unknown>;
  created_at: string;
}

// --- Family Medicine Tools (src/modules/casebook-logbook/lib/familyTools.ts) ---

export interface GenogramNode {
  id: string;
  label: string;
  generation: number; // 1 = grandparents, 2 = parents, 3 = index patient's generation
  sex: 'M' | 'F' | 'unknown';
  diseases: string[]; // e.g. ['Hypertension', 'Diabetes Mellitus', 'Sickle Cell Disease']
  deceased?: boolean;
  isIndexPatient?: boolean;
}

export interface GenogramRelationship {
  from: string; // GenogramNode id
  to: string; // GenogramNode id
  type: 'marriage' | 'divorce' | 'parent_child' | 'twin';
}

export interface GenogramData {
  nodes: GenogramNode[];
  relationships: GenogramRelationship[];
  disease_keys: string[]; // legend of diseases present anywhere in the tree
}

export interface FamilyApgarInput {
  adaptability: number; // 0-2
  partnership: number; // 0-2
  growth: number; // 0-2
  affection: number; // 0-2
  resolve: number; // 0-2
}

export type FamilyApgarInterpretation = 'severely_dysfunctional' | 'moderately_dysfunctional' | 'highly_functional';

export interface FamilyApgarResult extends FamilyApgarInput {
  total: number; // 0-10
  interpretation: FamilyApgarInterpretation;
}

export interface EcomapConnection {
  label: string;
  strength: 'strong' | 'stressful' | 'tenuous';
  category: string; // e.g. 'Church', 'Extended Family', 'Workplace', 'Healthcare System'
}

export interface EcomapData {
  center: string; // usually the family/household label
  connections: EcomapConnection[];
}

export interface FamilyCircleMember {
  label: string;
  closeness: 'close' | 'moderate' | 'distant';
}

export interface FamilyCircleData {
  members: FamilyCircleMember[];
}

export type DuvallStageNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface DuvallStage {
  stage: DuvallStageNumber;
  label: string;
  description: string;
}

export interface FamilyToolsData {
  family_apgar?: FamilyApgarResult;
  ecomap?: EcomapData;
  family_circle?: FamilyCircleData;
  duvall_stage?: DuvallStageNumber;
}

// --- Billing & Subscriptions (migration 17) ---

export type SubscriptionPlan = 'free' | 'pro_unlimited';
export type SubscriptionStatus = 'pending' | 'active' | 'cancelled' | 'expired';
export type PaymentProvider = 'paystack' | 'flutterwave';

// Mirrors user_subscriptions (migration 17). "user" = a workforce row —
// this app has no standalone user identity outside workforce.
export interface UserSubscription {
  id: string;
  tenant_id: string | null;
  workforce_id: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  provider: PaymentProvider;
  provider_reference: string;
  amount_ngn: number | null;
  customer_email: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  created_at: string;
  updated_at: string;
}

// --- Forms module generalization (migration 35) ---
// Additive scaffold alongside the existing live monthly-form flow
// (`submissions`/`collections`/ResidentFormView.tsx, untouched by this) —
// see PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7/§10 and migration 35's own
// header. Not yet wired into any UI beyond FormsBuilderPanel.tsx.

export interface FormFieldDefinition {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'boolean' | 'select' | 'file';
  required?: boolean;
  options?: string[]; // only meaningful for type: 'select'
}

export interface FormInstanceSchema {
  fields: FormFieldDefinition[];
}

// Mirrors form_instances (migration 35). tenant_id/doctor_id: exactly one
// is set, never both — an institutional (Chief-authored) instance has
// tenant_id set and doctor_id null; a personal, doctor-owned instance
// (migration 40) has doctor_id set and tenant_id null. See migration 40's
// header for the full doctor-ownership rationale (mirrors migration 25's
// research_workspaces/casebook_workspaces pattern).
export interface FormInstance {
  id: string;
  tenant_id: string | null;
  doctor_id: string | null;
  name: string;
  description: string | null;
  schema: FormInstanceSchema;
  created_by_workforce_id: string | null;
  is_active: boolean;
  created_at: string;
}

// Mirrors form_entries (migration 35). tenant_id is nullable as of
// migration 40 — an entry against a doctor-owned (tenant_id-NULL)
// form_instances row must itself be able to carry a NULL tenant_id.
// No doctor_id column here by design — see migration 40's header;
// ownership is derived via instance_id -> form_instances.doctor_id.
export interface FormEntry {
  id: string;
  instance_id: string;
  tenant_id: string | null;
  submitted_by_workforce_id: string | null;
  payload: Record<string, unknown>;
  status: string;
  created_at: string;
}

// Mirrors form_pipelines (migration 35). pipeline_type is free text
// (e.g. 'schedule_to_roster') — not a fixed union — see migration 35's
// header for why.
export interface FormPipeline {
  id: string;
  instance_id: string;
  pipeline_type: string;
  config: Record<string, unknown>;
  created_at: string;
}

// Returned by the payment-checkout Edge Function.
export interface PaymentCheckoutResult {
  provider: PaymentProvider;
  checkout_url: string;
  reference: string;
}
