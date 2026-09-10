import assert from 'node:assert/strict';
import http from 'node:http';

const cdpBase = process.env.WORKSPC_POST_LINK_TEST_CDP ?? 'http://127.0.0.1:9226';
const appBase = process.env.WORKSPC_POST_LINK_TEST_APP ?? 'http://127.0.0.1:4174';
const mockPort = Number(process.env.WORKSPC_POST_LINK_TEST_API_PORT ?? 54329);
const userId = '10000000-0000-4000-8000-000000000001';
const membershipId = '20000000-0000-4000-8000-000000000001';
const tenantId = '30000000-0000-4000-8000-000000000001';
const workforceId = '40000000-0000-4000-8000-000000000001';
let membershipRequests = 0;
let hasMembership = true;

const json = (response, value, status = 200) => {
  response.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Content-Type': 'application/json',
  });
  response.end(JSON.stringify(value));
};

const mockApi = http.createServer((request, response) => {
  if (request.method === 'OPTIONS') return json(response, {});
  const url = new URL(request.url, `http://127.0.0.1:${mockPort}`);
  if (url.pathname === '/test/set-unlinked') {
    hasMembership = false;
    return json(response, { ok: true });
  }
  if (url.pathname === '/auth/v1/user') return json(response, {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'synthetic@example.invalid',
    email_confirmed_at: '2026-09-09T00:00:00.000Z',
    user_metadata: {},
  });
  if (url.pathname === '/rest/v1/doctor_profiles') return json(response, {
    id: userId,
    email: 'synthetic@example.invalid',
    full_name: 'Synthetic Linked Member',
    created_at: '2026-09-09T00:00:00.000Z',
  });
  if (url.pathname === '/rest/v1/rpc/current_user_organisation_memberships') {
    membershipRequests += 1;
    if (!hasMembership) return setTimeout(() => json(response, []), 500);
    return setTimeout(() => json(response, [{
      membership_id: membershipId,
      tenant_id: tenantId,
      tenant_name: 'Synthetic Organization',
      workforce_id: workforceId,
      workforce_full_name: 'Synthetic Linked Member',
      is_workforce_member: true,
      is_tenant_admin: false,
      status: 'active',
      linked_at: null,
      claimed_at: '2026-09-09T00:00:00.000Z',
    }]), 500);
  }
  if (url.pathname === '/rest/v1/workforce') return json(response, {
    id: workforceId,
    tenant_id: tenantId,
    full_name: 'Synthetic Linked Member',
    category: 'Registrar',
    category_id: null,
    active: true,
    email: null,
    doctor_id: null,
    created_at: '2026-09-09T00:00:00.000Z',
  });
  if (url.pathname === '/rest/v1/user_roles') return json(response, [{ role_id: 'resident', org_group: null }]);
  if (url.pathname === '/rest/v1/terminology_overrides') return json(response, []);
  if (url.pathname.startsWith('/rest/v1/rpc/')) return json(response, null);
  return json(response, []);
});
await new Promise((resolve, reject) => {
  mockApi.once('error', reject);
  mockApi.listen(mockPort, '127.0.0.1', resolve);
});

try {
  const pages = await (await fetch(`${cdpBase}/json/list`)).json();
  const page = pages.find(candidate => candidate.type === 'page');
  assert.ok(page?.webSocketDebuggerUrl, 'a Chromium page target is required');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const browserMessages = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    } else if (message.method === 'Runtime.consoleAPICalled' || message.method === 'Log.entryAdded') {
      browserMessages.push(JSON.stringify(message.params));
    }
  };
  const send = (method, params = {}) => new Promise(resolve => {
    const id = ++sequence;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
    return response.result?.result?.value;
  };
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await evaluate(expression)) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const diagnostic = await evaluate("({ hash: location.hash, text: document.body?.innerText?.slice(0, 400), storageKeys: Object.keys(localStorage) })");
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(diagnostic)}`);
  };

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: true });
  await send('Storage.clearDataForOrigin', { origin: appBase, storageTypes: 'all' });
  await send('Page.navigate', { url: 'about:blank' });
  await waitFor("location.href === 'about:blank'", 'blank test document');
  await send('Page.navigate', { url: `${appBase}/#/doctor/login` });
  await waitFor("location.hash === '#/doctor/login'", 'initial app origin');

  await evaluate(`(() => {
    localStorage.setItem('fm_session_resident', JSON.stringify({ id: '${workforceId}', name: 'Synthetic Linked Member', category: 'Associate', tenant_id: '${tenantId}', hasEmail: true, subadminRoles: [] }));
    location.hash = '#/workspace/home';
    location.reload();
  })()`);
  await waitFor("location.hash === '#/workspace/home'", 'signed-out institutional restoration');
  await waitFor("document.readyState === 'complete' && Boolean(document.body)", 'signed-out restoration readiness');
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.ok(!await evaluate("document.body.innerText.includes('Link this institutional profile to a personal account')"), 'signed-out/code-only restoration does not infer unlinked state or offer relinking');
  assert.ok(await evaluate("document.body.innerText.includes('Sign in to restore personal access')"), 'signed-out institutional restoration offers personal sign-in');

  const now = Math.floor(Date.now() / 1000);
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const accessToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ aud: 'authenticated', exp: now + 3600, iat: now, sub: userId, role: 'authenticated' })}.synthetic`;
  const session = {
    access_token: accessToken,
    refresh_token: 'synthetic-refresh-token',
    expires_in: 3600,
    expires_at: now + 3600,
    token_type: 'bearer',
    user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.invalid', user_metadata: {} },
  };
  await evaluate(`(() => {
    localStorage.setItem('fm_session_resident', JSON.stringify({ id: '${workforceId}', name: 'Stale Browser State', category: 'Registrar', tenant_id: 'stale-tenant', hasEmail: true, subadminRoles: [] }));
    localStorage.setItem('sb-127-auth-token', ${JSON.stringify(JSON.stringify(session))});
    location.reload();
  })()`);

  await waitFor("document.readyState === 'complete' && Boolean(document.body)", 'pending projection document readiness');
  assert.ok(!await evaluate("document.body.innerText.includes('Link this institutional profile to a personal account')"), 'pending canonical resolution does not flash a relink prompt');

  await waitFor(`JSON.parse(localStorage.getItem('fm_session_resident') || '{}').id === '${workforceId}'`, 'canonical workforce projection');
  await waitFor("location.hash === '#/workspace/home'", 'linked workspace route');
  const desktop = await evaluate(`(() => ({
    text: document.body.innerText,
    width: document.documentElement.clientWidth,
    resident: JSON.parse(localStorage.getItem('fm_session_resident') || '{}'),
  }))()`);
  assert.equal(desktop.resident.id, workforceId, 'canonical workforce replaces stale browser state');
  assert.equal(desktop.resident.tenant_id, tenantId, 'canonical tenant replaces stale browser state');
  assert.ok(!desktop.text.includes('Link this institutional profile to a personal account'), 'linked desktop does not offer relinking');
  assert.ok(!desktop.text.includes('Your account is not yet linked to an organization'), 'linked desktop does not show unlinked waiting room');
  assert.ok(!desktop.text.includes('Chief Resident Portal') && !desktop.text.includes('Chief Admin Login'), 'non-admin personal session has no Chief entry point');

  await evaluate("location.hash = '#/admin-portal'");
  await waitFor("location.hash === '#/workspace/home'", 'non-admin direct-route rejection');
  assert.ok(!await evaluate("document.body.innerText.includes('Organizational Admin Portal')"), 'direct admin portal content is not rendered');

  await send('Emulation.setDeviceMetricsOverride', { width: 500, height: 900, deviceScaleFactor: 1, mobile: true });
  await evaluate(`(() => {
    localStorage.setItem('fm_session_resident', JSON.stringify({ id: '${workforceId}', name: 'Stale Mobile State', category: 'Registrar', tenant_id: 'stale-mobile-tenant', hasEmail: true, subadminRoles: [] }));
    location.reload();
  })()`);
  await waitFor(`JSON.parse(localStorage.getItem('fm_session_resident') || '{}').id === '${workforceId}'`, 'mobile canonical workforce projection');
  await waitFor("location.hash === '#/workspace/home'", 'mobile linked workspace route');
  await waitFor("document.readyState === 'complete' && Boolean(document.body)", 'mobile document readiness');
  const mobile = await evaluate("(() => ({ width: document.documentElement.clientWidth, text: document.body.innerText }))()");
  assert.equal(mobile.width, 500, 'linked dashboard is rendered at approximately 500px');
  assert.ok(!mobile.text.includes('Link this institutional profile to a personal account'), 'linked mobile does not offer relinking');
  assert.ok(!mobile.text.includes('Chief Resident Portal') && !mobile.text.includes('Chief Admin Login'), 'linked mobile has no unauthorized Chief entry');
  assert.ok(membershipRequests >= 2, 'hard refresh re-resolves canonical membership from the server');
  assert.ok(!browserMessages.join('\n').includes('synthetic-refresh-token'), 'browser logs do not expose session credentials');

  await evaluate(`void fetch('http://127.0.0.1:${mockPort}/test/set-unlinked').then(() => {
    localStorage.setItem('fm_session_resident', JSON.stringify({ id: '${workforceId}', name: 'Synthetic Unlinked Member', category: 'Associate', tenant_id: '${tenantId}', hasEmail: true, subadminRoles: [] }));
    location.hash = '#/workspace/home';
    location.reload();
  })`);
  await waitFor("document.body?.innerText.includes('Link this institutional profile to a personal account')", 'authenticated unlinked linking journey');
  assert.ok(await evaluate("document.body.innerText.includes('Link this institutional profile to a personal account')"), 'a genuinely unlinked authenticated identity is still offered the linking journey');

  socket.close();
  console.log('synthetic post-link browser projection passed (14 checks)');
} finally {
  mockApi.closeAllConnections?.();
  await new Promise(resolve => mockApi.close(resolve));
}
