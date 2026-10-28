import assert from 'node:assert/strict';
import test from 'node:test';
import { createEngineMessageHarness } from '../scripts/engine-message-benchmark.mjs';

const plain = (value: unknown) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const sender = { tab: { id: 7 }, frameId: 3 };

test('real engine callsite lazily reuses one upstream MessagesApi handler across concurrent callers', async () => {
  const fixture = createEngineMessageHarness();
  await fixture.configure(fixture.settings(true), []);
  assert.equal(fixture.counters.factoryCalls, 0, 'Configuration alone must not allocate a content-message handler');
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => fixture.dispatch(
    fixture.message(fixture.types.GetCosmeticData, { documentUrl: `https://frame${index}.example.test/` }), { tab: { id: index + 1 }, frameId: index },
  )));
  assert.equal(fixture.counters.factoryCalls, 1, 'One object and bound function are enough for this engine lifetime');
  for (const [index, result] of results.entries()) {
    assert.equal(result.documentUrl, `https://frame${index}.example.test/`); assert.equal(result.tabId, index + 1); assert.equal(result.frameId, index);
  }
});

test('reused real upstream handler observes live policy and cookie state before and after reconfiguration', async () => {
  const fixture = createEngineMessageHarness(), cosmetic = fixture.message(fixture.types.GetCosmeticData, { documentUrl: 'https://ordinary.example.test/' });
  assert.equal(await fixture.dispatch(cosmetic, sender), undefined, 'Engine is not started');
  await fixture.configure(fixture.settings(true), []);
  const before = await fixture.dispatch(cosmetic, sender);
  assert.equal(before.policy.enabled, true); assert.equal(before.policy.generation, 1);
  const cookies = fixture.message(fixture.types.GetCookieRules, { documentUrl: 'https://ordinary.example.test/' });
  assert.equal((await fixture.dispatch(cookies, sender)).cookieRules[0].ruleIndex, 1);
  await fixture.configure(fixture.settings(false), []);
  assert.equal(await fixture.dispatch(cosmetic, sender), null);
  await fixture.configure(fixture.settings(true), []);
  const concurrent = await Promise.all([fixture.dispatch(cosmetic, sender), fixture.dispatch(cookies, sender)]);
  assert.equal(concurrent[0].policy.generation, 3); assert.equal(concurrent[1].cookieRules[0].ruleIndex, 3);
  assert.notEqual(concurrent[0].policy.userRules, before.policy.userRules);
  assert.equal(fixture.counters.factoryCalls, 1);
});

test('actual validators, sender checks, assistant/cosmetic/cookie events and dependency rejection remain forwarded', async () => {
  const fixture = createEngineMessageHarness(); await fixture.configure(fixture.settings(true), []);
  assert.equal(await fixture.dispatch({ handlerName: 'other', type: fixture.types.GetCosmeticData, payload: {} }, sender), undefined);
  assert.equal(await fixture.dispatch(fixture.message(fixture.types.GetCosmeticData, { documentUrl: 42 }), sender), undefined);
  assert.equal(await fixture.dispatch(fixture.message(fixture.types.GetCosmeticData, { documentUrl: 'https://ordinary.example.test/' }), {}), undefined);
  assert.equal(await fixture.dispatch(fixture.message(fixture.types.AssistantCreateRule, { ruleText: 'ordinary.example.test##.fixture' }), sender), true);
  assert.deepEqual(fixture.assistantRules, ['ordinary.example.test##.fixture']);
  assert.equal(await fixture.dispatch(fixture.message(fixture.types.SaveCssHitsStats, [{ filterId: 214, ruleIndex: 5, element: '<div>' }]), sender), true);
  assert.equal(fixture.events[0].data.tabId, 7); assert.equal(fixture.events[0].data.frameUrl, 'https://tab7.example.test/');
  const cookie = { cookieName: 'fixture', cookieDomain: 'ordinary.example.test', cookieValue: '', filterId: 214, ruleIndex: 5, thirdParty: false, isAllowlist: false, isImportant: false, isDocumentLevel: false, isCsp: false, isCookie: true, advancedModifier: null };
  assert.equal(await fixture.dispatch(fixture.message(fixture.types.SaveCookieLogEvent, cookie), sender), true);
  assert.equal(fixture.events[1].type, 'cookie'); assert.equal(fixture.events[1].data.cookieName, 'fixture');
  await assert.rejects(fixture.dispatch(fixture.message(fixture.types.GetCosmeticData, { documentUrl: 'https://ordinary.example.test/failure' }), sender), /Controlled filtering dependency failure/);
  const result = await fixture.dispatch(fixture.message(fixture.types.GetCosmeticData, { documentUrl: 'https://ordinary.example.test/recovered' }), sender);
  assert.equal(result.frameId, 3); assert.equal(fixture.counters.factoryCalls, 1);
});

test('old per-message factory and reused handler have equal dispatch results through policy changes', async () => {
  const old = createEngineMessageHarness('per-call'), reused = createEngineMessageHarness('reused');
  for (const enabled of [true, false, true]) {
    for (const fixture of [old, reused]) await fixture.configure(fixture.settings(enabled), []);
    for (const type of ['GetCosmeticData', 'GetCookieRules']) {
      const results = await Promise.all([old, reused].map(fixture => fixture.dispatch(fixture.message(fixture.types[type], { documentUrl: 'https://ordinary.example.test/' }), sender)));
      assert.deepEqual(plain(results[0]), plain(results[1]));
    }
  }
  assert.equal(old.counters.factoryCalls, 6); assert.equal(reused.counters.factoryCalls, 1);
});
