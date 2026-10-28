import assert from 'node:assert/strict';
import test from 'node:test';
import { installYouTubeResponseGuard } from '../src/youtube-response.ts';

const target = 'https://www.youtube.com/youtubei/v1/player';
const payload = () => ({
  adPlacements: [{ marker: 'preroll' }], adSlots: [{ marker: 'midroll' }], playerAds: [{ marker: 'player-ad' }],
  streamingData: { adaptiveFormats: [{ url: 'https://media.example/content' }] },
  playabilityStatus: { status: 'OK' }, videoDetails: { videoId: 'ordinary-video' },
  playerConfig: { ssapConfig: { enabled: true } },
});
const content = () => {
  const { adPlacements: _placements, adSlots: _slots, playerAds: _ads, ...rest } = payload();
  return rest;
};

function realm(host = 'www.youtube.com', path = '/watch', framed = false) {
  // Body readers and their rejection behavior are the real platform implementation. Only the final
  // URL metadata is supplied by this isolated realm; real network URL checks live in Chromium tests.
  const urls = new WeakMap<object, string>();
  class LocalResponse extends Response {}
  for (const property of ['json', 'text']) {
    Object.defineProperty(LocalResponse.prototype, property, Object.getOwnPropertyDescriptor(Response.prototype, property)!);
  }
  const nativeURL = Object.getOwnPropertyDescriptor(Response.prototype, 'url')!.get!;
  Object.defineProperty(LocalResponse.prototype, 'url', {
    configurable: true,
    get(this: Response) {
      const actual = Reflect.apply(nativeURL, this, []);
      return urls.get(this) ?? actual;
    },
  });
  type XHRState = { url: string; type: XMLHttpRequestResponseType; state: number; body: unknown };
  const xhrStates = new WeakMap<object, XHRState>();
  function xhrState(receiver: object): XHRState {
    const state = xhrStates.get(receiver);
    if (!state) throw new TypeError('Illegal invocation');
    return state;
  }
  class LocalXHR {
    get responseURL() { return xhrState(this).url; }
    get responseType() { return xhrState(this).type; }
    get readyState() { return xhrState(this).state; }
    get response() { return xhrState(this).body; }
    get responseText() {
      const state = xhrState(this);
      if (!['', 'text'].includes(state.type)) throw new DOMException('Response is not text', 'InvalidStateError');
      return state.body;
    }
  }
  const page = {
    location: { hostname: host, pathname: path, protocol: 'https:', origin: `https://${host}` },
    Response: LocalResponse, XMLHttpRequest: LocalXHR, URL,
    JSON: { parse: JSON.parse, stringify: JSON.stringify }, top: {} as unknown,
  };
  if (!framed) page.top = page;
  return {
    page,
    response(body: string, url = target) {
      const response = new LocalResponse(body);
      urls.set(response, url);
      return response;
    },
    xhr(body: unknown, type: XMLHttpRequestResponseType = 'json', url = target, state = 4) {
      const xhr = new LocalXHR();
      xhrStates.set(xhr, { body, type, url, state });
      return xhr;
    },
    xhrStates,
  };
}

async function withRealm(run: (fixture: ReturnType<typeof realm>) => Promise<void> | void, fixture = realm()) {
  const previous = globalThis.window;
  globalThis.window = fixture.page as unknown as Window & typeof globalThis;
  try { await run(fixture); }
  finally { globalThis.window = previous; }
}

test('Response.json removes only known player ads while preserving streaming, playability and SSAP', () => withRealm(async h => {
  const original = Response.prototype.json;
  installYouTubeResponseGuard();
  assert.deepEqual(await h.response(JSON.stringify(payload())).json(), content());
  assert.deepEqual(await h.response(JSON.stringify({ playerResponse: payload(), unrelated: payload() })).json(), {
    playerResponse: content(), unrelated: payload(),
  });
  assert.equal(Response.prototype.json, original, 'The Node platform prototype must never be patched');
}));

test('body readers cover no-query, versioned and trailing-slash endpoints but leave unrelated routes intact', () => withRealm(async h => {
  installYouTubeResponseGuard();
  for (const route of [target, `${target}?key=x`, target.replace('/v1/', '/v42/') + '/']) {
    assert.deepEqual(await h.response(JSON.stringify(payload()), route).json(), content());
  }
  for (const route of [
    'https://m.youtube.com/youtubei/v1/player',
    'https://www.youtube.com.evil.test/youtubei/v1/player',
    'https://www.youtube.com:8443/youtubei/v1/player',
    'http://www.youtube.com/youtubei/v1/player',
    `${target}/get_drm_license`, `${target}-other`,
    'https://www.youtube.com/youtubei/v1/get_drm_license',
    'https://www.youtube.com/videoplayback', 'https://www.youtube.com/youtubei/v1/browse',
    '',
  ]) assert.deepEqual(await h.response(JSON.stringify(payload()), route).json(), payload(), route);
}));

test('array batches filter only each explicit playerResponse and preserve arbitrary nested payloads', () => withRealm(async h => {
  installYouTubeResponseGuard();
  const response = [{ playerResponse: payload(), other: payload() }, payload(), null, 'ordinary'];
  assert.deepEqual(await h.response(JSON.stringify(response)).json(), [
    { playerResponse: content(), other: payload() }, payload(), null, 'ordinary',
  ]);
  const oversized = Array.from({ length: 513 }, () => ({ playerResponse: payload() }));
  assert.deepEqual(await h.response(JSON.stringify(oversized)).json(), oversized);
}));

test('Shorts removes only confirmed nested ad commands while preserving false, missing and flat isAd entries', () => withRealm(async h => {
  installYouTubeResponseGuard();
  const entry = (isAd: unknown, videoId: string) => ({ command: { reelWatchEndpoint: { adClientParams: { isAd }, videoId } } });
  const keep = [entry(false, 'normal-1'), entry(0, 'normal-2'), entry('true', 'normal-3'),
    { playerResponse: payload() }, { isAd: true, videoId: 'ordinary-flat-field' }];
  const entries = [entry(true, 'ad-1'), ...keep, entry(1, 'ad-2')];
  const expected = [...keep];
  expected[3] = { playerResponse: content() };
  for (const body of [{ entries }, { reelWatchSequenceResponse: { entries } }]) {
    const filtered = await h.response(JSON.stringify(body), 'https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence').json();
    assert.deepEqual(filtered, 'entries' in body ? { entries: expected } : { reelWatchSequenceResponse: { entries: expected } });
  }
  assert.deepEqual(await h.response(JSON.stringify({ entries })).json(), { entries }, 'Player route must not prune Shorts commands');
}));

test('two large Shorts containers conservatively retain the second when its complete visit budget is unavailable', () => withRealm(async h => {
  installYouTubeResponseGuard();
  const entries = Array.from({ length: 512 }, (_, index) => ({
    command: { reelWatchEndpoint: { videoId: `ordinary-${index}` } }, playerResponse: payload(),
  }));
  const value = { entries, reelWatchSequenceResponse: { entries } };
  const filtered = await h.response(JSON.stringify(value), 'https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence').json();
  assert.deepEqual(filtered.entries, entries.map(entry => ({ ...entry, playerResponse: content() })));
  assert.deepEqual(filtered.reelWatchSequenceResponse.entries, entries);
}));

test('Response.text prunes JSON only when necessary, preserving malformed, ordinary and oversized bytes', () => withRealm(async h => {
  installYouTubeResponseGuard();
  assert.deepEqual(JSON.parse(await h.response(JSON.stringify(payload())).text()), content());
  for (const text of ['  { "streamingData": {} }  ', '{invalid', 'null',
    JSON.stringify({ adSlots: [1], padding: 'x'.repeat(2 * 1024 * 1024) })]) {
    assert.equal(await h.response(text).text(), text);
  }
  const text = '  { "adSlots": [1] }  ';
  assert.equal(await h.response(text, 'https://www.youtube.com/videoplayback').text(), text);
}));

test('clean player and Shorts text bypass JSON parsing without changing original bytes', () => withRealm(async h => {
  let calls = 0;
  h.page.JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
    calls++;
    return JSON.parse(...args);
  }) as typeof JSON.parse;
  installYouTubeResponseGuard();
  const ordinary = '  { "streamingData": { "formats": [] }, "videoDetails": { "videoId": "ordinary" } }  ';
  assert.equal(await h.response(ordinary).text(), ordinary);
  const reel = '{ "entries": [{ "command": { "reelWatchEndpoint": { "videoId": "ordinary-short" } } }] }';
  assert.equal(await h.response(reel, 'https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence').text(), reel);
  const xhr = h.xhr(ordinary, 'text');
  assert.equal(xhr.response, ordinary);
  assert.equal(xhr.responseText, ordinary);
  assert.equal(calls, 0, 'Bodies with no candidate key or JSON escape need no second JSON parse');
  assert.deepEqual(JSON.parse(await h.response('{"adSlots":[1]}').text()), {});
  assert.equal(calls, 1, 'Candidate ad fields retain the parser path');
}));

test('escaped ad keys and Shorts commands retain filtering despite the clean-text fast path', () => withRealm(async h => {
  installYouTubeResponseGuard();
  const escaped = String.raw`{"ad\u0053lots":[1],"playerResponse":{"player\u0041ds":[2]},"videoDetails":{"videoId":"ordinary"}}`;
  assert.deepEqual(JSON.parse(await h.response(escaped).text()), { playerResponse: {}, videoDetails: { videoId: 'ordinary' } });
  const textXHR = h.xhr(escaped, 'text');
  assert.deepEqual(JSON.parse(textXHR.responseText as string), { playerResponse: {}, videoDetails: { videoId: 'ordinary' } });
  const escapedReel = String.raw`{"entries":[{"command":{"reelWatchEndpoint":{"adClientParams":{"is\u0041d":true},"videoId":"ad"}}},{"videoId":"ordinary"}]}`;
  assert.deepEqual(JSON.parse(await h.response(escapedReel, 'https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence').text()), {
    entries: [{ videoId: 'ordinary' }],
  });
}));

test('one-entry endpoint cache avoids repeated URL parsing and invalidates across XHR reuse and negative routes', () => withRealm(h => {
  let calls = 0;
  h.page.URL = class CountingURL extends URL {
    constructor(value: string | URL, base?: string | URL) {
      super(value, base);
      calls++;
    }
  };
  installYouTubeResponseGuard();
  const xhr = h.xhr('{"adSlots":[1]}', 'text');
  assert.equal(xhr.responseText, '{}');
  assert.equal(xhr.response, '{}');
  assert.equal(xhr.responseText, '{}');
  assert.equal(calls, 1);
  h.xhrStates.get(xhr)!.url = 'https://www.youtube.com/youtubei/v1/get_drm_license';
  assert.equal(xhr.responseText, '{"adSlots":[1]}');
  assert.equal(xhr.response, '{"adSlots":[1]}');
  assert.equal(calls, 2, 'The negative decision is cached only while the exact response URL is unchanged');
  h.xhrStates.get(xhr)!.url = 'https://m.youtube.com/youtubei/v1/player';
  assert.equal(xhr.responseText, '{"adSlots":[1]}');
  assert.equal(calls, 3, 'A different origin must be checked and left untouched');
  h.xhrStates.get(xhr)!.url = target;
  assert.equal(xhr.responseText, '{}');
  assert.equal(calls, 4, 'Returning to a previous URL recomputes its eligibility');
}));

test('ordinary Shorts arrays retain identity and mutable XHR JSON remains protected on every read', () => withRealm(h => {
  installYouTubeResponseGuard();
  const entries = [
    { command: { reelWatchEndpoint: { videoId: 'ordinary' } } },
    { playerResponse: payload() },
  ];
  const body = { entries };
  const xhr = h.xhr(body, 'json', 'https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence');
  assert.equal(xhr.response, body);
  assert.equal(body.entries, entries, 'No replacement array is needed when there is no confirmed ad');
  assert.deepEqual(entries[1]!.playerResponse, content());
  entries[1]!.playerResponse = payload();
  assert.equal(xhr.response, body);
  assert.deepEqual(entries[1]!.playerResponse, content(), 'Mutable object reads must not reuse a stale clean-object decision');
  entries.splice(1, 0, { command: { reelWatchEndpoint: { adClientParams: { isAd: true }, videoId: 'advertisement' } } } as typeof entries[number]);
  assert.equal(xhr.response, body);
  assert.notEqual(body.entries, entries, 'A replacement is created only when a later mutation actually adds an ad');
  assert.equal(body.entries.length, 2);
  assert.equal(body.entries[0], entries[0]);
}));

test('captured JSON intrinsics survive later changes to page helpers', () => withRealm(async h => {
  installYouTubeResponseGuard();
  h.page.JSON.parse = () => { throw new Error('Later JSON hook'); };
  h.page.JSON.stringify = () => { throw new Error('Later JSON hook'); };
  assert.deepEqual(JSON.parse(await h.response(JSON.stringify(payload())).text()), content());
}));

test('native Response brand checks, malformed JSON rejection and consumed-body rules survive wrappers', () => withRealm(async h => {
  installYouTubeResponseGuard();
  const json = h.page.Response.prototype.json;
  await assert.rejects(async () => json.call({}), TypeError);
  await assert.rejects(h.response('{invalid').json(), SyntaxError);
  const response = h.response(JSON.stringify(payload()));
  assert.deepEqual(await response.json(), content());
  assert.equal(response.bodyUsed, true);
  await assert.rejects(response.text(), TypeError);
  const untouched = h.response(JSON.stringify(payload()));
  const raw = await new Response(untouched.body).text();
  assert.deepEqual(JSON.parse(raw), payload(), 'Raw body streams remain untouched');
}));

test('non-target readers retain original promise identity and method arguments', () => withRealm(async h => {
  const result = Promise.resolve(payload());
  const receiver = h.response('', 'https://www.youtube.com/ordinary.json');
  const args = [Symbol('ordinary-argument')];
  const seenReceivers: unknown[] = [];
  let seenArgs: unknown[] = [];
  Object.defineProperty(h.page.Response.prototype, 'json', { configurable: true, writable: true, value: function (...values: unknown[]) {
    seenReceivers.push(this);
    seenArgs = values;
    return result;
  } });
  installYouTubeResponseGuard();
  assert.equal(Reflect.apply(receiver.json, receiver, args), result);
  assert.deepEqual(seenReceivers, [receiver]);
  assert.deepEqual(seenArgs, args);
}));

test('XHR JSON and text getters filter only complete eligible bodies, preserving native getter errors', () => withRealm(h => {
  installYouTubeResponseGuard();
  const jsonXHR = h.xhr(payload());
  assert.deepEqual(jsonXHR.response, content());
  assert.throws(() => jsonXHR.responseText, { name: 'InvalidStateError' });
  const textXHR = h.xhr(JSON.stringify(payload()), 'text');
  assert.deepEqual(JSON.parse(textXHR.responseText as string), content());
  assert.equal(textXHR.response, textXHR.responseText);
  const getter = Object.getOwnPropertyDescriptor(h.page.XMLHttpRequest.prototype, 'response')!.get!;
  assert.throws(() => getter.call({}), /Illegal invocation/);
  const loading = h.xhr(JSON.stringify(payload()), 'text', target, 3);
  assert.equal(loading.responseText, JSON.stringify(payload()));
  h.xhrStates.get(loading)!.state = 4;
  assert.deepEqual(JSON.parse(loading.responseText as string), content());
}));

test('XHR text caching updates for new bodies and leaves binary, malformed, oversized and off-route data intact', () => withRealm(h => {
  installYouTubeResponseGuard();
  const xhr = h.xhr(JSON.stringify(payload()), 'text');
  assert.deepEqual(JSON.parse(xhr.responseText as string), content());
  h.xhrStates.get(xhr)!.body = '{"adSlots":[2],"videoDetails":{"videoId":"replacement"}}';
  assert.deepEqual(JSON.parse(xhr.responseText as string), { videoDetails: { videoId: 'replacement' } });
  for (const body of ['{invalid', '  {"ordinary":1} ', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
    const untouched = h.xhr(body, 'text');
    assert.equal(untouched.response, body);
    assert.equal(untouched.responseText, body);
  }
  for (const type of ['blob', 'arraybuffer', 'document'] as const) {
    const body = payload();
    assert.equal(h.xhr(body, type).response, body);
  }
  const body = payload();
  assert.equal(h.xhr(body, 'json', 'https://www.youtube.com/youtubei/v1/get_drm_license').response, body);
  assert.deepEqual(body, payload());
}));

test('reusing an XHR with an identical body on a different endpoint does not reuse stale text filtering', () => withRealm(h => {
  installYouTubeResponseGuard();
  const entries = [
    { command: { reelWatchEndpoint: { adClientParams: { isAd: true }, videoId: 'advertisement' } } },
    { command: { reelWatchEndpoint: { videoId: 'ordinary' } } },
  ];
  const body = JSON.stringify({ entries });
  const xhr = h.xhr(body, 'text');
  assert.equal(xhr.responseText, body);
  h.xhrStates.get(xhr)!.url = 'https://www.youtube.com/youtubei/v1/reel/reel_watch_sequence';
  assert.deepEqual(JSON.parse(xhr.responseText as string), { entries: [entries[1]] });
}));

test('another interceptor returning exotic objects cannot turn successful reads into new errors', () => withRealm(async h => {
  const value = Object.defineProperty({ ordinary: true }, 'playerResponse', {
    get() { throw new Error('Exotic interceptor value'); },
  });
  Object.defineProperty(h.page.Response.prototype, 'json', { configurable: true, value: () => Promise.resolve(value) });
  installYouTubeResponseGuard();
  assert.equal(await h.response('').json(), value);
  assert.equal(h.xhr(value).response, value);
}));

test('repeated installation is idempotent and native descriptors remain replaceable by the main engine', () => withRealm(h => {
  installYouTubeResponseGuard();
  const installed = h.page.Response.prototype.json;
  installYouTubeResponseGuard();
  assert.equal(h.page.Response.prototype.json, installed);
  assert.equal(Object.getOwnPropertyDescriptor(h.page.Response.prototype, 'json')!.configurable, true);
  assert.equal(Object.getOwnPropertyDescriptor(h.page.XMLHttpRequest.prototype, 'response')!.configurable, true);
}));

test('Music, TV, deceptive hosts, frames and missing realm constructors leave platform readers unchanged', async () => {
  for (const [host, path, framed] of [
    ['music.youtube.com', '/watch', false], ['tv.youtube.com', '/watch', false],
    ['www.youtube.com', '/tv/watch', false], ['www.youtube.com.evil.test', '/watch', false],
    ['www.youtube.com', '/embed/video', true],
  ] as const) await withRealm(h => {
    const previous = h.page.Response.prototype.json;
    installYouTubeResponseGuard();
    assert.equal(h.page.Response.prototype.json, previous);
  }, realm(host, path, framed));
  await withRealm(h => {
    const previous = Response.prototype.json;
    Reflect.deleteProperty(h.page, 'Response');
    Reflect.deleteProperty(h.page, 'XMLHttpRequest');
    installYouTubeResponseGuard();
    assert.equal(Response.prototype.json, previous);
  });
});
