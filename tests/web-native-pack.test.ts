import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Filter, parseCompactRuleset, RulesetWithSourceMap } from '@adguard/dnr-converter';
import { Engine, Request, RequestType } from '@adguard/tsurlfilter';
import { compileWebPack, validateWebSource, WEB_PACK_LIMITS } from '../scripts/web-native-pack.mjs';
import { GROUP_FILTER_IDS, selectedFilterIds, UPSTREAM_FILTER_IDS, WEB_SUPPLEMENT_FILTER_ID } from '../src/shared/filter-sources.ts';
import { categoryForRuleset } from '../src/shared/statistics.ts';
import { GENERIC_SDA_RULE, GENERIC_SDA_SELECTOR, expansionFixtures, renderExpansionFixture } from '../scripts/web-expansion-fixtures.mjs';

const network = [
  '||adsbynimbus.com^$third-party,script,image,xmlhttprequest,subdocument,media,ping',
  '||tiktokpangle.us^$third-party,script,image,xmlhttprequest,subdocument,media,ping',
];

test('Web pack permits only the four reviewed generic advertising targets and simple publisher CSS', async () => {
  const content = `##amp-sticky-ad\n##amp-embed[type="adsense"]\n##amp-embed[type="doubleclick"]\n${GENERIC_SDA_RULE}\nforum.lowyat.net###LYNBillboard\ncand.vn##.banner[id^="adsWeb_"][data-position^="Web_Ads"]\nbaoxaydung.vn##aside[aria-label="Quảng cáo"]\nbaodautu.vn###ads_share_right1\n`;
  const result = await compileWebPack(content);
  assert.equal(result.networkRules, 0);
  assert.equal(result.cosmeticRules, 8);
  assert.equal(result.genericCosmeticRules, 4);
  assert.deepEqual(result.publishers, ['baodautu.vn', 'baoxaydung.vn', 'cand.vn', 'forum.lowyat.net']);
  const compact = parseCompactRuleset('ruleset_90002', JSON.parse(result.serialized));
  assert.deepEqual(compact.declarativeRules, []);
  assert.equal(compact.filterContent, content);
});

test('Web native conversion retains exact request hosts, explicit types, third-party scope and source maps', async () => {
  const content = network.join('\n') + '\n';
  const result = await compileWebPack(content);
  assert.equal(result.networkRules, 2);
  assert.equal(result.cosmeticRules, 0);
  const compact = parseCompactRuleset('ruleset_90002', JSON.parse(result.serialized));
  const restored = RulesetWithSourceMap.fromCompact('ruleset_90002', compact, [new Filter(WEB_SUPPLEMENT_FILTER_ID, content)]);
  const originals = [];
  for (const rule of compact.declarativeRules) {
    assert.equal(rule.action.type, 'block');
    assert(!rule.condition.regexFilter);
    const sources = await restored.getRulesById(rule.id);
    assert.equal(sources.length, 1);
    assert.equal(sources[0]!.filterId, WEB_SUPPLEMENT_FILTER_ID);
    originals.push(sources[0]!.sourceRule);
    assert.equal(rule.condition.domainType, 'thirdParty');
    assert.equal(rule.condition.initiatorDomains, undefined);
    assert.deepEqual([...rule.condition.resourceTypes!].sort(), ['script', 'image', 'xmlhttprequest', 'sub_frame', 'media', 'ping'].sort());
  }
  assert.deepEqual(originals.sort(), [...network].sort());
});

test('reviewed network patterns preserve first-party, lookalike-host, resource-type and ordinary application requests', () => {
  const engine = Engine.createSync({ filters: [{ id: WEB_SUPPLEMENT_FILTER_ID, content: network.join('\n') }] });
  const blocked = (url: string, source: string, type = RequestType.Script) => {
    const rule = engine.matchRequest(new Request(url, source, type)).basicRule;
    return !!rule && !rule.isAllowlist();
  };
  for (const host of ['adsbynimbus.com', 'tiktokpangle.us']) {
    assert(blocked(`https://${host}/ad.js`, 'https://news.example.test/'));
    assert(blocked(`http://cdn.${host}/ad.js`, 'http://forum.example.test/'));
    assert(!blocked(`https://${host}/ad.js`, `https://www.${host}/`));
    assert(!blocked(`https://${host}.ordinary.test/ad.js`, 'https://news.example.test/'));
    assert(!blocked(`https://ordinary-${host}/ad.js`, 'https://news.example.test/'));
    assert(!blocked(`https://${host}/font.woff2`, 'https://news.example.test/', RequestType.Font));
    assert(!blocked(`https://${host}/`, 'https://news.example.test/', RequestType.Document));
  }
  for (const path of ['/login.js', '/api/cart', '/payment/submit', '/video/content.mp4']) {
    assert(!blocked(`https://www.hktvmall.com${path}`, 'https://www.hktvmall.com/'));
  }
});

test('Web admission rejects broad generic CSS, procedural scans, executable rules and unreviewed network scope', () => {
  for (const rule of [
    '##.ad', '##amp-embed', '##amp-iframe', '##img[width="320"][height="50"]',
    '##amp-embed[type="analytics"]', '##amp-embed[type^="ad"]', '##amp-sticky-ad,article',
    '##.rennab', '##[id^="sdaWeb_"]', '##.rennab[id^="sdaWeb_"]',
    '##.rennab[data-position^="Web_Sda"]', '##.rennab[id^="sdaWeb_"][data-position]',
    '##.rennab[id^="sdaWeb_"][data-position^="Web_"]',
    'example.com##body', 'example.com##div:has(.ad)', 'example.com#?#div:contains(Sponsored)',
    'example.com##+js(set-constant, ad, false)', 'example.com#%#alert(1)',
    '~example.com##.ad', 'com.vn##.ad', 'example.com#@#.ad',
    '||ordinary.example^$third-party,script,image,xmlhttprequest,subdocument,media,ping',
    '||adsbynimbus.com/path$third-party,script,image,xmlhttprequest,subdocument,media,ping',
    '||adsbynimbus.com^$script,image,xmlhttprequest,subdocument,media,ping',
    '||adsbynimbus.com^$third-party,script,image,xmlhttprequest,subdocument,media,ping,font',
    '||adsbynimbus.com^$third-party,script,image,xmlhttprequest,subdocument,media,ping,redirect=noopjs',
    '||ad-splash.hktvmall.com^$script,image,xmlhttprequest',
    '||ad-splash.hktvmall.com^$script,image,xmlhttprequest,domain=~hktvmall.com',
    '||ad-splash.hktvmall.com^$script,image,xmlhttprequest,domain=hktvmall.com|ordinary.example',
    '@@||ad-splash.hktvmall.com^$script,image,xmlhttprequest,domain=hktvmall.com',
    '/ads\\d+/$script',
  ]) assert.throws(() => validateWebSource(rule), undefined, rule);
});

test('Web admission enforces duplicate/source/rule budgets and reports exact source lines', () => {
  assert.throws(() => validateWebSource('##amp-sticky-ad\n##amp-sticky-ad'), /safora-web\.txt:2: Duplicate rule/);
  assert.throws(() => validateWebSource('!'.repeat(WEB_PACK_LIMITS.bytes + 1)), /byte budget/);
  assert.throws(() => validateWebSource(Array.from({ length: WEB_PACK_LIMITS.rules + 1 }, (_, index) => `publisher.example##.ad-${index}`).join('\n')), /rule budget/);
  assert.throws(() => validateWebSource('! Header\n\n##amp-embed'), /safora-web\.txt:3:/);
  assert.throws(() => validateWebSource('##amp-sticky-ad\0'), /NUL/);
});

test('Web supplement follows Ads group and statistics while retaining ten independent upstream lists', () => {
  assert.deepEqual(GROUP_FILTER_IDS.ads, [2, WEB_SUPPLEMENT_FILTER_ID]);
  assert.equal(categoryForRuleset('ruleset_90002'), 'ads');
  assert.equal(UPSTREAM_FILTER_IDS.length, 10);
  assert(!UPSTREAM_FILTER_IDS.includes(WEB_SUPPLEMENT_FILTER_ID));
  assert(selectedFilterIds({ ads: true, privacy: false, security: false, annoyances: false, vietnam: false }).includes(WEB_SUPPLEMENT_FILTER_ID));
  assert(!selectedFilterIds({ ads: false, privacy: true, security: true, annoyances: true, vietnam: true }).includes(WEB_SUPPLEMENT_FILTER_ID));
});

test('authored Web pack compiles deterministically with complete source provenance', async () => {
  const content = await readFile(new URL('../src/filters/safora-web.txt', import.meta.url), 'utf8');
  const source = validateWebSource(content);
  const first = await compileWebPack(content);
  const second = await compileWebPack(content);
  assert.equal(first.serialized, second.serialized);
  assert.equal(first.sourceSha256, createHash('sha256').update(content).digest('hex'));
  assert.equal(first.sourceBytes, Buffer.byteLength(content));
  assert.equal(first.sourceRules, source.network.length + source.cosmetic.length);
  assert.equal(first.genericCosmeticRules, 4);
  assert.deepEqual(first.publishers, source.publishers);
});

test('generic SDA exceptions remain independent of preserved Vietnam-scoped hiding', () => {
  const vietnamRule = `tienphong.vn##${GENERIC_SDA_SELECTOR}`;
  const matched = (host: string, exceptions = '') => {
    const engine = Engine.createSync({ filters: [
      { id: WEB_SUPPLEMENT_FILTER_ID, content: GENERIC_SDA_RULE },
      { id: 90001, content: vietnamRule },
      { id: 0, content: exceptions },
    ] });
    const url = `https://${host}/`;
    const request = new Request(url, url, RequestType.Document);
    const options = engine.matchRequest(request).getCosmeticOption();
    const styles = engine.getCosmeticResult(request, options).elementHiding;
    return { generic: styles.generic.map(rule => rule.getContent()), specific: styles.specific.map(rule => rule.getContent()) };
  };
  assert.deepEqual(matched('congluan.vn'), { generic: [GENERIC_SDA_SELECTOR], specific: [] });
  assert.deepEqual(matched('congluan.vn', '@@||congluan.vn^$generichide'), { generic: [], specific: [] });
  assert.deepEqual(matched('tienphong.vn', '@@||tienphong.vn^$generichide'), { generic: [], specific: [GENERIC_SDA_SELECTOR] });
  assert.deepEqual(matched('tienphong.vn', `tienphong.vn#@#${GENERIC_SDA_SELECTOR}`), { generic: [], specific: [] });
  assert.deepEqual(matched('sda.expansion.example.test', `congluan.vn#@#${GENERIC_SDA_SELECTOR}`), { generic: [GENERIC_SDA_SELECTOR], specific: [] });
});

test('expansion fixtures render ordinary controls and explicit baseline/group-interaction metadata', () => {
  assert.equal(expansionFixtures.length, 5);
  assert.deepEqual(expansionFixtures.filter(fixture => fixture.baselineHidden).map(fixture => fixture.host), ['tienphong.vn']);
  for (const fixture of expansionFixtures) {
    const html = renderExpansionFixture(fixture);
    assert(html.includes(fixture.ads));
    for (const id of ['reply-form', 'checkout', 'login-form', 'buy', 'ordinary-media', 'play-media']) assert(html.includes(`id="${id}"`));
    assert(!renderExpansionFixture(fixture, { includeAds: false }).includes(fixture.ads));
    assert(fixture.positiveSelectors.length > 0 && fixture.controlSelectors.length > 20);
  }
  assert.throws(() => renderExpansionFixture({ ...expansionFixtures[0] }), /Unknown expansion fixture/);
});
