import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { DEFAULT_SETTINGS, normalizeDomain } from '../src/shared/defaults.ts';
import { normalizeLegacyRules, validateUserRules } from '../src/shared/adguard-rules.ts';
import { createSettingsBackup } from '../src/shared/settings-backup.ts';
import { backupFor113 } from '../scripts/backup-for-1.13.mjs';

test('downgrade backup removes only the unsupported group and retains old-version choices and exceptions', () => {
  const settings = { ...structuredClone(DEFAULT_SETTINGS), enabled: false, allowlist: ['safe.example.test'], userRules: '||ads.example.test^', theme: 'dark' as const };
  settings.groups.privacy = false;
  settings.groups.security = false;
  const source = createSettingsBackup(settings, '1.14.0');
  const result = backupFor113(JSON.stringify(source));
  const expected = JSON.parse(JSON.stringify(source));
  expected.version = 1; delete expected.settings.groups.security;
  assert.deepEqual(result, expected);
  // Exact parser from the released 1.13 source ZIP; unchanged helper semantics.
  const oldSource = readFileSync(new URL('fixtures/settings-backup-1.13.source.txt', import.meta.url), 'utf8');
  assert.equal(createHash('sha256').update(oldSource).digest('hex'), '6b666bfadd0359c383538546e7769bfeeef2a942f0438efc3dca48545d195c91');
  const oldParser = runInNewContext(stripTypeScriptTypes(oldSource.replace(/^import[^\n]*\n/gm, '').replace(/\bexport /g, '')) + '\nparseSettingsBackup', {
    GROUPS: ['ads', 'privacy', 'annoyances', 'vietnam'], normalizeDomain, normalizeLegacyRules, validateUserRules, TextEncoder,
  });
  assert.throws(() => oldParser(JSON.stringify(source)), /không được hỗ trợ/);
  assert.deepEqual(JSON.parse(JSON.stringify(oldParser(JSON.stringify(result)))), expected);
  assert.equal(source.settings.groups.security, false);
  assert.deepEqual(backupFor113(JSON.stringify(result)), result);
  assert.throws(() => backupFor113(JSON.stringify({ ...source, settings: { ...settings, allowlist: ['https://example.test/private'] } })));
});
