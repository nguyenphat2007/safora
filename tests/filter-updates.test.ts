import assert from 'node:assert/strict';
import test from 'node:test';
import { FilterList } from '@adguard/tsurlfilter';
import { Filter, FilterConverter } from '@adguard/dnr-converter';
import { createFilterUpdater, ensureUpdateAlarm, ALARM_NAME, UPDATE_SOURCE_URL } from '../src/filter-updates.ts';

const START = 1_800_000_000_000;
const HOUR = 3_600_000;
function list(rule = '||ads.example.test^', version = '1'): string {
  return `! Title: uBlock₀ filters – Quick fixes\n! Version: ${version}\n! Expires: 8 hours\n! License: https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE\n${rule}\n`;
}

function harness() {
  const data: Record<string, unknown> = {};
  let time = START;
  let response = () => Promise.resolve(new Response(list(), { headers: { ETag: '"v1"', 'Last-Modified': 'Wed, 01 Oct 2025 00:00:00 GMT' } }));
  let writeFailures = 0;
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const applied: string[][] = [];
  const storage = {
    async get(key: string) { return structuredClone({ [key]: data[key] }); },
    async set(items: Record<string, unknown>) {
      if (writeFailures > 0) { writeFailures--; throw new Error('storage write failed'); }
      Object.assign(data, structuredClone(items));
    },
  };
  const fetcher = (async (url, init) => {
    requests.push({ url: String(url), init });
    return response();
  }) as typeof fetch;
  const fresh = () => createFilterUpdater({ storage, fetch: fetcher, now: () => time });
  return {
    data, requests, applied, fresh, updater: fresh(),
    apply: async (rules: string[]) => { applied.push(rules); },
    clock(value: number) { time = value; },
    respond(next: () => Promise<Response>) { response = next; },
    failWrites(count = 1) { writeFailures = count; },
  };
}

test('fresh installs retain packaged filtering and wait for the first fixes snapshot', async () => {
  const h = harness();
  const state = await h.updater.loadUpdateState();
  assert.equal(state.status, 'never');
  assert.equal(state.sourceUrl, UPDATE_SOURCE_URL);
  assert.equal(state.lastUpdated, null);
  assert.deepEqual(await h.updater.getActiveUpdateRules(), []);
  assert.equal(h.requests.length, 0);
});

test('validated text applies before commit, resolves conditional directives and excludes remote scriptlet arguments', async () => {
  const h = harness();
  const body = list('!#if env_chromium\nexample.test#%#//scriptlet(\'set-constant\', \'ads\', \'false\')\n!#endif\n@@||ads.example.test^$domain=allowed.test');
  h.respond(async () => new Response(body));
  const state = await h.updater.checkFilterUpdates(false, h.apply);
  assert.equal(state.status, 'updated');
  assert.equal(state.ruleCount, 1);
  assert.equal(state.skippedRules, 1);
  assert.equal(state.lastChecked, START);
  assert.equal(state.lastUpdated, START);
  assert.equal(state.nextCheck, START + 8 * HOUR);
  assert.match(state.sha256, /^[a-f0-9]{64}$/);
  assert.equal(h.applied.length, 1);
  assert.ok(h.applied[0]!.includes('! if env_chromium'));
  const init = h.requests[0]!.init!;
  assert.equal(h.requests[0]!.url, UPDATE_SOURCE_URL);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal instanceof AbortSignal);
  const active = await h.fresh().getActiveUpdateRules();
  assert.equal(active.length, body.split('\n').length);
  assert.ok(active.some(line => line.startsWith('! REA skipped line')));
  assert.ok(!active.some(line => !line.startsWith('!') && line.includes('//scriptlet(')));
});

test('inactive raw JavaScript and rules never enter the sanitizer or installed-rule count', async () => {
  const h = harness();
  const body = list('!#if !env_mv3\nexample.test#%#alert(document.cookie)\n||inactive.test^\n!#else\n||active.test^\n!#endif');
  h.respond(async () => new Response(body));
  const state = await h.updater.checkFilterUpdates(true, h.apply);
  assert.equal(state.status, 'updated');
  assert.equal(state.ruleCount, 1);
  assert.equal(state.skippedRules, 0);
  const active = await h.fresh().getActiveUpdateRules();
  assert.deepEqual(active.filter(line => line && !line.startsWith('!')), ['||active.test^']);
  assert.equal(active.length, body.split('\n').length);
});

test('scheduled checks honor expiry while manual checks revalidate unchanged content without reapplying', async () => {
  const h = harness();
  await h.updater.checkFilterUpdates(false, h.apply);
  h.clock(START + HOUR);
  await h.updater.checkFilterUpdates(false, h.apply);
  assert.equal(h.requests.length, 1);
  const next = await h.updater.checkFilterUpdates(true, h.apply);
  assert.equal(next.status, 'unchanged');
  assert.equal(next.lastUpdated, START);
  assert.equal(next.lastChecked, START + HOUR);
  assert.equal(h.applied.length, 1);
  assert.equal(h.requests.length, 2);
});

test('remote subset excludes HTML, response bodies and every remote scriptlet with visible diagnostics', async () => {
  const h = harness();
  const safeException = '@@||safe.example.test^$script';
  const body = list([
    '!#if env_chromium',
    'example.test##^script:has-text(adblock)',
    '||example.test^$replace=/old/new/',
    'example.test##+js(trusted-rpnt, script, old, new)',
    'example.test##+js(rpnt, script, old, new)',
    'example.test#%#//scriptlet("trusted-set-constant", "adblock", "false")',
    safeException,
    'example.test##+js(json-prune, adPlacements)',
    'example.test##.banner-ads',
    '!#endif',
  ].join('\n'));
  h.respond(async () => new Response(body));
  const state = await h.updater.checkFilterUpdates(true, h.apply);
  assert.equal(state.status, 'updated');
  assert.equal(state.skippedRules, 6);
  assert.equal(state.ruleCount, 2);
  assert.match(state.warning!, /chỉ áp dụng tập con mạng và CSS an toàn/);
  const rules = await h.updater.getActiveUpdateRules();
  assert.equal(rules.filter(line => line.startsWith('! REA skipped line')).length, 6);
  assert.ok(rules.includes(safeException));
  assert.ok(!rules.includes('example.test##+js(json-prune, adPlacements)'));
  assert.equal(rules.length, body.split('\n').length);
  assert.deepEqual(await h.fresh().getActiveUpdateRules(), rules);
});

test('malformed scriptlet syntax fails closed rather than broadening or dropping the rule', async () => {
  const h = harness();
  h.respond(async () => new Response(list('example.test#%#//scriptlet("set-constant", "x",')));
  const state = await h.updater.checkFilterUpdates(true, h.apply);
  assert.equal(state.status, 'error');
  assert.match(state.error!, /Quy tắc nguồn không hợp lệ/);
  assert.equal(h.applied.length, 0);
});

test('unsupported native modifiers and MV3 capabilities omit whole original rules, including exceptions', async () => {
  const h = harness();
  const rejected = [
    '||strict.example.test^$strict3p',
    '||transform.example.test^$uritransform=/old/new/',
    '||popup.example.test^$popup',
    '@@||exception.example.test^$strict3p',
    'example.test##.card:others()',
  ];
  h.respond(async () => new Response(list([...rejected, '||safe.example.test^$script', 'example.test##.banner'].join('\n'))));
  const state = await h.updater.checkFilterUpdates(true, h.apply);
  assert.equal(state.status, 'updated');
  assert.equal(state.ruleCount, 2);
  assert.equal(state.skippedRules, rejected.length);
  assert.match(state.warning!, /native\/MV3/);
  assert.match(state.warning!, /Không bỏ modifier/);
  const active = await h.updater.getActiveUpdateRules();
  assert.deepEqual(active.filter(line => line.trim() && !line.startsWith('!')), ['||safe.example.test^$script', 'example.test##.banner']);
  assert.equal(active.filter(line => line.startsWith('! REA skipped line')).length, rejected.length);
});

test('the accepted subscription subset passes actual FilterList and complete native DNR conversion', async () => {
  const h = harness();
  h.respond(async () => new Response(list([
    '||ads.example.test^$strict3p',
    '||redirect.example.test^$redirect-rule=noopjs',
    '||transform.example.test^$uritransform=/old/new/',
    '||blocked.example.test^$script,3p',
    '@@||essential.example.test^$script',
    'example.test##.banner',
  ].join('\n'))));
  const state = await h.updater.checkFilterUpdates(true, async rules => {
    const native = new FilterList(rules.join('\n'), 0);
    assert.deepEqual(native.getConversionErrors(), []);
    const results = await new FilterConverter().convert([new Filter(0, native.getContent())], {
      combine: true, withSourceMap: true, resourcesPath: '/web-accessible-resources/redirects',
      maxNumberOfRules: 30_000, maxNumberOfUnsafeRules: 5000, maxNumberOfRegexpRules: 1000,
    });
    assert.ok(results.length > 0);
    for (const result of results) {
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.limitations, []);
      assert.equal((await result.ruleset.getDeclarativeRules()).length, 2);
    }
  });
  assert.equal(state.status, 'updated');
  assert.equal(state.ruleCount, 3);
  assert.equal(state.skippedRules, 3);
});

test('cosmetic exceptions with intentionally absent DNR output and badfilter cancellation are retained', async () => {
  const h = harness();
  const accepted = ['@@||example.test^$elemhide', '@@||example.test^$generichide', '@@||example.test^$specifichide', '||canceled.test^$script,badfilter'];
  h.respond(async () => new Response(list(accepted.join('\n'))));
  const state = await h.updater.checkFilterUpdates(true, h.apply);
  assert.equal(state.status, 'updated');
  assert.equal(state.ruleCount, accepted.length);
  assert.equal(state.skippedRules, 0);
  assert.deepEqual((await h.updater.getActiveUpdateRules()).filter(line => line && !line.startsWith('!')), accepted);
});

test('regex validator rejection omits unsupported lookaheads while accepted regex rules survive without weakening', async () => {
  const seen: string[] = [];
  const text = list('/ad(?=vert)/$script\n/advert[0-9]+/$script\n@@/essential(?=code)/$script');
  const updater = createFilterUpdater({
    storage: { get: async () => ({}), set: async () => undefined }, fetch: async () => new Response(text), now: () => START,
    isRegexSupported: async pattern => {
      seen.push(pattern);
      return pattern === 'advert[0-9]+';
    },
  });
  const state = await updater.checkFilterUpdates(true, async rules => {
    assert.deepEqual(rules.filter(line => line && !line.startsWith('!')), ['/advert[0-9]+/$script']);
  });
  assert.equal(state.status, 'updated');
  assert.equal(state.ruleCount, 1);
  assert.equal(state.skippedRules, 2);
  assert.deepEqual(seen, ['ad(?=vert)', 'advert[0-9]+', 'essential(?=code)']);
  const rules = await updater.getActiveUpdateRules();
  assert.equal(seen.length, 3, 'validated regex results are cached across active-snapshot reads');
  assert.equal(rules.filter(line => line.includes('RE2 syntax or memory limit')).length, 2);
});

test('production regex checks use Chrome compiled-memory validation and retain the whole rejected rule as a comment', async () => {
  const previous = globalThis.chrome;
  const patterns: string[] = [];
  globalThis.chrome = { declarativeNetRequest: {
    isRegexSupported: async ({ regex }: { regex: string }) => { patterns.push(regex); return { isSupported: false, reason: 'memoryLimitExceeded' }; },
  } } as unknown as typeof chrome;
  try {
    const h = harness();
    h.respond(async () => new Response(list('/expensive[0-9]+/$script\n||safe.test^$script')));
    const state = await h.updater.checkFilterUpdates(true, h.apply);
    assert.equal(state.status, 'updated');
    assert.equal(state.ruleCount, 1);
    assert.equal(state.skippedRules, 1);
    assert.deepEqual(patterns, ['expensive[0-9]+']);
    assert.deepEqual(h.applied[0]!.filter(line => line && !line.startsWith('!')), ['||safe.test^$script']);
  } finally { globalThis.chrome = previous; }
});

test('HTML literals inside genuine selector data do not get mistaken for an HTML error response', async () => {
  const h = harness();
  const rule = 'example.test##div[data-template="<script>"]';
  h.respond(async () => new Response(list(rule)));
  const state = await h.updater.checkFilterUpdates(true, h.apply);
  assert.equal(state.status, 'updated');
  assert.equal(state.ruleCount, 1);
  assert.ok(h.applied[0]!.includes(rule));
});

test('304 reuses verified snapshots and sends saved conditional request validators', async () => {
  const h = harness();
  const initial = await h.updater.checkFilterUpdates(false, h.apply);
  h.clock(START + 9 * HOUR);
  h.respond(async () => new Response(null, { status: 304 }));
  const state = await h.updater.checkFilterUpdates(false, h.apply);
  assert.equal(state.status, 'unchanged');
  assert.equal(state.lastUpdated, initial.lastUpdated);
  assert.equal(state.sha256, initial.sha256);
  assert.equal(state.nextCheck, START + 17 * HOUR);
  assert.equal(h.applied.length, 1);
  assert.deepEqual(h.requests[1]!.init!.headers, {
    Accept: 'text/plain', 'If-None-Match': '"v1"', 'If-Modified-Since': 'Wed, 01 Oct 2025 00:00:00 GMT',
  });
});

test('304 without a verified local snapshot is an error and schedules bounded retry', async () => {
  const h = harness();
  h.respond(async () => new Response(null, { status: 304 }));
  const state = await h.updater.checkFilterUpdates(false, h.apply);
  assert.equal(state.status, 'error');
  assert.match(state.error!, /chưa có bản sao/);
  assert.equal(state.nextCheck, START + 15 * 60_000);
  assert.equal(h.applied.length, 0);
  assert.deepEqual(await h.updater.getActiveUpdateRules(), []);
});

test('HTTP, HTML, wrong source titles, arbitrary JavaScript and remote include failures retain old filters', async () => {
  const h = harness();
  const before = await h.updater.checkFilterUpdates(false, h.apply);
  const old = await h.updater.getActiveUpdateRules();
  const badResponses = [
    () => new Response('unavailable', { status: 503 }),
    () => new Response('<!doctype html><html>Access denied</html>', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response(list().replace('uBlock₀ filters – Quick fixes', 'Some unrelated list')),
    () => new Response(list('example.test#%#alert(document.cookie)')),
    () => new Response(list('!#include https://untrusted.example/list.txt')),
  ];
  for (const response of badResponses) {
    h.respond(async () => response());
    const state = await h.updater.checkFilterUpdates(true, h.apply);
    assert.equal(state.status, 'error');
    assert.equal(state.sha256, before.sha256);
    assert.equal(state.lastUpdated, before.lastUpdated);
    assert.deepEqual(await h.updater.getActiveUpdateRules(), old);
    assert.ok(state.error);
  }
  assert.equal(h.applied.length, 1);
});

test('streamed size limits cannot be bypassed by small Content-Length and invalid UTF-8 is rejected', async () => {
  const h = harness();
  let canceled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(1024 * 1024 + 1)); },
    cancel() { canceled = true; },
  });
  h.respond(async () => new Response(body, { headers: { 'Content-Length': '1' } }));
  const oversized = await h.updater.checkFilterUpdates(true, h.apply);
  assert.equal(oversized.status, 'error');
  assert.match(oversized.error!, /1 MiB/);
  assert.equal(canceled, true);
  h.respond(async () => new Response(new Uint8Array([0xc3, 0x28])));
  assert.equal((await h.updater.checkFilterUpdates(true, h.apply)).status, 'error');
  assert.equal(h.applied.length, 0);
});

test('engine rejection rolls back the previous active rules and never commits candidate metadata', async () => {
  const h = harness();
  const previous = await h.updater.checkFilterUpdates(false, h.apply);
  const old = await h.updater.getActiveUpdateRules();
  h.respond(async () => new Response(list('||new.example.test^', '2')));
  const attempts: string[][] = [];
  const state = await h.updater.checkFilterUpdates(true, async rules => {
    attempts.push(rules);
    if (attempts.length === 1) throw new Error('dynamic rule quota exceeded');
  });
  assert.equal(state.status, 'error');
  assert.match(state.error!, /quota exceeded/);
  assert.equal(state.version, previous.version);
  assert.deepEqual(attempts[1], old);
  assert.deepEqual(await h.fresh().getActiveUpdateRules(), old);
});

test('storage failure after engine application restores previous rules before returning failure', async () => {
  const h = harness();
  await h.updater.checkFilterUpdates(false, h.apply);
  const old = await h.updater.getActiveUpdateRules();
  h.respond(async () => new Response(list('||new.example.test^', '2')));
  h.failWrites();
  const state = await h.updater.checkFilterUpdates(true, h.apply);
  assert.equal(state.status, 'error');
  assert.match(state.error!, /storage write failed/);
  assert.equal(h.applied.length, 3);
  assert.ok(h.applied[1]!.includes('||new.example.test^'));
  assert.deepEqual(h.applied[2], old);
  assert.deepEqual(await h.fresh().getActiveUpdateRules(), old);
});

test('failed rollback is explicit and old persisted snapshots remain available for worker restart recovery', async () => {
  const h = harness();
  await h.updater.checkFilterUpdates(false, h.apply);
  const old = await h.updater.getActiveUpdateRules();
  h.respond(async () => new Response(list('||new.example.test^', '2')));
  const state = await h.updater.checkFilterUpdates(true, async () => { throw new Error('engine unavailable'); });
  assert.match(state.error!, /Khôi phục bộ lọc thất bại/);
  assert.deepEqual(await h.fresh().getActiveUpdateRules(), old);
});

test('concurrent manual checks coalesce into one download and one engine transaction', async () => {
  const h = harness();
  let finish: (response: Response) => void = () => undefined;
  h.respond(() => new Promise(resolve => { finish = resolve; }));
  const first = h.updater.checkFilterUpdates(true, h.apply);
  const second = h.updater.checkFilterUpdates(true, h.apply);
  assert.equal(first, second);
  await new Promise(resolve => setTimeout(resolve, 0));
  finish(new Response(list()));
  assert.equal((await first).status, 'updated');
  await second;
  assert.equal(h.requests.length, 1);
  assert.equal(h.applied.length, 1);
});

test('corrupted saved content is rejected using its stored digest before reuse or conditional fetch', async () => {
  const h = harness();
  await h.updater.checkFilterUpdates(false, h.apply);
  const record = Object.values(h.data)[0] as { text: string };
  record.text = record.text.replace('||ads.example.test^', '||tampered.example.test^');
  const restarted = h.fresh();
  const state = await restarted.loadUpdateState();
  assert.equal(state.status, 'error');
  assert.match(state.error!, /SHA-256/);
  assert.deepEqual(await restarted.getActiveUpdateRules(), []);
  h.respond(async () => new Response(null, { status: 304 }));
  assert.equal((await restarted.checkFilterUpdates(true, h.apply)).status, 'error');
  assert.deepEqual(h.requests.at(-1)!.init!.headers, { Accept: 'text/plain' });
});

test('valid empty temporary subscriptions remove expired fixes instead of retaining stale exceptions', async () => {
  const h = harness();
  await h.updater.checkFilterUpdates(false, h.apply);
  h.respond(async () => new Response(list('', '2')));
  const state = await h.updater.checkFilterUpdates(true, h.apply);
  assert.equal(state.status, 'updated');
  assert.equal(state.ruleCount, 0);
  assert.equal(h.applied.length, 2);
  assert.equal(h.applied[1]!.filter(line => line && !line.startsWith('!')).length, 0);
});

test('fetch timeout aborts the request, preserves baseline and reports a retryable failure', async () => {
  const updater = createFilterUpdater({
    storage: { get: async () => ({}), set: async () => undefined }, now: () => START,
    requestTimeoutMs: 2,
    fetch: ((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('request timed out')), { once: true });
    })) as typeof fetch,
  });
  const state = await updater.checkFilterUpdates(true, async () => { assert.fail('engine should not run'); });
  assert.equal(state.status, 'error');
  assert.match(state.error!, /timed out/);
  assert.equal(state.nextCheck, START + 15 * 60_000);
});

test('the hourly alarm is created only if missing and survives worker reconstruction through reconciliation', async () => {
  const previous = globalThis.chrome;
  let alarm: { periodInMinutes: number; when: number } | undefined;
  let created = 0;
  globalThis.chrome = { alarms: {
    get: async (name: string) => { assert.equal(name, ALARM_NAME); return alarm; },
    create: async (name: string, info: typeof alarm) => { assert.equal(name, ALARM_NAME); alarm = info; created++; },
  } } as unknown as typeof chrome;
  try {
    await ensureUpdateAlarm(); await ensureUpdateAlarm();
    assert.equal(created, 1);
    assert.equal(alarm!.periodInMinutes, 60);
  } finally { globalThis.chrome = previous; }
});
