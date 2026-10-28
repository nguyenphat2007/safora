import { RuleParser } from '@adguard/agtree/parser';
import { isAllowed, matchesDomain } from './shared/defaults.ts';
import type { Settings } from './shared/types';

export const YOUTUBE_STARTUP_SCRIPT_ID = 'rea-youtube-startup-v1';
export const YOUTUBE_STARTUP_SCRIPT_FILE = 'youtube-main.js';
export const YOUTUBE_STARTUP_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com'] as const;

function literalHost(value: string): string | undefined {
  if (!/^[a-z0-9.-]+$/i.test(value)) return undefined;
  try {
    const host = new URL(`https://${value}`).hostname;
    return host === value.toLowerCase() ? host : undefined;
  } catch { return undefined; }
}

function possiblyTargetsYouTube(pattern: string): boolean {
  // Only a literal hostname with an explicit boundary proves an exception unrelated.
  const domainAnchor = pattern.match(/^\|\|([^/^:*|?]+)(?=[/^:])/);
  if (domainAnchor) {
    const host = literalHost(domainAnchor[1]);
    return !host || YOUTUBE_STARTUP_HOSTS.some(target => matchesDomain(target, host));
  }
  const urlAnchor = pattern.match(/^\|https?:\/\/([^/^:*|?]+)(?=[/^:])/i);
  if (urlAnchor) {
    const host = literalHost(urlAnchor[1]);
    return !host || YOUTUBE_STARTUP_HOSTS.some(target => target === host);
  }
  return true;
}

/** Preserve exceptions conservatively when their path/domain scope cannot be represented by one startup script. */
function hasScriptException(text: string): boolean {
  for (const source of text.split(/\r?\n/)) {
    const line = source.trim();
    if (!line || line.startsWith('!') || line.startsWith('[')) continue;
    if (!line.startsWith('@@') && !line.includes('#@')) continue;
    const node = RuleParser.parse(line);
    if (node.category === 'Cosmetic' && node.exception
      && (node.type === 'ScriptletInjectionRule' || node.type === 'JsInjectionRule')) {
      const included = node.domains.children.filter(domain => !domain.exception);
      if (!included.length || included.some(domain => {
        const host = literalHost(domain.value);
        return !host || YOUTUBE_STARTUP_HOSTS.some(target => matchesDomain(target, host));
      })) return true;
    }
    if (node.type === 'NetworkRule' && node.exception && node.modifiers?.children.some(modifier =>
      !modifier.exception && ['document', 'doc', 'jsinject', 'all'].includes(modifier.name.value.toLowerCase()))
      && possiblyTargetsYouTube(node.pattern.value)) return true;
  }
  return false;
}

function desiredRegistration(settings: Settings): chrome.scripting.RegisteredContentScript | undefined {
  if (!settings.enabled || !settings.groups.ads || hasScriptException(settings.userRules)) return undefined;
  const hosts = YOUTUBE_STARTUP_HOSTS.filter(host => !isAllowed(host, settings.allowlist));
  if (!hosts.length) return undefined;
  return {
    id: YOUTUBE_STARTUP_SCRIPT_ID,
    js: [YOUTUBE_STARTUP_SCRIPT_FILE],
    matches: hosts.map(host => `*://${host}/*`),
    excludeMatches: hosts.flatMap(host => [`*://${host}/tv`, `*://${host}/tv/*`]),
    world: 'MAIN',
    runAt: 'document_start',
    allFrames: false,
    persistAcrossSessions: true,
  };
}

function equivalent(left: chrome.scripting.RegisteredContentScript | undefined, right: chrome.scripting.RegisteredContentScript | undefined): boolean {
  const normalized = (script: chrome.scripting.RegisteredContentScript | undefined) => script ? {
    id: script.id,
    js: script.js ?? [],
    css: script.css ?? [],
    matches: [...(script.matches ?? [])].sort(),
    excludeMatches: [...(script.excludeMatches ?? [])].sort(),
    world: script.world ?? 'ISOLATED',
    runAt: script.runAt ?? 'document_idle',
    allFrames: script.allFrames ?? false,
    persistAcrossSessions: script.persistAcrossSessions ?? true,
    matchOriginAsFallback: script.matchOriginAsFallback ?? false,
  } : null;
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

async function readRegistration(): Promise<chrome.scripting.RegisteredContentScript | undefined> {
  const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [YOUTUBE_STARTUP_SCRIPT_ID] });
  return scripts.find(script => script.id === YOUTUBE_STARTUP_SCRIPT_ID);
}

async function applyRegistration(next: chrome.scripting.RegisteredContentScript | undefined, current: chrome.scripting.RegisteredContentScript | undefined): Promise<void> {
  if (equivalent(current, next)) return;
  if (!next) {
    if (current) await chrome.scripting.unregisterContentScripts({ ids: [YOUTUBE_STARTUP_SCRIPT_ID] });
  } else if (current) await chrome.scripting.updateContentScripts([next]);
  else await chrome.scripting.registerContentScripts([next]);
}

/** Reconcile only this extension's owned startup registration and restore its exact previous state on failure. */
export async function reconcileYouTubeStartup(settings: Settings): Promise<void> {
  const next = desiredRegistration(settings);
  const previous = await readRegistration();
  if (equivalent(previous, next)) return;
  try {
    await applyRegistration(next, previous);
    if (!equivalent(await readRegistration(), next)) throw new Error('Trình duyệt không lưu đúng cấu hình khởi động YouTube.');
  } catch (error) {
    try {
      await applyRegistration(previous, await readRegistration());
      if (!equivalent(await readRegistration(), previous)) throw new Error('Cấu hình khôi phục không khớp trạng thái trước đó.');
    } catch (rollbackError) {
      throw new Error(`Không áp dụng bảo vệ khởi động YouTube; khôi phục thất bại: ${String(rollbackError)}. Lỗi gốc: ${String(error)}`);
    }
    throw new Error(`Không áp dụng bảo vệ khởi động YouTube; đã khôi phục cấu hình trước đó: ${String(error)}`);
  }
}
