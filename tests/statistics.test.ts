import assert from 'node:assert/strict';
import test from 'node:test';
import { categoryForRuleset, normalizeHistory, recordBlock, statisticsView, localDay, STAT_CATEGORIES } from '../src/shared/statistics.ts';

const at = (day: number, hour = 12) => new Date(2026, 9, day, hour).getTime();
test('migration starts a fresh daily history without inventing values for older totals', () => {
  const history = normalizeHistory(undefined, at(23));
  const view = statisticsView(history, 7, 'all', at(23));
  assert.equal(view.total, 0);
  assert.deepEqual(view.points.map(point => point.value), [null, null, null, null, null, null, 0]);
  assert.equal(history.startedAt, at(23));
});
test('each confirmed block has exactly one filter-based category and no URL fields', () => {
  const history = normalizeHistory(undefined, at(23));
  for (const id of ['ruleset_2', 'ruleset_3', 'ruleset_17', 'ruleset_90003', 'ruleset_90004', 'ruleset_4', 'ruleset_18', 'ruleset_19', 'ruleset_20', 'ruleset_21', 'ruleset_22', 'ruleset_214', '_dynamic']) {
    recordBlock(history, categoryForRuleset(id), at(23), at(23));
  }
  const view = statisticsView(history, 7, 'all', at(23));
  assert.deepEqual(view.counts, { ads: 1, privacy: 2, security: 2, annoyances: 6, vietnam: 1, custom: 1 });
  assert.equal(view.total, 13);
  assert.equal(statisticsView(history, 7, 'privacy', at(23)).total, 2);
  assert.deepEqual(Object.keys(history.days[0]).sort(), ['counts', 'date']);
});
test('adding the security category retains pre-1.14 daily history and rejects malformed new counts', () => {
  const old = { version: 1, startedAt: at(23), days: [{ date: localDay(at(23)), counts: { ads: 7, privacy: 3, annoyances: 1, vietnam: 2, custom: 4 } }] };
  const history = normalizeHistory(old, at(24));
  assert.equal(statisticsView(history, 7, 'all', at(24)).total, 17);
  assert.equal(history.days[0].counts.security, 0);
  recordBlock(history, 'security', at(24), at(24));
  assert.equal(statisticsView(history, 7, 'security', at(24)).total, 1);
  assert.equal(statisticsView(history, 7, 'all', at(24)).total, 18);
  for (const security of [-1, null, '0', 0.5]) {
    assert.deepEqual(normalizeHistory({ ...old, days: [{ ...old.days[0], counts: { ...old.days[0].counts, security } }] }, at(24)).days, []);
  }
});
test('daily buckets cross local midnight, month and year; selected ranges have independent totals', () => {
  const history = normalizeHistory(undefined, at(1));
  for (let day = 1; day <= 31; day++) recordBlock(history, 'ads', at(day), at(day));
  assert.equal(history.days.length, 30);
  assert.equal(history.days[0].date, localDay(at(2)));
  assert.equal(statisticsView(history, 7, 'all', at(31)).total, 7);
  assert.equal(statisticsView(history, 30, 'all', at(31)).total, 30);
  const midnight = normalizeHistory(undefined, at(23, 23));
  recordBlock(midnight, 'ads', at(23, 23), at(23, 23));
  recordBlock(midnight, 'privacy', at(24, 0), at(24, 0));
  assert.equal(midnight.days.length, 2);
  const newYear = new Date(2027, 0, 1, 12).getTime();
  const view = statisticsView(normalizeHistory(undefined, newYear), 7, 'all', newYear);
  assert.equal(view.points[0].date, '2026-12-26');
  assert.equal(view.points.at(-1)!.date, '2027-01-01');
});
test('out-of-order events, expiration and backwards clock changes keep history bounded', () => {
  const history = normalizeHistory(undefined, at(1));
  for (let day = 1; day <= 31; day++) recordBlock(history, 'custom', at(day), at(day));
  recordBlock(history, 'privacy', at(24), at(31));
  recordBlock(history, 'ads', at(1), at(31));
  assert.equal(history.days.length, 30);
  assert.equal(statisticsView(history, 7, 'all', at(31)).total, 7);
  assert.equal(statisticsView(history, 30, 'all', at(31)).total, 31);
  recordBlock(history, 'ads', at(20), at(20));
  assert(history.days.length <= 30);
  assert(history.days.every(day => day.date <= localDay(at(20))));
});
test('stored state is normalized once, bounded and isolated from the original object', () => {
  const history = normalizeHistory(undefined, at(23));
  recordBlock(history, 'vietnam', at(23), at(23));
  const copy = normalizeHistory(JSON.parse(JSON.stringify(history)), at(24));
  assert.equal(statisticsView(copy, 7, 'all', at(24)).total, 1);
  copy.days[0].counts.vietnam = 50;
  assert.equal(history.days[0].counts.vietnam, 1);
  const duplicate = normalizeHistory({ ...history, days: [history.days[0], history.days[0]] }, at(24));
  assert.equal(statisticsView(duplicate, 7, 'all', at(24)).total, 1);
  for (const value of [null, [], {}, { version: 2 }, { ...history, days: Array(31).fill(history.days[0]) }, { ...history, startedAt: Infinity }]) {
    assert.deepEqual(normalizeHistory(value, at(24)).days, []);
  }
  for (const invalid of [-1, NaN, Infinity, 0.2, Number.MAX_SAFE_INTEGER + 1, '1']) {
    const raw = { ...history, days: [{ date: localDay(at(23)), counts: { ...history.days[0].counts, ads: invalid } }] };
    assert.deepEqual(normalizeHistory(raw, at(24)).days, []);
  }
  assert.deepEqual(normalizeHistory({ ...history, days: [{ ...history.days[0], date: '2026-02-30' }] }, at(24)).days, []);
});
test('sum and increment stay exact and finite at safe-integer capacity', () => {
  const history = normalizeHistory(undefined, at(23));
  recordBlock(history, 'ads', at(23), at(23));
  for (const key of STAT_CATEGORIES) history.days[0].counts[key] = Number.MAX_SAFE_INTEGER;
  recordBlock(history, 'ads', at(23), at(23));
  assert.equal(statisticsView(history, 30, 'all', at(23)).total, Number.MAX_SAFE_INTEGER);
  assert(Number.isSafeInteger(history.days[0].counts.ads));
});
