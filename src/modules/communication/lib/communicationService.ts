import { supabase } from '../../../lib/databaseService';
import {
  CapabilityDelegation,
  CommunicationActor,
  CommunicationHubSnapshot,
  ContactChannel,
  GatewayProviderStatus,
  InvitationStatus,
  NotificationChannel,
  NotificationPurpose,
  ReviewArtifactType,
  SupportCategory,
  TenantCapability,
  normalizeEmailAddress,
  normalizeWhatsAppNumber,
} from './communicationDomain';

function requireClient() {
  if (!supabase) throw new Error('Communication Hub is unavailable because the database is not configured.');
  return supabase;
}

function actorParams(actor: CommunicationActor, accessCodeOverride?: string | null) {
  return {
    p_workforce_id: actor.kind === 'WORKFORCE' ? actor.id : null,
    p_resident_code: actor.kind === 'WORKFORCE' ? (accessCodeOverride ?? actor.accessCode) : null,
    p_doctor_id: actor.kind === 'DOCTOR' ? actor.id : null,
  };
}

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().rpc(name, params);
  if (error) {
    console.warn(`Communication Hub operation failed: ${name}`);
    throw new Error(error.message || 'Communication Hub operation failed.');
  }
  return data as T;
}

async function gateway<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().functions.invoke('workspc-gateway', { body });
  if (error || !data) {
    console.warn('Workspc gateway operation failed.');
    throw new Error('This secure delivery operation is unavailable. Sign in with your linked account and try again.');
  }
  return data as T;
}

const GATEWAY_SESSION_REQUIRED_MESSAGE =
  'Email and WhatsApp verification require a linked account session. Sign in through Doctor Login with the account linked to this Workspc profile, then return and try again. Your saved contact is unchanged.';

async function requireGatewaySession(): Promise<void> {
  const { data, error } = await requireClient().auth.getSession();
  if (error || !data.session?.access_token) {
    throw new Error(GATEWAY_SESSION_REQUIRED_MESSAGE);
  }
}

async function dispatchBestEffort(safeMessageReference: string): Promise<void> {
  try {
    await gateway({ operation: 'delivery.dispatch', safe_message_reference: safeMessageReference });
  } catch {
    // In-app communication is authoritative and must not fail because an
    // optional external provider or authenticated delivery session is absent.
  }
}

export interface AdminCommunicationSnapshot {
  delegations: CapabilityDelegation[];
  member_delivery_eligibility: Array<{
    workforce_id: string;
    workforce_name: string;
    whatsapp_state: 'NOT_PROVIDED' | 'UNVERIFIED' | 'PENDING_VERIFICATION' | 'VERIFIED';
    email_state: 'NOT_PROVIDED' | 'UNVERIFIED' | 'PENDING_VERIFICATION' | 'VERIFIED';
  }>;
}

export const communicationService = {
  async getHub(actor: CommunicationActor, accessCodeOverride?: string | null): Promise<CommunicationHubSnapshot> {
    return rpc<CommunicationHubSnapshot>('communication_get_hub', actorParams(actor, accessCodeOverride));
  },

  async saveContact(actor: CommunicationActor, channel: ContactChannel, value: string, accessCode?: string | null): Promise<void> {
    const canonical = channel === 'WHATSAPP' ? normalizeWhatsAppNumber(value) : normalizeEmailAddress(value);
    await rpc('communication_save_contact', {
      ...actorParams(actor, accessCode),
      p_channel: channel,
      p_value: canonical,
    });
  },

  async getGatewayStatus(): Promise<GatewayProviderStatus> {
    return gateway<GatewayProviderStatus>({ operation: 'status' });
  },

  async requestContactVerification(_actor: CommunicationActor, channel: ContactChannel, _accessCode?: string | null): Promise<void> {
    await requireGatewaySession();
    await gateway({ operation: 'verification.request', channel });
  },

  async completeContactVerification(_actor: CommunicationActor, channel: ContactChannel, code: string): Promise<void> {
    await requireGatewaySession();
    const result = await gateway<{ state: string }>({ operation: 'verification.complete', channel, code });
    if (result.state !== 'VERIFIED') throw new Error('The verification code was not accepted.');
  },

  async sendSelfTest(): Promise<void> {
    await requireGatewaySession();
    await gateway({ operation: 'delivery.self_test' });
  },

  async setPreference(
    actor: CommunicationActor,
    purpose: NotificationPurpose,
    channel: NotificationChannel,
    enabled: boolean,
    accessCode?: string | null,
  ): Promise<void> {
    await rpc('communication_set_preference', {
      ...actorParams(actor, accessCode),
      p_purpose: purpose,
      p_channel: channel,
      p_enabled: enabled,
    });
  },

  async startSupport(
    actor: CommunicationActor,
    category: SupportCategory,
    subject: string,
    message: string,
    accessCode?: string | null,
  ): Promise<string> {
    const conversationId = await rpc<string>('communication_start_support', {
      ...actorParams(actor, accessCode),
      p_category: category,
      p_subject: subject.trim(),
      p_message: message.trim(),
    });
    await dispatchBestEffort(`conversation:${conversationId}`);
    return conversationId;
  },

  async reply(actor: CommunicationActor, conversationId: string, message: string, accessCode?: string | null): Promise<void> {
    await rpc('communication_reply', {
      ...actorParams(actor, accessCode),
      p_conversation_id: conversationId,
      p_message: message.trim(),
    });
    await dispatchBestEffort(`conversation:${conversationId}`);
  },

  async markRead(actor: CommunicationActor, conversationId: string, accessCode?: string | null): Promise<void> {
    await rpc('communication_mark_read', {
      ...actorParams(actor, accessCode),
      p_conversation_id: conversationId,
    });
  },

  async closeConversation(actor: CommunicationActor, conversationId: string, accessCode?: string | null): Promise<void> {
    await rpc('communication_close_conversation', {
      ...actorParams(actor, accessCode),
      p_conversation_id: conversationId,
    });
  },

  async createReviewInvitation(
    actor: CommunicationActor,
    inviteeWorkforceId: string,
    artifactType: ReviewArtifactType,
    artifactId: string,
    dueDate: string | null,
    accessCode?: string | null,
  ): Promise<string> {
    const invitationId = await rpc<string>('communication_create_review_invitation', {
      ...actorParams(actor, accessCode),
      p_invitee_workforce_id: inviteeWorkforceId,
      p_artifact_type: artifactType,
      p_artifact_id: artifactId,
      p_due_date: dueDate || null,
    });
    await dispatchBestEffort(`review_invitation:${invitationId}`);
    return invitationId;
  },

  async respondToInvitation(
    actor: CommunicationActor,
    invitationId: string,
    status: Extract<InvitationStatus, 'ACCEPTED' | 'DECLINED' | 'CANCELLED' | 'COMPLETED'>,
    accessCode?: string | null,
  ): Promise<void> {
    await rpc('communication_respond_review_invitation', {
      ...actorParams(actor, accessCode),
      p_invitation_id: invitationId,
      p_status: status,
    });
  },

  async startCoordination(
    actor: CommunicationActor,
    targetWorkforceId: string,
    capability: TenantCapability,
    subject: string,
    message: string,
    accessCode?: string | null,
  ): Promise<string> {
    const conversationId = await rpc<string>('communication_start_coordination', {
      ...actorParams(actor, accessCode),
      p_target_workforce_id: targetWorkforceId,
      p_capability: capability,
      p_subject: subject.trim(),
      p_message: message.trim(),
    });
    await dispatchBestEffort(`conversation:${conversationId}`);
    return conversationId;
  },

  async getAdminSnapshot(adminCode: string): Promise<AdminCommunicationSnapshot> {
    return rpc<AdminCommunicationSnapshot>('chief_get_communication_admin', { p_admin_code: adminCode });
  },

  async grantCapability(adminCode: string, workforceId: string, capability: TenantCapability): Promise<void> {
    await rpc('chief_grant_tenant_capability', {
      p_admin_code: adminCode,
      p_workforce_id: workforceId,
      p_capability: capability,
    });
  },

  async revokeCapability(adminCode: string, delegationId: string): Promise<void> {
    await rpc('chief_revoke_tenant_capability', {
      p_admin_code: adminCode,
      p_delegation_id: delegationId,
    });
  },
};
