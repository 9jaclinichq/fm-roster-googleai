import React, { useState, useEffect } from 'react';
import { databaseService } from '../../../../lib/databaseService';
import {
  parseConsultantGop,
  parseCombinedGop,
  parseEmergencyRoster,
  parseSupervisionRoster,
  parseSatelliteRoster,
} from '../../../roster-engine/lib/uchRosterParser';
import { computeReconciliationIssues, groupReconciliationIssuesForDisplay } from '../../../roster-engine/lib/rosterReconciliation';
import {
  applyIdentityResolutionToGopGrid,
  applyIdentityResolutionToEmergencyGrid,
  applyIdentityResolutionToSatelliteGrid,
} from '../../../roster-engine/lib/rosterIdentityIngest';
import { rosterRevisionService } from '../../../roster-engine/lib/rosterRevisionService';
import {
  RosterSection,
  RosterPatchOperation,
  RosterPatchField,
  RosterGrids,
  applyRosterPatch,
  fieldsForSection,
  fieldLabelFor,
  rowsForSection,
  rowLabelFor,
  rowSemanticLabelFor,
  workforceNameMap,
  isSupervisionScalarField,
} from '../../../roster-engine/lib/rosterPatch';
import { computeNetRosterDiff, computeNetReconciliationIssues } from '../../../roster-engine/lib/rosterNetDiff';
import { buildRebasePreview, RebasePreview } from '../../../roster-engine/lib/rosterRebase';
import { compileSwapToOperations } from '../../../roster-engine/lib/rosterSwap';
import {
  generateRosterPatchProposal,
  ProposedRosterPatch,
  SymbolicOperation,
  RosterProposalContextRow,
  RosterProposalWorkforceEntry,
} from '../../../roster-engine/lib/rosterPatchProposalService';
import { compileProposalOperations, CompiledProposalOperation } from '../../../roster-engine/lib/rosterPatchProposalCompiler';
import {
  WorkforceMember,
  Collection,
  CombinedMasterRoster,
  GopClinicGrid,
  EmergencyCallGrid,
  SupervisionGrid,
  SatelliteGrid,
  RosterTypeId,
  SubmissionWithWorkforce,
  Rotation,
  RosterRevision,
} from '../../../../types';
import {
  ListChecks,
  UploadCloud,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Megaphone,
  X,
  Plus,
  Sparkles,
  User,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Edit3,
  Trash2,
} from 'lucide-react';
import { useTerminology } from '../../../shared/terminology';

const EMPTY_GOP: GopClinicGrid = { slots: [], unparsed_notes: [] };
const EMPTY_EMERGENCY: EmergencyCallGrid = { shifts: [], unparsed_notes: [] };
const EMPTY_SUPERVISION: SupervisionGrid = { duties: [], unparsed_notes: [] };
const EMPTY_SATELLITE: SatelliteGrid = { postings: [], unparsed_notes: [] };

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type GridTab = 'gop' | 'emergency' | 'supervision' | 'satellite';

// Structured Chief editing (assign/replace/unassign only) — reuses the
// exact same 4 section labels already shown on the grid tabs above, so
// the new patch-builder picker and the existing tabs never disagree.
const PATCH_SECTION_LABELS: [RosterSection, string][] = [
  ['gop', 'GOP Clinic Grid'],
  ['emergency', 'A&E Emergency'],
  ['supervision', 'Supervision'],
  ['satellite', 'Satellite'],
];
type PatchOpKind = 'assign' | 'replace' | 'unassign';

// A function rather than a plain module-level constant because the
// 'consultant_gop' entry's label embeds the tenant-aware `senior_reviewer`
// term (was a hardcoded "Consultant" — see
// docs/LIVING_SYSTEM_GAP_AUDIT.md's terminology audit) and `t()` is only
// available from useTerminology() inside the component.
const getIngestionTypes = (t: (key: string, fallback?: string) => string): { id: RosterTypeId; label: string }[] => [
  { id: 'consultant_gop', label: `${t('senior_reviewer', 'Consultant')} GOP Roster` },
  { id: 'combined_gop', label: 'Combined GOP Duty Roster' },
  { id: 'accident_emergency', label: 'A&E Emergency Call Roster' },
  { id: 'afternoon_supervision', label: 'Afternoon/Saturday Supervision' },
  { id: 'satellite_outreach', label: 'Satellite Outposts' },
];

interface MultiRosterManagerViewProps {
  tenantId: string;
  // Migration 75 — verified server-side by every chief_*_roster_revision
  // RPC (same pattern as chiefUpdateTenantTerminology/
  // chiefUpsertRosterSectionConfig) — passed through from the existing
  // Chief session (ChiefDashboardView's `fm_admin_code` localStorage
  // read), not a new persistence mechanism.
  adminCode: string;
}

export const MultiRosterManagerView: React.FC<MultiRosterManagerViewProps> = ({ tenantId, adminCode }) => {
  const { t } = useTerminology();
  const INGESTION_TYPES = getIngestionTypes(t);
  const [isLoading, setIsLoading] = useState(true);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [masterRoster, setMasterRoster] = useState<CombinedMasterRoster | null>(null);
  // Migration 75 — revision-safe editing. Non-null only while the Chief
  // is actively editing an already-published roster's revision; null the
  // rest of the time (including the whole pre-first-publish flow, which
  // is completely unchanged — see saveDraft()/publish() below). While
  // this is non-null, saveDraft() writes ONLY to this revision, never to
  // combined_master_rosters — residents keep reading the untouched live
  // row for the entire editing session.
  const [activeRevision, setActiveRevision] = useState<RosterRevision | null>(null);
  const [isRevisionBusy, setIsRevisionBusy] = useState(false);

  // Structured Chief editing (assign/replace/unassign only) — a queue of
  // not-yet-applied RosterPatchOperation[], reviewed as a list before
  // being applied to the local revision snapshot. Only ever shown/usable
  // while an editable revision is open (activeRevision !== null) — this
  // slice's whole point is editing revisions safely, never
  // combined_master_rosters directly.
  const [pendingOperations, setPendingOperations] = useState<RosterPatchOperation[]>([]);
  const [patchSection, setPatchSection] = useState<RosterSection>('gop');
  const [patchRowIndex, setPatchRowIndex] = useState<number>(0);
  const [patchField, setPatchField] = useState<RosterPatchField>('residents');
  const [patchOp, setPatchOp] = useState<PatchOpKind>('assign');
  const [patchWorkforceId, setPatchWorkforceId] = useState<string>('');
  const [patchFromWorkforceId, setPatchFromWorkforceId] = useState<string>('');
  const [patchReason, setPatchReason] = useState<string>('');

  // Net diff + stale-revision rebase review. lastAppliedOperations
  // accumulates every operation successfully baked into local grid state
  // (via applyPendingOperations) since activeRevision was last synced
  // from the server — this, not pendingOperations (which only holds
  // NOT-yet-applied operations), is "the Chief's pending patch" that a
  // stale-save rejection needs to classify and that Save Draft/Publish
  // are about to persist. Reset to [] every time activeRevision is freshly
  // set from a server round-trip (load/save/publish/discard/rebase).
  const [lastAppliedOperations, setLastAppliedOperations] = useState<RosterPatchOperation[]>([]);
  const [rebasePreview, setRebasePreview] = useState<RebasePreview | null>(null);
  const [pendingLatestRevision, setPendingLatestRevision] = useState<RosterRevision | null>(null);
  const [isRebasing, setIsRebasing] = useState(false);

  // Swap UI (convenience form only). Per this slice's design, swap is
  // NOT a new patch primitive — compileSwapToOperations() (rosterSwap.ts)
  // always compiles a swap into exactly 2 existing 'replace' operations,
  // which get queued into the SAME pendingOperations list as any manual
  // structured edit. No persistence or schema anywhere knows about swap.
  const [swapASection, setSwapASection] = useState<RosterSection>('gop');
  const [swapARowIndex, setSwapARowIndex] = useState<number>(0);
  const [swapAField, setSwapAField] = useState<RosterPatchField>('residents');
  const [swapAWorkforceId, setSwapAWorkforceId] = useState<string>('');
  const [swapBSection, setSwapBSection] = useState<RosterSection>('gop');
  const [swapBRowIndex, setSwapBRowIndex] = useState<number>(0);
  const [swapBField, setSwapBField] = useState<RosterPatchField>('residents');
  const [swapBWorkforceId, setSwapBWorkforceId] = useState<string>('');
  const [swapReason, setSwapReason] = useState<string>('');

  // Roster AI V1 -- Prompt-to-Patch Proposal Layer. LOCAL ONLY, per
  // WORKSPC_ROSTER_AI_V1_PROMPT_TO_PATCH_DISCOVER_AND_PLAN_2026-08-30.md /
  // WORKSPC_ROSTER_AI_V1_FINAL_PREIMPLEMENTATION_REVIEW_2026-08-30.md. The
  // AI panel proposes; it never calls save/publish, never touches
  // pendingOperations except through the SAME accept step a Chief takes
  // manually. aiProposalBase* captures the revision (id/updated_at/grids)
  // the proposal was generated against, checked once at accept-time
  // (below) -- if activeRevision has since moved (only possible via this
  // Chief's own save/publish/discard/rebase within this session, since
  // nothing else in this single-tab app changes activeRevision), the
  // existing rebase machinery is reused rather than silently
  // regenerating/applying anything.
  // Tenant exposure gate (2026-08-31 containment slice) -- reuses the
  // already-live tenants.module_flags mechanism (migration 59), same
  // pattern as CasebookBuilderView.tsx's case_reports_required_count read.
  // Fail-closed by construction: starts false, and only a fetched
  // module_flags.roster_ai_v1_enabled === true strictly ever flips it true.
  // Missing flag, null, absent module_flags, a fetch error, or false all
  // leave it exactly where it started -- hidden. Not added to
  // TenantCustomizationView's Chief-facing toggle list -- operator-only
  // for this first pilot, per explicit instruction.
  const [rosterAiV1Enabled, setRosterAiV1Enabled] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');
  const [isGeneratingAiProposal, setIsGeneratingAiProposal] = useState(false);
  const [aiProposal, setAiProposal] = useState<ProposedRosterPatch | null>(null);
  const [aiCompiledOperations, setAiCompiledOperations] = useState<CompiledProposalOperation[]>([]);
  const [aiAcceptedIndices, setAiAcceptedIndices] = useState<Set<number>>(new Set());
  const [aiProposalError, setAiProposalError] = useState<string>('');
  const [aiProposalBaseRevisionId, setAiProposalBaseRevisionId] = useState<string | null>(null);
  const [aiProposalBaseUpdatedAt, setAiProposalBaseUpdatedAt] = useState<string | null>(null);
  const [aiProposalBaseGrids, setAiProposalBaseGrids] = useState<RosterGrids | null>(null);
  // Revision-level source/source_reference provenance is explicitly
  // deferred (per the human decision recorded in prompt1.txt -- a mixed
  // manual+AI revision would be inaccurately labeled at revision
  // granularity). This is the one, proposal-level, client-only concession:
  // signatures of operations that reached pendingOperations via an
  // accepted AI proposal, consulted ONLY by saveDraft() below to compose an
  // optional, human-readable change_reason -- never a database column,
  // never authoritative, never overwriting a Chief-entered reason (none
  // exists to overwrite in the current saveDraft() call, confirmed by
  // reading it below).
  const [aiAssistedOperationSignatures, setAiAssistedOperationSignatures] = useState<Set<string>>(new Set());

  // Workforce Option A (read-only reconciliation) — see
  // docs/WORKFORCE_V1_RECOVERY_SPEC.md. submissions/rotations are read
  // only to compute reconciliationIssues below; never written here.
  const [submissions, setSubmissions] = useState<SubmissionWithWorkforce[]>([]);
  const [rotations, setRotations] = useState<Rotation[]>([]);
  const [expandedIssueMemberId, setExpandedIssueMemberId] = useState<string | null>(null);

  const now = new Date();
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [year, setYear] = useState<number>(now.getFullYear());

  const [gopGrid, setGopGrid] = useState<GopClinicGrid>(EMPTY_GOP);
  const [emergencyGrid, setEmergencyGrid] = useState<EmergencyCallGrid>(EMPTY_EMERGENCY);
  const [supervisionGrid, setSupervisionGrid] = useState<SupervisionGrid>(EMPTY_SUPERVISION);
  const [satelliteGrid, setSatelliteGrid] = useState<SatelliteGrid>(EMPTY_SATELLITE);

  const [gridTab, setGridTab] = useState<GridTab>('gop');
  const [ingestText, setIngestText] = useState<Record<RosterTypeId, string>>({
    consultant_gop: '', combined_gop: '', accident_emergency: '', afternoon_supervision: '', satellite_outreach: '',
  });
  const [ingestFile, setIngestFile] = useState<Record<RosterTypeId, File | null>>({
    consultant_gop: null, combined_gop: null, accident_emergency: null, afternoon_supervision: null, satellite_outreach: null,
  });
  const [parsingType, setParsingType] = useState<RosterTypeId | null>(null);
  const [parseSourceByType, setParseSourceByType] = useState<Partial<Record<RosterTypeId, string>>>({});
  const [statusMessage, setStatusMessage] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Tap-to-assign fallback for touch devices: native HTML5 drag-and-drop
  // (below) never fires on iOS/Android at all, so tapping a resident chip
  // to select them, then tapping a slot to place them, is the only way this
  // screen works on a phone or tablet. Kept alongside drag-and-drop rather
  // than replacing it — desktop mouse users see no change.
  const [selectedResidentId, setSelectedResidentId] = useState<string | null>(null);
  const toggleSelectedResident = (residentId: string) => {
    setSelectedResidentId(prev => (prev === residentId ? null : residentId));
  };

  // Migration 75 revision grids, with the same null-fallback shape used
  // throughout load()/discardRevision() — reused here so rosterNetDiff.ts/
  // rosterRebase.ts always get well-formed RosterGrids, never a partially
  // null revision row.
  const revisionGridsOrEmpty = (revision: RosterRevision): RosterGrids => ({
    gop_clinic_grid: revision.gop_clinic_grid?.slots ? revision.gop_clinic_grid : EMPTY_GOP,
    emergency_call_grid: revision.emergency_call_grid?.shifts ? revision.emergency_call_grid : EMPTY_EMERGENCY,
    supervision_grid: revision.supervision_grid?.duties ? revision.supervision_grid : EMPTY_SUPERVISION,
    satellite_grid: revision.satellite_grid?.postings ? revision.satellite_grid : EMPTY_SATELLITE,
  });

  const load = async () => {
    setIsLoading(true);
    try {
      const [wf, settings, collections, tenantRotations] = await Promise.all([
        databaseService.getWorkforce(tenantId),
        databaseService.getSettings(tenantId),
        databaseService.getCollections(tenantId),
        databaseService.getRotations(),
      ]);
      setWorkforce(wf.filter(w => w.active));
      setRotations(tenantRotations);
      const activeColl = collections.find(c => c.id === settings.current_collection_id) || null;
      setCollection(activeColl);

      if (activeColl) {
        const [mr, activeCollSubmissions] = await Promise.all([
          databaseService.getOrCreateMasterRoster(activeColl.id, month, year),
          databaseService.getSubmissions(activeColl.id, tenantId),
        ]);
        setMasterRoster(mr);
        setSubmissions(activeCollSubmissions);

        // Migration 75: once a roster has been published, editing means
        // editing a revision, never the live row directly. start
        // Revision is idempotent (returns the existing 'editing' revision
        // if the Chief already had one in progress, from this or an
        // earlier session, rather than re-snapshotting over it) — this is
        // what lets a Chief safely resume in-progress work instead of
        // silently losing it to a fresh copy of the live published grids.
        if (mr.status === 'published') {
          const revision = await rosterRevisionService.startRevision(adminCode);
          setActiveRevision(revision);
          setLastAppliedOperations([]);
          setGopGrid(revision.gop_clinic_grid?.slots ? revision.gop_clinic_grid : EMPTY_GOP);
          setEmergencyGrid(revision.emergency_call_grid?.shifts ? revision.emergency_call_grid : EMPTY_EMERGENCY);
          setSupervisionGrid(revision.supervision_grid?.duties ? revision.supervision_grid : EMPTY_SUPERVISION);
          setSatelliteGrid(revision.satellite_grid?.postings ? revision.satellite_grid : EMPTY_SATELLITE);
        } else {
          setActiveRevision(null);
          setLastAppliedOperations([]);
          setGopGrid(mr.gop_clinic_grid?.slots ? mr.gop_clinic_grid : EMPTY_GOP);
          setEmergencyGrid(mr.emergency_call_grid?.shifts ? mr.emergency_call_grid : EMPTY_EMERGENCY);
          setSupervisionGrid(mr.supervision_grid?.duties ? mr.supervision_grid : EMPTY_SUPERVISION);
          setSatelliteGrid(mr.satellite_grid?.postings ? mr.satellite_grid : EMPTY_SATELLITE);
        }
      } else {
        setSubmissions([]);
      }
    } catch (err) {
      console.warn('Failed to load Multi-Roster Manager:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Separate, isolated fetch -- a failure here must never affect roster
  // load/save/publish, so it is deliberately NOT folded into load() above.
  // Only an explicit `=== true` flips the panel on; every other outcome
  // (absent flag, null, false, a thrown error) leaves rosterAiV1Enabled at
  // its fail-closed default (false, set above).
  useEffect(() => {
    databaseService.getTenant(tenantId)
      .then(tenant => {
        setRosterAiV1Enabled(tenant?.module_flags?.roster_ai_v1_enabled === true);
      })
      .catch(err => console.warn('Failed to load tenant roster_ai_v1_enabled flag, AI panel stays hidden:', err));
  }, [tenantId]);

  const onFloorResidents = workforce.filter(w => w.on_floor);
  const notOnFloorResidents = workforce.filter(w => !w.on_floor);

  const toggleOnFloor = async (member: WorkforceMember) => {
    try {
      const updated = await databaseService.updateWorkforceMember(member.id, { on_floor: !member.on_floor });
      setWorkforce(prev => prev.map(w => w.id === member.id ? updated : w));
    } catch (err) {
      console.warn(err);
    }
  };

  const handleIngest = async (rosterType: RosterTypeId) => {
    const text = ingestText[rosterType].trim();
    const file = ingestFile[rosterType];
    if (!text && !file) return;

    setParsingType(rosterType);
    try {
      let fileUrl: string | null = null;
      if (file) {
        fileUrl = await databaseService.uploadRosterDocument(file);
      }

      let parsedResult;
      switch (rosterType) {
        case 'consultant_gop': parsedResult = await parseConsultantGop(text); break;
        case 'combined_gop': parsedResult = await parseCombinedGop(text); break;
        case 'accident_emergency': parsedResult = await parseEmergencyRoster(text); break;
        case 'afternoon_supervision': parsedResult = await parseSupervisionRoster(text); break;
        case 'satellite_outreach': parsedResult = await parseSatelliteRoster(text); break;
      }

      await databaseService.createRawRosterUpload({
        month, year, roster_type_id: rosterType,
        file_name: file?.name || null, file_url: fileUrl,
        raw_text_content: text || null,
        parsed_data: parsedResult.data as unknown as Record<string, unknown>,
      });

      setParseSourceByType(prev => ({ ...prev, [rosterType]: parsedResult.source === 'edge_function' ? `AI-generated (${parsedResult.provider})` : 'Heuristic (no AI configured)' }));

      // Identity resolution (September Ingestion Slice 2) runs only on the
      // Chief-facing editable grid state below — never on the
      // createRawRosterUpload call above, which must keep recording the
      // parser's raw, unresolved output verbatim. combined_gop/
      // accident_emergency/satellite_outreach are the three grid types
      // with a workforce_id-bearing field; consultant_gop and
      // afternoon_supervision are deliberately left untouched (see
      // rosterIdentityIngest.ts's header for why Supervision can't safely
      // take a resolved id).
      if (rosterType === 'consultant_gop') { setGopGrid(parsedResult.data as GopClinicGrid); setGridTab('gop'); }
      if (rosterType === 'combined_gop') { setGopGrid(applyIdentityResolutionToGopGrid(parsedResult.data as GopClinicGrid, workforce)); setGridTab('gop'); }
      if (rosterType === 'accident_emergency') { setEmergencyGrid(applyIdentityResolutionToEmergencyGrid(parsedResult.data as EmergencyCallGrid, workforce)); setGridTab('emergency'); }
      if (rosterType === 'afternoon_supervision') { setSupervisionGrid(parsedResult.data as SupervisionGrid); setGridTab('supervision'); }
      if (rosterType === 'satellite_outreach') { setSatelliteGrid(applyIdentityResolutionToSatelliteGrid(parsedResult.data as SatelliteGrid, workforce)); setGridTab('satellite'); }

      setStatusMessage(`${INGESTION_TYPES.find(t => t.id === rosterType)?.label} parsed — review in the grid below.`);
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to parse/import roster document.');
    } finally {
      setParsingType(null);
    }
  };

  // --- Drag and drop assignment ---
  const handleDragStart = (e: React.DragEvent, residentId: string) => {
    e.dataTransfer.setData('text/resident-id', residentId);
  };

  const residentName = (id: string) => workforce.find(w => w.id === id)?.full_name || id;

  // Each assignment is a plain function taking a residentId directly, used
  // by BOTH the drag-and-drop handlers (desktop) and the tap-to-assign
  // handlers (touch) below — one source of truth for the actual assignment
  // logic regardless of which input method triggered it.
  const assignToGopSlot = (residentId: string, slotIndex: number) => {
    setGopGrid(prev => ({
      ...prev,
      slots: prev.slots.map((s, i) => i === slotIndex
        ? { ...s, residents: [...(s.residents || []).filter(r => r !== residentId), residentId] }
        : s),
    }));
  };
  const dropOnGopSlot = (e: React.DragEvent, slotIndex: number) => {
    e.preventDefault();
    const residentId = e.dataTransfer.getData('text/resident-id');
    if (residentId) assignToGopSlot(residentId, slotIndex);
  };
  const tapAssignGopSlot = (slotIndex: number) => {
    if (!selectedResidentId) return;
    assignToGopSlot(selectedResidentId, slotIndex);
    setSelectedResidentId(null);
  };

  const assignToEmergencyShift = (residentId: string, shiftIndex: number) => {
    setEmergencyGrid(prev => ({
      ...prev,
      shifts: prev.shifts.map((s, i) => i === shiftIndex
        ? { ...s, on_call: [...s.on_call.filter(r => r !== residentId), residentId] }
        : s),
    }));
  };
  const dropOnEmergencyShift = (e: React.DragEvent, shiftIndex: number) => {
    e.preventDefault();
    const residentId = e.dataTransfer.getData('text/resident-id');
    if (residentId) assignToEmergencyShift(residentId, shiftIndex);
  };
  const tapAssignEmergencyShift = (shiftIndex: number) => {
    if (!selectedResidentId) return;
    assignToEmergencyShift(selectedResidentId, shiftIndex);
    setSelectedResidentId(null);
  };

  const assignToSatellitePosting = (residentId: string, postingIndex: number) => {
    setSatelliteGrid(prev => ({
      ...prev,
      postings: prev.postings.map((p, i) => i === postingIndex
        ? { ...p, assigned: [...p.assigned.filter(r => r !== residentId), residentId] }
        : p),
    }));
  };
  const dropOnSatellitePosting = (e: React.DragEvent, postingIndex: number) => {
    e.preventDefault();
    const residentId = e.dataTransfer.getData('text/resident-id');
    if (residentId) assignToSatellitePosting(residentId, postingIndex);
  };
  const tapAssignSatellitePosting = (postingIndex: number) => {
    if (!selectedResidentId) return;
    assignToSatellitePosting(selectedResidentId, postingIndex);
    setSelectedResidentId(null);
  };

  const assignToSupervisionDuty = (residentId: string, dutyIndex: number, slot: 'first_on_duty' | 'second_on_duty') => {
    setSupervisionGrid(prev => ({
      ...prev,
      duties: prev.duties.map((d, i) => i === dutyIndex ? { ...d, [slot]: residentName(residentId) } : d),
    }));
  };
  const dropOnSupervisionDuty = (e: React.DragEvent, dutyIndex: number, slot: 'first_on_duty' | 'second_on_duty') => {
    e.preventDefault();
    const residentId = e.dataTransfer.getData('text/resident-id');
    if (residentId) assignToSupervisionDuty(residentId, dutyIndex, slot);
  };
  const tapAssignSupervisionDuty = (dutyIndex: number, slot: 'first_on_duty' | 'second_on_duty') => {
    if (!selectedResidentId) return;
    assignToSupervisionDuty(selectedResidentId, dutyIndex, slot);
    setSelectedResidentId(null);
  };

  // Migration 75: the current in-memory grid state, bundled once, for
  // either a direct combined_master_rosters write (pre-first-publish) or
  // a revision save (post-publish) — same 4 fields either way.
  const currentGridsSnapshot = () => ({
    gop_clinic_grid: gopGrid,
    emergency_call_grid: emergencyGrid,
    supervision_grid: supervisionGrid,
    satellite_grid: satelliteGrid,
  });

  const saveDraft = async () => {
    if (!masterRoster) return;
    setIsSaving(true);
    try {
      if (masterRoster.status === 'published') {
        // Revision-safe path — combined_master_rosters is NEVER written
        // here. startRevision() is idempotent (reopens an existing
        // in-progress revision rather than re-snapshotting over it).
        const revision = activeRevision ?? await rosterRevisionService.startRevision(adminCode);
        // Proposal-level AI provenance concession (see this file's own
        // aiAssistedOperationSignatures comment above) -- purely additive:
        // saveDraft() never passes a change_reason today, so there is
        // nothing this could ever overwrite.
        const aiAssistedCount = lastAppliedOperations.filter((op) => aiAssistedOperationSignatures.has(JSON.stringify(op))).length;
        const changeReason = aiAssistedCount > 0
          ? `Includes ${aiAssistedCount} AI-assisted operation(s) accepted by the Chief.`
          : undefined;
        const saved = await rosterRevisionService.saveRevision(adminCode, revision.id, revision.updated_at, currentGridsSnapshot(), changeReason);
        setActiveRevision(saved);
        setLastAppliedOperations([]);
        setStatusMessage(`Saved to Revision #${saved.revision_number} — not yet published. Residents still see the current published roster.`);
      } else {
        // Unchanged: nothing has been published yet, so there is nothing
        // for a revision to protect residents from.
        const updated = await databaseService.updateMasterRoster(masterRoster.id, {
          ...currentGridsSnapshot(),
          status: 'chief_review',
        });
        setMasterRoster(updated);
        setStatusMessage('Draft saved.');
      }
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err) {
      console.warn(err);
      if (err instanceof Error && /changed elsewhere/i.test(err.message) && activeRevision) {
        await enterRebaseReview();
      } else {
        setStatusMessage(err instanceof Error ? err.message : 'Failed to save draft.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const publish = async () => {
    if (!masterRoster || !collection) return;
    setIsSaving(true);
    try {
      if (masterRoster.status === 'published') {
        // Ensure the revision reflects the CURRENT in-memory grid state
        // before promoting it — Publish must never bypass Save.
        const revision = activeRevision ?? await rosterRevisionService.startRevision(adminCode);
        const aiAssistedCount = lastAppliedOperations.filter((op) => aiAssistedOperationSignatures.has(JSON.stringify(op))).length;
        const changeReason = aiAssistedCount > 0
          ? `Includes ${aiAssistedCount} AI-assisted operation(s) accepted by the Chief.`
          : undefined;
        const saved = await rosterRevisionService.saveRevision(adminCode, revision.id, revision.updated_at, currentGridsSnapshot(), changeReason);
        await rosterRevisionService.publishRevision(adminCode, saved.id, saved.updated_at);
        // Single atomic UPDATE already happened server-side — reload to
        // pick up the new live combined_master_rosters content (and its
        // current_revision_id) rather than hand-reconciling state here.
        await load();
        setActiveRevision(null);

        await databaseService.createAnnouncement({
          title: `${MONTH_NAMES[month - 1]} ${year} Duty Roster Updated`,
          body: `The combined GOP, A&E, supervision, and satellite duty roster for ${MONTH_NAMES[month - 1]} ${year} has been updated (Revision #${saved.revision_number} published). Check the roster for your assignments.`,
          category: 'Roster',
          pinned: true,
        }, tenantId);

        setStatusMessage(`Revision #${saved.revision_number} published and announcement posted.`);
      } else {
        // Unchanged: first-ever publish for this collection — no
        // revision is involved because nothing has been published yet.
        const updated = await databaseService.updateMasterRoster(masterRoster.id, {
          ...currentGridsSnapshot(),
          status: 'published',
          published_at: new Date().toISOString(),
        });
        setMasterRoster(updated);

        await databaseService.createAnnouncement({
          title: `${MONTH_NAMES[month - 1]} ${year} Duty Roster Published`,
          body: `The combined GOP, A&E, supervision, and satellite duty roster for ${MONTH_NAMES[month - 1]} ${year} has been published. Check the roster for your assignments.`,
          category: 'Roster',
          pinned: true,
        }, tenantId);

        setStatusMessage('Roster published and announcement posted.');
      }
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err) {
      console.warn(err);
      if (err instanceof Error && /changed elsewhere/i.test(err.message) && activeRevision) {
        await enterRebaseReview();
      } else {
        setStatusMessage(err instanceof Error ? err.message : 'Failed to publish roster.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const discardRevision = async () => {
    if (!activeRevision || !masterRoster) return;
    setIsRevisionBusy(true);
    try {
      await rosterRevisionService.discardRevision(adminCode, activeRevision.id);
      setActiveRevision(null);
      setLastAppliedOperations([]);
      setRebasePreview(null);
      setPendingLatestRevision(null);
      // Revert local grid state to the untouched, still-live published
      // content — the revision being discarded is exactly what protected
      // it from ever being written.
      setGopGrid(masterRoster.gop_clinic_grid?.slots ? masterRoster.gop_clinic_grid : EMPTY_GOP);
      setEmergencyGrid(masterRoster.emergency_call_grid?.shifts ? masterRoster.emergency_call_grid : EMPTY_EMERGENCY);
      setSupervisionGrid(masterRoster.supervision_grid?.duties ? masterRoster.supervision_grid : EMPTY_SUPERVISION);
      setSatelliteGrid(masterRoster.satellite_grid?.postings ? masterRoster.satellite_grid : EMPTY_SATELLITE);
      setStatusMessage('Revision discarded — reverted to the currently published roster.');
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to discard revision.');
    } finally {
      setIsRevisionBusy(false);
    }
  };

  // ------------------------------------------------------------------
  // Stale-revision rebase review. migration 75's updated_at optimistic
  // concurrency check (unchanged, still authoritative server-side) is
  // what triggers this — saveDraft()/publish() call this ONLY after that
  // check has already rejected the save. This never silently replays
  // anything: it fetches the latest revision, classifies
  // lastAppliedOperations (everything baked into local grid state since
  // the Chief's last sync) against (last-synced base -> latest) via
  // rosterRebase.ts, and surfaces a Rebase Review the Chief must
  // explicitly confirm before anything is reapplied.
  // ------------------------------------------------------------------
  const enterRebaseReview = async () => {
    if (!activeRevision) return;
    setIsRebasing(true);
    try {
      const latest = await rosterRevisionService.startRevision(adminCode);
      const baseGrids = revisionGridsOrEmpty(activeRevision);
      const latestGrids = revisionGridsOrEmpty(latest);
      const preview = buildRebasePreview(baseGrids, latestGrids, lastAppliedOperations, workforce);
      setRebasePreview(preview);
      setPendingLatestRevision(latest);
      setStatusMessage('This revision changed elsewhere — review below before continuing.');
      setTimeout(() => setStatusMessage(''), 6000);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to load the latest revision for rebase review.');
    } finally {
      setIsRebasing(false);
    }
  };

  // Chief-confirmed replay: applies ONLY the classified-REPLAYABLE
  // operations onto the fetched latest revision, adopts that revision as
  // the new local base, and keeps the replayed operations as the new
  // lastAppliedOperations (applied-but-unsaved relative to this new
  // base). CONFLICT / TARGET_NO_LONGER_VALID operations are dropped, not
  // guessed at — the Chief sees how many were dropped and can redo them
  // manually against the fresh state. Save Draft/Publish afterward go
  // through the exact same persistence path, unchanged.
  const confirmRebase = async () => {
    if (!rebasePreview || !pendingLatestRevision) return;
    setIsRebasing(true);
    try {
      const latestGrids = revisionGridsOrEmpty(pendingLatestRevision);
      const replayed = applyRosterPatch(latestGrids, rebasePreview.replayableOperations, workforce);
      setActiveRevision(pendingLatestRevision);
      setGopGrid(replayed.grids.gop_clinic_grid);
      setEmergencyGrid(replayed.grids.emergency_call_grid);
      setSupervisionGrid(replayed.grids.supervision_grid);
      setSatelliteGrid(replayed.grids.satellite_grid);
      setLastAppliedOperations(rebasePreview.replayableOperations);
      const droppedCount = rebasePreview.results.length - rebasePreview.replayableOperations.length;
      const revisionNumber = pendingLatestRevision.revision_number;
      setRebasePreview(null);
      setPendingLatestRevision(null);
      setStatusMessage(
        droppedCount > 0
          ? `Rebased onto Revision #${revisionNumber}. ${rebasePreview.replayableOperations.length} change(s) replayed; ${droppedCount} change(s) dropped (conflict or no longer valid) — review and redo them if still needed, then Save Draft again.`
          : `Rebased onto Revision #${revisionNumber}. All ${rebasePreview.replayableOperations.length} change(s) replayed cleanly — Save Draft again to persist.`
      );
      setTimeout(() => setStatusMessage(''), 7000);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to rebase onto the latest revision.');
    } finally {
      setIsRebasing(false);
    }
  };

  const cancelRebase = () => {
    setRebasePreview(null);
    setPendingLatestRevision(null);
    setStatusMessage('Rebase cancelled — your local changes remain unsaved. Discard the revision if you want to start over from the latest state instead.');
    setTimeout(() => setStatusMessage(''), 6000);
  };

  // Migration 75: minimal, deterministic, human-readable diff sufficient
  // for this slice — which of the 4 sections have unsaved local changes
  // relative to the currently-published content. Deliberately NOT a
  // sophisticated visual diff engine (see the design doc).
  const sectionsWithUnsavedChanges = (): string[] => {
    if (!masterRoster || !activeRevision) return [];
    const changed: string[] = [];
    if (JSON.stringify(gopGrid) !== JSON.stringify(masterRoster.gop_clinic_grid)) changed.push('GOP Clinic Grid');
    if (JSON.stringify(emergencyGrid) !== JSON.stringify(masterRoster.emergency_call_grid)) changed.push('A&E Emergency Grid');
    if (JSON.stringify(supervisionGrid) !== JSON.stringify(masterRoster.supervision_grid)) changed.push('Supervision Grid');
    if (JSON.stringify(satelliteGrid) !== JSON.stringify(masterRoster.satellite_grid)) changed.push('Satellite Grid');
    return changed;
  };

  // ------------------------------------------------------------------
  // Structured Chief editing (assign / replace / unassign only).
  // structured edit -> patch -> deterministic LOCAL application to the
  // revision snapshot -> validation -> human-readable diff -> [existing]
  // Save Draft persists to the revision via chief_save_roster_revision,
  // completely unchanged. combined_master_rosters is never touched here.
  // ------------------------------------------------------------------
  const addPendingOperation = () => {
    if (patchOp === 'assign' && !patchWorkforceId) { setStatusMessage('Choose a workforce member to assign.'); return; }
    if (patchOp === 'unassign' && !patchWorkforceId) { setStatusMessage('Choose which workforce member to unassign.'); return; }
    if (patchOp === 'replace' && (!patchFromWorkforceId || !patchWorkforceId)) { setStatusMessage('Choose both the current and replacement workforce member.'); return; }
    if (patchOp === 'replace' && patchFromWorkforceId === patchWorkforceId) { setStatusMessage('Replacement must be a different person from the one being replaced.'); return; }

    let operation: RosterPatchOperation;
    if (patchOp === 'assign') {
      operation = { op: 'assign', section: patchSection, row_index: patchRowIndex, field: patchField, workforce_id: patchWorkforceId, reason: patchReason || undefined };
    } else if (patchOp === 'replace') {
      operation = { op: 'replace', section: patchSection, row_index: patchRowIndex, field: patchField, from_workforce_id: patchFromWorkforceId, to_workforce_id: patchWorkforceId, reason: patchReason || undefined };
    } else {
      operation = { op: 'unassign', section: patchSection, row_index: patchRowIndex, field: patchField, workforce_id: patchWorkforceId, reason: patchReason || undefined };
    }
    setPendingOperations(prev => [...prev, operation]);
    setPatchWorkforceId('');
    setPatchFromWorkforceId('');
    setPatchReason('');
  };

  const removePendingOperation = (index: number) => {
    setPendingOperations(prev => prev.filter((_, i) => i !== index));
  };

  // Deterministic, pure, recomputed every render — never stale relative
  // to pendingOperations. Only meaningful while an editable revision is
  // open; the pending queue itself is also only ever shown/usable then.
  const patchPreview = activeRevision
    ? applyRosterPatch(currentGridsSnapshot(), pendingOperations, workforce)
    : null;

  // Reuses computeReconciliationIssues() completely unmodified against
  // the HYPOTHETICAL post-patch grids — per this slice's own design doc,
  // some of these findings (missing_expected_coverage/
  // ineligible_assignment) are already-disclosed UCH/Family-Medicine-
  // specific adapter logic, not universal Workspc rules; shown here as
  // non-blocking warnings either way, matching current behavior (this
  // panel has never blocked save/publish).
  const patchReconciliationIssues = (patchPreview && masterRoster)
    ? computeReconciliationIssues(submissions, workforce, rotations, { ...masterRoster, ...patchPreview.grids })
    : [];

  const applyPendingOperations = () => {
    if (!patchPreview) return;
    setGopGrid(patchPreview.grids.gop_clinic_grid);
    setEmergencyGrid(patchPreview.grids.emergency_call_grid);
    setSupervisionGrid(patchPreview.grids.supervision_grid);
    setSatelliteGrid(patchPreview.grids.satellite_grid);
    // Keep only the operations that FAILED (still visible with their
    // error for the Chief to fix or remove) — the ones that succeeded
    // are now reflected in the grids above and cleared from the queue.
    const failedSignatures = new Set(patchPreview.errors.map((e) => JSON.stringify(e.operation)));
    const succeededOperations = pendingOperations.filter((op) => !failedSignatures.has(JSON.stringify(op)));
    setLastAppliedOperations((prev) => [...prev, ...succeededOperations]);
    setPendingOperations((prev) => prev.filter((op) => failedSignatures.has(JSON.stringify(op))));
    setStatusMessage(
      patchPreview.errors.length > 0
        ? `Applied ${patchPreview.diffs.length} change(s) to the local snapshot. ${patchPreview.errors.length} operation(s) could not be applied — see errors below.`
        : `Applied ${patchPreview.diffs.length} change(s) to the local snapshot. Click Save Draft to persist to the revision.`
    );
    setTimeout(() => setStatusMessage(''), 5000);
  };

  // ------------------------------------------------------------------
  // Net roster diff — base (last-synced revision) vs. final (patchPreview
  // above already models base + lastAppliedOperations + pendingOperations
  // in one hypothetical snapshot). This is a pure before/after comparison
  // with no awareness of which operations produced the final state, so
  // cancel-out sequences (assign then unassign, replace then replace
  // back) collapse to "no change" automatically — see rosterNetDiff.ts.
  // Per this slice's design, Chief approval is based on THIS net result,
  // not the raw per-operation list above (which remains visible too).
  // ------------------------------------------------------------------
  const netDiffBaseGrids = activeRevision ? revisionGridsOrEmpty(activeRevision) : null;
  const netDiffEntries = (netDiffBaseGrids && patchPreview)
    ? computeNetRosterDiff(netDiffBaseGrids, patchPreview.grids, workforce)
    : [];
  const netReconciliationIssues = (netDiffBaseGrids && masterRoster && patchPreview)
    ? computeNetReconciliationIssues(
        computeReconciliationIssues(submissions, workforce, rotations, { ...masterRoster, ...netDiffBaseGrids }),
        computeReconciliationIssues(submissions, workforce, rotations, { ...masterRoster, ...patchPreview.grids })
      )
    : null;

  // Swap UI — convenience form only. Compiles into 2 existing 'replace'
  // operations (rosterSwap.ts) queued into the SAME pendingOperations
  // list as any manual structured edit; no new patch primitive.
  const addSwapToPending = () => {
    const result = compileSwapToOperations(
      currentGridsSnapshot(),
      { section: swapASection, row_index: swapARowIndex, field: swapAField, workforce_id: swapAWorkforceId },
      { section: swapBSection, row_index: swapBRowIndex, field: swapBField, workforce_id: swapBWorkforceId },
      workforce,
      swapReason || undefined
    );
    if (result.status === 'rejected') {
      setStatusMessage(result.reason);
      setTimeout(() => setStatusMessage(''), 5000);
      return;
    }
    setPendingOperations((prev) => [...prev, ...result.operations]);
    setSwapAWorkforceId('');
    setSwapBWorkforceId('');
    setSwapReason('');
    setStatusMessage('Swap queued as 2 replace operations — review in Pending Changes below.');
    setTimeout(() => setStatusMessage(''), 4000);
  };

  // ------------------------------------------------------------------
  // Roster AI V1 -- Prompt-to-Patch Proposal Layer. LOCAL ONLY. Minimal
  // context sent to the model: current roster rows (by section/row_index/
  // field/current occupant DISPLAY NAMES, never workforce_id) and active
  // workforce (display_name/category only) -- never admin_access_code (it
  // authenticates the Edge Function request but is never put in the
  // prompt), resident_code, email, auth user ids, or any other tenant's
  // data. See rosterPatchProposalService.ts / roster-patch-proposal Edge
  // Function for the request/response contract this builds.
  // ------------------------------------------------------------------
  const buildRosterProposalContext = (): RosterProposalContextRow[] => {
    const grids = currentGridsSnapshot();
    const nameById = workforceNameMap(workforce);
    const context: RosterProposalContextRow[] = [];
    (['gop', 'emergency', 'supervision', 'satellite'] as RosterSection[]).forEach((section) => {
      const rows = rowsForSection(grids, section) as Array<Record<string, unknown>>;
      const fields = fieldsForSection(section);
      rows.forEach((row, row_index) => {
        const current: Partial<Record<RosterPatchField, string[] | null>> = {};
        fields.forEach((field) => {
          if (isSupervisionScalarField(section, field)) {
            const val = (row[field] as string | null) ?? null;
            current[field] = val ? [val] : null;
          } else {
            const ids = (row[field] as string[] | undefined) || [];
            current[field] = ids.map((id) => nameById.get(id) ?? id);
          }
        });
        context.push({
          section,
          row_index,
          date_or_day: (row.date_or_day as string | null) ?? null,
          // Same helper the deterministic location resolver uses to
          // re-derive a row's label when matching a symbolic operation
          // back to the current grid (rowSemanticLabelFor, rosterPatch.ts)
          // -- a single source of truth so "what we tell the model" and
          // "how we resolve what it says back" can never silently drift
          // apart. See resolveSymbolicRosterTarget()'s own header.
          label: rowSemanticLabelFor(section, row),
          current,
        });
      });
    });
    return context;
  };

  const buildWorkforceProposalContext = (): RosterProposalWorkforceEntry[] =>
    workforce.map((w) => ({ display_name: w.full_name, category: w.category }));

  // Small display helpers -- 'swap' carries target_a/target_b instead of a
  // single section/field, so these narrow the union once for the render
  // below rather than repeating the op==='swap' check inline per label.
  const sectionKeyForSymbolicOperation = (op: SymbolicOperation): RosterSection => (op.op === 'swap' ? op.target_a.section : op.section);
  const fieldForSymbolicOperation = (op: SymbolicOperation): RosterPatchField | null => (op.op === 'swap' ? null : op.field);

  const generateAiProposal = async () => {
    if (!aiInstruction.trim() || !activeRevision) return;
    setIsGeneratingAiProposal(true);
    setAiProposalError('');
    try {
      // Captured ONCE, synchronously, before the async provider round-trip
      // -- this is EXACTLY the roster state buildRosterProposalContext()
      // (called synchronously right below, same tick, no await in
      // between) describes to the model, and is therefore the only
      // correct deterministic baseline for the working-state staleness
      // check in acceptAiOperations() below. Re-reading currentGridsSnapshot()
      // fresh after the await would already reflect any edit the Chief
      // made during the round-trip, silently defeating that check.
      const generationGrids = currentGridsSnapshot();
      const result = await generateRosterPatchProposal({
        admin_access_code: adminCode,
        instruction: aiInstruction.trim(),
        roster_context: buildRosterProposalContext(),
        workforce_context: buildWorkforceProposalContext(),
      });
      if (result.status === 'ok') {
        // Compiled against the SAME generationGrids the model saw (not a
        // fresh currentGridsSnapshot() call here either) -- swap
        // pre-validation in compileSwapToOperations must check occupancy
        // against the exact state the model reasoned about, not whatever
        // state happens to exist at the moment the response arrived.
        const compiled = compileProposalOperations(result.proposal.operations, generationGrids, workforce);
        setAiProposal(result.proposal);
        setAiCompiledOperations(compiled);
        setAiAcceptedIndices(new Set(compiled.map((c, i) => (c.status === 'resolved' ? i : -1)).filter((i) => i >= 0)));
        // Revision id/updated_at are kept only as identity/context (e.g. a
        // future "generated against Revision #N" label) -- the actual
        // working-state invariant is enforced entirely via
        // aiProposalBaseGrids below, compared against currentGridsSnapshot()
        // at accept time, in acceptAiOperations().
        setAiProposalBaseRevisionId(activeRevision.id);
        setAiProposalBaseUpdatedAt(activeRevision.updated_at);
        setAiProposalBaseGrids(generationGrids);
      } else if (result.status === 'quota_exceeded') {
        setAiProposalError(result.message);
      } else if (result.status === 'invalid_admin_code') {
        setAiProposalError('Could not verify Chief admin access for the AI proposal request.');
      } else if (result.status === 'invalid_request') {
        setAiProposalError(result.message);
      } else if (result.status === 'schema_invalid') {
        setAiProposalError('The AI response did not match the expected format — try rephrasing the instruction, or use the manual form below.');
      } else {
        setAiProposalError('Could not generate a proposal right now — try again, or continue editing manually.');
      }
    } finally {
      setIsGeneratingAiProposal(false);
    }
  };

  const toggleAiAcceptedIndex = (i: number) => {
    setAiAcceptedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  const rejectAiProposal = () => {
    setAiProposal(null);
    setAiCompiledOperations([]);
    setAiAcceptedIndices(new Set());
    setAiProposalError('');
    setAiProposalBaseRevisionId(null);
    setAiProposalBaseUpdatedAt(null);
    setAiProposalBaseGrids(null);
  };

  // Every checked, RESOLVED compiled operation, flattened (a resolved swap
  // carries 2 real operations; everything else carries 1). Ambiguous/
  // unresolved/swap_rejected entries can never be checked in the first
  // place (Section 7 below renders no checkbox for them) -- this array can
  // never silently include one.
  const aiCheckedFlatOperations: RosterPatchOperation[] = aiCompiledOperations
    .filter((c, i) => c.status === 'resolved' && aiAcceptedIndices.has(i))
    .flatMap((c) => (c as Extract<CompiledProposalOperation, { status: 'resolved' }>).operations);

  // Existing deterministic validation/reconciliation/net-diff, reused
  // UNCHANGED, run against the currently-checked AI operations BEFORE the
  // Chief commits to queueing them -- exactly the same functions the
  // Structured Edit panel's own patchPreview/patchReconciliationIssues/
  // netDiffEntries already use for pendingOperations, just given a
  // different (not-yet-queued) operation set as input.
  const aiPatchPreview = (activeRevision && aiCheckedFlatOperations.length > 0)
    ? applyRosterPatch(currentGridsSnapshot(), aiCheckedFlatOperations, workforce)
    : null;
  const aiReconciliationIssues = (aiPatchPreview && masterRoster)
    ? computeReconciliationIssues(submissions, workforce, rotations, { ...masterRoster, ...aiPatchPreview.grids })
    : [];
  const aiNetDiffEntries = (aiPatchPreview && netDiffBaseGrids)
    ? computeNetRosterDiff(netDiffBaseGrids, aiPatchPreview.grids, workforce)
    : [];

  // Appends into the EXISTING pendingOperations queue -- the same setter
  // addPendingOperation()/addSwapToPending() already use. If the revision
  // has moved since this proposal was generated (only possible via this
  // Chief's own save/publish/discard/rebase within this session -- see
  // this file's aiProposalBase* comment above), route through the
  // EXISTING rebase-review machinery (buildRebasePreview + the same
  // rebasePreview/pendingLatestRevision state and Confirm Rebase button
  // already rendered above) instead of silently regenerating or applying.
  const acceptAiOperations = () => {
    if (!activeRevision || aiCheckedFlatOperations.length === 0) return;

    // Working-state staleness: compares the EXACT grids the model saw
    // (aiProposalBaseGrids, captured in generateAiProposal() from the same
    // currentGridsSnapshot() call used to build the model's context)
    // against the CURRENT effective local grids -- not revision id/
    // updated_at, which only ever changes on a save/publish/discard/rebase
    // round-trip and would miss a purely local edit (manual, drag-and-drop,
    // or another already-applied AI proposal) made between generation and
    // this accept click. Revision metadata
    // (aiProposalBaseRevisionId/aiProposalBaseUpdatedAt) is retained only
    // as identity/context, never as a substitute for this comparison.
    const currentGrids = currentGridsSnapshot();
    const isStale = !aiProposalBaseGrids || JSON.stringify(currentGrids) !== JSON.stringify(aiProposalBaseGrids);

    if (isStale && aiProposalBaseGrids) {
      // Reuses the EXISTING rebase machinery (buildRebasePreview,
      // rosterRebase.ts, UNCHANGED) comparing proposal baseline -> CURRENT
      // local grids -- a conflict with the Chief's own concurrent local
      // edit is classified CONFLICT, never misreported as REPLAYABLE
      // merely because the server-side revision happens to be unchanged.
      // pendingLatestRevision carries the CURRENT local grid content (so
      // confirmRebase(), also UNCHANGED, replays the accepted AI
      // operations onto the Chief's actual current working state rather
      // than reverting to the last-saved server content) with every other
      // field taken from activeRevision unchanged -- revision identity is
      // preserved as context, never as the staleness signal itself.
      const preview = buildRebasePreview(aiProposalBaseGrids, currentGrids, aiCheckedFlatOperations, workforce);
      setRebasePreview(preview);
      setPendingLatestRevision({ ...activeRevision, ...currentGrids });
      setAiAssistedOperationSignatures((prev) => {
        const next = new Set(prev);
        aiCheckedFlatOperations.forEach((op) => next.add(JSON.stringify(op)));
        return next;
      });
      rejectAiProposal();
      setAiInstruction('');
      setStatusMessage('The working roster changed since this proposal was generated — review the accepted AI change(s) below before continuing.');
      setTimeout(() => setStatusMessage(''), 6000);
      return;
    }

    setPendingOperations((prev) => [...prev, ...aiCheckedFlatOperations]);
    setAiAssistedOperationSignatures((prev) => {
      const next = new Set(prev);
      aiCheckedFlatOperations.forEach((op) => next.add(JSON.stringify(op)));
      return next;
    });
    rejectAiProposal();
    setAiInstruction('');
    setStatusMessage(`${aiCheckedFlatOperations.length} AI-proposed change(s) queued — review in Pending Changes below.`);
    setTimeout(() => setStatusMessage(''), 4000);
  };

  if (isLoading) {
    return (
      <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl">
        <RefreshCw size={28} className="text-slate-400 animate-spin mx-auto mb-2" />
        <p className="text-sm text-slate-500">Loading Multi-Roster Manager...</p>
      </div>
    );
  }

  if (!collection) {
    return (
      <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl text-slate-400">
        <AlertTriangle size={28} className="mx-auto mb-2" />
        <p className="text-sm font-medium">No active collection cycle — open one in Collection &amp; Settings first.</p>
      </div>
    );
  }

  // Workforce Option A (read-only reconciliation) — pure, cheap computation
  // over already-loaded state; recomputed on every render, no memoization
  // needed at this data scale. Never writes anywhere. See
  // docs/WORKFORCE_V1_RECOVERY_SPEC.md.
  const reconciliationIssues = computeReconciliationIssues(submissions, workforce, rotations, masterRoster);
  // missing_expected_coverage issues carry workforceId = null by design —
  // the problem is that nobody appropriate is assigned, so there is no
  // member to group them under. groupReconciliationIssuesForDisplay splits
  // those out so they never silently collapse into one unlabeled `null`
  // group; they render in their own titled "Missing Expected Coverage"
  // section below instead. Every other issue type (including
  // ineligible_assignment) always carries a real member and keeps using
  // the existing per-member grouping untouched.
  const { byMember: reconciliationIssuesByMember, rosterLevel: rosterLevelIssues } = groupReconciliationIssuesForDisplay(reconciliationIssues);

  return (
    <div className="space-y-6">
      {statusMessage && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-3 text-xs flex items-center space-x-2">
          <CheckCircle2 size={14} />
          <span>{statusMessage}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-2">
          <ListChecks className="text-slate-500" size={16} />
          <h3 className="font-bold text-slate-800 text-sm">
            Master Roster — {MONTH_NAMES[month - 1]} {year}
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">({masterRoster?.status})</span>
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={saveDraft} disabled={isSaving} className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 font-bold rounded-lg text-xs transition cursor-pointer">
            Save Draft
          </button>
          <button onClick={publish} disabled={isSaving} className="inline-flex items-center space-x-1.5 px-3 py-1.5 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-lg text-xs shadow-sm transition cursor-pointer">
            <Megaphone size={13} />
            <span>{activeRevision ? 'Publish Revision' : 'Publish'}</span>
          </button>
        </div>
      </div>

      {/* Stale-revision Rebase Review. Only ever shown after a Save/
          Publish attempt was rejected by migration 75's updated_at
          concurrency check (unchanged, still authoritative). Nothing here
          replays anything until the Chief explicitly clicks "Confirm
          Rebase" below — see enterRebaseReview()/confirmRebase(). */}
      {rebasePreview && pendingLatestRevision && (
        <div className="bg-rose-50 border-2 border-rose-300 rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="text-rose-600" size={16} />
            <h3 className="font-bold text-rose-800 text-sm">
              Rebase Review — this revision changed elsewhere (now at #{pendingLatestRevision.revision_number})
            </h3>
          </div>
          <p className="text-[11px] text-rose-700">
            Your changes were not saved. Review each pending change against the latest revision below, then explicitly confirm before anything is reapplied.
          </p>
          <div className="space-y-1.5">
            {rebasePreview.results.map((result, i) => (
              <div key={i} className={`rounded-lg px-3 py-2 text-xs border ${
                result.classification === 'REPLAYABLE' ? 'bg-emerald-50 border-emerald-200' :
                result.classification === 'CONFLICT' ? 'bg-rose-100 border-rose-300' :
                'bg-slate-100 border-slate-300'
              }`}>
                <p className="font-semibold text-slate-700">
                  {PATCH_SECTION_LABELS.find(([k]) => k === result.operation.section)?.[1]} — Row {result.operation.row_index} — {fieldLabelFor(result.operation.field)}
                  <span className={`ml-2 text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                    result.classification === 'REPLAYABLE' ? 'bg-emerald-200 text-emerald-800' :
                    result.classification === 'CONFLICT' ? 'bg-rose-200 text-rose-800' :
                    'bg-slate-200 text-slate-700'
                  }`}>
                    {result.classification}
                  </span>
                </p>
                <p className="text-slate-600 mt-0.5">{result.reason}</p>
                <p className="text-slate-500 mt-0.5">
                  Latest current value: {Array.isArray(result.latestValue) ? (result.latestValue.join(', ') || 'nobody') : (result.latestValue ?? 'nobody')}
                </p>
              </div>
            ))}
          </div>
          {rebasePreview.netDiffIfReplayed.length > 0 && (
            <div className="bg-white border border-rose-200 rounded-lg px-3 py-2 text-xs space-y-1">
              <p className="font-bold text-rose-800">If confirmed, this would change on Revision #{pendingLatestRevision.revision_number}:</p>
              {rebasePreview.netDiffIfReplayed.map((entry, i) => (
                <p key={i} className="text-rose-700">
                  {PATCH_SECTION_LABELS.find(([k]) => k === entry.section)?.[1]} — {entry.dateOrDay ?? `Row ${entry.row_index}`} — {entry.fieldLabel}: {' '}
                  {entry.removedNames.length > 0 && <span>removes {entry.removedNames.join(', ')}</span>}
                  {entry.removedNames.length > 0 && entry.addedNames.length > 0 && <span>, </span>}
                  {entry.addedNames.length > 0 && <span>adds {entry.addedNames.join(', ')}</span>}
                </p>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={confirmRebase}
              disabled={isRebasing}
              className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 disabled:bg-slate-400 text-white font-bold rounded-lg text-xs transition cursor-pointer"
            >
              Confirm Rebase — replay {rebasePreview.replayableOperations.length} change(s) onto #{pendingLatestRevision.revision_number}
            </button>
            <button
              onClick={cancelRebase}
              disabled={isRebasing}
              className="px-3 py-1.5 border border-rose-300 hover:bg-rose-100 text-rose-800 font-bold rounded-lg text-xs transition cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Migration 75: revision-safety indicator. Only ever shown once a
          roster has already been published — combined_master_rosters is
          not written to at all while this is visible; residents keep
          reading the untouched, currently-published content the whole
          time. Minimal, deterministic diff (which sections changed),
          not a sophisticated visual diff engine, per this slice's scope. */}
      {activeRevision && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-bold text-amber-800">
              Editing Revision #{activeRevision.revision_number} — not yet published
            </p>
            <p className="text-[11px] text-amber-700 mt-0.5">
              Residents currently see the previously published roster. {(() => {
                const changed = sectionsWithUnsavedChanges();
                return changed.length > 0
                  ? `Unsaved changes: ${changed.join(', ')}.`
                  : 'No unsaved changes since this revision was last saved.';
              })()}
            </p>
          </div>
          <button
            onClick={discardRevision}
            disabled={isRevisionBusy || isSaving}
            className="px-3 py-1.5 border border-amber-300 hover:bg-amber-100 text-amber-800 font-bold rounded-lg text-xs transition cursor-pointer"
          >
            Discard Revision
          </button>
        </div>
      )}

      {/* Net Effect — base (last-synced revision) vs. final hypothetical
          snapshot (base + everything applied locally + everything still
          queued). Per this slice's design, Chief approval should be based
          on this net result, not the raw per-operation list (kept
          available below in the Structured Edit panel). This is a pure
          before/after diff — cancel-out sequences (assign then unassign,
          replace then replace back) collapse to nothing automatically,
          with no special-casing of any specific sequence. */}
      {activeRevision && (netDiffEntries.length > 0 || (netReconciliationIssues && (netReconciliationIssues.introducedByBatch.length > 0 || netReconciliationIssues.resolvedByBatch.length > 0))) && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="text-slate-500" size={16} />
            <h3 className="font-bold text-slate-800 text-sm">Net Effect vs. Revision #{activeRevision.revision_number}</h3>
          </div>
          {netDiffEntries.length === 0 ? (
            <p className="text-xs text-slate-400">No net change — any queued/applied edits cancel out to the last-saved revision.</p>
          ) : (
            <div className="space-y-1.5">
              {netDiffEntries.map((entry, i) => (
                <div key={i} className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs">
                  <p className="font-semibold text-slate-700">
                    {PATCH_SECTION_LABELS.find(([k]) => k === entry.section)?.[1]} — {entry.dateOrDay ?? `Row ${entry.row_index}`} — {entry.fieldLabel}
                  </p>
                  <p className="text-slate-600 mt-0.5">
                    {entry.removedNames.length > 0 && <span>Removed: {entry.removedNames.join(', ')}. </span>}
                    {entry.addedNames.length > 0 && <span>Added: {entry.addedNames.join(', ')}.</span>}
                  </p>
                </div>
              ))}
            </div>
          )}
          {netReconciliationIssues && (netReconciliationIssues.introducedByBatch.length > 0 || netReconciliationIssues.resolvedByBatch.length > 0) && (
            <div className="border-t border-slate-100 pt-2 space-y-1">
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Net reconciliation impact (non-blocking)</p>
              {netReconciliationIssues.introducedByBatch.map((issue, i) => (
                <p key={`intro-${i}`} className="text-[10px] text-rose-700">Introduced: {issue.message}</p>
              ))}
              {netReconciliationIssues.resolvedByBatch.map((issue, i) => (
                <p key={`resolved-${i}`} className="text-[10px] text-emerald-700">Resolved: {issue.message}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Structured Chief editing (assign / replace / unassign only) —
          only ever shown/usable while an editable revision is open. Row
          addressing (below) is safe ONLY because this slice never
          inserts/deletes/reorders a row — see rosterPatch.ts's header. */}
      {activeRevision && (() => {
        const rows = rowsForSection(currentGridsSnapshot(), patchSection);
        const availableFields = fieldsForSection(patchSection);
        return (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-4">
            <div className="flex items-center space-x-2">
              <Edit3 className="text-slate-500" size={16} />
              <h3 className="font-bold text-slate-800 text-sm">Structured Edit — assign / replace / unassign</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">Section</label>
                <select
                  value={patchSection}
                  onChange={(e) => {
                    const section = e.target.value as RosterSection;
                    setPatchSection(section);
                    setPatchRowIndex(0);
                    setPatchField(fieldsForSection(section)[0]);
                  }}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white"
                >
                  {PATCH_SECTION_LABELS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">Row</label>
                <select
                  value={patchRowIndex}
                  onChange={(e) => setPatchRowIndex(Number(e.target.value))}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white"
                >
                  {rows.length === 0 && <option value={0}>(no rows in this section)</option>}
                  {rows.map((row, i) => <option key={i} value={i}>{rowLabelFor(patchSection, row)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">Field</label>
                <select
                  value={patchField}
                  onChange={(e) => setPatchField(e.target.value as RosterPatchField)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white"
                >
                  {availableFields.map((f) => <option key={f} value={f}>{fieldLabelFor(f)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">Operation</label>
                <select
                  value={patchOp}
                  onChange={(e) => setPatchOp(e.target.value as PatchOpKind)}
                  className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white"
                >
                  <option value="assign">Assign</option>
                  <option value="replace">Replace</option>
                  <option value="unassign">Unassign</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 items-end">
              {patchOp === 'replace' && (
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Currently assigned (to replace)</label>
                  <select value={patchFromWorkforceId} onChange={(e) => setPatchFromWorkforceId(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
                    <option value="">Choose...</option>
                    {workforce.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">
                  {patchOp === 'assign' ? 'Assign' : patchOp === 'replace' ? 'Replacement' : 'Unassign'}
                </label>
                <select value={patchWorkforceId} onChange={(e) => setPatchWorkforceId(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
                  <option value="">Choose...</option>
                  {workforce.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                </select>
              </div>
              <div className="lg:col-span-2">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Reason (optional)</label>
                <input value={patchReason} onChange={(e) => setPatchReason(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm" placeholder="e.g. covering approved leave" />
              </div>
            </div>

            <button onClick={addPendingOperation} className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer">
              <Plus size={14} /> Add to Pending Changes
            </button>

            {pendingOperations.length > 0 && (
              <div className="border-t border-slate-100 pt-3 space-y-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Pending Changes ({pendingOperations.length})</p>
                {pendingOperations.map((op, i) => {
                  const diff = patchPreview?.diffs.find((d) => d.operation === op);
                  const error = patchPreview?.errors.find((e) => e.operation === op);
                  return (
                    <div key={i} className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs ${error ? 'bg-rose-50 border border-rose-200' : 'bg-slate-50'}`}>
                      <div>
                        <p className="font-semibold text-slate-700">
                          {PATCH_SECTION_LABELS.find(([k]) => k === op.section)?.[1]} — {diff?.dateOrDay ?? ''} — {fieldLabelFor(op.field)}
                        </p>
                        {error ? (
                          <p className="text-rose-700 mt-0.5">{error.message}</p>
                        ) : diff ? (
                          <p className="text-slate-600 mt-0.5">
                            {diff.removedName && diff.addedName ? `Replaced ${diff.removedName} with ${diff.addedName}` : diff.addedName ? `Added ${diff.addedName}` : `Removed ${diff.removedName}`}
                          </p>
                        ) : null}
                        {op.reason && <p className="text-slate-400 mt-0.5 italic">"{op.reason}"</p>}
                      </div>
                      <button onClick={() => removePendingOperation(i)} className="shrink-0 text-slate-400 hover:text-rose-600 cursor-pointer" title="Remove from pending changes">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}

                {patchReconciliationIssues.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs space-y-1">
                    <p className="font-bold text-amber-800">Reconciliation warnings for the resulting snapshot (non-blocking):</p>
                    {patchReconciliationIssues.map((issue, i) => (
                      <p key={i} className="text-amber-700">
                        {issue.message}
                        <span className="text-amber-500 ml-1">
                          ({issue.type === 'missing_expected_coverage' || issue.type === 'ineligible_assignment' ? 'FM-specific check' : 'generic check'})
                        </span>
                      </p>
                    ))}
                  </div>
                )}

                <button
                  onClick={applyPendingOperations}
                  disabled={patchPreview?.diffs.length === 0}
                  className="flex items-center gap-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-3 py-2 rounded-lg cursor-pointer"
                >
                  <CheckCircle2 size={14} /> Apply Pending Changes to Local Snapshot
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* Swap — convenience form only. Compiles into 2 existing 'replace'
          operations (rosterSwap.ts), queued into the same Pending Changes
          list above. No new patch primitive; no persistence or schema
          knows about "swap" — see rosterSwap.ts's header. */}
      {activeRevision && (() => {
        const rowsA = rowsForSection(currentGridsSnapshot(), swapASection);
        const rowsB = rowsForSection(currentGridsSnapshot(), swapBSection);
        const fieldsA = fieldsForSection(swapASection);
        const fieldsB = fieldsForSection(swapBSection);
        return (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-4">
            <div className="flex items-center space-x-2">
              <Edit3 className="text-slate-500" size={16} />
              <h3 className="font-bold text-slate-800 text-sm">Swap — compiles into 2 replace operations</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {([
                ['A' as const, swapASection, setSwapASection, swapARowIndex, setSwapARowIndex, swapAField, setSwapAField, swapAWorkforceId, setSwapAWorkforceId, rowsA, fieldsA],
                ['B' as const, swapBSection, setSwapBSection, swapBRowIndex, setSwapBRowIndex, swapBField, setSwapBField, swapBWorkforceId, setSwapBWorkforceId, rowsB, fieldsB],
              ] as const).map(([label, section, setSection, rowIndex, setRowIndex, field, setField, workforceId, setWorkforceId, rows, fields]) => (
                <div key={label} className="border border-slate-200 rounded-xl p-3 space-y-2">
                  <p className="text-[10px] font-bold text-slate-400 uppercase">Target {label}</p>
                  <select
                    value={section}
                    onChange={(e) => {
                      const s = e.target.value as RosterSection;
                      setSection(s);
                      setRowIndex(0);
                      setField(fieldsForSection(s)[0]);
                    }}
                    className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white"
                  >
                    {PATCH_SECTION_LABELS.map(([key, sLabel]) => <option key={key} value={key}>{sLabel}</option>)}
                  </select>
                  <select value={rowIndex} onChange={(e) => setRowIndex(Number(e.target.value))} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
                    {rows.length === 0 && <option value={0}>(no rows in this section)</option>}
                    {rows.map((row, i) => <option key={i} value={i}>{rowLabelFor(section, row)}</option>)}
                  </select>
                  <select value={field} onChange={(e) => setField(e.target.value as RosterPatchField)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
                    {fields.map((f) => <option key={f} value={f}>{fieldLabelFor(f)}</option>)}
                  </select>
                  <select value={workforceId} onChange={(e) => setWorkforceId(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm bg-white">
                    <option value="">Current occupant to swap out...</option>
                    {workforce.map((w) => <option key={w.id} value={w.id}>{w.full_name}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase">Reason (optional)</label>
                <input value={swapReason} onChange={(e) => setSwapReason(e.target.value)} className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm" placeholder="e.g. mutual coverage swap" />
              </div>
              <button onClick={addSwapToPending} className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-2 rounded-lg hover:bg-slate-800 cursor-pointer shrink-0">
                <Plus size={14} /> Queue Swap
              </button>
            </div>
          </div>
        );
      })()}

      {/* Roster AI V1 -- Prompt-to-Patch Proposal Layer. Not a chatbot: one
          instruction -> one proposal -> explicit Chief review -> explicit
          accept. The AI never calls Save/Publish and never writes
          pendingOperations except through the SAME "Add to Pending Batch"
          step below, mirroring the manual/swap panels above. If this panel
          fails entirely, the manual Structured Edit / Swap panels above
          remain fully usable, unaffected by anything here.
          GATED (2026-08-31 containment slice): renders only for the
          explicitly-enabled pilot tenant (tenants.module_flags.
          roster_ai_v1_enabled === true, fail-closed default false --
          see the gate state declared near the top of this component).
          Hidden for every other tenant. */}
      {activeRevision && rosterAiV1Enabled && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 space-y-4">
          <div className="flex items-center space-x-2">
            <Sparkles className="text-violet-500" size={16} />
            <h3 className="font-bold text-slate-800 text-sm">AI Proposal — Chief-reviewed only</h3>
          </div>
          <p className="text-[11px] text-slate-400">
            Describe an edit in plain language. The AI proposes symbolic changes only — nothing is saved, published, or applied until you explicitly accept each one below.
          </p>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase">Instruction</label>
              <input
                value={aiInstruction}
                onChange={(e) => setAiInstruction(e.target.value)}
                placeholder="e.g. Put a senior registrar in A&E on Friday"
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm"
              />
            </div>
            <button
              onClick={generateAiProposal}
              disabled={isGeneratingAiProposal || !aiInstruction.trim()}
              className="flex items-center gap-1 text-xs font-bold bg-violet-600 hover:bg-violet-700 disabled:bg-slate-300 text-white px-3 py-2 rounded-lg cursor-pointer shrink-0"
            >
              <Sparkles size={14} /> {isGeneratingAiProposal ? 'Generating...' : 'Generate Proposal'}
            </button>
          </div>

          {aiProposalError && (
            <div className="bg-rose-50 border border-rose-200 text-rose-800 rounded-lg px-3 py-2 text-xs">
              {aiProposalError}
            </div>
          )}

          {aiProposal && (
            <div className="border-t border-slate-100 pt-3 space-y-3">
              <div>
                <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                  aiProposal.outcome === 'valid' ? 'bg-emerald-100 text-emerald-800' :
                  aiProposal.outcome === 'ambiguous_identity' ? 'bg-amber-100 text-amber-800' :
                  'bg-slate-200 text-slate-700'
                }`}>
                  {aiProposal.outcome.replace('_', ' ')}
                </span>
                <p className="text-xs text-slate-700 mt-1">{aiProposal.interpreted_instruction}</p>
                {aiProposal.rationale && <p className="text-[11px] text-slate-500 mt-0.5 italic">{aiProposal.rationale}</p>}
              </div>

              {aiProposal.assumptions.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] text-slate-600 space-y-0.5">
                  <p className="font-bold text-slate-500 uppercase text-[9px]">Assumptions</p>
                  {aiProposal.assumptions.map((a, i) => <p key={i}>{a}</p>)}
                </div>
              )}

              {aiProposal.unsupported_requests.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800 space-y-0.5">
                  <p className="font-bold uppercase text-[9px]">Not supported in this version</p>
                  {aiProposal.unsupported_requests.map((u, i) => <p key={i}>{u}</p>)}
                </div>
              )}

              {aiProposal.unresolved_ambiguity.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-[11px] text-amber-800 space-y-0.5">
                  <p className="font-bold uppercase text-[9px]">Flagged by the AI as unclear</p>
                  {aiProposal.unresolved_ambiguity.map((u, i) => <p key={i}>{u}</p>)}
                </div>
              )}

              {aiCompiledOperations.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Proposed operations ({aiCompiledOperations.length})</p>
                  {aiCompiledOperations.map((c, i) => {
                    if (c.status === 'resolved') {
                      const sectionLabel = PATCH_SECTION_LABELS.find(([k]) => k === sectionKeyForSymbolicOperation(c.symbolic))?.[1];
                      const field = fieldForSymbolicOperation(c.symbolic);
                      const desc = c.symbolic.op === 'assign' ? `Assign ${c.symbolic.subject_name}`
                        : c.symbolic.op === 'unassign' ? `Unassign ${c.symbolic.subject_name}`
                        : c.symbolic.op === 'replace' ? `Replace ${c.symbolic.from_subject_name} with ${c.symbolic.to_subject_name}`
                        : `Swap ${c.symbolic.subject_a_name} and ${c.symbolic.subject_b_name}`;
                      return (
                        <label key={i} className="flex items-start gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs cursor-pointer">
                          <input type="checkbox" checked={aiAcceptedIndices.has(i)} onChange={() => toggleAiAcceptedIndex(i)} className="mt-0.5" />
                          <span>
                            <span className="font-semibold text-slate-700">{sectionLabel ?? c.symbolic.op} — {field ? fieldLabelFor(field) : 'Swap'}</span>
                            <span className="block text-slate-600 mt-0.5">{desc}</span>
                            {c.symbolic.reason && <span className="block text-slate-400 mt-0.5 italic">"{c.symbolic.reason}"</span>}
                          </span>
                        </label>
                      );
                    }
                    if (c.status === 'unresolvable') {
                      return (
                        <div key={i} className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-700">
                          {c.details.map((d, di) => (
                            <p key={di}>
                              {d.status === 'ambiguous'
                                ? `Ambiguous: "${d.name}" could be ${d.candidateNames?.join(', ')} — use the manual form below if you know who is meant.`
                                : `No matching workforce member found for "${d.name}" — use the manual form below if you know who is meant.`}
                            </p>
                          ))}
                        </div>
                      );
                    }
                    // Deterministic location resolution failed (0 or >1
                    // matching roster rows for the AI's stated section/
                    // date/label/field) -- a distinct failure class from
                    // unresolvable identity, never checkable/acceptable.
                    // See rosterPatchProposalCompiler.ts's
                    // resolveSymbolicRosterTarget() for why this can never
                    // be the wrong-row-silently-accepted case anymore.
                    if (c.status === 'location_unresolvable') {
                      return (
                        <div key={i} className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-700">
                          {c.message}
                        </div>
                      );
                    }
                    return (
                      <div key={i} className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-700">
                        Swap could not be compiled: {c.reason}
                      </div>
                    );
                  })}
                </div>
              )}

              {aiPatchPreview && aiPatchPreview.errors.length > 0 && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-700 space-y-1">
                  <p className="font-bold uppercase text-[9px]">Checked operation(s) failed deterministic validation</p>
                  {aiPatchPreview.errors.map((e, i) => <p key={i}>{e.message}</p>)}
                </div>
              )}

              {aiReconciliationIssues.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs space-y-1">
                  <p className="font-bold text-amber-800 uppercase text-[9px]">Reconciliation warnings if checked operations are queued (non-blocking)</p>
                  {aiReconciliationIssues.map((issue, i) => (
                    <p key={i} className="text-amber-700">
                      {issue.message}
                      <span className="text-amber-500 ml-1">
                        ({issue.type === 'missing_expected_coverage' || issue.type === 'ineligible_assignment' ? 'FM-specific check' : 'generic check'})
                      </span>
                    </p>
                  ))}
                </div>
              )}

              {aiCheckedFlatOperations.length > 0 && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs space-y-1">
                  <p className="font-bold text-slate-500 uppercase text-[9px]">Net effect of checked operation(s) vs. current revision</p>
                  {aiNetDiffEntries.length === 0 ? (
                    <p className="text-slate-400">No net change — checked operation(s) cancel out to the current state.</p>
                  ) : (
                    aiNetDiffEntries.map((entry, i) => (
                      <p key={i} className="text-slate-600">
                        {PATCH_SECTION_LABELS.find(([k]) => k === entry.section)?.[1]} — {entry.dateOrDay ?? `Row ${entry.row_index}`} — {entry.fieldLabel}:{' '}
                        {entry.removedNames.length > 0 && <span>removes {entry.removedNames.join(', ')}</span>}
                        {entry.removedNames.length > 0 && entry.addedNames.length > 0 && <span>, </span>}
                        {entry.addedNames.length > 0 && <span>adds {entry.addedNames.join(', ')}</span>}
                      </p>
                    ))
                  )}
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={acceptAiOperations}
                  disabled={aiCheckedFlatOperations.length === 0}
                  className="flex items-center gap-1 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white px-3 py-2 rounded-lg cursor-pointer"
                >
                  <CheckCircle2 size={14} /> Add {aiCheckedFlatOperations.length > 0 ? `${aiCheckedFlatOperations.length} ` : ''}Checked to Pending Batch
                </button>
                <button onClick={rejectAiProposal} className="px-3 py-2 border border-slate-200 hover:bg-slate-50 font-bold rounded-lg text-xs transition cursor-pointer">
                  Discard Proposal
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Workforce Option A — read-only reconciliation checklist. Not a
          new page/tab; positioned immediately before the existing Floor
          Check workflow so the Chief sees it while preparing/reviewing
          the roster for this same cycle. Collapsed by default per member,
          matching ActivityLogPanel.tsx's existing convention. Nothing
          here writes to workforce/submissions/combined_master_rosters. */}
      {(reconciliationIssuesByMember.size > 0 || rosterLevelIssues.length > 0) && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="text-amber-600" size={16} />
            <h4 className="font-bold text-slate-800 text-xs sm:text-sm">
              {reconciliationIssues.length} issue{reconciliationIssues.length === 1 ? '' : 's'} need{reconciliationIssues.length === 1 ? 's' : ''} review
            </h4>
          </div>
          <p className="text-[10px] text-slate-400">
            Cross-checks {t('member', 'resident').toLowerCase()}-submitted rotation/leave, and Family Medicine roster-rule coverage, against current workforce status and the draft roster below.
            These are conflicts to review, not automatic errors — nothing is changed automatically.
          </p>

          {reconciliationIssuesByMember.size > 0 && (
            <div className="divide-y divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
              {Array.from(reconciliationIssuesByMember.entries()).map(([workforceId, { memberName, issues }]) => {
                const isExpanded = expandedIssueMemberId === workforceId;
                return (
                  <div key={workforceId}>
                    <button
                      type="button"
                      onClick={() => setExpandedIssueMemberId(prev => (prev === workforceId ? null : workforceId))}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-slate-50 cursor-pointer transition"
                    >
                      <span className="text-xs font-bold text-slate-700">{memberName}</span>
                      <span className="flex items-center gap-2">
                        <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          {issues.length} issue{issues.length === 1 ? '' : 's'}
                        </span>
                        {isExpanded ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      </span>
                    </button>
                    {isExpanded && (
                      <div className="px-3 pb-3 space-y-2">
                        {issues.map((issue, i) => (
                          <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[10px] text-amber-900">
                            {issue.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* missing_expected_coverage — workforceId is null by design (no
              one appropriate is assigned, so there is no member to file
              this under). Always rendered as its own clearly titled
              roster-level section, never folded into the per-member list
              above and never attached to a placeholder person. */}
          {rosterLevelIssues.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <AlertTriangle className="text-amber-600" size={14} />
                <h5 className="font-bold text-slate-700 text-[11px] uppercase tracking-wide">Missing Expected Coverage</h5>
                <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                  {rosterLevelIssues.length} issue{rosterLevelIssues.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="space-y-2">
                {rosterLevelIssues.map((issue, i) => (
                  <div key={i} className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[10px] text-amber-900">
                    {issue.message}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step 1: Resident Floor Check */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5 space-y-3">
        <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Step 1 — {t('member', 'Resident')} Floor Check</h4>
        <p className="text-[10px] text-slate-400">Only on-floor {t('members', 'residents').toLowerCase()} are draggable into the grids below. Toggle who's currently on GOP floor vs. an outside rotation.</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {workforce.map(w => (
            <button
              key={w.id}
              onClick={() => toggleOnFloor(w)}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition cursor-pointer text-left ${
                w.on_floor ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'
              }`}
            >
              {w.full_name}
              <span className="block text-[9px] font-normal">{w.on_floor ? 'On Floor' : `Outside ${t('rotation', 'Rotation')}`}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2: Multi-Doc Ingestion */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5 space-y-4">
        <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Step 2 — Multi-Doc Ingestion</h4>
        <div className="flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5">
            <span className="font-bold text-slate-600">Month</span>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 cursor-pointer">
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="font-bold text-slate-600">Year</span>
            <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 w-20" />
          </label>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {INGESTION_TYPES.map(type => (
            <div key={type.id} className="border border-slate-200 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">{type.label}</span>
                {parseSourceByType[type.id] && (
                  <span className="text-[9px] font-bold text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
                    {parseSourceByType[type.id]}
                  </span>
                )}
              </div>
              <textarea
                rows={3}
                value={ingestText[type.id]}
                onChange={e => setIngestText(prev => ({ ...prev, [type.id]: e.target.value }))}
                placeholder={`Paste raw ${type.label} text here...`}
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-950"
              />
              <div className="flex items-center justify-between gap-2">
                <label className="inline-flex items-center space-x-1.5 px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-dashed border-slate-300 rounded-lg text-[10px] font-semibold text-slate-700 cursor-pointer transition">
                  <UploadCloud size={12} className="text-slate-400" />
                  <span>{ingestFile[type.id]?.name || 'Attach file (optional)'}</span>
                  <input type="file" className="hidden" onChange={e => setIngestFile(prev => ({ ...prev, [type.id]: e.target.files?.[0] || null }))} />
                </label>
                <button
                  onClick={() => handleIngest(type.id)}
                  disabled={parsingType === type.id || (!ingestText[type.id].trim() && !ingestFile[type.id])}
                  className="inline-flex items-center space-x-1 px-3 py-1.5 bg-slate-950 hover:bg-slate-900 disabled:bg-slate-400 text-white font-bold rounded-lg text-[10px] transition cursor-pointer shrink-0"
                >
                  <Sparkles size={11} />
                  <span>{parsingType === type.id ? 'Parsing...' : 'Parse'}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Step 3: HITL Visual Editor */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4 sm:p-5 space-y-4">
        <h4 className="font-bold text-slate-800 text-xs sm:text-sm">Step 3 — HITL Visual Editor</h4>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* On-floor resident chips — draggable on desktop; tappable on
              touch (select a chip, then tap a slot below to assign them,
              since native drag-and-drop doesn't fire on phones/tablets). */}
          <div className="lg:col-span-1 space-y-2">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Assign {t('members', 'Residents')}</span>
            <p className="text-[9px] text-slate-400 leading-relaxed">
              Drag a {t('member', 'resident').toLowerCase()} into a slot on desktop, or on a touch device tap a {t('member', 'resident').toLowerCase()} then tap a slot to assign them.
            </p>
            <div className="space-y-1.5 max-h-96 overflow-y-auto">
              {onFloorResidents.map(w => {
                const isSelected = selectedResidentId === w.id;
                return (
                  <button
                    type="button"
                    key={w.id}
                    draggable
                    onDragStart={e => handleDragStart(e, w.id)}
                    onClick={() => toggleSelectedResident(w.id)}
                    aria-pressed={isSelected}
                    className={`w-full flex items-center space-x-1.5 px-2.5 py-2 rounded-lg text-[10px] font-bold border cursor-grab active:cursor-grabbing transition ${
                      isSelected
                        ? 'bg-blue-600 border-blue-600 text-white ring-2 ring-blue-300'
                        : 'bg-blue-50 border-blue-200 text-blue-800'
                    }`}
                  >
                    <User size={11} />
                    <span className="truncate">{w.full_name}</span>
                    {isSelected && <span className="ml-auto text-[9px] font-semibold uppercase tracking-wider">Tap a slot</span>}
                  </button>
                );
              })}
              {onFloorResidents.length === 0 && <p className="text-[10px] text-slate-400">No on-floor {t('members', 'residents').toLowerCase()}.</p>}
            </div>
            {notOnFloorResidents.length > 0 && (
              <p className="text-[9px] text-slate-400">{notOnFloorResidents.length} {t('member', 'resident').toLowerCase()}(s) on outside rotation, not shown here.</p>
            )}
          </div>

          {/* Tabbed grids */}
          <div className="lg:col-span-3 space-y-3">
            <div className="flex gap-2 border-b border-slate-200 overflow-x-auto">
              {([
                ['gop', 'GOP Clinic Grid'],
                ['emergency', 'A&E Emergency'],
                ['supervision', 'Supervision'],
                ['satellite', 'Satellite'],
              ] as [GridTab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setGridTab(key)}
                  className={`pb-2 px-1 text-xs font-bold border-b-2 whitespace-nowrap cursor-pointer transition ${
                    gridTab === key ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {gridTab === 'gop' && (
              <div className="space-y-2">
                {gopGrid.slots.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">No slots yet — import a roster or add one manually.</p>}
                {gopGrid.slots.map((slot, i) => (
                  <div
                    key={i}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => dropOnGopSlot(e, i)}
                    onClick={() => tapAssignGopSlot(i)}
                    className={`border rounded-lg p-2.5 flex items-center justify-between gap-3 transition ${
                      selectedResidentId ? 'border-blue-300 bg-blue-50/60 cursor-pointer' : 'border-slate-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-slate-500">{slot.date_or_day} — {slot.clinic_type}</div>
                      <div className="text-xs text-slate-700 truncate">{t('senior_reviewers', 'Consultants')}: {slot.consultants.join(', ') || '—'}</div>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end min-w-[120px]">
                      {(slot.residents || []).map(rid => (
                        <span key={rid} className="inline-flex items-center gap-1 text-[9px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full pl-2 pr-1 py-0.5">
                          {residentName(rid)}
                          <button
                            type="button"
                            aria-label={`Remove ${residentName(rid)}`}
                            className="p-1 -m-0.5 hover:bg-emerald-200 rounded-full cursor-pointer"
                            onClick={e => { e.stopPropagation(); setGopGrid(prev => ({ ...prev, slots: prev.slots.map((s, si) => si === i ? { ...s, residents: (s.residents || []).filter(r => r !== rid) } : s) })); }}
                          >
                            <X size={9} />
                          </button>
                        </span>
                      ))}
                      {(!slot.residents || slot.residents.length === 0) && (
                        <span className="text-[9px] text-slate-300 italic">{selectedResidentId ? 'tap to assign' : `drag or tap a ${t('member', 'resident').toLowerCase()}, then tap here`}</span>
                      )}
                    </div>
                  </div>
                ))}
                {gopGrid.unparsed_notes.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[10px] text-amber-800 space-y-0.5">
                    <strong>Needs manual review:</strong>
                    {gopGrid.unparsed_notes.map((n, i) => <p key={i}>{n}</p>)}
                  </div>
                )}
                <button
                  onClick={() => setGopGrid(prev => ({ ...prev, slots: [...prev.slots, { date_or_day: '', clinic_type: 'Other', consultants: [], residents: [] }] }))}
                  className="inline-flex items-center space-x-1 text-[10px] font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
                >
                  <Plus size={11} /><span>Add Slot</span>
                </button>
              </div>
            )}

            {gridTab === 'emergency' && (
              <div className="space-y-2">
                {emergencyGrid.shifts.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">No shifts yet.</p>}
                {emergencyGrid.shifts.map((shift, i) => (
                  <div
                    key={i}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => dropOnEmergencyShift(e, i)}
                    onClick={() => tapAssignEmergencyShift(i)}
                    className={`border rounded-lg p-2.5 flex items-center justify-between gap-3 transition ${
                      selectedResidentId ? 'border-blue-300 bg-blue-50/60 cursor-pointer' : 'border-slate-200'
                    }`}
                  >
                    <div className="text-[10px] font-bold text-slate-500">{shift.date_or_day} — {shift.shift}</div>
                    <div className="flex flex-wrap gap-1 justify-end min-w-[120px]">
                      {shift.on_call.map(rid => (
                        <span key={rid} className="inline-flex items-center gap-1 text-[9px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full pl-2 pr-1 py-0.5">
                          {residentName(rid)}
                          <button
                            type="button"
                            aria-label={`Remove ${residentName(rid)}`}
                            className="p-1 -m-0.5 hover:bg-emerald-200 rounded-full cursor-pointer"
                            onClick={e => { e.stopPropagation(); setEmergencyGrid(prev => ({ ...prev, shifts: prev.shifts.map((s, si) => si === i ? { ...s, on_call: s.on_call.filter(r => r !== rid) } : s) })); }}
                          >
                            <X size={9} />
                          </button>
                        </span>
                      ))}
                      {shift.on_call.length === 0 && (
                        <span className="text-[9px] text-slate-300 italic">{selectedResidentId ? 'tap to assign' : `drag or tap a ${t('member', 'resident').toLowerCase()}, then tap here`}</span>
                      )}
                    </div>
                  </div>
                ))}
                {emergencyGrid.unparsed_notes.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[10px] text-amber-800 space-y-0.5">
                    <strong>Needs manual review:</strong>
                    {emergencyGrid.unparsed_notes.map((n, i) => <p key={i}>{n}</p>)}
                  </div>
                )}
              </div>
            )}

            {gridTab === 'supervision' && (
              <div className="space-y-2">
                {supervisionGrid.duties.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">No duties yet.</p>}
                {supervisionGrid.duties.map((duty, i) => (
                  <div key={i} className="border border-slate-200 rounded-lg p-2.5 space-y-1.5">
                    <div className="text-[10px] font-bold text-slate-500">{duty.date_or_day}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => dropOnSupervisionDuty(e, i, 'first_on_duty')}
                        onClick={() => tapAssignSupervisionDuty(i, 'first_on_duty')}
                        className={`border border-dashed rounded-lg p-2 text-xs transition ${
                          selectedResidentId ? 'border-blue-300 bg-blue-50/60 cursor-pointer' : 'border-slate-200'
                        }`}
                      >
                        <span className="text-[9px] text-slate-400 block">1st On Duty</span>
                        {duty.first_on_duty || <span className="text-slate-300 italic">{selectedResidentId ? 'tap to assign' : `drag or tap a ${t('member', 'resident').toLowerCase()}, then tap here`}</span>}
                      </div>
                      <div
                        onDragOver={e => e.preventDefault()}
                        onDrop={e => dropOnSupervisionDuty(e, i, 'second_on_duty')}
                        onClick={() => tapAssignSupervisionDuty(i, 'second_on_duty')}
                        className={`border border-dashed rounded-lg p-2 text-xs transition ${
                          selectedResidentId ? 'border-blue-300 bg-blue-50/60 cursor-pointer' : 'border-slate-200'
                        }`}
                      >
                        <span className="text-[9px] text-slate-400 block">2nd On Duty</span>
                        {duty.second_on_duty || <span className="text-slate-300 italic">{selectedResidentId ? 'tap to assign' : `drag or tap a ${t('member', 'resident').toLowerCase()}, then tap here`}</span>}
                      </div>
                    </div>
                  </div>
                ))}
                {supervisionGrid.unparsed_notes.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[10px] text-amber-800 space-y-0.5">
                    <strong>Needs manual review:</strong>
                    {supervisionGrid.unparsed_notes.map((n, i) => <p key={i}>{n}</p>)}
                  </div>
                )}
              </div>
            )}

            {gridTab === 'satellite' && (
              <div className="space-y-2">
                {satelliteGrid.postings.length === 0 && <p className="text-xs text-slate-400 py-4 text-center">No postings yet.</p>}
                {satelliteGrid.postings.map((posting, i) => (
                  <div
                    key={i}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => dropOnSatellitePosting(e, i)}
                    onClick={() => tapAssignSatellitePosting(i)}
                    className={`border rounded-lg p-2.5 flex items-center justify-between gap-3 transition ${
                      selectedResidentId ? 'border-blue-300 bg-blue-50/60 cursor-pointer' : 'border-slate-200'
                    }`}
                  >
                    <div className="text-[10px] font-bold text-slate-500">{posting.facility}{posting.date_or_day ? ` — ${posting.date_or_day}` : ''}</div>
                    <div className="flex flex-wrap gap-1 justify-end min-w-[120px]">
                      {posting.assigned.map(rid => (
                        <span key={rid} className="inline-flex items-center gap-1 text-[9px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-full pl-2 pr-1 py-0.5">
                          {residentName(rid)}
                          <button
                            type="button"
                            aria-label={`Remove ${residentName(rid)}`}
                            className="p-1 -m-0.5 hover:bg-emerald-200 rounded-full cursor-pointer"
                            onClick={e => { e.stopPropagation(); setSatelliteGrid(prev => ({ ...prev, postings: prev.postings.map((p, pi) => pi === i ? { ...p, assigned: p.assigned.filter(r => r !== rid) } : p) })); }}
                          >
                            <X size={9} />
                          </button>
                        </span>
                      ))}
                      {posting.assigned.length === 0 && (
                        <span className="text-[9px] text-slate-300 italic">{selectedResidentId ? 'tap to assign' : `drag or tap a ${t('member', 'resident').toLowerCase()}, then tap here`}</span>
                      )}
                    </div>
                  </div>
                ))}
                {satelliteGrid.unparsed_notes.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-[10px] text-amber-800 space-y-0.5">
                    <strong>Needs manual review:</strong>
                    {satelliteGrid.unparsed_notes.map((n, i) => <p key={i}>{n}</p>)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Step 4: Publish (buttons live in the header bar above) */}
      <p className="text-[10px] text-slate-400 text-center">
        Step 4 — Publishing saves this roster and posts a pinned #Roster announcement to the Announcement Board.
      </p>
    </div>
  );
};
