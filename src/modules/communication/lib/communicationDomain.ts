export const NOTIFICATION_PURPOSES = [
  'ROSTER',
  'ANNOUNCEMENTS',
  'MEETINGS',
  'REVIEW_INVITATIONS',
  'KNOWLEDGE_PUBLICATIONS',
  'PRODUCT_RELEASES',
  'SUPPORT_REPLIES',
] as const;

export type NotificationPurpose = typeof NOTIFICATION_PURPOSES[number];

export const NOTIFICATION_CHANNELS = ['IN_APP', 'WHATSAPP', 'EMAIL'] as const;
export type NotificationChannel = typeof NOTIFICATION_CHANNELS[number];

export const TENANT_CAPABILITIES = [
  'ANNOUNCEMENTS_MANAGE',
  'MEETINGS_MANAGE',
  'ROSTER_COORDINATE',
  'KNOWLEDGE_PUBLISH',
  'REVIEW_COORDINATE',
  'MEMBER_SUPPORT',
] as const;

export type TenantCapability = typeof TENANT_CAPABILITIES[number];
export type ContactChannel = 'WHATSAPP' | 'EMAIL';
export type ContactVerificationState = 'UNVERIFIED' | 'PENDING_VERIFICATION' | 'VERIFIED';
export type ConversationKind = 'SUPPORT' | 'COORDINATION' | 'REVIEW';
export type ConversationStatus = 'OPEN' | 'CLOSED';
export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'COMPLETED';
export type ReviewArtifactType = 'DISSERTATION_MILESTONE' | 'RESEARCH_WORKSPACE';
export type SupportCategory =
  | 'TECHNICAL_PROBLEM'
  | 'ROSTER_ASSIGNMENT'
  | 'ACCOUNT_ACCESS'
  | 'FEATURE_FEEDBACK'
  | 'KNOWLEDGE_RESEARCH'
  | 'OTHER';

export interface CommunicationActor {
  kind: 'WORKFORCE' | 'DOCTOR';
  id: string;
  name: string;
  tenantId: string | null;
  accessCode: string | null;
}

export interface CommunicationContactPoint {
  id: string;
  channel: ContactChannel;
  masked_value: string;
  verification_state: ContactVerificationState;
  verified_at: string | null;
  updated_at: string;
}

export interface CommunicationPreference {
  purpose: NotificationPurpose;
  channel: NotificationChannel;
  enabled: boolean;
  updated_at?: string;
}

export interface CapabilityDelegation {
  id: string;
  workforce_id: string;
  workforce_name: string;
  capability: TenantCapability;
  status: 'ACTIVE' | 'REVOKED';
  granted_at: string;
  revoked_at: string | null;
  grantor_authority: 'TENANT_ADMIN_CODE' | 'AUTHENTICATED_TENANT_ADMIN';
}

export interface CommunicationMessage {
  id: string;
  sender_name: string;
  sender_kind: 'WORKFORCE' | 'DOCTOR' | 'SYSTEM';
  body: string;
  safe_route: string | null;
  created_at: string;
}

export interface CommunicationConversation {
  id: string;
  kind: ConversationKind;
  subject: string;
  status: ConversationStatus;
  unread_count: number;
  created_at: string;
  updated_at: string;
  messages: CommunicationMessage[];
}

export interface ReviewInvitation {
  id: string;
  conversation_id: string;
  artifact_type: ReviewArtifactType;
  artifact_id: string;
  safe_label: string;
  safe_route: string;
  permission_state: 'AVAILABLE' | 'PENDING_OWNER_PERMISSION';
  inviter_name: string;
  invitee_name: string;
  viewer_role: 'INVITER' | 'INVITEE';
  status: InvitationStatus;
  due_date: string | null;
  accepted_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewableArtifact {
  artifact_type: ReviewArtifactType;
  artifact_id: string;
  safe_label: string;
  safe_route: string;
  permission_state: 'AVAILABLE' | 'PENDING_OWNER_PERMISSION';
}

export interface EligibleMember {
  workforce_id: string;
  full_name: string;
  category: string;
}

export interface DeliveryStatusSummary {
  channel: NotificationChannel;
  outcome: 'PENDING' | 'SENT' | 'ACCEPTED' | 'DELIVERED' | 'FAILED' | 'UNKNOWN';
  failure_classification: string | null;
  updated_at: string;
}

export interface PrivyDocLinkage {
  state: 'NOT_LINKED' | 'ELIGIBLE' | 'PENDING' | 'LINKED';
  evidence_reference: string | null;
}

export interface CommunicationHubSnapshot {
  actor: { kind: 'WORKFORCE' | 'DOCTOR'; id: string; name: string; tenant_id: string | null };
  contacts: CommunicationContactPoint[];
  preferences: CommunicationPreference[];
  capabilities: TenantCapability[];
  conversations: CommunicationConversation[];
  invitations: ReviewInvitation[];
  reviewable_artifacts: ReviewableArtifact[];
  eligible_members: EligibleMember[];
  deliveries: DeliveryStatusSummary[];
  privydoc_linkage: PrivyDocLinkage;
  external_delivery: { whatsapp: 'DISABLED' | 'GATEWAY_CONTROLLED'; email: 'DISABLED' | 'GATEWAY_CONTROLLED' };
}

export interface GatewayProviderStatus {
  gateway: 'AVAILABLE' | 'DISABLED';
  email: 'AVAILABLE' | 'DISABLED';
  whatsapp: 'AVAILABLE' | 'DISABLED';
  flutterwave: 'AVAILABLE' | 'DISABLED';
}

export const PURPOSE_LABELS: Record<NotificationPurpose, string> = {
  ROSTER: 'Roster publication & material changes',
  ANNOUNCEMENTS: 'Announcements',
  MEETINGS: 'Meetings',
  REVIEW_INVITATIONS: 'Invitations to review',
  KNOWLEDGE_PUBLICATIONS: 'Knowledge publications',
  PRODUCT_RELEASES: 'Product-feature releases',
  SUPPORT_REPLIES: 'Support & feedback replies',
};

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  TECHNICAL_PROBLEM: 'Technical problem',
  ROSTER_ASSIGNMENT: 'Roster / assignment issue',
  ACCOUNT_ACCESS: 'Account / access',
  FEATURE_FEEDBACK: 'Feature feedback',
  KNOWLEDGE_RESEARCH: 'Knowledge / research support',
  OTHER: 'Other',
};

export const CAPABILITY_BADGES: Record<TenantCapability, { label: string; description: string }> = {
  ANNOUNCEMENTS_MANAGE: { label: 'Announcements Manager', description: 'Tenant-scoped authority to manage announcements.' },
  MEETINGS_MANAGE: { label: 'Meetings Manager', description: 'Tenant-scoped authority to manage meetings.' },
  ROSTER_COORDINATE: { label: 'Roster Coordinator', description: 'Tenant-scoped authority to coordinate roster work.' },
  KNOWLEDGE_PUBLISH: { label: 'Knowledge Publisher', description: 'Tenant-scoped authority to publish knowledge resources.' },
  REVIEW_COORDINATE: { label: 'Review Coordinator', description: 'Tenant-scoped authority to coordinate review work.' },
  MEMBER_SUPPORT: { label: 'Member Support', description: 'Tenant-scoped authority to respond to member support conversations.' },
};

export function normalizeWhatsAppNumber(value: string): string {
  let normalized = value.trim().replace(/[\s().-]/g, '');
  if (normalized.startsWith('00')) normalized = `+${normalized.slice(2)}`;
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error('Enter a WhatsApp number in international E.164 format, including the country code.');
  }
  return normalized;
}

export function normalizeEmailAddress(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error('Enter a valid email address.');
  }
  return normalized;
}

export function maskContactValue(channel: ContactChannel, value: string): string {
  if (channel === 'EMAIL') {
    const [local, domain] = value.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }
  return `${value.slice(0, 4)}••••${value.slice(-3)}`;
}

export function buildPreferenceMatrix(preferences: CommunicationPreference[]): Record<string, boolean> {
  const matrix: Record<string, boolean> = {};
  for (const purpose of NOTIFICATION_PURPOSES) {
    for (const channel of NOTIFICATION_CHANNELS) matrix[`${purpose}:${channel}`] = false;
  }
  for (const preference of preferences) matrix[`${preference.purpose}:${preference.channel}`] = preference.enabled;
  return matrix;
}

export function isSafeInternalRoute(route: string): boolean {
  return /^\/(workspace|doctor)\/[a-z0-9][a-z0-9/_?=&-]*$/i.test(route) && !route.includes('://');
}

export function isSafeOverviewLabel(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 120) return false;
  if (/https?:\/\//i.test(trimmed) || /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i.test(trimmed)) return false;
  if (/\b(?:\+?\d[\s().-]*){8,}\b/.test(trimmed)) return false;
  if (/\b(?:otp|token|secret|service[_ -]?role|password)\b\s*[:=]/i.test(trimmed)) return false;
  return true;
}

export function redactForSafeLog(value: string): string {
  return value
    .replace(/\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/\b(?:\+?\d[\s().-]*){8,}\b/g, '[REDACTED_PHONE]')
    .replace(/https?:\/\/\S+/gi, '[REDACTED_URL]')
    .replace(/\b(otp|token|secret|service[_ -]?role|password)\b\s*[:=]\s*\S+/gi, '$1=[REDACTED]');
}

export interface PlannedDelivery {
  dedupKey: string;
  channel: NotificationChannel;
  outcome: 'SENT' | 'FAILED';
  retryEligible: false;
  failureClassification: 'PROVIDER_DISABLED' | null;
}

export function planFailClosedDeliveries(
  eventKey: string,
  recipientOwnerReference: string,
  purpose: NotificationPurpose,
  preferences: CommunicationPreference[],
): PlannedDelivery[] {
  const matrix = buildPreferenceMatrix(preferences);
  return NOTIFICATION_CHANNELS
    .filter(channel => matrix[`${purpose}:${channel}`])
    .map(channel => ({
      dedupKey: `${eventKey}:${recipientOwnerReference}:${channel}`,
      channel,
      outcome: channel === 'IN_APP' ? 'SENT' as const : 'FAILED' as const,
      retryEligible: false as const,
      failureClassification: channel === 'IN_APP' ? null : 'PROVIDER_DISABLED' as const,
    }));
}

export function derivePrivyDocLinkage(hasVerifiedEvidence: boolean, isDoctor: boolean): PrivyDocLinkage {
  if (hasVerifiedEvidence) return { state: 'LINKED', evidence_reference: 'authoritative_link_record' };
  return { state: isDoctor ? 'ELIGIBLE' : 'NOT_LINKED', evidence_reference: null };
}

export function resolvePrivyDocPortalUrl(configuredUrl?: string): string {
  const fallback = 'https://portal.privydoc.com.ng';
  if (!configuredUrl) return fallback;
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'portal.privydoc.com.ng'
      || url.username || url.password || url.search || url.hash) return fallback;
    return url.toString().replace(/\/$/, '');
  } catch {
    return fallback;
  }
}
