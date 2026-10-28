import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createBatchedPersistence, type PersistenceBatch } from '../src/shared/persistence.ts';

function harness(write: (batch: PersistenceBatch) => Promise<void>) {
  const timers: { run: () => void; delay: number }[] = [];
  const errors: unknown[] = [];
  const writer = createBatchedPersistence({ write, report: error => errors.push(error), schedule: (run, delay) => { timers.push({ run, delay }); } });
  return { writer, timers, errors, async tick() {
    const timer = timers.shift(); assert.ok(timer);
    timer.run(); await new Promise(resolve => setImmediate(resolve));
    return timer.delay;
  } };
}

test('one burst writes one batch and leaves no timer when idle', async () => {
  const batches: PersistenceBatch[] = [];
  const h = harness(async batch => { batches.push(batch); });
  for (let index = 0; index < 1000; index++) h.writer.mark(index % 3, index === 999);
  h.writer.forgetTab(2);
  assert.equal(h.timers.length, 1);
  assert.equal(await h.tick(), 1000);
  assert.deepEqual(batches, [{ tabs: [0, 1], network: true }]);
  assert.equal(h.timers.length, 0);
});

test('failed storage write retries unsaved network batch without another event', async () => {
  const batches: PersistenceBatch[] = [];
  const h = harness(async batch => { batches.push(batch); if (batches.length === 1) throw new Error('temporary storage error'); });
  h.writer.mark(7, true);
  await h.tick();
  assert.equal(h.errors.length, 1);
  assert.equal(h.timers.length, 1);
  await h.tick();
  assert.deepEqual(batches, [{ tabs: [7], network: true }, { tabs: [7], network: true }]);
  assert.equal(h.timers.length, 0);
});

test('changes arriving during a failed write merge into retry instead of being lost', async () => {
  let reject!: (error: Error) => void;
  const batches: PersistenceBatch[] = [];
  const h = harness(async batch => {
    batches.push(batch);
    if (batches.length === 1) await new Promise<void>((_resolve, no) => { reject = no; });
  });
  h.writer.mark(1);
  await h.tick();
  h.writer.mark(2, true);
  assert.equal(h.timers.length, 0);
  reject(new Error('session storage unavailable'));
  await new Promise(resolve => setImmediate(resolve));
  await h.tick();
  assert.deepEqual(batches[1], { tabs: [2, 1], network: true });
  assert.equal(h.timers.length, 0);
});

test('changes arriving during a successful write receive a second batch', async () => {
  let finish!: () => void;
  const batches: PersistenceBatch[] = [];
  const h = harness(async batch => {
    batches.push(batch);
    if (batches.length === 1) await new Promise<void>(resolve => { finish = resolve; });
  });
  h.writer.mark(1, true);
  await h.tick();
  h.writer.mark(2);
  finish(); await new Promise(resolve => setImmediate(resolve));
  await h.tick();
  assert.deepEqual(batches, [{ tabs: [1], network: true }, { tabs: [2], network: false }]);
});

test('permanent failure has bounded backoff then sleeps until a real event resumes persistence', async () => {
  let attempts = 0; let unavailable = true;
  const h = harness(async () => { attempts++; if (unavailable) throw new Error('storage full'); });
  h.writer.mark(8, true);
  const delays: number[] = [];
  while (h.timers.length) delays.push(await h.tick());
  assert.equal(attempts, 6);
  assert.deepEqual(delays, [1000, 1000, 2000, 4000, 8000, 16000]);
  unavailable = false;
  h.writer.mark(9);
  assert.equal(await h.tick(), 1000);
  assert.equal(attempts, 7);
  assert.equal(h.timers.length, 0);
});

test('background wiring retries actual local/session persistence and badge batch after temporary failure', async () => {
  const source = readFileSync(new URL('../src/background.ts', import.meta.url), 'utf8');
  const fragment = source.slice(source.indexOf('const persistence ='), source.indexOf('function blankTab'));
  assert.ok(fragment.length > 0);
  const timers: (() => void)[] = [];
  let attempts = 0; let sessionWrites = 0; let badgeWrites = 0;
  let stored: unknown;
  const context = {
    createBatchedPersistence: (dependencies: Parameters<typeof createBatchedPersistence>[0]) => createBatchedPersistence({ ...dependencies, schedule: callback => { timers.push(callback); } }),
    serial: (job: () => Promise<void>) => job(),
    console: { error: () => undefined }, errorText: String,
    chrome: { storage: { local: { set: async (value: unknown) => {
      attempts++; if (attempts === 1) throw new Error('temporary write failure'); stored = value;
    } } } },
    total: 4, HISTORY_KEY: 'history', history: { days: [{ date: '2026-10-24' }] },
    persistSession: async () => { sessionWrites++; },
    badge: async () => { badgeWrites++; },
  };
  runInNewContext(stripTypeScriptTypes(fragment) + ';scheduleFlush(3,true);', context);
  timers.shift()!(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(attempts, 1); assert.equal(sessionWrites, 0); assert.equal(timers.length, 1);
  timers.shift()!(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(stored)), { total: 4, history: context.history });
  assert.equal(attempts, 2); assert.equal(sessionWrites, 1); assert.equal(badgeWrites, 1); assert.equal(timers.length, 0);
});

test('navigation bursts batch session writes while updating badges immediately and retaining final tab state', async () => {
  const source = readFileSync(new URL('../src/background.ts', import.meta.url), 'utf8');
  const fragment = source.slice(source.indexOf('chrome.webNavigation.onBeforeNavigate.addListener'), source.indexOf("if (chrome.runtime.getManifest().permissions"));
  let navigate!: (details: { tabId: number; frameId: number; url: string }) => void;
  let writes = 0; let badges = 0;
  let chain = Promise.resolve();
  const timers: (() => void)[] = [];
  const tabStats: Record<number, unknown> = {};
  const writer = createBatchedPersistence({ write: async () => { writes++; }, report: error => { throw error; }, schedule: callback => { timers.push(callback); } });
  const context = {
    ready: Promise.resolve(), serial: (job: () => Promise<void>) => { chain = chain.then(job); return chain; },
    badgeCache: new Map(), tabStats, logs: [], persistence: writer,
    scheduleFlush: writer.mark, persistSession: async () => { writes++; }, badge: async () => { badges++; },
    blankTab: (host: string) => ({ host, network: 0, cosmetic: 0 }), hostname: (url: string) => new URL(url).hostname,
    console, chrome: { webNavigation: { onBeforeNavigate: { addListener: (callback: typeof navigate) => { navigate = callback; } } }, tabs: { onRemoved: { addListener: () => {} }, onUpdated: { addListener: () => {} } } },
  };
  runInNewContext(stripTypeScriptTypes(fragment), context);
  for (let i = 0; i < 100; i++) navigate({ tabId: i % 10, frameId: 0, url: `https://page${i}.example/` });
  await chain;
  assert.equal(badges, 100);
  assert.equal(writes, 0);
  assert.equal(timers.length, 1);
  timers.shift()!(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(writes, 1); assert.equal(Object.keys(tabStats).length, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(tabStats[9])), { host: 'page99.example', network: 0, cosmetic: 0 });
});
