import { TsWebExtension, FilterList, MESSAGE_HANDLER_NAME, type Configuration, type ConfigurationResult, type Message, type LocalScriptFunctionData, type ApplyCosmeticRuleEvent } from '@adguard/tswebextension/mv3';
import { GROUP_FILTER_IDS } from './shared/filter-sources';
import { normalizeLegacyRules, prepareUserRules } from './shared/adguard-rules';
import type { Settings } from './shared/types';
import { localScriptRules } from 'rea:local-script-rules';
import { reconcileYouTubeStartup } from './youtube-startup';
import { YOUTUBE_COMPATIBILITY_RULES } from './shared/youtube-rules';
import { hasBlockRule, type BlockRuleIndex } from './shared/block-index';
import { createFilterMetadataLoader } from './shared/filter-metadata';
import { assertStaticBudget } from './shared/static-budget';
import { createRuleSourceLog } from './shared/rule-source-log';

export { MESSAGE_HANDLER_NAME };
export const engine = new TsWebExtension('/web-accessible-resources');
TsWebExtension.setLocalScriptRules(localScriptRules as LocalScriptFunctionData);
let engineMessageHandler: ReturnType<TsWebExtension['getMessageHandler']> | undefined;
let activeConfig: Configuration | undefined;
let activeStartupSettings: Settings | undefined;
let activeKey='';
let initialized=false;
let currentDynamicBlocks = new Set<number>();
export let engineWarnings: string[] = [];
const metadata = createFilterMetadataLoader(path => fetch(chrome.runtime.getURL(path)));
const ruleSourceLog = createRuleSourceLog();
export const resolveNetworkRuleSource = ruleSourceLog.resolve;
export const networkSourceGeneration = ruleSourceLog.generation;
export const loadSnapshot = metadata.loadSnapshot;
let blockIndex: DataView | undefined;
let blockIndexes = new Map<string, BlockRuleIndex>();
export async function loadBlockIndex(): Promise<void> {
  const loaded = await metadata.loadBlockIndex();
  blockIndex = loaded.data;
  blockIndexes = loaded.ranges;
}
function source(content:string,filterId:number) {
  const list=new FilterList(normalizeLegacyRules(content),filterId);
  if(list.getConversionErrors().length) throw new Error(list.getConversionErrors().slice(0,8).map(error=>error.message).join('\n'));
  return {content:list.getContent(),conversionData:list.getConversionData()};
}
function configuration(settings:Settings,updateRules:string[]):{ native:Configuration; startup:Settings } {
  const customUser=prepareUserRules(settings.userRules, settings.scriptlets);
  const merged=[...updateRules,customUser].join('\n');
  const effectiveUser=source(settings.groups.ads?merged:customUser,0);
  // Native customFilters require userScripts; bundled scriptlets use the ordinary userrules path.
  // Keep the internal exception out of the startup policy, which belongs to user/update rules only.
  const nativeUser=settings.groups.ads?source([...YOUTUBE_COMPATIBILITY_RULES,effectiveUser.content].join('\n'),0):effectiveUser;
  return { native:{
    logLevel:'error' as Configuration['logLevel'],filtersPath:'filters',rulesetsPath:'filters/declarative',
    staticFiltersIds:Object.entries(settings.groups).filter(([,enabled])=>enabled).flatMap(([group])=>[...GROUP_FILTER_IDS[group as keyof typeof GROUP_FILTER_IDS]]),
    customFilters:[],
    trustedDomains:[],allowlist:settings.allowlist,userrules:nativeUser,declarativeLogEnabled:false,
    settings:{
      filteringEnabled:settings.enabled,allowlistEnabled:true,allowlistInverted:false,collectStats:settings.logging,debugScriptlets:false,
      assistantUrl:'assistant-inject.js',gpcScriptUrl:'gpc.js',hideDocumentReferrerScriptUrl:'hide-document-referrer.js',
      stealthModeEnabled:false,
      stealth:{selfDestructFirstPartyCookies:false,selfDestructFirstPartyCookiesTime:0,selfDestructThirdPartyCookies:false,selfDestructThirdPartyCookiesTime:0,hideReferrer:false,hideSearchQueries:false,blockChromeClientData:false,sendDoNotTrack:false,blockWebRTC:false},
    },
  }, startup:{...settings,userRules:effectiveUser.content} };
}
function checkResult(result:ConfigurationResult):void {
  const errors=[...result.staticFiltersStatus.errors.map(error=>error.message),...(result.dynamicRules?.errors||[]).map(error=>String(error))];
  const limits=(result.dynamicRules?.limitations||[]).map(error=>String(error));
  if(errors.length || limits.length)throw new Error(['Engine từ chối cấu hình để tránh mất quy tắc.',...errors,...limits].slice(0,12).join('\n'));
  engineWarnings=[];
}
function updateDiagnosticSources(result: ConfigurationResult, enabled: boolean): void {
  ruleSourceLog.replace([...result.staticFilters, ...(result.dynamicRules ? [result.dynamicRules.ruleset] : [])], enabled);
}
export async function configureEngine(settings:Settings,updates:string[]):Promise<void> {
  const key=JSON.stringify({enabled:settings.enabled,groups:settings.groups,allowlist:settings.allowlist,userRules:settings.userRules,scriptlets:settings.scriptlets,logging:settings.logging,updates});
  if(engine.isStarted && activeKey===key)return;
  const {native:next,startup:startupSettings}=configuration(settings,updates);
  if (settings.enabled) {
    const [snapshot, enabled, available] = await Promise.all([loadSnapshot(), chrome.declarativeNetRequest.getEnabledRulesets(), chrome.declarativeNetRequest.getAvailableStaticRuleCount()]);
    assertStaticBudget(snapshot.filters, enabled, next.staticFiltersIds, available, chrome.declarativeNetRequest.MAX_NUMBER_OF_ENABLED_STATIC_RULESETS);
  }
  const previousConfig=activeConfig;
  const previousStartupSettings=activeStartupSettings;
  const previousKey=activeKey;
  if(!initialized){await engine.initStorage();initialized=true;}
  // DNR IDs can be reused during configuration. Events received in this
  // transition retain their native ID but must not borrow a later source map.
  ruleSourceLog.replace([], false);
  activeKey='';
  try {
    const result=engine.isStarted?await engine.configure(next):await engine.start(next);
    checkResult(result);
    const blocks = blockIndex ? new Set((await chrome.declarativeNetRequest.getDynamicRules()).filter(rule=>rule.action.type==='block').map(rule=>rule.id)) : new Set<number>();
    await reconcileYouTubeStartup(startupSettings);
    updateDiagnosticSources(result, settings.logging);
    currentDynamicBlocks=blocks;
    activeConfig=next;
    activeStartupSettings=startupSettings;
    activeKey=key;
  } catch(error) {
    if(previousConfig) {
      try { const restored=await engine.configure(previousConfig);checkResult(restored);if(previousStartupSettings)await reconcileYouTubeStartup(previousStartupSettings);updateDiagnosticSources(restored,previousConfig.settings.collectStats);currentDynamicBlocks=blockIndex?new Set((await chrome.declarativeNetRequest.getDynamicRules()).filter(rule=>rule.action.type==='block').map(rule=>rule.id)):new Set<number>();activeConfig=previousConfig;activeStartupSettings=previousStartupSettings;activeKey=previousKey; }
      catch(rollbackError){throw new Error(`Không áp dụng cấu hình; khôi phục engine thất bại: ${String(rollbackError)}. Lỗi gốc: ${String(error)}`);}
    }
    throw error;
  }
}
export function isNetworkBlock(rulesetId:string,ruleId:number):boolean {
  if(rulesetId==='_dynamic')return currentDynamicBlocks.has(ruleId);
  const range=blockIndexes.get(rulesetId);
  return !!blockIndex && !!range && hasBlockRule(blockIndex,range,ruleId);
}
export async function handleEngineMessage(message:unknown,sender:chrome.runtime.MessageSender):Promise<unknown> {
  // Upstream creates a bound MessagesApi each time; its dependencies remain live
  // on this engine instance through configure/start and rollback.
  return (engineMessageHandler ??= engine.getMessageHandler())(message as Message,sender);
}
export function onCosmeticEvent(listener:(event:ApplyCosmeticRuleEvent)=>void):void {
  engine.onFilteringLogEvent.subscribe(event=>{if(event.type==='applyCosmeticRule')listener(event);});
}
