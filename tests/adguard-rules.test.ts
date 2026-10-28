import test from 'node:test';
import assert from 'node:assert/strict';
import { CosmeticOption, Engine, FilterList, Request, RequestType } from '@adguard/tsurlfilter';
import {validateUserRules,normalizeLegacyRules,prepareUserRules} from '../src/shared/adguard-rules.ts';
import {GROUP_FILTER_IDS,FILTER_SOURCES,UPSTREAM_FILTER_IDS,VIETNAM_SUPPLEMENT_FILTER_ID,WEB_SUPPLEMENT_FILTER_ID} from '../src/shared/filter-sources.ts';

test('official parser accepts native DNR removeparam, regex, important and scoped exceptions',()=>{
  assert.deepEqual(validateUserRules('||ads.example.com^$important\n||example.com^$removeparam=utm_source\n@@||account.example.com^$document\n/ads\\d+/$script'),[]);
});
test('official cosmetic parser accepts native, Extended CSS and both scriptlet syntaxes',()=>{
  assert.deepEqual(validateUserRules('example.com##.banner\nexample.com#?#div:has-text(Advertisement)\nexample.com##+js(set-constant, adblock, false)\nexample.com#%#//scriptlet("abort-on-property-read", "adblock")'),[]);
});
test('arbitrary JavaScript and unknown modifiers are diagnosed with exact line numbers',()=>{
  const errors=validateUserRules('! Comment\n||ads.example.com^$not-a-real-option\nexample.com#%#alert(1)');
  assert.deepEqual(errors.map(error=>error.line),[2,3]);assert.match(errors[1]!.message,/JavaScript/);
});
test('legacy three-scriptlet syntax migrates into actual uBO-compatible engine input',()=>{
  const normalized=normalizeLegacyRules('example.com#+js(set-constant, adblock, false)\nexample.com##.ad');
  assert.equal(normalized,'example.com##+js(set-constant, adblock, false)\nexample.com##.ad');assert.deepEqual(validateUserRules(normalized),[]);assert.equal(normalizeLegacyRules(normalized),normalized);assert.equal(normalizeLegacyRules('example.com##+js(set-constant, flag, true)'),'example.com##+js(set-constant, flag, true)');
});
test('full source groups include ABPVN and avoid disabled/ad-unblocking filter IDs',()=>{
  assert.deepEqual(GROUP_FILTER_IDS.ads,[2,WEB_SUPPLEMENT_FILTER_ID]);assert.deepEqual(GROUP_FILTER_IDS.vietnam,[214,VIETNAM_SUPPLEMENT_FILTER_ID]);assert.deepEqual(GROUP_FILTER_IDS.security,[90003,90004]);assert(FILTER_SOURCES.length===14);assert(UPSTREAM_FILTER_IDS.length===10);assert(!FILTER_SOURCES.some(source=>([10,24] as number[]).includes(source.id)));
});
test('oversized personal input is rejected before parsing',()=>{
  assert.equal(validateUserRules('a'.repeat(250001)).length,1);assert.equal(validateUserRules('!\n'.repeat(5001)).length,1);
});

function personalEngine(content: string) {
  return Engine.createSync({ filters: [{ id: 0, content: new FilterList(content, 0) }] });
}
function blocks(content: string, url: string): boolean {
  const rule = personalEngine(content).matchRequest(new Request(url, 'https://publisher.example/', RequestType.Script)).basicRule;
  return !!rule && !rule.isAllowlist();
}

test('disabling scriptlets preserves network and CSS rules with literal scriptlet markers', () => {
  const source = '||assets.example/path+js(foo^\r\n||assets.example/path//scriptlet(foo^\n'
    + 'publisher.example##[data-label="+js(ad)"]\rpublisher.example##[data-label="//scriptlet(ad)"]';
  assert.deepEqual(validateUserRules(source), []);
  assert.equal(prepareUserRules(source, false), source);
  assert(blocks(prepareUserRules(source, false), 'https://assets.example/path+js(foo/ad.js'));
  assert(blocks(prepareUserRules(source, false), 'https://assets.example/path//scriptlet(foo/ad.js'));
});

test('scriptlet toggle applies to AdGuard, uBO, ABP and exception syntax without dropping other exceptions', () => {
  const source = [
    'publisher.example#%#//scriptlet("abort-on-property-read", "guard")',
    'publisher.example##+js(set-constant, adblock, false)',
    'publisher.example#$#abort-on-property-write guard',
    'publisher.example#@%#//scriptlet("abort-on-property-read", "excepted")',
    'publisher.example#@#+js(set-constant, excepted, false)',
    '@@||publisher.example^$jsinject',
  ].join('\r\n');
  assert.deepEqual(validateUserRules(source), []);
  const disabled = prepareUserRules(source, false);
  assert.equal(disabled.length, source.length);
  assert.deepEqual(disabled.match(/\r\n/g), source.match(/\r\n/g));
  assert(disabled.split('\r\n').slice(0, 5).every(line => line.startsWith('!')));
  assert(disabled.endsWith('@@||publisher.example^$jsinject'));
  const abp = 'publisher.example#$#abort-on-property-read guard';
  const request = new Request('https://publisher.example/', 'https://publisher.example/', RequestType.Document);
  assert.equal(personalEngine(abp).getCosmeticResult(request, CosmeticOption.CosmeticOptionAll).getScriptRules().length, 1);
  assert.equal(personalEngine(prepareUserRules(abp, false)).getCosmeticResult(request, CosmeticOption.CosmeticOptionAll).getScriptRules().length, 0);
  assert.equal(prepareUserRules(abp, true), abp);
});

test('personal conditional rules use the Chromium MV3 branch before engine conversion', () => {
  const source = '!#if env_firefox\n||account.example^$script\n!#else\n||ads.example^$script\n!#endif';
  // The upstream FilterList does syntax conversion, not platform preprocessing.
  // Previously both branches reached the engine and blocked the benign account.
  assert(blocks(source, 'https://account.example/login.js'));
  assert(blocks(source, 'https://ads.example/banner.js'));
  const effective = prepareUserRules(source, true);
  assert.equal(effective.length, source.length);
  assert.equal(blocks(effective, 'https://account.example/login.js'), false);
  assert(blocks(effective, 'https://ads.example/banner.js'));
  assert.deepEqual(validateUserRules(source), []);
  assert(source.includes('!#if env_firefox'));
});

test('personal conditional validation ignores inactive syntax and retains active diagnostic line numbers', () => {
  const source = '!#if env_firefox\r\naccount.example#%#arbitraryJavaScript()\r\n!#else\r\n||ads.example^$not-a-real-option\r\n!#endif';
  const diagnostics = validateUserRules(source);
  assert.deepEqual(diagnostics.map(error => error.line), [4]);
  assert.equal(validateUserRules(source.replace('$not-a-real-option', '$script')).length, 0);
  for (const directive of ['!#if unknown_capability\n!#endif', '!#include remote.txt', '!#if env_mv3']) {
    assert.throws(() => prepareUserRules(directive, true), /Bộ tiền xử lý dòng 1:/);
    assert.deepEqual(validateUserRules(directive).map(error => error.line), [1]);
  }
});
