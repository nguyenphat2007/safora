import { FILTER_SOURCES } from './filter-sources.ts';

export const HISTORY_KEY = 'blockingHistoryV1';
export const HISTORY_DAYS = 30;
export const STAT_CATEGORIES = ['ads', 'privacy', 'security', 'annoyances', 'vietnam', 'custom'] as const;
export type StatCategory = (typeof STAT_CATEGORIES)[number];
export type StatSelection = StatCategory | 'all';
export type StatCounts = Record<StatCategory, number>;
export interface HistoryDay { date: string; counts: StatCounts }
export interface BlockingHistory { version: 1; startedAt: number; days: HistoryDay[] }
export interface ChartDay { date: string; value: number | null }
export const STAT_LABELS: Record<StatCategory, string> = {
  ads: 'Quảng cáo', privacy: 'Theo dõi', security: 'URL độc hại', annoyances: 'Phiền nhiễu', vietnam: 'Bộ lọc Việt Nam', custom: 'Quy tắc bổ sung',
};
const emptyCounts = (): StatCounts => ({ ads: 0, privacy: 0, security: 0, annoyances: 0, vietnam: 0, custom: 0 });
function formatLocalDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function localDay(time: number): string { return formatLocalDay(new Date(time)); }
function dayOffset(now: number, offset: number): string {
  const date = new Date(now);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return formatLocalDay(date);
}
function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  return localDay(new Date(year, month - 1, day, 12).getTime()) === value;
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function normalizeHistory(raw: unknown, now = Date.now()): BlockingHistory {
  const empty: BlockingHistory = { version: 1, startedAt: now, days: [] };
  if (!object(raw) || raw.version !== 1 || typeof raw.startedAt !== 'number' || !Number.isFinite(raw.startedAt) || raw.startedAt < 0 || raw.startedAt > now || !Array.isArray(raw.days) || raw.days.length > HISTORY_DAYS) return empty;
  const first = dayOffset(now, 1 - HISTORY_DAYS), today = localDay(now), started = localDay(raw.startedAt);
  const dates = new Set<string>();
  const days: HistoryDay[] = [];
  for (const entry of raw.days) {
    if (!object(entry) || !validDay(entry.date) || entry.date < first || entry.date > today || entry.date < started || dates.has(entry.date) || !object(entry.counts)) continue;
    const counts = emptyCounts();
    // Versions before 1.14 have no security bucket. Keep their history intact.
    const rawCounts: Record<string, unknown> = { security: 0, ...entry.counts };
    if (STAT_CATEGORIES.some(key => !Number.isSafeInteger(rawCounts[key]) || (rawCounts[key] as number) < 0)) continue;
    for (const key of STAT_CATEGORIES) counts[key] = rawCounts[key] as number;
    dates.add(entry.date); days.push({ date: entry.date, counts });
  }
  return { version: 1, startedAt: raw.startedAt, days: days.sort((a, b) => a.date.localeCompare(b.date)) };
}
export function categoryForRuleset(id: string): StatCategory {
  return categoriesByRuleset.get(id) || 'custom';
}
const categoriesByRuleset = new Map<string, StatCategory>(FILTER_SOURCES.map(source => [`ruleset_${source.id}`, source.group]));
/** Called only after the engine confirms an actual network block. No URL is retained. */
export function recordBlock(history: BlockingHistory, category: StatCategory, time: number, now = Date.now()): void {
  if (!Number.isFinite(time) || time < 0 || time > now) time = now;
  const date = localDay(time), first = dayOffset(now, 1 - HISTORY_DAYS);
  if (date < first) return;
  while (history.days.length && history.days[0].date < first) history.days.shift();
  let day = history.days.at(-1);
  if (day?.date !== date) {
    const today = localDay(now);
    history.days = history.days.filter(entry => entry.date >= first && entry.date <= today);
    day = history.days.find(entry => entry.date === date);
    if (!day) { day = { date, counts: emptyCounts() }; history.days.push(day); history.days.sort((a, b) => a.date.localeCompare(b.date)); }
  }
  day.counts[category] = Math.min(Number.MAX_SAFE_INTEGER, day.counts[category] + 1);
  history.startedAt = Math.min(history.startedAt, time);
}
export function statisticsView(history: BlockingHistory, range: 7 | 30, selection: StatSelection, now = Date.now()): { points: ChartDay[]; counts: StatCounts; total: number } {
  const counts = emptyCounts(), points: ChartDay[] = [], started = localDay(history.startedAt);
  const days = new Map(history.days.map(day => [day.date, day.counts]));
  for (let offset = 1 - range; offset <= 0; offset++) {
    const date = dayOffset(now, offset), day = days.get(date);
    if (date < started) { points.push({ date, value: null }); continue; }
    let value = 0;
    for (const key of STAT_CATEGORIES) {
      const count = day?.[key] || 0;
      counts[key] = Math.min(Number.MAX_SAFE_INTEGER, counts[key] + count);
      if (selection === 'all' || selection === key) value = Math.min(Number.MAX_SAFE_INTEGER, value + count);
    }
    points.push({ date, value });
  }
  const total = points.reduce((sum, point) => Math.min(Number.MAX_SAFE_INTEGER, sum + (point.value || 0)), 0);
  return { points, counts, total };
}
