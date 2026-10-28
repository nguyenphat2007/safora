import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = join(root, 'release');
const target = join(release, 'chrome-webstore');
await mkdir(release, { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(join(root, 'dist'), target, { recursive: true, filter: path => !path.split('/').some(part => part === '_metadata' || part === '.DS_Store') });
const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
manifest.permissions = manifest.permissions.filter(permission => !['declarativeNetRequestFeedback', 'privacy', 'tabs'].includes(permission));
assert(!manifest.permissions.includes('userScripts'));
await writeFile(join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const archive = `Safora-${manifest.version}-chrome-webstore.zip`;
const source = `Safora-${manifest.version}-source.zip`;
execFileSync('python3', ['-c', `
import sys, pathlib, zipfile, json
root, release, target = map(pathlib.Path, sys.argv[1:4])
archive, source = sys.argv[4:6]
skip = {'_metadata', '.DS_Store', '__MACOSX'}
with zipfile.ZipFile(release/archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in sorted(target.rglob('*')):
        if p.is_file() and not skip.intersection(p.relative_to(target).parts): z.write(p, p.relative_to(target).as_posix())
with zipfile.ZipFile(release/archive) as z:
    assert z.testzip() is None
    manifest = json.loads(z.read('manifest.json'))
    assert 'declarativeNetRequestFeedback' not in manifest['permissions']
    assert 'privacy' not in manifest['permissions']
    assert 'tabs' not in manifest['permissions']
    assert all(not n.startswith(('/', '../')) and not skip.intersection(pathlib.PurePosixPath(n).parts) for n in z.namelist())
    for p in [manifest['background']['service_worker'], manifest['action']['default_popup'], manifest['options_ui']['page']]: assert p in z.namelist()
with zipfile.ZipFile(release/source, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for p in sorted(root.rglob('*')):
        parts = p.relative_to(root).parts
        if {'node_modules','dist','dist.previous','release','test-results','.git','.DS_Store','__MACOSX'}.intersection(parts) or any(part.startswith('.build-staging-') for part in parts): continue
        if p.is_file() and (parts[0] in {'src','public','scripts','tests','licenses','store'} or (p.parent == root and (p.suffix == '.md' or p.name in {'package.json','package-lock.json','tsconfig.json','.nvmrc','.oxlintrc.json','.gitignore','LICENSE'}))):
            z.write(p, 'Safora/' + p.relative_to(root).as_posix())
`, root, release, target, archive, source]);
const artifacts = {};
for (const file of [archive, source]) {
  const bytes = await readFile(join(release, file));
  artifacts[file] = { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(join(release, 'package-report.json'), JSON.stringify({ name: manifest.name, version: manifest.version, at: new Date().toISOString(), storePermissions: manifest.permissions, removedPermissions: ['declarativeNetRequestFeedback', 'privacy', 'tabs'], artifacts, submitted: false }, null, 2));
console.log(JSON.stringify({ archive, source, artifacts }, null, 2));
