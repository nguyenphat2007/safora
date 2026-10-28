export function assertStaticBudget(
  filters: readonly { id: number; browserRules: number }[],
  enabled: readonly string[],
  desired: readonly number[],
  available: number,
  maxRulesets: number,
): void {
  const next = new Set(desired.map(id => `ruleset_${id}`));
  if (next.size > maxRulesets) throw new Error('Số bộ lọc vượt giới hạn của trình duyệt.');
  const current = new Set(enabled);
  const sizes = new Map(filters.map(filter => [`ruleset_${filter.id}`, filter.browserRules]));
  let difference = 0;
  for (const id of new Set([...next, ...current])) {
    if (next.has(id) === current.has(id)) continue;
    const size = sizes.get(id);
    if (!Number.isSafeInteger(size) || size! < 0) throw new Error('Không xác minh được kích thước bộ lọc ' + id);
    difference += next.has(id) ? size! : -size!;
  }
  if (!Number.isSafeInteger(available) || available < 0) throw new Error('Không đọc được hạn mức quy tắc của trình duyệt.');
  if (difference > available) throw new Error(`Trình duyệt chỉ còn chỗ cho ${available} quy tắc; cần thêm ${difference}. Cấu hình trước được giữ lại.`);
}
