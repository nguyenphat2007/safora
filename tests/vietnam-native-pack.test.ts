import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Filter, parseCompactRuleset, RulesetWithSourceMap } from '@adguard/dnr-converter';
import { compileVietnamPack, validateVietnamSource, VIETNAM_PACK_LIMITS } from '../scripts/vietnam-native-pack.mjs';
import { FILTER_SOURCES, GROUP_FILTER_IDS, selectedFilterIds, VIETNAM_SUPPLEMENT_FILTER_ID } from '../src/shared/filter-sources.ts';
import { categoryForRuleset } from '../src/shared/statistics.ts';

test('Vietnam native conversion preserves explicit publisher, first-party, resource-type boundaries and reversible source maps', async () => {
  const content = '! Fixture only\n||publisher.example/assets/ad.js$script,~third-party,domain=publisher.example\npublisher.example##div.ad-slot[data-type="ad"]\n';
  const result = await compileVietnamPack(content);
  assert.equal(result.networkRules, 1);
  assert.equal(result.cosmeticRules, 1);
  const compact = parseCompactRuleset('ruleset_90001', JSON.parse(result.serialized));
  assert.equal(compact.filterContent, content);
  const [rule] = compact.declarativeRules;
  assert.equal(rule.action.type, 'block');
  assert.deepEqual(rule.condition, { urlFilter: '||publisher.example/assets/ad.js', initiatorDomains: ['publisher.example'], resourceTypes: ['script'], domainType: 'firstParty' });
  const restored = RulesetWithSourceMap.fromCompact('ruleset_90001', compact, [new Filter(VIETNAM_SUPPLEMENT_FILTER_ID, content)]);
  const originals = await restored.getRulesById(rule.id);
  assert.equal(originals.length, 1);
  assert.equal(originals[0].filterId, VIETNAM_SUPPLEMENT_FILTER_ID);
  assert.equal(originals[0].sourceRule, content.split('\n')[1]);
});

test('CSS-only supplement carries ordinary engine metadata without synthetic counted network blocks', async () => {
  const content = 'publisher.example##.advertisement-wrapper\n';
  const result = await compileVietnamPack(content);
  assert.equal(result.networkRules, 0);
  assert.equal(result.cosmeticRules, 1);
  const compact = parseCompactRuleset('ruleset_90001', JSON.parse(result.serialized));
  assert.deepEqual(compact.declarativeRules, []);
  assert.equal(compact.filterContent, content);
  assert.equal(compact.metadata.safeRulesCount, 0);
});

test('supplement rejects generic scope, procedural scans, scriptlets, JavaScript and unsafe network actions', () => {
  for (const rule of [
    '##.ad-slot', '~publisher.example##.ad-slot', '*.example##.ad-slot', 'com.vn##.ad-slot',
    'publisher.example##body', 'publisher.example##.ad-slot,.article', 'publisher.example##div:has(.ad)',
    'publisher.example#?#div:has-text(Advertisement)', 'publisher.example##+js(set-constant, x, 1)',
    'publisher.example#%#alert(1)', 'publisher.example#@$#.ad { color: red; }',
    '||ads.example^$script', '||ads.example^$domain=publisher.example',
    '||ads.example^$script,domain=~publisher.example', '||ads.example^$script,domain=*',
    '||ads.example^$document,domain=publisher.example', '||ads.example^$script,domain=publisher.example,important',
    '||ads.example^$script,domain=publisher.example,redirect=noopjs',
    '||ads.example^$script,domain=publisher.example,removeparam=tracking',
    '||ads.example^$script,domain=publisher.example,cookie=advertising',
    '@@||ads.example^$script,domain=publisher.example', '/ad\\d+/$script,domain=publisher.example',
    '||ads.example^$script,domain=publisher.example,third-party,~third-party',
  ]) assert.throws(() => validateVietnamSource(rule), undefined, rule);
});

test('supplement rejects malformed selectors, duplicate rules and source/rule budgets before conversion', () => {
  for (const selector of ['.ad >', '> .ad', '.ad > > .banner', '.ad{display:none}', '.ad:style(display:none)', '.ad\\x', '[class="ad"', '.ad +']) {
    assert.throws(() => validateVietnamSource(`publisher.example##${selector}`), undefined, selector);
  }
  assert.throws(() => validateVietnamSource('publisher.example##.ad\npublisher.example##.ad'), /Duplicate rule/);
  assert.throws(() => validateVietnamSource('!'.repeat(VIETNAM_PACK_LIMITS.bytes + 1)), /byte budget/);
  assert.throws(() => validateVietnamSource(Array.from({ length: VIETNAM_PACK_LIMITS.rules + 1 }, (_, index) => `publisher.example##.ad-${index}`).join('\n')), /rule budget/);
});

test('native supplement follows the existing Vietnam toggle and statistics category without new runtime polling', () => {
  assert.equal(FILTER_SOURCES.filter(source => source.id === VIETNAM_SUPPLEMENT_FILTER_ID).length, 1);
  assert.deepEqual(GROUP_FILTER_IDS.vietnam, [214, VIETNAM_SUPPLEMENT_FILTER_ID]);
  assert.equal(categoryForRuleset('ruleset_90001'), 'vietnam');
  const disabled = selectedFilterIds({ ads: true, privacy: true, security: true, annoyances: false, vietnam: false });
  assert(!disabled.includes(VIETNAM_SUPPLEMENT_FILTER_ID));
  const enabled = selectedFilterIds({ ads: true, privacy: true, security: true, annoyances: false, vietnam: true });
  assert(enabled.includes(VIETNAM_SUPPLEMENT_FILTER_ID) && enabled.includes(214));
});

test('checked-in authored supplement converts deterministically and retains source hash and rule counts', async () => {
  const content = await readFile(new URL('../src/filters/safora-vietnam.txt', import.meta.url), 'utf8');
  const source = validateVietnamSource(content);
  const first = await compileVietnamPack(content);
  const second = await compileVietnamPack(content);
  assert.equal(first.serialized, second.serialized);
  assert.equal(first.sourceSha256, createHash('sha256').update(content).digest('hex'));
  assert.equal(first.sourceRules, source.network.length + source.cosmetic.length);
  assert.equal(first.cosmeticRules, source.cosmetic.length);
  assert.deepEqual(first.publishers, source.publishers);
});
