import assert from 'node:assert/strict';

const cdpBase = process.env.WORKSPC_RECOVERY_TEST_CDP ?? 'http://127.0.0.1:9225';
const appBase = process.env.WORKSPC_RECOVERY_TEST_APP ?? 'http://127.0.0.1:4173';
const pages = await (await fetch(`${cdpBase}/json/list`)).json();
const page = pages.find(candidate => candidate.type === 'page');
assert.ok(page?.webSocketDebuggerUrl, 'a Chromium page target is required');

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

let sequence = 0;
const pending = new Map();
const browserMessages = [];
let recoveryRequests = 0;
socket.onmessage = event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
    return;
  }
  if (message.method === 'Runtime.consoleAPICalled' || message.method === 'Log.entryAdded') {
    browserMessages.push(JSON.stringify(message.params));
  }
  if (message.method === 'Network.requestWillBeSent' && message.params?.request?.method === 'POST' && message.params?.request?.url?.includes('/auth/v1/recover')) {
    recoveryRequests += 1;
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};

await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Storage.clearDataForOrigin', { origin: appBase, storageTypes: 'all' });
// Force a new document: navigating from one app hash to another is otherwise
// only a same-document HashRouter transition and cannot reproduce an email
// callback landing in a fresh tab.
await send('Page.navigate', { url: 'about:blank' });
await waitFor("location.href === 'about:blank'", 'blank test document');

const callback = `${appBase}/#access_token=synthetic-access&refresh_token=synthetic-refresh&expires_in=3600&token_type=bearer&type=recovery`;
await send('Page.navigate', { url: callback });
await waitFor("document.querySelectorAll('input[type=password]').length === 2", 'validated recovery form');

const sanitized = await evaluate("({href: location.href, text: document.body.innerText, fields: document.querySelectorAll('input[type=password]').length})");
assert.equal(sanitized.fields, 2, 'valid recovery renders both password fields');
assert.match(sanitized.href, /#\/doctor\/reset-password$/);
assert.ok(!sanitized.href.includes('access_token') && !sanitized.href.includes('refresh_token'), 'callback credentials are removed from the browser URL');

await evaluate(`(() => {
  const fields = document.querySelectorAll('input[type=password]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(fields[0], 'synthetic-new-password');
  fields[0].dispatchEvent(new Event('input', { bubbles: true }));
  setter.call(fields[1], 'synthetic-mismatch');
  fields[1].dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('form').requestSubmit();
})()`);
await waitFor("document.body.innerText.includes('Passwords do not match.')", 'mismatch validation');

await evaluate(`(() => {
  const fields = document.querySelectorAll('input[type=password]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(fields[1], 'synthetic-new-password');
  fields[1].dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('form').requestSubmit();
})()`);
await waitFor("document.body.innerText.includes('The recovery session is closed')", 'successful password update');
assert.equal(await evaluate("document.querySelectorAll('input[type=password]').length"), 0, 'password inputs are cleared after success');

await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent.includes('Continue to personal sign-in')).click()");
await waitFor("location.hash === '#/doctor/login'", 'fresh personal sign-in route');
assert.ok(await evaluate("document.body.innerText.toLowerCase().includes('personal password')"), 'ordinary personal sign-in is restored after recovery');

const recoveryButtonExpression = "document.querySelector('button[aria-label=\"Request personal password reset\"]')";
const desktopControl = await evaluate(`(() => { const button = ${recoveryButtonExpression}; const rect = button.getBoundingClientRect(); return { disabled: button.disabled, tabIndex: button.tabIndex, width: rect.width, height: rect.height, name: button.textContent.trim() }; })()`);
assert.equal(desktopControl.disabled, false, 'recovery action remains enabled when email is empty so it can explain the requirement');
assert.ok(desktopControl.tabIndex >= 0 && desktopControl.height >= 44, 'desktop recovery action is keyboard reachable with an adequate target');

await evaluate(`(${recoveryButtonExpression}).focus()`);
assert.ok(await evaluate("document.activeElement?.textContent.includes('Forgot personal password')"), 'recovery action receives keyboard focus');
await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', code: 'Enter', text: '\r', unmodifiedText: '\r' });
await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await waitFor("document.body.innerText.includes('Enter your personal account email first.')", 'keyboard missing-email feedback');
assert.equal(recoveryRequests, 0, 'missing email does not call Auth recovery');

const setEmail = value => evaluate(`(() => { const field = document.querySelector('#doctor-account-email'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(field, ${JSON.stringify(value)}); field.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const clickRecovery = async () => {
  const center = await evaluate(`(() => { const rect = (${recoveryButtonExpression}).getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: center.x, y: center.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: center.x, y: center.y, button: 'left', clickCount: 1 });
};

await setEmail('not-an-email');
await clickRecovery();
await waitFor("document.body.innerText.includes('Enter a valid personal account email')", 'invalid-email feedback');
assert.equal(recoveryRequests, 0, 'invalid email does not call Auth recovery');

await setEmail('synthetic@example.invalid');
await clickRecovery();
await waitFor("document.body.innerText.includes('If a personal account exists for this email')", 'non-enumerating recovery result');
assert.equal(recoveryRequests, 1, 'one valid mouse activation creates exactly one recovery request');
assert.ok(await evaluate(`(${recoveryButtonExpression}).disabled && (${recoveryButtonExpression}).textContent.includes('Reset available in')`), 'cooldown is visible and disables duplicate activation');
await evaluate(`(${recoveryButtonExpression}).click()`);
await new Promise(resolve => setTimeout(resolve, 300));
assert.equal(recoveryRequests, 1, 'cooldown prevents a duplicate recovery request');

await send('Emulation.setDeviceMetricsOverride', { width: 500, height: 900, deviceScaleFactor: 1, mobile: true });
await send('Page.navigate', { url: 'about:blank' });
await waitFor("location.href === 'about:blank'", 'mobile blank test document');
await send('Page.navigate', { url: `${appBase}/#/doctor/login` });
await waitFor(`Boolean(${recoveryButtonExpression})`, 'mobile recovery control');
const mobileControl = await evaluate(`(() => { const button = ${recoveryButtonExpression}; const rect = button.getBoundingClientRect(); return { disabled: button.disabled, tabIndex: button.tabIndex, top: rect.top, bottom: rect.bottom, height: rect.height }; })()`);
assert.equal(mobileControl.disabled, false, 'mobile recovery action remains interactive before email entry');
assert.ok(mobileControl.tabIndex >= 0 && mobileControl.height >= 44 && mobileControl.top >= 0 && mobileControl.bottom <= 900, '500px recovery action is reachable with an adequate target');

const emitted = browserMessages.join('\n');
assert.ok(!emitted.includes('synthetic-access') && !emitted.includes('synthetic-refresh') && !emitted.includes('synthetic-new-password'), 'browser logs contain no recovery credentials or password');

socket.close();
console.log('synthetic password recovery browser journey passed (23 checks)');
