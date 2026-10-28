import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Filter, FilterConverter, Rule, parseCompactRuleset } from '@adguard/dnr-converter';
import { RuleParser } from '@adguard/agtree/parser';
import { preprocessChromiumMV3 } from '../src/shared/filter-preprocessor.ts';

export const UBOL_FILTER_IDS = Object.freeze([90003, 90004]);
export const UBOL_PACK_LIMITS = Object.freeze({ bytes: 8 * 1024 * 1024, sourceRules: 100000, networkRules: 50000, regexRules: 0 });
export const UBOL_SOURCE_MANIFEST = JSON.parse(await readFile(new URL('../src/filters/ubol/sources.json', import.meta.url), 'utf8'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const allowedModifiers = new Set([
  'all', 'document', 'doc', 'subdocument', 'frame', 'script', 'image', 'stylesheet', 'css', 'font', 'media',
  'object', 'other', 'ping', 'websocket', 'xmlhttprequest', 'xhr', 'third-party', '3p', 'first-party', '1p',
  'domain', 'to', 'denyallow', 'important', 'match-case', 'badfilter',
]);
const cosmeticExceptionModifiers = new Set(['elemhide', 'ehide', 'generichide', 'ghide', 'specifichide', 'shide']);

function record(line, rule, reason) { return { line, rule, reason }; }
function isRule(line) { return line && !line.startsWith('!') && !line.startsWith('['); }

function targetCouldIncludeHost(pattern, host) {
  const anchoredHost = /^\|\|([a-z0-9.-]+)(?:\^|\/|:)/u.exec(pattern)?.[1];
  return !anchoredHost || host === anchoredHost || host.endsWith(`.${anchoredHost}`);
}

function scopeCouldIncludeHost(modifiers, host) {
  const value = modifiers.find(modifier => modifier.name.value === 'to')?.value?.value;
  if (!value) return true;
  const entries = value.split('|');
  const matches = domain => host === domain || host.endsWith(`.${domain}`);
  if (entries.some(entry => entry.startsWith('~') && matches(entry.slice(1)))) return false;
  const included = entries.filter(entry => !entry.startsWith('~'));
  return included.length === 0 || included.some(entry => entry.includes('*') || matches(entry));
}

function hostsToFilters(content) {
  return content.split(/\r?\n/u).map((line, index) => {
    if (!line.trim()) return line;
    if (line.startsWith('#')) return `!${line.slice(1)}`;
    const match = /^0\.0\.0\.0 ([a-z0-9.-]+)$/u.exec(line);
    assert(match, `Invalid HOSTS source at line ${index + 1}`);
    const host = match[1];
    assert(host.length <= 253 && host.includes('.') && host.split('.').every(label =>
      label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)), `Invalid HOSTS hostname at line ${index + 1}`);
    assert(host !== 'localhost' && !/^[\d.]+$/u.test(host), `Non-domain HOSTS entry at line ${index + 1}`);
    // uBOL's URLhaus HOSTS rules match all resource types, including navigation.
    return `||${host}^$all`;
  }).join('\n');
}

/**
 * Only a reviewed, checksum-pinned source enters the converter. Rejected rules
 * remain comments in the metadata and are also listed individually in the audit.
 * Unknown exception semantics fail the build rather than losing an allow rule.
 */
export function prepareUbolNetworkSource(content, descriptor) {
  assert.equal(typeof content, 'string', 'uBOL source must be text');
  assert(descriptor && UBOL_FILTER_IDS.includes(descriptor.id), 'Unknown uBOL filter ID');
  assert(/^[a-f0-9]{64}$/u.test(descriptor.sha256), 'A reviewed source checksum is required');
  assert.equal(sha256(content), descriptor.sha256, `${descriptor.name}: source checksum changed; review and pin the new source first`);
  assert(Buffer.byteLength(content) <= UBOL_PACK_LIMITS.bytes, 'uBOL source exceeds its byte budget');
  assert(!content.includes('\0'), 'NUL is forbidden in a filter source');
  assert(['hosts', 'ublock-filter-list'].includes(descriptor.format), 'Unsupported pinned source format');
  if (descriptor.bytes !== undefined) assert.equal(Buffer.byteLength(content), descriptor.bytes, 'Pinned source byte size changed');
  const rawLines = content.split(/\r?\n/u);
  const processed = preprocessChromiumMV3(descriptor.format === 'hosts' ? hostsToFilters(content) : content).split(/\r?\n/u);
  assert.equal(processed.length, rawLines.length, 'Preprocessor lost source line positions');
  const rejectedRules = [], inactiveRules = [], duplicates = [], accepted = [], transformedRules = [], seen = new Set();
  const reviewed = new Map((descriptor.exclusions ?? []).map(item => [item.rule, item.reason]));
  assert.equal(reviewed.size, (descriptor.exclusions ?? []).length, 'Duplicate reviewed exclusion');
  const usedExclusions = new Set();
  const conservativeExceptions = descriptor.conservativeExceptions ?? [];
  for (const exception of conservativeExceptions) {
    assert(processed.includes(exception.rule), 'Conservative exception must be active in the pinned source');
    assert(exception.rule.startsWith(`@@||${exception.host}/`) && /^[a-z0-9.-]+$/u.test(exception.host), 'Invalid conservative exception scope');
    assert(exception.reason.length > 20, 'Conservative exception requires an explanation');
    const node = RuleParser.parse(exception.rule);
    assert(node.category === 'Network' && node.exception && node.modifiers?.children.some(modifier => ['doc', 'document'].includes(modifier.name.value)),
      'Conservative host exemption is restricted to document exceptions');
  }
  let sourceNetworkRules = 0, sourceCosmeticRules = 0, inputRules = 0;
  for (let index = 0; index < rawLines.length; index++) {
    const raw = rawLines[index].trim(); let line = processed[index].trim();
    const rawIsRule = isRule(raw) && !(descriptor.format === 'hosts' && raw.startsWith('#'));
    if (rawIsRule) inputRules++;
    assert(inputRules <= UBOL_PACK_LIMITS.sourceRules, 'uBOL source exceeds its rule budget');
    if (rawIsRule && !isRule(line)) {
      inactiveRules.push(record(index + 1, raw, 'Inactive for Safora Chromium MV3 preprocessor capabilities'));
      processed[index] = `! Safora inactive: ${raw}`;
      continue;
    }
    if (!isRule(line)) continue;
    const node = RuleParser.parse(line);
    assert(node.category !== 'Invalid', `Invalid source syntax at line ${index + 1}`);
    let reason;
    if (node.category === 'Cosmetic') {
      sourceCosmeticRules++;
      reason = 'Cosmetic/scriptlet rules are outside this packaged network-only supplement';
    } else {
      assert.equal(node.category, 'Network', `Unexpected source category at line ${index + 1}: ${node.category}`);
      sourceNetworkRules++;
      const modifiers = node.modifiers?.children ?? [];
      const names = modifiers.map(modifier => modifier.name.value);
      const conservativeException = conservativeExceptions.find(item => item.rule === line);
      if (conservativeException) {
        reason = conservativeException.reason;
      } else if (reviewed.has(line)) {
        assert(!node.exception, 'An exception cannot be discarded through a generic exclusion');
        reason = reviewed.get(line); usedExclusions.add(line);
        assert(typeof reason === 'string' && reason.length > 10, 'Reviewed exclusion needs an explanation');
      } else if (node.exception && names.some(name => name === 'document' || name === 'doc' || name === 'all')) {
        throw new Error(`Unsupported document exception at line ${index + 1}; review its cross-engine semantics without discarding it: ${line}`);
      } else if (node.exception && names.some(name => cosmeticExceptionModifiers.has(name)) && names.every(name => cosmeticExceptionModifiers.has(name) || name === 'domain' || name === 'from')) {
        reason = 'Cosmetic-only exception has no network action in this network-only supplement';
      } else if (node.pattern.value.startsWith('/') && node.pattern.value.endsWith('/')) {
        assert(!node.exception, `Regex exception requires an explicit safe integration plan: ${line}`);
        reason = 'Regex rules are excluded from this bounded zero-regex network supplement; no offline approximation of Chrome RE2 validation';
      } else {
        const unsupported = names.filter(name => !allowedModifiers.has(name));
        if (unsupported.length) {
          assert(!node.exception, `Unsupported allow exception at line ${index + 1}; preserve its semantics before integrating: ${line}`);
          reason = `Unsupported network modifiers in this supplement: ${unsupported.join(', ')}`;
        }
        assert(!modifiers.some(modifier => modifier.name.value === 'all' && modifier.exception), 'Negated $all is not supported');
      }
      if (!reason && !node.exception && names.some(name => ['all', 'doc', 'document'].includes(name))) {
        const exemptHosts = conservativeExceptions.map(item => item.host).filter(host => targetCouldIncludeHost(node.pattern.value, host) && scopeCouldIncludeHost(modifiers, host));
        if (exemptHosts.length) {
          assert(!names.includes('denyallow') && !names.includes('badfilter'), 'Exception transformation needs review for denyallow/badfilter interaction');
          if (names.includes('to')) line = line.replace(/([$,]to=[^,]+)/u, `$1|${exemptHosts.map(host => `~${host}`).join('|')}`);
          else line += `,denyallow=${exemptHosts.join('|')}`;
          processed[index] = line;
          transformedRules.push({ line: index + 1, rule: raw, effectiveRule: line,
            reason: 'Conservatively preserve a document exception at host scope without disabling cosmetic or scriptlet filtering' });
        }
      }
    }
    if (reason) {
      rejectedRules.push(record(index + 1, raw, reason));
      processed[index] = `! Safora excluded (${reason}): ${raw}`;
      continue;
    }
    if (seen.has(line)) {
      duplicates.push(record(index + 1, raw, 'Exact duplicate within this source'));
      processed[index] = `! Safora duplicate: ${raw}`;
      continue;
    }
    seen.add(line); accepted.push(record(index + 1, line, 'Accepted network rule'));
  }
  assert.equal(usedExclusions.size, reviewed.size, 'A reviewed exclusion no longer occurs in the pinned source');
  const header = [
    `! Title: ${descriptor.name} — Safora compatible network subset`,
    `! Version: ${descriptor.version}`,
    `! TimeUpdated: ${descriptor.updated}`,
    `! Source: ${descriptor.url}`,
    `! License: ${descriptor.license}`,
    '! Original source and notices are retained below; exclusions are explicit comments.',
  ].join('\n');
  return { content: `${header}\n${processed.join('\n')}`, inputRules, sourceNetworkRules, sourceCosmeticRules,
    acceptedNetworkRules: accepted.length, accepted, rejectedRules, inactiveRules, duplicates,
    transformedRules, sourceSha256: descriptor.sha256, sourceBytes: Buffer.byteLength(content) };
}

/** Exported for focused synthetic conversion tests; production calls use the manifest below. */
export async function compilePinnedUbolSource(content, descriptor) {
  const source = prepareUbolNetworkSource(content, descriptor);
  assert(source.acceptedNetworkRules > 0, 'A packaged security list must retain network rules');
  const parsedRules = source.accepted.flatMap(item => Rule.createFromText(descriptor.id, 0, item.rule));
  const badfilters = parsedRules.filter(rule => rule.isModifierEnabled('badfilter'));
  const ordinaryRules = parsedRules.filter(rule => !rule.isModifierEnabled('badfilter'));
  for (const badfilter of badfilters) assert(ordinaryRules.some(rule => badfilter.negatesBadfilter(rule)),
    `Cross-list $badfilter needs an explicit integration plan: ${badfilter.getText()}`);
  const cancelled = new Set(ordinaryRules.filter(rule => badfilters.some(badfilter => badfilter.negatesBadfilter(rule))).map(rule => rule.getText()));
  const [result, ...extra] = await new FilterConverter().convert([new Filter(descriptor.id, source.content)], {
    withSourceMap: true,
    maxNumberOfRules: UBOL_PACK_LIMITS.networkRules,
    maxNumberOfUnsafeRules: 0,
    maxNumberOfRegexpRules: UBOL_PACK_LIMITS.regexRules,
  });
  assert(result && extra.length === 0, 'Unexpected security conversion result');
  assert.equal(result.errors.length, 0, `Security conversion errors: ${result.errors.map(error => error.message).join('; ')}`);
  assert.equal(result.limitations.length, 0, 'Security conversion exceeded its quota or truncated rules');
  const serialized = await result.ruleset.serializeCompact([], false);
  const compact = parseCompactRuleset(`ruleset_${descriptor.id}`, JSON.parse(serialized));
  assert.equal(compact.filterContent, source.content, 'Security source metadata was not retained exactly');
  const actions = {}, recovered = new Set();
  let regexRules = 0;
  for (const rule of compact.declarativeRules) {
    assert(['block', 'allow', 'allowAllRequests'].includes(rule.action.type), `Unexpected security action: ${rule.action.type}`);
    assert(Number.isInteger(rule.priority ?? 1) && (rule.priority ?? 1) > 0, 'Invalid compiled security priority');
    actions[rule.action.type] = (actions[rule.action.type] ?? 0) + 1;
    if (rule.condition.regexFilter) regexRules++;
    for (const original of await result.ruleset.getRulesById(rule.id)) {
      assert.equal(original.filterId, descriptor.id, 'Security source map points to another filter');
      recovered.add(original.sourceRule);
    }
  }
  for (const item of source.accepted) {
    const rules = Rule.createFromText(descriptor.id, 0, item.rule);
    if (rules.every(rule => rule.isModifierEnabled('badfilter') || cancelled.has(rule.getText()))) continue;
    assert(recovered.has(item.rule), `Accepted security source lost during conversion: ${item.rule}`);
  }
  assert(regexRules <= UBOL_PACK_LIMITS.regexRules, 'Security regex budget exceeded');
  const summary = { inputRules: source.inputRules, sourceNetworkRules: source.sourceNetworkRules,
    sourceCosmeticRules: source.sourceCosmeticRules, acceptedNetworkRules: source.acceptedNetworkRules,
    duplicateRules: source.duplicates.length, inactiveRules: source.inactiveRules.length,
    rejectedRules: source.rejectedRules.length, transformedRules: source.transformedRules.length, compiledRules: compact.declarativeRules.length,
    regexRules, badfilterRules: badfilters.length, cancelledRules: cancelled.size };
  if (descriptor.expected) assert.deepEqual(summary, descriptor.expected, 'Pinned security conversion changed; review the source/converter before accepting it');
  return {
    serialized, content: source.content,
    networkRules: compact.declarativeRules.length, cosmeticRules: 0, sourceRules: source.acceptedNetworkRules,
    sourceSha256: source.sourceSha256, sourceBytes: source.sourceBytes,
    effectiveSourceSha256: sha256(source.content), sourceNetworkRules: source.sourceNetworkRules,
    acceptedNetworkRules: source.acceptedNetworkRules, duplicateRules: source.duplicates.length,
    inactiveRules: source.inactiveRules, rejectedRules: source.rejectedRules,
    summary, actions, transformedRules: source.transformedRules,
    provenance: { ...descriptor, effectiveSourceSha256: sha256(source.content), summary,
      rejectedRules: source.rejectedRules, inactiveRules: source.inactiveRules, duplicates: source.duplicates, transformedRules: source.transformedRules,
      compatibility: 'Reviewed network subset converted with the pinned AdGuard converter; no uBOL strict-block interstitial or executable filters are imported.' },
  };
}

export async function compileUbolPack(id, content) {
  assert.equal(UBOL_SOURCE_MANIFEST.schemaVersion, 1, 'Unsupported uBOL source manifest schema');
  assert.deepEqual(UBOL_SOURCE_MANIFEST.filters.map(source => source.id), [...UBOL_FILTER_IDS], 'Pinned security manifest must contain exactly the reviewed filter IDs');
  const descriptor = UBOL_SOURCE_MANIFEST.filters.find(source => source.id === id);
  assert(descriptor, `Unknown pinned uBOL filter ${id}`);
  assert(descriptor.expected && Number.isSafeInteger(descriptor.bytes) && descriptor.bytes > 0,
    'Production sources require reviewed expected counts and byte sizes');
  assert(/^https:\/\//u.test(descriptor.url) && /^\d{14}$/u.test(descriptor.version)
    && Number.isFinite(Date.parse(descriptor.updated)) && descriptor.licenseFiles.length > 0,
  'Incomplete pinned source provenance');
  return compilePinnedUbolSource(content, descriptor);
}
