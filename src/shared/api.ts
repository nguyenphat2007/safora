import type { RequestMessage, Reply, Theme } from './types';
export async function request<T>(message: RequestMessage): Promise<T> {
  const reply = await chrome.runtime.sendMessage(message) as Reply<T> | undefined;
  if (!reply) throw new Error('Service worker chưa trả lời. Hãy tải lại extension.');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
export function applyTheme(theme: Theme): void { document.documentElement.dataset.theme = theme; }
