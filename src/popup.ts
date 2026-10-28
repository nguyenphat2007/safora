import { applyTheme, request } from './shared/api';
import type { PopupState } from './shared/types';
import { HISTORY_KEY, type BlockingHistory } from './shared/statistics';
import { renderStatistics } from './popup-statistics';
import { uiDiagnosticText } from './shared/ui-messages';

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Không tìm thấy giao diện: ${id}`);
  return node as T;
}

const number = new Intl.NumberFormat('vi-VN');
const toggle = element<HTMLButtonElement>('site-toggle');
const status = element('popup-status');
let state: PopupState | null = null;
let tabId: number | undefined;
let busy = false;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;
let refreshing = false;
let refreshAgain = false;
let statisticsVisible = false;
let history: BlockingHistory | undefined;

function showStatistics(visible: boolean): void {
  statisticsVisible = visible;
  for (const view of ['protection', 'statistics']) {
    const selected = (view === 'statistics') === visible;
    const button = element<HTMLButtonElement>(`${view}-tab`);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    element(`${view}-panel`).hidden = !selected;
  }
  feedback('');
  if (visible) { if(history)renderStatistics(history); void refresh(); }
}

function feedback(message: string, error = false): void {
  status.textContent = uiDiagnosticText(message);
  status.dataset.error = String(error);
  status.hidden = !message;
}

function render(next: PopupState): void {
  state = next;
  applyTheme(next.settings.theme);
  const supported = next.supported && next.tabId !== null;
  const active = next.protected && supported;
  element('site-host').textContent = next.host || 'Trang không được hỗ trợ';
  element('site-host').title = next.host;
  element('protection-hero').dataset.protected = String(active);
  element('protection-title').textContent = !supported ? 'Trang không được hỗ trợ' : active ? 'Bạn đang được bảo vệ' : 'Bảo vệ đang tạm dừng';
  element('protection-description').textContent = !supported
    ? 'Mở một trang web để sử dụng Safora.'
    : !next.settings.enabled
      ? 'Bảo vệ toàn cục đang tắt. Mở Cài đặt để bật lại.'
      : active ? 'Đang chặn quảng cáo và trình theo dõi trên website này.'
        : 'Website này nằm trong danh sách trắng. Bật lại để tiếp tục chặn.';
  toggle.setAttribute('aria-checked', String(active));
  toggle.disabled = busy || !supported || !next.settings.enabled;
  toggle.setAttribute('aria-label', active ? 'Tắt bảo vệ website này và tải lại trang' : 'Bật bảo vệ website này và tải lại trang');
  element('toggle-caption').textContent = !supported ? 'Bảo vệ khả dụng trên các trang web thông thường' : !next.settings.enabled ? 'Bật bảo vệ toàn cục trong Cài đặt' : 'Thay đổi sẽ tải lại trang';
  const canCount = next.countMode === 'debug';
  const nativeCount = next.countMode === 'native';
  element('statistics-tab').hidden = nativeCount;
  element('popup-tabs').hidden = nativeCount;
  element('native-count-note').hidden = !nativeCount || !supported;
  if (nativeCount && statisticsVisible) showStatistics(false);
  element('popup-stats').hidden = !canCount || !supported;
  element('page-count').textContent = canCount && supported ? number.format(next.tab.network) : '—';
  element('total-count').textContent = canCount ? number.format(next.total) : '—';
  if (statisticsVisible) {
    element('statistics-reload').hidden = true;
    element('statistics-status').hidden = canCount && !!history;
    element('statistics-status').textContent = canCount ? 'Đang tải thống kê…' : 'Trình duyệt hiện không cung cấp số liệu thống kê. Bảo vệ vẫn hoạt động.';
    element('statistics-data').hidden = !canCount || !history;
  }
}

async function refresh(): Promise<void> {
  if (refreshing) { refreshAgain = true; return; }
  refreshing = true;
  try {
    render(await request<PopupState>({ type: 'state', scope:'popup', includeLogs:false, ...(tabId !== undefined ? { tabId } : {}) }));
    if (statisticsVisible && state?.countMode === 'debug') {
      try {
        history = await request<BlockingHistory>({ type: 'statistics' });
        renderStatistics(history);
        element('statistics-data').hidden = false;
        element('statistics-status').hidden = true;
      } catch (error) {
        const needsReload = error instanceof Error && error.message === 'Lệnh không được hỗ trợ.';
        element('statistics-data').hidden = true;
        element('statistics-status').hidden = false;
        element('statistics-reload').hidden = !needsReload;
        element('statistics-status').textContent = needsReload
          ? 'Hãy bấm “Tải lại Safora” rồi mở lại tiện ích để dùng thống kê mới. Nếu vẫn gặp lỗi, kiểm tra bạn đang nạp thư mục Safora/dist.'
          : uiDiagnosticText(error instanceof Error ? error.message : 'Chưa thể tải thống kê. Hãy mở lại tiện ích.');
      }
    }
  } catch (error) {
    feedback(error instanceof Error ? error.message : 'Không thể đọc trạng thái extension.', true);
  } finally {
    refreshing = false;
    if (refreshAgain) { refreshAgain = false; scheduleRefresh(); }
  }
}

function scheduleRefresh(): void {
  if (document.hidden) return;
  if (refreshTimer !== undefined) return;
  refreshTimer = setTimeout(() => { refreshTimer = undefined; void refresh(); }, 180);
}

toggle.addEventListener('click', () => {
  if (!state || state.tabId === null || busy) return;
  const current = state;
  busy = true;
  render(current);
  feedback('Đang cập nhật bảo vệ và tải lại trang…');
  void request<unknown>({ type: 'toggleSite', tabId: current.tabId!, enabled: !current.protected })
    .then(() => { feedback('Đã cập nhật bảo vệ cho website này.'); })
    .catch((error: unknown) => { feedback(error instanceof Error ? error.message : 'Không thể thay đổi bảo vệ.', true); })
    .finally(() => { busy = false; void refresh(); });
});

function openOptions(section: string): void {
  void request<unknown>({ type: 'openOptions', section })
    .then(() => { window.close(); })
    .catch((error: unknown) => { feedback(error instanceof Error ? error.message : 'Không thể mở cài đặt.', true); });
}

element('open-settings').addEventListener('click', () => { openOptions('dashboard'); });
element('protection-tab').addEventListener('click', () => { showStatistics(false); });
element('statistics-tab').addEventListener('click', () => { showStatistics(true); });
element<HTMLButtonElement>('statistics-reload').addEventListener('click', () => {
  const button = element<HTMLButtonElement>('statistics-reload');
  button.disabled = true;
  try { chrome.runtime.reload(); }
  catch {
    button.disabled = false;
    element('statistics-status').textContent = 'Mở trang quản lý tiện ích của trình duyệt, bấm Tải lại ở Safora rồi mở lại popup.';
  }
});
for (const id of ['statistics-category', 'statistics-range']) element(id).addEventListener('change', () => { if(history)renderStatistics(history); });
for (const view of ['protection', 'statistics']) element(`${view}-tab`).addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const visible = event.key === 'Home' ? false : event.key === 'End' ? true : !statisticsVisible;
  showStatistics(visible); element(visible ? 'statistics-tab' : 'protection-tab').focus();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === 'local' && (changes.settings || changes.total || (statisticsVisible && changes[HISTORY_KEY]))) || (area === 'session' && changes.tabStats)) scheduleRefresh();
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRefresh(); });

async function initialize(): Promise<void> {
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tabId = activeTab?.id;
    await refresh();
  } catch (error) {
    feedback(error instanceof Error ? error.message : 'Không thể đọc tab hiện tại.', true);
  }
}
void initialize();
