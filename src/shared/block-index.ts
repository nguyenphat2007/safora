export interface BlockRuleIndex { offset: number; count: number }

/** Look up a static block rule in the compact, little-endian index built with its ruleset. */
export function hasBlockRule(index: DataView, range: BlockRuleIndex, ruleId: number): boolean {
  if (!Number.isInteger(ruleId) || ruleId <= 0 || ruleId > 0xffffffff) return false;
  const { offset, count } = range;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % 4 !== 0 || offset > index.byteLength
    || !Number.isSafeInteger(count) || count < 0 || count > Math.floor((index.byteLength - offset) / 4)) return false;
  let low = 0;
  let high = count - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = index.getUint32(offset + middle * 4, true);
    if (ruleId < candidate) high = middle - 1;
    else if (ruleId > candidate) low = middle + 1;
    else return true;
  }
  return false;
}
