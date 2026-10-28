import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stagedBuild } from '../scripts/staged-build.mjs';

test('source conversion and validation failure preserve the working build; success retains it as rollback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'safora-staged-build-'));
  const write = async (path: string, value: string) => { await mkdir(path, { recursive: true }); await writeFile(join(path, 'version'), value); };
  try {
    await write(join(root, 'dist'), 'old-working');
    await write(join(root, 'dist.previous'), 'older-working');
    for (const failure of ['conversion', 'validation']) {
      await assert.rejects(stagedBuild(root, async (stage: string) => {
        await write(stage, 'new-candidate');
        if (failure === 'conversion') throw new Error('source checksum or syntax failure');
      }, async () => { throw new Error('quota validation failure'); }));
      assert.equal(await readFile(join(root, 'dist/version'), 'utf8'), 'old-working');
      assert.equal(await readFile(join(root, 'dist.previous/version'), 'utf8'), 'older-working');
      assert.deepEqual((await readdir(root)).sort(), ['dist', 'dist.previous']);
    }
    await stagedBuild(root, async (stage: string) => write(stage, 'new-validated'), async (stage: string) => assert.equal(await readFile(join(stage, 'version'), 'utf8'), 'new-validated'));
    assert.equal(await readFile(join(root, 'dist/version'), 'utf8'), 'new-validated');
    assert.equal(await readFile(join(root, 'dist.previous/version'), 'utf8'), 'old-working');
  } finally { await rm(root, { recursive: true, force: true }); }
});
