import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Filter, parseCompactRuleset, RulesetWithSourceMap } from '@adguard/dnr-converter';
import { Engine, Request, RequestType } from '@adguard/tsurlfilter';
import {
  compilePinnedUbolSource, compileUbolPack, prepareUbolNetworkSource,
  UBOL_FILTER_IDS, UBOL_PACK_LIMITS, UBOL_SOURCE_MANIFEST,
} from '../scripts/ubol-native-pack.mjs';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function descriptor(content: string, extra = {}) {
  return { id: 90003, name: 'Test security list', format: 'ublock-filter-list',
    sha256: hash(content), bytes: Buffer.byteLength(content),
    version: '20261026000000', updated: '2026-10-26T00:00:00Z',
    url: 'https://example.test/security.txt', license: 'CC0-1.0', ...extra };
}
function rulesOf(result: { serialized: string }, id = 90003) {
  return parseCompactRuleset(`ruleset_${id}`, JSON.parse(result.serialized)).declarativeRules;
}
function isBlocked(content: string, url: string, source: string, type = RequestType.Script) {
  const rule = Engine.createSync({ filters: [{ id: 90003, content }] })
    .matchRequest(new Request(url, source, type)).basicRule;
  return !!rule && !rule.isAllowlist();
}

test('pinned security input fails closed on corruption, format, byte size and invalid syntax', () => {
  const source = '||blocked.example^$script';
  assert.throws(() => prepareUbolNetworkSource(`${source}\n`, descriptor(source)), /checksum changed/);
  assert.throws(() => prepareUbolNetworkSource(source, descriptor(source, { bytes: 1 })), /byte size changed/);
  assert.throws(() => prepareUbolNetworkSource(source, descriptor(source, { id: 1 })), /Unknown uBOL/);
  assert.throws(() => prepareUbolNetworkSource(source, descriptor(source, { format: 'unknown' })), /source format/);
  assert.throws(() => prepareUbolNetworkSource(`${source}\0`, descriptor(`${source}\0`)), /NUL/);
  const large = '!'.repeat(UBOL_PACK_LIMITS.bytes + 1);
  assert.throws(() => prepareUbolNetworkSource(large, descriptor(large)), /byte budget/);
  assert.throws(() => prepareUbolNetworkSource('!#include remote.txt', descriptor('!#include remote.txt')), /nguồn từ xa/);
  const unknown = '!#if unknown_capability\n||bad.example^\n!#endif';
  assert.throws(() => prepareUbolNetworkSource(unknown, descriptor(unknown)), /unknown/i);
});

test('security conversion retains resource types, request/initiator domains, party constraints and source maps', async () => {
  const source = '||bad.example/path^$script,xhr,3p,domain=publisher.example|~account.publisher.example,to=bad.example\n'
    + '@@||bad.example/path-safe^$script,domain=publisher.example\n'
    + '||first.example/pixel^$image,1p';
  const result = await compilePinnedUbolSource(source, descriptor(source));
  const compact = parseCompactRuleset('ruleset_90003', JSON.parse(result.serialized));
  const restored = RulesetWithSourceMap.fromCompact('ruleset_90003', compact, [new Filter(90003, result.content)]);
  const sources = new Set<string>();
  for (const rule of compact.declarativeRules) {
    for (const original of await restored.getRulesById(rule.id)) sources.add(original.sourceRule);
  }
  assert.deepEqual([...sources].sort(), source.split('\n').sort());
  const block = compact.declarativeRules.find(rule => rule.condition.urlFilter === '||bad.example/path^')!;
  assert.equal(block.action.type, 'block');
  assert.deepEqual(block.condition.resourceTypes?.sort(), ['script', 'xmlhttprequest']);
  assert.equal(block.condition.domainType, 'thirdParty');
  assert.deepEqual(block.condition.initiatorDomains, ['publisher.example']);
  assert.deepEqual(block.condition.excludedInitiatorDomains, ['account.publisher.example']);
  assert.deepEqual(block.condition.requestDomains, ['bad.example']);
  const allow = compact.declarativeRules.find(rule => rule.action.type === 'allow')!;
  assert((allow.priority ?? 1) > (block.priority ?? 1));
  assert(isBlocked(result.content, 'https://bad.example/path?x=1', 'https://publisher.example/'));
  assert(!isBlocked(result.content, 'https://bad.example/path?x=1', 'https://account.publisher.example/'));
  assert(!isBlocked(result.content, 'https://bad.example/path?x=1', 'https://unrelated.example/'));
  assert(!isBlocked(result.content, 'https://bad.example/path-safe?x=1', 'https://publisher.example/'));
  assert(!isBlocked(result.content, 'https://bad.example.evil.test/path', 'https://publisher.example/'));
  assert(!isBlocked(result.content, 'https://bad.example/path', 'https://publisher.example/', RequestType.Image));
  const firstParty = compact.declarativeRules.find(rule => rule.condition.urlFilter === '||first.example/pixel^')!;
  assert.equal(firstParty.condition.domainType, 'firstParty');
});

test('HOSTS input validates domains and maps host boundaries to all request types without path truncation', async () => {
  const source = '# Title: fixture\n0.0.0.0 malware.example\n0.0.0.0 second.example\n';
  const result = await compilePinnedUbolSource(source, descriptor(source, { id: 90004, format: 'hosts' }));
  assert.equal(result.summary.inputRules, 2);
  assert.equal(result.networkRules, 2);
  assert(result.content.includes('||malware.example^$all'));
  assert(rulesOf(result, 90004).every(rule => rule.condition.resourceTypes?.includes('main_frame')));
  assert(isBlocked(result.content, 'https://cdn.malware.example/file', 'https://normal.example/'));
  assert(isBlocked(result.content, 'https://malware.example/', 'https://normal.example/', RequestType.Document));
  assert(!isBlocked(result.content, 'https://malware.example.safe.test/file', 'https://normal.example/'));
  for (const invalid of ['0.0.0.0 malware.example/path', '0.0.0.0 127.0.0.1', '127.0.0.1 malware.example',
    '0.0.0.0 -bad.example', '0.0.0.0 malware.example other.example', '0.0.0.0 localhost']) {
    assert.throws(() => prepareUbolNetworkSource(invalid, descriptor(invalid, { format: 'hosts' })), /HOSTS/);
  }
});

test('unsupported block rules and all cosmetic/scriptlet syntax are reported whole, never broadened', async () => {
  const rejected = ['||bad.example^$popup', '||bad.example^$doc,ipaddress=192.0.2.1',
    '||bad.example^$script,redirect=noopjs', '||bad.example^$script,strict3p',
    '/bad[0-9]+/$script', 'site.example##.ad', '##.generic-ad',
    'site.example##+js(set, advertisement, false)'];
  const source = ['||retained.example^$script', ...rejected].join('\n');
  const result = await compilePinnedUbolSource(source, descriptor(source));
  assert.equal(result.networkRules, 1);
  assert.equal(result.summary.inputRules, 9);
  assert.equal(result.summary.sourceCosmeticRules, 3);
  assert.equal(result.summary.rejectedRules, 8);
  assert.deepEqual(result.rejectedRules.map(item => item.rule), rejected);
  assert(result.rejectedRules.every(item => item.reason && item.line > 1));
  assert(!isBlocked(result.content, 'https://bad.example/payload', 'https://normal.example/'));
  assert(result.content.split('\n').filter(line => line && !line.startsWith('!')).every(line => line === '||retained.example^$script'));
  for (const rule of ['@@||bad.example^$popup', '@@||bad.example^$doc', '@@/bad[0-9]+/$script']) {
    await assert.rejects(compilePinnedUbolSource(`${rule}\n||retained.example^`, descriptor(`${rule}\n||retained.example^`)), /exception/i);
  }
});

test('preprocessor and duplicate accounting retain only the active Safora branch with exact diagnostics', async () => {
  const source = '!#if ext_ubol\n||ubol-only.example^\n!#else\n||safora.example^\n!#endif\n'
    + '!#if env_mobile\n@@||mobile.example^$doc\n!#endif\n||safora.example^';
  const result = await compilePinnedUbolSource(source, descriptor(source));
  assert.equal(result.summary.inputRules, 4);
  assert.equal(result.summary.inactiveRules, 2);
  assert.equal(result.summary.duplicateRules, 1);
  assert.equal(result.summary.acceptedNetworkRules, 1);
  assert.equal(result.networkRules, 1);
  assert.equal(result.inactiveRules[0]!.line, 2);
  assert(!isBlocked(result.content, 'https://ubol-only.example/script', 'https://normal.example/'));
});

test('badfilter cancels exactly the matching local rule and fails when its target is in another list', async () => {
  const source = '||cancel.example^$script\n||cancel.example^$script,badfilter\n||keep.example^$script';
  const result = await compilePinnedUbolSource(source, descriptor(source));
  assert.equal(result.networkRules, 1);
  assert.equal(result.summary.badfilterRules, 1);
  assert.equal(result.summary.cancelledRules, 1);
  assert.equal(rulesOf(result)[0]!.condition.urlFilter, '||keep.example^');
  const external = '||cancel.example^$script,badfilter\n||keep.example^$script';
  await assert.rejects(compilePinnedUbolSource(external, descriptor(external)), /Cross-list.*badfilter/);
});

test('reviewed document exceptions conservatively exempt a host without a global allowAllRequests action', async () => {
  const exception = '@@||toss.onelink.me/*service.toss.im$doc,1p';
  const source = `/malware-$doc\n/badware-$all,to=me\n||other.example^$doc\n${exception}`;
  const result = await compilePinnedUbolSource(source, descriptor(source, { conservativeExceptions: [
    { rule: exception, host: 'toss.onelink.me', reason: 'Retain this document exception through a conservative per-list host exemption' },
  ] }));
  assert.equal(result.summary.transformedRules, 2);
  assert.equal(result.summary.rejectedRules, 1);
  assert(!result.content.split('\n').some(line => line.startsWith('@@')));
  assert(rulesOf(result).every(rule => rule.action.type === 'block'));
  assert.equal(rulesOf(result).filter(rule => rule.condition.excludedRequestDomains?.includes('toss.onelink.me')).length, 2);
  assert(!isBlocked(result.content, 'https://toss.onelink.me/malware-service.toss.im', 'https://toss.onelink.me/', RequestType.Document));
  assert(isBlocked(result.content, 'https://normal.example/malware-file', 'https://normal.example/', RequestType.Document));
  assert(isBlocked(result.content, 'https://other.example/', 'https://normal.example/', RequestType.Document));
});

test('checked-in sources compile reproducibly to their reviewed exact accounting without runtime code or regex', async () => {
  assert.equal(UBOL_SOURCE_MANIFEST.schemaVersion, 1);
  assert.deepEqual(UBOL_SOURCE_MANIFEST.filters.map(item => item.id), [...UBOL_FILTER_IDS]);
  for (const source of UBOL_SOURCE_MANIFEST.filters) {
    const content = await readFile(new URL(`../${source.sourcePath}`, import.meta.url), 'utf8');
    const first = await compileUbolPack(source.id, content);
    const second = await compileUbolPack(source.id, content);
    assert.equal(first.serialized, second.serialized);
    assert.equal(first.sourceSha256, hash(content));
    assert.deepEqual(first.summary, source.expected);
    assert.equal(first.summary.inputRules, first.summary.acceptedNetworkRules + first.summary.inactiveRules
      + first.summary.duplicateRules + first.summary.rejectedRules);
    assert.equal(first.summary.regexRules, 0);
    assert(rulesOf(first, source.id).every(rule => rule.action.type === 'block' && !rule.condition.regexFilter));
    assert(first.content.split('\n').filter(line => line && !line.startsWith('!')).every(line => !line.includes('##')));
    for (const license of source.licenseFiles) assert((await readFile(new URL(`../${license}`, import.meta.url), 'utf8')).length > 500);
  }
});
