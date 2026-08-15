import React, { useState, useEffect } from 'react';
import { databaseService } from '../../../../lib/databaseService';
import {
  parseConsultantGop,
  parseCombinedGop,
  parseEmergencyRoster,
  parseSupervisionRoster,
  parseSatelliteRoster,
} from '../../../roster-engine/lib/uchRosterParser';
import {
  WorkforceMember,
  Collection,
  CombinedMasterRoster,
  GopClinicGrid,
  EmergencyCallGrid,
  SupervisionGrid,
  SatelliteGrid,
  RosterTypeId,
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
} from 'lucide-react';
import { useTerminology } from '../../../shared/terminology';

const EMPTY_GOP: GopClinicGrid = { slots: [], unparsed_notes: [] };
const EMPTY_EMERGENCY: EmergencyCallGrid = { shifts: [], unparsed_notes: [] };
const EMPTY_SUPERVISION: SupervisionGrid = { duties: [], unparsed_notes: [] };
const EMPTY_SATELLITE: SatelliteGrid = { postings: [], unparsed_notes: [] };

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type GridTab = 'gop' | 'emergency' | 'supervision' | 'satellite';

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
}

export const MultiRosterManagerView: React.FC<MultiRosterManagerViewProps> = ({ tenantId }) => {
  const { t } = useTerminology();
  const INGESTION_TYPES = getIngestionTypes(t);
  const [isLoading, setIsLoading] = useState(true);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [workforce, setWorkforce] = useState<WorkforceMember[]>([]);
  const [masterRoster, setMasterRoster] = useState<CombinedMasterRoster | null>(null);

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

  const load = async () => {
    setIsLoading(true);
    try {
      const [wf, settings, collections] = await Promise.all([
        databaseService.getWorkforce(tenantId),
        databaseService.getSettings(tenantId),
        databaseService.getCollections(tenantId),
      ]);
      setWorkforce(wf.filter(w => w.active));
      const activeColl = collections.find(c => c.id === settings.current_collection_id) || null;
      setCollection(activeColl);

      if (activeColl) {
        const mr = await databaseService.getOrCreateMasterRoster(activeColl.id, month, year);
        setMasterRoster(mr);
        setGopGrid(mr.gop_clinic_grid?.slots ? mr.gop_clinic_grid : EMPTY_GOP);
        setEmergencyGrid(mr.emergency_call_grid?.shifts ? mr.emergency_call_grid : EMPTY_EMERGENCY);
        setSupervisionGrid(mr.supervision_grid?.duties ? mr.supervision_grid : EMPTY_SUPERVISION);
        setSatelliteGrid(mr.satellite_grid?.postings ? mr.satellite_grid : EMPTY_SATELLITE);
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

      if (rosterType === 'consultant_gop') { setGopGrid(parsedResult.data as GopClinicGrid); setGridTab('gop'); }
      if (rosterType === 'combined_gop') { setGopGrid(parsedResult.data as GopClinicGrid); setGridTab('gop'); }
      if (rosterType === 'accident_emergency') { setEmergencyGrid(parsedResult.data as EmergencyCallGrid); setGridTab('emergency'); }
      if (rosterType === 'afternoon_supervision') { setSupervisionGrid(parsedResult.data as SupervisionGrid); setGridTab('supervision'); }
      if (rosterType === 'satellite_outreach') { setSatelliteGrid(parsedResult.data as SatelliteGrid); setGridTab('satellite'); }

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

  const saveDraft = async () => {
    if (!masterRoster) return;
    setIsSaving(true);
    try {
      const updated = await databaseService.updateMasterRoster(masterRoster.id, {
        gop_clinic_grid: gopGrid,
        emergency_call_grid: emergencyGrid,
        supervision_grid: supervisionGrid,
        satellite_grid: satelliteGrid,
        status: masterRoster.status === 'published' ? 'published' : 'chief_review',
      });
      setMasterRoster(updated);
      setStatusMessage('Draft saved.');
      setTimeout(() => setStatusMessage(''), 3000);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save draft.');
    } finally {
      setIsSaving(false);
    }
  };

  const publish = async () => {
    if (!masterRoster || !collection) return;
    setIsSaving(true);
    try {
      const updated = await databaseService.updateMasterRoster(masterRoster.id, {
        gop_clinic_grid: gopGrid,
        emergency_call_grid: emergencyGrid,
        supervision_grid: supervisionGrid,
        satellite_grid: satelliteGrid,
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
      setTimeout(() => setStatusMessage(''), 4000);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to publish roster.');
    } finally {
      setIsSaving(false);
    }
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
            <span>Publish</span>
          </button>
        </div>
      </div>

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
                      {/* TODO(terminology): "Consultants" is a plural of the
                          `senior_reviewer` concept, which has no plural key
                          in TERMINOLOGY_DEFAULTS (src/modules/shared/terminology.tsx)
                          and no established plural-form precedent elsewhere
                          in the codebase (unlike member/members). Left
                          hardcoded rather than inventing a new terminology
                          key/schema field — see
                          docs/LIVING_SYSTEM_GAP_AUDIT.md's terminology audit. */}
                      <div className="text-xs text-slate-700 truncate">Consultants: {slot.consultants.join(', ') || '—'}</div>
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
