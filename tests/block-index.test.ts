import assert from 'node:assert/strict';
import test from 'node:test';
import { hasBlockRule } from '../src/shared/block-index.ts';

test('compact index reads little-endian identifiers and limits searches to the selected ruleset', () => {
  const bytes = Uint8Array.from([
    1, 0, 0, 0, 0, 1, 0, 0, 4, 3, 2, 1,
    7, 0, 0, 0, 255, 255, 255, 255,
  ]);
  const index = new DataView(bytes.buffer);
  const first = { offset: 0, count: 3 };
  const second = { offset: 12, count: 2 };
  for (const ruleId of [1, 256, 0x01020304]) assert.equal(hasBlockRule(index, first, ruleId), true);
  for (const ruleId of [2, 7, 255, 0x04030201, 0xffffffff]) assert.equal(hasBlockRule(index, first, ruleId), false);
  for (const ruleId of [7, 0xffffffff]) assert.equal(hasBlockRule(index, second, ruleId), true);
  assert.equal(hasBlockRule(index, second, 1), false);
});

test('compact index respects a DataView byte offset and supports empty or final single-rule ranges', () => {
  const bytes = Uint8Array.from([91, 92, 93, 94, 0, 2, 0, 0, 21, 0, 0, 0, 95, 96]);
  const index = new DataView(bytes.buffer, 4, 8);
  assert.equal(hasBlockRule(index, { offset: 0, count: 1 }, 512), true);
  assert.equal(hasBlockRule(index, { offset: 4, count: 1 }, 21), true);
  assert.equal(hasBlockRule(index, { offset: 4, count: 1 }, 512), false);
  assert.equal(hasBlockRule(index, { offset: 8, count: 0 }, 21), false);
  assert.equal(hasBlockRule(new DataView(new ArrayBuffer(0)), { offset: 0, count: 0 }, 1), false);
});

test('compact index rejects invalid identifiers and malformed or out-of-bounds metadata without reading outside the view', () => {
  const index = new DataView(Uint8Array.from([1, 0, 0, 0]).buffer);
  for (const ruleId of [0, -1, 1.5, NaN, Infinity, 0x100000000]) {
    assert.equal(hasBlockRule(index, { offset: 0, count: 1 }, ruleId), false);
  }
  for (const range of [
    { offset: -4, count: 1 }, { offset: 1, count: 0 }, { offset: 0.5, count: 1 },
    { offset: 8, count: 0 }, { offset: NaN, count: 1 }, { offset: Infinity, count: 1 },
    { offset: 0, count: -1 }, { offset: 0, count: 0.5 }, { offset: 0, count: 2 },
    { offset: 4, count: 1 }, { offset: 0, count: NaN }, { offset: 0, count: Infinity },
    { offset: Number.MAX_SAFE_INTEGER + 1, count: 0 }, { offset: 0, count: Number.MAX_SAFE_INTEGER + 1 },
  ]) assert.equal(hasBlockRule(index, range, 1), false);
});
