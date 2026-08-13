import React, { useState, useEffect, lazy, Suspense } from 'react';
import { databaseService } from '../lib/databaseService';
import { LoadingShell } from './LoadingShell';

// Lazy-loaded: this tab pulls in its own document-upload/search UI and is
// only needed when the Chief actually opens the Knowledge Packs tab.
const KnowledgePackManagerView = lazy(() =>
  import('./KnowledgePackManagerView').then(m => ({ default: m.KnowledgePackManagerView }))
);
// Lazy-loaded: the Multi-Roster Manager pulls in the roster parser + a
// large drag-and-drop grid UI, only needed when this tab is opened.
const MultiRosterManagerView = lazy(() =>
  import('./MultiRosterManagerView').then(m => ({ default: m.MultiRosterManagerView }))
);
// Lazy-loaded: tenant customization (module toggles, curriculum alignment,
// AI tuning) added by the SaaS multi-tenancy pass — most Chiefs won't open
// this tab every session.
const TenantCustomizationView = lazy(() =>
  import('./TenantCustomizationView').then(m => ({ default: m.TenantCustomizationView }))
);
import { Collection, WorkforceMember, SubmissionWithWorkforce, Category, Submission, Announcement, AnnouncementCategory, DelegatedRole, SubadminRoleId } from '../types';
import {
  Users,
  Clock,
  CheckCircle,
  XCircle,
  Search,
  Filter,
  FileDown,
  Eye,
  Edit,
  UserPlus,
  Settings,
  Calendar,
  RefreshCw,
  Plus,
  Lock,
  Unlock,
  UserCheck,
  AlertTriangle,
  Key,
  ChevronRight,
  Sparkles,
  UserX,
  FileText,
  X,
  Megaphone,
  Pin,
  ShieldCheck,
  Link2,
  Unlink,
} from 'lucide-react';

const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = ['Roster', 'Exam', 'CME', 'Admin'];

const SUBADMIN_ROLES: { value: SubadminRoleId; label: string }[] = [
  { value: 'hod', label: 'Head of Department' },
  { value: 'rtc', label: 'Rotation/Training Coordinator' },
  { value: 'cme_coord', label: 'CME Coordinator' },
  { value: 'consultant', label: 'Consultant' },
];

interface ChiefDashboardViewProps {
  onLogout: () => void;
}

export const ChiefDashboardView: React.FC<ChiefDashboardViewProps> = ({ onLogout }) => {
  // The verified admin code, retained in localStorage at login time
  // (App.tsx). It authorizes the chief_* RPCs, which re-verify it
  // server-side on every call — it is never trusted blindly. Kept in state
  // (not a one-shot ref) so it stays current if the code is changed mid-session.
  const [adminCode, setAdminCode] = useState<string | null>(() => localStorage.getItem('fm_admin_code'));

  const [collection, setCollection] = useState<Collection | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [residentCodes, setResidentCodes] = useState<Record<string, string>>({});
  const [submissions, setSubmissions] = useState<SubmissionWithWorkforce[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'submissions' | 'pending' | 'workforce' | 'announcements' | 'roles' | 'knowledge' | 'roster' | 'customization' | 'settings'>('submissions');

  // Role delegation state
  const [delegatedRoles, setDelegatedRoles] = useState<DelegatedRole[]>([]);
  const [delegateWorkforceId, setDelegateWorkforceId] = useState<string>('');
  const [delegateRole, setDelegateRole] = useState<SubadminRoleId>('hod');
  const [delegateRoleFilter, setDelegateRoleFilter] = useState<SubadminRoleId | 'All'>('All');
  const [delegateError, setDelegateError] = useState<string>('');
  const [isDelegating, setIsDelegating] = useState<boolean>(false);

  // Announcements admin state
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [newAnnouncementTitle, setNewAnnouncementTitle] = useState<string>('');
  const [newAnnouncementBody, setNewAnnouncementBody] = useState<string>('');
  const [newAnnouncementCategory, setNewAnnouncementCategory] = useState<AnnouncementCategory>('Roster');
  const [newAnnouncementPinned, setNewAnnouncementPinned] = useState<boolean>(false);
  const [newAnnouncementError, setNewAnnouncementError] = useState<string>('');
  const [isPostingAnnouncement, setIsPostingAnnouncement] = useState<boolean>(false);
  
  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [leaveFilter, setLeaveFilter] = useState<string>('All');

  // Modal states
  const [selectedSubmission, setSelectedSubmission] = useState<SubmissionWithWorkforce | null>(null);
  const [editingSubmission, setEditingSubmission] = useState<SubmissionWithWorkforce | null>(null);
  const [isEditSubmitting, setIsEditSubmitting] = useState<boolean>(false);
  const [editError, setEditError] = useState<string>('');

  // Editing Submission fields
  const [editCurrentRotation, setEditCurrentRotation] = useState<string>('');
  const [editNextRotation, setEditNextRotation] = useState<string>('');
  const [editTakingLeave, setEditTakingLeave] = useState<boolean>(false);
  const [editLeaveType, setEditLeaveType] = useState<string>('Annual Leave');
  const [editLeaveStart, setEditLeaveStart] = useState<string>('');
  const [editLeaveEnd, setEditLeaveEnd] = useState<string>('');
  const [editLeaveApplied, setEditLeaveApplied] = useState<boolean>(false);
  const [editNotes, setEditNotes] = useState<string>('');

  // Workforce management state
  const [newMemberName, setNewMemberName] = useState<string>('');
  const [newMemberCategory, setNewMemberCategory] = useState<Category>('Registrar');
  const [newMemberError, setNewMemberError] = useState<string>('');
  const [editingMember, setEditingMember] = useState<WorkforceMember | null>(null);
  const [editMemberName, setEditMemberName] = useState<string>('');
  const [editMemberCategory, setEditMemberCategory] = useState<Category>('Registrar');

  // Link a workforce row to an individual doctor's self-registered account
  // (migration 18) — see chief_link_doctor_by_email in databaseService.ts.
  const [linkingMemberId, setLinkingMemberId] = useState<string | null>(null);
  const [linkDoctorEmail, setLinkDoctorEmail] = useState<string>('');
  const [linkDoctorError, setLinkDoctorError] = useState<string>('');
  const [isLinkingDoctor, setIsLinkingDoctor] = useState<boolean>(false);

  // Settings state
  const [newCollectionTitle, setNewCollectionTitle] = useState<string>('');
  const [newCollectionDeadline, setNewCollectionDeadline] = useState<string>('');
  const [newCollectionError, setNewCollectionError] = useState<string>('');
  
  const [changeDeadlineValue, setChangeDeadlineValue] = useState<string>('');
  const [changeDeadlineError, setChangeDeadlineError] = useState<string>('');

  const [adminAccessCodeValue, setAdminAccessCodeValue] = useState<string>('');
  const [adminAccessCodeError, setAdminAccessCodeError] = useState<string>('');

  const [actionSuccessMessage, setActionSuccessMessage] = useState<string>('');

  // Load Dashboard Data
  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      // 1. Get settings
      const settings = await databaseService.getSettings();

      // 2. Get collections
      const collectionsList = await databaseService.getCollections();
      setCollections(collectionsList);

      const activeColl = collectionsList.find(c => c.id === settings.current_collection_id) || collectionsList[0] || null;
      setCollection(activeColl);

      if (activeColl) {
        setChangeDeadlineValue(activeColl.deadline.substring(0, 16));
        // 3. Get submissions for active collection
        const subs = await databaseService.getSubmissions(activeColl.id);
        setSubmissions(subs);
      } else {
        setSubmissions([]);
      }

      // 4. Get workforce (codes are fetched separately via a privileged RPC)
      const wf = await databaseService.getWorkforce();
      setWorkforce(wf);

      // 5. Get announcements
      const ann = await databaseService.getAnnouncements();
      setAnnouncements(ann);

      // 6. Get delegated subadmin roles
      const roles = await databaseService.getDelegatedRoles();
      setDelegatedRoles(roles);

      if (adminCode) {
        try {
          const codes = await databaseService.getWorkforceCodes(adminCode);
          setResidentCodes(codes);
        } catch (codeErr) {
          console.warn('Failed to load resident codes:', codeErr);
        }
      }

    } catch (err) {
      console.warn('Failed to load dashboard data:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!adminCode) {
      // Session lost its verified admin code (e.g. storage cleared) — bounce back to login.
      onLogout();
      return;
    }
    loadDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const triggerSuccess = (msg: string) => {
    setActionSuccessMessage(msg);
    setTimeout(() => setActionSuccessMessage(''), 4000);
  };

  // CSV Export Logic
  const handleExportCSV = () => {
    if (!collection) return;
    
    const headers = [
      'Resident Name', 
      'Category', 
      'Current Rotation', 
      'Expected Next Rotation', 
      'Taking Leave', 
      'Leave Type', 
      'Leave Start Date', 
      'Leave End Date', 
      'Leave Applied to Department', 
      'Attached Document URLs',
      'Additional Notes',
      'Submission Timestamp'
    ];

    const rows = submissions.map(sub => [
      sub.workforce.full_name,
      sub.workforce.category,
      sub.current_rotation,
      sub.next_rotation,
      sub.taking_leave ? 'Yes' : 'No',
      sub.taking_leave ? (sub.leave_type || '') : 'N/A',
      sub.taking_leave ? (sub.leave_start || '') : 'N/A',
      sub.taking_leave ? (sub.leave_end || '') : 'N/A',
      sub.taking_leave ? (sub.leave_applied ? 'Yes' : 'No') : 'N/A',
      sub.taking_leave ? (sub.leave_document_urls || []).join('; ') : '',
      sub.notes || '',
      new Date(sub.created_at).toLocaleString()
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const sanitizedTitle = collection.title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    link.setAttribute('download', `fm_residents_dashboard_${sanitizedTitle}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerSuccess('CSV exported successfully!');
  };

  // Toggle Collection status (Open / Closed)
  const handleToggleCollectionStatus = async () => {
    if (!collection) return;
    const newStatus = collection.status === 'open' ? 'closed' : 'open';
    try {
      const updated = await databaseService.updateCollectionStatus(collection.id, newStatus);
      setCollection(updated);
      // Refresh collections list
      setCollections(prev => prev.map(c => c.id === updated.id ? updated : c));
      triggerSuccess(`Collection is now ${newStatus.toUpperCase()}.`);
    } catch (err) {
      console.warn(err);
    }
  };

  // Update deadline
  const handleChangeDeadline = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangeDeadlineError('');
    if (!collection) return;
    if (!changeDeadlineValue) {
      setChangeDeadlineError('Please select a valid deadline date & time.');
      return;
    }

    try {
      const updatedIso = new Date(changeDeadlineValue).toISOString();
      const updated = await databaseService.updateCollectionDeadline(collection.id, updatedIso);
      setCollection(updated);
      setCollections(prev => prev.map(c => c.id === updated.id ? updated : c));
      triggerSuccess('Deadline updated successfully.');
    } catch (err) {
      console.warn(err);
      setChangeDeadlineError('Failed to update deadline.');
    }
  };

  // Create Collection
  const handleCreateCollection = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewCollectionError('');
    
    if (!newCollectionTitle.trim()) {
      setNewCollectionError('Please enter a collection title.');
      return;
    }

    if (!newCollectionDeadline) {
      setNewCollectionError('Please set a deadline date & time.');
      return;
    }

    try {
      const deadlineIso = new Date(newCollectionDeadline).toISOString();
      const newColl = await databaseService.createCollection(newCollectionTitle.trim(), deadlineIso);
      
      setCollection(newColl);
      setNewCollectionTitle('');
      setNewCollectionDeadline('');
      
      // Reload everything to sync closed collections
      await loadDashboardData();
      triggerSuccess(`"${newColl.title}" is now open and active.`);
    } catch (err) {
      console.warn(err);
      setNewCollectionError('Failed to establish new collection.');
    }
  };

  // Update Admin Code
  const handleUpdateAdminCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminAccessCodeError('');

    if (!adminCode) {
      setAdminAccessCodeError('Session expired. Please log in again.');
      return;
    }

    if (!adminAccessCodeValue || adminAccessCodeValue.length < 4) {
      setAdminAccessCodeError('New admin code must be at least 4 characters.');
      return;
    }

    try {
      await databaseService.updateAdminCode(adminCode, adminAccessCodeValue);
      // Keep the stored session code in sync so subsequent privileged calls
      // (reset code, add member, etc.) keep working without re-login.
      localStorage.setItem('fm_admin_code', adminAccessCodeValue);
      setAdminCode(adminAccessCodeValue);
      setAdminAccessCodeValue('');
      triggerSuccess('Admin security access code updated.');
    } catch (err) {
      console.warn(err);
      setAdminAccessCodeError('Failed to save admin code. Double-check your session is still valid.');
    }
  };

  // Workforce: Toggle Active State
  const handleToggleActiveState = async (member: WorkforceMember) => {
    try {
      const updated = await databaseService.updateWorkforceMember(member.id, { active: !member.active });
      setWorkforce(prev => prev.map(w => w.id === member.id ? updated : w));
      triggerSuccess(`Member "${member.full_name}" is now ${updated.active ? 'ACTIVE' : 'DEACTIVATED'}.`);
    } catch (err) {
      console.warn(err);
    }
  };

  // Workforce: Reset Resident Access Code
  const handleResetCode = async (memberId: string) => {
    if (!adminCode) return;
    try {
      const newCode = await databaseService.resetResidentAccessCode(adminCode, memberId);
      setResidentCodes(prev => ({ ...prev, [memberId]: newCode }));
      const member = workforce.find(w => w.id === memberId);
      triggerSuccess(`Access code for "${member?.full_name || 'resident'}" reset to ${newCode}.`);
    } catch (err) {
      console.warn(err);
    }
  };

  // Workforce: Link/Unlink an individual doctor account (migration 18)
  const handleLinkDoctor = async (e: React.FormEvent, memberId: string) => {
    e.preventDefault();
    setLinkDoctorError('');

    if (!adminCode) {
      setLinkDoctorError('Session expired. Please log in again.');
      return;
    }
    if (!linkDoctorEmail.trim()) {
      setLinkDoctorError('Please enter the doctor\'s registered email.');
      return;
    }

    setIsLinkingDoctor(true);
    try {
      const result = await databaseService.chiefLinkDoctorByEmail(adminCode, memberId, linkDoctorEmail.trim());
      setWorkforce(prev => prev.map(w => (w.id === memberId ? { ...w, doctor_id: result.doctor_id } : w)));
      triggerSuccess(`Linked ${result.doctor_full_name || linkDoctorEmail.trim()}'s account to this workforce entry.`);
      setLinkingMemberId(null);
      setLinkDoctorEmail('');
    } catch (err) {
      console.warn(err);
      setLinkDoctorError(err instanceof Error ? err.message : 'Failed to link doctor account.');
    } finally {
      setIsLinkingDoctor(false);
    }
  };

  const handleUnlinkDoctor = async (memberId: string) => {
    if (!adminCode) return;
    try {
      await databaseService.chiefUnlinkDoctor(adminCode, memberId);
      setWorkforce(prev => prev.map(w => (w.id === memberId ? { ...w, doctor_id: null } : w)));
      const member = workforce.find(w => w.id === memberId);
      triggerSuccess(`Unlinked doctor account from "${member?.full_name || 'this workforce entry'}".`);
    } catch (err) {
      console.warn(err);
    }
  };

  // Workforce: Add Member
  const handleAddWorkforceMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewMemberError('');

    if (!adminCode) {
      setNewMemberError('Session expired. Please log in again.');
      return;
    }

    if (!newMemberName.trim()) {
      setNewMemberError('Full name is required.');
      return;
    }

    try {
      const newMember = await databaseService.addWorkforceMember(adminCode, {
        full_name: newMemberName.trim(),
        category: newMemberCategory,
      });

      setWorkforce(prev => [...prev, newMember].sort((a, b) => a.full_name.localeCompare(b.full_name)));
      if (newMember.resident_code) {
        setResidentCodes(prev => ({ ...prev, [newMember.id]: newMember.resident_code! }));
      }
      setNewMemberName('');
      triggerSuccess(`Added ${newMember.full_name} with Access Code: ${newMember.resident_code}`);
    } catch (err) {
      console.warn(err);
      setNewMemberError('Failed to add workforce member.');
    }
  };

  // Workforce: Edit Member Submit
  const handleEditWorkforceMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingMember) return;

    if (!editMemberName.trim()) return;

    try {
      const updated = await databaseService.updateWorkforceMember(editingMember.id, {
        full_name: editMemberName.trim(),
        category: editMemberCategory,
      });

      setWorkforce(prev => prev.map(w => w.id === editingMember.id ? updated : w));
      setEditingMember(null);
      triggerSuccess('Workforce member details updated.');
    } catch (err) {
      console.warn(err);
    }
  };

  // Announcements: Create
  const handleCreateAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewAnnouncementError('');

    if (!newAnnouncementTitle.trim()) {
      setNewAnnouncementError('Title is required.');
      return;
    }
    if (!newAnnouncementBody.trim()) {
      setNewAnnouncementError('Announcement body is required.');
      return;
    }

    setIsPostingAnnouncement(true);
    try {
      const created = await databaseService.createAnnouncement({
        title: newAnnouncementTitle.trim(),
        body: newAnnouncementBody.trim(),
        category: newAnnouncementCategory,
        pinned: newAnnouncementPinned,
      });
      setAnnouncements(prev => [created, ...prev]);
      setNewAnnouncementTitle('');
      setNewAnnouncementBody('');
      setNewAnnouncementPinned(false);
      triggerSuccess('Announcement posted to the department board.');
    } catch (err) {
      console.warn(err);
      setNewAnnouncementError('Failed to post announcement.');
    } finally {
      setIsPostingAnnouncement(false);
    }
  };

  // Announcements: Toggle Pin
  const handleToggleAnnouncementPin = async (announcement: Announcement) => {
    try {
      const updated = await databaseService.updateAnnouncement(announcement.id, { pinned: !announcement.pinned });
      setAnnouncements(prev => prev.map(a => a.id === announcement.id ? updated : a));
      triggerSuccess(`"${announcement.title}" ${updated.pinned ? 'pinned' : 'unpinned'}.`);
    } catch (err) {
      console.warn(err);
    }
  };

  // Role Delegation: Assign
  const handleAssignRole = async (e: React.FormEvent) => {
    e.preventDefault();
    setDelegateError('');

    if (!adminCode) {
      setDelegateError('Session expired. Please log in again.');
      return;
    }
    if (!delegateWorkforceId) {
      setDelegateError('Please select a workforce member.');
      return;
    }
    if (delegatedRoles.some(r => r.workforce_id === delegateWorkforceId && r.role_id === delegateRole)) {
      setDelegateError('This member already holds that role.');
      return;
    }

    setIsDelegating(true);
    try {
      await databaseService.assignUserRole(adminCode, delegateWorkforceId, delegateRole);
      const roles = await databaseService.getDelegatedRoles();
      setDelegatedRoles(roles);
      const member = workforce.find(w => w.id === delegateWorkforceId);
      triggerSuccess(`${member?.full_name || 'Member'} delegated as ${SUBADMIN_ROLES.find(r => r.value === delegateRole)?.label}.`);
      setDelegateWorkforceId('');
    } catch (err) {
      console.warn(err);
      setDelegateError('Failed to assign role.');
    } finally {
      setIsDelegating(false);
    }
  };

  // Role Delegation: Revoke
  const handleRevokeRole = async (role: DelegatedRole) => {
    if (!adminCode) return;
    try {
      await databaseService.removeUserRole(adminCode, role.id);
      setDelegatedRoles(prev => prev.filter(r => r.id !== role.id));
      triggerSuccess(`Revoked ${role.role_id} role from ${role.workforce?.full_name || 'member'}.`);
    } catch (err) {
      console.warn(err);
    }
  };

  // Open Edit Submission Modal
  const openEditSubmission = (sub: SubmissionWithWorkforce) => {
    setEditingSubmission(sub);
    setEditCurrentRotation(sub.current_rotation);
    setEditNextRotation(sub.next_rotation);
    setEditTakingLeave(sub.taking_leave);
    setEditLeaveType(sub.leave_type || 'Annual Leave');
    setEditLeaveStart(sub.leave_start || '');
    setEditLeaveEnd(sub.leave_end || '');
    setEditLeaveApplied(sub.leave_applied || false);
    setEditNotes(sub.notes || '');
    setEditError('');
  };

  // Submit Edited Submission on Behalf of Resident
  const handleEditSubmissionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError('');
    if (!editingSubmission) return;

    if (!editCurrentRotation.trim()) {
      setEditError('Current Rotation is required.');
      return;
    }

    if (!editNextRotation.trim()) {
      setEditError('Expected Rotation is required.');
      return;
    }

    if (editTakingLeave) {
      if (!editLeaveStart || !editLeaveEnd) {
        setEditError('Leave start and end dates are required when on leave.');
        return;
      }
      if (new Date(editLeaveStart) > new Date(editLeaveEnd)) {
        setEditError('Leave Start Date cannot exceed End Date.');
        return;
      }
    }

    setIsEditSubmitting(true);
    try {
      const updates: Partial<Submission> = {
        current_rotation: editCurrentRotation.trim(),
        next_rotation: editNextRotation.trim(),
        taking_leave: editTakingLeave,
        leave_type: editTakingLeave ? editLeaveType : null,
        leave_start: editTakingLeave ? editLeaveStart : null,
        leave_end: editTakingLeave ? editLeaveEnd : null,
        leave_applied: editTakingLeave ? editLeaveApplied : null,
        notes: editNotes.trim() ? editNotes.trim() : null,
      };

      const updatedSub = await databaseService.updateSubmissionDirectly(editingSubmission.id, updates);
      
      // Update local state
      setSubmissions(prev => prev.map(s => s.id === editingSubmission.id ? {
        ...s,
        ...updatedSub
      } : s));

      setEditingSubmission(null);
      triggerSuccess(`Submission for ${editingSubmission.workforce.full_name} has been updated.`);
    } catch (err) {
      console.warn(err);
      setEditError('Failed to save submission changes.');
    } finally {
      setIsEditSubmitting(false);
    }
  };

  // Calculations for dashboard
  const activeWorkforce = workforce.filter(w => w.active);
  const totalWorkforceCount = activeWorkforce.length;
  const submittedCount = submissions.length;
  const pendingCount = Math.max(0, totalWorkforceCount - submittedCount);

  // List of pending residents (active workforce members who have not submitted)
  const pendingResidents = activeWorkforce.filter(w => 
    !submissions.some(s => s.workforce_id === w.id)
  );

  // Filters for submissions table
  const filteredSubmissions = submissions.filter(sub => {
    const matchesSearch = sub.workforce.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          sub.current_rotation.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          sub.next_rotation.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesCategory = categoryFilter === 'All' || sub.workforce.category === categoryFilter;
    
    const matchesLeave = leaveFilter === 'All' || 
                         (leaveFilter === 'On Leave' && sub.taking_leave) ||
                         (leaveFilter === 'No Leave' && !sub.taking_leave);

    return matchesSearch && matchesCategory && matchesLeave;
  });

  // Calculate if active collection deadline passed
  const isPastDeadline = collection ? (new Date(collection.deadline).getTime() < Date.now()) : false;

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto my-12 p-8 text-center bg-white border border-slate-200 rounded-2xl shadow-sm">
        <RefreshCw size={32} className="text-slate-500 animate-spin mx-auto mb-3" />
        <p className="text-sm font-medium text-slate-600">Retrieving administrative data panels...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto my-8 px-4 sm:px-6 lg:px-8 space-y-6">
      {/* Toast Alert Success Banner */}
      {actionSuccessMessage && (
        <div className="bg-emerald-600 text-white px-4 py-3 rounded-xl shadow-lg flex items-center justify-between animate-slideDown max-w-lg mx-auto fixed top-20 left-0 right-0 z-50">
          <div className="flex items-center space-x-2 text-xs sm:text-sm font-semibold">
            <CheckCircle size={18} />
            <span>{actionSuccessMessage}</span>
          </div>
          <button onClick={() => setActionSuccessMessage('')} className="p-1 hover:bg-emerald-700 rounded cursor-pointer">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Admin Title Bar */}
      <div className="flex justify-between items-center flex-wrap gap-4 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div>
          <span className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">Administrative Session</span>
          <h2 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <span>Chief Resident Board</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Manage Family Medicine resident monthly postings and leave requests</p>
        </div>

        <button
          onClick={onLogout}
          className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-md text-xs font-semibold shadow-sm transition cursor-pointer"
        >
          Exit Dashboard
        </button>
      </div>

      {/* KPI Dashboard Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* KPI: Current Collection */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Current Collection</span>
          {collection ? (
            <div className="mt-2">
              <div className="font-extrabold text-slate-900 text-lg leading-tight truncate" title={collection.title}>
                {collection.title}
              </div>
              <div className="mt-1 flex items-center space-x-1">
                <span className={`h-2 w-2 rounded-full ${collection.status === 'open' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wider">
                  {collection.status === 'open' ? 'Open' : 'Closed'}
                </span>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-slate-400 font-medium text-sm">No Active Slots</div>
          )}
        </div>

        {/* KPI: Deadline */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Submission Deadline</span>
          {collection ? (
            <div className="mt-2">
              <div className={`font-extrabold text-sm leading-tight truncate ${isPastDeadline ? 'text-rose-600' : 'text-slate-900'}`}>
                {new Date(collection.deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
              <div className="mt-1 text-[10px] text-slate-500 font-semibold uppercase">
                {isPastDeadline ? 'Overdue / Locked' : 'Accepting Submissions'}
              </div>
            </div>
          ) : (
            <div className="mt-2 text-slate-400 font-medium text-sm">N/A</div>
          )}
        </div>

        {/* KPI: Workforce */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Total Workforce</span>
          <div className="mt-2 flex items-baseline space-x-1.5">
            <span className="font-extrabold text-3xl text-slate-900">{totalWorkforceCount}</span>
            <span className="text-[10px] text-slate-500 font-semibold uppercase">Active Members</span>
          </div>
        </div>

        {/* KPI: Submitted */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Submitted</span>
          <div className="mt-2 flex items-baseline space-x-1.5">
            <span className="font-extrabold text-3xl text-emerald-600">{submittedCount}</span>
            <span className="text-[10px] text-slate-500 font-semibold uppercase">
              {totalWorkforceCount > 0 ? `${Math.round((submittedCount/totalWorkforceCount)*100)}% Complete` : '0%'}
            </span>
          </div>
        </div>

        {/* KPI: Pending */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm flex flex-col justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Pending Residents</span>
          <div className="mt-2 flex items-baseline space-x-1.5">
            <span className={`font-extrabold text-3xl ${pendingCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {pendingCount}
            </span>
            <span className="text-[10px] text-slate-500 font-semibold uppercase">Outstanding</span>
          </div>
        </div>
      </div>

      {/* Tabs Switcher Navigation */}
      <div className="flex border-b border-slate-200 overflow-x-auto gap-4 scrollbar-none">
        <button
          onClick={() => setActiveTab('submissions')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'submissions'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Resident Submissions ({submissions.length})
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'pending'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Pending Residents ({pendingResidents.length})
        </button>
        <button
          onClick={() => setActiveTab('workforce')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'workforce'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Workforce Registry ({workforce.length})
        </button>
        <button
          onClick={() => setActiveTab('announcements')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'announcements'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Announcements Admin ({announcements.length})
        </button>
        <button
          onClick={() => setActiveTab('roles')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'roles'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Role Delegation ({delegatedRoles.length})
        </button>
        <button
          onClick={() => setActiveTab('knowledge')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'knowledge'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Knowledge Packs
        </button>
        <button
          onClick={() => setActiveTab('roster')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'roster'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Multi-Roster Manager
        </button>
        <button
          onClick={() => setActiveTab('customization')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'customization'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Customization
        </button>
        <button
          onClick={() => setActiveTab('settings')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'settings'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Collection & Settings
        </button>
      </div>

      {/* Main Tab Render Space */}
      <div className="min-h-[400px]">
        {/* TAB 1: SUBMISSIONS (Responses Table) */}
        {activeTab === 'submissions' && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden space-y-4 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 flex-wrap pb-4 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <FileText className="text-slate-400" size={18} />
                <h3 className="font-bold text-slate-800 text-sm md:text-base">Resident Responses</h3>
              </div>
              {submissions.length > 0 && (
                <button
                  onClick={handleExportCSV}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-bold shadow-sm transition cursor-pointer"
                >
                  <FileDown size={14} />
                  <span>Export CSV</span>
                </button>
              )}
            </div>

            {/* Submissions Search & Filters */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Search */}
              <div className="relative">
                <Search size={14} className="text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search by resident or rotation..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                />
              </div>

              {/* Category Filter */}
              <div className="flex items-center space-x-2">
                <Filter size={12} className="text-slate-400" />
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 cursor-pointer"
                >
                  <option value="All">All Categories</option>
                  <option value="Registrar">Registrars</option>
                  <option value="Senior Registrar">Senior Registrars</option>
                  <option value="Medical Officer">Medical Officers</option>
                </select>
              </div>

              {/* Leave Filter */}
              <div className="flex items-center space-x-2">
                <Calendar size={12} className="text-slate-400" />
                <select
                  value={leaveFilter}
                  onChange={(e) => setLeaveFilter(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 cursor-pointer"
                >
                  <option value="All">All Leave Status</option>
                  <option value="On Leave">Taking Leave</option>
                  <option value="No Leave">No Leave</option>
                </select>
              </div>
            </div>

            {/* Responses Grid / Table */}
            <div className="overflow-x-auto border border-slate-200 rounded-xl">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200 tracking-wider">
                    <th className="px-4 py-3">Resident</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Current Rotation</th>
                    <th className="px-4 py-3">Next Rotation</th>
                    <th className="px-4 py-3">Leave Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                  {filteredSubmissions.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-8 text-slate-400">
                        {submissions.length === 0 
                          ? 'No responses submitted yet for this collection.' 
                          : 'No submissions matched your current search filters.'}
                      </td>
                    </tr>
                  ) : (
                    filteredSubmissions.map((sub) => (
                      <tr key={sub.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3.5 font-bold text-slate-900">{sub.workforce.full_name}</td>
                        <td className="px-4 py-3.5 text-slate-500">{sub.workforce.category}</td>
                        <td className="px-4 py-3.5">{sub.current_rotation}</td>
                        <td className="px-4 py-3.5">{sub.next_rotation}</td>
                        <td className="px-4 py-3.5">
                          {sub.taking_leave ? (
                            <div className="inline-flex flex-col">
                              <span className="bg-amber-100 text-amber-900 text-[10px] font-bold px-2 py-0.5 rounded-full w-max">
                                On Leave ({sub.leave_type})
                              </span>
                              <span className="text-[9px] text-slate-400 mt-0.5">
                                {sub.leave_start?.substring(5)} to {sub.leave_end?.substring(5)}
                              </span>
                            </div>
                          ) : (
                            <span className="text-slate-400">No Leave</span>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-right space-x-2 shrink-0">
                          <button
                            onClick={() => setSelectedSubmission(sub)}
                            className="inline-flex items-center justify-center p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-950 rounded-lg transition cursor-pointer"
                            title="View submission details"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => openEditSubmission(sub)}
                            className="inline-flex items-center justify-center p-1.5 hover:bg-slate-100 text-slate-600 hover:text-slate-950 rounded-lg transition cursor-pointer"
                            title="Edit resident's submission details"
                          >
                            <Edit size={14} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 2: PENDING RESIDENTS */}
        {activeTab === 'pending' && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
            <div className="pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 text-sm md:text-base">Pending Submissions</h3>
              <p className="text-xs text-slate-500">Active residents who have not yet submitted their information for the current collection.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pendingResidents.length === 0 ? (
                <div className="md:col-span-3 text-center py-8 text-slate-400 bg-slate-50 rounded-xl border border-slate-200">
                  <UserCheck size={32} className="text-emerald-500 mx-auto mb-2" />
                  <p className="text-sm font-semibold text-slate-700">All active residents have submitted!</p>
                  <p className="text-xs text-slate-400 mt-0.5">100% collection compliance reached.</p>
                </div>
              ) : (
                pendingResidents.map((member) => (
                  <div key={member.id} className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col justify-between space-y-3">
                    <div>
                      <div className="font-bold text-slate-950 text-sm sm:text-base">{member.full_name}</div>
                      <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">{member.category}</div>
                    </div>
                    
                    <div className="bg-white border border-slate-200 rounded-lg p-2.5 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-slate-400 font-medium">Access Code:</span>
                        <div className="font-mono font-extrabold text-slate-800 tracking-wider mt-0.5">{residentCodes[member.id] || '······'}</div>
                      </div>
                      <button
                        onClick={() => handleResetCode(member.id)}
                        className="px-2 py-1 hover:bg-slate-100 text-slate-600 hover:text-slate-950 rounded border border-slate-200 font-semibold text-[10px] transition"
                        title="Regenerate code"
                      >
                        Reset Code
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* TAB 3: WORKFORCE REGISTRY */}
        {activeTab === 'workforce' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left side: Workforce Member Grid */}
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
              <div className="pb-3 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 text-sm md:text-base">Workforce Registry ({workforce.length})</h3>
                <p className="text-xs text-slate-500">Deactivated members are temporarily excluded from login & current metrics.</p>
              </div>

              {/* Workforce Table */}
              <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-[10px] font-bold text-slate-500 uppercase border-b border-slate-200 tracking-wider">
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Category</th>
                      <th className="px-4 py-3">Access Code</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs font-medium text-slate-700">
                    {workforce.map((member) => (
                      <React.Fragment key={member.id}>
                      <tr className="hover:bg-slate-50/50">
                        <td className="px-4 py-3 font-bold text-slate-900">{member.full_name}</td>
                        <td className="px-4 py-3 text-slate-500">{member.category}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono font-extrabold text-slate-700 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
                            {residentCodes[member.id] || '······'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleToggleActiveState(member)}
                            className={`inline-flex items-center space-x-1 px-2.5 py-1 rounded-full text-[10px] font-bold border transition shrink-0 cursor-pointer ${
                              member.active
                                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                                : 'bg-rose-50 text-rose-800 border-rose-200'
                            }`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${member.active ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                            <span>{member.active ? 'Active' : 'Inactive'}</span>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right space-x-2 shrink-0">
                          <button
                            onClick={() => {
                              setEditingMember(member);
                              setEditMemberName(member.full_name);
                              setEditMemberCategory(member.category);
                            }}
                            className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-950 rounded transition cursor-pointer"
                            title="Edit Name/Category"
                          >
                            <Edit size={13} />
                          </button>
                          <button
                            onClick={() => handleResetCode(member.id)}
                            className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-950 rounded transition cursor-pointer"
                            title="Regenerate Access Code"
                          >
                            <RefreshCw size={13} />
                          </button>
                          {member.doctor_id ? (
                            <button
                              onClick={() => handleUnlinkDoctor(member.id)}
                              className="p-1 hover:bg-slate-100 text-emerald-600 hover:text-emerald-800 rounded transition cursor-pointer"
                              title="Unlink Doctor Account"
                            >
                              <Unlink size={13} />
                            </button>
                          ) : member.active ? (
                            <button
                              onClick={() => {
                                setLinkingMemberId(linkingMemberId === member.id ? null : member.id);
                                setLinkDoctorEmail('');
                                setLinkDoctorError('');
                              }}
                              className="p-1 hover:bg-slate-100 text-slate-500 hover:text-slate-950 rounded transition cursor-pointer"
                              title="Link Doctor Account"
                            >
                              <Link2 size={13} />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                      {linkingMemberId === member.id && (
                        <tr className="bg-slate-50/70">
                          <td colSpan={5} className="px-4 py-3">
                            <form
                              onSubmit={(e) => handleLinkDoctor(e, member.id)}
                              className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"
                            >
                              <input
                                type="email"
                                required
                                value={linkDoctorEmail}
                                onChange={(e) => setLinkDoctorEmail(e.target.value)}
                                placeholder="Doctor's registered email"
                                className="flex-1 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 transition"
                              />
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="submit"
                                  disabled={isLinkingDoctor}
                                  className="px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg text-[11px] font-bold transition cursor-pointer"
                                >
                                  {isLinkingDoctor ? 'Linking...' : 'Link Account'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setLinkingMemberId(null)}
                                  className="p-2 hover:bg-slate-100 text-slate-500 rounded-lg transition cursor-pointer"
                                >
                                  <X size={14} />
                                </button>
                              </div>
                            </form>
                            {linkDoctorError && (
                              <p className="text-[11px] text-rose-600 font-semibold mt-1.5">{linkDoctorError}</p>
                            )}
                            <p className="text-[10px] text-slate-400 mt-1.5">
                              Links this workforce entry to an already-registered individual doctor account by email.
                            </p>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right side: Add Workforce Member or Edit Form */}
            <div className="space-y-6">
              {/* Edit Member Form */}
              {editingMember ? (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
                  <div className="pb-2 border-b border-slate-100 flex justify-between items-center">
                    <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Edit Workforce Member</h4>
                    <button onClick={() => setEditingMember(null)} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                      <X size={16} />
                    </button>
                  </div>

                  <form onSubmit={handleEditWorkforceMember} className="space-y-4 text-xs sm:text-sm">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 uppercase">Full Name</label>
                      <input
                        type="text"
                        value={editMemberName}
                        onChange={(e) => setEditMemberName(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700 uppercase">Category</label>
                      <select
                        value={editMemberCategory}
                        onChange={(e) => setEditMemberCategory(e.target.value as Category)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 cursor-pointer"
                      >
                        <option value="Registrar">Registrar</option>
                        <option value="Senior Registrar">Senior Registrar</option>
                        <option value="Medical Officer">Medical Officer</option>
                      </select>
                    </div>

                    <div className="flex space-x-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingMember(null)}
                        className="w-1/2 py-2 border border-slate-200 hover:bg-slate-50 font-bold rounded-xl text-xs transition cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="w-1/2 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                      >
                        Save Changes
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                /* Add Member Form */
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
                  <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
                    <UserPlus size={16} className="text-slate-500" />
                    <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Add New Resident</h4>
                  </div>

                  {newMemberError && (
                    <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs flex items-center space-x-1">
                      <AlertTriangle size={12} />
                      <span>{newMemberError}</span>
                    </div>
                  )}

                  <form onSubmit={handleAddWorkforceMember} className="space-y-4 text-xs sm:text-sm">
                    <div className="space-y-1">
                      <label htmlFor="new-name" className="text-xs font-bold text-slate-700 uppercase">Full Name</label>
                      <input
                        id="new-name"
                        type="text"
                        placeholder="e.g. Dr. John Doe"
                        value={newMemberName}
                        onChange={(e) => setNewMemberName(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor="new-category" className="text-xs font-bold text-slate-700 uppercase">Category</label>
                      <select
                        id="new-category"
                        value={newMemberCategory}
                        onChange={(e) => setNewMemberCategory(e.target.value as Category)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 cursor-pointer"
                      >
                        <option value="Registrar">Registrar</option>
                        <option value="Senior Registrar">Senior Registrar</option>
                        <option value="Medical Officer">Medical Officer</option>
                      </select>
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow-sm transition transform active:scale-95 cursor-pointer"
                    >
                      Add & Generate Code
                    </button>
                  </form>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: ANNOUNCEMENTS ADMIN */}
        {activeTab === 'announcements' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* List of existing announcements */}
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
              <div className="pb-3 border-b border-slate-100 flex items-center space-x-2">
                <Megaphone className="text-slate-500" size={16} />
                <h3 className="font-bold text-slate-800 text-sm md:text-base">Department Announcements ({announcements.length})</h3>
              </div>

              {announcements.length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">No announcements posted yet.</div>
              ) : (
                <div className="space-y-2">
                  {announcements.map((a) => (
                    <div key={a.id} className={`p-3 rounded-xl border flex items-start justify-between gap-3 ${a.pinned ? 'border-amber-300 bg-amber-50/40' : 'border-slate-200'}`}>
                      <div className="min-w-0">
                        <div className="flex items-center flex-wrap gap-2 mb-1">
                          <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider border bg-slate-100 text-slate-600 border-slate-200">
                            #{a.category}
                          </span>
                          {a.pinned && (
                            <span className="inline-flex items-center space-x-1 text-amber-700 text-[9px] font-bold uppercase tracking-wider">
                              <Pin size={9} />
                              <span>Pinned</span>
                            </span>
                          )}
                        </div>
                        <div className="font-bold text-slate-900 text-sm truncate">{a.title}</div>
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{a.body}</p>
                      </div>
                      <button
                        onClick={() => handleToggleAnnouncementPin(a)}
                        className={`shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold border transition cursor-pointer ${
                          a.pinned
                            ? 'bg-white text-amber-700 border-amber-200 hover:bg-amber-50'
                            : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {a.pinned ? 'Unpin' : 'Pin'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Create Announcement Form */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
              <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
                <Plus size={16} className="text-slate-500" />
                <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Post New Announcement</h4>
              </div>

              {newAnnouncementError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs flex items-center space-x-1">
                  <AlertTriangle size={12} />
                  <span>{newAnnouncementError}</span>
                </div>
              )}

              <form onSubmit={handleCreateAnnouncement} className="space-y-4 text-xs sm:text-sm">
                <div className="space-y-1">
                  <label htmlFor="ann-title" className="text-xs font-bold text-slate-700 uppercase">Title</label>
                  <input
                    id="ann-title"
                    type="text"
                    placeholder="e.g. October Duty Roster Published"
                    value={newAnnouncementTitle}
                    onChange={(e) => setNewAnnouncementTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="ann-body" className="text-xs font-bold text-slate-700 uppercase">Message</label>
                  <textarea
                    id="ann-body"
                    rows={4}
                    placeholder="Announcement details..."
                    value={newAnnouncementBody}
                    onChange={(e) => setNewAnnouncementBody(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="ann-category" className="text-xs font-bold text-slate-700 uppercase">Category</label>
                  <select
                    id="ann-category"
                    value={newAnnouncementCategory}
                    onChange={(e) => setNewAnnouncementCategory(e.target.value as AnnouncementCategory)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 cursor-pointer"
                  >
                    {ANNOUNCEMENT_CATEGORIES.map(cat => (
                      <option key={cat} value={cat}>#{cat}</option>
                    ))}
                  </select>
                </div>

                <label className="flex items-center space-x-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newAnnouncementPinned}
                    onChange={(e) => setNewAnnouncementPinned(e.target.checked)}
                    className="rounded text-slate-950 focus:ring-slate-950"
                  />
                  <span className="text-xs font-semibold text-slate-700">Pin to top of board</span>
                </label>

                <button
                  type="submit"
                  disabled={isPostingAnnouncement}
                  className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-xl text-xs shadow-sm transition transform active:scale-95 cursor-pointer"
                >
                  {isPostingAnnouncement ? 'Posting...' : 'Post Announcement'}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 5: ROLE DELEGATION */}
        {activeTab === 'roles' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* List of delegated roles */}
            <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-6 space-y-4">
              <div className="pb-3 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="text-slate-500" size={16} />
                  <h3 className="font-bold text-slate-800 text-sm md:text-base">Active Subadmins ({delegatedRoles.length})</h3>
                </div>
                <select
                  value={delegateRoleFilter}
                  onChange={(e) => setDelegateRoleFilter(e.target.value as SubadminRoleId | 'All')}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500 cursor-pointer"
                >
                  <option value="All">All Roles</option>
                  {SUBADMIN_ROLES.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>

              {delegatedRoles.filter(r => delegateRoleFilter === 'All' || r.role_id === delegateRoleFilter).length === 0 ? (
                <div className="text-center py-8 text-slate-400 text-sm">No subadmins delegated yet.</div>
              ) : (
                <div className="space-y-2">
                  {delegatedRoles
                    .filter(r => delegateRoleFilter === 'All' || r.role_id === delegateRoleFilter)
                    .map(role => (
                      <div key={role.id} className="p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-sm truncate">{role.workforce?.full_name || 'Unknown member'}</div>
                          <div className="flex items-center space-x-2 mt-0.5">
                            <span className="text-[10px] text-slate-500">{role.workforce?.category}</span>
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 border border-blue-200">
                              {SUBADMIN_ROLES.find(r => r.value === role.role_id)?.label || role.role_id}
                            </span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRevokeRole(role)}
                          className="shrink-0 px-2.5 py-1 rounded-md text-[10px] font-bold border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 transition cursor-pointer"
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {/* Delegate a role form */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
              <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
                <UserPlus size={16} className="text-slate-500" />
                <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Delegate a Role</h4>
              </div>

              {delegateError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs flex items-center space-x-1">
                  <AlertTriangle size={12} />
                  <span>{delegateError}</span>
                </div>
              )}

              <form onSubmit={handleAssignRole} className="space-y-4 text-xs sm:text-sm">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 uppercase">Workforce Member</label>
                  <select
                    value={delegateWorkforceId}
                    onChange={(e) => setDelegateWorkforceId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 cursor-pointer"
                  >
                    <option value="">Select a member...</option>
                    {workforce.map(w => (
                      <option key={w.id} value={w.id}>{w.full_name} ({w.category})</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700 uppercase">Role</label>
                  <select
                    value={delegateRole}
                    onChange={(e) => setDelegateRole(e.target.value as SubadminRoleId)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950 cursor-pointer"
                  >
                    {SUBADMIN_ROLES.map(r => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={isDelegating}
                  className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-xl text-xs shadow-sm transition transform active:scale-95 cursor-pointer"
                >
                  {isDelegating ? 'Delegating...' : 'Delegate Role'}
                </button>
              </form>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Delegated members log in with their normal resident access code — an extra "Consultant Review" tab
                appears automatically once their role is active.
              </p>
            </div>
          </div>
        )}

        {/* TAB 6: KNOWLEDGE PACKS */}
        {activeTab === 'knowledge' && (
          <Suspense fallback={<LoadingShell />}>
            <KnowledgePackManagerView />
          </Suspense>
        )}

        {/* TAB 7: MULTI-ROSTER MANAGER */}
        {activeTab === 'roster' && (
          <Suspense fallback={<LoadingShell />}>
            <MultiRosterManagerView />
          </Suspense>
        )}

        {/* TAB 8: TENANT CUSTOMIZATION */}
        {activeTab === 'customization' && (
          <Suspense fallback={<LoadingShell />}>
            <TenantCustomizationView />
          </Suspense>
        )}

        {/* TAB 9: SETTINGS & COLLECTIONS */}
        {activeTab === 'settings' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Create Collection Column */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
              <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
                <Calendar size={16} className="text-slate-500" />
                <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Initiate Monthly Collection</h4>
              </div>
              
              <div className="bg-amber-50 text-amber-900 border border-amber-200 p-3 rounded-lg text-xs leading-relaxed flex items-start space-x-2">
                <AlertTriangle size={15} className="shrink-0 mt-0.5" />
                <span>
                  <strong>Important Transaction Rule:</strong> Establishing a new collection will automatically close and lock submissions on all other previously active collection boards.
                </span>
              </div>

              {newCollectionError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2.5 rounded-lg text-xs">
                  {newCollectionError}
                </div>
              )}

              <form onSubmit={handleCreateCollection} className="space-y-4 text-xs sm:text-sm">
                <div className="space-y-1">
                  <label htmlFor="coll-title" className="text-xs font-bold text-slate-700 uppercase">Collection Title</label>
                  <input
                    id="coll-title"
                    type="text"
                    placeholder="e.g. August 2026 Collection"
                    value={newCollectionTitle}
                    onChange={(e) => setNewCollectionTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                  />
                </div>

                <div className="space-y-1">
                  <label htmlFor="coll-deadline" className="text-xs font-bold text-slate-700 uppercase">Submission Deadline</label>
                  <input
                    id="coll-deadline"
                    type="datetime-local"
                    value={newCollectionDeadline}
                    onChange={(e) => setNewCollectionDeadline(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2.5 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl text-xs shadow transition cursor-pointer"
                >
                  Create & Launch Collection
                </button>
              </form>
            </div>

            {/* Manage Current Collection & Admin Details */}
            <div className="space-y-6">
              {/* Current Status Form */}
              {collection && (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
                  <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
                    <Settings size={16} className="text-slate-500" />
                    <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Active Collection Details</h4>
                  </div>

                  <div className="flex items-center justify-between text-xs sm:text-sm">
                    <div>
                      <span className="text-xs text-slate-500 font-medium">Monthly Slot:</span>
                      <div className="font-bold text-slate-900">{collection.title}</div>
                    </div>

                    <button
                      onClick={handleToggleCollectionStatus}
                      className={`inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border cursor-pointer ${
                        collection.status === 'open'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-rose-50 text-rose-800 border-rose-200 hover:bg-rose-100'
                      }`}
                    >
                      {collection.status === 'open' ? (
                        <>
                          <Unlock size={12} />
                          <span>Status: OPEN</span>
                        </>
                      ) : (
                        <>
                          <Lock size={12} />
                          <span>Status: LOCKED</span>
                        </>
                      )}
                    </button>
                  </div>

                  <form onSubmit={handleChangeDeadline} className="space-y-3 pt-2 text-xs sm:text-sm">
                    {changeDeadlineError && (
                      <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2 text-xs rounded">
                        {changeDeadlineError}
                      </div>
                    )}
                    <div className="space-y-1">
                      <label htmlFor="change-deadline" className="text-xs font-bold text-slate-700 uppercase">Edit Deadline</label>
                      <input
                        id="change-deadline"
                        type="datetime-local"
                        value={changeDeadlineValue}
                        onChange={(e) => setChangeDeadlineValue(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                      />
                    </div>
                    <button
                      type="submit"
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
                    >
                      Update Deadline Time
                    </button>
                  </form>
                </div>
              )}

              {/* Administrative Access Code Settings */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-4">
                <div className="pb-2 border-b border-slate-100 flex items-center space-x-2">
                  <Key size={16} className="text-slate-500" />
                  <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Admin Access Security</h4>
                </div>

                {adminAccessCodeError && (
                  <div className="bg-rose-50 border border-rose-200 text-rose-800 p-2 text-xs rounded">
                    {adminAccessCodeError}
                  </div>
                )}

                <form onSubmit={handleUpdateAdminCode} className="space-y-3 text-xs sm:text-sm">
                  <div className="space-y-1">
                    <label htmlFor="change-admin-code" className="text-xs font-bold text-slate-700 uppercase">Set New Admin Access Code</label>
                    <input
                      id="change-admin-code"
                      type="text"
                      placeholder="Enter a new admin access code"
                      value={adminAccessCodeValue}
                      onChange={(e) => setAdminAccessCodeValue(e.target.value.trim())}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-blue-100 focus:border-blue-500"
                    />
                    <p className="text-[10px] text-slate-400 leading-relaxed font-medium">
                      For security, the current code is never displayed here. Entering a new one replaces it immediately.
                    </p>
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs shadow-sm transition cursor-pointer"
                  >
                    Save New Admin Code
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: VIEW RESPONSE DETAILS */}
      {selectedSubmission && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-100 flex flex-col shadow-2xl">
            {/* Header */}
            <div className="bg-gradient-to-br from-blue-700 to-indigo-900 px-6 py-4 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold text-base sm:text-lg">{selectedSubmission.workforce.full_name}</h3>
                <p className="text-[10px] text-blue-200 font-bold uppercase tracking-wider">{selectedSubmission.workforce.category} &bull; Monthly Submission</p>
              </div>
              <button
                onClick={() => setSelectedSubmission(null)}
                className="text-white/80 hover:text-white p-1 hover:bg-white/10 rounded cursor-pointer transition"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-6 sm:p-8 space-y-6 text-xs sm:text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Current Rotation</span>
                  <div className="font-bold text-slate-900 mt-0.5">{selectedSubmission.current_rotation}</div>
                </div>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Expected Next Rotation</span>
                  <div className="font-bold text-slate-900 mt-0.5">{selectedSubmission.next_rotation}</div>
                </div>
              </div>

              {/* Leave Info */}
              <div className="border-t border-slate-100 pt-4 space-y-3">
                <h4 className="font-bold text-slate-850 uppercase text-[10px] tracking-wider text-slate-500">Leave Parameters</h4>
                
                {selectedSubmission.taking_leave ? (
                  <div className="bg-amber-50/50 border border-amber-200 rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <span className="text-[9px] text-slate-500 font-bold uppercase">Leave Type</span>
                        <div className="font-bold text-amber-900 mt-0.5">{selectedSubmission.leave_type}</div>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 font-bold uppercase">Applied to HOD?</span>
                        <div className="font-bold text-amber-900 mt-0.5">{selectedSubmission.leave_applied ? 'Yes' : 'No'}</div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 border-t border-amber-200/50 pt-2.5">
                      <div>
                        <span className="text-[9px] text-slate-500 font-bold uppercase">Start Date</span>
                        <div className="font-semibold text-slate-800 mt-0.5">{selectedSubmission.leave_start}</div>
                      </div>
                      <div>
                        <span className="text-[9px] text-slate-500 font-bold uppercase">End Date</span>
                        <div className="font-semibold text-slate-800 mt-0.5">{selectedSubmission.leave_end}</div>
                      </div>
                    </div>

                    {/* Document downloads */}
                    {selectedSubmission.leave_document_urls && selectedSubmission.leave_document_urls.length > 0 && (
                      <div className="border-t border-amber-200/50 pt-2.5">
                        <span className="text-[9px] text-slate-500 font-bold uppercase block mb-1.5">Leave Attachments ({selectedSubmission.leave_document_urls.length})</span>
                        <div className="space-y-1.5">
                          {selectedSubmission.leave_document_urls.map((url, idx) => {
                            const isMock = url.startsWith('blob:') || url.startsWith('https://example.com');
                            const docName = isMock 
                              ? `Leave_Document_${idx+1}`
                              : decodeURIComponent(url.split('/').pop() || `Attachment_${idx+1}`).split('_').slice(1).join('_');
                            return (
                              <a
                                key={idx}
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center space-x-2 text-xs font-semibold text-slate-800 hover:text-slate-950 bg-white p-2 rounded-lg border border-slate-200 hover:shadow-sm"
                              >
                                <FileText size={14} className="text-slate-400 shrink-0" />
                                <span className="truncate max-w-[400px] underline">{docName}</span>
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-slate-500 italic py-2">No leave scheduled next month.</div>
                )}
              </div>

              {/* Notes */}
              <div className="border-t border-slate-100 pt-4">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Additional Resident Notes</span>
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-slate-800 leading-relaxed font-medium mt-1">
                  {selectedSubmission.notes || <span className="text-slate-400 italic">No notes provided.</span>}
                </div>
              </div>

              {/* Timestamp */}
              <div className="text-[10px] text-slate-400 text-right font-medium">
                Submitted on: {new Date(selectedSubmission.created_at).toLocaleString()}
                {selectedSubmission.updated_at !== selectedSubmission.created_at && (
                  <span className="block italic">Updated on: {new Date(selectedSubmission.updated_at).toLocaleString()}</span>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-slate-50 border-t border-slate-100 px-6 py-4 flex justify-end shrink-0">
              <button
                onClick={() => setSelectedSubmission(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition cursor-pointer"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: EDIT SUBMISSION ON BEHALF OF RESIDENT */}
      {editingSubmission && (
        <div className="fixed inset-0 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn">
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-100 flex flex-col shadow-2xl">
            {/* Header */}
            <div className="bg-slate-950 px-6 py-4 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="font-bold text-base sm:text-lg">Edit Submission</h3>
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Resident: {editingSubmission.workforce.full_name}</p>
              </div>
              <button
                onClick={() => setEditingSubmission(null)}
                className="text-slate-300 hover:text-white p-1 hover:bg-slate-900 rounded cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Content Form */}
            <form onSubmit={handleEditSubmissionSubmit} className="p-6 sm:p-8 space-y-5 text-xs sm:text-sm flex-1">
              {editError && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-xl p-3 flex items-center space-x-1">
                  <AlertTriangle size={14} />
                  <span>{editError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Current Rotation */}
                <div className="space-y-1">
                  <label htmlFor="edit-curr-rot" className="text-xs font-bold text-slate-700 uppercase">Current Rotation</label>
                  <input
                    id="edit-curr-rot"
                    type="text"
                    value={editCurrentRotation}
                    onChange={(e) => setEditCurrentRotation(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-slate-950"
                  />
                </div>

                {/* Next Rotation */}
                <div className="space-y-1">
                  <label htmlFor="edit-next-rot" className="text-xs font-bold text-slate-700 uppercase">Expected Next Rotation</label>
                  <input
                    id="edit-next-rot"
                    type="text"
                    value={editNextRotation}
                    onChange={(e) => setEditNextRotation(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-slate-950"
                  />
                </div>
              </div>

              {/* Taking Leave Toggle */}
              <div className="flex items-center justify-between border-t border-slate-150 pt-3">
                <div>
                  <span className="font-bold text-slate-800 text-xs uppercase block">Taking Leave?</span>
                  <span className="text-[10px] text-slate-500">Scheduled leave parameter overrides</span>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                  <button
                    type="button"
                    onClick={() => setEditTakingLeave(false)}
                    className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${!editTakingLeave ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
                  >
                    No
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditTakingLeave(true)}
                    className={`px-3 py-1 rounded text-xs font-bold transition cursor-pointer ${editTakingLeave ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}
                  >
                    Yes
                  </button>
                </div>
              </div>

              {editTakingLeave && (
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-4 animate-slideDown">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="edit-leave-type" className="font-semibold text-slate-700">Leave Type</label>
                      <select
                        id="edit-leave-type"
                        value={editLeaveType}
                        onChange={(e) => setEditLeaveType(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none cursor-pointer"
                      >
                        <option>Annual Leave</option>
                        <option>Maternity Leave</option>
                        <option>Paternity Leave</option>
                        <option>Sick Leave</option>
                        <option>Compassionate Leave</option>
                        <option>Study Leave</option>
                        <option>Other</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="font-semibold text-slate-700 block">Applied to Dept?</label>
                      <div className="flex items-center space-x-4 h-8">
                        <label className="inline-flex items-center space-x-1 cursor-pointer">
                          <input
                            type="radio"
                            checked={editLeaveApplied === true}
                            onChange={() => setEditLeaveApplied(true)}
                            className="text-slate-950 focus:ring-slate-950"
                          />
                          <span>Yes</span>
                        </label>
                        <label className="inline-flex items-center space-x-1 cursor-pointer">
                          <input
                            type="radio"
                            checked={editLeaveApplied === false}
                            onChange={() => setEditLeaveApplied(false)}
                            className="text-slate-950 focus:ring-slate-950"
                          />
                          <span>No</span>
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label htmlFor="edit-start-date" className="font-semibold text-slate-700">Start Date</label>
                      <input
                        id="edit-start-date"
                        type="date"
                        value={editLeaveStart}
                        onChange={(e) => setEditLeaveStart(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor="edit-end-date" className="font-semibold text-slate-700">End Date</label>
                      <input
                        id="edit-end-date"
                        type="date"
                        value={editLeaveEnd}
                        onChange={(e) => setEditLeaveEnd(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-200 rounded-lg focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Notes */}
              <div className="space-y-1 border-t border-slate-150 pt-3">
                <label htmlFor="edit-notes" className="text-xs font-bold text-slate-700 uppercase">Additional Notes</label>
                <textarea
                  id="edit-notes"
                  rows={2}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-slate-950"
                />
              </div>

              {/* Action Buttons */}
              <div className="flex space-x-2 pt-2 border-t border-slate-150 justify-end">
                <button
                  type="button"
                  onClick={() => setEditingSubmission(null)}
                  className="px-5 py-2 border border-slate-200 hover:bg-slate-50 font-bold rounded-xl cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isEditSubmitting}
                  className="px-5 py-2 bg-slate-950 hover:bg-slate-900 text-white font-bold rounded-xl shadow-sm cursor-pointer flex items-center"
                >
                  {isEditSubmitting ? (
                    <>
                      <RefreshCw size={13} className="animate-spin mr-1" />
                      <span>Saving...</span>
                    </>
                  ) : (
                    <span>Save Changes on Behalf</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
