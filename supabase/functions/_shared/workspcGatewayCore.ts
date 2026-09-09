export const WORKSPC_NOTIFICATION_PURPOSES = [
  'ROSTER',
  'ANNOUNCEMENTS',
  'MEETINGS',
  'REVIEW_INVITATIONS',
  'KNOWLEDGE_PUBLICATIONS',
  'PRODUCT_RELEASES',
  'SUPPORT_REPLIES',
] as const;

export type WorkspcNotificationPurpose = typeof WORKSPC_NOTIFICATION_PURPOSES[number];
export type ExternalChannel = 'EMAIL' | 'WHATSAPP';
export type ProviderFailureKind = 'REJECTED' | 'UNKNOWN';

export const WORKSPC_TEMPLATE_KEYS = [
  'support_conversation_opened',
  'support_reply',
  'review_invitation_created',
  'review_coordination_reply',
  'announcements_manage_coordination',
  'meetings_manage_coordination',
  'roster_coordinate_coordination',
  'knowledge_publish_coordination',
  'review_coordinate_coordination',
  'member_support_coordination',
] as const;

const TEMPLATE_KEY_SET = new Set<string>(WORKSPC_TEMPLATE_KEYS);
const PURPOSE_SET = new Set<string>(WORKSPC_NOTIFICATION_PURPOSES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_PATTERN = /^\+[1-9][0-9]{7,14}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isAllowedPurpose(value: unknown): value is WorkspcNotificationPurpose {
  return typeof value === 'string' && PURPOSE_SET.has(value);
}

export function isAllowedTemplateKey(value: unknown): value is typeof WORKSPC_TEMPLATE_KEYS[number] {
  return typeof value === 'string' && TEMPLATE_KEY_SET.has(value);
}

export function isValidRecipient(channel: ExternalChannel, value: string): boolean {
  return channel === 'EMAIL' ? EMAIL_PATTERN.test(value) && value === value.toLowerCase() : PHONE_PATTERN.test(value);
}

export function makeNumericOtp(randomBytes: Uint8Array): string {
  if (randomBytes.byteLength < 4) throw new Error('At least four random bytes are required');
  const value = new DataView(randomBytes.buffer, randomBytes.byteOffset, randomBytes.byteLength).getUint32(0, false);
  return String(value % 1_000_000).padStart(6, '0');
}

export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  if (!secret) throw new Error('HMAC secret is not configured');
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export async function verifyHmacSha256Signature(
  secret: string,
  value: string,
  suppliedSignature: string,
): Promise<boolean> {
  if (!secret || !suppliedSignature.startsWith('sha256=')) return false;
  const expected = await hmacSha256Hex(secret, value);
  return timingSafeEqual(suppliedSignature.slice(7).toLowerCase(), expected);
}

export async function verifySvixWebhookSignature(
  secret: string,
  id: string,
  timestamp: string,
  rawBody: string,
  suppliedSignatures: string,
  nowSeconds = Date.now() / 1000,
): Promise<boolean> {
  const seconds = Number(timestamp);
  if (!secret || !id || !Number.isFinite(seconds) || Math.abs(nowSeconds - seconds) > 300) return false;
  try {
    const encodedSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const key = await crypto.subtle.importKey(
      'raw', base64ToBytes(encodedSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${rawBody}`),
    );
    const expected = bytesToBase64(new Uint8Array(signature));
    return suppliedSignatures.split(' ').some(
      candidate => candidate.startsWith('v1,') && timingSafeEqual(candidate.slice(3), expected),
    );
  } catch {
    return false;
  }
}

export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export interface EmailRequest {
  from: string;
  to: string[];
  subject: string;
  html: string;
  headers: Record<string, string>;
}

function emailFrame(title: string, body: string, footer: string): string {
  return [
    '<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#172033">',
    `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>`,
    body,
    `<p style="font-size:12px;color:#667085;margin-top:24px">${escapeHtml(footer)}</p>`,
    '</div>',
  ].join('');
}

export function buildVerificationEmail(from: string, to: string, code: string, requestId: string): EmailRequest {
  if (!/^\d{6}$/.test(code)) throw new Error('Verification code must be six digits');
  if (!EMAIL_PATTERN.test(to)) throw new Error('Invalid email recipient');
  return {
    from,
    to: [to],
    subject: 'Your Workspc verification code',
    html: emailFrame(
      'Verify your Workspc email',
      `<p>Your one-time code is:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${code}</p><p>This code expires in 10 minutes. Do not share it.</p>`,
      'PrivyDoc Workspace · This message contains no clinical information.',
    ),
    headers: { 'X-Entity-Ref-ID': requestId },
  };
}

export function buildOperationalEmail(
  from: string,
  to: string,
  purpose: WorkspcNotificationPurpose,
  deliveryId: string,
): EmailRequest {
  if (!isValidRecipient('EMAIL', to)) throw new Error('Invalid email recipient');
  if (!isAllowedPurpose(purpose)) throw new Error('Unsupported notification purpose');
  const preferenceUrl = 'https://workspace.privydoc.com.ng/#/workspace/communication';
  return {
    from,
    to: [to],
    subject: 'You have a Workspc update',
    html: emailFrame(
      'Workspc notification',
      `<p>You have a new privacy-safe Workspc update.</p><p><a href="${preferenceUrl}">Open Communication Hub</a></p>`,
      `Manage notification preferences in Workspc. Delivery reference ${escapeHtml(deliveryId)}.`,
    ),
    headers: { 'List-Unsubscribe': `<${preferenceUrl}>`, 'X-Entity-Ref-ID': deliveryId },
  };
}

export function buildAccountLinkInvitationEmail(
  from: string,
  to: string,
  token: string,
  invitationId: string,
): EmailRequest {
  if (!isValidRecipient('EMAIL', to)) throw new Error('Invalid email recipient');
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new Error('Invalid account-link token');
  if (!isUuid(invitationId)) throw new Error('Invalid invitation identifier');
  const invitationUrl = `https://workspace.privydoc.com.ng/#/workspace/link-account?invitation=${encodeURIComponent(token)}`;
  return {
    from,
    to: [to],
    subject: 'Confirm your Workspc institutional account link',
    html: emailFrame(
      'Link your institutional Workspc access',
      `<p>An administrator invited you to link an existing institutional profile to your personal Workspc account.</p><p><a href="${invitationUrl}">Review account link</a></p><p>This single-use invitation expires in 24 hours. If you did not expect it, reject or ignore it.</p>`,
      'PrivyDoc Workspace · This message contains no clinical information.',
    ),
    headers: { 'X-Entity-Ref-ID': invitationId },
  };
}

export function buildWhatsAppTemplateRequest(
  phoneNumberId: string,
  to: string,
  templateName: string,
  languageCode: string,
  variables: readonly string[],
  copyCodeButton = false,
): { url: string; body: Record<string, unknown> } {
  if (!/^[0-9]{6,30}$/.test(phoneNumberId)) throw new Error('Invalid Meta phone-number ID');
  if (!isValidRecipient('WHATSAPP', to)) throw new Error('Invalid WhatsApp recipient');
  if (!/^[a-z0-9_]{1,100}$/.test(templateName)) throw new Error('Invalid WhatsApp template name');
  if (!/^[a-z]{2}(?:_[A-Z]{2})?$/.test(languageCode)) throw new Error('Invalid WhatsApp language code');
  if (variables.some(value => value.length > 64 || /[\r\n]/.test(value))) throw new Error('Invalid WhatsApp template variable');

  const components: Array<Record<string, unknown>> = variables.length === 0 ? [] : [{
    type: 'body',
    parameters: variables.map(text => ({ type: 'text', text })),
  }];
  if (copyCodeButton) {
    if (variables.length !== 1 || !/^\d{6}$/.test(variables[0])) throw new Error('Copy-code template requires one six-digit code');
    components.push({
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: variables[0] }],
    });
  }
  return {
    url: `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`,
    body: {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: to.slice(1),
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length > 0 ? { components } : {}),
      },
    },
  };
}

export function classifyProviderFailure(status: number | null): ProviderFailureKind {
  return status !== null && status >= 400 && status < 500 ? 'REJECTED' : 'UNKNOWN';
}

export function redactGatewayError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Unknown gateway error';
  return message
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
    .replace(/\+[1-9][0-9]{7,14}/g, '[REDACTED_PHONE]')
    .replace(/\b\d{6}\b/g, '[REDACTED_CODE]')
    .replace(/(Bearer|token|secret|key)\s*[=:]?\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(0, 240);
}
