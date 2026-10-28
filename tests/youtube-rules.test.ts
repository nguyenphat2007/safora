import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';
import { CosmeticOption, Engine, FilterList, Request, RequestType } from '@adguard/tsurlfilter';
import { scriptlets } from '@adguard/scriptlets';
import { YOUTUBE_COMPATIBILITY_RULES } from '../src/shared/youtube-rules.ts';

const originalRule = "youtube.com#%#//scriptlet('json-prune', 'entries.[-].command.reelWatchEndpoint.adClientParams.isAd')";
const content = YOUTUBE_COMPATIBILITY_RULES.join('\n');
const fixtureFilterId = 999_001;

function scripts(filterContent: string, host = 'www.youtube.com') {
  const engine = Engine.createSync({ filters: [
    { id: 2, content: originalRule },
    { id: fixtureFilterId, content: new FilterList(filterContent, fixtureFilterId) },
  ] });
  const url = `https://${host}/watch`;
  return engine.getCosmeticResult(new Request(url, url, RequestType.Document), CosmeticOption.CosmeticOptionAll).getScriptRules();
}

test('the compatibility exception matches the exact packaged upstream Shorts rule after official normalization', () => {
  const path = new URL('../node_modules/@adguard/dnr-rulesets/dist/filters/chromium-mv3/declarative/ruleset_2/ruleset_2.json', import.meta.url);
  const rules = JSON.parse(readFileSync(path, 'utf8'));
  const metadata = rules[0].metadata.filterContent !== undefined ? rules[0].metadata
    : JSON.parse(rules.filter((rule: { metadata?: { chunk?: string } }) => rule.metadata?.chunk)
      .map((rule: { metadata: { chunk: string } }) => rule.metadata.chunk).join(''));
  assert(metadata.filterContent.split(/\r?\n/).includes(originalRule));
  const list = new FilterList(content, fixtureFilterId);
  assert.deepEqual(list.getConversionErrors(), []);
  assert.deepEqual(scripts(YOUTUBE_COMPATIBILITY_RULES[0]), []);
  const effective = scripts(content);
  assert.equal(effective.length, 1);
  assert.equal(effective[0].getFilterListId(), fixtureFilterId);
  assert.equal(effective[0].getScriptletData()!.params.name, 'json-prune');
});

test('replacement retains original YouTube host scope and does not install on unrelated hosts', () => {
  for (const host of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'tv.youtube.com']) {
    assert.equal(scripts(content, host).length, 1, host);
  }
  for (const host of ['example.test', 'youtube.com.example.test']) assert.equal(scripts(content, host).length, 0);
});

function executeNativePruner(paths: string, value: unknown): unknown {
  const context = createContext({ input: JSON.stringify(value), console });
  runInContext('window = globalThis; location = {hostname:"www.youtube.com"}; Response = class { json() { return Promise.resolve({}); } };', context);
  const code = scriptlets.invoke({ name: 'json-prune', args: [paths], engine: 'extension', version: '1.3.0', verbose: false });
  runInContext(code, context);
  return JSON.parse(runInContext('JSON.stringify(JSON.parse(input))', context));
}

test('the actual bundled json-prune implementation supports strict typed true/1 and preserves ordinary Shorts', () => {
  const replacement = scripts(content)[0].getScriptletData()!.params.args[0];
  const entry = (flag: unknown, id: string) => ({ id, command: { reelWatchEndpoint: { adClientParams: { isAd: flag }, videoId: id } } });
  const keep = [entry(false, 'false'), entry(0, 'zero'), entry('true', 'string-true'), entry('1', 'string-one'),
    { id: 'missing', command: { reelWatchEndpoint: { videoId: 'ordinary' } } }, { id: 'flat', isAd: true }];
  const entries = [entry(true, 'ad-true'), ...keep, entry(1, 'ad-one')];
  const value = { entries, reelWatchSequenceResponse: { entries, continuation: { token: 'ordinary-next' } },
    streamingData: { formats: [{ url: 'ordinary-video' }] }, playabilityStatus: { status: 'OK' }, playerConfig: { ssapConfig: { enabled: true } } };
  assert.deepEqual(executeNativePruner(replacement, value), { ...value, entries: keep,
    reelWatchSequenceResponse: { ...value.reelWatchSequenceResponse, entries: keep } });
  const oldPaths = 'entries.[-].command.reelWatchEndpoint.adClientParams.isAd';
  const previous = executeNativePruner(oldPaths, { entries }) as { entries: unknown[] };
  assert.deepEqual(previous.entries, keep.slice(-2), 'The old presence-only rule reproduces the confirmed over-pruning');
});
