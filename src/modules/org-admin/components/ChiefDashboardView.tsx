import React, { useState, useEffect, lazy, Suspense } from 'react';
import { databaseService, DEFAULT_TENANT_ID } from '../../../lib/databaseService';
import { LoadingShell } from '../../shared/ui/LoadingShell';
import { SubmissionsPanel } from './dashboard/SubmissionsPanel';
import { PendingResidentsPanel } from './dashboard/PendingResidentsPanel';
import { WorkforceRegistryPanel } from './dashboard/WorkforceRegistryPanel';
import { AnnouncementsAdminPanel } from './dashboard/AnnouncementsAdminPanel';
import { RoleDelegationPanel } from './dashboard/RoleDelegationPanel';
import { CollectionSettingsPanel } from './dashboard/CollectionSettingsPanel';
import { InsightsStrip } from '../../shared/ui/InsightsStrip';
import { FormsBuilderPanel } from './dashboard/FormsBuilderPanel';
import { IntegrationsPanel } from './dashboard/IntegrationsPanel';
import { CategoryManagerPanel } from './dashboard/CategoryManagerPanel';
import { SchedulingBuilderView } from '../../scheduling/components/SchedulingBuilderView';
import { MeetingsPanel } from '../../meetings/components/MeetingsPanel';
import { ClinicalWritingPanel } from '../../clinical-writing/components/ClinicalWritingPanel';
import { AgentRegistryPanel } from './dashboard/AgentRegistryPanel';
import { ActivityLogPanel } from './dashboard/ActivityLogPanel';
import { MemberRecordModal } from '../../shared/ui/MemberRecordModal';

// Lazy-loaded: this tab pulls in its own document-upload/search UI and is
// only needed when the Chief actually opens the Knowledge Packs tab.
const KnowledgePackManagerView = lazy(() =>
  import('../../knowledge-packs/components/KnowledgePackManagerView').then(m => ({ default: m.KnowledgePackManagerView }))
);
// Lazy-loaded: the Multi-Roster Manager pulls in the roster parser + a
// large drag-and-drop grid UI, only needed when this tab is opened.
const MultiRosterManagerView = lazy(() =>
  import('./dashboard/MultiRosterManagerView').then(m => ({ default: m.MultiRosterManagerView }))
);
// Lazy-loaded: tenant customization (module toggles, curriculum alignment,
// AI tuning) added by the SaaS multi-tenancy pass — most Chiefs won't open
// this tab every session.
const TenantCustomizationView = lazy(() =>
  import('./dashboard/TenantCustomizationView').then(m => ({ default: m.TenantCustomizationView }))
);
// Lazy-loaded: org-admin Research/Casebook template CRUD (migration 27) —
// same "most Chiefs won't open this every session" reasoning.
const TemplateManagerView = lazy(() =>
  import('./dashboard/TemplateManagerView').then(m => ({ default: m.TemplateManagerView }))
);
import { Collection, WorkforceMember, SubmissionWithWorkforce, Submission, Announcement, AnnouncementCategory, DelegatedRole, OrgGroup, WorkforceCategory } from '../../../types';
import { useTerminology } from '../../shared/terminology';
import { CheckCircle, X, RefreshCw } from 'lucide-react';

interface ChiefDashboardViewProps {
  onLogout: () => void;
}

export const ChiefDashboardView: React.FC<ChiefDashboardViewProps> = ({ onLogout }) => {
  // The verified admin code, retained in localStorage at login time
  // (App.tsx). It authorizes the chief_* RPCs, which re-verify it
  // server-side on every call — it is never trusted blindly. Kept in state
  // (not a one-shot ref) so it stays current if the code is changed mid-session.
  const [adminCode, setAdminCode] = useState<string | null>(() => localStorage.getItem('fm_admin_code'));
  // Resolved once at login (App.tsx's handleChiefLogin, migration 23) — the
  // tenant this Chief's admin code belongs to.
  const [tenantId] = useState<string | null>(() => localStorage.getItem('fm_chief_tenant_id'));
  const { t } = useTerminology();

  const [collection, setCollection] = useState<Collection | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [residentCodes, setResidentCodes] = useState<Record<string, string>>({});
  const [submissions, setSubmissions] = useState<SubmissionWithWorkforce[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'submissions' | 'pending' | 'workforce' | 'announcements' | 'roles' | 'knowledge' | 'roster' | 'customization' | 'templates' | 'forms' | 'integrations' | 'categories' | 'scheduling' | 'meetings' | 'clinical-writing' | 'agents' | 'activity' | 'settings'>('submissions');

  // Role delegation state (migration 36 — org-defined groups, replacing the
  // previously hardcoded 4-value subadmin role list)
  const [delegatedRoles, setDelegatedRoles] = useState<DelegatedRole[]>([]);
  const [orgGroups, setOrgGroups] = useState<OrgGroup[]>([]);
  const [delegateWorkforceId, setDelegateWorkforceId] = useState<string>('');
  const [delegateRole, setDelegateRole] = useState<string>('');
  const [delegateRoleFilter, setDelegateRoleFilter] = useState<string>('All');
  const [delegateError, setDelegateError] = useState<string>('');
  const [isDelegating, setIsDelegating] = useState<boolean>(false);
  const [newGroupKey, setNewGroupKey] = useState<string>('');
  const [newGroupLabel, setNewGroupLabel] = useState<string>('');
  const [newGroupDescription, setNewGroupDescription] = useState<string>('');
  const [newGroupGrantsApproval, setNewGroupGrantsApproval] = useState<boolean>(false);
  const [newGroupError, setNewGroupError] = useState<string>('');
  const [isCreatingGroup, setIsCreatingGroup] = useState<boolean>(false);

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
  // Migration 39 rewiring: newMemberCategory/editMemberCategory now hold a
  // workforce_categories.id (uuid string), not the legacy Category text
  // union — resolved to a label via workforceCategories below.
  const [newMemberName, setNewMemberName] = useState<string>('');
  const [newMemberCategory, setNewMemberCategory] = useState<string>('');
  const [newMemberError, setNewMemberError] = useState<string>('');
  const [editingMember, setEditingMember] = useState<WorkforceMember | null>(null);
  const [editMemberName, setEditMemberName] = useState<string>('');
  const [editMemberCategory, setEditMemberCategory] = useState<string>('');

  // Tenant's own live category vocabulary (migration 39) — fetched once
  // here (alongside orgGroups) since both WorkforceRegistryPanel's dropdowns
  // AND this shell's own handleAddWorkforceMember/handleEditWorkforceMember/
  // handleExportCSV/category filter need the same list.
  const [workforceCategories, setWorkforceCategories] = useState<WorkforceCategory[]>([]);

  // Chief-facing Unified Record lookup (see MemberRecordModal.tsx) — which
  // workforce member's record is currently open, or null if the modal is
  // closed. Lives here rather than inside WorkforceRegistryPanel since that
  // panel is presentational-only per its own header.
  const [viewingRecordMember, setViewingRecordMember] = useState<WorkforceMember | null>(null);

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

  // A connection-level network failure (offline, DNS failure) can leave the
  // underlying fetch() never settling — unlike an HTTP-level error, which
  // supabase-js already surfaces cleanly as {error}. Without this, the
  // Chief's very first dashboard load can get stuck on the loading spinner
  // forever with no error (same root cause as ResidentLoginView/
  // ChiefLoginView's identical withTimeout fix, 2026-08-17).
  function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Request timed out')), ms)),
    ]);
  }

  // Load Dashboard Data
  const loadDashboardData = async () => {
    setIsLoading(true);
    try {
      await withTimeout((async () => {
      // Every read/write below defaults to DEFAULT_TENANT_ID (UCH) unless
      // passed a tenant explicitly — must pass this Chief's own resolved
      // tenant, or a second tenant's Chief sees/creates against UCH's data
      // in the grids (writes to workforce/user_roles/etc. are still safely
      // rejected by migration 23's tenant-boundary RPC checks either way,
      // but the display would be wrong and new collections/announcements/
      // knowledge packs would land in the wrong tenant).
      const tid = tenantId ?? DEFAULT_TENANT_ID;

      // 1. Get settings
      const settings = await databaseService.getSettings(tid);

      // 2. Get collections
      const collectionsList = await databaseService.getCollections(tid);
      setCollections(collectionsList);

      const activeColl = collectionsList.find(c => c.id === settings.current_collection_id) || collectionsList[0] || null;
      setCollection(activeColl);

      if (activeColl) {
        setChangeDeadlineValue(activeColl.deadline.substring(0, 16));
        // 3. Get submissions for active collection
        const subs = await databaseService.getSubmissions(activeColl.id, tid);
        setSubmissions(subs);
      } else {
        setSubmissions([]);
      }

      // 4. Get workforce (codes are fetched separately via a privileged RPC)
      const wf = await databaseService.getWorkforce(tid);
      setWorkforce(wf);

      // 5. Get announcements
      const ann = await databaseService.getAnnouncements(tid);
      setAnnouncements(ann);

      // 6. Get org-defined groups + delegated subadmin roles (migration 36)
      const groups = await databaseService.listOrgGroups(tid);
      setOrgGroups(groups);
      if (!delegateRole && groups.length > 0) {
        setDelegateRole(groups.find(g => g.group_key === 'hod')?.id || groups[0].id);
      }

      const roles = await databaseService.getDelegatedRoles(tid);
      setDelegatedRoles(roles);

      // 7. Get org-defined workforce categories (migration 39 rewiring) —
      // drives WorkforceRegistryPanel's dropdowns and this shell's own
      // add/edit-member handlers, CSV export, and category filter below.
      const cats = await databaseService.listWorkforceCategories(tid);
      setWorkforceCategories(cats);
      if (!newMemberCategory && cats.length > 0) {
        setNewMemberCategory(cats.find(c => c.category_key === 'registrar')?.id || cats[0].id);
      }

      if (adminCode) {
        try {
          const codes = await databaseService.getWorkforceCodes(adminCode);
          setResidentCodes(codes);
        } catch (codeErr) {
          console.warn('Failed to load resident codes:', codeErr);
        }
      }
      })(), 20000);
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

  // Migration 39 rewiring: prefer the tenant's own (possibly renamed) live
  // category label resolved via category_id, falling back to the legacy
  // free-text `category` column for rows that predate the backfill or fall
  // outside its match. Shared by the CSV export and the category filter
  // below — both read from the same submission shape.
  const resolveCategoryLabel = (workforce: { category: string; category_id?: string | null }): string => {
    if (workforce.category_id) {
      const match = workforceCategories.find(c => c.id === workforce.category_id);
      if (match) return match.label;
    }
    return workforce.category;
  };

  // CSV Export Logic
  const handleExportCSV = () => {
    if (!collection) return;
    
    const headers = [
      `${t('member', 'Resident')} Name`,
      'Category',
      `Current ${t('rotation', 'Rotation')}`,
      `Expected Next ${t('rotation', 'Rotation')}`,
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
      resolveCategoryLabel(sub.workforce),
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
      const newColl = await databaseService.createCollection(newCollectionTitle.trim(), deadlineIso, tenantId ?? DEFAULT_TENANT_ID);
      
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
      triggerSuccess(`Access code for "${member?.full_name || t('member', 'resident').toLowerCase()}" reset to ${newCode}.`);
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

    // newMemberCategory now holds a workforce_categories.id (migration 39
    // rewiring) — resolve it back to its label for the RPC's text param.
    const selectedCategory = workforceCategories.find(c => c.id === newMemberCategory);
    if (!selectedCategory) {
      setNewMemberError('Please select a category.');
      return;
    }

    try {
      let newMember = await databaseService.addWorkforceMember(adminCode, {
        full_name: newMemberName.trim(),
        category: selectedCategory.label,
      });

      // chief_add_workforce_member only accepts the legacy text category
      // (no category_id param — confirmed, RPC signature is off-limits for
      // this pass). Persist category_id with a separate follow-up direct
      // update so both columns stay in sync, per migration 39's own
      // "additive, not destructive" header. Merge onto the RPC result
      // rather than replacing it outright — updateWorkforceMember's select
      // (WORKFORCE_PUBLIC_COLUMNS) never includes resident_code.
      try {
        const withCategoryId = await databaseService.updateWorkforceMember(newMember.id, { category_id: selectedCategory.id });
        newMember = { ...newMember, category_id: withCategoryId.category_id, category: withCategoryId.category };
      } catch (catErr) {
        console.warn('Added member, but failed to persist category_id (category text was still saved):', catErr);
      }

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

    // editMemberCategory now holds a workforce_categories.id — resolve it
    // back to its label so the legacy text column stays in sync too.
    const selectedCategory = workforceCategories.find(c => c.id === editMemberCategory);

    try {
      const updated = await databaseService.updateWorkforceMember(editingMember.id, {
        full_name: editMemberName.trim(),
        category: selectedCategory ? selectedCategory.label : editingMember.category,
        category_id: selectedCategory ? selectedCategory.id : editingMember.category_id ?? null,
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
      }, tenantId ?? DEFAULT_TENANT_ID);
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
    if (!delegateRole) {
      setDelegateError('Please select a group.');
      return;
    }
    if (delegatedRoles.some(r => r.workforce_id === delegateWorkforceId && r.org_group_id === delegateRole)) {
      setDelegateError('This member already holds that group.');
      return;
    }

    setIsDelegating(true);
    try {
      await databaseService.assignUserRole(adminCode, delegateWorkforceId, delegateRole);
      const roles = await databaseService.getDelegatedRoles(tenantId ?? DEFAULT_TENANT_ID);
      setDelegatedRoles(roles);
      const member = workforce.find(w => w.id === delegateWorkforceId);
      triggerSuccess(`${member?.full_name || 'Member'} delegated as ${orgGroups.find(g => g.id === delegateRole)?.label}.`);
      setDelegateWorkforceId('');
    } catch (err) {
      console.warn(err);
      setDelegateError(err instanceof Error ? err.message : 'Failed to assign role.');
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
      triggerSuccess(`Revoked ${role.org_group?.label || role.role_id} from ${role.workforce?.full_name || 'member'}.`);
    } catch (err) {
      console.warn(err);
    }
  };

  // Org Groups: Create a custom group (migration 36)
  const handleCreateOrgGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewGroupError('');

    if (!adminCode) {
      setNewGroupError('Session expired. Please log in again.');
      return;
    }
    if (!newGroupKey.trim() || !/^[a-z0-9_]{2,32}$/.test(newGroupKey.trim())) {
      setNewGroupError('Group key must be 2-32 lowercase letters, numbers, or underscores.');
      return;
    }
    if (!newGroupLabel.trim()) {
      setNewGroupError('Label is required.');
      return;
    }

    setIsCreatingGroup(true);
    try {
      const created = await databaseService.createOrgGroup(adminCode, newGroupKey.trim(), newGroupLabel.trim(), newGroupDescription.trim(), newGroupGrantsApproval);
      setOrgGroups(prev => [...prev, created].sort((a, b) => (a.is_system_default === b.is_system_default ? a.label.localeCompare(b.label) : a.is_system_default ? -1 : 1)));
      setNewGroupKey('');
      setNewGroupLabel('');
      setNewGroupDescription('');
      setNewGroupGrantsApproval(false);
      triggerSuccess(`Group "${created.label}" created.`);
    } catch (err) {
      console.warn(err);
      setNewGroupError(err instanceof Error ? err.message : 'Failed to create group.');
    } finally {
      setIsCreatingGroup(false);
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
      setEditError(`Current ${t('rotation', 'Rotation')} is required.`);
      return;
    }

    if (!editNextRotation.trim()) {
      setEditError(`Expected ${t('rotation', 'Rotation')} is required.`);
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
    
    // SubmissionsPanel's own <select> options are still the 3 legacy text
    // values (out of scope for this pass) — resolveCategoryLabel still
    // matches correctly for any member on an unrenamed seeded default
    // category, since its resolved label equals that legacy text exactly.
    const matchesCategory = categoryFilter === 'All' || resolveCategoryLabel(sub.workforce) === categoryFilter;
    
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
            <span>{t('admin', 'Chief Resident')} Board</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">Manage Family Medicine {t('member', 'resident').toLowerCase()} monthly postings and leave requests</p>
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
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-bold">Pending {t('members', 'Residents')}</span>
          <div className="mt-2 flex items-baseline space-x-1.5">
            <span className={`font-extrabold text-3xl ${pendingCount > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
              {pendingCount}
            </span>
            <span className="text-[10px] text-slate-500 font-semibold uppercase">Outstanding</span>
          </div>
        </div>
      </div>

      {/* Insights Strip (L4/L5 face for the Submission Chaser agent, migration 37) */}
      <InsightsStrip tenantId={tenantId ?? DEFAULT_TENANT_ID} />

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
          {t('member', 'Resident')} Submissions ({submissions.length})
        </button>
        <button
          onClick={() => setActiveTab('pending')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'pending'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Pending {t('members', 'Residents')} ({pendingResidents.length})
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
          onClick={() => setActiveTab('templates')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'templates'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Templates
        </button>
        <button
          onClick={() => setActiveTab('forms')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'forms'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Forms Builder
        </button>
        <button
          onClick={() => setActiveTab('integrations')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'integrations'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Integrations
        </button>
        <button
          onClick={() => setActiveTab('categories')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'categories'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Categories
        </button>
        <button
          onClick={() => setActiveTab('scheduling')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'scheduling'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Scheduling
        </button>
        <button
          onClick={() => setActiveTab('meetings')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'meetings'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Meetings
        </button>
        <button
          onClick={() => setActiveTab('clinical-writing')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'clinical-writing'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Clinical Writing
        </button>
        <button
          onClick={() => setActiveTab('agents')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'agents'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          AI Agents
        </button>
        <button
          onClick={() => setActiveTab('activity')}
          className={`pb-3 text-xs sm:text-sm font-bold border-b-2 px-1 transition whitespace-nowrap shrink-0 cursor-pointer ${
            activeTab === 'activity'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          Activity Log
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
          <SubmissionsPanel
            t={t}
            submissions={submissions}
            filteredSubmissions={filteredSubmissions}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            categoryFilter={categoryFilter}
            setCategoryFilter={setCategoryFilter}
            workforceCategories={workforceCategories}
            leaveFilter={leaveFilter}
            setLeaveFilter={setLeaveFilter}
            handleExportCSV={handleExportCSV}
            selectedSubmission={selectedSubmission}
            setSelectedSubmission={setSelectedSubmission}
            openEditSubmission={openEditSubmission}
            editingSubmission={editingSubmission}
            setEditingSubmission={setEditingSubmission}
            editError={editError}
            editCurrentRotation={editCurrentRotation}
            setEditCurrentRotation={setEditCurrentRotation}
            editNextRotation={editNextRotation}
            setEditNextRotation={setEditNextRotation}
            editTakingLeave={editTakingLeave}
            setEditTakingLeave={setEditTakingLeave}
            editLeaveType={editLeaveType}
            setEditLeaveType={setEditLeaveType}
            editLeaveApplied={editLeaveApplied}
            setEditLeaveApplied={setEditLeaveApplied}
            editLeaveStart={editLeaveStart}
            setEditLeaveStart={setEditLeaveStart}
            editLeaveEnd={editLeaveEnd}
            setEditLeaveEnd={setEditLeaveEnd}
            editNotes={editNotes}
            setEditNotes={setEditNotes}
            isEditSubmitting={isEditSubmitting}
            handleEditSubmissionSubmit={handleEditSubmissionSubmit}
          />
        )}

        {/* TAB 2: PENDING RESIDENTS */}
        {activeTab === 'pending' && (
          <PendingResidentsPanel
            t={t}
            pendingResidents={pendingResidents}
            residentCodes={residentCodes}
            handleResetCode={handleResetCode}
          />
        )}

        {/* TAB 3: WORKFORCE REGISTRY */}
        {activeTab === 'workforce' && (
          <WorkforceRegistryPanel
            t={t}
            workforce={workforce}
            onViewRecord={setViewingRecordMember}
            workforceCategories={workforceCategories}
            residentCodes={residentCodes}
            handleToggleActiveState={handleToggleActiveState}
            handleResetCode={handleResetCode}
            linkingMemberId={linkingMemberId}
            setLinkingMemberId={setLinkingMemberId}
            linkDoctorEmail={linkDoctorEmail}
            setLinkDoctorEmail={setLinkDoctorEmail}
            linkDoctorError={linkDoctorError}
            setLinkDoctorError={setLinkDoctorError}
            isLinkingDoctor={isLinkingDoctor}
            handleLinkDoctor={handleLinkDoctor}
            handleUnlinkDoctor={handleUnlinkDoctor}
            editingMember={editingMember}
            setEditingMember={setEditingMember}
            editMemberName={editMemberName}
            setEditMemberName={setEditMemberName}
            editMemberCategory={editMemberCategory}
            setEditMemberCategory={setEditMemberCategory}
            handleEditWorkforceMember={handleEditWorkforceMember}
            newMemberName={newMemberName}
            setNewMemberName={setNewMemberName}
            newMemberCategory={newMemberCategory}
            setNewMemberCategory={setNewMemberCategory}
            newMemberError={newMemberError}
            handleAddWorkforceMember={handleAddWorkforceMember}
          />
        )}

        {/* TAB 4: ANNOUNCEMENTS ADMIN */}
        {activeTab === 'announcements' && (
          <AnnouncementsAdminPanel
            announcements={announcements}
            handleToggleAnnouncementPin={handleToggleAnnouncementPin}
            newAnnouncementTitle={newAnnouncementTitle}
            setNewAnnouncementTitle={setNewAnnouncementTitle}
            newAnnouncementBody={newAnnouncementBody}
            setNewAnnouncementBody={setNewAnnouncementBody}
            newAnnouncementCategory={newAnnouncementCategory}
            setNewAnnouncementCategory={setNewAnnouncementCategory}
            newAnnouncementPinned={newAnnouncementPinned}
            setNewAnnouncementPinned={setNewAnnouncementPinned}
            newAnnouncementError={newAnnouncementError}
            isPostingAnnouncement={isPostingAnnouncement}
            handleCreateAnnouncement={handleCreateAnnouncement}
          />
        )}

        {/* TAB 5: ROLE DELEGATION */}
        {activeTab === 'roles' && (
          <RoleDelegationPanel
            delegatedRoles={delegatedRoles}
            orgGroups={orgGroups}
            workforceCategories={workforceCategories}
            delegateRoleFilter={delegateRoleFilter}
            setDelegateRoleFilter={setDelegateRoleFilter}
            workforce={workforce}
            delegateWorkforceId={delegateWorkforceId}
            setDelegateWorkforceId={setDelegateWorkforceId}
            delegateRole={delegateRole}
            setDelegateRole={setDelegateRole}
            delegateError={delegateError}
            isDelegating={isDelegating}
            handleAssignRole={handleAssignRole}
            handleRevokeRole={handleRevokeRole}
            newGroupKey={newGroupKey}
            setNewGroupKey={setNewGroupKey}
            newGroupLabel={newGroupLabel}
            setNewGroupLabel={setNewGroupLabel}
            newGroupDescription={newGroupDescription}
            setNewGroupDescription={setNewGroupDescription}
            newGroupGrantsApproval={newGroupGrantsApproval}
            setNewGroupGrantsApproval={setNewGroupGrantsApproval}
            newGroupError={newGroupError}
            isCreatingGroup={isCreatingGroup}
            handleCreateOrgGroup={handleCreateOrgGroup}
          />
        )}

        {/* TAB 6: KNOWLEDGE PACKS */}
        {activeTab === 'knowledge' && (
          <Suspense fallback={<LoadingShell />}>
            <KnowledgePackManagerView tenantId={tenantId ?? DEFAULT_TENANT_ID} />
          </Suspense>
        )}

        {/* TAB 7: MULTI-ROSTER MANAGER */}
        {activeTab === 'roster' && (
          <Suspense fallback={<LoadingShell />}>
            <MultiRosterManagerView tenantId={tenantId ?? DEFAULT_TENANT_ID} />
          </Suspense>
        )}

        {/* TAB 8: TENANT CUSTOMIZATION */}
        {activeTab === 'customization' && adminCode && (
          <Suspense fallback={<LoadingShell />}>
            <TenantCustomizationView tenantId={tenantId ?? DEFAULT_TENANT_ID} adminCode={adminCode} />
          </Suspense>
        )}

        {/* TAB 8b: TEMPLATE MANAGER (migration 27) */}
        {activeTab === 'templates' && adminCode && (
          <Suspense fallback={<LoadingShell />}>
            <TemplateManagerView tenantId={tenantId ?? DEFAULT_TENANT_ID} adminCode={adminCode} />
          </Suspense>
        )}

        {/* TAB 9a: FORMS BUILDER (migration 35 — living-system Forms module generalization) */}
        {activeTab === 'forms' && (
          <FormsBuilderPanel tenantId={tenantId ?? DEFAULT_TENANT_ID} createdByWorkforceId={null} />
        )}

        {/* TAB 9b: INTEGRATIONS (migration 33 — living-system integrations layer) */}
        {activeTab === 'integrations' && (
          <IntegrationsPanel />
        )}

        {/* TAB 9c: CATEGORIES (migration 39 — org-defined workforce categories) */}
        {activeTab === 'categories' && adminCode && (
          <CategoryManagerPanel tenantId={tenantId ?? DEFAULT_TENANT_ID} adminCode={adminCode} />
        )}

        {/* TAB 9d: SCHEDULING (migration 44 — additive generic Scheduling module) */}
        {activeTab === 'scheduling' && (
          <SchedulingBuilderView tenantId={tenantId ?? DEFAULT_TENANT_ID} createdByWorkforceId={null} />
        )}

        {/* TAB 9e: MEETINGS (migration 45 — Meetings & Actions module) */}
        {activeTab === 'meetings' && (
          <MeetingsPanel tenantId={tenantId ?? DEFAULT_TENANT_ID} createdByWorkforceId={null} />
        )}

        {/* TAB 9f: CLINICAL WRITING (migration 48 — Clinical & Professional Writing module) */}
        {activeTab === 'clinical-writing' && (
          <ClinicalWritingPanel tenantId={tenantId ?? DEFAULT_TENANT_ID} createdByWorkforceId={null} />
        )}

        {/* TAB 9g: AI AGENT REGISTRY — living-system spine transparency (agent_manifests) */}
        {activeTab === 'agents' && <AgentRegistryPanel />}

        {/* TAB 9h: ACTIVITY LOG — living-system spine transparency (event_log) */}
        {activeTab === 'activity' && (
          <ActivityLogPanel tenantId={tenantId ?? DEFAULT_TENANT_ID} />
        )}

        {/* TAB 10: SETTINGS & COLLECTIONS */}
        {activeTab === 'settings' && (
          <CollectionSettingsPanel
            newCollectionTitle={newCollectionTitle}
            setNewCollectionTitle={setNewCollectionTitle}
            newCollectionDeadline={newCollectionDeadline}
            setNewCollectionDeadline={setNewCollectionDeadline}
            newCollectionError={newCollectionError}
            handleCreateCollection={handleCreateCollection}
            collection={collection}
            handleToggleCollectionStatus={handleToggleCollectionStatus}
            changeDeadlineValue={changeDeadlineValue}
            setChangeDeadlineValue={setChangeDeadlineValue}
            changeDeadlineError={changeDeadlineError}
            handleChangeDeadline={handleChangeDeadline}
            adminAccessCodeValue={adminAccessCodeValue}
            setAdminAccessCodeValue={setAdminAccessCodeValue}
            adminAccessCodeError={adminAccessCodeError}
            handleUpdateAdminCode={handleUpdateAdminCode}
          />
        )}
      </div>

      <MemberRecordModal
        member={viewingRecordMember}
        onClose={() => setViewingRecordMember(null)}
      />
    </div>
  );
};
