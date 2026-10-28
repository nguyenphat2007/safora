import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
const root = fileURLToPath(new URL('../', import.meta.url));
const target = join(root, 'release/chrome-webstore');
const assets = join(root, 'store/assets');
const caches = join(homedir(), 'Library/Caches/ms-playwright');
const revisions = (await readdir(caches)).filter(name => /^chromium-\d+$/.test(name)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
const executablePath = process.env.CHROMIUM_PATH || join(caches, revisions[0], 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const profile = await mkdtemp(join(tmpdir(), 'safora-webstore-'));
let hits = 0, context, failure;
const results = [], errors = [];
const server = createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Cache-Control', 'no-store');
  if (request.url.startsWith('/probe.js')) { hits++; response.setHeader('Content-Type', 'application/javascript'); response.end('window.fixtureScript=true;'); }
  else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Safora test</title><h1>Website fixture</h1><div class="fixture-ad">Fixture ad</div>'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port, origin = `http://site.example.test:${port}`;
function pass(message) { results.push(message); console.log('PASS', message); }
try {
  await mkdir(assets, { recursive: true });
  context = await chromium.launchPersistentContext(profile, { executablePath, headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging', '--no-proxy-server', '--host-resolver-rules=MAP *.example.test 127.0.0.1, MAP resourcelow.com 127.0.0.1, MAP raw.githubusercontent.com ~NOTFOUND'], viewport: { width: 1280, height: 800 } });
  context.setDefaultTimeout(90000);
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: target }); await cdp.detach();
  const ui = await context.newPage(); ui.on('pageerror', error => errors.push(String(error)));
  await ui.goto(`chrome-extension://${id}/options.html`);
  const send = async message => {
    const reply = await ui.evaluate(message => Promise.race([chrome.runtime.sendMessage(message), new Promise((_, reject) => setTimeout(() => reject(new Error('RPC timeout')), 90000))]), message);
    assert(reply?.ok, JSON.stringify(reply)); return reply.data;
  };
  const state = await send({ type: 'state', includeLogs: false });
  const compact = await send({ type: 'state', scope: 'popup', includeLogs: false });
  assert.deepEqual(Object.keys(compact.settings).sort(), ['enabled', 'theme']);
  assert(!('logs' in compact) && !('engine' in compact) && !('updates' in compact));
  assert.equal(state.settings.logging, false);
  assert.deepEqual((await send({ type: 'state' })).logs, []);
  assert.equal(state.countMode, 'native'); assert(state.engine.packagedNetworkRules > 200000); assert.deepEqual(state.engine.warnings, []);
  const manifest = await ui.evaluate(() => chrome.runtime.getManifest());
  assert(!manifest.permissions.includes('privacy')); assert(!manifest.permissions.includes('declarativeNetRequestFeedback')); assert(!manifest.permissions.includes('tabs'));
  pass('Store manifest without tabs/privacy/debug-feedback starts the full engine without recovery warnings');
  await send({ type: 'settings', patch: { theme: 'dark', userRules: 'site.example.test##.fixture-ad' } });
  const site = await context.newPage(); await site.goto(origin);
  await site.waitForFunction(() => getComputedStyle(document.querySelector('.fixture-ad')).display === 'none');
  assert(await site.evaluate(url => fetch(url).then(() => false, () => true), `http://resourcelow.com:${port}/probe.js`));
  assert.equal(hits, 0);
  assert(await site.evaluate(url => fetch(url).then(() => true, () => false), `${origin}/probe.js`)); assert.equal(hits, 1);
  pass('Static advertising request is blocked before server, cosmetic rule hides its target and ordinary request succeeds');
  const popup = await context.newPage(); popup.on('pageerror', error => errors.push(String(error)));
  await popup.setViewportSize({ width: 390, height: 600 });
  await popup.goto(`chrome-extension://${id}/popup.html`); await site.bringToFront(); await popup.reload();
  await popup.waitForFunction(() => document.querySelector('#site-toggle').getAttribute('aria-checked') === 'true');
  assert.equal(await popup.locator('#site-host').innerText(), 'site.example.test');
  assert.equal(await popup.locator('#site-host').getAttribute('title'), 'site.example.test');
  assert.equal(await popup.locator('#site-toggle').isEnabled(), true);
  assert.equal(await popup.locator('#popup-stats').isVisible(), false);
  assert.equal(await popup.locator('#statistics-tab').isVisible(), false);
  assert(await popup.locator('#native-count-note').isVisible());
  assert.equal(await popup.locator('#statistics-data').isVisible(), false);
  pass('Store popup reads current website through host access without tabs permission, uses native badge and hides unavailable request history');
  await Promise.all([site.waitForEvent('load'), popup.locator('#site-toggle').click()]);
  await site.waitForFunction(() => getComputedStyle(document.querySelector('.fixture-ad')).display !== 'none');
  assert(await site.evaluate(url => fetch(url).then(() => true, () => false), `http://resourcelow.com:${port}/probe.js`)); assert.equal(hits, 2);
  await popup.waitForFunction(() => !document.querySelector('#site-toggle').disabled && document.querySelector('#site-toggle').getAttribute('aria-checked') === 'false');
  await Promise.all([site.waitForEvent('load'), popup.locator('#site-toggle').click()]);
  await site.waitForFunction(() => getComputedStyle(document.querySelector('.fixture-ad')).display === 'none');
  pass('Real site toggle and reload disable and restore protection in the store profile');
  await ui.goto(`chrome-extension://${id}/options.html#log`);
  await ui.waitForFunction(() => !document.querySelector('#section-log').hidden && !document.querySelector('#logging-toggle').disabled);
  assert.equal(await ui.locator('#logging-toggle').isChecked(), false);
  await ui.locator('#logging-toggle').check();
  await ui.waitForFunction(async () => (await chrome.runtime.sendMessage({ type: 'state', includeLogs: false })).data?.settings.logging === true);
  await site.reload();
  await site.waitForFunction(() => getComputedStyle(document.querySelector('.fixture-ad')).display === 'none');
  await ui.waitForFunction(async () => {
    const reply = await chrome.runtime.sendMessage({ type: 'state' });
    return reply.data?.logs.some(entry => entry.kind === 'cosmetic' && entry.rule.includes('.fixture-ad'));
  }, null, { timeout: 20000 });
  await ui.waitForFunction(async () => (await chrome.storage.session.get('logs')).logs?.length > 0);
  await ui.locator('#logging-toggle').uncheck();
  await ui.waitForFunction(async () => {
    const reply = await chrome.runtime.sendMessage({ type: 'state' });
    return reply.data?.settings.logging === false && reply.data.logs.length === 0;
  });
  assert.deepEqual((await ui.evaluate(() => chrome.storage.session.get('logs'))).logs, []);
  pass('Diagnostics default off; enabling through the UI records a real cosmetic fixture hit; disabling clears both live and session logs');
  await ui.goto(`chrome-extension://${id}/options.html#privacy`);
  await ui.waitForFunction(() => !document.querySelector('#section-privacy').hidden);
  const policyLink = ui.locator('#privacy-policy-link');
  assert(await policyLink.isVisible());
  const policyUrl = await policyLink.evaluate(link => link.href);
  assert.equal(policyUrl, `chrome-extension://${id}/privacy-policy.html`);
  const canonicalPolicy = await readFile(join(root, 'store/privacy-policy.html'));
  assert.deepEqual(await readFile(join(target, 'privacy-policy.html')), canonicalPolicy);
  const policy = await context.newPage();
  const policyRequests = [];
  policy.on('pageerror', error => errors.push(String(error)));
  policy.on('request', request => policyRequests.push(request.url()));
  await policy.goto(policyUrl);
  const policyText = await policy.locator('body').innerText();
  for (const [topic, pattern] of [
    ['collection', /thu thập|tiếp cận/i], ['use', /sử dụng|xử lý/i],
    ['storage', /lưu trữ/i], ['sharing', /chia sẻ/i], ['contact', /liên hệ/i],
  ]) assert(pattern.test(policyText), `Privacy policy must explain ${topic}`);
  assert(await policy.locator('a[href^="mailto:"]').first().isVisible());
  assert.equal(await policy.locator('script').count(), 0);
  assert(policyRequests.every(url => url.startsWith(`chrome-extension://${id}/`)), JSON.stringify(policyRequests));
  await policy.close();
  pass('Visible local privacy-policy link opens the exact canonical policy with collection/use/storage/sharing/contact, no scripts and no external page requests');
  await send({ type: 'settings', patch: { userRules: '' } });
  // Start screenshots from a fresh UI so earlier diagnostic feedback is not in the store listing.
  await ui.reload();
  await ui.goto(`chrome-extension://${id}/options.html#filters`);
  await ui.waitForFunction(() => !document.querySelector('#section-filters').hidden && document.querySelectorAll('#section-filters input[data-group]').length === 5);
  assert.deepEqual(await ui.locator('#section-filters input[data-group]').evaluateAll(inputs => inputs.map(input => input.dataset.group).sort()), ['ads', 'annoyances', 'privacy', 'security', 'vietnam']);
  await ui.screenshot({ path: join(assets, 'filters-1280x800.png') });
  await ui.goto(`chrome-extension://${id}/options.html#dashboard`);
  await ui.waitForFunction(() => !document.querySelector('#section-dashboard').hidden);
  await ui.screenshot({ path: join(assets, 'protection-1280x800.png') });
  await writeFile(join(assets, 'icon-128.png'), await readFile(join(target, 'icons/128.png')));
  assert.deepEqual(errors, []);
  pass('Two 1280x800 screenshots capture actual store-profile settings; no extension-page JavaScript errors');
} catch (error) { failure = error; console.error(error); }
finally {
  await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true });
  await writeFile(join(root, 'release/webstore-browser-report.json'), JSON.stringify({ version: JSON.parse(await readFile(join(root, 'dist/manifest.json'), 'utf8')).version, scope: 'Unpacked store manifest without debug permission; not a signed Web Store installation or Google review', results, errors, failure: failure ? String(failure.stack || failure) : null, profileRemoved: true }, null, 2));
}
if (failure) process.exitCode = 1;
