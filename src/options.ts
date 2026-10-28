import { applyTheme, request } from './shared/api';
import { validateUserRules } from './shared/adguard-rules';
import { GROUPS } from './shared/types';
import type { AppState, LogEntry, SettingsPatch, Theme } from './shared/types';
import type { UpdateState } from './filter-updates';
import { MAX_BACKUP_BYTES, createSettingsBackup, parseSettingsBackup, type SettingsBackup } from './shared/settings-backup';
import { uiDiagnosticText } from './shared/ui-messages';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Không tìm thấy giao diện: ${id}`);
  return node as T;
}

const sections: Record<string, string> = {
  dashboard: 'Tổng quan', filters: 'Bộ lọc', rules: 'Quy tắc cá nhân',
  allowlist: 'Website ngoại lệ', log: 'Nhật ký lọc', privacy: 'Quyền riêng tư', appearance: 'Giao diện',
};
const kindNames: Record<LogEntry['kind'], string> = { network: 'Yêu cầu mạng', cosmetic: 'Ẩn phần tử', scriptlet: 'Scriptlet' };
const groupNames: Record<string, string> = { ads: 'Quảng cáo', privacy: 'Quyền riêng tư', security: 'URL độc hại', annoyances: 'Phiền nhiễu', vietnam: 'Việt Nam', user: 'Quy tắc cá nhân', _dynamic: 'Quy tắc cá nhân & bản sửa lỗi', cosmetic: 'Ẩn phần tử' };
// Display names only; source metadata and filter contents retain their original attribution.
const filterDisplayNames: Record<number, string> = {
  0: 'Quy tắc cá nhân & bản sửa lỗi',
  2: 'Bộ lọc quảng cáo',
  3: 'Bộ lọc chống theo dõi',
  4: 'Tiện ích mạng xã hội',
  17: 'Làm sạch liên kết',
  18: 'Thông báo cookie',
  19: 'Cửa sổ bật lên',
  20: 'Lời mời cài ứng dụng',
  21: 'Nội dung gây phiền nhiễu',
  22: 'Tiện ích nổi',
  214: 'Bộ lọc tiếng Việt',
  90001: 'Bổ sung cho website Việt Nam',
  90002: 'Bộ lọc bổ sung',
  90003: 'Chặn nguồn phần mềm độc hại',
  90004: 'Chặn URL độc hại',
};
function filterDisplayName(id: number): string { return filterDisplayNames[id] ?? `Bộ lọc ${id}`; }
const number = new Intl.NumberFormat('vi-VN');
const timeFormat = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateTimeFormat = new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
const rulesInput = element<HTMLTextAreaElement>('user-rules');
const allowlistInput = element<HTMLTextAreaElement>('allowlist-input');
let state: AppState | null = null;
let section = 'dashboard';
let rulesDirty = false;
let allowlistDirty = false;
let saving = false;
let updating = false;
let updateRequestError = '';
let refreshing = false;
let refreshAgain = false;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let logSignature = '';
let pendingBackup: SettingsBackup | undefined;

function feedback(message: string, error = false, target = 'settings-status'): void {
  const node = element(target);
  node.textContent = uiDiagnosticText(message);
  node.dataset.error = String(error);
  node.hidden = !message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Có lỗi xảy ra. Hãy thử lại.';
}

function dirtyLabel(): void {
  element('rules-dirty').textContent = rulesDirty ? 'Có thay đổi chưa lưu' : 'Đã lưu';
  element('allowlist-dirty').textContent = allowlistDirty ? 'Có thay đổi chưa lưu' : 'Đã lưu';
}

function updateNavigation(): void {
  const hash = window.location.hash.slice(1);
  section = Object.hasOwn(sections, hash) ? hash : 'dashboard';
  if(section==='rules'||section==='log')element<HTMLDetailsElement>('advanced-navigation').open=true;
  for (const node of document.querySelectorAll<HTMLElement>('.settings-section')) node.hidden = node.id !== `section-${section}`;
  for (const node of document.querySelectorAll<HTMLAnchorElement>('nav [data-section]')) {
    if (node.dataset.section === section) node.setAttribute('aria-current', 'page');
    else node.removeAttribute('aria-current');
  }
  element('section-title').textContent = sections[section]!;
  document.title = `${sections[section]} · Safora`;
  if (section === 'log') { if(state)renderLog(state, true); void refresh(); }
  else if (section === 'dashboard') void refresh();
}

function setBusy(value: boolean): void {
  saving = value;
  for (const node of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input[type="checkbox"], input[name="theme"], button[type="submit"], #clear-log')) node.disabled = value;
  backupControls();
}

function backupControls(): void {
  for (const id of ['backup-export', 'backup-import', 'backup-file']) element<HTMLButtonElement | HTMLInputElement>(id).disabled = saving || !state;
  element<HTMLButtonElement>('backup-apply').disabled = saving || !pendingBackup;
  element<HTMLButtonElement>('backup-cancel').disabled = saving;
}

function requireSavedEditors(): void {
  if (rulesDirty || allowlistDirty) throw new Error('Hãy lưu hoặc hoàn tác thay đổi trong Quy tắc cá nhân và Website ngoại lệ trước khi sao lưu hoặc khôi phục.');
}

function clearBackupPreview(): void {
  pendingBackup = undefined;
  element('backup-preview').hidden = true;
  element<HTMLInputElement>('backup-file').value = '';
  backupControls();
}

function render(next: AppState): void {
  state = next;
  applyTheme(next.settings.theme);
  element('app-version').textContent = `Phiên bản ${next.version}`;
  const status = element('global-status');
  status.textContent = next.settings.enabled ? 'Bảo vệ đang bật' : 'Bảo vệ đang tắt';
  status.dataset.enabled = String(next.settings.enabled);
  const canCount = next.countMode === 'debug';
  element('dashboard-count-card').hidden=!canCount;
  element('dashboard-total').textContent = canCount ? number.format(next.total) : '—';
  element('dashboard-filters').textContent = `${GROUPS.filter(group => next.settings.groups[group]).length} / ${GROUPS.length}`;
  element('dashboard-allowed').textContent = number.format(next.settings.allowlist.length);
  element<HTMLInputElement>('enabled-toggle').checked = next.settings.enabled;
  element<HTMLInputElement>('logging-toggle').checked = next.settings.logging;
  element<HTMLInputElement>('scriptlets-toggle').checked = next.settings.scriptlets;
  for (const group of GROUPS) {
    element<HTMLInputElement>(`group-${group}`).checked = next.settings.groups[group];
    const label = document.querySelector<HTMLElement>(`[data-group-state="${group}"]`);
    if (label) { label.textContent = next.settings.groups[group] ? 'Bộ lọc đang bật' : 'Bộ lọc đang tắt'; label.dataset.active = String(next.settings.groups[group]); }
  }
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) radio.checked = radio.value === next.settings.theme;
  if (!rulesDirty) rulesInput.value = next.settings.userRules;
  if (!allowlistDirty) allowlistInput.value = next.settings.allowlist.join('\n');
  const rulesCount = next.settings.userRules.split('\n').filter(line => line.trim() && !line.trim().startsWith('!')).length;
  element('rules-count').textContent = `${number.format(rulesCount)} quy tắc đã lưu`;
  element('allowlist-count').textContent = `${number.format(next.settings.allowlist.length)} tên miền đã lưu`;
  renderProtectionWarnings(next);
  renderUpdates(next.updates);
  renderFilterVersions(next);
  dirtyLabel();
  backupControls();
  element('log-capability-note').textContent = next.settings.logging
    ? canCount ? 'Đang ghi lượt chặn mạng và nguồn quy tắc khi tra cứu được. Một quy tắc mạng có thể được tạo từ nhiều dòng nguồn. Nhật ký chỉ lưu trên thiết bị; tắt ghi sẽ xóa dữ liệu phiên.'
      : 'Đang ghi lượt ẩn phần tử. Trình duyệt hiện không cung cấp nhật ký mạng. Tắt ghi sẽ xóa dữ liệu phiên.'
    : 'Nhật ký và phép đo số phần tử đã ẩn đang tắt để tiết kiệm tài nguyên. Bật khi cần chẩn đoán rồi tải lại trang. Sau khi tắt, tải lại các trang đã đo để dừng phép đo cũ.';
  if (section === 'log') renderLog(next);
}

function appendText(parent: HTMLElement, tag: string, value: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = value;
  if (className) node.className = className;
  parent.append(node);
  return node;
}

function dateLabel(value: number | null | undefined, fallback: string): string {
  return typeof value === 'number' && value > 0 && Number.isFinite(new Date(value).getTime()) ? dateTimeFormat.format(value) : fallback;
}

function renderProtectionWarnings(next: AppState): void {
  const warnings=next.engine?.warnings.join('\n')||'';
  element('engine-warnings').textContent=uiDiagnosticText(warnings);
  element('protection-warning').hidden=!warnings;
  if(!warnings)element<HTMLDetailsElement>('warning-reason').open=false;
}

let filterVersionSignature = '';
function renderFilterVersions(next: AppState): void {
  const signature = JSON.stringify([next.engine?.filters, next.settings.groups, next.settings.enabled]);
  if (signature === filterVersionSignature) return;
  filterVersionSignature = signature;
  const rows = document.createDocumentFragment();
  for (const filter of next.engine?.filters ?? []) {
    const row = document.createElement('li');
    row.dataset.filterId = String(filter.id);
    appendText(row, 'strong', filterDisplayName(filter.id));
    const active = next.settings.enabled && next.settings.groups[filter.group as typeof GROUPS[number]];
    const version = typeof filter.version === 'string' ? filter.version : 'Chưa có thông tin';
    const timestamp = typeof filter.updated === 'string' ? Date.parse(filter.updated) : NaN;
    const date = Number.isFinite(timestamp) ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium' }).format(timestamp) : 'Chưa có thông tin';
    appendText(row, 'span', `${active ? 'Đang bật' : 'Đang tắt'} · Phiên bản ${version} · Ngày dữ liệu: ${date}`);
    rows.append(row);
  }
  element('filter-version-list').replaceChildren(rows);
}

function renderUpdates(update: UpdateState | undefined): void {
  const button = element<HTMLButtonElement>('update-filters');
  button.disabled = updating;
  button.textContent = updating ? 'Đang kiểm tra…' : 'Kiểm tra ngay';
  element('update-last-checked').textContent = dateLabel(update?.lastChecked, 'Chưa kiểm tra');
  element('update-last-updated').textContent = dateLabel(update?.lastUpdated, 'Chưa có bản cập nhật');
  const statuses: Record<UpdateState['status'], string> = {
    never: 'Chưa kiểm tra bản sửa lỗi.',
    updated: 'Đã áp dụng bản sửa lỗi mới.',
    unchanged: 'Bản sửa lỗi hiện có vẫn đang được sử dụng.',
    error: 'Chưa thể kiểm tra cập nhật. Tiếp tục dùng bộ lọc hiện có; bạn có thể thử lại.',
  };
  const failed=!!updateRequestError||update?.status==='error';
  feedback(updating?'Đang kiểm tra bản sửa lỗi…':statuses[failed?'error':update?.status||'never'],!updating&&failed,'update-feedback');
  const details=element<HTMLDetailsElement>('update-error-details');
  details.hidden=updating||!failed;
  element('update-error-message').textContent=uiDiagnosticText(updateRequestError||update?.error||'Không thể kết nối đến nguồn cập nhật.');
  if(details.hidden)details.open=false;
}

async function updateFilters(): Promise<void> {
  if (updating) return;
  updating = true;
  updateRequestError = '';
  renderUpdates(state?.updates);
  try {
    const update = await request<UpdateState>({ type: 'updateFilters' });
    if (state) state = { ...state, updates: update };
    renderUpdates(update);
    await refresh();
  } catch (error) {
    updateRequestError = errorMessage(error);
  } finally {
    updating = false;
    const button = element<HTMLButtonElement>('update-filters');
    button.disabled = false;
    button.textContent = 'Kiểm tra ngay';
    renderUpdates(state?.updates);
  }
}

function renderLog(next: AppState, force = false): void {
  const search = element<HTMLInputElement>('log-search').value.trim().toLocaleLowerCase('vi');
  const kind = element<HTMLSelectElement>('log-kind').value;
  const signature = `${next.settings.logging}:${next.logs.length}:${next.logs[0]?.id}:${next.logs.at(-1)?.id}:${search}:${kind}`;
  if (signature === logSignature && !force) return;
  logSignature = signature;
  const entries = next.logs.filter(entry => (kind === 'all' || entry.kind === kind) && (!search || `${entry.host} ${entry.target} ${entry.rule} ${entry.group} ${entry.sourceDetail?.sources.map(source => source.rule).join(' ') ?? ''}`.toLocaleLowerCase('vi').includes(search))).sort((a, b) => b.time - a.time);
  const body = element('log-rows');
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    const row = document.createElement('tr');
    const time = appendText(row, 'td', timeFormat.format(entry.time), 'event-time');
    time.title = new Date(entry.time).toLocaleString('vi-VN');
    const identity = appendText(row, 'td', '');
    appendText(identity, 'span', kindNames[entry.kind], 'event-kind');
    appendText(identity, 'span', entry.host || 'Không rõ tên miền');
    const target = appendText(row, 'td', '');
    appendText(target, 'div', entry.target);
    appendText(target, 'code', entry.rule);
    const filter = next.engine?.filters.find(filter => entry.group === `ruleset_${filter.id}` || entry.group === String(filter.id));
    if (entry.group) appendText(target, 'p', filter ? filterDisplayName(filter.id) : groupNames[entry.group] || entry.group);
    if (entry.kind === 'network') {
      if (entry.sourceDetail?.sources.length) {
        const details = document.createElement('details');
        appendText(details, 'summary', `Nguồn quy tắc (${entry.sourceDetail.sourceCount} dòng)`);
        for (const source of entry.sourceDetail.sources) {
          appendText(details, 'p', filterDisplayName(source.filterId));
          appendText(details, 'code', source.rule);
        }
        if (entry.sourceDetail.sourceCount > entry.sourceDetail.sources.length) appendText(details, 'p', 'Hiển thị tối đa 3 dòng nguồn. Đây là các dòng tạo nên quy tắc mạng, không khẳng định mọi dòng đều khớp yêu cầu này.');
        target.append(details);
      } else appendText(target, 'p', 'Chưa tra cứu được dòng nguồn; mã quy tắc chặn vẫn được trình duyệt xác nhận.');
    }
    fragment.append(row);
  }
  body.replaceChildren(fragment);
  element('log-summary').textContent = `${number.format(entries.length)} / ${number.format(next.logs.length)} sự kiện · ${next.settings.logging ? 'Đang ghi' : 'Đã tắt ghi nhật ký'}`;
  element('log-empty').hidden = entries.length > 0;
  element('log-empty-message').textContent = search || kind !== 'all'
    ? 'Không có sự kiện khớp bộ lọc. Thử thay đổi nội dung tìm kiếm hoặc loại sự kiện.'
    : next.settings.logging ? 'Chưa có sự kiện mới. Duyệt một website có nội dung khớp bộ lọc để kiểm tra hoạt động.'
      : 'Bật ghi nhật ký ở phía trên rồi duyệt web để xem hoạt động. Extension vẫn chặn khi nhật ký tắt.';
}

async function refresh(): Promise<void> {
  if (refreshing || saving) { refreshAgain = true; return; }
  refreshing = true;
  try { render(await request<AppState>({ type: 'state', includeLogs:section==='log' })); }
  catch (error) { feedback(errorMessage(error), true); }
  finally {
    refreshing = false;
    if (refreshAgain) { refreshAgain = false; scheduleRefresh(); }
  }
}

function scheduleRefresh(): void {
  if (document.hidden) return;
  if (refreshTimer !== undefined) return;
  refreshTimer = setTimeout(() => { refreshTimer = undefined; void refresh(); }, 220);
}

async function save(patch: SettingsPatch, success: string, target = 'settings-status', savedEditor?: 'rules' | 'allowlist'): Promise<boolean> {
  if (saving) return false;
  const submittedText = savedEditor === 'rules' ? rulesInput.value : allowlistInput.value;
  setBusy(true);
  feedback('Đang lưu…', false, target);
  try {
    const next = await request<AppState>({ type: 'settings', patch });
    if (savedEditor === 'rules') rulesDirty = rulesInput.value !== submittedText;
    if (savedEditor === 'allowlist') allowlistDirty = allowlistInput.value !== submittedText;
    render(next);
    feedback(success, false, target);
    return true;
  } catch (error) {
    feedback(errorMessage(error), true, target);
    if (state) render(state);
    return false;
  } finally { setBusy(false); if (refreshAgain) { refreshAgain = false; scheduleRefresh(); } }
}

element<HTMLInputElement>('enabled-toggle').addEventListener('change', event => {
  const input = event.currentTarget as HTMLInputElement;
  void save({ enabled: input.checked }, input.checked ? 'Đã bật bảo vệ toàn cục.' : 'Đã tắt bảo vệ toàn cục. Tải lại trang nếu cần khôi phục nội dung.');
});
for (const group of GROUPS) {
  element<HTMLInputElement>(`group-${group}`).addEventListener('change', event => {
    if (!state) return;
    const input = event.currentTarget as HTMLInputElement;
    const groups = { [group]: input.checked };
    void save({ groups }, 'Đã cập nhật bộ lọc. Tải lại website để áp dụng đầy đủ.');
  });
}
element<HTMLInputElement>('logging-toggle').addEventListener('change', event => {
  const checked = (event.currentTarget as HTMLInputElement).checked;
  void save({ logging: checked }, checked ? 'Đã bật nhật ký và đo phần tử đã ẩn. Tải lại website để bắt đầu đo.' : 'Đã tắt nhật ký và xóa dữ liệu phiên. Tải lại website để dừng phép đo cũ và tiết kiệm tài nguyên.');
});
element<HTMLInputElement>('scriptlets-toggle').addEventListener('change', event => {
  const checked = (event.currentTarget as HTMLInputElement).checked;
  void save({ scriptlets: checked }, checked ? 'Đã bật scriptlet trong quy tắc cá nhân. Tải lại trang để áp dụng.' : 'Đã tắt scriptlet cá nhân. Scriptlet của bộ lọc đóng gói vẫn hoạt động; tải lại trang để khôi phục hành vi của quy tắc cá nhân.');
});
element('update-filters').addEventListener('click', () => { void updateFilters(); });
for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    void save({ theme: radio.value as Theme }, 'Đã cập nhật giao diện.');
  });
}
rulesInput.addEventListener('input', () => { rulesDirty = state ? rulesInput.value !== state.settings.userRules : true; dirtyLabel(); });
allowlistInput.addEventListener('input', () => { allowlistDirty = state ? allowlistInput.value !== state.settings.allowlist.join('\n') : true; dirtyLabel(); });
element('rules-form').addEventListener('submit', event => {
  event.preventDefault();
  const diagnostics = validateUserRules(rulesInput.value);
  if (diagnostics.length) {
    feedback(diagnostics.map(diagnostic => `Dòng ${diagnostic.line}: ${diagnostic.message}`).join('\n'), true, 'rules-feedback');
    return;
  }
  void save({ userRules: rulesInput.value }, 'Đã lưu và áp dụng quy tắc. Tải lại trang nếu cần khôi phục phần tử đã ẩn.', 'rules-feedback', 'rules');
});
element('allowlist-form').addEventListener('submit', event => {
  event.preventDefault();
  const allowlist = allowlistInput.value.split('\n').map(line => line.trim()).filter(Boolean);
  void save({ allowlist }, 'Đã lưu danh sách trắng. Tải lại website đang mở để khôi phục nội dung.', 'allowlist-feedback', 'allowlist');
});
element('clear-log').addEventListener('click', () => {
  if (saving) return;
  setBusy(true);
  void request<unknown>({ type: 'clearLog' })
    .then(() => { feedback('Đã xóa nhật ký cục bộ.'); })
    .catch((error: unknown) => { feedback(errorMessage(error), true); })
    .finally(() => { setBusy(false); void refresh(); });
});
element('log-search').addEventListener('input', () => {
  if (searchTimer !== undefined) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { if (state) renderLog(state); }, 150);
});
element('log-kind').addEventListener('change', () => { if (state) renderLog(state); });
element('backup-export').addEventListener('click', () => {
  if (saving || !state) return;
  void (async () => {
    let url: string | undefined;
    try {
      requireSavedEditors();
      setBusy(true);
      const current = await request<AppState>({ type: 'state', includeLogs: false });
      const backup = createSettingsBackup(current.settings, current.version);
      url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2) + '\n'], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `Safora-${current.version}-settings-${backup.createdAt.slice(0, 10)}.json`;
      document.body.append(link); link.click(); link.remove();
      // Download navigation consumes the object URL after the current event task.
      const downloadedUrl = url;
      setTimeout(() => URL.revokeObjectURL(downloadedUrl), 1000);
      url = undefined;
      feedback('Đã xuất cài đặt đã lưu. Tệp chứa quy tắc và website ngoại lệ; hãy giữ riêng tư.', false, 'backup-feedback');
    } catch (error) { feedback(errorMessage(error), true, 'backup-feedback'); }
    finally { if (url) URL.revokeObjectURL(url); setBusy(false); }
  })();
});
element('backup-import').addEventListener('click', () => {
  if (saving) return;
  try { requireSavedEditors(); element<HTMLInputElement>('backup-file').click(); }
  catch (error) { feedback(errorMessage(error), true, 'backup-feedback'); }
});
element<HTMLInputElement>('backup-file').addEventListener('change', event => {
  if (saving) return;
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  if (!file) return;
  clearBackupPreview();
  void (async () => {
    try {
      requireSavedEditors();
      if (file.size > MAX_BACKUP_BYTES) throw new Error('Bản sao lưu tối đa 2 MB.');
      setBusy(true);
      pendingBackup = parseSettingsBackup(await file.text());
      const settings = pendingBackup.settings;
      const rules = settings.userRules.split('\n').filter(line => line.trim() && !line.trim().startsWith('!')).length;
      element('backup-summary').textContent = `Bản Safora ${pendingBackup.extensionVersion} · ${dateTimeFormat.format(new Date(pendingBackup.createdAt))}. ${number.format(rules)} quy tắc, ${number.format(settings.allowlist.length)} website ngoại lệ, ${GROUPS.filter(group => settings.groups[group]).length}/${GROUPS.length} nhóm bộ lọc. Bảo vệ: ${settings.enabled ? 'bật' : 'tắt'}. Nhật ký: ${settings.logging ? 'bật' : 'tắt'}. Scriptlet cá nhân: ${settings.scriptlets ? 'bật' : 'tắt'}. ${pendingBackup.version === 1 ? 'Bản sao lưu cũ: nhóm URL độc hại mới sẽ được bật. ' : ''}Giao diện: ${{ system: 'theo hệ thống', light: 'sáng', dark: 'tối' }[settings.theme]}.`;
      element('backup-preview').hidden = false;
      feedback('Đã kiểm tra tệp. Cài đặt hiện tại chưa thay đổi.', false, 'backup-feedback');
    } catch (error) { clearBackupPreview(); feedback(errorMessage(error), true, 'backup-feedback'); }
    finally { setBusy(false); }
  })();
});
element('backup-apply').addEventListener('click', () => {
  if (saving || !pendingBackup) return;
  try { requireSavedEditors(); }
  catch (error) { feedback(errorMessage(error), true, 'backup-feedback'); return; }
  const submitted = pendingBackup;
  void save(submitted.settings, 'Đã khôi phục cài đặt. Tải lại website để áp dụng đầy đủ.', 'backup-feedback').then(success => { if (success) clearBackupPreview(); });
});
element('backup-cancel').addEventListener('click', () => { clearBackupPreview(); feedback('Đã hủy khôi phục.', false, 'backup-feedback'); });
window.addEventListener('hashchange', updateNavigation);
window.addEventListener('beforeunload', event => { if (rulesDirty || allowlistDirty) { event.preventDefault(); event.returnValue = ''; } });
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'local' && (changes.settings || changes.filterUpdateSnapshotV1 || (section === 'dashboard' && changes.total)))
    || (area === 'session' && section === 'log' && changes.logs)) scheduleRefresh();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRefresh(); });
updateNavigation();
if(!refreshing)void refresh();
