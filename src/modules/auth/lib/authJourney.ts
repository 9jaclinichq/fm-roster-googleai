export const PERSONAL_PASSWORD_MIN_LENGTH = 6;
export const AUTH_EMAIL_COOLDOWN_SECONDS = 60;

export function validatePersonalEmail(email: string): string | null {
  const normalized = email.trim();
  if (!normalized) return 'Enter your personal account email first.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return 'Enter a valid personal account email, such as name@example.com.';
  }
  return null;
}

export function validatePersonalPassword(password: string): string | null {
  if (password.length < PERSONAL_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PERSONAL_PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

export function registrationNextStepMessage(): string {
  return 'Check this email for a confirmation message if the account is new. If you registered before, sign in or reset your password. For privacy, Workspc does not reveal whether an account already exists.';
}

export function loginFailureMessage(error: unknown): string {
  const candidate = error as { code?: string; message?: string } | null;
  const code = String(candidate?.code ?? '');
  const message = String(candidate?.message ?? '');
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return 'Confirm your personal account email before signing in. You can resend the confirmation message below.';
  }
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return 'That email and personal password were not accepted. Do not use your institutional access code here; reset the personal password if you no longer know it.';
  }
  if (message === 'recovery_session_required') {
    return 'This password-recovery session is no longer valid. Return to personal sign-in and request one fresh reset email.';
  }
  return message || 'Personal sign-in could not be completed. Please try again.';
}
