import assert from 'node:assert/strict';
import http from 'node:http';

const cdpBase = process.env.WORKSPC_ADMIN_TEST_CDP ?? 'http://127.0.0.1:9227';
const appBase = process.env.WORKSPC_ADMIN_TEST_APP ?? 'http://127.0.0.1:4175';
const mockPort = Number(process.env.WORKSPC_ADMIN_TEST_API_PORT ?? 54330);
const userId = '10000000-0000-4000-8000-000000000010';
const membershipId = '20000000-0000-4000-8000-000000000010';
const tenantId = '30000000-0000-4000-8000-000000000010';
const workforceId = '40000000-0000-4000-8000-000000000010';
let isAdmin = true;
let dashboardRequests = 0;
let setupWrites = 0;

const json = (response, value, status = 200) => {
  response.writeHead(status, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
};
const overrides = { org_name: 'Synthetic Cooperative', org_short_name: 'Co-op', tenant_type: 'Cooperative', member: 'Associate', members: 'Associates', admin: 'Programme Lead', admin_dashboard: 'Team Control Room', schedule: 'Shift Plan', assignment: 'Duty', submission: 'Work Update', collection_cycle: 'Reporting Cycle', professional_development: 'Skills Growth' };

const mockApi = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') return json(response, {});
  const url = new URL(request.url, `http://127.0.0.1:${mockPort}`);
  if (url.pathname === '/test/set-non-admin') { isAdmin = false; return json(response, { ok: true }); }
  if (url.pathname === '/auth/v1/user') return json(response, { id: userId, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', email_confirmed_at: '2026-09-09T00:00:00.000Z', user_metadata: {} });
  if (url.pathname === '/rest/v1/doctor_profiles') return json(response, { id: userId, email: 'synthetic@example.invalid', full_name: 'Synthetic Member', created_at: '2026-09-09T00:00:00.000Z' });
  if (url.pathname === '/rest/v1/rpc/current_user_organisation_memberships') return json(response, [{ membership_id: membershipId, tenant_id: tenantId, tenant_name: 'Synthetic Cooperative', workforce_id: workforceId, workforce_full_name: 'Synthetic Member', is_workforce_member: true, is_tenant_admin: isAdmin, status: 'active', linked_at: null, claimed_at: '2026-09-09T00:00:00.000Z' }]);
  if (url.pathname === '/rest/v1/workforce') return json(response, { id: workforceId, tenant_id: tenantId, full_name: 'Synthetic Member', category: 'Associate', category_id: null, active: true, email: null, doctor_id: null, created_at: '2026-09-09T00:00:00.000Z' });
  if (url.pathname === '/rest/v1/user_roles') return json(response, []);
  if (url.pathname === '/rest/v1/tenants') return json(response, [{ id: tenantId, terminology_overrides: overrides, module_flags: {} }]);
  if (url.pathname === '/rest/v1/rpc/workspc_tenant_admin_get_dashboard') {
    dashboardRequests += 1;
    if (!isAdmin) return json(response, { message: 'Active tenant-administrator membership required' }, 403);
    return json(response, { membership_id: membershipId, tenant_id: tenantId, tenant_name: 'Synthetic Cooperative', plan_type: 'free_seeded', terminology_overrides: overrides, module_flags: {}, counts: { active_members: 3, open_collections: 1, active_admins: 1 }, members: [], latest_configuration_audit_id: null });
  }
  if (url.pathname === '/rest/v1/rpc/workspc_tenant_admin_update_setup') { setupWrites += 1; return json(response, { audit_id: '50000000-0000-4000-8000-000000000010', changed: true }); }
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(response, null);
  return json(response, []);
});
await new Promise((resolve, reject) => { mockApi.once('error', reject); mockApi.listen(mockPort, '127.0.0.1', resolve); });

try {
  const pages = await (await fetch(`${cdpBase}/json/list`)).json();
  const page = pages.find(candidate => candidate.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'a Chromium page target is required');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); } };
  const send = (method, params = {}) => new Promise(resolve => { const id = ++sequence; pending.set(id, resolve); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text); return response.result?.result?.value; };
  const waitFor = async (expression, label) => { for (let attempt = 0; attempt < 150; attempt += 1) { if (await evaluate(expression)) return; await new Promise(resolve => setTimeout(resolve, 100)); } throw new Error(`Timed out waiting for ${label}`); };
  await send('Runtime.enable'); await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Storage.clearDataForOrigin', { origin: appBase, storageTypes: 'all' });
  await send('Page.navigate', { url: 'about:blank' });
  await waitFor("location.href === 'about:blank'", 'clean browser context');
  await send('Page.navigate', { url: `${appBase}/#/doctor/login` });
  await waitFor("location.hash === '#/doctor/login'", 'application origin');
  const now = Math.floor(Date.now() / 1000); const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: 'authenticated', exp: now + 3600, iat: now, sub: userId, role: 'authenticated' })}.synthetic`;
  const session = { access_token: accessToken, refresh_token: 'synthetic-refresh-token', expires_in: 3600, expires_at: now + 3600, token_type: 'bearer', user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', user_metadata: {} } };
  await evaluate(`localStorage.setItem('sb-127-auth-token', ${JSON.stringify(JSON.stringify(session))}); location.hash='#/chief/dashboard'; location.reload();`);
  await waitFor("document.body?.innerText.includes('Team Control Room')", 'configured admin dashboard');
  const desktop = await evaluate("({text:document.body.innerText,width:document.documentElement.clientWidth,badge:document.querySelector('[aria-label^=\"Tenant administrator:\"]')?.getAttribute('aria-label'),buttons:[...document.querySelectorAll('button')].map(b=>b.innerText)})");
  assert.ok(desktop.text.includes('Synthetic Cooperative') && desktop.text.includes('Associates'), 'configured non-medical tenant terminology renders');
  assert.equal(desktop.badge, 'Tenant administrator: Programme Lead', 'configured badge has correct accessible name');
  assert.ok(desktop.buttons.includes('Member Workspace'), 'member-workspace return is visible');
  const firstTenantLeaks = desktop.text
    .split(/\r?\n/)
    .filter(line => /UCH|Family Medicine|Chief Resident|Consultant|WACP/.test(line));
  assert.deepEqual(firstTenantLeaks, [], `first-tenant terminology does not leak: ${JSON.stringify(firstTenantLeaks)}`);
  const focusable = await evaluate("(() => { const b=[...document.querySelectorAll('button')].find(x=>x.innerText==='Review changes'); b.focus(); return document.activeElement===b && b.getBoundingClientRect().height>=44; })()");
  assert.ok(focusable, 'setup review is keyboard-focusable with an adequate target');
  await evaluate("[...document.querySelectorAll('button')].find(x=>x.innerText==='Review changes').click()");
  await waitFor("document.body?.innerText.includes('Apply organisation setup changes?')", 'review confirmation');
  await evaluate("[...document.querySelectorAll('button')].find(x=>x.innerText==='Save organisation setup').click()");
  await waitFor("document.body?.innerText.includes('Organisation setup saved with audit reference')", 'durable success feedback');
  assert.equal(setupWrites, 1, 'one activation creates exactly one setup request');
  assert.ok(dashboardRequests >= 2, 'dashboard refreshes from server after save');

  await send('Emulation.setDeviceMetricsOverride', { width: 500, height: 900, deviceScaleFactor: 1, mobile: true });
  await evaluate('location.reload()');
  await waitFor("document.body?.innerText.includes('Team Control Room')", 'mobile admin dashboard');
  const mobile = await evaluate("({width:document.documentElement.clientWidth,text:document.body.innerText,scrollWidth:document.documentElement.scrollWidth})");
  assert.equal(mobile.width, 500, 'dashboard renders at approximately 500px');
  assert.ok(mobile.scrollWidth <= 500, 'dashboard has no page-level horizontal overflow');
  assert.ok(mobile.text.includes('Member Workspace'), 'mobile return path remains visible');

  await evaluate(`fetch('http://127.0.0.1:${mockPort}/test/set-non-admin').then(()=>{location.reload()})`);
  await waitFor("location.hash === '#/workspace/home'", 'revoked/non-admin direct-route rejection');
  assert.ok(!await evaluate("document.body.innerText.includes('Team Control Room')"), 'revoked member cannot render admin data');
  socket.close();
  console.log('synthetic tenant-admin browser verification passed (13 checks)');
} finally {
  await new Promise(resolve => mockApi.close(resolve));
}
