import { RuleParser } from '@adguard/agtree/parser';
import { CosmeticRule, FilterList, NetworkRule } from '@adguard/tsurlfilter';
import { Rule as DeclarativeSourceRule, RuleDeclarativeValidator, UnsupportedModifierError } from '@adguard/dnr-converter';
import { preprocessChromiumMV3 } from './shared/filter-preprocessor.ts';

/**
 * A small, independently refreshed fixes subscription. Full AdGuard static lists
 * remain packaged with the extension and are updated by rebuilding the package.
 * Remote text is data for the bundled, untrusted-filter engine, never JavaScript.
 */
export const ALARM_NAME = 'rea-filter-updates';
export const UPDATE_SOURCE_URL = 'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/quick-fixes.txt';
const SOURCE_NAME = 'uBlock Origin — Quick fixes';
const SOURCE_LICENSE_URL = 'https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE';
const STORAGE_KEY = 'filterUpdateSnapshotV1';
const MAX_BYTES = 1024 * 1024;
const MAX_LINES = 10_000;
const MAX_LINE_LENGTH = 32_768;
const HOUR = 60 * 60 * 1000;
const DEFAULT_INTERVAL = 24 * HOUR;
const REQUEST_TIMEOUT = 20_000;

export interface UpdateState {
  sourceName: string;
  sourceUrl: string;
  sourceLicenseUrl: string;
  lastChecked: number | null;
  lastUpdated: number | null;
  nextCheck: number;
  version: string;
  ruleCount: number;
  skippedRules: number;
  warning: string | null;
  /** Digest of the received UTF-8 text, not a publisher signature. */
  sha256: string;
  status: 'never' | 'updated' | 'unchanged' | 'error';
  error: string | null;
  failures: number;
}

interface Snapshot {
  schema: 1;
  text: string;
  state: UpdateState;
  etag: string;
  lastModified: string;
  interval: number;
}

interface UpdateStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface FilterUpdaterDependencies {
  storage: UpdateStorage;
  fetch: typeof fetch;
  /** Production uses Chrome's real RE2 syntax and compiled-memory validator. */
  isRegexSupported?: (regex: string) => Promise<boolean>;
  now?: () => number;
  /** Tests may shorten the timeout; callers cannot raise the production bound. */
  requestTimeoutMs?: number;
}

export interface FilterUpdater {
  loadUpdateState(): Promise<UpdateState>;
  getActiveUpdateRules(): Promise<string[]>;
  checkFilterUpdates(force: boolean, apply: (rules: string[]) => Promise<void>): Promise<UpdateState>;
}

function errorText(error: unknown): string {
  return [...(error instanceof Error ? error.message : String(error))].map(character => character.charCodeAt(0) < 32 ? ' ' : character).join('').slice(0, 1000);
}

function emptySnapshot(): Snapshot {
  return {
    schema: 1, text: '', etag: '', lastModified: '', interval: DEFAULT_INTERVAL,
    state: {
      sourceName: SOURCE_NAME, sourceUrl: UPDATE_SOURCE_URL, sourceLicenseUrl: SOURCE_LICENSE_URL,
      lastChecked: null, lastUpdated: null, nextCheck: 0, version: '', ruleCount: 0, skippedRules: 0, warning: null,
      sha256: '', status: 'never', error: null, failures: 0,
    },
  };
}

function timestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function safeHeader(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length <= limit && ![...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}

async function digest(text: string): Promise<string> {
  const value = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function sourceLines(text: string): string[] {
  return text.replace(/^\uFEFF/, '').split(/\r?\n/);
}

/** Validate the exact normalized representation consumed by TsWebExtension. */
async function nativeCompatibility(line: string, index: number, isRegexSupported: (regex: string) => Promise<boolean>): Promise<string> {
  const list = new FilterList(line, 0);
  const conversions = list.getConversionErrors();
  if (conversions.length) throw new Error(`Quy tắc nguồn không thể chuyển đổi ở dòng ${index + 1}: ${conversions[0]!.message}`);
  for (const converted of sourceLines(list.getContent())) {
    const node = RuleParser.parse(converted, { tolerant: true, parseUboSpecificRules: true, parseAbpSpecificRules: true, isLocIncluded: false, includeRaws: false });
    if (node.category === 'Invalid') throw new Error(`Quy tắc nguồn không hợp lệ sau chuyển đổi ở dòng ${index + 1}: ${node.error.message}`);
    if (node.category === 'Comment' || node.category === 'Empty') continue;
    if (node.type === 'JsInjectionRule') throw new Error(`Quy tắc nguồn chuyển thành JavaScript từ xa ở dòng ${index + 1}.`);
    if (node.type === 'ScriptletInjectionRule' || node.type === 'HtmlFilteringRule') return 'converted rule requires a scriptlet or HTML filtering';
    try {
      if (node.category === 'Network') {
        new NetworkRule(converted, 0, index);
        // FilterList conversion and native matching alone do not establish that
        // MV3 can represent the rule. Use the actual DNR admission validator too.
        for (const rule of DeclarativeSourceRule.createFromText(0, index, converted)) {
          const requiresDnr = RuleDeclarativeValidator.shouldConvertRule(rule);
          // These exceptions intentionally have no DNR output: TsWebExtension's
          // cosmetic engine consumes them. A false result for anything else is
          // not treated as successfully installed network filtering.
          if (!requiresDnr && !['elemhide', 'generichide', 'specifichide'].some(name => rule.isSingleModifierEnabled(name))) return 'native rule does not have an applicable MV3 conversion';
          if (requiresDnr && !rule.enabledModifiers.has('badfilter') && rule.isRegexRule() && !await isRegexSupported(rule.pattern.slice(1, -1))) return 'regular expression is unsupported by the browser RE2 syntax or memory limit';
        }
      } else if (node.category === 'Cosmetic') new CosmeticRule(converted, 0, index);
    } catch (error) {
      const message = errorText(error);
      const unavailableRedirect = /\$redirect modifier is invalid/.test(message) && node.type === 'NetworkRule' && node.modifiers?.children.some(modifier => /^(?:redirect|redirect-rule)$/.test(modifier.name.value) && !!modifier.value?.value);
      if (error instanceof UnsupportedModifierError || unavailableRedirect || /Unknown modifier:|Unsupported modifier|not supported|unsupported/i.test(message)) return `unsupported native/MV3 capability: ${message.slice(0, 240)}`;
      throw new Error(`Quy tắc nguồn không hợp lệ ở dòng ${index + 1}: ${message}`);
    }
  }
  return '';
}

async function safeSourceLines(lines: string[], isRegexSupported: (regex: string) => Promise<boolean>): Promise<{ lines: string[]; count: number; skipped: number }> {
  let count = 0;
  let skipped = 0;
  const safe: string[] = [];
  for (const [index, line] of lines.entries()) {
    const node = RuleParser.parse(line, {
      tolerant: true, parseUboSpecificRules: true, parseAbpSpecificRules: true,
      isLocIncluded: false, includeRaws: false,
    });
    if (node.category === 'Invalid') throw new Error(`Quy tắc nguồn không hợp lệ ở dòng ${index + 1}: ${node.error.message}`);
    if (node.category === 'Comment' || node.category === 'Empty') { safe.push(line); continue; }
    if (node.type === 'JsInjectionRule') throw new Error(`Bản cập nhật chứa mã JavaScript từ xa không được cho phép ở dòng ${index + 1}.`);
    let reason = '';
    if (node.type === 'HtmlFilteringRule') reason = 'HTML filtering is unavailable in MV3';
    if (node.type === 'NetworkRule' && !node.exception && node.modifiers?.children.some(modifier => modifier.name.value.toLowerCase() === 'replace')) reason = 'response-body replacement is unavailable in MV3';
    // The subscription is composed with user rules by the MV3 engine. Deny all
    // remote scriptlet arguments at this boundary so no trusted user-rule path
    // can interpret downloaded text as executable scriptlet parameters.
    if (node.type === 'ScriptletInjectionRule') reason = 'scriptlets are updated only through packaged extension releases';
    if (!reason) reason = await nativeCompatibility(line, index, isRegexSupported);
    if (reason) { skipped++; safe.push(`! REA skipped line ${index + 1}: ${reason}`); continue; }
    count++;
    safe.push(line);
  }
  return { lines: safe, count, skipped };
}

async function parseSource(text: string, isRegexSupported: (regex: string) => Promise<boolean>): Promise<{ lines: string[]; count: number; skipped: number; interval: number; version: string }> {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('Bản cập nhật vượt giới hạn 1 MiB.');
  // Filter arguments may legitimately contain HTML literals; inspect the
  // document prefix rather than mistaking those literals for an HTML response.
  if (text.includes(String.fromCharCode(0)) || text.includes('\uFFFD') || text.replace(/^\uFEFF/, '').trimStart().startsWith('<')) throw new Error('Máy chủ trả về nội dung không phải danh sách bộ lọc.');
  const lines = sourceLines(text);
  if (lines.length > MAX_LINES || lines.some(line => line.length > MAX_LINE_LENGTH)) throw new Error('Danh sách vượt giới hạn số dòng hoặc độ dài quy tắc.');
  const title = lines.find(line => /^!\s*Title:/i.test(line));
  if (!title || !/^!\s*Title:\s*uBlock(?:₀| Origin)?\s+filters\s*[–—-]\s*Quick fixes\s*$/i.test(title)) throw new Error('Tên danh sách không khớp nguồn Quick fixes đã được cho phép.');
  const activeLines = sourceLines(preprocessChromiumMV3(text));
  for (const line of activeLines) {
    if (line.trimStart().startsWith('!')) continue;
    const jsMarker = line.match(/#@?%#/);
    if (jsMarker && !line.slice(jsMarker.index! + jsMarker[0].length).trimStart().startsWith('//scriptlet(')) throw new Error('Bản cập nhật chứa mã JavaScript từ xa không được cho phép.');
  }
  const sanitized = await safeSourceLines(activeLines, isRegexSupported);
  const expires = text.match(/^!\s*Expires:\s*(\d+)\s*(hours?|days?)/im);
  const requestedInterval = expires ? Number(expires[1]) * (expires[2]!.toLowerCase().startsWith('day') ? 24 : 1) * HOUR : DEFAULT_INTERVAL;
  const interval = Math.min(DEFAULT_INTERVAL, Math.max(HOUR, Number.isFinite(requestedInterval) ? requestedInterval : DEFAULT_INTERVAL));
  const version = (text.match(/^!\s*Version:\s*([^\r\n]+)/im)?.[1] || '').trim().slice(0, 100);
  return { ...sanitized, interval, version };
}

async function validateSnapshot(input: unknown, isRegexSupported: (regex: string) => Promise<boolean>): Promise<Snapshot> {
  if (!input || typeof input !== 'object') throw new Error('Thiếu dữ liệu bộ lọc đã lưu.');
  const record = input as Partial<Snapshot>;
  const state = record.state;
  if (record.schema !== 1 || typeof record.text !== 'string' || !state ||
    state.sourceUrl !== UPDATE_SOURCE_URL || state.sourceName !== SOURCE_NAME || state.sourceLicenseUrl !== SOURCE_LICENSE_URL ||
    !['never', 'updated', 'unchanged', 'error'].includes(state.status) ||
    !(state.lastChecked === null || timestamp(state.lastChecked)) || !(state.lastUpdated === null || timestamp(state.lastUpdated)) ||
    !timestamp(state.nextCheck) || !timestamp(state.ruleCount) || !timestamp(state.skippedRules) || !timestamp(state.failures) || state.failures > 100 ||
    !safeHeader(state.version, 100) || !safeHeader(state.sha256, 64) ||
    !(state.error === null || safeHeader(state.error, 1000)) || !(state.warning === null || safeHeader(state.warning, 1000)) ||
    !safeHeader(record.etag, 512) || !safeHeader(record.lastModified, 256) ||
    typeof record.interval !== 'number' || record.interval < HOUR || record.interval > DEFAULT_INTERVAL) throw new Error('Dữ liệu bộ lọc đã lưu không hợp lệ.');
  if (state.lastUpdated !== null) {
    const parsed = await parseSource(record.text, isRegexSupported);
    if (!/^[a-f0-9]{64}$/.test(state.sha256) || state.sha256 !== await digest(record.text) || state.ruleCount !== parsed.count || state.skippedRules !== parsed.skipped) throw new Error('Nội dung bộ lọc đã lưu không khớp SHA-256.');
  } else if (record.text || state.sha256 || state.ruleCount) throw new Error('Bộ lọc đã lưu thiếu phiên bản được xác nhận.');
  return structuredClone(record as Snapshot);
}

async function readResponse(response: Response): Promise<string> {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_BYTES) throw new Error('Bản cập nhật vượt giới hạn 1 MiB.');
  if (/html|javascript|json|wasm/i.test(response.headers.get('content-type') || '')) throw new Error('Máy chủ trả về định dạng không phải danh sách văn bản.');
  if (!response.body) throw new Error('Bản cập nhật không có nội dung.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) throw new Error('Bản cập nhật vượt giới hạn 1 MiB.');
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
}

/** An isolated instance makes network/storage failure behavior testable. */
export function createFilterUpdater(dependencies: FilterUpdaterDependencies): FilterUpdater {
  const now = dependencies.now || Date.now;
  const regexChecks = new Map<string, Promise<boolean>>();
  function isRegexSupported(regex: string): Promise<boolean> {
    let result = regexChecks.get(regex);
    if (!result) {
      result = (dependencies.isRegexSupported ? dependencies.isRegexSupported(regex) : (async () => {
        if (typeof chrome === 'undefined' || !chrome.declarativeNetRequest?.isRegexSupported) throw new Error('Không có API trình duyệt để xác minh regex của bộ lọc.');
        return (await chrome.declarativeNetRequest.isRegexSupported({ regex })).isSupported;
      })()).catch(error => { regexChecks.delete(regex); throw error; });
      if (regexChecks.size >= 1000) regexChecks.delete(regexChecks.keys().next().value!);
      regexChecks.set(regex, result);
    }
    return result;
  }
  const timeout = Math.min(REQUEST_TIMEOUT, Math.max(1, dependencies.requestTimeoutMs || REQUEST_TIMEOUT));
  let cached: Promise<Snapshot> | undefined;
  let checking: Promise<UpdateState> | undefined;

  function current(): Promise<Snapshot> {
    if (!cached) cached = dependencies.storage.get(STORAGE_KEY).then(async stored => {
      if (stored[STORAGE_KEY] === undefined) return emptySnapshot();
      try { return await validateSnapshot(stored[STORAGE_KEY], isRegexSupported); }
      catch (error) {
        const empty = emptySnapshot();
        empty.state.status = 'error'; empty.state.error = errorText(error); empty.state.failures = 1;
        return empty;
      }
    });
    return cached;
  }

  async function commit(snapshot: Snapshot): Promise<void> {
    await dependencies.storage.set({ [STORAGE_KEY]: snapshot });
    cached = Promise.resolve(snapshot);
  }

  async function check(force: boolean, apply: (rules: string[]) => Promise<void>): Promise<UpdateState> {
    const previous = await current();
    const checkedAt = now();
    if (!force && previous.state.nextCheck > checkedAt) return structuredClone(previous.state);
    let applyAttempted = false;
    try {
      const headers: Record<string, string> = { Accept: 'text/plain' };
      if (previous.state.lastUpdated !== null) {
        if (previous.etag) headers['If-None-Match'] = previous.etag;
        if (previous.lastModified) headers['If-Modified-Since'] = previous.lastModified;
      }
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeout);
      let response: Response;
      let text = '';
      try {
        response = await dependencies.fetch(UPDATE_SOURCE_URL, {
          headers, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-cache',
          redirect: 'error', signal: abort.signal,
        });
        if (response.redirected || (response.url && response.url !== UPDATE_SOURCE_URL)) throw new Error('Nguồn cập nhật đã chuyển hướng ngoài địa chỉ được cho phép.');
        if (response.status === 200) text = await readResponse(response);
        else if (response.status !== 304) throw new Error(`Không thể tải bản cập nhật (HTTP ${response.status}).`);
      } finally { clearTimeout(timer); }
      if (response.status === 304 && previous.state.lastUpdated === null) throw new Error('Máy chủ báo chưa thay đổi nhưng chưa có bản sao đã xác minh.');
      const next = structuredClone(previous);
      next.state.lastChecked = checkedAt; next.state.error = null; next.state.failures = 0;
      next.state.status = 'unchanged';
      if (response.status === 200) {
        const parsed = await parseSource(text, isRegexSupported);
        const sha256 = await digest(text);
        next.text = text; next.interval = parsed.interval;
        next.etag = safeHeader(response.headers.get('etag'), 512) ? response.headers.get('etag')! : '';
        next.lastModified = safeHeader(response.headers.get('last-modified'), 256) ? response.headers.get('last-modified')! : '';
        if (previous.state.sha256 !== sha256) {
          applyAttempted = true;
          await apply(parsed.lines);
          next.state.lastUpdated = checkedAt; next.state.status = 'updated';
        }
        next.state.sha256 = sha256; next.state.version = parsed.version || `sha256:${sha256.slice(0, 12)}`;
        next.state.ruleCount = parsed.count; next.state.skippedRules = parsed.skipped;
        next.state.warning = parsed.skipped ? `Đã loại ${parsed.skipped} quy tắc không được native/MV3 hỗ trợ, HTML, thay nội dung phản hồi hoặc scriptlet từ xa; chỉ áp dụng tập con mạng và CSS an toàn của nguồn. Không bỏ modifier để mở rộng quy tắc. Scriptlet được cập nhật cùng bản build.` : null;
      }
      next.state.nextCheck = checkedAt + next.interval;
      await commit(next);
      return structuredClone(next.state);
    } catch (error) {
      let failure = errorText(error);
      if (applyAttempted) {
        try { await apply(previous.text ? (await parseSource(previous.text, isRegexSupported)).lines : []); }
        catch (rollbackError) { failure = `${failure} Khôi phục bộ lọc thất bại: ${errorText(rollbackError)}. Hãy tải lại extension.`.slice(0, 1000); }
      }
      const failed = structuredClone(previous);
      failed.state.lastChecked = checkedAt; failed.state.status = 'error'; failed.state.error = failure;
      failed.state.failures = Math.min(previous.state.failures + 1, 100);
      failed.state.nextCheck = checkedAt + Math.min(12 * HOUR, 15 * 60_000 * 2 ** Math.min(failed.state.failures - 1, 6));
      try { await commit(failed); }
      catch { cached = Promise.resolve(failed); }
      return structuredClone(failed.state);
    }
  }

  return {
    async loadUpdateState() { return structuredClone((await current()).state); },
    async getActiveUpdateRules() { const snapshot = await current(); return snapshot.text ? (await parseSource(snapshot.text, isRegexSupported)).lines : []; },
    checkFilterUpdates(force, apply) {
      if (!checking) checking = check(force, apply).finally(() => { checking = undefined; });
      return checking;
    },
  };
}

let defaultUpdater: FilterUpdater | undefined;
function updater(): FilterUpdater {
  return defaultUpdater ||= createFilterUpdater({
    storage: { get: key => chrome.storage.local.get(key), set: items => chrome.storage.local.set(items) },
    fetch: (input, init) => fetch(input, init),
  });
}

export function loadUpdateState(): Promise<UpdateState> { return updater().loadUpdateState(); }
export function getActiveUpdateRules(): Promise<string[]> { return updater().getActiveUpdateRules(); }
export function checkFilterUpdates(force: boolean, apply: (rules: string[]) => Promise<void>): Promise<UpdateState> {
  return updater().checkFilterUpdates(force, apply);
}

/** Alarm existence is checked after every worker restart; it is not a keepalive. */
export async function ensureUpdateAlarm(): Promise<void> {
  if (!await chrome.alarms.get(ALARM_NAME)) await chrome.alarms.create(ALARM_NAME, { when: Date.now() + 60_000, periodInMinutes: 60 });
}
