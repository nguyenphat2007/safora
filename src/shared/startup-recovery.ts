import type { Settings } from './types.ts';

/** A newly added list must not prevent the previously working groups from starting. */
export async function startWithSecurityRecovery(
  settings: Settings,
  updates: string[],
  configure: (settings: Settings, updates: string[]) => Promise<void>,
): Promise<{ securityDisabled: boolean; warning?: string }> {
  try {
    await configure(settings, updates);
    return { securityDisabled: false };
  } catch (originalError) {
    if (!settings.enabled || !settings.groups.security) throw originalError;
    const fallback = { ...settings, groups: { ...settings.groups, security: false } };
    try { await configure(fallback, updates); }
    catch { throw originalError; }
    return {
      securityDisabled: true,
      warning: 'Không bật được nhóm URL độc hại; đã giữ các bộ lọc và ngoại lệ trước đó. Có thể thử bật lại trong Bộ lọc. ' + (originalError instanceof Error ? originalError.message : String(originalError)),
    };
  }
}
