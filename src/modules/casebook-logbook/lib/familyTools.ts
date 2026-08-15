import {
  GenogramData,
  GenogramNode,
  GenogramRelationship,
  FamilyApgarInput,
  FamilyApgarResult,
  FamilyApgarInterpretation,
  EcomapData,
  EcomapConnection,
  FamilyCircleData,
  FamilyCircleMember,
  DuvallStage,
  DuvallStageNumber,
} from '../../../types';

// Family Medicine biopsychosocial tools used by the Clinical Case Report
// editor's "Family Tools Canvas" tab (CasebookWorkspaceView.tsx). Pure,
// dependency-free helpers — no rendering, no persistence; the caller stores
// the returned data shapes directly into clinical_case_reports.genogram_data
// / family_tools_data (migration 15).

// --- GENOGRAM (3-generation family tree) ---

function nextGenogramNodeId(): string {
  return `gn_${crypto.randomUUID()}`;
}

// Seeds a minimal 3-generation skeleton (2x grandparents pairs, 2x parents,
// 1x index patient) with placeholder labels the resident overwrites. Callers
// should treat the returned node ids as stable keys for further edits.
export function createGenogramTemplate(indexPatientLabel: string): GenogramData {
  const paternalGrandfather: GenogramNode = { id: nextGenogramNodeId(), label: 'Paternal Grandfather', generation: 1, sex: 'M', diseases: [] };
  const paternalGrandmother: GenogramNode = { id: nextGenogramNodeId(), label: 'Paternal Grandmother', generation: 1, sex: 'F', diseases: [] };
  const maternalGrandfather: GenogramNode = { id: nextGenogramNodeId(), label: 'Maternal Grandfather', generation: 1, sex: 'M', diseases: [] };
  const maternalGrandmother: GenogramNode = { id: nextGenogramNodeId(), label: 'Maternal Grandmother', generation: 1, sex: 'F', diseases: [] };
  const father: GenogramNode = { id: nextGenogramNodeId(), label: 'Father', generation: 2, sex: 'M', diseases: [] };
  const mother: GenogramNode = { id: nextGenogramNodeId(), label: 'Mother', generation: 2, sex: 'F', diseases: [] };
  const indexPatient: GenogramNode = { id: nextGenogramNodeId(), label: indexPatientLabel, generation: 3, sex: 'unknown', diseases: [], isIndexPatient: true };

  const nodes = [paternalGrandfather, paternalGrandmother, maternalGrandfather, maternalGrandmother, father, mother, indexPatient];
  const relationships: GenogramRelationship[] = [
    { from: paternalGrandfather.id, to: paternalGrandmother.id, type: 'marriage' },
    { from: maternalGrandfather.id, to: maternalGrandmother.id, type: 'marriage' },
    { from: paternalGrandfather.id, to: father.id, type: 'parent_child' },
    { from: paternalGrandmother.id, to: father.id, type: 'parent_child' },
    { from: maternalGrandfather.id, to: mother.id, type: 'parent_child' },
    { from: maternalGrandmother.id, to: mother.id, type: 'parent_child' },
    { from: father.id, to: mother.id, type: 'marriage' },
    { from: father.id, to: indexPatient.id, type: 'parent_child' },
    { from: mother.id, to: indexPatient.id, type: 'parent_child' },
  ];

  return { nodes, relationships, disease_keys: [] };
}

export function addGenogramNode(data: GenogramData, node: Omit<GenogramNode, 'id'>): GenogramData {
  const newNode: GenogramNode = { ...node, id: nextGenogramNodeId() };
  return recomputeDiseaseKeys({ ...data, nodes: [...data.nodes, newNode] });
}

export function updateGenogramNode(data: GenogramData, nodeId: string, updates: Partial<Omit<GenogramNode, 'id'>>): GenogramData {
  return recomputeDiseaseKeys({
    ...data,
    nodes: data.nodes.map(n => (n.id === nodeId ? { ...n, ...updates } : n)),
  });
}

export function addGenogramRelationship(data: GenogramData, relationship: GenogramRelationship): GenogramData {
  return { ...data, relationships: [...data.relationships, relationship] };
}

// Recomputes the disease legend from whatever's currently on the nodes —
// called after any node edit so disease_keys never drifts out of sync.
function recomputeDiseaseKeys(data: GenogramData): GenogramData {
  const keys = new Set<string>();
  for (const node of data.nodes) {
    for (const d of node.diseases) keys.add(d);
  }
  return { ...data, disease_keys: Array.from(keys).sort() };
}

// --- FAMILY APGAR (Smilkstein) ---
// Each of the 5 items is scored 0 (hardly ever) / 1 (some of the time) /
// 2 (almost always), for a 0-10 total. Bands: 0-3 severely dysfunctional,
// 4-6 moderately dysfunctional, 7-10 highly functional.

export function calculateFamilyApgar(input: FamilyApgarInput): FamilyApgarResult {
  const clamp = (n: number) => Math.max(0, Math.min(2, Math.round(n)));
  const adaptability = clamp(input.adaptability);
  const partnership = clamp(input.partnership);
  const growth = clamp(input.growth);
  const affection = clamp(input.affection);
  const resolve = clamp(input.resolve);
  const total = adaptability + partnership + growth + affection + resolve;

  let interpretation: FamilyApgarInterpretation;
  if (total <= 3) interpretation = 'severely_dysfunctional';
  else if (total <= 6) interpretation = 'moderately_dysfunctional';
  else interpretation = 'highly_functional';

  return { adaptability, partnership, growth, affection, resolve, total, interpretation };
}

export const FAMILY_APGAR_INTERPRETATION_LABELS: Record<FamilyApgarInterpretation, string> = {
  severely_dysfunctional: 'Severely Dysfunctional (0-3)',
  moderately_dysfunctional: 'Moderately Dysfunctional (4-6)',
  highly_functional: 'Highly Functional (7-10)',
};

// --- ECOMAP (social support systems, stressors, community ties) ---

export function createEcomap(center: string): EcomapData {
  return { center, connections: [] };
}

export function addEcomapConnection(data: EcomapData, connection: EcomapConnection): EcomapData {
  return { ...data, connections: [...data.connections, connection] };
}

export function removeEcomapConnection(data: EcomapData, index: number): EcomapData {
  return { ...data, connections: data.connections.filter((_, i) => i !== index) };
}

// --- FAMILY CIRCLE ---

export function createFamilyCircle(): FamilyCircleData {
  return { members: [] };
}

export function addFamilyCircleMember(data: FamilyCircleData, member: FamilyCircleMember): FamilyCircleData {
  return { ...data, members: [...data.members, member] };
}

export function removeFamilyCircleMember(data: FamilyCircleData, index: number): FamilyCircleData {
  return { ...data, members: data.members.filter((_, i) => i !== index) };
}

// --- DUVALL'S / STEVENSON'S FAMILY LIFE CYCLE STAGES ---

export const DUVALL_STAGES: DuvallStage[] = [
  { stage: 1, label: 'Married Couple', description: 'Newly married, without children.' },
  { stage: 2, label: 'Childbearing Family', description: 'Oldest child born to 30 months.' },
  { stage: 3, label: 'Family with Preschool Children', description: 'Oldest child 2.5 to 6 years.' },
  { stage: 4, label: 'Family with School-Age Children', description: 'Oldest child 6 to 13 years.' },
  { stage: 5, label: 'Family with Teenagers', description: 'Oldest child 13 to 20 years.' },
  { stage: 6, label: 'Launching Center Family', description: 'First child gone to last child leaving home.' },
  { stage: 7, label: 'Middle-Aged Parents', description: 'Empty nest to retirement.' },
  { stage: 8, label: 'Family in Retirement / Old Age', description: 'Retirement to death of both spouses.' },
];

export function getDuvallStage(stage: DuvallStageNumber): DuvallStage {
  return DUVALL_STAGES[stage - 1];
}
