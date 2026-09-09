import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AUTH_EMAIL_COOLDOWN_SECONDS,
  loginFailureMessage,
  registrationNextStepMessage,
  validatePersonalPassword,
} from '../src/modules/auth/lib/authJourney';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const service = read('src/lib/databaseService.ts');
const doctorAuth = read('src/modules/auth/components/DoctorAuthView.tsx');
const passwordReset = read('src/modules/auth/components/DoctorPasswordResetView.tsx');
const memberLink = read('src/modules/auth/components/LinkInstitutionalAccessPrompt.tsx');
const linkInvitation = read('src/modules/auth/components/InstitutionalAccountLinkInvitationView.tsx');
const linkAdmin = read('src/modules/org-admin/components/dashboard/AccountLinkingAdminPanel.tsx');
const communication = read('src/modules/communication/components/CommunicationHubView.tsx');
const capabilities = read('src/modules/communication/components/CapabilityDelegationPanel.tsx');
const dialog = read('src/modules/shared/ui/ConfirmationDialog.tsx');
const gateway = read('supabase/functions/workspc-gateway/index.ts');
const app = read('src/App.tsx');
let checks = 0;
const check = (condition: unknown, message: string) => { assert.ok(condition, message); checks += 1; };

check(validatePersonalPassword('12345')?.includes('at least 6'), 'five-character password is rejected against current hosted policy');
check(validatePersonalPassword('123456') === null, 'six-character password satisfies current hosted minimum');
check(validatePersonalPassword('longer-unique-password') === null, 'personal password is not constrained to a numeric PIN');
check(AUTH_EMAIL_COOLDOWN_SECONDS === 60, 'confirmation and recovery resend cooldown matches hosted SMTP frequency');
check(registrationNextStepMessage().includes('if the account is new') && registrationNextStepMessage().includes('does not reveal'), 'registration result is truthful and enumeration-resistant');
check(!registrationNextStepMessage().includes('Account created'), 'duplicate signup is never presented as a newly created account');
check(loginFailureMessage({ code: 'invalid_credentials' }).includes('personal password') && loginFailureMessage({ code: 'invalid_credentials' }).includes('institutional access code'), 'invalid credential recovery distinguishes password from access code');
check(loginFailureMessage({ code: 'email_not_confirmed' }).includes('Confirm your personal account email'), 'unconfirmed account gets an actionable confirmation state');

for (const call of ['auth.signUp', 'auth.signInWithPassword', 'auth.resetPasswordForEmail', "auth.resend({", 'auth.updateUser']) {
  check(service.includes(call), `database service uses supported Supabase ${call} flow`);
}
check(!service.includes('email_confirmed_at:') && !service.includes('admin.updateUserById'), 'client never manually confirms an Auth identity');
check(doctorAuth.includes('Personal password') && doctorAuth.includes('not your institution'), 'standalone auth labels the Supabase credential as a personal password');
check(!doctorAuth.includes('6-Digit PIN') && !doctorAuth.includes('inputMode="numeric"'), 'standalone personal auth no longer constrains password input to an institutional-style PIN');
check(doctorAuth.includes('registrationNextStepMessage()') && doctorAuth.includes('Forgot personal password?'), 'standalone auth exposes truthful registration and password recovery');
check(doctorAuth.includes('resendCooldown') && doctorAuth.includes('Resend confirmation'), 'confirmation resend is visibly cooldown-protected');
check(memberLink.includes('Personal account password') && memberLink.includes('separate from the institutional access code'), 'linking auth distinguishes personal password from institutional code');
check(memberLink.includes('requestDoctorPasswordReset') && memberLink.includes('resendDoctorConfirmation'), 'linking continuation preserves supported recovery paths');
check(passwordReset.includes('updateDoctorPassword') && passwordReset.includes('does not change or replace'), 'recovery screen updates only the personal password');
check(app.includes("event === 'PASSWORD_RECOVERY'") && app.includes("path=\"/doctor/reset-password\""), 'Auth recovery redirect is handled by the production HashRouter');
check(!passwordReset.includes('localStorage') && !memberLink.includes('localStorage'), 'recovery and linking proof add no browser fallback identity state');

check(gateway.includes("case 'account_link.invitation.preview'") && gateway.includes('previewAccountLinkInvitation'), 'existing gateway owns protected invitation preview');
check(gateway.includes('user.emailConfirmedAt') && gateway.includes('expectedFingerprint'), 'preview requires a confirmed Auth email matching the invitation contact fingerprint');
check(gateway.includes('masked_destination: contact.masked_destination') && !/previewAccountLinkInvitation[\s\S]*return json\(req, \{[\s\S]*user\.email[,}]/.test(gateway), 'preview returns the mask, never the account email');
check(linkInvitation.includes('previewInvitation(token)') && linkInvitation.includes('Loading the protected invitation review'), 'recipient sees a protected synthetic-review state before acting');

check(dialog.includes('role="dialog"') && dialog.includes('aria-modal="true"'), 'confirmation surface exposes accessible dialog semantics');
check(dialog.includes("event.key === 'Escape'") && dialog.includes('Cancel'), 'confirmation surface supports keyboard cancellation');
check(dialog.includes("busy ? 'Please wait…'") && dialog.includes('disabled={busy}'), 'confirmation surface prevents double submission and announces pending state');
for (const [source, action] of [[memberLink, 'self-claim'], [linkInvitation, 'invitation acceptance/rejection'], [linkAdmin, 'invitation send/revocation'], [communication, 'contact replacement/conversation/invitation/self-test'], [capabilities, 'capability grant/revocation']] as const) {
  check(source.includes('<ConfirmationDialog'), `${action} has explicit in-app review`);
}
check(communication.includes("kind: 'replace-contact'") && communication.includes("kind: 'close-conversation'") && communication.includes("kind: 'review-invitation'"), 'Communication Hub confirmation coverage is bounded to concrete consequential actions');
check(capabilities.includes("action: 'grant'") && capabilities.includes("action: 'revoke'"), 'capability grant and revocation both identify the reviewed action');
check(linkAdmin.includes('tenant_name') && gateway.includes("tenant_name: tenant?.name"), 'account-link admin reviews identify the affected organization');
check(app.includes('CommunicationHubView') && app.includes('/workspace/communication') && app.includes('/doctor/communication'), 'resident and doctor Communication Hub routes remain wired');
check(!gateway.includes('WORKSPC_META_ENABLED = true') && !gateway.includes('WORKSPC_FLUTTERWAVE_ENABLED = true'), 'provider activation is outside this repair');

console.log(`auth journey recovery verifier passed (${checks} checks)`);
