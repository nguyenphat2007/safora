import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Filter, FilterConverter, parseCompactRuleset } from '@adguard/dnr-converter';
import { CosmeticRule, NetworkRule } from '@adguard/tsurlfilter';
import { RuleParser } from '@adguard/agtree/parser';
import { WEB_SUPPLEMENT_FILTER_ID } from '../src/shared/filter-sources.ts';
import { validateVietnamSource } from './vietnam-native-pack.mjs';

export const WEB_SOURCE_PATH = 'src/filters/safora-web.txt';
export const WEB_PACK_LIMITS = Object.freeze({ bytes: 64 * 1024, rules: 128 });
const genericAdComponents = new Set([
  '##amp-sticky-ad',
  '##amp-embed[type="adsense"]',
  '##amp-embed[type="doubleclick"]',
  '##.rennab[id^="sdaWeb_"][data-position^="Web_Sda"]',
]);
const advertisingResourceTypes = ['script', 'image', 'xmlhttprequest', 'subdocument', 'media', 'ping'];
// Dedicated ad hosts and their exact reviewed scope are the admission boundary.
// Adding another host or broadening types/party requires an explicit policy edit.
const networkPolicies = new Map([
  ['||adsbynimbus.com^', { types: advertisingResourceTypes, party: 'third-party' }],
  ['||tiktokpangle.us^', { types: advertisingResourceTypes, party: 'third-party' }],
]);
const dnrType = type => type === 'subdocument' ? 'sub_frame' : type;

function networkPolicy(line) {
  const separator = line.lastIndexOf('$');
  assert(separator > 0, 'Network rules require their reviewed resource and publisher/party scope');
  const pattern = line.slice(0, separator);
  const policy = networkPolicies.get(pattern);
  assert(policy, 'Unreviewed advertising host or URL pattern');
  const modifiers = line.slice(separator + 1).split(',');
  const expected = [...policy.types, policy.party];
  assert.deepEqual([...modifiers].sort(), expected.sort(), 'Network modifiers must exactly preserve reviewed request types and scope');
  return { pattern, ...policy };
}

/** Admit only reviewed generic ad components and narrow native publisher rules. */
export function validateWebSource(content) {
  assert.equal(typeof content, 'string', 'Web source must be text');
  assert(Buffer.byteLength(content) <= WEB_PACK_LIMITS.bytes, 'Web supplement exceeds its source byte budget');
  assert(!content.includes('\0'), 'NUL is forbidden in the Web supplement');
  const seen = new Set(), network = [], cosmetic = [], publishers = new Set();
  let genericCosmeticRules = 0;
  content.split(/\r?\n/).forEach((source, index) => {
    const line = source.trim();
    if (!line || line.startsWith('!') || line === '[Adblock Plus 2.0]') return;
    try {
      assert(!seen.has(line), 'Duplicate rule');
      seen.add(line);
      assert(seen.size <= WEB_PACK_LIMITS.rules, 'Web supplement exceeds its rule budget');
      const node = RuleParser.parse(line);
      if (line.includes('##')) {
        assert.equal(node.type, 'ElementHidingRule', 'Only standard CSS hiding is permitted');
        if (line.startsWith('##')) {
          assert(genericAdComponents.has(line), 'Generic CSS must be an explicitly reviewed advertising component');
          genericCosmeticRules++;
        } else {
          // Reuse the established simple-selector/domain policy, without
          // changing the independent Vietnam source or compilation behavior.
          const scoped = validateVietnamSource(line);
          assert.equal(scoped.cosmetic.length, 1);
          scoped.publishers.forEach(domain => publishers.add(domain));
        }
        const parsed = new CosmeticRule(line, WEB_SUPPLEMENT_FILTER_ID, index);
        assert(!parsed.isExtendedCss(), 'Procedural CSS is not permitted');
        cosmetic.push(line);
      } else {
        assert.equal(node.category, 'Network', 'Only network blocks and standard CSS are permitted');
        networkPolicy(line);
        new NetworkRule(line, WEB_SUPPLEMENT_FILTER_ID, index);
        network.push(line);
      }
    } catch (error) {
      throw new Error(`${WEB_SOURCE_PATH}:${index + 1}: ${error.message}`, { cause: error });
    }
  });
  return { network, cosmetic, genericCosmeticRules, publishers: [...publishers].sort() };
}

export async function compileWebPack(content) {
  const source = validateWebSource(content);
  const [result, ...unexpected] = await new FilterConverter().convert([new Filter(WEB_SUPPLEMENT_FILTER_ID, content)], {
    withSourceMap: true,
    maxNumberOfRules: WEB_PACK_LIMITS.rules,
    maxNumberOfUnsafeRules: 0,
    maxNumberOfRegexpRules: 0,
  });
  assert(result && unexpected.length === 0, 'Unexpected Web supplement conversion result');
  assert.equal(result.errors.length, 0, `Web conversion errors: ${result.errors.map(error => error.message).join('; ')}`);
  assert.equal(result.limitations.length, 0, 'Web conversion truncated rules');
  const serialized = await result.ruleset.serializeCompact([], false);
  const rules = JSON.parse(serialized);
  const compact = parseCompactRuleset(`ruleset_${WEB_SUPPLEMENT_FILTER_ID}`, rules);
  assert.equal(compact.filterContent, content, 'Converter did not retain the complete Web source');
  const native = rules.filter(rule => !rule.metadata);
  const recovered = new Set();
  for (const rule of native) {
    assert.equal(rule.action.type, 'block', 'Web supplement may only block requests');
    assert(!rule.condition.regexFilter, 'Web supplement may not add regex overhead');
    const originals = await result.ruleset.getRulesById(rule.id);
    assert.equal(originals.length, 1, 'A Web network block must retain its exact authored source');
    const [original] = originals;
    assert.equal(original.filterId, WEB_SUPPLEMENT_FILTER_ID, 'Web source map used the wrong filter');
    const policy = networkPolicy(original.sourceRule);
    assert.equal(rule.condition.urlFilter, policy.pattern, 'Compiled block changed its request-host boundary');
    assert.deepEqual([...rule.condition.resourceTypes].sort(), policy.types.map(dnrType).sort(), 'Compiled block changed its resource scope');
    assert.equal(rule.condition.domainType, 'thirdParty', 'Compiled block changed its party scope');
    assert.equal(rule.condition.initiatorDomains, undefined, 'Unexpected compiled publisher scope');
    assert.deepEqual(Object.keys(rule.condition).sort(), ['urlFilter', 'resourceTypes', 'domainType'].sort(), 'Unexpected compiled network condition');
    recovered.add(original.sourceRule);
  }
  assert.equal(native.length, source.network.length, 'Web conversion produced or lost a network block');
  assert.deepEqual([...recovered].sort(), [...source.network].sort(), 'Conversion did not retain every authored Web network rule');
  return {
    serialized,
    networkRules: native.length,
    cosmeticRules: source.cosmetic.length,
    genericCosmeticRules: source.genericCosmeticRules,
    sourceRules: source.network.length + source.cosmetic.length,
    publishers: source.publishers,
    sourceSha256: createHash('sha256').update(content).digest('hex'),
    sourceBytes: Buffer.byteLength(content),
  };
}
