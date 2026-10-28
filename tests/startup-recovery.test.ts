import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS } from '../src/shared/defaults.ts';
import { startWithSecurityRecovery } from '../src/shared/startup-recovery.ts';
import type { Settings } from '../src/shared/types.ts';

test('security install failure retries the old groups without losing exceptions, personal rules or updates', async () => {
  const original = { ...structuredClone(DEFAULT_SETTINGS), allowlist: ['shop.example'], userRules: '||ads.example^' };
  original.groups.privacy = false;
  const calls: Settings[] = [];
  const updates = ['||tracking.example^'];
  const result = await startWithSecurityRecovery(original, updates, async (candidate, rules) => {
    calls.push(candidate);
    assert.equal(rules, updates);
    if (candidate.groups.security) throw new Error('static rules quota exceeded');
  });
  assert.equal(result.securityDisabled, true);
  assert.match(result.warning!, /quota/);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { ...original, groups: { ...original.groups, security: false } });
  assert.equal(original.groups.security, true);
});

test('success and explicit security opt-out do not cause extra configuration attempts', async () => {
  for (const security of [true, false]) {
    let calls = 0;
    const settings = { ...structuredClone(DEFAULT_SETTINGS), groups: { ...DEFAULT_SETTINGS.groups, security } };
    assert.deepEqual(await startWithSecurityRecovery(settings, [], async () => { calls++; }), { securityDisabled: false });
    assert.equal(calls, 1);
  }
});

test('unrelated failure propagates to existing recovery without claiming successful protection', async () => {
  const error = new Error('old filters unavailable');
  let calls = 0;
  await assert.rejects(startWithSecurityRecovery(structuredClone(DEFAULT_SETTINGS), [], async () => { calls++; throw error; }), candidate => candidate === error);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(startWithSecurityRecovery({ ...structuredClone(DEFAULT_SETTINGS), enabled: false }, [], async () => { calls++; throw error; }), candidate => candidate === error);
  assert.equal(calls, 1);
});
