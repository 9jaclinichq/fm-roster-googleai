import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  inspectRecoveryLocation,
  recoveryFailureMessage,
  recoveryFailureReason,
} from '../src/modules/auth/lib/passwordRecovery';
import { validatePersonalEmail } from '../src/modules/auth/lib/authJourney';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const app = read('src/App.tsx');
const service = read('src/lib/databaseService.ts');
const view = read('src/modules/auth/components/DoctorPasswordResetView.tsx');
const authView = read('src/modules/auth/components/DoctorAuthView.tsx');
const linking = read('src/modules/auth/components/LinkInstitutionalAccessPrompt.tsx');
const invitations = read('src/modules/auth/components/InstitutionalAccountLinkInvitationView.tsx');
const communication = read('src/modules/communication/components/CommunicationHubView.tsx');
const capabilities = read('src/modules/communication/components/CapabilityDelegationPanel.tsx');

let checks = 0;
const check = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  checks += 1;
};

const implicit = inspectRecoveryLocation('https://workspace.privydoc.com.ng/#access_token=synthetic-a&refresh_token=synthetic-r&expires_in=3600&token_type=bearer&type=recovery');
check(implicit.kind === 'implicit', 'configured implicit recovery callback is recognized');
check(!('accessToken' in implicit) && !JSON.stringify(implicit).includes('synthetic-'), 'recovery signal never retains callback credentials');
check(inspectRecoveryLocation('https://workspace.privydoc.com.ng/?code=synthetic-code').kind === 'pkce', 'PKCE-shaped callback is recognized as a distinct flow');
check(recoveryFailureReason({ kind: 'pkce', errorCode: null }) === 'flow_mismatch', 'PKCE callback is rejected instead of mixed with implicit handling');
check(inspectRecoveryLocation('https://workspace.privydoc.com.ng/#error=access_denied&error_code=otp_expired').kind === 'error', 'expired callback is recognized safely');
check(recoveryFailureReason({ kind: 'error', errorCode: 'otp_expired' }) === 'expired_or_used', 'expired and used links receive a safe recovery classification');
check(recoveryFailureReason({ kind: 'error', errorCode: 'malformed_recovery' }) === 'malformed', 'malformed links receive a distinct safe classification');
check(inspectRecoveryLocation('https://workspace.privydoc.com.ng/#type=recovery').kind === 'error', 'credential-free recovery fragment is rejected');
check(inspectRecoveryLocation('https://workspace.privydoc.com.ng/#/doctor/reset-password').kind === 'route', 'dedicated recovery route is recognized');
check(inspectRecoveryLocation('https://workspace.privydoc.com.ng/#/doctor/login').kind === 'none', 'ordinary login is not treated as recovery');
check(recoveryFailureMessage('expired_or_used').includes('expired or was already used'), 'expired/used state has a precise safe action');
check(recoveryFailureMessage('session_missing').includes('valid password-recovery session'), 'direct or mismatched access cannot update a password');
check(validatePersonalEmail('') === 'Enter your personal account email first.', 'missing recovery email receives clear feedback');
check(validatePersonalEmail('not-an-email')?.includes('valid personal account email'), 'invalid recovery email receives clear feedback');
check(validatePersonalEmail('synthetic@example.invalid') === null, 'synthetic valid email passes client validation');

check(service.includes("flowType: 'implicit'") && service.includes('detectSessionInUrl: true'), 'Supabase client explicitly uses the configured implicit flow');
check(!service.includes('exchangeCodeForSession'), 'application does not combine PKCE exchange with implicit recovery');
check(service.indexOf('getInitialRecoverySignal') < service.indexOf('createClient('), 'recovery callback shape is imported before Supabase client initialization');
check(service.includes('await supabase!.auth.getSession()') && service.includes('await supabase!.auth.getUser()'), 'recovery session is initialized and independently validated');
check(service.includes('if (!activeRecoveryUserId)') && service.includes("throw new Error('recovery_session_required')"), 'password update requires the in-memory recovery marker');
check(service.includes("auth.signOut({ scope: 'global' })"), 'successful update revokes the recovery refresh session');
check(service.includes("auth.signOut({ scope: 'local' })"), 'browser recovery state is still cleared if global revocation reports an error');

check(app.includes('if (!recoveryBootstrapComplete)') && app.indexOf('if (!recoveryBootstrapComplete)') < app.lastIndexOf('<Router>'), 'HashRouter is not mounted until callback consumption finishes');
check(app.includes('cleanRecoveryLocation();') && app.includes("setRecovery({ status: 'invalid'"), 'valid and invalid callbacks are cleaned before rendering the dedicated route');
check(app.includes('path="/doctor/reset-password"') && app.includes('<DoctorPasswordResetView'), 'dedicated production recovery route is present');
check(view.includes('New personal password') && view.includes('Confirm new password'), 'new password must be entered twice');
check(view.includes('password !== confirmation') && view.includes('Passwords do not match.'), 'mismatched passwords are rejected');
check(view.includes('disabled={busy}') && view.includes("busy ? 'Updating"), 'double submission is prevented with a visible pending state');
check(view.includes("recovery.status !== 'ready'") && view.includes('Return to personal sign-in'), 'invalid recovery state shows a safe fresh-reset path');
check(view.includes('The recovery session is closed') && view.includes('Continue to personal sign-in'), 'successful update truthfully routes through a fresh sign-in');
check(app.includes("navigate('/doctor/login', { replace: true })") && app.includes("linkedWorkforce ? '/workspace/home' : '/doctor/home'"), 'fresh sign-in preserves institutional-link continuation');
check(authView.includes('loginDoctor') && authView.includes('registerDoctor'), 'ordinary login and registration remain wired');
check(authView.includes('onClick={requestPasswordReset}') && authView.includes('Forgot personal password?'), 'password recovery is a real button with the existing request handler');
check(authView.includes('aria-label="Request personal password reset"'), 'password recovery has a stable accessible name across loading and cooldown states');
check(!authView.includes('!email.trim() || resendCooldown'), 'missing email no longer makes the recovery control inert');
check(authView.includes('min-h-11') && authView.includes('focus-visible:ring-2'), 'recovery controls have adequate targets and visible keyboard focus');
check(authView.includes("emailAction === 'recovery' ? 'Requesting reset…'") && authView.includes('disabled={isSubmitting || emailAction !== null || resendCooldown > 0}'), 'recovery control exposes loading/cooldown and blocks duplicate submission');
check(authView.includes('emailActionInFlight.current') && authView.includes('useRef(false)'), 'same-tick recovery activations are guarded before React rerenders');
check(authView.includes('If a personal account exists for this email'), 'recovery result remains non-enumerating');

for (const [source, label] of [
  [linking, 'account link'],
  [invitations, 'invitation decisions'],
  [communication, 'Communication Hub'],
  [capabilities, 'capability delegation'],
] as const) {
  check(source.includes('<ConfirmationDialog'), `${label} confirmation review remains present`);
}

for (const source of [app, service, view]) {
  check(!/console\.(?:log|warn|error)\([^\n]*(?:location\.href|access_token|refresh_token|recovery token)/i.test(source), 'recovery credentials are not written to browser or application logs');
}

console.log(`password recovery bootstrap verifier passed (${checks} checks)`);
