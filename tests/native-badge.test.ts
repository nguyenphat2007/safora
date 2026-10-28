import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { createDomainLookup } from '../src/shared/domain-index.ts';
import { DEFAULT_SETTINGS, hostname } from '../src/shared/defaults.ts';

function setup(mode: string) {
  const source = readFileSync(new URL('../src/background.ts', import.meta.url), 'utf8');
  const code = source.slice(source.indexOf('const badgeCache='), source.indexOf('function validateSettings'));
  const writes: { tabId: number; text?: string }[] = [];
  const context = vm.createContext({
    settings: structuredClone(DEFAULT_SETTINGS), countMode: mode, tabStats: { 7: { network: 3 } }, hostname, isSiteAllowed: createDomainLookup([]),
    chrome: { tabs: { get: async () => ({ url: 'https://example.com/' }) }, action: {
      setBadgeText: async (value: { tabId: number; text?: string }) => { writes.push(structuredClone(value)); },
      setBadgeBackgroundColor: async () => {}, setTitle: async () => {},
    } },
  });
  // Exercise the actual background function rather than a second badge implementation.
  vm.runInContext(code.replace(/new Map<number,\{color:string;text:string;title:string\}>/g, 'new Map').replace('tabId: number', 'tabId').replace(': Promise<void>', '').replace('const changes:Promise<void>[]', 'const changes'), context);
  return { writes, context, badge: () => vm.runInContext('badge(7)', context) as Promise<void> };
}

test('store badge removes per-tab overrides and restores native Chrome count after OFF', async () => {
  const fixture = setup('native');
  await fixture.badge();
  assert.equal(Object.hasOwn(fixture.writes[0], 'text'), false);
  await fixture.badge(); assert.equal(fixture.writes.length, 1);
  fixture.context.settings.enabled = false; await fixture.badge();
  assert.equal(fixture.writes[1].text, 'OFF');
  fixture.context.settings.enabled = true; await fixture.badge();
  assert.equal(Object.hasOwn(fixture.writes[2], 'text'), false);
});

test('debug badge retains confirmed block-only counts instead of adopting native actions', async () => {
  const fixture = setup('debug');
  await fixture.badge(); assert.equal(fixture.writes[0].text, '3');
  fixture.context.tabStats[7].network = 0; await fixture.badge();
  assert.equal(fixture.writes[1].text, '');
});
