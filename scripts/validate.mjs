import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { Filter, MetadataRuleset, parseCompactRuleset, RulesetWithSourceMap } from '@adguard/dnr-converter';
import { STATIC_FILTER_IDS, VIETNAM_SUPPLEMENT_FILTER_ID, WEB_SUPPLEMENT_FILTER_ID } from '../src/shared/filter-sources.ts';
import { compileVietnamPack, VIETNAM_SOURCE_PATH } from './vietnam-native-pack.mjs';
import { compileWebPack, WEB_SOURCE_PATH } from './web-native-pack.mjs';
import { compileUbolPack, UBOL_FILTER_IDS, UBOL_SOURCE_MANIFEST } from './ubol-native-pack.mjs';
import { hasBlockRule } from '../src/shared/block-index.ts';
import { compactRulesAdapter } from './build-adapters.mjs';
import { extendedCssAdapter } from './extended-css-adapter.mjs';

const override = process.argv.indexOf('--dist');
if (override >= 0 && !process.argv[override + 1]) throw new Error('--dist requires a directory');
const root = override >= 0 ? resolve(process.argv[override + 1]) + sep : fileURLToPath(new URL('../dist/', import.meta.url));
const manifest = JSON.parse(await readFile(`${root}manifest.json`, 'utf8'));
const snapshot = JSON.parse(await readFile(`${root}filter-snapshot.json`, 'utf8'));
assert.deepEqual(JSON.parse(await readFile(`${root}build-adapters.json`, 'utf8')), [(await compactRulesAdapter()).metadata, (await extendedCssAdapter()).metadata], 'Build adapter provenance does not match the reviewed sources');
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.background.type, 'module');
assert(!manifest.permissions.includes('webRequestBlocking'));
assert(!manifest.permissions.includes('userScripts'));
assert(!manifest.content_security_policy.extension_pages.includes('unsafe-eval'));
assert(!manifest.content_security_policy.extension_pages.includes('http'));
assert(manifest.permissions.includes('webRequest'));
assert(manifest.permissions.includes('alarms'));
assert(snapshot.blockIndex && snapshot.blockIndex.path === 'filters/block-index.bin', 'Missing compact block index');
assert(Number.isSafeInteger(snapshot.blockIndex.bytes) && snapshot.blockIndex.bytes >= 0 && snapshot.blockIndex.bytes % 4 === 0, 'Invalid compact block index length');
const blockIndexBytes = await readFile(root + snapshot.blockIndex.path);
assert.equal(blockIndexBytes.byteLength, snapshot.blockIndex.bytes, 'Compact block index length does not match snapshot');
assert.equal(createHash('sha256').update(blockIndexBytes).digest('hex'), snapshot.blockIndex.sha256, 'Compact block index checksum does not match snapshot');
const blockIndex = new DataView(blockIndexBytes.buffer, blockIndexBytes.byteOffset, blockIndexBytes.byteLength);
assert.equal(new Set(snapshot.filters.map(filter => filter.id)).size, snapshot.filters.length, 'Duplicate snapshot filters');
let nextBlockOffset = 0;
const blockRanges = snapshot.filters.map(filter => {
  assert(!('blockRuleRanges' in filter), 'Obsolete block range metadata remains in snapshot');
  const range = filter.blockRuleIndex;
  assert(range && Number.isSafeInteger(range.offset) && range.offset >= 0 && range.offset % 4 === 0, `Invalid block offset for filter ${filter.id}`);
  assert(Number.isSafeInteger(range.count) && range.count >= 0, `Invalid block count for filter ${filter.id}`);
  assert(range.offset <= blockIndex.byteLength && range.count <= Math.floor((blockIndex.byteLength - range.offset) / 4), `Block index exceeds buffer for filter ${filter.id}`);
  return { id: filter.id, ...range };
}).sort((first, second) => first.offset - second.offset || first.count - second.count);
for (const range of blockRanges) {
  assert.equal(range.offset, nextBlockOffset, `Overlapping or unused block index bytes before filter ${range.id}`);
  nextBlockOffset += range.count * 4;
}
assert.equal(nextBlockOffset, blockIndex.byteLength, 'Unused trailing block index bytes');
const paths = [manifest.background.service_worker, manifest.action.default_popup, manifest.options_ui.page, ...manifest.content_scripts.flatMap(script => script.js), ...Object.values(manifest.icons), 'assistant-inject.js', 'youtube-main.js', 'gpc.js', 'hide-document-referrer.js', 'licenses/REA-MIT.txt', 'licenses/npm-dependencies.json', 'licenses/FILTER-SOURCES.txt', 'web-accessible-resources/redirects.yml', 'filters/declarative/ruleset_0/ruleset_0.json'];
for (const path of paths) assert((await stat(root + path)).isFile(), `Missing ${path}`);
const declaredIds = manifest.declarative_net_request.rule_resources.map(resource => resource.id);
assert.equal(new Set(declaredIds).size, STATIC_FILTER_IDS.length);
assert(STATIC_FILTER_IDS.every(id => declaredIds.includes(`ruleset_${id}`)));
assert(manifest.content_scripts.every(script => script.run_at === 'document_start' && script.all_frames));
assert.deepEqual(manifest.host_permissions,['http://*/*','https://*/*']);
assert(manifest.content_scripts.every(script=>script.matches.includes('http://*/*')&&script.matches.includes('https://*/*')&&script.match_about_blank));
const allowedActions = new Set(['block', 'allow', 'allowAllRequests', 'redirect', 'modifyHeaders', 'upgradeScheme']);
let totalRules = 0;
let totalRegex = 0;
const metadata = MetadataRuleset.deserialize(await readFile(`${root}filters/declarative/ruleset_0/ruleset_0.json`, 'utf8'));
for (const resource of manifest.declarative_net_request.rule_resources) {
  const raw = await readFile(root + resource.path, 'utf8');
  const rules = JSON.parse(raw);
  assert(Array.isArray(rules) && rules.length > 0);
  assert.equal(new Set(rules.map(rule => rule.id)).size, rules.length);
  const id = Number(resource.id.slice('ruleset_'.length));
  const info = snapshot.filters.find(filter => filter.id === id);
  assert(info, `No snapshot entry for ${resource.id}`);
  assert.equal(createHash('sha256').update(raw).digest('hex'), info.sha256, `Changed packaged list ${resource.id}`);
  assert.equal(createHash('md5').update(raw).digest('hex'), metadata.getChecksum(resource.id), `Invalid engine checksum ${resource.id}`);
  assert.equal(rules.filter(rule => !rule.metadata).length, info.networkRules);
  assert.equal(rules.length, info.browserRules, 'Quota count must include metadata rules');
  const expectedBlockIds = rules.filter(rule => !rule.metadata && rule.action.type === 'block').map(rule => rule.id).sort((first, second) => first - second);
  const actualBlockIds = [];
  for (let position = 0; position < info.blockRuleIndex.count; position += 1) {
    const ruleId = blockIndex.getUint32(info.blockRuleIndex.offset + position * 4, true);
    assert(ruleId > 0 && (position === 0 || ruleId > actualBlockIds[position - 1]), `Unsorted or duplicate block identifier in ${resource.id}`);
    actualBlockIds.push(ruleId);
  }
  assert.deepEqual(actualBlockIds, expectedBlockIds, `Compact block identifiers differ from the actual packaged rules in ${resource.id}`);
  for (const rule of rules) assert.equal(hasBlockRule(blockIndex, info.blockRuleIndex, rule.id), !rule.metadata && rule.action.type === 'block', `Incorrect block lookup for ${resource.id}:${rule.id}`);
  const compact = parseCompactRuleset(resource.id, rules);
  if (UBOL_FILTER_IDS.includes(id)) {
    const descriptor = UBOL_SOURCE_MANIFEST.filters.find(filter => filter.id === id);
    const text = await readFile(new URL(`../${descriptor.sourcePath}`, import.meta.url), 'utf8');
    const expected = await compileUbolPack(id, text);
    assert.equal(raw, expected.serialized, 'Security pack differs from reviewed source and conversion');
    assert.equal(compact.filterContent, expected.content);
    assert.equal(info.sourceSha256, expected.sourceSha256);
    assert.equal(info.effectiveSourceSha256, expected.effectiveSourceSha256);
    assert.equal(info.sourceRules, expected.summary.inputRules);
    assert.equal(info.acceptedNetworkRules, expected.acceptedNetworkRules);
    assert.equal(info.cosmeticRules, 0);
    assert.equal(info.license, descriptor.license);
    assert.deepEqual(info.conversion, expected.summary);
    assert.deepEqual(JSON.parse(await readFile(root + info.auditPath, 'utf8')), { ...expected.provenance, actions: expected.actions });
    const packagedSource = root + 'licenses/ubol/' + descriptor.sourcePath.split('/').at(-1);
    assert.equal(await readFile(packagedSource, 'utf8'), text, 'Original licensed security source missing from package');
    for (const path of descriptor.licenseFiles) assert((await stat(root + 'licenses/ubol/' + path.split('/').at(-1))).isFile(), 'Missing security source license');
  }
  if (id === VIETNAM_SUPPLEMENT_FILTER_ID || id === WEB_SUPPLEMENT_FILTER_ID) {
    const sourcePath = id === VIETNAM_SUPPLEMENT_FILTER_ID ? VIETNAM_SOURCE_PATH : WEB_SOURCE_PATH;
    const compile = id === VIETNAM_SUPPLEMENT_FILTER_ID ? compileVietnamPack : compileWebPack;
    const sourceText = await readFile(new URL(`../${sourcePath}`, import.meta.url), 'utf8');
    const expected = await compile(sourceText);
    assert.equal(raw, expected.serialized, 'Authored native pack must exactly match its reviewed source');
    assert.equal(info.source, sourcePath);
    assert.equal(info.license, 'GPL-3.0-only');
    assert.equal(info.sourceSha256, expected.sourceSha256);
    assert.equal(info.sourceBytes, expected.sourceBytes);
    assert.equal(info.sourceRules, expected.sourceRules);
    assert.equal(info.cosmeticRules, expected.cosmeticRules);
    if (id === WEB_SUPPLEMENT_FILTER_ID) assert.equal(info.genericCosmeticRules, expected.genericCosmeticRules);
    assert.deepEqual(info.publishers, expected.publishers);
  }
  const restored = RulesetWithSourceMap.fromCompact(resource.id, compact, [new Filter(id, compact.filterContent)]);
  assert.equal((await restored.getDeclarativeRules()).length, info.networkRules);
  const sample = compact.declarativeRules.find(rule => rule.action.type === 'block') ?? compact.declarativeRules[0];
  if (sample) assert((await restored.getRulesById(sample.id)).some(source => source.filterId === id && source.sourceRule.length > 0), `Invalid source map ${resource.id}`);
  for (const rule of rules) {
    assert(Number.isInteger(rule.id) && rule.id > 0);
    assert(allowedActions.has(rule.action.type), `Unsupported action ${rule.action.type}`);
    assert(rule.condition && typeof rule.condition === 'object');
    if (rule.condition.resourceTypes) assert(rule.condition.resourceTypes.length > 0);
    if (rule.condition.regexFilter) totalRegex++;
    if (rule.metadata) assert(Buffer.byteLength(JSON.stringify(rule.metadata)) <= 65536, 'Metadata chunk exceeds browser size bound');
    if (rule.action.redirect?.extensionPath) {
      const target = rule.action.redirect.extensionPath.replace(/^\//, '');
      assert(target.startsWith('web-accessible-resources/redirects/'));
      assert((await stat(root + target)).isFile(), `Missing redirect resource ${target}`);
    }
  }
  totalRules += info.networkRules;
}
assert.equal(totalRules, snapshot.networkRules);
assert(totalRegex <= 1000, 'Packaged static rules exceed the shared regex quota');
for (const file of ['popup.html', 'options.html']) {
  const html = await readFile(root + file, 'utf8');
  assert(!/\son\w+=/i.test(html));
  assert(!/<script(?![^>]*\bsrc=)/i.test(html));
  for (const [, tag, attributes] of html.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    for (const [, attribute, target] of attributes.matchAll(/\b(src|href)="([^"#]+)"/gi)) {
      if (/^https?:\/\//i.test(target) && tag.toLowerCase() === 'a' && attribute.toLowerCase() === 'href') continue;
      assert(!target.includes('://'), `Unexpected remote UI asset ${target}`);
      await stat(root + target);
    }
  }
}
console.log(`Manifest, ${totalRules.toLocaleString()} pinned DNR rules, ${totalRegex} regex rules, exact compact block index, redirect resources, licenses and local CSP passed. Full browser DNR validation runs in test:browser.`);
