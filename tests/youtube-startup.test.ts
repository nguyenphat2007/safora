import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/shared/defaults.ts';
import { reconcileYouTubeStartup, YOUTUBE_STARTUP_SCRIPT_ID } from '../src/youtube-startup.ts';
import { installYouTubeInitialResponseGuard } from '../src/youtube-main.ts';

async function scriptingFixture(run: (harness: ReturnType<typeof scriptingHarness>) => Promise<void>): Promise<void> {
  const previous = globalThis.chrome;
  const harness = scriptingHarness();
  globalThis.chrome = { scripting: harness.api } as unknown as typeof chrome;
  try { await run(harness); }
  finally { globalThis.chrome = previous; }
}

function scriptingHarness() {
  const scripts = new Map<string, chrome.scripting.RegisteredContentScript>();
  const calls: string[] = [];
  let afterMutation = (_operation: string) => {};
  const api = {
    async getRegisteredContentScripts({ ids }: { ids: string[] }) {
      calls.push('read');
      return structuredClone(ids.flatMap(id => scripts.has(id) ? [scripts.get(id)!] : []));
    },
    async registerContentScripts(items: chrome.scripting.RegisteredContentScript[]) {
      calls.push('register');
      for (const script of items) {
        if (scripts.has(script.id)) throw new Error('Registration already exists');
        scripts.set(script.id, structuredClone(script));
      }
      afterMutation('register');
    },
    async updateContentScripts(items: chrome.scripting.RegisteredContentScript[]) {
      calls.push('update');
      for (const script of items) {
        if (!scripts.has(script.id)) throw new Error('Missing registration');
        scripts.set(script.id, structuredClone(script));
      }
      afterMutation('update');
    },
    async unregisterContentScripts({ ids }: { ids: string[] }) {
      calls.push('unregister');
      for (const id of ids) scripts.delete(id);
      afterMutation('unregister');
    },
  };
  return { scripts, calls, api, failAfterMutation(next: (operation: string) => void) { afterMutation = next; } };
}

function settings(patch: Partial<typeof DEFAULT_SETTINGS> = {}) {
  return { ...structuredClone(DEFAULT_SETTINGS), ...patch };
}

test('startup registration is exact-host, top-level, persistent MAIN document_start and idempotent', () => scriptingFixture(async h => {
  await reconcileYouTubeStartup(settings({ scriptlets: false }));
  const script = h.scripts.get(YOUTUBE_STARTUP_SCRIPT_ID)!;
  assert.deepEqual(script.matches, ['*://youtube.com/*', '*://www.youtube.com/*', '*://m.youtube.com/*']);
  assert.deepEqual(script.js, ['youtube-main.js']);
  assert.equal(script.world, 'MAIN');
  assert.equal(script.runAt, 'document_start');
  assert.equal(script.allFrames, false);
  assert.equal(script.persistAcrossSessions, true);
  assert(script.excludeMatches?.includes('*://www.youtube.com/tv/*'));
  const mutations = h.calls.filter(call => call !== 'read').length;
  await reconcileYouTubeStartup(settings({ scriptlets: false }));
  assert.equal(h.calls.filter(call => call !== 'read').length, mutations);
}));

test('allowlist domain boundaries and protection toggles only alter the owned registration', () => scriptingFixture(async h => {
  h.scripts.set('unrelated-feature', { id: 'unrelated-feature', js: ['other.js'], matches: ['https://example.test/*'] });
  await reconcileYouTubeStartup(settings({ allowlist: ['www.youtube.com', 'youtube.com.evil.test'] }));
  assert.deepEqual(h.scripts.get(YOUTUBE_STARTUP_SCRIPT_ID)?.matches, ['*://youtube.com/*', '*://m.youtube.com/*']);
  await reconcileYouTubeStartup(settings({ allowlist: ['youtube.com'] }));
  assert(!h.scripts.has(YOUTUBE_STARTUP_SCRIPT_ID));
  await reconcileYouTubeStartup(settings());
  await reconcileYouTubeStartup(settings({ groups: { ...DEFAULT_SETTINGS.groups, ads: false } }));
  assert(!h.scripts.has(YOUTUBE_STARTUP_SCRIPT_ID));
  await reconcileYouTubeStartup(settings());
  await reconcileYouTubeStartup(settings({ enabled: false }));
  assert.deepEqual([...h.scripts.keys()], ['unrelated-feature']);
}));

test('relevant script exceptions disable startup conservatively while unrelated exceptions keep it', () => scriptingFixture(async h => {
  for (const userRules of [
    "youtube.com#@%#//scriptlet('set-constant', 'ytInitialPlayerResponse.adSlots', 'undefined')",
    'youtube.com#@#+js(set, ytInitialPlayerResponse.adSlots, undefined)',
    '@@||youtube.com/watch$document',
    '@@||www.youtube.com^$doc',
    '@@|https://m.youtube.com/watch$jsinject',
    '@@/youtube.*watch/$jsinject',
    '@@||*.example.com^$document',
  ]) {
    await reconcileYouTubeStartup(settings());
    await reconcileYouTubeStartup(settings({ userRules }));
    assert(!h.scripts.has(YOUTUBE_STARTUP_SCRIPT_ID), userRules);
  }
  for (const userRules of [
    '@@||other.example^$document',
    '@@||youtube.com.evil.test/watch$jsinject',
    '@@|https://other.example/watch$document',
    "other.example#@%#//scriptlet('set-constant', 'ads', 'undefined')",
    '@@||ads.example/essential.js$script',
    '@@||youtube.com^$elemhide',
    'youtube.com#@#.ad-slot',
    '! Comment containing @@||youtube.com^$document',
  ]) {
    await reconcileYouTubeStartup(settings({ userRules }));
    assert(h.scripts.has(YOUTUBE_STARTUP_SCRIPT_ID), userRules);
  }
}));

test('a registration API failure after mutation restores the exact previous registration', () => scriptingFixture(async h => {
  await reconcileYouTubeStartup(settings({ allowlist: ['m.youtube.com'] }));
  const previous = structuredClone(h.scripts.get(YOUTUBE_STARTUP_SCRIPT_ID));
  let failures = 1;
  h.failAfterMutation(operation => { if (operation === 'update' && failures-- > 0) throw new Error('Update failed after mutation'); });
  await assert.rejects(reconcileYouTubeStartup(settings()), /đã khôi phục cấu hình trước đó/);
  assert.deepEqual(h.scripts.get(YOUTUBE_STARTUP_SCRIPT_ID), previous);
}));

test('failed first registration rolls back to no registration', () => scriptingFixture(async h => {
  h.failAfterMutation(operation => { if (operation === 'register') throw new Error('Register failed after mutation'); });
  await assert.rejects(reconcileYouTubeStartup(settings()), /đã khôi phục cấu hình trước đó/);
  assert(!h.scripts.has(YOUTUBE_STARTUP_SCRIPT_ID));
}));

test('failed removal restores registration and restoration failures are explicit', () => scriptingFixture(async h => {
  await reconcileYouTubeStartup(settings());
  const previous = structuredClone(h.scripts.get(YOUTUBE_STARTUP_SCRIPT_ID));
  h.failAfterMutation(operation => { if (operation === 'unregister') throw new Error('Remove failed after mutation'); });
  await assert.rejects(reconcileYouTubeStartup(settings({ enabled: false })), /đã khôi phục cấu hình trước đó/);
  assert.deepEqual(h.scripts.get(YOUTUBE_STARTUP_SCRIPT_ID), previous);
  h.failAfterMutation(() => { throw new Error('Persistent API failure'); });
  await assert.rejects(reconcileYouTubeStartup(settings({ allowlist: ['m.youtube.com'] })), /khôi phục thất bại.*Persistent API failure/);
}));

function withPage(host: string, path: string, run: (page: Record<string | symbol, unknown>) => void, framed = false): void {
  const previous = globalThis.window;
  const page: Record<string | symbol, unknown> = { location: { hostname: host, pathname: path, protocol: 'https:' } };
  page.top = framed ? {} : page;
  globalThis.window = page as unknown as Window & typeof globalThis;
  try { run(page); }
  finally { globalThis.window = previous; }
}

test('initial response fields are guarded synchronously without changing streaming, SSAP or content state', () => {
  withPage('www.youtube.com', '/watch', page => {
    installYouTubeInitialResponseGuard();
    const response = { adPlacements: [1], adSlots: [2], playerAds: [3], streamingData: { formats: [{ url: 'content' }] }, playerConfig: { ssapConfig: { enabled: true } }, playabilityStatus: { status: 'OK' } };
    page.ytInitialPlayerResponse = response;
    assert.equal(response.adPlacements, undefined);
    assert.equal(response.adSlots, undefined);
    assert.equal(response.playerAds, undefined);
    assert.equal(response.streamingData.formats[0].url, 'content');
    assert.equal(response.playerConfig.ssapConfig.enabled, true);
    assert.equal(response.playabilityStatus.status, 'OK');
    const firstGet = Object.getOwnPropertyDescriptor(response, 'adSlots')?.get;
    assert.equal(Object.getOwnPropertyDescriptor(page, 'ytInitialPlayerResponse')?.configurable, true);
    assert.equal(Object.getOwnPropertyDescriptor(response, 'adSlots')?.configurable, true);
    assert.equal(page.ytInitialPlayerResponse, response);
    assert.equal(Object.getOwnPropertyDescriptor(response, 'adSlots')?.get, firstGet);
    response.adSlots = [4];
    assert.equal(response.adSlots, undefined);
    Object.defineProperty(response, 'adSlots', { configurable: false, value: undefined });
    assert.equal(page.ytInitialPlayerResponse, response);
  });
});

test('SPA replacement, alternate initial global and repeated installation preserve the narrow guard', () => {
  withPage('m.youtube.com', '/watch', page => {
    installYouTubeInitialResponseGuard();
    const descriptor = Object.getOwnPropertyDescriptor(page, 'ytInitialPlayerResponse');
    installYouTubeInitialResponseGuard();
    assert.deepEqual(Object.getOwnPropertyDescriptor(page, 'ytInitialPlayerResponse'), descriptor);
    page.ytInitialPlayerResponse = { adSlots: [1], videoDetails: { videoId: 'first' } };
    page.ytInitialPlayerResponse = { adSlots: [2], videoDetails: { videoId: 'second' } };
    const next = page.ytInitialPlayerResponse as { adSlots: unknown; videoDetails: { videoId: string } };
    assert.equal(next.adSlots, undefined);
    assert.equal(next.videoDetails.videoId, 'second');
    page.playerResponse = { adPlacements: [1], playerAds: [2] };
    assert.equal((page.playerResponse as { adPlacements: unknown }).adPlacements, undefined);
    assert.deepEqual((page.playerResponse as { playerAds: number[] }).playerAds, [2]);
  });
});

test('Music, TV, deceptive hosts and descendant frames receive no startup guard', () => {
  for (const [host, path, framed] of [
    ['music.youtube.com', '/watch', false],
    ['tv.youtube.com', '/', false],
    ['www.youtube.com', '/tv', false],
    ['www.youtube.com', '/tv/watch', false],
    ['www.youtube.com.evil.test', '/watch', false],
    ['www.youtube.com', '/embed/video', true],
  ] as const) withPage(host, path, page => {
    installYouTubeInitialResponseGuard();
    assert.equal(Object.getOwnPropertyDescriptor(page, 'ytInitialPlayerResponse'), undefined);
  }, framed);
});
