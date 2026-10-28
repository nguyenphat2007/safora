import type { FilterGroup } from './types';

export const VIETNAM_SUPPLEMENT_FILTER_ID = 90001;
export const WEB_SUPPLEMENT_FILTER_ID = 90002;
export const UBOL_BADWARE_FILTER_ID = 90003;
export const UBOL_URLHAUS_FILTER_ID = 90004;
export const UBOL_FILTER_IDS: readonly number[] = [UBOL_BADWARE_FILTER_ID, UBOL_URLHAUS_FILTER_ID];

export const FILTER_SOURCES = [
  { id: 2, group: 'ads', name: 'AdGuard Base' },
  { id: WEB_SUPPLEMENT_FILTER_ID, group: 'ads', name: 'Safora Web' },
  { id: 3, group: 'privacy', name: 'AdGuard Tracking Protection' },
  { id: 17, group: 'privacy', name: 'AdGuard URL Tracking' },
  { id: UBOL_BADWARE_FILTER_ID, group: 'security', name: 'uBlock filters – Badware risks (mạng)' },
  { id: UBOL_URLHAUS_FILTER_ID, group: 'security', name: 'Malicious URL Blocklist' },
  { id: 4, group: 'annoyances', name: 'AdGuard Social Media' },
  { id: 18, group: 'annoyances', name: 'AdGuard Cookie Notices' },
  { id: 19, group: 'annoyances', name: 'AdGuard Popups' },
  { id: 20, group: 'annoyances', name: 'AdGuard Mobile App Banners' },
  { id: 21, group: 'annoyances', name: 'AdGuard Other Annoyances' },
  { id: 22, group: 'annoyances', name: 'AdGuard Widgets' },
  { id: 214, group: 'vietnam', name: 'ABPVN List' },
  { id: VIETNAM_SUPPLEMENT_FILTER_ID, group: 'vietnam', name: 'Safora Việt Nam' },
] as const satisfies ReadonlyArray<{ id: number; group: FilterGroup; name: string }>;

export const GROUP_FILTER_IDS: Record<FilterGroup, readonly number[]> = {
  ads: [2, WEB_SUPPLEMENT_FILTER_ID],
  privacy: [3, 17],
  security: [UBOL_BADWARE_FILTER_ID, UBOL_URLHAUS_FILTER_ID],
  annoyances: [4, 18, 19, 20, 21, 22],
  vietnam: [214, VIETNAM_SUPPLEMENT_FILTER_ID],
};

export const STATIC_FILTER_IDS: readonly number[] = FILTER_SOURCES.map(source => source.id);
export const UPSTREAM_FILTER_IDS: readonly number[] = STATIC_FILTER_IDS.filter(id => id !== VIETNAM_SUPPLEMENT_FILTER_ID && id !== WEB_SUPPLEMENT_FILTER_ID && !UBOL_FILTER_IDS.includes(id));

export function selectedFilterIds(groups: Record<FilterGroup, boolean>): number[] {
  return FILTER_SOURCES.filter(source => groups[source.group]).map(source => source.id);
}

export function filterGroupForId(id: number): FilterGroup | undefined {
  return FILTER_SOURCES.find(source => source.id === id)?.group;
}
