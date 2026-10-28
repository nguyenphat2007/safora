import type { BlockRuleIndex } from './block-index';

export interface FilterSnapshot {
  builtAt: string;
  blockIndex: { path: string; bytes: number; sha256: string };
  filters: { id: number; name: string; group: string; networkRules: number; browserRules: number; blockRuleIndex: BlockRuleIndex; [key: string]: unknown }[];
  [key: string]: unknown;
}

/** Metadata is useful to the UI; the binary index is needed only for debug counting. */
export function createFilterMetadataLoader(read: (path: string) => Promise<Response>) {
  let snapshot: Promise<FilterSnapshot> | undefined;
  let index: Promise<{ data: DataView; ranges: Map<string, BlockRuleIndex> }> | undefined;
  function loadSnapshot(): Promise<FilterSnapshot> {
    snapshot ??= (async () => {
      const response = await read('filter-snapshot.json');
      if (!response.ok) throw new Error('Không đọc được metadata bộ lọc.');
      const next = await response.json() as FilterSnapshot;
      const bytes = next.blockIndex?.bytes;
      if (next.blockIndex?.path !== 'filters/block-index.bin' || !Number.isSafeInteger(bytes) || bytes < 0 || bytes % 4 !== 0) throw new Error('Chỉ mục quy tắc chặn không hợp lệ.');
      for (const filter of next.filters) {
        const range = filter.blockRuleIndex;
        if (!range || !Number.isSafeInteger(range.offset) || !Number.isSafeInteger(range.count) || range.offset < 0 || range.offset % 4 !== 0 || range.count < 0 || range.offset > bytes || range.count > (bytes - range.offset) / 4) throw new Error('Phạm vi chỉ mục quy tắc chặn không hợp lệ.');
      }
      return next;
    })().catch(error => { snapshot = undefined; throw error; });
    return snapshot;
  }
  function loadBlockIndex(): Promise<{ data: DataView; ranges: Map<string, BlockRuleIndex> }> {
    index ??= (async () => {
      const metadata = await loadSnapshot();
      const response = await read(metadata.blockIndex.path);
      if (!response.ok) throw new Error('Không đọc được chỉ mục quy tắc chặn.');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== metadata.blockIndex.bytes) throw new Error('Kích thước chỉ mục quy tắc chặn không hợp lệ.');
      return { data: new DataView(bytes), ranges: new Map(metadata.filters.map(filter => [`ruleset_${filter.id}`, filter.blockRuleIndex])) };
    })().catch(error => { index = undefined; throw error; });
    return index;
  }
  return { loadSnapshot, loadBlockIndex };
}
