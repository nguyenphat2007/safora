import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RulesHashMap as NativeRulesHashMap, type HashWithSource } from '@adguard/dnr-converter';
import { RulesHashMap } from '../src/compact-rules-hash-map.ts';
import { UPSTREAM_FILTER_IDS } from '../src/shared/filter-sources.ts';

function pair(raw: string): [NativeRulesHashMap, RulesHashMap] {
  return [new NativeRulesHashMap(NativeRulesHashMap.deserializeSources(raw)), new RulesHashMap(RulesHashMap.deserializeSources(raw))];
}

test('compact metadata preserves group insertion, collisions, duplicates and full finite number precision', () => {
  const raw = JSON.stringify([
    [42, [[2, 100], [2, 100], [3, 200]]], [-12.5, [[-1, Number.MAX_SAFE_INTEGER]]],
    [0, [[0, -0]]], [42, [[214, 300]]], [Number.MAX_VALUE, [[2.5, -123.5]]],
    [Number.MIN_VALUE, [[214, 0]]], [-Number.MAX_VALUE, [[Number.MAX_VALUE, Number.MIN_VALUE]]],
  ]);
  const [native, compact] = pair(raw);
  assert.equal(compact.serialize(), native.serialize());
  for (const hash of [42, -12.5, 0, -0, Number.MAX_VALUE, Number.MIN_VALUE, -Number.MAX_VALUE, 100, NaN, Infinity, -Infinity]) {
    assert.deepEqual(compact.findRules(hash), native.findRules(hash));
  }
  assert.equal(compact.serialize(), native.serialize());
  assert.deepEqual(pair('[]')[1].findRules(1), []);
  assert.equal(pair('[]')[1].serialize(), '[]');
});

test('lookups preserve mutable array identity, source edits and empty-hit behavior', () => {
  const [native, compact] = pair('[[3,[[2,10],[3,20]]],[1,[[214,30]]]]');
  for (const map of [native, compact]) {
    const sources = map.findRules(3);
    assert.equal(map.findRules(3), sources);
    sources[0].filterId = 19;
    sources[0].sourceRuleIndex = 456;
    sources.splice(1, 1, { filterId: 22, sourceRuleIndex: 88 });
    sources.push({ filterId: 0, sourceRuleIndex: 99 });
    map.findRules(1).splice(0);
    const miss = map.findRules(1234);
    miss.push({ filterId: 1, sourceRuleIndex: 2 });
    assert.deepEqual(map.findRules(1234), []);
  }
  assert.equal(compact.serialize(), native.serialize());
  assert.deepEqual(compact.findRules(3), native.findRules(3));
  assert.deepEqual(compact.findRules(1), native.findRules(1));
});

test('ordinary constructors retain original source aliases and nonfinite Map key semantics', () => {
  const source = { filterId: 2, sourceRuleIndex: 1 };
  const rows: HashWithSource[] = [
    { hash: 1, source }, { hash: 1, source },
    { hash: NaN, source: { filterId: Infinity, sourceRuleIndex: NaN } },
    { hash: Infinity, source: { filterId: 0, sourceRuleIndex: 20 } },
    { hash: -Infinity, source: { filterId: -1, sourceRuleIndex: 30 } },
  ];
  const native = new NativeRulesHashMap(rows);
  const compact = new RulesHashMap(rows);
  source.sourceRuleIndex = 456;
  assert.equal(compact.findRules(1)[0], source);
  assert.equal(compact.findRules(1)[0], compact.findRules(1)[1]);
  for (const hash of [1, NaN, Infinity, -Infinity]) assert.deepEqual(compact.findRules(hash), native.findRules(hash));
  assert.equal(compact.serialize(), native.serialize());
});

test('deserializer preserves output and rejection behavior and falls back for nonnumeric metadata', () => {
  for (const raw of ['[[1,[[2,3]]]]', '[[null,[[null,null]]]]', '[["hash",[["filter",null]]]]']) {
    assert.deepEqual(RulesHashMap.deserializeSources(raw), NativeRulesHashMap.deserializeSources(raw));
    const [native, compact] = pair(raw);
    assert.equal(compact.serialize(), native.serialize());
    for (const [hash] of JSON.parse(raw)) assert.deepEqual(compact.findRules(hash), native.findRules(hash));
  }
  for (const raw of ['broken', '{}', '[null]', '[[1,null]]', '[[1,[null]]]']) {
    assert.throws(() => NativeRulesHashMap.deserializeSources(raw));
    assert.throws(() => RulesHashMap.deserializeSources(raw));
  }
});

test('every hash and source in all packaged filter lists matches the pinned converter', async () => {
  const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve('@adguard/dnr-rulesets'))));
  let checkedHashes = 0;
  let checkedSources = 0;
  for (const id of UPSTREAM_FILTER_IDS) {
    const rules = JSON.parse(await readFile(join(packageRoot, `filters/chromium-mv3/declarative/ruleset_${id}/ruleset_${id}.json`), 'utf8'));
    const envelope = rules[0].metadata.filterContent !== undefined
      ? rules[0].metadata
      : JSON.parse(rules.filter((rule: { metadata?: { chunk?: string } }) => typeof rule.metadata?.chunk === 'string').map((rule: { metadata: { chunk: string } }) => rule.metadata.chunk).join(''));
    const raw = envelope.metadata.rulesetHashMapRaw;
    const [native, compact] = pair(raw);
    assert.equal(compact.serialize(), native.serialize(), `filter ${id}: serialization before lookup`);
    const hashes = new Set<number>(JSON.parse(raw).map(([hash]: [number]) => hash));
    for (const hash of hashes) {
      const expected = native.findRules(hash);
      assert.deepEqual(compact.findRules(hash), expected, `filter ${id}: hash ${hash}`);
      checkedHashes += 1;
      checkedSources += expected.length;
    }
    assert.deepEqual(compact.findRules(Number.MAX_SAFE_INTEGER), native.findRules(Number.MAX_SAFE_INTEGER));
    assert.equal(compact.serialize(), native.serialize(), `filter ${id}: serialization after lookup`);
  }
  assert.ok(checkedHashes > 190000, `only checked ${checkedHashes} hashes`);
  assert.ok(checkedSources > 190000, `only checked ${checkedSources} sources`);
});
