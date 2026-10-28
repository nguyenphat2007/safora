import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const originalPath = fileURLToPath(import.meta.resolve('@adguard/extended-css'));
const packageRoot = dirname(dirname(originalPath));
const upstreamSha256 = '45b1e14b0e123a0d4b6bd71a33dabdafa1add789776314f039c587d341041dd0';
const createTracker = '    const eventTracker = new EventTracker();';
const stopTracker = '    context.eventTracker.stopTracking();';

/** Reuse the event tracker until the observer disconnects; selectors and scheduling stay upstream. */
export function reuseExtendedCssTracker(source) {
  assert.equal(source.split(createTracker).length, 2, 'Review ExtendedCss event tracker construction');
  assert.equal(source.split(stopTracker).length, 2, 'Review ExtendedCss event tracker cleanup');
  return source
    .replace(createTracker, '    const eventTracker = context.eventTracker ?? new EventTracker();')
    .replace(stopTracker, `${stopTracker}\n    context.eventTracker = undefined;`);
}

/** A changed dependency must be reviewed before this narrow lifecycle patch can be built. */
export async function extendedCssAdapter() {
  const pkg = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8'));
  assert.equal(pkg.version, '2.2.0', 'Review ExtendedCss lifecycle before upgrading the dependency');
  const source = await readFile(originalPath, 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), upstreamSha256,
    'The upstream ExtendedCss implementation changed; review tracker lifecycle before building');
  const patched = reuseExtendedCssTracker(source);
  let replacements = 0;
  return {
    metadata: {
      package: pkg.name, version: pkg.version, module: 'dist/extended-css.esm.js', upstreamSha256,
      adapterSha256: createHash('sha256').update(patched).digest('hex'),
    },
    plugin: {
      name: 'reuse-extended-css-event-tracker',
      load(id) {
        if (id !== originalPath) return null;
        replacements++;
        return { code: patched };
      },
    },
    verify() { assert(replacements > 0, 'ExtendedCss lifecycle patch was not included in the content build'); },
  };
}
