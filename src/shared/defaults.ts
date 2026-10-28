import type { Settings } from './types';
export const DEFAULT_SETTINGS: Settings = {
  enabled: true,
  groups: { ads: true, privacy: true, security: true, annoyances: false, vietnam: true },
  allowlist: [], userRules: '', theme: 'system', logging: false, scriptlets: true,
};
export function hostname(url: string): string {
  try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u.hostname.toLowerCase() : ''; } catch { return ''; }
}
export function matchesDomain(host: string, domain: string): boolean { return host === domain || host.endsWith(`.${domain}`); }
export function isAllowed(host: string, list: string[]): boolean { return list.some(domain => matchesDomain(host, domain)); }
export function normalizeDomain(input: string): string {
  const value = input.trim();
  if (!value || /[\s*?#@]/.test(value)) throw new Error(`Tên miền không hợp lệ: ${input}`);
  const url = new URL(value.includes('://') ? value : `https://${value}`);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port || (url.pathname !== '/' && url.pathname !== '')) throw new Error(`Chỉ nhập tên miền: ${input}`);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host)) throw new Error(`Tên miền không hợp lệ: ${input}`);
  return host;
}
