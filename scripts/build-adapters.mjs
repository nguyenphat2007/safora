import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const packageRoot = dirname(dirname(fileURLToPath(import.meta.resolve('@adguard/dnr-converter'))));
const originalPath = resolve(packageRoot, 'dist/ruleset/rules-hash-map.js');
const adapterPath = resolve(root, 'src/compact-rules-hash-map.ts');
const originalSha256 = '6ff80a9d62e8fded706676e84a49cc61a94efca4d270e32bf93ec75ff3ad5672';

/** Fail the build if an application or dependency starts using the omitted catalog. */
export function unusedFilterCatalogGuard() {
  return {
    name: 'unused-upstream-filter-catalog',
    transform(code, id) {
      assert(!code.includes('filters_i18n'),
        `Runtime module ${id} references the omitted filter catalog; restore that asset before building`);
      return null;
    },
  };
}

/** This adapter is reviewed against one pinned public module and its consumers. */
export async function compactRulesAdapter() {
  const pkg = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.0.0', 'Review the compact hash adapter before upgrading dnr-converter');
  assert.equal(createHash('sha256').update(await readFile(originalPath)).digest('hex'), originalSha256,
    'The upstream hash-map implementation changed; review its contract before building');
  const metadata = {
    package: pkg.name, version: pkg.version, module: 'dist/ruleset/rules-hash-map.js',
    upstreamSha256: originalSha256,
    adapterSha256: createHash('sha256').update(await readFile(adapterPath)).digest('hex'),
  };
  let replacements = 0;
  return {
    metadata,
    plugin: {
      name: 'compact-static-rules-hash-map',
      resolveId(source, importer) {
        if (importer && source.startsWith('.') && resolve(dirname(importer), source) === originalPath) {
          replacements++;
          return adapterPath;
        }
        return null;
      },
    },
    verify() { assert(replacements > 0, 'The compact hash adapter was not included in the background build'); },
  };
}
