import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

// Exercise the extension-owned content entry point in isolation. The pinned native
// AdGuard import is covered separately by real browser integration tests.
const source = stripTypeScriptTypes(readFileSync(new URL('../src/content.ts', import.meta.url), 'utf8')
  .replace(/^import[^\n]*\n/gm, ''));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function contentHarness(framed = false) {
  type Message = { type: string; rule?: string };
  type Listener = (message: Message, sender: object, reply: (value: unknown) => void) => unknown;
  const requests: Message[] = [];
  let respond: (message: Message) => Promise<unknown> = async () => ({ enabled: true });
  let listener: Listener | undefined;
  let storageListeners = 0;
  const pageListeners = new Map<string, Set<unknown>>();
  const appended: FakeElement[] = [];
  class FakeElement {
    style: Record<string, unknown> = {};
    dataset: Record<string, string> = {};
    hidden = false;
    disabled = false;
    value = '';
    textContent = '';
    isConnected = true;
    handlers = new Map<string, () => void>();
    shadow: { innerHTML: string; querySelector: (selector: string) => FakeElement } | undefined;
    setAttribute() {}
    hasAttribute() { return false; }
    closest() { return null; }
    focus() {}
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 20 }; }
    addEventListener(name: string, fn: () => void) { this.handlers.set(name, fn); }
    remove() { this.isConnected = false; }
    attachShadow() { return this.shadow = shadow; }
    querySelector() { return fields.get('.cancel')!; }
  }
  const fields = new Map(['.mark', '.panel', 'input', 'label', '.preview', '.error', '.save', '.cancel', '.instruction']
    .map(selector => [selector, new FakeElement()]));
  const shadow = { innerHTML: '', querySelector: (selector: string) => fields.get(selector)! };
  const target = new FakeElement();
  const page: Record<string, unknown> = {
    addEventListener(name: string, fn: unknown) { const listeners = pageListeners.get(name) ?? new Set(); listeners.add(fn); pageListeners.set(name, listeners); },
    removeEventListener(name: string, fn: unknown) { pageListeners.get(name)?.delete(fn); },
  };
  page.top = framed ? {} : page;
  const documentElement = new FakeElement();
  Object.assign(documentElement, { append(element: FakeElement) { appended.push(element); } });
  const context = createContext({
    window: page, location: { hostname: 'ordinary.example.test' },
    document: { documentElement, activeElement: null, createElement: () => new FakeElement(), querySelectorAll: () => [target] },
    HTMLElement: FakeElement, requestAnimationFrame: () => 1, cancelAnimationFrame() {},
    chrome: {
      runtime: { onMessage: { addListener(fn: Listener) { listener = fn; } } },
      storage: { onChanged: { addListener() { storageListeners++; } } },
    },
    async request(message: Message) { requests.push(message); return respond(message); },
  });
  runInContext(source, context);
  return {
    requests, fields, appended, pageListeners,
    get storageListeners() { return storageListeners; },
    get hasOwnListener() { return !!listener; },
    respond(fn: typeof respond) { respond = fn; },
    async start() {
      const reply = deferred<{ ok: boolean; error?: string }>();
      assert.equal(listener!({ type: 'picker:start' }, {}, value => reply.resolve(value as { ok: boolean })), true);
      return reply.promise;
    },
    policyChanged() { listener?.({ type: 'config:refresh' }, {}, () => {}); },
    click(selector: string) { fields.get(selector)!.handlers.get('click')!(); },
  };
}

async function flush() { await new Promise(resolve => setImmediate(resolve)); }

test('ordinary top-level documents and descendant frames do not request picker policy or subscribe to settings', async () => {
  const top = contentHarness();
  assert(top.hasOwnListener);
  top.policyChanged();
  await flush();
  assert.deepEqual(top.requests, []);
  assert.equal(top.storageListeners, 0);
  const child = contentHarness(true);
  assert.equal(child.hasOwnListener, false);
  assert.equal(child.storageListeners, 0);
  assert.deepEqual(child.requests, []);
});

test('picker authorization is fresh on every manual start and failed authorization does not use stale state', async () => {
  const h = contentHarness();
  assert.equal((await h.start()).ok, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.appended.filter(element => element.isConnected).length, 1);
  h.respond(async () => ({ enabled: false }));
  const denied = await h.start();
  assert.equal(denied.ok, false);
  assert.match(denied.error!, /bật bảo vệ/);
  assert.equal(h.requests.length, 2);
  assert.equal(h.appended.filter(element => element.isConnected).length, 0);
  h.respond(async () => { throw new Error('Extension context invalidated'); });
  const failed = await h.start();
  assert.equal(failed.ok, false);
  assert.match(failed.error!, /Extension context invalidated/);
  assert.equal(h.appended.filter(element => element.isConnected).length, 0);
});

test('a policy change during pending picker authorization is rechecked before opening the picker', async () => {
  const h = contentHarness();
  const pending = deferred<{ enabled: boolean }>();
  h.respond(async () => h.requests.length === 1 ? pending.promise : { enabled: false });
  const start = h.start();
  h.policyChanged();
  pending.resolve({ enabled: true });
  assert.equal((await start).ok, false);
  assert.equal(h.requests.length, 2);
  assert.equal(h.appended.length, 0);
});

test('policy changes close an active picker and release all page interaction listeners', async () => {
  const h = contentHarness();
  assert.equal((await h.start()).ok, true);
  assert.equal([...h.pageListeners.values()].filter(listeners => listeners.size).length, 5);
  h.respond(async () => ({ enabled: false }));
  h.policyChanged();
  await flush();
  assert.equal(h.appended.filter(element => element.isConnected).length, 0);
  assert.equal([...h.pageListeners.values()].flatMap(listeners => [...listeners]).length, 0);
  const count = h.requests.length;
  h.policyChanged();
  await flush();
  assert.equal(h.requests.length, count, 'An inactive page returns to zero policy requests');
});

test('a saved rule uses its submitted selector, rechecks policy, and releases temporary styles on disable', async () => {
  const h = contentHarness();
  assert.equal((await h.start()).ok, true);
  const saved = deferred<null>();
  h.respond(async message => message.type === 'addUserRule' ? saved.promise : { enabled: true });
  h.fields.get('input')!.value = '.submitted-ad';
  h.click('.save');
  h.fields.get('input')!.value = '.edited-after-submission';
  saved.resolve(null);
  await flush();
  assert.deepEqual(h.requests.map(message => ({ ...message })), [
    { type: 'contentConfig' }, { type: 'addUserRule', rule: 'ordinary.example.test##.submitted-ad' }, { type: 'contentConfig' },
  ]);
  const style = h.appended.find(element => element.textContent)!;
  assert.equal(style.textContent, '.submitted-ad{display:none!important}');
  h.respond(async () => ({ enabled: false }));
  h.policyChanged();
  await flush();
  assert.equal(style.isConnected, false);
});

test('disabling protection while a rule save is pending cannot reinsert a temporary style', async () => {
  const h = contentHarness();
  assert.equal((await h.start()).ok, true);
  const saved = deferred<null>();
  h.respond(async message => message.type === 'addUserRule' ? saved.promise : { enabled: false });
  h.fields.get('input')!.value = '.submitted-ad';
  h.click('.save');
  h.policyChanged();
  await flush();
  saved.resolve(null);
  await flush();
  assert.equal(h.appended.filter(element => element.isConnected).length, 0);
  assert.equal(h.appended.some(element => element.textContent), false);
});
