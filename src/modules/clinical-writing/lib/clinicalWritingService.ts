import { supabase } from '../../../lib/databaseService';
import { emitEvent } from '../../shared/lib/eventBus';

// Clinical & Professional Writing module (migration 48) — a NEW, additive
// data-access slice for the generic clinical_document_types/
// clinical_documents tables, per docs/PRIVYDOC_WORKSPACE_LIVING_SYSTEM.md
// §7 (module 4, "Clinical & professional writing") and
// docs/CLINICAL_WRITING_MODULE_SCOPING.md's recommended first slice (§6).
// This covers ONLY the genuinely-missing document types — referral
// letters, SOPs/protocols, and clerking templates. `clinical_case_reports`/
// `case_reports` (the two existing case-write-up systems) are untouched
// and out of scope here — see the scoping doc's §3 for the full reasoning.
//
// Kept as its own module slice rather than added to
// src/lib/databaseService.ts, same "additive, sits alongside" precedent as
// meetingsService.ts/schedulingService.ts and every module under
// src/modules/ since the Living-System initiative (migrations 32-40) — see
// CLAUDE.md.
//
// SCOPE: schema + service + a standalone panel only (see
// ClinicalWritingPanel.tsx). NOT wired into App.tsx routing beyond the
// ChiefDashboardView.tsx tab this pass adds.
//
// OWNERSHIP: clinical_document_types follows the same three-way ownership
// shape as form_instances (migration 42) — tenant-owned / doctor-owned
// (schema column only) / global default (tenant_id IS NULL AND doctor_id
// IS NULL). Migration 48 deliberately does NOT build a real
// `auth.uid() = doctor_id` RLS boundary in this pass (flagged in that
// migration's own header) — every row is equally readable/writable by any
// anon-key holder today, same as nearly every other table in this schema.
// `listDocumentTypes` below mirrors `listMeetingSeries`'s
// (src/modules/meetings/lib/meetingsService.ts) global-OR-tenant-OR-doctor
// filter shape for consistency with that existing multi-owner-shape
// precedent.

function checkSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured yet. Please provide VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your environment variables.');
  }
}

export type ContentBlockKind = 'heading' | 'paragraph' | 'short_field';

export interface ContentBlockDefinition {
  key: string;
  label: string;
  guidance_text?: string | null;
  placeholder_text?: string | null;
  block_kind: ContentBlockKind;
}

// Mirrors clinical_document_types (migration 48). tenant_id/doctor_id: at
// most one is set — a both-NULL row is a global seed default (e.g.
// "Referral Letter"), same three-way shape as form_instances/meeting_series
// (migration 42's header has the full rationale).
export interface ClinicalDocumentType {
  id: string;
  tenant_id: string | null;
  doctor_id: string | null;
  name: string;
  document_kind: string;
  description: string | null;
  body_template: ContentBlockDefinition[];
  is_system_default: boolean;
  created_by_workforce_id: string | null;
  created_at: string;
}

export type ClinicalDocumentStatus = 'draft' | 'final' | 'signed' | string;

// Mirrors clinical_documents (migration 48). tenant_id/doctor_id are
// denormalized from the parent clinical_document_types row for cheap
// filtering — same precedent as form_entries.tenant_id relative to
// form_instances.
export interface ClinicalDocument {
  id: string;
  document_type_id: string;
  tenant_id: string | null;
  doctor_id: string | null;
  title: string;
  content: Record<string, string>;
  status: ClinicalDocumentStatus;
  subject_ref: string | null;
  created_by_workforce_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentTypeScope {
  tenantId?: string | null;
  doctorId?: string | null;
}

// Lists document types visible to the given scope: always includes global
// seed types (tenant_id IS NULL AND doctor_id IS NULL — e.g. "Referral
// Letter"), plus the tenant's own types (if tenantId given) and/or the
// doctor's own types (if doctorId given). Same shape as listMeetingSeries.
export async function getDocumentTypes(scope: DocumentTypeScope | string = {}): Promise<ClinicalDocumentType[]> {
  checkSupabase();
  const { tenantId, doctorId } = typeof scope === 'string' ? { tenantId: scope, doctorId: undefined } : scope;

  const clauses = ['and(tenant_id.is.null,doctor_id.is.null)'];
  if (tenantId) clauses.push(`tenant_id.eq.${tenantId}`);
  if (doctorId) clauses.push(`doctor_id.eq.${doctorId}`);

  const { data, error } = await supabase!
    .from('clinical_document_types')
    .select('*')
    .or(clauses.join(','))
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('Error fetching clinical document types:', error);
    throw error;
  }
  return data || [];
}

// Creates a new document type (the "builder" action). Exactly one of
// tenantId/doctorId should be passed for an org-owned or doctor-owned
// type; pass both null only to author a new global default (not expected
// from ordinary UI callers — ClinicalWritingPanel.tsx never does this).
export async function createDocumentType(
  tenantId: string | null,
  doctorId: string | null,
  name: string,
  documentKind: string,
  bodyTemplate: ContentBlockDefinition[],
  description: string | null = null,
  createdByWorkforceId: string | null = null
): Promise<ClinicalDocumentType> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('clinical_document_types')
    .insert({
      tenant_id: tenantId,
      doctor_id: doctorId,
      name,
      document_kind: documentKind,
      description,
      body_template: bodyTemplate,
      created_by_workforce_id: createdByWorkforceId,
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating clinical document type:', error);
    throw error;
  }
  emitEvent(supabase!, {
    tenantId,
    eventType: 'instance.created',
    payload: { instance_type: 'clinical_document_type', instance_id: data.id, name },
    source: 'createDocumentType',
  }).catch((err) => console.warn('Failed to emit instance.created:', err));
  return data;
}

// Lists drafted documents for a given type, most recently updated first.
export async function getDocuments(documentTypeId: string): Promise<ClinicalDocument[]> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('clinical_documents')
    .select('*')
    .eq('document_type_id', documentTypeId)
    .order('updated_at', { ascending: false });

  if (error) {
    console.warn('Error fetching clinical documents:', error);
    throw error;
  }
  return data || [];
}

// Drafts a new document against a type, denormalizing tenant_id/doctor_id
// from the parent type — same precedent scheduleMeeting() uses when
// denormalizing from meeting_series.
export async function createDocument(
  documentTypeId: string,
  title: string,
  content: Record<string, string>,
  status: ClinicalDocumentStatus = 'draft',
  subjectRef: string | null = null,
  createdByWorkforceId: string | null = null
): Promise<ClinicalDocument> {
  checkSupabase();

  const { data: docType, error: typeError } = await supabase!
    .from('clinical_document_types')
    .select('tenant_id, doctor_id')
    .eq('id', documentTypeId)
    .single();

  if (typeError) {
    console.warn('Error fetching clinical document type for drafting:', typeError);
    throw typeError;
  }

  const { data, error } = await supabase!
    .from('clinical_documents')
    .insert({
      document_type_id: documentTypeId,
      tenant_id: docType?.tenant_id ?? null,
      doctor_id: docType?.doctor_id ?? null,
      title,
      content,
      status,
      subject_ref: subjectRef,
      created_by_workforce_id: createdByWorkforceId,
    })
    .select()
    .single();

  if (error) {
    console.warn('Error creating clinical document:', error);
    throw error;
  }
  emitEvent(supabase!, {
    tenantId: docType?.tenant_id ?? null,
    eventType: 'entry.submitted',
    payload: { document_id: data.id, document_type_id: documentTypeId, status },
    source: 'createDocument',
  }).catch((err) => console.warn('Failed to emit entry.submitted:', err));
  return data;
}

// Updates a drafted document's title/content/status (e.g. saving edits, or
// marking draft -> final).
export async function updateDocument(
  id: string,
  patch: Partial<Pick<ClinicalDocument, 'title' | 'content' | 'status' | 'subject_ref'>>
): Promise<ClinicalDocument> {
  checkSupabase();

  const { data, error } = await supabase!
    .from('clinical_documents')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.warn('Error updating clinical document:', error);
    throw error;
  }
  return data;
}
