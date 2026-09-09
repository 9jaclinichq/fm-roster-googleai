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

const emitted = browserMessages.join('\n');
assert.ok(!emitted.includes('synthetic-access') && !emitted.includes('synthetic-refresh') && !emitted.includes('synthetic-new-password'), 'browser logs contain no recovery credentials or password');

socket.close();
console.log('synthetic password recovery browser journey passed (10 checks)');
