import { mkdtemp, rename, rm, access } from 'node:fs/promises';
import { join } from 'node:path';

const exists = async path => { try { await access(path); return true; } catch { return false; } };

/** Publish only a validated directory. Preserve dist and dist.previous on pre-publication failure. */
export async function stagedBuild(root, build, validate) {
  const stage = await mkdtemp(join(root, '.build-staging-'));
  const current = join(root, 'dist');
  const previous = join(root, 'dist.previous');
  let moved = false;
  try {
    await build(stage);
    await validate(stage);
    if (await exists(current)) {
      await rm(previous, { recursive: true, force: true });
      await rename(current, previous);
      moved = true;
    }
    try { await rename(stage, current); }
    catch (error) {
      if (moved) await rename(previous, current);
      throw error;
    }
    return { current, previous: moved ? previous : null };
  } finally { await rm(stage, { recursive: true, force: true }); }
}
