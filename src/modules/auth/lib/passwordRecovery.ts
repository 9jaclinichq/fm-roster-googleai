export type RecoveryCallbackKind = 'none' | 'route' | 'implicit' | 'pkce' | 'error';

export type RecoveryFailureReason =
  | 'expired_or_used'
  | 'flow_mismatch'
  | 'malformed'
  | 'session_missing';

export type RecoveryAccessState =
  | { status: 'none' }
  | { status: 'checking' }
  | { status: 'ready' }
  | { status: 'invalid'; reason: RecoveryFailureReason };

export interface RecoveryLocationSignal {
  kind: RecoveryCallbackKind;
  errorCode: string | null;
}

const SAFE_EXPIRED_CODES = new Set([
  'otp_expired',
  'access_denied',
  'bad_code_verifier',
]);

function parametersFromFragment(hash: string): URLSearchParams {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  if (fragment.startsWith('/')) {
    return new URLSearchParams(fragment.split('?')[1] ?? '');
  }
  return new URLSearchParams(fragment);
}

/**
 * Inspect only the callback shape. Recovery credentials are deliberately
 * neither returned nor retained; Supabase Auth remains responsible for
 * validating and consuming them.
 */
export function inspectRecoveryLocation(href: string): RecoveryLocationSignal {
  const url = new URL(href, 'https://workspace.privydoc.com.ng');
  const fragment = parametersFromFragment(url.hash);
  const route = url.hash.slice(1).split('?')[0];
  const type = fragment.get('type') ?? url.searchParams.get('type');
  const errorCode = fragment.get('error_code') ?? url.searchParams.get('error_code');
  const hasError = Boolean(
    fragment.get('error') ||
    fragment.get('error_description') ||
    errorCode ||
    url.searchParams.get('error') ||
    url.searchParams.get('error_description'),
  );

  if (hasError) return { kind: 'error', errorCode };
  if (url.searchParams.has('code')) return { kind: 'pkce', errorCode: null };
  if (type === 'recovery' && fragment.has('access_token') && fragment.has('refresh_token')) {
    return { kind: 'implicit', errorCode: null };
  }
  if (type === 'recovery') return { kind: 'error', errorCode: 'malformed_recovery' };
  if (route === '/doctor/reset-password') return { kind: 'route', errorCode: null };
  return { kind: 'none', errorCode: null };
}

// Captured before createClient() starts its asynchronous URL initialization.
// This contains no access token, refresh token, code, OTP, or link.
const initialRecoverySignal = typeof window === 'undefined'
  ? { kind: 'none', errorCode: null } satisfies RecoveryLocationSignal
  : inspectRecoveryLocation(window.location.href);

export function getInitialRecoverySignal(): RecoveryLocationSignal {
  return initialRecoverySignal;
}

export function recoveryFailureReason(signal: RecoveryLocationSignal): RecoveryFailureReason {
  if (signal.kind === 'pkce') return 'flow_mismatch';
  if (signal.kind === 'error' && signal.errorCode && SAFE_EXPIRED_CODES.has(signal.errorCode)) {
    return 'expired_or_used';
  }
  if (signal.kind === 'error') return 'malformed';
  return 'session_missing';
}

export function recoveryFailureMessage(reason: RecoveryFailureReason): string {
  if (reason === 'expired_or_used') {
    return 'This password-reset link has expired or was already used. Return to personal sign-in and request one fresh reset email.';
  }
  if (reason === 'flow_mismatch') {
    return 'This reset link does not match Workspc\'s configured recovery flow. Return to personal sign-in and request one fresh reset email.';
  }
  if (reason === 'malformed') {
    return 'This password-reset link is incomplete or invalid. Return to personal sign-in and request one fresh reset email.';
  }
  return 'A valid password-recovery session is required. Return to personal sign-in and request one fresh reset email.';
}

/** Remove callback credentials/errors only after Auth initialization settles. */
export function cleanRecoveryLocation(): void {
  if (typeof window === 'undefined') return;
  window.history.replaceState(window.history.state, '', `${window.location.origin}/#/doctor/reset-password`);
}
