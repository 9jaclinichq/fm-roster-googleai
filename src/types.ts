export type Category = 'Registrar' | 'Senior Registrar' | 'Medical Officer';

export interface WorkforceMember {
  id: string;
  full_name: string;
  category: Category;
  resident_code: string;
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
  admin_access_code: string;
  current_collection_id: string | null;
}

export interface SubmissionWithWorkforce extends Submission {
  workforce: {
    full_name: string;
    category: Category;
  };
}
