import { GROUPS } from './shared/types';
import { DEFAULT_SETTINGS, hostname, matchesDomain, normalizeDomain } from './shared/defaults';
import { validateUserRules, normalizeLegacyRules } from './shared/adguard-rules';
import { configureEngine, loadSnapshot, loadBlockIndex, isNetworkBlock, handleEngineMessage, MESSAGE_HANDLER_NAME, onCosmeticEvent, resolveNetworkRuleSource, networkSourceGeneration } from './engine';
import { loadUpdateState, getActiveUpdateRules, checkFilterUpdates, ensureUpdateAlarm, ALARM_NAME } from './filter-updates';
import { HISTORY_KEY, normalizeHistory, recordBlock, categoryForRuleset, type BlockingHistory } from './shared/statistics';
import { createDomainLookup } from './shared/domain-index';
import { createBatchedPersistence } from './shared/persistence';
import { startWithSecurityRecovery } from './shared/startup-recovery';
import type { AppState, PopupState, Settings, ContentConfig, LogEntry, TabStats, RequestMessage } from './shared/types';

let settings: Settings = structuredClone(DEFAULT_SETTINGS);
let isSiteAllowed = createDomainLookup(settings.allowlist);
let updateRules: string[] = [];
let recoveryWarnings: string[] = [];
let securityRecoveryWarning: string | null = null;
let supplementalFailure: string | null = null;
let total = 0;
let history: BlockingHistory = normalizeHistory(undefined);
let tabStats: Record<number, TabStats> = {};
let logs: LogEntry[] = [];
let countMode: AppState['countMode'] = 'unavailable';
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const result = chain.then(job, job);
  chain = result.catch(() => undefined);
  return result;
}
function errorText(error: unknown): string { return error instanceof Error ? error.message : String(error); }
const persistence = createBatchedPersistence({
  write: batch => serial(async () => {
    if(batch.network)await chrome.storage.local.set({ total, [HISTORY_KEY]: history });
    await persistSession();
    await Promise.allSettled(batch.tabs.map(badge));
  }),
  report: error => console.error('Safora persistence:', errorText(error)),
});
function scheduleFlush(tabId: number, network = false): void { persistence.mark(tabId, network); }
function blankTab(host = ''): TabStats { return { network: 0, cosmetic: 0, host }; }
function safeTarget(input: string): string {
  try { const url = new URL(input); return `${url.origin}${url.pathname}`.slice(0, 400); } catch { return input.slice(0, 200); }
}
function addLog(entry: Omit<LogEntry, 'id' | 'time'>): void {
  if (!settings.logging) return;
  logs.push({ ...entry, id: crypto.randomUUID(), time: Date.now() });
  if (logs.length > 500) logs.splice(0, logs.length - 500);
}
async function persistSession(): Promise<void> { await chrome.storage.session.set({ tabStats, logs }); }
const badgeCache=new Map<number,{color:string;text:string;title:string}>();
async function badge(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab) { badgeCache.delete(tabId); return; }
  const host = hostname(tab.url || '');
  const enabled = !!host && settings.enabled && !isSiteAllowed(host);
  const count = tabStats[tabId]?.network || 0;
  const next={
    color:enabled ? '#dc354b' : '#6b7280',
    text:!enabled ? 'OFF' : countMode === 'native' ? '__native__' : countMode !== 'debug' || !count ? '' : count > 9999 ? '9k+' : String(count),
    title:`Safora · ${enabled ? 'Đang bảo vệ' : 'Tạm dừng'}${countMode === 'debug' ? ` · ${count} lượt chặn` : ''}`,
  };
  const previous=badgeCache.get(tabId);
  const changes:Promise<void>[]=[];
  if(previous?.color!==next.color)changes.push(chrome.action.setBadgeBackgroundColor({tabId,color:next.color}));
  // Omitting text removes our per-tab override and restores Chrome's native badge.
  if(previous?.text!==next.text)changes.push(chrome.action.setBadgeText(next.text==='__native__'?{tabId}:{tabId,text:next.text}));
  if(previous?.title!==next.title)changes.push(chrome.action.setTitle({tabId,title:next.title}));
  const results=await Promise.allSettled(changes);
  if(results.some(result=>result.status==='rejected'))badgeCache.delete(tabId);
  else badgeCache.set(tabId,next);
}
function validateSettings(patch: unknown): Settings {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Cài đặt không hợp lệ.');
  const p = patch as Record<string, unknown>;
  const allowed = ['enabled', 'groups', 'allowlist', 'userRules', 'theme', 'logging', 'scriptlets'];
  if (Object.keys(p).some(key => !allowed.includes(key))) throw new Error('Thuộc tính cài đặt không được hỗ trợ.');
  const next = structuredClone(settings);
  for (const key of ['enabled', 'logging', 'scriptlets'] as const) {
    if (key in p) { if (typeof p[key] !== 'boolean') throw new Error(`${key} phải là boolean.`); next[key] = p[key]; }
  }
  if ('groups' in p) {
    if (!p.groups || typeof p.groups !== 'object' || Array.isArray(p.groups)) throw new Error('Nhóm bộ lọc không hợp lệ.');
    for (const [group, value] of Object.entries(p.groups)) {
      if (!GROUPS.includes(group as typeof GROUPS[number]) || typeof value !== 'boolean') throw new Error('Nhóm bộ lọc không hợp lệ.');
      next.groups[group as typeof GROUPS[number]] = value;
    }
  }
  if ('theme' in p) {
    if (!['system', 'light', 'dark'].includes(p.theme as string)) throw new Error('Giao diện không hợp lệ.');
    next.theme = p.theme as Settings['theme'];
  }
  if ('userRules' in p) {
    if (typeof p.userRules !== 'string' || p.userRules.length > 250000) throw new Error('Quy tắc tối đa 250.000 ký tự.');
    next.userRules = normalizeLegacyRules(p.userRules);
  }
  if ('allowlist' in p) {
    if (!Array.isArray(p.allowlist) || p.allowlist.length > 1000 || p.allowlist.some(x => typeof x !== 'string')) throw new Error('Danh sách trắng tối đa 1.000 tên miền.');
    next.allowlist = [...new Set((p.allowlist as string[]).map(normalizeDomain))].sort();
  }
  return next;
}
async function saveSettings(patch: unknown): Promise<void> {
  const next = validateSettings(patch);
  const diagnostics = validateUserRules(next.userRules);
  if (diagnostics.length) throw new Error(diagnostics.map(d => `Dòng ${d.line}: ${d.message}`).join('\n'));
  const previous = settings;
  await configureEngine(next, updateRules);
  const acknowledgesSecurity = Object.hasOwn((patch as Partial<Settings>).groups ?? {}, 'security');
  const nextSecurityWarning = acknowledgesSecurity ? null : securityRecoveryWarning;
  try { await chrome.storage.local.set({ settings: next, securityRecoveryWarning: nextSecurityWarning }); }
  catch (error) { await configureEngine(previous, updateRules); throw error; }
  settings = next;
  securityRecoveryWarning = nextSecurityWarning;
  isSiteAllowed = createDomainLookup(settings.allowlist);
  recoveryWarnings=[];
  if (!settings.logging) { logs = []; await persistSession(); }
  if(previous.enabled!==settings.enabled || previous.allowlist.join('\n')!==settings.allowlist.join('\n')){
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs.filter(tab => tab.id !== undefined).map(async tab => {
      await badge(tab.id!);
      await chrome.tabs.sendMessage(tab.id!, { type: 'config:refresh' }, {frameId:0}).catch(() => undefined);
    }));
  }
}
async function getState(tabId?: number, includeLogs = true): Promise<AppState> {
  const tab = tabId === undefined ? null : await chrome.tabs.get(tabId).catch(() => null);
  const host = hostname(tab?.url || '');
  const snapshot = await loadSnapshot();
  const filters = snapshot.filters.map(({id,name,group,networkRules,version,updated})=>({id,name,group,networkRules,version,updated}));
  const selected = new Set(Object.entries(settings.groups).filter(([,enabled])=>enabled).map(([group])=>group));
  return {
    settings, tabId: tab?.id ?? null, url: tab?.url || '', host, supported: !!host,
    protected: !!host && settings.enabled && !isSiteAllowed(host),
    tab: tab?.id === undefined ? blankTab() : tabStats[tab.id] || blankTab(host), total, logs:includeLogs?logs:[],
    countMode, version: chrome.runtime.getManifest().version,
    engine:{name:'AdGuard TsWebExtension',version:'6.0.1',packagedNetworkRules:filters.reduce((sum,filter)=>sum+filter.networkRules,0),activeNetworkRules:settings.enabled?filters.filter(filter=>selected.has(filter.group)).reduce((sum,filter)=>sum+filter.networkRules,0):0,filters,warnings:[...recoveryWarnings,...(securityRecoveryWarning?[securityRecoveryWarning]:[])]},
    updates:supplementalFailure?{...await loadUpdateState(),status:'error',error:supplementalFailure}:await loadUpdateState(),
  };
}
async function getPopupState(tabId?: number): Promise<PopupState> {
  const tab = tabId === undefined ? null : await chrome.tabs.get(tabId).catch(() => null);
  const host = hostname(tab?.url || '');
  return {
    settings: { enabled: settings.enabled, theme: settings.theme },
    tabId: tab?.id ?? null, url: tab?.url || '', host, supported: !!host,
    protected: !!host && settings.enabled && !isSiteAllowed(host),
    tab: tab?.id === undefined ? blankTab() : tabStats[tab.id] || blankTab(host), total, countMode,
  };
}
async function contentConfig(sender: chrome.runtime.MessageSender): Promise<ContentConfig> {
  if (sender.tab?.id === undefined || !hostname(sender.url || '')) return { enabled: false };
  const frame = await chrome.webNavigation.getFrame({ tabId: sender.tab.id, frameId: sender.frameId ?? 0 }).catch(() => null);
  if (!frame || (sender.documentId && frame.documentId !== sender.documentId)) return { enabled: false };
  const tab = await chrome.tabs.get(sender.tab.id);
  const topHost = hostname(tab.url || '');
  const host = hostname(sender.url || '');
  const enabled = settings.enabled && !!topHost && !isSiteAllowed(topHost) && !isSiteAllowed(host);
  return { enabled };
}
function requireExtensionPage(sender: chrome.runtime.MessageSender): void {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('')) || !['/popup.html', '/options.html'].includes(new URL(sender.url).pathname)) throw new Error('Chỉ giao diện extension được thay đổi cài đặt.');
}
async function handle(message: RequestMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  await ready;
  switch (message.type) {
    case 'addUserRule': {
      if (sender.tab?.id === undefined || sender.frameId !== 0 || typeof message.rule !== 'string') throw new Error('Quy tắc picker không hợp lệ.');
      const host = hostname(sender.url || '');
      if (!host || !message.rule.startsWith(`${host}##`) || /[\r\n]/.test(message.rule) || !(await contentConfig(sender)).enabled) throw new Error('Picker chỉ được lưu CSS cho trang đang được bảo vệ.');
      await saveSettings({ userRules: `${settings.userRules.trim()}\n${message.rule}`.trim() }); return null;
    }
    default: requireExtensionPage(sender);
  }
  switch (message.type) {
    case 'state': return message.scope === 'popup' ? getPopupState(message.tabId) : getState(message.tabId,message.includeLogs!==false);
    case 'statistics': return normalizeHistory(history);
    case 'settings': await saveSettings(message.patch); return getState();
    case 'toggleSite': {
      if (!Number.isInteger(message.tabId) || typeof message.enabled !== 'boolean') throw new Error('Tab không hợp lệ.');
      const tab = await chrome.tabs.get(message.tabId);
      const host = hostname(tab.url || '');
      if (!host) throw new Error('Chỉ hỗ trợ trang HTTP/HTTPS.');
      const allowlist = message.enabled ? settings.allowlist.filter(domain => !matchesDomain(host, domain)) : [...settings.allowlist, host];
      await saveSettings({ allowlist, ...(message.enabled ? { enabled: true } : {}) });
      await chrome.tabs.reload(message.tabId); return getState(message.tabId);
    }
    case 'startPicker': {
      if (!Number.isInteger(message.tabId)) throw new Error('Tab không hợp lệ.');
      const state = await getState(message.tabId);
      if (!state.protected) throw new Error('Hãy bật bảo vệ trên trang trước khi chọn phần tử.');
      let reply: { ok: boolean; error?: string };
      try { reply = await chrome.tabs.sendMessage(message.tabId, { type: 'picker:start' }, { frameId: 0 }); }
      catch { throw new Error('Hãy tải lại trang sau khi cài extension, rồi mở lại bộ chọn phần tử.'); }
      if (!reply?.ok) throw new Error(reply?.error || 'Bộ chọn phần tử chưa sẵn sàng.');
      return null;
    }
    case 'clearLog': logs = []; await persistSession(); return null;
    case 'updateFilters': return refreshFilters(true);
    case 'openOptions': {
      const section = typeof message.section === 'string' && ['dashboard', 'filters', 'rules', 'allowlist', 'log', 'settings', 'privacy', 'appearance'].includes(message.section) ? message.section : 'filters';
      await chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#${section}`) }); return null;
    }
    default: throw new Error('Lệnh không được hỗ trợ.');
  }
}
async function initialize(): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const stored = await chrome.storage.local.get(['settings', 'total', HISTORY_KEY, 'securityRecoveryWarning']);
  securityRecoveryWarning = typeof stored.securityRecoveryWarning === 'string' ? stored.securityRecoveryWarning.slice(0, 2000) : null;
  history = normalizeHistory(stored[HISTORY_KEY]);
  if (stored.settings) {
    try{ settings = validateSettings(stored.settings); }catch(error){recoveryWarnings.push('Cấu hình lỗi; đã khôi phục mặc định: '+errorText(error));await chrome.storage.local.set({quarantinedSettings:stored.settings});}
  }
  isSiteAllowed = createDomainLookup(settings.allowlist);
  settings.userRules=normalizeLegacyRules(settings.userRules);
  const diagnostics=validateUserRules(settings.userRules);
  if(diagnostics.length)recoveryWarnings.push('Quy tắc cá nhân đã lưu không hợp lệ, tạm ngưng áp dụng. Có thể sửa trong Quy tắc người dùng: '+diagnostics.map(d=>d.message).slice(0,3).join('; '));
  updateRules=await getActiveUpdateRules();
  await loadSnapshot();
  total = typeof stored.total === 'number' && Number.isSafeInteger(stored.total) && stored.total >= 0 ? stored.total : 0;
  const session = await chrome.storage.session.get(['tabStats', 'logs']);
  tabStats = (session.tabStats && typeof session.tabStats === 'object' ? session.tabStats : {}) as Record<number, TabStats>;
  logs = settings.logging && Array.isArray(session.logs) ? session.logs.slice(-500) as LogEntry[] : [];
  const self = await chrome.management.getSelf().catch(() => null);
  countMode = self?.installType === 'development' && chrome.runtime.getManifest().permissions?.includes('declarativeNetRequestFeedback') ? 'debug' : 'native';
  if (countMode === 'debug') await loadBlockIndex();
  const start = async (candidate: Settings, rules: string[]): Promise<void> => {
    const recovery = await startWithSecurityRecovery(candidate, rules, configureEngine);
    if (recovery.securityDisabled) settings = { ...settings, groups: { ...settings.groups, security: false } };
    if (recovery.warning) securityRecoveryWarning = recovery.warning.slice(0, 2000);
  };
  const startupSettings=diagnostics.length?{...settings,userRules:''}:settings;
  try{await start(startupSettings,updateRules);}catch(error){
    supplementalFailure='Không áp dụng được bộ sửa lỗi đã lưu; dùng bộ lọc đóng gói. '+errorText(error);
    updateRules=[];
    try{await start(startupSettings,[]);}catch(baselineError){
      recoveryWarnings.push('Tạm ngưng quy tắc cá nhân để phục hồi engine: '+errorText(baselineError));
      try{await start({...settings,userRules:''},[]);}catch(emptyError){
        await chrome.storage.local.set({quarantinedSettings:settings});
        settings={...settings,enabled:false,groups:{ads:false,privacy:false,security:false,annoyances:false,vietnam:false}};
        recoveryWarnings.push('Không thể bật bộ lọc đóng gói; đã tạm tắt bảo vệ để mở lại Cài đặt. Kiểm tra quota hoặc xung đột extension, rồi chọn lại bộ lọc: '+errorText(emptyError));
        await configureEngine({...settings,userRules:''},[]);
      }
    }
    recoveryWarnings.push(supplementalFailure);
  }
  await ensureUpdateAlarm();
  await chrome.storage.local.set({ settings, total, [HISTORY_KEY]: history, securityRecoveryWarning });
  await chrome.declarativeNetRequest.setExtensionActionOptions({ displayActionCountAsBadgeText: countMode === 'native' });
  const tabs = await chrome.tabs.query({});
  const live = new Set(tabs.map(tab => tab.id));
  for (const key of Object.keys(tabStats)) if (!live.has(Number(key))) delete tabStats[Number(key)];
  for(const tab of tabs)if(tab.id!==undefined)tabStats[tab.id] ||= blankTab(hostname(tab.url||''));
  await Promise.allSettled(tabs.filter(tab => tab.id !== undefined).map(tab => badge(tab.id!)));
}
const ready = initialize();
void ready.catch(error => console.error('Safora initialization:', errorText(error)));
chrome.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (!message || typeof message !== 'object') return false;
  if ('handlerName' in message && message.handlerName === MESSAGE_HANDLER_NAME) {
    if(sender.id!==chrome.runtime.id || sender.tab?.id===undefined)return false;
    void ready.then(()=>handleEngineMessage(message,sender)).then(respond,error=>respond({error:errorText(error)}));
    return true;
  }
  if (!('type' in message) || typeof message.type !== 'string') return false;
  if(message.type==='contentConfig') {
    // Picker authorization can arrive while startPicker awaits the content reply.
    // Read the committed policy without queuing behind that same operation.
    void ready.then(()=>contentConfig(sender)).then(data=>respond({ok:true,data}),error=>respond({ok:false,error:errorText(error)}));return true;
  }
  if(message.type==='updateFilters') {
    try{ requireExtensionPage(sender); }catch(error){respond({ok:false,error:errorText(error)});return false;}
    void ready.then(()=>refreshFilters(true)).then(data=>respond({ok:true,data}),error=>respond({ok:false,error:errorText(error)}));return true;
  }
  void serial(() => handle(message as RequestMessage, sender)).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: errorText(error) }));
  return true;
});
chrome.webNavigation.onBeforeNavigate.addListener(details => {
  if (details.frameId !== 0) return;
  void serial(async () => { await ready; badgeCache.delete(details.tabId); tabStats[details.tabId] = blankTab(hostname(details.url)); scheduleFlush(details.tabId); await badge(details.tabId); }).catch(console.error);
});
chrome.tabs.onRemoved.addListener(tabId => {
  void serial(async () => { await ready; delete tabStats[tabId]; badgeCache.delete(tabId); persistence.forgetTab(tabId); logs = logs.filter(entry => entry.tabId !== tabId); scheduleFlush(-1); }).catch(console.error);
});
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === 'complete') void serial(async()=>{await ready;await badge(tabId);}).catch(console.error); });
if (chrome.runtime.getManifest().permissions?.includes('declarativeNetRequestFeedback') && chrome.declarativeNetRequest.onRuleMatchedDebug) chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(info => {
  const sourceGeneration = networkSourceGeneration();
  void serial(async () => {
    await ready;
    if (countMode !== 'debug') return;
    const { rule, request } = info;
    const group = rule.rulesetId;
    const isBlock = isNetworkBlock(group,rule.ruleId);
    if (!isBlock) return;
    total += 1;
    recordBlock(history, categoryForRuleset(group), Date.now());
    if (request.tabId >= 0) {
      const stats = tabStats[request.tabId] ||= blankTab();
      stats.network += 1;
      if(settings.logging)addLog({ kind: 'network', tabId: request.tabId, host: stats.host, target: safeTarget(request.url), rule: `${group}:${rule.ruleId}`, group, sourceDetail: await resolveNetworkRuleSource(group, rule.ruleId, sourceGeneration) });
    }
    scheduleFlush(request.tabId,true);
  }).catch(console.error);
});

async function refreshFilters(force:boolean):Promise<unknown>{
  return checkFilterUpdates(force,rules=>serial(async()=>{await configureEngine(settings,rules);updateRules=rules;supplementalFailure=null;recoveryWarnings=recoveryWarnings.filter(warning=>!warning.includes("bộ sửa lỗi"));}));
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name===ALARM_NAME)void ready.then(()=>refreshFilters(false)).catch(console.error);});
void ready.then(()=>refreshFilters(false)).catch(console.error);
onCosmeticEvent(event=>{if(!settings.logging)return;void serial(async()=>{await ready;if(!settings.logging)return;const data=event.data;if(data.tabId<0 || !tabStats[data.tabId])return;const stats=tabStats[data.tabId];stats.cosmetic++;addLog({kind:'cosmetic',tabId:data.tabId,host:hostname(data.frameUrl),target:data.element.slice(0,300),rule:String(data.appliedRuleText||'').slice(0,300),group:String(data.filterId)});scheduleFlush(data.tabId);}).catch(console.error);});
