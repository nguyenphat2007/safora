import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createContext, runInContext } from 'node:vm';
import { z } from 'zod';
import { assertStaticBudget } from '../src/shared/static-budget.ts';
import { createRuleSourceLog } from '../src/shared/rule-source-log.ts';
import { prepareUserRules } from '../src/shared/adguard-rules.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const upstreamPath = fileURLToPath(import.meta.resolve('@adguard/tswebextension/mv3'));
const upstream = readFileSync(upstreamPath, 'utf8');
const upstreamSha256 = createHash('sha256').update(upstream).digest('hex');
assert.equal(upstreamSha256, '3722e1c4db81f14e28f7300a063ba48e26e7751506a266bcb036546bedceb698', 'Review the MessagesApi factory and complete class when the pinned upstream changes');
const classStart = upstream.indexOf('class MessagesApi {');
const classEnd = upstream.indexOf('\n}\n\n/**', classStart);
assert(classStart > 0 && classEnd > classStart, 'Cannot locate reviewed MessagesApi class');
const messageClass = upstream.slice(classStart, classEnd + 2);
const factory = upstream.match(/    getMessageHandler\(\) \{\n([\s\S]*?)\n    \}/)?.[1];
assert(factory?.includes('new MessagesApi(this, tabsApi, defaultFilteringLog)'), 'Factory no longer creates the reviewed MessagesApi');
const validators = readFileSync(join(dirname(upstreamPath), 'common/stealth-actions.js'), 'utf8');
const schemaNames = ['messageValidator', 'getCosmeticDataPayloadValidator', 'getCookieRulesPayloadValidator', 'getSaveCookieLogEventPayloadValidator', 'getAssistantCreateRulePayloadValidator'];
const schemas = schemaNames.map(name => {
  const declaration = validators.match(new RegExp(`const ${name} = z\\.object\\(\\{[\\s\\S]*?\\}\\)\\.strict\\(\\);`))?.[0];
  assert(declaration, `Missing actual upstream validator ${name}`); return declaration;
}).join('\n');
const constants = readFileSync(join(dirname(upstreamPath), 'common/message-constants.js'), 'utf8').replace(/^export \{[^\n]+\};?$/gm, '');
const originalCall = 'return engine.getMessageHandler()(message as Message,sender);';
const cachedCall = 'return (engineMessageHandler ??= engine.getMessageHandler())(message as Message,sender);';

/** Execute the actual Safora entry point and complete pinned upstream MessagesApi.
 * Browser/filtering services are observable stand-ins; no DOM/DNR/Chrome costs
 * are measured. Actual upstream validators and dispatch methods remain intact.
 */
export function createEngineMessageHarness(mode = 'source') {
  const counters = { factoryCalls: 0, cosmeticCalls: 0 };
  const events = [], assistantRules = [];
  const live = { generation: 0, enabled: true, userRules: '' };
  const appContext = { isStorageInitialized: false };
  const cookieRule = () => ({
    getIndex: () => live.generation, getAdvancedModifierValue: () => 'fixture-cookie', getFilterListId: () => 214,
    isOptionEnabled: () => false, isAllowlist: () => false, isDocumentLevelAllowlistRule: () => false,
  });
  const scope = createContext({
    z, URL, structuredClone, counters, live, appContext,
    logger: { trace() {}, debug() {}, error() {} }, MAIN_FRAME_ID: 0,
    tabsApi: { getTabContext: tabId => ({ info: { url: `https://tab${tabId}.example.test/` } }) },
    defaultFilteringLog: { publishEvent: event => events.push(structuredClone(event)) },
    CosmeticApi: { getContentScriptData: (documentUrl, tabId, frameId) => {
      counters.cosmeticCalls++;
      if (documentUrl.endsWith('/failure')) throw new Error('Controlled filtering dependency failure');
      return Promise.resolve(live.enabled ? { documentUrl, tabId, frameId, policy: { ...live } } : null);
    } },
    CookieFiltering: { getBlockingRules: () => [cookieRule()] },
    NetworkRuleOption: { ThirdParty: 1, Important: 2, Csp: 4, Cookie: 8 },
    isEmptySrcFrame: url => url === 'about:blank',
    Assistant: { onCreateRule: { dispatch: rule => assistantRules.push(rule) } },
    getRuleTextsByIndex: (filterId, index) => ({ appliedRuleText: `${filterId}:${index}`, originalRuleText: `source-${index}` }),
    engineApi: {}, FilteringEventType: { ApplyCosmeticRule: 'applyCosmeticRule', Cookie: 'cookie' },
    ContentType: { Document: 'document', Cookie: 'cookie' }, nanoid: () => 'deterministic-fixture-id', getDomain$1: url => new URL(url).hostname,
    createFilterMetadataLoader: () => ({ loadSnapshot: async () => ({ filters: [2, 3, 214, 90003, 90004].map(id => ({ id, browserRules: 1 })) }), loadBlockIndex() {} }),
    assertStaticBudget, createRuleSourceLog, prepareUserRules,
    chrome: { declarativeNetRequest: { getEnabledRulesets: async () => [], getAvailableStaticRuleCount: async () => 30000, MAX_NUMBER_OF_ENABLED_STATIC_RULESETS: 50 } },
    localScriptRules: [], GROUP_FILTER_IDS: { ads: [2], privacy: [3], security: [90003, 90004], vietnam: [214], annoyances: [] },
    YOUTUBE_COMPATIBILITY_RULES: [], normalizeLegacyRules: text => text, reconcileYouTubeStartup: async () => {},
    FilterList: class {
      constructor(content) { this.content = content; }
      getContent() { return this.content; } getConversionErrors() { return []; } getConversionData() { return {}; }
    },
  });
  runInContext(`${constants}\n${schemas}\n${messageClass}\nglobalThis.reviewedFactory = function() {${factory}};`, scope);
  scope.TsWebExtension = class {
    isStarted = false;
    static setLocalScriptRules() {}
    async initStorage() { appContext.isStorageInitialized = true; }
    async start(config) { this.isStarted = true; return this.configure(config); }
    async configure(config) {
      live.generation++; live.enabled = config.settings.filteringEnabled; live.userRules = config.userrules.content;
      return { staticFiltersStatus: { errors: [] }, staticFilters: [], dynamicRules: { errors: [], limitations: [], ruleset: { getId: () => '_dynamic', getRulesById: async () => [] } } };
    }
    getMessageHandler() { counters.factoryCalls++; return Reflect.apply(scope.reviewedFactory, this, []); }
  };
  let source = readFileSync(join(root, 'src/engine.ts'), 'utf8');
  assert(source.includes(originalCall) || source.includes(cachedCall), 'Review changed Safora message forwarding callsite');
  if (mode === 'per-call') source = source.replace(cachedCall, originalCall);
  else if (mode === 'reused') {
    if (!source.includes('let engineMessageHandler')) source = `let engineMessageHandler;\n${source}`;
    source = source.replace(originalCall, cachedCall);
  } else assert.equal(mode, 'source');
  const executable = stripTypeScriptTypes(source.replace(/^import[^\n]*\n/gm, '')
    .replace(/^export \{[^\n]+\};?$/gm, '').replace(/\bexport (?=(?:const|let|async|function)\b)/g, ''));
  runInContext(executable, scope);
  return {
    counters, events, assistantRules, live,
    types: runInContext('({...MessageType})', scope),
    message: (type, payload) => ({ handlerName: 'tsWebExtension', type, payload }),
    dispatch: runInContext('handleEngineMessage', scope), configure: runInContext('configureEngine', scope),
    settings: enabled => ({ enabled, groups: { ads: true, privacy: true, security: true, annoyances: false, vietnam: true }, allowlist: [], userRules: `site.example.test##.fixture-${live.generation}`, scriptlets: true, logging: false, theme: 'system' }),
  };
}

async function benchmark() {
  const iterations = Number(process.argv[2] || 25000), trials = Number(process.argv[3] || 5);
  assert(Number.isSafeInteger(iterations) && iterations > 0 && iterations <= 1000000);
  assert(Number.isSafeInteger(trials) && trials > 0 && trials <= 9);
  const samples = [];
  for (let trial = 1; trial <= trials; trial++) for (const mode of trial % 2 ? ['per-call', 'reused'] : ['reused', 'per-call']) {
    const harness = createEngineMessageHarness(mode); await harness.configure(harness.settings(true), []);
    const message = harness.message(harness.types.GetCosmeticData, { documentUrl: 'https://ordinary.example.test/' });
    const sender = { tab: { id: 7 }, frameId: 1 };
    for (let index = 0; index < 1000; index++) await harness.dispatch(message, sender);
    const factoryBefore = harness.counters.factoryCalls;
    global.gc?.(); const cpu = process.cpuUsage(), started = performance.now();
    for (let index = 0; index < iterations; index++) await harness.dispatch(message, sender);
    const elapsedMs = performance.now() - started, used = process.cpuUsage(cpu);
    samples.push({ trial, mode, iterations, elapsedMs, cpuMs: (used.user + used.system) / 1000, handlerAllocationsDuringMeasurement: harness.counters.factoryCalls - factoryBefore });
  }
  const output = resolve(process.argv[4] || join(root, 'test-results/engine-message-benchmark.json'));
  const report = {
    generatedAt: new Date().toISOString(), node: process.version, upstreamSha256, samples,
    scope: 'Actual pinned MessagesApi factory, constructor, validators, dispatch and Safora forwarding callsite in Node VM; downstream browser/filter services substituted. One object and bound function per factory invocation. In-process alternating trials, warm-up excluded. No browser CPU/RAM, cold start, filtering throughput or historical GPU attribution claim.',
  };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  for (const mode of ['per-call', 'reused']) {
    const selected = samples.filter(sample => sample.mode === mode), median = key => selected.map(sample => sample[key]).sort((a, b) => a - b)[Math.floor(selected.length / 2)];
    console.log(JSON.stringify({ mode, medianElapsedMs: median('elapsedMs'), medianCpuMs: median('cpuMs'), handlerAllocationsDuringMeasurement: selected[0].handlerAllocationsDuringMeasurement }));
  }
  console.log(output);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await benchmark();
