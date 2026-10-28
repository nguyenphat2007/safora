import type { IRulesetWithSourceMap } from '@adguard/dnr-converter';

export interface LoggedRuleSource { filterId: number; rule: string }
export interface RuleSourceDetail { sources: LoggedRuleSource[]; sourceCount: number }
type SourceMap = Pick<IRulesetWithSourceMap, 'getId' | 'getRulesById'>;
const MAX_CACHED_RULES = 128;
const MAX_DISPLAYED_SOURCES = 3;
const MAX_RULE_LENGTH = 500;

/** Resolve the source map only for opt-in diagnostics. One DNR rule may represent several source lines. */
export function createRuleSourceLog(timeoutMs = 2000) {
  let maps = new Map<string, SourceMap>();
  let generation = 0;
  let failedGeneration: number | undefined;
  const cache = new Map<string, RuleSourceDetail>();
  function replace(rulesets: SourceMap[], enabled: boolean): void {
    generation++;
    failedGeneration = undefined;
    cache.clear();
    maps = new Map(enabled ? rulesets.map(ruleset => [ruleset.getId(), ruleset]) : []);
  }
  async function resolve(rulesetId: string, ruleId: number, expectedGeneration = generation): Promise<RuleSourceDetail | undefined> {
    if (generation !== expectedGeneration || failedGeneration === generation) return undefined;
    const ruleset = maps.get(rulesetId);
    if (!ruleset || !Number.isSafeInteger(ruleId) || ruleId <= 0) return undefined;
    const key = `${rulesetId}:${ruleId}`;
    const existing = cache.get(key);
    if (existing) { cache.delete(key); cache.set(key, existing); return existing; }
    const startedGeneration = generation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const sources = await Promise.race([
        ruleset.getRulesById(ruleId),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Source lookup timed out')), timeoutMs); }),
      ]);
      if (generation !== startedGeneration || !sources.length) return undefined;
      const detail = { sourceCount: sources.length, sources: sources.slice(0, MAX_DISPLAYED_SOURCES).map(source => ({
        filterId: source.filterId, rule: source.sourceRule.length > MAX_RULE_LENGTH ? `${source.sourceRule.slice(0, MAX_RULE_LENGTH)}…` : source.sourceRule,
      })) };
      if (cache.size >= MAX_CACHED_RULES) cache.delete(cache.keys().next().value!);
      cache.set(key, detail);
      return detail;
    } catch {
      // A broken IDB/source map must not add a timeout to every queued block.
      // Retry only after a configuration change supplies fresh source maps.
      if (generation === startedGeneration) failedGeneration = generation;
      return undefined;
    }
    finally { if (timer !== undefined) clearTimeout(timer); }
  }
  return { replace, resolve, generation: () => generation };
}
