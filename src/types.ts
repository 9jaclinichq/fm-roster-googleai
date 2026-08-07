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

export type AnnouncementCategory = 'Roster' | 'Exam' | 'CME';

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
