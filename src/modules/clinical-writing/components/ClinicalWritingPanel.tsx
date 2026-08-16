import React, { useEffect, useState } from 'react';
import {
  ClinicalDocument,
  ClinicalDocumentType,
  ContentBlockDefinition,
  ContentBlockKind,
  createDocument,
  createDocumentType,
  getDocumentTypes,
  getDocuments,
  updateDocument,
} from '../lib/clinicalWritingService';
import { FileText, Plus, Trash2, ArrowLeft, ArrowUp, ArrowDown, FileEdit } from 'lucide-react';

// Clinical & Professional Writing module (migration 48) — minimal,
// standalone UI over clinicalWritingService.ts. Backs
// docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md §7's module 4 ("Clinical &
// professional writing... case write-ups, clerking templates, SOPs,
// protocols, referral letters, any structured clinical document a doctor
// drafts") for the genuinely-missing piece —
// docs/CLINICAL_WRITING_MODULE_SCOPING.md's §3 keeps case write-ups
// (`clinical_case_reports`/`case_reports`) owned by Casebook & Logbook,
// untouched here.
//
// SCOPE — deliberately minimal, same "first slice, not the full eventual
// richness" framing as FormsBuilderPanel.tsx/MeetingsPanel.tsx: no
// rich-text editor, no AI integration, no e-signature, no version history
// — all explicitly deferred per the scoping doc's §6.2/§6.1.
//   1. Builder: list existing document types (global + this tenant's own),
//      create a new one (name, document_kind, description, an ordered
//      list of sections — label + guidance text + block_kind).
//   2. Drafting: pick a document type, fill in one input per
//      body_template section, set a title, save as draft/final, and
//      reopen a previously-drafted document for the active type.
//
// Wired into ChiefDashboardView.tsx's "Clinical Writing" tab.
//
// Visual style follows MeetingsPanel.tsx (card layout, field-row pattern
// for the ordered-list editor, master-detail navigation via back buttons).

interface ClinicalWritingPanelProps {
  tenantId: string;
  // A Chief has no workforce_id of their own (see CLAUDE.md's Role
  // Model) — null is the correct value for that case, same convention as
  // MeetingsPanel.tsx's createdByWorkforceId prop.
  createdByWorkforceId?: string | null;
}

interface DraftSection extends ContentBlockDefinition {
  _rowId: string;
}

let rowIdCounter = 0;
function nextRowId(): string {
  rowIdCounter += 1;
  return `section-row-${rowIdCounter}`;
}

function emptyDraftSection(): DraftSection {
  return { _rowId: nextRowId(), key: '', label: '', guidance_text: '', placeholder_text: '', block_kind: 'paragraph' };
}

function slugifyKey(label: string, fallbackIndex: number): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || `section_${fallbackIndex}`;
}

const BLOCK_KIND_OPTIONS: { value: ContentBlockKind; label: string }[] = [
  { value: 'heading', label: 'Heading (section label)' },
  { value: 'paragraph', label: 'Paragraph (multi-line text)' },
  { value: 'short_field', label: 'Short Field (single line)' },
];

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  final: 'Final',
  signed: 'Signed',
};

export const ClinicalWritingPanel: React.FC<ClinicalWritingPanelProps> = ({ tenantId, createdByWorkforceId = null }) => {
  // --- Document type list state (Builder) ---
  const [documentTypes, setDocumentTypes] = useState<ClinicalDocumentType[]>([]);
  const [isLoadingTypes, setIsLoadingTypes] = useState(true);
  const [typesLoadError, setTypesLoadError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');

  const [showCreateType, setShowCreateType] = useState(false);
  const [draftTypeName, setDraftTypeName] = useState('');
  const [draftDocumentKind, setDraftDocumentKind] = useState('');
  const [draftTypeDescription, setDraftTypeDescription] = useState('');
  const [draftSections, setDraftSections] = useState<DraftSection[]>([emptyDraftSection()]);
  const [isSavingType, setIsSavingType] = useState(false);

  // --- Selected type / documents list state (Drafting) ---
  const [selectedType, setSelectedType] = useState<ClinicalDocumentType | null>(null);
  const [documents, setDocuments] = useState<ClinicalDocument[]>([]);
  const [isLoadingDocuments, setIsLoadingDocuments] = useState(false);
  const [documentsLoadError, setDocumentsLoadError] = useState('');

  const [showDraftDocument, setShowDraftDocument] = useState(false);

  // --- Selected document detail state ---
  const [selectedDocument, setSelectedDocument] = useState<ClinicalDocument | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftContent, setDraftContent] = useState<Record<string, string>>({});
  const [isSavingDocument, setIsSavingDocument] = useState(false);

  const loadTypes = async () => {
    setIsLoadingTypes(true);
    setTypesLoadError('');
    try {
      const rows = await getDocumentTypes({ tenantId });
      setDocumentTypes(rows);
    } catch (err) {
      console.warn(err);
      setDocumentTypes([]);
      setTypesLoadError('Could not load document types. This is expected if migration 48 has not been applied to this database yet.');
    } finally {
      setIsLoadingTypes(false);
    }
  };

  useEffect(() => { loadTypes(); }, [tenantId]);

  const openCreateType = () => {
    setDraftTypeName('');
    setDraftDocumentKind('');
    setDraftTypeDescription('');
    setDraftSections([emptyDraftSection()]);
    setStatusMessage('');
    setShowCreateType(true);
  };

  const updateDraftSection = (rowId: string, patch: Partial<DraftSection>) => {
    setDraftSections(prev => prev.map(section => (section._rowId === rowId ? { ...section, ...patch } : section)));
  };

  const addDraftSection = () => setDraftSections(prev => [...prev, emptyDraftSection()]);

  const removeDraftSection = (rowId: string) => {
    setDraftSections(prev => (prev.length <= 1 ? prev : prev.filter(section => section._rowId !== rowId)));
  };

  const moveDraftSection = (rowId: string, direction: -1 | 1) => {
    setDraftSections(prev => {
      const index = prev.findIndex(section => section._rowId === rowId);
      const targetIndex = index + direction;
      if (index === -1 || targetIndex < 0 || targetIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleCreateType = async () => {
    if (!draftTypeName.trim()) {
      setStatusMessage('Document type name is required.');
      return;
    }
    if (!draftDocumentKind.trim()) {
      setStatusMessage('Document kind is required (e.g. referral_letter, sop_protocol).');
      return;
    }
    const cleanSections: ContentBlockDefinition[] = draftSections
      .filter(section => section.label.trim())
      .map((section, idx) => ({
        key: section.key.trim() || slugifyKey(section.label, idx),
        label: section.label.trim(),
        guidance_text: section.guidance_text?.trim() || null,
        placeholder_text: section.placeholder_text?.trim() || null,
        block_kind: section.block_kind,
      }));

    if (cleanSections.length === 0) {
      setStatusMessage('Add at least one section.');
      return;
    }

    setIsSavingType(true);
    try {
      await createDocumentType(
        tenantId,
        null,
        draftTypeName.trim(),
        draftDocumentKind.trim(),
        cleanSections,
        draftTypeDescription.trim() || null,
        createdByWorkforceId
      );
      setStatusMessage(`"${draftTypeName.trim()}" created.`);
      setShowCreateType(false);
      await loadTypes();
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to create document type.');
    } finally {
      setIsSavingType(false);
    }
  };

  const openType = async (type: ClinicalDocumentType) => {
    setSelectedType(type);
    setSelectedDocument(null);
    setShowDraftDocument(false);
    setDocumentsLoadError('');
    setIsLoadingDocuments(true);
    try {
      const rows = await getDocuments(type.id);
      setDocuments(rows);
    } catch (err) {
      console.warn(err);
      setDocuments([]);
      setDocumentsLoadError('Could not load documents for this type.');
    } finally {
      setIsLoadingDocuments(false);
    }
  };

  const backToTypesList = () => {
    setSelectedType(null);
    setDocuments([]);
    setSelectedDocument(null);
  };

  const openDraftNewDocument = () => {
    setDraftTitle('');
    const initialContent: Record<string, string> = {};
    (selectedType?.body_template ?? []).forEach(section => {
      initialContent[section.key] = '';
    });
    setDraftContent(initialContent);
    setShowDraftDocument(true);
  };

  const handleSaveNewDocument = async (status: 'draft' | 'final') => {
    if (!selectedType) return;
    if (!draftTitle.trim()) {
      setStatusMessage('Document title is required.');
      return;
    }
    setIsSavingDocument(true);
    try {
      const created = await createDocument(
        selectedType.id,
        draftTitle.trim(),
        draftContent,
        status,
        null,
        createdByWorkforceId
      );
      setShowDraftDocument(false);
      setDocuments(prev => [created, ...prev]);
      setStatusMessage(`"${draftTitle.trim()}" saved as ${STATUS_LABELS[status] ?? status}.`);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save document.');
    } finally {
      setIsSavingDocument(false);
    }
  };

  const openDocument = (doc: ClinicalDocument) => {
    setSelectedDocument(doc);
    setDraftTitle(doc.title);
    setDraftContent({ ...doc.content });
  };

  const backToDocumentsList = () => {
    setSelectedDocument(null);
  };

  const handleUpdateDocument = async (status: 'draft' | 'final') => {
    if (!selectedDocument) return;
    if (!draftTitle.trim()) {
      setStatusMessage('Document title is required.');
      return;
    }
    setIsSavingDocument(true);
    try {
      const updated = await updateDocument(selectedDocument.id, {
        title: draftTitle.trim(),
        content: draftContent,
        status,
      });
      setSelectedDocument(updated);
      setDocuments(prev => prev.map(d => (d.id === updated.id ? updated : d)));
      setStatusMessage(`Saved as ${STATUS_LABELS[status] ?? status}.`);
    } catch (err) {
      console.warn(err);
      setStatusMessage('Failed to save document.');
    } finally {
      setIsSavingDocument(false);
    }
  };

  const renderSectionInput = (section: ContentBlockDefinition, value: string, onChange: (val: string) => void) => {
    if (section.block_kind === 'short_field') {
      return (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={section.placeholder_text ?? ''}
          className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
        />
      );
    }
    return (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={section.placeholder_text ?? ''}
        className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
        rows={section.block_kind === 'heading' ? 2 : 4}
      />
    );
  };

  // --- Document detail (edit existing) view ---
  if (selectedType && selectedDocument) {
    return (
      <div className="space-y-6">
        <button
          onClick={backToDocumentsList}
          className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft size={14} /> Back to {selectedType.name}
        </button>

        {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}

        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-500">Title</label>
            <input
              type="text"
              value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          {(selectedType.body_template ?? []).map(section => (
            <div key={section.key}>
              <label className="text-xs font-bold text-slate-500">{section.label}</label>
              {section.guidance_text && <p className="text-[10px] text-slate-400 mt-0.5">{section.guidance_text}</p>}
              {renderSectionInput(section, draftContent[section.key] ?? '', val =>
                setDraftContent(prev => ({ ...prev, [section.key]: val }))
              )}
            </div>
          ))}

          <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-50 border border-slate-200 text-slate-600">
              {STATUS_LABELS[selectedDocument.status] ?? selectedDocument.status}
            </span>
            <div className="flex-1" />
            <button
              onClick={() => handleUpdateDocument('draft')}
              disabled={isSavingDocument}
              className="text-xs font-bold text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              Save as Draft
            </button>
            <button
              onClick={() => handleUpdateDocument('final')}
              disabled={isSavingDocument}
              className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              {isSavingDocument ? 'Saving...' : 'Save as Final'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Documents-for-type view (Drafting: list + new document form) ---
  if (selectedType) {
    return (
      <div className="space-y-6">
        <button
          onClick={backToTypesList}
          className="flex items-center gap-1 text-xs font-bold text-slate-600 hover:text-slate-900 cursor-pointer"
        >
          <ArrowLeft size={14} /> Back to Document Types
        </button>

        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><FileEdit size={20} /> {selectedType.name}</h2>
          {selectedType.description && <p className="text-sm text-slate-500 mt-1">{selectedType.description}</p>}
        </div>

        {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}
        {documentsLoadError && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">{documentsLoadError}</div>}

        <div className="bg-white rounded-2xl border border-slate-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-slate-800">Drafted Documents</h3>
            <button
              onClick={openDraftNewDocument}
              className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              <Plus size={14} /> New Document
            </button>
          </div>

          {isLoadingDocuments && <p className="text-xs text-slate-400">Loading...</p>}
          {!isLoadingDocuments && documents.length === 0 && !documentsLoadError && (
            <p className="text-xs text-slate-400">No documents drafted yet for this type.</p>
          )}
          <div className="space-y-2">
            {documents.map(doc => (
              <button
                key={doc.id}
                onClick={() => openDocument(doc)}
                className="w-full text-left flex items-center justify-between bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 cursor-pointer transition"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">{doc.title}</p>
                  <p className="text-[10px] text-slate-500">
                    Updated {new Date(doc.updated_at).toLocaleString()}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                  {STATUS_LABELS[doc.status] ?? doc.status}
                </span>
              </button>
            ))}
          </div>
        </div>

        {showDraftDocument && (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
            <h3 className="font-bold text-slate-800">New Document</h3>
            <div>
              <label className="text-xs font-bold text-slate-500">Title</label>
              <input
                type="text"
                value={draftTitle}
                onChange={e => setDraftTitle(e.target.value)}
                className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="e.g. Referral: J. Adewale, 14-Aug"
              />
            </div>

            {(selectedType.body_template ?? []).map(section => (
              <div key={section.key}>
                <label className="text-xs font-bold text-slate-500">{section.label}</label>
                {section.guidance_text && <p className="text-[10px] text-slate-400 mt-0.5">{section.guidance_text}</p>}
                {renderSectionInput(section, draftContent[section.key] ?? '', val =>
                  setDraftContent(prev => ({ ...prev, [section.key]: val }))
                )}
              </div>
            ))}

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleSaveNewDocument('draft')}
                disabled={isSavingDocument}
                className="text-xs font-bold text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                Save as Draft
              </button>
              <button
                onClick={() => handleSaveNewDocument('final')}
                disabled={isSavingDocument}
                className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50"
              >
                {isSavingDocument ? 'Saving...' : 'Save as Final'}
              </button>
              <button
                onClick={() => setShowDraftDocument(false)}
                className="text-xs font-bold text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- Document type list view (Builder, default) ---
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2"><FileText size={20} /> Clinical Writing</h2>
        <p className="text-sm text-slate-500 mt-1">
          Create reusable document types — a referral letter, an SOP/protocol, a clerking template — with
          named sections, then draft actual documents against them.
        </p>
      </div>

      {statusMessage && <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-sm">{statusMessage}</div>}
      {typesLoadError && <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-sm">{typesLoadError}</div>}

      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-slate-800">Document Types</h3>
          <button
            onClick={openCreateType}
            className="flex items-center gap-1 text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer"
          >
            <Plus size={14} /> Create Document Type
          </button>
        </div>

        {isLoadingTypes && <p className="text-xs text-slate-400">Loading...</p>}
        {!isLoadingTypes && documentTypes.length === 0 && !typesLoadError && (
          <p className="text-xs text-slate-400">No document types yet — create one to get started.</p>
        )}
        <div className="space-y-2">
          {documentTypes.map(type => (
            <button
              key={type.id}
              onClick={() => openType(type)}
              className="w-full text-left flex items-center justify-between bg-slate-50 hover:bg-slate-100 rounded-lg px-3 py-2 cursor-pointer transition"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{type.name}</p>
                <p className="text-[10px] text-slate-500">
                  {(type.body_template ?? []).length} section{(type.body_template ?? []).length === 1 ? '' : 's'}
                  {' • '}{type.document_kind}
                  {type.is_system_default ? ' • Built-in' : ''}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {showCreateType && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-4">
          <h3 className="font-bold text-slate-800">Create Document Type</h3>

          <div>
            <label className="text-xs font-bold text-slate-500">Name</label>
            <input
              type="text"
              value={draftTypeName}
              onChange={e => setDraftTypeName(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. SOP: Wound Dressing Change"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500">Document Kind</label>
            <input
              type="text"
              value={draftDocumentKind}
              onChange={e => setDraftDocumentKind(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              placeholder="e.g. sop_protocol"
            />
          </div>

          <div>
            <label className="text-xs font-bold text-slate-500">Description (optional)</label>
            <textarea
              value={draftTypeDescription}
              onChange={e => setDraftTypeDescription(e.target.value)}
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-500">Sections</label>
            {draftSections.map((section, idx) => (
              <div key={section._rowId} className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={section.label}
                    onChange={e => updateDraftSection(section._rowId, { label: e.target.value })}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                    placeholder="Section label, e.g. Reason for Referral"
                  />
                  <select
                    value={section.block_kind}
                    onChange={e => updateDraftSection(section._rowId, { block_kind: e.target.value as ContentBlockKind })}
                    className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                  >
                    {BLOCK_KIND_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => moveDraftSection(section._rowId, -1)}
                    disabled={idx === 0}
                    className="shrink-0 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer p-1"
                    title="Move up"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    onClick={() => moveDraftSection(section._rowId, 1)}
                    disabled={idx === draftSections.length - 1}
                    className="shrink-0 text-slate-500 hover:text-slate-800 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer p-1"
                    title="Move down"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    onClick={() => removeDraftSection(section._rowId)}
                    disabled={draftSections.length <= 1}
                    className="shrink-0 text-rose-600 hover:text-rose-700 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer p-1"
                    title="Remove section"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <input
                  type="text"
                  value={section.guidance_text ?? ''}
                  onChange={e => updateDraftSection(section._rowId, { guidance_text: e.target.value })}
                  className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                  placeholder="Guidance text shown to whoever fills this section in (optional)"
                />
              </div>
            ))}
            <button
              onClick={addDraftSection}
              className="flex items-center gap-1 text-xs font-bold text-slate-700 border border-slate-200 hover:bg-slate-50 px-2 py-1 rounded-lg cursor-pointer"
            >
              <Plus size={12} /> Add Section
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCreateType}
              disabled={isSavingType}
              className="text-xs font-bold bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-800 cursor-pointer disabled:opacity-50"
            >
              {isSavingType ? 'Saving...' : 'Create Document Type'}
            </button>
            <button
              onClick={() => setShowCreateType(false)}
              className="text-xs font-bold text-slate-600 border border-slate-200 px-3 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
