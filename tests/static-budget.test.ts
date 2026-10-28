import test from 'node:test';
import assert from 'node:assert/strict';
import { assertStaticBudget } from '../src/shared/static-budget.ts';

const filters = [{ id: 2, browserRules: 200001 }, { id: 90003, browserRules: 503 }, { id: 90004, browserRules: 13 }];
test('static budget checks only the net addition and counts browser metadata overhead', () => {
  assert.doesNotThrow(() => assertStaticBudget(filters, ['ruleset_2'], [2, 90003, 90004], 516, 50));
  assert.throws(() => assertStaticBudget(filters, ['ruleset_2'], [2, 90003, 90004], 515, 50), /cần thêm 516/);
  assert.doesNotThrow(() => assertStaticBudget(filters, ['ruleset_2'], [90003, 90004], 0, 50));
  assert.doesNotThrow(() => assertStaticBudget(filters, ['ruleset_2', 'ruleset_90003'], [2, 90003], 0, 50));
});
test('invalid catalog or quota and excessive enabled lists fail before installation', () => {
  assert.throws(() => assertStaticBudget(filters, [], [90003, 90004], 10000, 1));
  assert.throws(() => assertStaticBudget(filters, [], [123], 10000, 50));
  assert.throws(() => assertStaticBudget(filters, [], [2], NaN, 50));
  assert.throws(() => assertStaticBudget([{ id: 2, browserRules: -1 }], [], [2], 10000, 50));
});
