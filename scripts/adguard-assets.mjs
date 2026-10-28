import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { Filter, MetadataRuleset, parseCompactRuleset, RulesetWithSourceMap } from '@adguard/dnr-converter';
import { copyWar } from '@adguard/tswebextension/cli';
import { FILTER_SOURCES, STATIC_FILTER_IDS, VIETNAM_SUPPLEMENT_FILTER_ID, WEB_SUPPLEMENT_FILTER_ID } from '../src/shared/filter-sources.ts';
import { compileVietnamPack, VIETNAM_SOURCE_PATH } from './vietnam-native-pack.mjs';
import { compileWebPack, WEB_SOURCE_PATH } from './web-native-pack.mjs';
import { compileUbolPack, UBOL_FILTER_IDS, UBOL_SOURCE_MANIFEST } from './ubol-native-pack.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve('@adguard/dnr-rulesets'))));
export const localScriptRulesPath = join(packageRoot, 'filters/chromium-mv3/local_script_rules.js');
const packagedAssets = join(packageRoot, 'filters/chromium-mv3');

function filterHeader(content, name) {
  return content.match(new RegExp(`^! ${name}: (.+)$`, 'mi'))?.[1]?.trim() ?? null;
}

function unpackMetadata(rules) {
  if (rules[0]?.metadata?.filterContent !== undefined) return rules[0].metadata;
  const chunks = [];
  for (const rule of rules) {
    if (rule.condition?.urlFilter !== 'dummy.rule.adguard.com' || !rule.metadata) break;
    if (typeof rule.metadata.chunk !== 'string') throw new Error('Unsupported AdGuard asset metadata format');
    chunks.push(rule.metadata.chunk);
  }
  return JSON.parse(chunks.join(''));
}

function blockRuleIds(rules) {
  const ids = rules.filter(rule => !rule.metadata && rule.action.type === 'block').map(rule => rule.id).sort((a, b) => a - b);
  for (let position = 0; position < ids.length; position += 1) {
    const id = ids[position];
    if (!Number.isInteger(id) || id <= 0 || id > 0xffffffff || ids[position - 1] === id) {
      throw new Error(`Invalid or duplicate blocked rule identifier: ${id}`);
    }
  }
  return ids;
}

async function copyLicenses(out) {
  const licenseDir = join(out, 'licenses');
  await mkdir(licenseDir, { recursive: true });
  await cp(join(projectRoot, 'licenses/REA-MIT.txt'), join(licenseDir, 'REA-MIT.txt'));
  await cp(join(projectRoot, 'LICENSE'), join(licenseDir, 'Safora-GPL-3.0.txt'));
  await cp(join(projectRoot, 'src/filters/ubol'), join(licenseDir, 'ubol'), { recursive: true });
  const modules = join(projectRoot, 'node_modules');
  const packageDirs = [];
  for (const entry of await readdir(modules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const scoped of await readdir(join(modules, entry.name), { withFileTypes: true })) {
        if (scoped.isDirectory() || scoped.isSymbolicLink()) packageDirs.push(join(modules, entry.name, scoped.name));
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) packageDirs.push(join(modules, entry.name));
  }
  const notices = [];
  for (const dir of packageDirs) {
    let pkg;
    try { pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')); }
    catch { continue; }
    const copied = [];
    for (const file of await readdir(dir)) {
      if (!/^(licen[sc]e|copying|notice)(\.|$)/i.test(file)) continue;
      const target = `${pkg.name.replaceAll('/', '__')}-${file}`;
      try { await cp(join(dir, file), join(licenseDir, target), { recursive: true }); copied.push(target); }
      catch (error) { throw new Error(`Could not package license for ${pkg.name}: ${error.message}`); }
    }
    notices.push({ name: pkg.name, version: pkg.version, license: pkg.license ?? null, repository: pkg.repository ?? null, licenseFiles: copied });
  }
  await writeFile(join(licenseDir, 'npm-dependencies.json'), JSON.stringify(notices, null, 2));
  await writeFile(join(licenseDir, 'FILTER-SOURCES.txt'), [
    'Filter sources and retained notices',
    'AdGuard filters: https://github.com/AdguardTeam/AdguardFilters (GPL-3.0)',
    'ABPVN: https://github.com/abpvn/abpvn (GPL-3.0)',
    'uAssets Quick fixes: https://github.com/uBlockOrigin/uAssets (GPL-3.0)',
    'uBlock Badware risks: reviewed network subset from pinned uAssets source; raw source, checksum, GPL-3.0 and exclusions are retained in licenses/ubol/ and filters/ubol-audit-90003.json.',
    'Malicious URL Blocklist: pinned malware-filter URLhaus HOSTS snapshot (CC0 data, MIT source tooling); raw source and notices in licenses/ubol/, audit in filters/ubol-audit-90004.json. Host scope, not individual URL path scope.',
    'Safora Việt Nam: authored and ABPVN-adapted site-scoped supplement in src/filters/safora-vietnam.txt (GPL-3.0-only); attribution and source commit retained in filter metadata.',
    'Safora Web: reviewed native advertising supplement in src/filters/safora-web.txt (GPL-3.0-only); upstream attribution retained in filter metadata.',
    'Compiled filter text, copyright and individual list notices are retained inside the ruleset metadata.',
    'This extension uses AdGuard open source libraries and selected uBOL filter sources. It is not an official AdGuard or uBlock Origin Lite product.',
    'Sources/build instructions are supplied in the Safora source directory.',
  ].join('\n') + '\n');
}

/** Adapt pinned snapshots to the installed converter's metadata envelope while retaining source maps and ordinary rule IDs. */
export async function prepareAdguardAssets(out) {
  const dest = join(out, 'filters');
  await mkdir(join(dest, 'declarative'), { recursive: true });
  const snapshots = [];
  const blockIndexChunks = [];
  let blockIndexBytes = 0;
  const upstreamMetadata = JSON.parse(await readFile(join(packagedAssets, 'declarative/ruleset_0/ruleset_0.json'), 'utf8'));
  const metadataData = upstreamMetadata[0]?.metadata?.checksums ? upstreamMetadata[0].metadata : MetadataRuleset.deserialize(JSON.stringify(upstreamMetadata));
  const checksums = new MetadataRuleset({}, metadataData.additionalProperties ?? {});
  for (const id of STATIC_FILTER_IDS) {
    const name = `ruleset_${id}`;
    const source = FILTER_SOURCES.find(filter => filter.id === id);
    let content, serialized, provenance;
    if (UBOL_FILTER_IDS.includes(id)) {
      const descriptor = UBOL_SOURCE_MANIFEST.filters.find(filter => filter.id === id);
      const rawSource = await readFile(join(projectRoot, descriptor.sourcePath), 'utf8');
      const supplement = await compileUbolPack(id, rawSource);
      content = supplement.content;
      serialized = supplement.serialized;
      const auditPath = `filters/ubol-audit-${id}.json`;
      const audit = { ...supplement.provenance, actions: supplement.actions };
      await writeFile(join(out, auditPath), JSON.stringify(audit, null, 2) + '\n');
      provenance = { source: descriptor.url, sourcePath: descriptor.sourcePath, license: descriptor.license,
        sourceSha256: supplement.sourceSha256, sourceBytes: supplement.sourceBytes,
        sourceRules: supplement.summary.inputRules, acceptedNetworkRules: supplement.acceptedNetworkRules,
        effectiveSourceSha256: supplement.effectiveSourceSha256, auditPath, conversion: supplement.summary };
    } else if (id === VIETNAM_SUPPLEMENT_FILTER_ID || id === WEB_SUPPLEMENT_FILTER_ID) {
      const sourcePath = id === VIETNAM_SUPPLEMENT_FILTER_ID ? VIETNAM_SOURCE_PATH : WEB_SOURCE_PATH;
      const compile = id === VIETNAM_SUPPLEMENT_FILTER_ID ? compileVietnamPack : compileWebPack;
      content = await readFile(join(projectRoot, sourcePath), 'utf8');
      const supplement = await compile(content);
      serialized = supplement.serialized;
      provenance = { source: sourcePath, license: 'GPL-3.0-only', sourceSha256: supplement.sourceSha256, sourceBytes: supplement.sourceBytes, sourceRules: supplement.sourceRules, publishers: supplement.publishers, ...(id === WEB_SUPPLEMENT_FILTER_ID ? { genericCosmeticRules: supplement.genericCosmeticRules } : {}) };
    } else {
      const raw = await readFile(join(packagedAssets, 'declarative', name, `${name}.json`), 'utf8');
      const rules = JSON.parse(raw);
      const meta = unpackMetadata(rules);
      content = meta.filterContent;
      if (typeof content !== 'string') throw new Error(`Missing filter text in ${name}`);
      const compact = rules[0]?.metadata?.chunk !== undefined
        ? parseCompactRuleset(name, rules)
        : { ...meta, metadataRulesCount: 1, declarativeRules: rules.filter(rule => !rule.metadata) };
      const converted = RulesetWithSourceMap.fromCompact(name, compact, [new Filter(id, content)]);
      serialized = await converted.serializeCompact(meta.metadata?.unsafeRules ?? [], false);
      provenance = { upstreamSha256: createHash('sha256').update(raw).digest('hex'), source: 'https://github.com/AdguardTeam/tsurlfilter/tree/master/packages/dnr-rulesets' };
    }
    await mkdir(join(dest, 'declarative', name), { recursive: true });
    await writeFile(join(dest, 'declarative', name, `${name}.json`), serialized);
    checksums.setChecksum(name, createHash('md5').update(serialized).digest('hex'));
    const serializedRules = JSON.parse(serialized);
    const networkRules = serializedRules.filter(rule => !rule.metadata).length;
    const cosmeticRules = content.split(/\r?\n/).filter(line => line && !line.startsWith('!') && /#[@?$%]?#/.test(line)).length;
    const blockIds = blockRuleIds(serializedRules);
    const blockChunk = Buffer.allocUnsafe(blockIds.length * 4);
    for (let position = 0; position < blockIds.length; position += 1) blockChunk.writeUInt32LE(blockIds[position], position * 4);
    const blockRuleIndex = { offset: blockIndexBytes, count: blockIds.length };
    blockIndexChunks.push(blockChunk);
    blockIndexBytes += blockChunk.byteLength;
    snapshots.push({ ...source, networkRules, browserRules: serializedRules.length, cosmeticRules, blockRuleIndex, version: filterHeader(content, 'Version'), updated: filterHeader(content, 'TimeUpdated'), sha256: createHash('sha256').update(serialized).digest('hex'), ...provenance, bytes: Buffer.byteLength(serialized) });
  }
  const blockIndex = Buffer.concat(blockIndexChunks, blockIndexBytes);
  const blockIndexPath = 'filters/block-index.bin';
  await writeFile(join(out, blockIndexPath), blockIndex);
  await mkdir(join(dest, 'declarative/ruleset_0'), { recursive: true });
  await writeFile(join(dest, 'declarative/ruleset_0/ruleset_0.json'), checksums.serialize(false));
  // Safora owns its filter labels in FILTER_SOURCES and has no runtime catalog
  // consumer. The build guards every bundled module against introducing one.
  // Do not ship the upstream product's full translated filter catalog.
  await copyWar(join(out, 'web-accessible-resources'));
  await copyLicenses(out);
  const pkg = JSON.parse(await readFile(join(packageRoot, '../package.json'), 'utf8'));
  const versions = {};
  for (const name of ['tswebextension', 'tsurlfilter', 'dnr-converter', 'dnr-rulesets', 'scriptlets', 'extended-css']) {
    versions[name] = JSON.parse(await readFile(join(projectRoot, 'node_modules/@adguard', name, 'package.json'), 'utf8')).version;
  }
  const snapshot = { package: pkg.name, packageVersion: pkg.version, versions, builtAt: new Date().toISOString(), blockIndex: { path: blockIndexPath, bytes: blockIndexBytes, sha256: createHash('sha256').update(blockIndex).digest('hex') }, filters: snapshots, networkRules: snapshots.reduce((sum, source) => sum + source.networkRules, 0), cosmeticRules: snapshots.reduce((sum, source) => sum + source.cosmeticRules, 0) };
  await writeFile(join(out, 'filter-snapshot.json'), JSON.stringify(snapshot, null, 2));
  const manifestPath = join(out, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.declarative_net_request = { rule_resources: [] };
  const ids = STATIC_FILTER_IDS.map(String);
  const enabled = FILTER_SOURCES.filter(source => source.group !== 'annoyances').map(source => String(source.id));
  manifest.declarative_net_request.rule_resources = ids.map(id => ({ id: `ruleset_${id}`, enabled: enabled.includes(id), path: `filters/declarative/ruleset_${id}/ruleset_${id}.json` }));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return snapshot;
}
