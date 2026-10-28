import assert from 'node:assert/strict';
import test from 'node:test';
import { createDomainLookup } from '../src/shared/domain-index.ts';
import { isAllowed } from '../src/shared/defaults.ts';
import { createFilterMetadataLoader } from '../src/shared/filter-metadata.ts';
import { hasBlockRule } from '../src/shared/block-index.ts';

test('indexed allowlist preserves linear semantics for nested, sibling, deceptive and IDN hosts', () => {
  const domains = Array.from({ length: 1000 }, (_, i) => `site${i}.example`);
  domains.push('xn--tnmin-hsa0954c.vn', 'private.example.com');
  const lookup = createDomainLookup(domains);
  for (const domain of domains) for (const host of [domain, `news.${domain}`, `deep.news.${domain}`, `evil${domain}`, `${domain}.evil`, '']) assert.equal(lookup(host), isAllowed(host, domains), host);
  assert.equal(lookup('public.example.com'), false);
  assert.equal(lookup('example.com'), false);
});

test('policy index is an immutable snapshot replaced explicitly on committed settings changes', () => {
  const list = ['example.com'];
  const before = createDomainLookup(list);
  list[0] = 'other.test';
  const after = createDomainLookup(list);
  assert(before('news.example.com')); assert(!after('news.example.com'));
  assert(after('other.test')); assert(!before('other.test'));
});

const metadata = { builtAt: 'fixture', blockIndex: { path: 'filters/block-index.bin', bytes: 8, sha256: '' }, filters: [{ id: 2, name: 'Base', group: 'ads', networkRules: 2, blockRuleIndex: { offset: 0, count: 2 } }] };
function binary(): ArrayBuffer { const data = new DataView(new ArrayBuffer(8)); data.setUint32(0, 7, true); data.setUint32(4, 9, true); return data.buffer; }

test('metadata-only access never reads the binary counting index; concurrent debug readers share one fetch', async () => {
  const calls: string[] = [];
  const loader = createFilterMetadataLoader(async path => { calls.push(path); return path.endsWith('.json') ? Response.json(metadata) : new Response(binary()); });
  await Promise.all([loader.loadSnapshot(), loader.loadSnapshot()]);
  assert.deepEqual(calls, ['filter-snapshot.json']);
  const [first, second] = await Promise.all([loader.loadBlockIndex(), loader.loadBlockIndex()]);
  assert.equal(first, second); assert.deepEqual(calls, ['filter-snapshot.json', 'filters/block-index.bin']);
  assert(hasBlockRule(first.data, first.ranges.get('ruleset_2')!, 9));
  assert(!hasBlockRule(first.data, first.ranges.get('ruleset_2')!, 8));
});

test('binary read failure is retryable without refetching valid metadata or returning incomplete counts', async () => {
  let attempts = 0;
  const loader = createFilterMetadataLoader(async path => {
    if (path.endsWith('.json')) return Response.json(metadata);
    return ++attempts === 1 ? new Response(new ArrayBuffer(4)) : new Response(binary());
  });
  await assert.rejects(loader.loadBlockIndex(), /Kích thước/);
  const loaded = await loader.loadBlockIndex(); assert.equal(attempts, 2); assert.equal(loaded.data.byteLength, 8);
});

test('invalid ranges fail metadata validation before allocating or fetching binary data', async () => {
  let reads = 0;
  const loader = createFilterMetadataLoader(async () => { reads++; return Response.json({ ...metadata, filters: [{ ...metadata.filters[0], blockRuleIndex: { offset: 4, count: 2 } }] }); });
  await assert.rejects(loader.loadSnapshot(), /Phạm vi/); assert.equal(reads, 1);
});
