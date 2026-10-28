import type { UpdateState } from '../filter-updates';
import type { RuleSourceDetail } from './rule-source-log';
export const GROUPS = ['ads', 'privacy', 'security', 'annoyances', 'vietnam'] as const;
export type FilterGroup = (typeof GROUPS)[number];
export type Theme = 'system' | 'light' | 'dark';
export interface Settings {
  enabled: boolean;
  groups: Record<FilterGroup, boolean>;
  allowlist: string[];
  userRules: string;
  theme: Theme;
  logging: boolean;
  scriptlets: boolean;
}
export type SettingsPatch = Partial<Omit<Settings, 'groups'>> & { groups?: Partial<Settings['groups']> };
export interface RuleDiagnostic { line: number; message: string }
export interface LogEntry { id: string; time: number; kind: 'network' | 'cosmetic' | 'scriptlet'; tabId: number; host: string; target: string; rule: string; group: string; sourceDetail?: RuleSourceDetail }
export interface TabStats { network: number; cosmetic: number; host: string }
export interface AppState {
  settings: Settings; tabId: number | null; url: string; host: string; supported: boolean; protected: boolean;
  tab: TabStats; total: number; logs: LogEntry[]; countMode: 'debug' | 'native' | 'unavailable'; version: string;
    engine?: {name:string;version:string;packagedNetworkRules:number;activeNetworkRules:number;filters:{id:number;name:string;group:string;networkRules:number;version?:unknown;updated?:unknown}[];warnings:string[]};
  updates?: UpdateState;
}
export interface ContentConfig { enabled: boolean }
export type PopupState = Pick<AppState, 'tabId' | 'url' | 'host' | 'supported' | 'protected' | 'tab' | 'total' | 'countMode'> & {
  settings: Pick<Settings, 'enabled' | 'theme'>;
};
export type RequestMessage =
  | { type: 'state'; tabId?: number; includeLogs?: boolean; scope?: 'popup' }
  | { type: 'statistics' }
  | { type: 'settings'; patch: SettingsPatch }
  | { type: 'toggleSite'; tabId: number; enabled: boolean }
  | { type: 'startPicker'; tabId: number }
  | { type: 'contentConfig' }
  | { type: 'addUserRule'; rule: string }
  | { type: 'updateFilters' }
  | { type: 'clearLog' }
  | { type: 'openOptions'; section?: string }
;
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string; diagnostics?: RuleDiagnostic[] };
