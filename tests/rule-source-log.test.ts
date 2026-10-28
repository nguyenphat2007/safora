import assert from 'node:assert/strict';
import test from 'node:test';
import { createRuleSourceLog } from '../src/shared/rule-source-log.ts';

test('diagnostics are opt-in, cache source-map reads, and retain all-source count without claiming one matching line', async () => {
  let reads = 0;
  const map = { getId: () => 'ruleset_2', getRulesById: async () => { reads++; return Array.from({ length: 5 }, (_, i) => ({ filterId: 2, sourceRule: `||ads${i}.test^` })); } };
  const log = createRuleSourceLog();
  log.replace([map], false);
  assert.equal(await log.resolve('ruleset_2', 7), undefined); assert.equal(reads, 0);
  log.replace([map], true);
  const detail = await log.resolve('ruleset_2', 7);
  assert.equal(detail?.sourceCount, 5); assert.equal(detail?.sources.length, 3);
  assert.equal(detail?.sources[0].rule, '||ads0.test^');
  assert.deepEqual(await log.resolve('ruleset_2', 7), detail); assert.equal(reads, 1);
  assert.equal(await log.resolve('_session', 7), undefined);
  assert.equal(await log.resolve('ruleset_2', -1), undefined);
});

test('configuration replacement prevents stale source attribution and turning diagnostics off clears cached rules', async () => {
  const log = createRuleSourceLog();
  let finish!: (value: { filterId: number; sourceRule: string }[]) => void;
  log.replace([{ getId: () => '_dynamic', getRulesById: () => new Promise(resolve => { finish = resolve; }) }], true);
  const pending = log.resolve('_dynamic', 1);
  const receivedGeneration = log.generation();
  log.replace([{ getId: () => '_dynamic', getRulesById: async () => [{ filterId: 0, sourceRule: '||new.test^' }] }], true);
  finish([{ filterId: 0, sourceRule: '||old.test^' }]);
  assert.equal(await pending, undefined);
  assert.equal(await log.resolve('_dynamic', 1, receivedGeneration), undefined);
  assert.equal((await log.resolve('_dynamic', 1))?.sources[0].rule, '||new.test^');
  log.replace([], false); assert.equal(await log.resolve('_dynamic', 1), undefined);
});

test('failed or timed-out maps pause lookups until reconfiguration so a request burst cannot repeatedly stall settings', async () => {
  const log = createRuleSourceLog(5);
  let attempt = 0;
  const map = { getId: () => 'ruleset_3', getRulesById: async () => {
    attempt++;
    if (attempt === 1) throw new Error('IDB read failed');
    if (attempt === 2) return new Promise(() => {});
    return [{ filterId: 3, sourceRule: '||tracker.test^' }];
  } };
  log.replace([map], true);
  assert.equal(await log.resolve('ruleset_3', 1), undefined);
  for (let id = 2; id <= 100; id++) assert.equal(await log.resolve('ruleset_3', id), undefined);
  assert.equal(attempt, 1);
  log.replace([map], true);
  assert.equal(await log.resolve('ruleset_3', 1), undefined);
  assert.equal(await log.resolve('ruleset_3', 2), undefined); assert.equal(attempt, 2);
  log.replace([map], true);
  assert.equal((await log.resolve('ruleset_3', 1))?.sources[0].rule, '||tracker.test^');
});

test('diagnostic cache and displayed source lengths are bounded', async () => {
  const log = createRuleSourceLog(); let reads = 0;
  log.replace([{ getId: () => 'ruleset_2', getRulesById: async () => { reads++; return [{ filterId: 2, sourceRule: 'a'.repeat(2000) }]; } }], true);
  for (let id = 1; id <= 129; id++) assert.equal((await log.resolve('ruleset_2', id))?.sources[0].rule.length, 501);
  await log.resolve('ruleset_2', 129); assert.equal(reads, 129);
  await log.resolve('ruleset_2', 1); assert.equal(reads, 130);
});
