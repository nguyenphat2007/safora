import { DEFAULT_SETTINGS, normalizeDomain } from './defaults.ts';
import { normalizeLegacyRules, validateUserRules } from './adguard-rules.ts';
import { GROUPS } from './types.ts';
import type { Settings } from './types.ts';

export const MAX_BACKUP_BYTES = 2_000_000;
export interface SettingsBackup {
  format: 'safora-settings';
  version: 1 | 2;
  extensionVersion: string;
  createdAt: string;
  settings: Settings;
}

function objectWithKeys(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('Bản sao lưu phải chứa đối tượng JSON hợp lệ.');
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error('Bản sao lưu thiếu trường hoặc chứa trường không được hỗ trợ.');
  return record;
}

function validateSettings(value: unknown, version: 1 | 2): Settings {
  const data = objectWithKeys(value, ['enabled', 'groups', 'allowlist', 'userRules', 'theme', 'logging', 'scriptlets']);
  if (typeof data.enabled !== 'boolean' || typeof data.logging !== 'boolean' || typeof data.scriptlets !== 'boolean') throw new Error('Trạng thái bảo vệ, nhật ký hoặc scriptlet không hợp lệ.');
  if (!['system', 'light', 'dark'].includes(data.theme as string)) throw new Error('Giao diện trong bản sao lưu không hợp lệ.');
  const groupKeys = version === 1 ? GROUPS.filter(group => group !== 'security') : GROUPS;
  const groups = objectWithKeys(data.groups, groupKeys);
  if (groupKeys.some(group => typeof groups[group] !== 'boolean')) throw new Error('Nhóm bộ lọc trong bản sao lưu không hợp lệ.');
  if (!Array.isArray(data.allowlist) || data.allowlist.length > 1000 || data.allowlist.some(domain => typeof domain !== 'string' || domain.length > 2048)) throw new Error('Bản sao lưu chỉ hỗ trợ tối đa 1.000 tên miền ngoại lệ.');
  if (typeof data.userRules !== 'string' || data.userRules.length > 250000) throw new Error('Quy tắc trong bản sao lưu vượt quá 250.000 ký tự.');
  const userRules = normalizeLegacyRules(data.userRules);
  const diagnostics = validateUserRules(userRules);
  if (diagnostics.length) throw new Error(diagnostics.slice(0, 5).map(item => `Dòng ${item.line}: ${item.message}`).join('\n'));
  return {
    enabled: data.enabled,
    groups: { ads: groups.ads as boolean, privacy: groups.privacy as boolean,
      security: version === 1 ? DEFAULT_SETTINGS.groups.security : groups.security as boolean,
      annoyances: groups.annoyances as boolean, vietnam: groups.vietnam as boolean },
    allowlist: [...new Set((data.allowlist as string[]).map(normalizeDomain))].sort(),
    userRules, theme: data.theme as Settings['theme'], logging: data.logging, scriptlets: data.scriptlets,
  };
}

export function parseSettingsBackup(text: string): SettingsBackup {
  if (text.length > MAX_BACKUP_BYTES || new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('Bản sao lưu tối đa 2 MB.');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('Không đọc được JSON của bản sao lưu.'); }
  const data = objectWithKeys(raw, ['format', 'version', 'extensionVersion', 'createdAt', 'settings']);
  if (data.format !== 'safora-settings' || (data.version !== 1 && data.version !== 2)) throw new Error('Định dạng hoặc phiên bản bản sao lưu không được hỗ trợ.');
  if (typeof data.extensionVersion !== 'string' || data.extensionVersion.length > 32 || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(data.extensionVersion)) throw new Error('Thông tin phiên bản Safora không hợp lệ.');
  if (typeof data.createdAt !== 'string' || data.createdAt.length > 32) throw new Error('Ngày tạo bản sao lưu không hợp lệ.');
  const created = new Date(data.createdAt);
  if (!Number.isFinite(created.getTime()) || created.toISOString() !== data.createdAt) throw new Error('Ngày tạo bản sao lưu không hợp lệ.');
  return { format: 'safora-settings', version: data.version, extensionVersion: data.extensionVersion, createdAt: data.createdAt, settings: validateSettings(data.settings, data.version) };
}

export function createSettingsBackup(settings: Settings, extensionVersion: string, now = Date.now()): SettingsBackup {
  // Select only portable configuration; session logs, URLs and counters never enter the file.
  const portable = Object.fromEntries(['enabled', 'groups', 'allowlist', 'userRules', 'theme', 'logging', 'scriptlets'].map(key => [key, settings[key as keyof Settings]]));
  return parseSettingsBackup(JSON.stringify({ format: 'safora-settings', version: 2, extensionVersion, createdAt: new Date(now).toISOString(), settings: portable }));
}
