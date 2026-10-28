import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';
import { extendedCssAdapter, reuseExtendedCssTracker } from '../scripts/extended-css-adapter.mjs';

const modulePath = fileURLToPath(import.meta.resolve('@adguard/extended-css'));
const source = await readFile(modulePath, 'utf8');

function realm(input: string) {
  const handlers = new Map<string, Set<Function>>();
  const counts = { adds: 0, removes: 0, schedules: 0, callbacks: 0, disconnects: 0 };
  const root = {
    addEventListener(type: string, callback: Function) {
      counts.adds++;
      const registered = handlers.get(type) ?? new Set<Function>();
      registered.add(callback); handlers.set(type, registered);
    },
    removeEventListener(type: string, callback: Function) {
      counts.removes++;
      handlers.get(type)?.delete(callback);
    },
  };
  let callback: ((records: { type: string }[]) => void) | undefined;
  const observers: { childList: boolean; subtree: boolean; attributes: boolean; attributeFilter: string[] }[] = [];
  class Observer {
    constructor(handler: typeof callback) { callback = handler; }
    observe(_node: unknown, options: typeof observers[number]) { observers.push(options); }
    disconnect() { counts.disconnects++; }
  }
  const script = input.slice(input.indexOf('const LAST_EVENT_TIMEOUT_MS ='), input.indexOf('const CONTENT_ATTR_PREFIX_REGEXP ='));
  assert(script.includes('function observeDocument(context)') && script.includes('function disconnectDocument(context)'));
  const sandbox = vm.createContext({
    document: { documentElement: root },
    natives: { MutationObserver: Observer }, isSafariBrowser: false,
    _defineProperty: (value: object, key: string, entry: unknown) => Reflect.set(value, key, entry),
  });
  vm.runInContext(`${script}\nglobalThis.lifecycle = { observeDocument, disconnectDocument };`, sandbox);
  const context: { scheduler: { run(): void }; eventTracker?: unknown } = {
    scheduler: { run() { counts.schedules++; } },
  };
  return {
    counts, observers,
    connect() { sandbox.lifecycle.observeDocument(context); },
    disconnect() { sandbox.lifecycle.disconnectDocument(context); },
    mutate(type = 'childList') { counts.callbacks++; callback?.([{ type }]); },
    empty() { callback?.([]); },
    dispatch(type: string) { for (const handler of handlers.get(type) ?? []) Reflect.apply(handler, root, [{ type }]); },
    active() { return [...handlers.values()].reduce((sum, entries) => sum + entries.size, 0); },
  };
}

test('ExtendedCss patch preserves scheduling and observers while avoiding duplicate tracker creation within a burst', () => {
  const original = realm(source);
  const patched = realm(reuseExtendedCssTracker(source));
  for (const fixture of [original, patched]) {
    fixture.connect();
    fixture.empty();
    assert.equal(fixture.counts.schedules, 0);
    for (let index = 0; index < 1000; index++) {
      fixture.mutate(index % 2 ? 'attributes' : 'childList');
      fixture.dispatch(index % 2 ? 'mouseover' : 'click');
    }
    assert.equal(fixture.counts.schedules, 1000);
    assert.equal(fixture.active(), 18);
    assert.deepEqual(JSON.parse(JSON.stringify(fixture.observers[0])), {
      childList: true, subtree: true, attributes: true, attributeFilter: ['id', 'class'],
    });
    fixture.disconnect();
    assert.equal(fixture.active(), 0);
  }
  assert.equal(original.counts.adds, 18000);
  assert.equal(patched.counts.adds, 18);
  assert.equal(original.counts.removes, patched.counts.removes);
});

test('ExtendedCss tracker reconnects after every apply and disconnect remains idempotent', () => {
  const fixture = realm(reuseExtendedCssTracker(source));
  for (let cycle = 0; cycle < 5; cycle++) {
    fixture.connect(); fixture.connect();
    fixture.mutate(); fixture.mutate('attributes');
    assert.equal(fixture.active(), 18);
    fixture.disconnect(); fixture.disconnect();
    assert.equal(fixture.active(), 0);
  }
  assert.equal(fixture.counts.adds, 90);
  assert.equal(fixture.counts.removes, 90);
  assert.equal(fixture.counts.schedules, 10);
  assert.equal(fixture.counts.disconnects, 5);
});

test('ExtendedCss adapter verifies dependency provenance, applies only to its owned module and fails closed on drift', async () => {
  const adapter = await extendedCssAdapter();
  assert.equal(adapter.metadata.version, '2.2.0');
  assert.throws(() => adapter.verify(), /not included/);
  assert.equal(adapter.plugin.load(`${modulePath}.other`), null);
  assert.equal(adapter.plugin.load(modulePath)?.code, reuseExtendedCssTracker(source));
  adapter.verify();
  assert.throws(() => reuseExtendedCssTracker(source.replace('    const eventTracker = new EventTracker();', 'changed')), /construction/);
  assert.throws(() => reuseExtendedCssTracker(`${source}\n    context.eventTracker.stopTracking();`), /cleanup/);
});
