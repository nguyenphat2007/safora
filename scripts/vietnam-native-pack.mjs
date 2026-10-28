import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Filter, FilterConverter, parseCompactRuleset } from '@adguard/dnr-converter';
import { CosmeticRule, NetworkRule } from '@adguard/tsurlfilter';
import { RuleParser } from '@adguard/agtree/parser';
import { VIETNAM_SUPPLEMENT_FILTER_ID } from '../src/shared/filter-sources.ts';

export const VIETNAM_SOURCE_PATH = 'src/filters/safora-vietnam.txt';
export const VIETNAM_PACK_LIMITS = Object.freeze({ bytes: 256 * 1024, rules: 512, scopesPerRule: 32 });
const networkTypes = new Set(['script', 'image', 'stylesheet', 'font', 'media', 'subdocument', 'xmlhttprequest', 'ping']);
const dnrTypes = new Set(['script', 'image', 'stylesheet', 'font', 'media', 'sub_frame', 'xmlhttprequest', 'ping']);
const sharedSuffixes = new Set(['com.vn', 'net.vn', 'org.vn', 'edu.vn', 'gov.vn', 'co.uk', 'com.au']);
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const compoundSelector = /^(?:[a-z][a-z0-9-]*|\*)?(?:[.#][a-z_][a-z0-9_-]*|\[[a-z_][a-z0-9_-]*(?:[~|^$*]?=(?:"[^"\\\r\n]*"|'[^'\\\r\n]*'|[a-z0-9_-]+))?\])*$/i;

function domains(value, separator) {
  const entries = value.split(separator);
  assert(entries.length > 0 && entries.length <= VIETNAM_PACK_LIMITS.scopesPerRule, 'Too many publisher domains');
  assert.equal(new Set(entries).size, entries.length, 'Duplicate publisher domain');
  for (const domain of entries) {
    assert(domain.length <= 253 && domainPattern.test(domain) && !sharedSuffixes.has(domain), `Invalid positive publisher scope: ${domain}`);
  }
  return entries;
}

function validateSelector(selector) {
  // This supplement deliberately accepts only simple native selectors. Extended
  // CSS, procedural operators and scriptlets stay in the existing upstream lists.
  assert(selector.length > 0 && selector.length <= 1024, 'Invalid selector length');
  assert(!/[:{},;@\\\r\n]/.test(selector), 'Only simple native CSS selectors are allowed');
  const compounds = selector.split(/\s*[>+~]\s*|\s+(?![^[\]]*\])/).filter(Boolean);
  assert(compounds.length > 0 && compounds.every(part => compoundSelector.test(part) && part.length > 0), 'Invalid native CSS selector');
  assert(!/^[>+~]|[>+~]$|[>+~]\s*[>+~]/.test(selector), 'Invalid CSS combinator');
  assert(/[.#[]/.test(selector), 'A cosmetic rule must target a named advertisement container');
}

/** Validate authored data before passing it to the same converter used by the engine. */
export function validateVietnamSource(content) {
  assert.equal(typeof content, 'string', 'Vietnam source must be text');
  assert(Buffer.byteLength(content) <= VIETNAM_PACK_LIMITS.bytes, 'Vietnam supplement exceeds its source byte budget');
  assert(!content.includes('\0'), 'NUL is forbidden in the Vietnam supplement');
  const seen = new Set(), network = [], cosmetic = [], publishers = new Set();
  content.split(/\r?\n/).forEach((source, index) => {
    const line = source.trim();
    if (!line || line.startsWith('!') || line === '[Adblock Plus 2.0]') return;
    try {
      assert(!seen.has(line), 'Duplicate rule');
      seen.add(line);
      assert(seen.size <= VIETNAM_PACK_LIMITS.rules, 'Vietnam supplement exceeds its rule budget');
      const node = RuleParser.parse(line);
      assert(node.type !== 'InvalidRule', 'Invalid filter syntax');
      if (line.includes('##')) {
        assert.equal(node.type, 'ElementHidingRule', 'Only standard CSS hiding is permitted');
        const separator = line.indexOf('##');
        const scopes = domains(line.slice(0, separator), ',');
        validateSelector(line.slice(separator + 2));
        const parsed = new CosmeticRule(line, VIETNAM_SUPPLEMENT_FILTER_ID, index);
        assert(!parsed.isExtendedCss(), 'Procedural CSS is not permitted');
        scopes.forEach(domain => publishers.add(domain));
        cosmetic.push(line);
      } else {
        assert.equal(node.category, 'Network', 'Only network blocks and standard CSS are permitted');
        assert(line.startsWith('||'), 'A network block must be anchored to an explicit request host');
        const separator = line.lastIndexOf('$');
        assert(separator > 2, 'A network block requires publisher scope and request types');
        const pattern = line.slice(2, separator);
        const host = pattern.split(/[/^]/, 1)[0];
        assert(domainPattern.test(host) && pattern.length <= 2048, 'Invalid anchored request host');
        assert(pattern.length > host.length && ['/', '^'].includes(pattern[host.length]), 'A request host needs an explicit boundary');
        assert(!/[\s$#\\]/.test(pattern), 'Invalid request pattern');
        const modifiers = line.slice(separator + 1).split(',');
        assert.equal(new Set(modifiers).size, modifiers.length, 'Duplicate network modifier');
        assert(!(modifiers.includes('third-party') && modifiers.includes('~third-party')), 'Contradictory request party modifiers');
        const scopeModifiers = modifiers.filter(value => value.startsWith('domain='));
        assert.equal(scopeModifiers.length, 1, 'A network block requires exactly one positive publisher scope');
        const scopes = domains(scopeModifiers[0].slice(7), '|');
        assert(modifiers.some(value => networkTypes.has(value)), 'Explicit request types are required');
        for (const modifier of modifiers) {
          assert(networkTypes.has(modifier) || modifier === scopeModifiers[0] || modifier === 'third-party' || modifier === '~third-party', `Disallowed network modifier: ${modifier}`);
        }
        new NetworkRule(line, VIETNAM_SUPPLEMENT_FILTER_ID, index);
        scopes.forEach(domain => publishers.add(domain));
        network.push(line);
      }
    } catch (error) {
      throw new Error(`${VIETNAM_SOURCE_PATH}:${index + 1}: ${error.message}`, { cause: error });
    }
  });
  return { network, cosmetic, publishers: [...publishers].sort() };
}

export async function compileVietnamPack(content) {
  const source = validateVietnamSource(content);
  const [result, ...unexpected] = await new FilterConverter().convert([new Filter(VIETNAM_SUPPLEMENT_FILTER_ID, content)], {
    withSourceMap: true,
    maxNumberOfRules: VIETNAM_PACK_LIMITS.rules,
    maxNumberOfUnsafeRules: 0,
    maxNumberOfRegexpRules: 0,
  });
  assert(result && unexpected.length === 0, 'Unexpected supplement conversion result');
  assert.equal(result.errors.length, 0, `Vietnam conversion errors: ${result.errors.map(error => error.message).join('; ')}`);
  assert.equal(result.limitations.length, 0, 'Vietnam conversion truncated rules');
  const serialized = await result.ruleset.serializeCompact([], false);
  const rules = JSON.parse(serialized);
  const compact = parseCompactRuleset(`ruleset_${VIETNAM_SUPPLEMENT_FILTER_ID}`, rules);
  assert.equal(compact.filterContent, content, 'Converter did not retain the complete source');
  const native = rules.filter(rule => !rule.metadata);
  assert.equal(native.length > 0, source.network.length > 0, 'Network conversion unexpectedly produced or lost rules');
  const recovered = new Set();
  for (const rule of native) {
    assert.equal(rule.action.type, 'block', 'Supplement may only block requests');
    assert(!rule.condition.regexFilter, 'Supplement may not add regex overhead');
    assert(rule.condition.initiatorDomains?.length > 0, 'Compiled network block lost its publisher scope');
    assert(rule.condition.resourceTypes?.length > 0 && rule.condition.resourceTypes.every(type => dnrTypes.has(type)), 'Compiled block lost its explicit request types');
    for (const original of await result.ruleset.getRulesById(rule.id)) {
      assert.equal(original.filterId, VIETNAM_SUPPLEMENT_FILTER_ID, 'Compiled source map used the wrong filter');
      recovered.add(original.sourceRule);
    }
  }
  assert.deepEqual([...recovered].sort(), [...source.network].sort(), 'Conversion did not retain every authored network rule');
  return {
    serialized,
    networkRules: native.length,
    cosmeticRules: source.cosmetic.length,
    sourceRules: source.network.length + source.cosmetic.length,
    publishers: source.publishers,
    sourceSha256: createHash('sha256').update(content).digest('hex'),
    sourceBytes: Buffer.byteLength(content),
  };
}
