import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';
import { DEFAULT_SETTINGS, hostname, isAllowed } from '../src/shared/defaults.ts';

const source = readFileSync(new URL('../src/background.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source.slice(source.indexOf('async function getPopupState'), source.indexOf('async function contentConfig')));
function fixture(url?: string) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.userRules = '!'.repeat(250000);
  settings.allowlist = ['private.example'];
  return vm.createContext({ settings, hostname, isSiteAllowed: (host: string) => isAllowed(host, settings.allowlist), tabStats: { 7: { network: 12, cosmetic: 0, host: 'example.com' } }, total: 50, countMode: 'debug',
    blankTab: () => ({ network: 0, cosmetic: 0, host: '' }),
    chrome: { tabs: { get: async () => url ? { id: 7, url } : null } },
  });
}
test('popup state transfers only presentation fields even with maximum personal-rule text', async () => {
  const context = fixture('https://example.com/article'); vm.runInContext(code, context);
  const result = JSON.parse(JSON.stringify(await vm.runInContext('getPopupState(7)', context)));
  assert.deepEqual(result.settings, { enabled: true, theme: 'system' });
  assert.equal(result.tab.network, 12); assert.equal(result.total, 50); assert.equal(result.protected, true);
  assert(!('logs' in result) && !('engine' in result) && !('updates' in result));
  assert(JSON.stringify(result).length < 1024);
  assert(!JSON.stringify(result).includes('private.example'));
});
test('compact popup state retains site allowlist and unsupported-tab semantics', async () => {
  const context = fixture('https://private.example/'); vm.runInContext(code, context);
  assert.equal((await vm.runInContext('getPopupState(7)', context)).protected, false);
  const absent = fixture(); vm.runInContext(code, absent);
  const result = await vm.runInContext('getPopupState()', absent);
  assert.equal(result.supported, false); assert.equal(result.tabId, null); assert.equal(result.protected, false);
});
