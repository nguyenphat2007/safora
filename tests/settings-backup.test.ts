import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/shared/defaults.ts';
import { MAX_BACKUP_BYTES, createSettingsBackup, parseSettingsBackup } from '../src/shared/settings-backup.ts';

function fixture() {
  return createSettingsBackup({ ...structuredClone(DEFAULT_SETTINGS), userRules: '||ads.example.test^\nexample.test##.banner', allowlist: ['EXAMPLE.org', 'https://other.test/', 'example.org'], logging: true, scriptlets: false }, '1.7.0', Date.UTC(2026, 9, 24));
}

test('settings backup round-trips only portable configuration and normalizes domains without mutating input', () => {
  const settings = { ...structuredClone(DEFAULT_SETTINGS), allowlist: ['EXAMPLE.org'], logs: [{ target: 'private-url' }], total: 888 };
  const backup = createSettingsBackup(settings, '1.7.0', Date.UTC(2026, 9, 24));
  assert.deepEqual(Object.keys(backup).sort(), ['createdAt', 'extensionVersion', 'format', 'settings', 'version']);
  assert.deepEqual(Object.keys(backup.settings).sort(), Object.keys(DEFAULT_SETTINGS).sort());
  assert.deepEqual(backup.settings.allowlist, ['example.org']);
  assert.deepEqual(settings.allowlist, ['EXAMPLE.org']);
  assert(!JSON.stringify(backup).includes('private-url'));
  assert.deepEqual(parseSettingsBackup(JSON.stringify(backup)), backup);
  const imported = fixture();
  assert.equal(imported.settings.logging, true);
  assert.equal(imported.settings.scriptlets, false);
  assert.deepEqual(imported.settings.allowlist, ['example.org', 'other.test']);
});

test('backup import rejects unknown keys, prototype keys, incomplete schemas and unsupported versions', () => {
  const backup = fixture();
  for (const data of [null, [], 7, { ...backup, version: 3 }, { ...backup, format: 'other' }, { ...backup, total: 99 }, { ...backup, settings: { ...backup.settings, logs: [] } }, { ...backup, settings: { ...backup.settings, groups: { ads: true } } }, { ...backup, settings: { ...backup.settings, groups: { ...backup.settings.groups, other: true } } }]) {
    assert.throws(() => parseSettingsBackup(JSON.stringify(data)));
  }
  assert.throws(() => parseSettingsBackup(JSON.stringify(backup).replace('"settings":{', '"settings":{"__proto__":{"enabled":false},')));
  assert.throws(() => parseSettingsBackup(JSON.stringify(backup).replace('"format":', '"constructor":{},"format":')));
  const incomplete = structuredClone(backup) as { settings: Record<string, unknown> };
  delete incomplete.settings.scriptlets;
  assert.throws(() => parseSettingsBackup(JSON.stringify(incomplete)));
  assert.equal(({} as { enabled?: unknown }).enabled, undefined);
});

test('legacy four-group backups preserve settings and preview the new security default; new backups retain an explicit opt-out', () => {
  const backup = fixture();
  const legacy = JSON.parse(JSON.stringify(backup));
  legacy.version = 1;
  delete legacy.settings.groups.security;
  legacy.settings.groups.ads = false;
  legacy.settings.enabled = false;
  const migrated = parseSettingsBackup(JSON.stringify(legacy));
  assert.equal(migrated.version, 1);
  assert.equal(migrated.settings.groups.security, true);
  assert.equal(migrated.settings.groups.ads, false);
  assert.equal(migrated.settings.enabled, false);
  assert.deepEqual(migrated.settings.allowlist, backup.settings.allowlist);
  assert.equal(migrated.settings.userRules, backup.settings.userRules);
  const optedOut = createSettingsBackup({ ...backup.settings, groups: { ...backup.settings.groups, security: false } }, '1.14.0');
  assert.equal(optedOut.version, 2);
  assert.equal(parseSettingsBackup(JSON.stringify(optedOut)).settings.groups.security, false);
  assert.throws(() => parseSettingsBackup(JSON.stringify({ ...legacy, version: 2 })));
});

test('backup import checks every state and bounded user configuration rather than coercing values', () => {
  const backup = fixture();
  for (const patch of [
    { enabled: 'false' }, { logging: 1 }, { scriptlets: null }, { theme: 'blue' },
    { groups: { ...backup.settings.groups, privacy: 1 } }, { userRules: 42 }, { userRules: 'x'.repeat(250001) },
    { userRules: '! comment\n'.repeat(5001) }, { allowlist: [123] }, { allowlist: ['a'.repeat(2049)] },
    { allowlist: ['https://example.test/private'] }, { allowlist: Array(1001).fill('example.test') },
  ]) assert.throws(() => parseSettingsBackup(JSON.stringify({ ...backup, settings: { ...backup.settings, ...patch } })));
});

test('backup import validates filter syntax and refuses arbitrary JavaScript injection', () => {
  const backup = fixture();
  for (const rule of ['example.test#%#alert(1)', 'example.test##+js(', 'example.test##:not(', '||ads.example.test^$not-a-real-option']) {
    assert.throws(() => parseSettingsBackup(JSON.stringify({ ...backup, settings: { ...backup.settings, userRules: rule } })));
  }
  const legacy = parseSettingsBackup(JSON.stringify({ ...backup, settings: { ...backup.settings, userRules: 'example.test#+js(set-constant, adEnabled, false)' } }));
  assert.equal(legacy.settings.userRules, 'example.test##+js(set-constant, adEnabled, false)');
});

test('backup metadata and UTF-8 byte limits reject malformed or oversized files before use', () => {
  const backup = fixture();
  assert.throws(() => parseSettingsBackup('{not JSON'), /JSON/);
  assert.throws(() => parseSettingsBackup(' '.repeat(MAX_BACKUP_BYTES + 1)), /2 MB/);
  assert.throws(() => parseSettingsBackup('ậ'.repeat(Math.floor(MAX_BACKUP_BYTES / 3) + 1)), /2 MB/);
  for (const patch of [{ extensionVersion: 'banana' }, { extensionVersion: '<script>' }, { createdAt: 'yesterday' }, { createdAt: '2026-10-24' }, { createdAt: null }]) {
    assert.throws(() => parseSettingsBackup(JSON.stringify({ ...backup, ...patch })));
  }
});
