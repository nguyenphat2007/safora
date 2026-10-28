import type { HashWithSource, IRulesHashMap } from '@adguard/dnr-converter';

type Source = HashWithSource['source'];

// The native deserializer hands these fresh, unshared rows directly to its constructor.
// Ordinary constructor inputs retain their original object aliases and Map behavior.
const deserializedRows = new WeakSet<HashWithSource[]>();

/** A storage adapter for the pinned converter's static $badfilter metadata. */
export class RulesHashMap implements IRulesHashMap {
  private fallback: Map<number, Source[]> | undefined;
  private rows = new Float64Array(0);
  private insertionOrder = new Uint32Array(0);
  private materialized = new Map<number, Source[]>();

  constructor(listOfRulesWithHash: HashWithSource[]) {
    const metadata = deserializedRows.delete(listOfRulesWithHash);
    if (!metadata || listOfRulesWithHash.length > 0xffffffff || listOfRulesWithHash.some(({ hash, source }) =>
      !Number.isFinite(hash) || !Number.isFinite(source.filterId) || !Number.isFinite(source.sourceRuleIndex))) {
      this.fallback = new Map();
      for (const { hash, source } of listOfRulesWithHash) {
        const sources = this.fallback.get(hash);
        if (sources) sources.push(source);
        else this.fallback.set(hash, [source]);
      }
      return;
    }

    const sorted = Uint32Array.from({ length: listOfRulesWithHash.length }, (_, index) => index);
    sorted.sort((left, right) => listOfRulesWithHash[left].hash - listOfRulesWithHash[right].hash || left - right);
    this.rows = new Float64Array(sorted.length * 3);
    const starts: number[] = [];
    for (let position = 0; position < sorted.length; position += 1) {
      const { hash, source } = listOfRulesWithHash[sorted[position]];
      const offset = position * 3;
      this.rows[offset] = hash;
      this.rows[offset + 1] = source.filterId;
      this.rows[offset + 2] = source.sourceRuleIndex;
      if (position === 0 || this.rows[offset - 3] !== hash) starts.push(position);
    }
    starts.sort((left, right) => sorted[left] - sorted[right]);
    this.insertionOrder = Uint32Array.from(starts);
  }

  static deserializeSources(rawString: string): HashWithSource[] {
    const plainArray = JSON.parse(rawString) as [number, [number, number][]][];
    const sources = plainArray.flatMap(([hash, rows]) => rows.map(([filterId, sourceRuleIndex]) => ({
      hash, source: { filterId, sourceRuleIndex },
    })));
    deserializedRows.add(sources);
    return sources;
  }

  findRules(hash: number): Source[] {
    if (this.fallback) return this.fallback.get(hash) || [];
    const existing = this.materialized.get(hash);
    if (existing) return existing;
    if (!Number.isFinite(hash)) return [];
    let low = 0;
    let high = this.rows.length / 3;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.rows[middle * 3] < hash) low = middle + 1;
      else high = middle;
    }
    if (low * 3 >= this.rows.length || this.rows[low * 3] !== hash) return [];
    const sources: Source[] = [];
    for (let offset = low * 3; offset < this.rows.length && this.rows[offset] === hash; offset += 3) {
      sources.push({ filterId: this.rows[offset + 1], sourceRuleIndex: this.rows[offset + 2] });
    }
    this.materialized.set(hash, sources);
    return sources;
  }

  serialize(): string {
    if (this.fallback) {
      return JSON.stringify(Array.from(this.fallback, ([hash, sources]) =>
        [hash, sources.map(({ filterId, sourceRuleIndex }) => [filterId, sourceRuleIndex])]));
    }
    const groups: string[] = [];
    for (const start of this.insertionOrder) {
      const hash = this.rows[start * 3];
      const existing = this.materialized.get(hash);
      const sources = existing
        ? existing.map(({ filterId, sourceRuleIndex }) => [filterId, sourceRuleIndex])
        : this.sourcePairs(start, hash);
      groups.push(JSON.stringify([hash, sources]));
    }
    return `[${groups.join(',')}]`;
  }

  private sourcePairs(start: number, hash: number): number[][] {
    const sources: number[][] = [];
    for (let offset = start * 3; offset < this.rows.length && this.rows[offset] === hash; offset += 3) {
      sources.push([this.rows[offset + 1], this.rows[offset + 2]]);
    }
    return sources;
  }
}
